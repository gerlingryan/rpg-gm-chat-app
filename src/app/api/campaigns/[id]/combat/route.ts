import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_COMBAT_STATE,
  type CombatStatusDuration,
  normalizeCombatState,
} from "@/lib/combat";
import {
  advanceTurn,
  buildInitiativeState,
  resolveAutoHitAction,
  resolveAttackAction,
  resolveSaveAction,
  resolveUtilityAction,
} from "@/lib/combat-engine";
import {
  findCharacterByRef,
  getCombatRulesetProfile,
  getAttackDefaults,
  getInitiativeModifier,
} from "@/lib/combat-ruleset-adapter";
import { resolveCatalogEffect } from "@/lib/spell-ability-catalog";
import {
  buildInitialCampaignBootstrap,
  normalizeCampaignBootstrap,
} from "@/lib/campaign-bootstrap";
import { resolveEncounterStart } from "@/lib/encounter-resolver";
import { normalizeCombatStartSeedsWithTelemetry } from "@/lib/combat-start-telemetry";
import {
  classifyEncounterRisk,
  computeEncounterRiskScore,
} from "@/lib/encounter-risk";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function parseString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseCombatResourceString(value: unknown) {
  const text = parseString(value);
  if (!text) {
    return undefined;
  }

  if (
    /^(n\/a|na|unknown|\?)$/i.test(text) ||
    /^\?+\s*\/\s*\?+$/i.test(text) ||
    /^unknown\s*\/\s*unknown$/i.test(text)
  ) {
    return undefined;
  }

  return text;
}

function parseNumber(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function parseOptionalNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function parseBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }
  return fallback;
}

function asObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function mergeUniqueStatusEffects(existing: unknown, additions: string[]) {
  const current = Array.isArray(existing)
    ? existing.filter(
        (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
      )
    : [];
  const merged = [...current];
  for (const addition of additions) {
    if (
      typeof addition === "string" &&
      addition.trim().length > 0 &&
      !merged.some((entry) => entry.toLowerCase() === addition.trim().toLowerCase())
    ) {
      merged.push(addition.trim());
    }
  }
  return merged;
}

function getNestedValue(source: unknown, path: string[]) {
  let cursor: unknown = source;
  for (const key of path) {
    const cursorObject = asObject(cursor);
    if (!cursorObject || !(key in cursorObject)) {
      return null;
    }
    cursor = cursorObject[key];
  }
  return cursor;
}

function getFirstNumber(source: unknown, candidatePaths: string[][]) {
  for (const path of candidatePaths) {
    const value = getNestedValue(source, path);
    const parsed = parseOptionalNumber(value);
    if (parsed !== undefined) {
      return parsed;
    }
  }
  return undefined;
}

function getAbilitySaveBonus(
  sheetJson: Record<string, unknown> | null,
  ability: "str" | "dex" | "con" | "int" | "wis" | "cha",
) {
  return (
    getFirstNumber(sheetJson, [
      ["savingThrows", ability],
      ["saves", ability],
      ["abilities", ability, "save"],
      ["abilities", ability, "modifier"],
      [ability, "save"],
      [ability, "modifier"],
    ]) ?? 0
  );
}

function getSpellSaveDc(sheetJson: Record<string, unknown> | null) {
  return (
    getFirstNumber(sheetJson, [
      ["spellSaveDc"],
      ["spellcasting", "saveDc"],
      ["saveDc"],
    ]) ?? undefined
  );
}

function buildConcentrationStatusLabel() {
  return "Concentrating";
}

function buildConcentrationDuration(
  spellName: string,
  durationRounds: number,
  breakOnDamage = true,
) {
  return {
    effect: "Concentrating",
    source: spellName.trim() || "Spell",
    remainingRounds: Math.max(1, Math.trunc(durationRounds)),
    kind: "concentration" as const,
    breakOnDamage,
  } satisfies CombatStatusDuration;
}

function parseSpellSlotLevel(slot: string | undefined) {
  if (!slot) {
    return 1;
  }
  const match = slot.match(/(\d+)/);
  if (!match) {
    return 1;
  }
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  return Math.max(1, Math.trunc(parsed));
}

function getCharacterLevel(sheetJson: Record<string, unknown> | null) {
  return Math.max(
    1,
    Math.trunc(
      getFirstNumber(sheetJson, [["level"], ["characterLevel"], ["stats", "level"]]) ?? 1,
    ),
  );
}

function getDndCantripDamageDiceCount(level: number) {
  if (level >= 17) {
    return 4;
  }
  if (level >= 11) {
    return 3;
  }
  if (level >= 5) {
    return 2;
  }
  return 1;
}

function collectSpellNamesFromNested(value: unknown, names: Set<string>, depth = 0) {
  if (depth > 6 || value == null) {
    return;
  }
  if (typeof value === "string") {
    if (value.trim()) {
      names.add(value.trim().toLowerCase());
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectSpellNamesFromNested(entry, names, depth + 1);
    }
    return;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.name === "string" && record.name.trim()) {
      names.add(record.name.trim().toLowerCase());
    }
    for (const nestedValue of Object.values(record)) {
      collectSpellNamesFromNested(nestedValue, names, depth + 1);
    }
  }
}

function getKnownSpellNames(sheetJson: Record<string, unknown> | null) {
  if (!sheetJson) {
    return new Set<string>();
  }
  const names = new Set<string>();
  collectSpellNamesFromNested(sheetJson.spells, names);
  collectSpellNamesFromNested(sheetJson.spellbook, names);
  collectSpellNamesFromNested(sheetJson.knownSpells, names);
  collectSpellNamesFromNested(sheetJson.spellcasting, names);
  collectSpellNamesFromNested(sheetJson.preparedSpells, names);
  collectSpellNamesFromNested(sheetJson.signatureSpell, names);
  return names;
}

type ReactionWindow = {
  targetRef: string;
  targetName: string;
  triggers: string[];
  availableReactions: string[];
};

function buildReactionWindows(params: {
  kind: string;
  resolution: Record<string, unknown>;
  targetRef: string;
  targetName: string;
  targetCharacter: { sheetJson: Record<string, unknown> | null } | null;
  targetReactionUsed?: boolean;
  catalogReactionHooks?: Array<{ trigger: string; note: string }> | null;
}) {
  const windows: ReactionWindow[] = [];
  if (params.kind !== "attack" && params.kind !== "cast-spell") {
    return windows;
  }

  const hit =
    typeof params.resolution.hit === "boolean"
      ? params.resolution.hit
      : typeof params.resolution.saveSucceeded === "boolean"
        ? !params.resolution.saveSucceeded
        : true;
  if (!hit) {
    return windows;
  }

  const spellNames = getKnownSpellNames(params.targetCharacter?.sheetJson ?? null);
  const availableReactions: string[] = [];
  const triggers = ["when_hit_by_attack"];

  if (spellNames.has("shield") && !params.targetReactionUsed) {
    availableReactions.push("Shield");
  }

  if (Array.isArray(params.catalogReactionHooks)) {
    for (const hook of params.catalogReactionHooks) {
      if (hook?.trigger && !triggers.includes(hook.trigger)) {
        triggers.push(hook.trigger);
      }
      if (hook?.note) {
        availableReactions.push(hook.note);
      }
    }
  }

  if (availableReactions.length === 0) {
    return windows;
  }

  windows.push({
    targetRef: params.targetRef,
    targetName: params.targetName,
    triggers,
    availableReactions,
  });

  return windows;
}

function targetHasShieldReaction(character: { sheetJson: Record<string, unknown> | null } | null) {
  const spellNames = getKnownSpellNames(character?.sheetJson ?? null);
  return spellNames.has("shield");
}

function targetHasAvailableSpellSlots(character: {
  sheetJson: Record<string, unknown> | null;
} | null) {
  const sheet = asObject(character?.sheetJson);
  const spellSlots = asObject(sheet?.spellSlots);
  if (!spellSlots) {
    return false;
  }
  return Object.values(spellSlots).some(
    (value) =>
      typeof value === "number" && Number.isFinite(value) && Math.trunc(value) > 0,
  );
}

function isReactionUsedInCombatState(
  state: ReturnType<typeof normalizeCombatState>,
  targetRef: string,
) {
  const normalizedTarget = targetRef.trim().toLowerCase();
  const entry =
    state.roster.find(
      (current) =>
        (current.id ?? "").trim().toLowerCase() === normalizedTarget ||
        current.name.trim().toLowerCase() === normalizedTarget,
    ) ?? null;
  if (!entry || !Array.isArray(entry.statusEffects)) {
    return false;
  }
  return entry.statusEffects.some(
    (effect) => typeof effect === "string" && effect.trim().toLowerCase() === "reaction used",
  );
}

function normalizeCombatStatusDurations(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as CombatStatusDuration[];
  }
  return value
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => {
      const typedEntry = entry as Record<string, unknown>;
      const effect = parseString(typedEntry.effect);
      const remainingRounds = parseOptionalNumber(typedEntry.remainingRounds);
      const source = parseString(typedEntry.source) || undefined;
      const kindRaw = parseString(typedEntry.kind).toLowerCase();
      const kind: CombatStatusDuration["kind"] =
        kindRaw === "concentration" || kindRaw === "timed" ? kindRaw : undefined;
      const breakOnDamage = typedEntry.breakOnDamage === true;
      if (!effect || !remainingRounds || remainingRounds <= 0) {
        return null;
      }
      return {
        effect,
        remainingRounds: Math.max(1, Math.trunc(remainingRounds)),
        source,
        kind,
        breakOnDamage,
      } satisfies CombatStatusDuration;
    })
    .filter((entry): entry is CombatStatusDuration => Boolean(entry));
}

function buildDurationKey(duration: CombatStatusDuration) {
  return `${duration.effect.trim().toLowerCase()}::${(duration.source ?? "").trim().toLowerCase()}`;
}

function applyStatusEffectsToCombatState(
  state: ReturnType<typeof normalizeCombatState>,
  targetRef: string,
  effects: string[],
  options?: {
    durations?: CombatStatusDuration[];
    replaceConcentration?: boolean;
  },
) {
  if (!effects.length && !(options?.durations?.length)) {
    return state;
  }

  const normalizedTarget = targetRef.trim().toLowerCase();
  const roster = state.roster.map((entry) => {
    const ref = (entry.id ?? entry.name).trim().toLowerCase();
    const name = entry.name.trim().toLowerCase();
    if (ref !== normalizedTarget && name !== normalizedTarget) {
      return entry;
    }

    const currentEffects = Array.isArray(entry.statusEffects)
      ? entry.statusEffects.filter(
          (effect): effect is string => typeof effect === "string" && effect.trim().length > 0,
        )
      : [];
    const currentDurations = normalizeCombatStatusDurations((entry as { statusDurations?: unknown }).statusDurations);
    const replacedDurations = options?.replaceConcentration
      ? currentDurations.filter(
          (duration) =>
            !(duration.kind === "concentration" || duration.effect.toLowerCase() === "concentrating"),
        )
      : currentDurations;
    const incomingDurations = normalizeCombatStatusDurations(options?.durations ?? []);
    const mergedDurationMap = new Map<string, CombatStatusDuration>();
    for (const duration of replacedDurations) {
      mergedDurationMap.set(buildDurationKey(duration), duration);
    }
    for (const duration of incomingDurations) {
      mergedDurationMap.set(buildDurationKey(duration), duration);
    }
    const mergedDurations = Array.from(mergedDurationMap.values());

    const merged = mergeUniqueStatusEffects(currentEffects, effects);
    for (const duration of mergedDurations) {
      if (!merged.some((effect) => effect.toLowerCase() === duration.effect.toLowerCase())) {
        merged.push(duration.effect);
      }
    }
    const normalizedMerged =
      options?.replaceConcentration
        ? merged.filter((effect) => effect.toLowerCase() !== "concentrating" || mergedDurations.some((duration) => duration.effect.toLowerCase() === "concentrating"))
        : merged;

    return {
      ...entry,
      statusEffects: normalizedMerged,
      statusDurations: mergedDurations,
    };
  });

  return normalizeCombatState({
    ...state,
    roster,
  });
}

function getCombatEntryByRef(
  state: ReturnType<typeof normalizeCombatState>,
  targetRef: string,
) {
  const normalizedTarget = targetRef.trim().toLowerCase();
  return (
    state.roster.find((entry) => {
      const ref = (entry.id ?? entry.name).trim().toLowerCase();
      const name = entry.name.trim().toLowerCase();
      return ref === normalizedTarget || name === normalizedTarget;
    }) ?? null
  );
}

function syncConcentrationStatusEffect(
  currentStatusEffects: unknown,
  combatEntryStatusEffects: unknown,
) {
  const current = Array.isArray(currentStatusEffects)
    ? currentStatusEffects.filter(
        (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
      )
    : [];
  const combat = Array.isArray(combatEntryStatusEffects)
    ? combatEntryStatusEffects.filter(
        (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
      )
    : [];
  const withoutConcentrating = current.filter(
    (entry) => entry.trim().toLowerCase() !== "concentrating",
  );
  if (combat.some((entry) => entry.trim().toLowerCase() === "concentrating")) {
    return mergeUniqueStatusEffects(withoutConcentrating, ["Concentrating"]);
  }
  return withoutConcentrating;
}

function parseHpString(value: string | undefined) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  const fractionMatch = trimmed.match(/^(-?\d+)\s*\/\s*(-?\d+)$/);
  if (fractionMatch) {
    const current = Number(fractionMatch[1]);
    const max = Number(fractionMatch[2]);
    if (Number.isFinite(current) && Number.isFinite(max) && max > 0) {
      return {
        current: Math.max(0, Math.min(max, Math.trunc(current))),
        max: Math.max(1, Math.trunc(max)),
      };
    }
  }

  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) {
    const safeValue = Math.max(0, Math.trunc(numeric));
    return {
      current: safeValue,
      max: safeValue,
    };
  }

  return null;
}

function deriveHpFromCharacterSheet(sheetJson: Record<string, unknown> | null) {
  const sheet = asObject(sheetJson);
  if (!sheet) {
    return undefined;
  }

  const windObject = asObject(sheet.wind);
  if (windObject) {
    const current = parseOptionalNumber(windObject.current);
    const max = parseOptionalNumber(windObject.max);
    if (current !== undefined || max !== undefined) {
      const safeMax = Math.max(1, Math.trunc(max ?? current ?? 1));
      const safeCurrent = Math.max(0, Math.min(safeMax, Math.trunc(current ?? safeMax)));
      return `${safeCurrent}/${safeMax}`;
    }
  }

  const windScalar = parseOptionalNumber(sheet.wind);
  if (windScalar !== undefined) {
    const safeValue = Math.max(0, Math.trunc(windScalar));
    return `${safeValue}/${Math.max(1, safeValue)}`;
  }

  const hpObject = asObject(sheet.hp);
  if (hpObject) {
    const current = parseOptionalNumber(hpObject.current);
    const max = parseOptionalNumber(hpObject.max);
    if (current !== undefined || max !== undefined) {
      const safeMax = Math.max(1, Math.trunc(max ?? current ?? 1));
      const safeCurrent = Math.max(0, Math.min(safeMax, Math.trunc(current ?? safeMax)));
      return `${safeCurrent}/${safeMax}`;
    }
  }

  const hpScalar = parseOptionalNumber(sheet.hp);
  if (hpScalar !== undefined) {
    const safeValue = Math.max(0, Math.trunc(hpScalar));
    return `${safeValue}/${Math.max(1, safeValue)}`;
  }

  return undefined;
}

function hydrateCombatStateResources(
  state: ReturnType<typeof normalizeCombatState>,
  characters: Array<{ id: string; name: string; sheetJson: Record<string, unknown> | null }>,
  adapterProfile: "dnd" | "deadlands" | "generic",
) {
  if (!state.combatActive || state.roster.length === 0) {
    return state;
  }

  const roster = state.roster.map((entry) => {
    const currentHp = parseCombatResourceString(entry.hp);
    if (currentHp && parseHpString(currentHp)) {
      return entry;
    }
    if (entry.type === "enemy") {
      return {
        ...entry,
        hp: defaultEnemyHpForProfile(adapterProfile),
      };
    }
    if (entry.type !== "character") {
      return entry;
    }

    const linkedCharacter = findCharacterByRef(characters, entry.id ?? entry.name);
    if (!linkedCharacter) {
      return entry;
    }

    const derivedHp = deriveHpFromCharacterSheet(linkedCharacter.sheetJson);
    if (!derivedHp) {
      return entry;
    }

    return {
      ...entry,
      hp: derivedHp,
    };
  });

  return normalizeCombatState({
    ...state,
    roster,
  });
}

function defaultEnemyHpForProfile(profile: string) {
  if (profile === "dnd") {
    return "12/12";
  }
  if (profile === "deadlands") {
    return "10/10";
  }
  return "8/8";
}

function defaultEnemySummaryForProfile(
  profile: string,
  currentSummary: string | undefined,
) {
  if (currentSummary && currentSummary.trim().length > 0) {
    return currentSummary.trim();
  }
  if (profile === "deadlands") {
    return "Wounds 0/4";
  }
  return undefined;
}

function toDeadlandsWoundLevel(wounds: number) {
  if (wounds <= 0) {
    return "Unharmed";
  }
  if (wounds === 1) {
    return "Light";
  }
  if (wounds === 2) {
    return "Heavy";
  }
  if (wounds === 3) {
    return "Serious";
  }
  return "Critical";
}

function consumeSpellSlot(
  sheetJson: Record<string, unknown> | null,
  requestedSlot: string | undefined,
) {
  const sheet = asObject(sheetJson);
  if (!sheet) {
    return {
      ok: false,
      reason: "Caster has no sheet data to track spell slots.",
      nextSheet: sheetJson,
    };
  }

  const spellSlots = asObject(sheet.spellSlots);
  if (!spellSlots) {
    return {
      ok: false,
      reason: "No spell slots are available.",
      nextSheet: sheet,
    };
  }

  const slotEntries = Object.entries(spellSlots).filter(([, value]) =>
    typeof value === "number" && Number.isFinite(value),
  ) as Array<[string, number]>;
  if (slotEntries.length === 0) {
    return {
      ok: false,
      reason: "No spell slots are available.",
      nextSheet: sheet,
    };
  }

  const chosenSlot =
    (requestedSlot && slotEntries.find(([slotName]) => slotName === requestedSlot)?.[0]) ??
    slotEntries.find(([, value]) => value > 0)?.[0] ??
    null;
  if (!chosenSlot) {
    return {
      ok: false,
      reason: "No spell slots remaining.",
      nextSheet: sheet,
    };
  }

  const currentValue = spellSlots[chosenSlot];
  const numericValue =
    typeof currentValue === "number" && Number.isFinite(currentValue)
      ? Math.max(0, Math.trunc(currentValue))
      : 0;
  if (numericValue <= 0) {
    return {
      ok: false,
      reason: `No remaining slots in ${chosenSlot}.`,
      nextSheet: sheet,
    };
  }

  const nextSlots = {
    ...spellSlots,
    [chosenSlot]: numericValue - 1,
  };

  return {
    ok: true,
    consumedSlot: chosenSlot,
    nextSheet: {
      ...sheet,
      spellSlots: nextSlots,
    },
  };
}

export async function POST(req: NextRequest, context: RouteContext) {
  const debugLoggingEnabled = req.headers.get("x-debug-state-logging") === "true";
  const { id } = await context.params;
  const rawBody = await req.json().catch(() => ({}));
  const body =
    rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
      ? (rawBody as Record<string, unknown>)
      : {};
  const action = parseString(body.action).toLowerCase();

  if (!action) {
    return NextResponse.json({ error: "Action is required." }, { status: 400 });
  }

  const campaign = await prisma.campaign.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      ruleset: true,
      bootstrapJson: true,
      combatStateJson: true,
      characters: {
        select: {
          id: true,
          name: true,
          sheetJson: true,
        },
      },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          content: true,
        },
      },
    },
  });

  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }

  const currentCombatState = normalizeCombatState(
    (campaign as { combatStateJson?: unknown }).combatStateJson,
  );
  const adapterProfile = getCombatRulesetProfile(campaign.ruleset);
  const hydratedCombatState = hydrateCombatStateResources(
    currentCombatState,
    campaign.characters,
    adapterProfile,
  );
  const messageIdForSeed = campaign.messages[0]?.id ?? "no-message";

  if (action === "start") {
    const seeds = Array.isArray(body.combatants)
      ? body.combatants
          .map((entry) => {
            if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
              return null;
            }

            const typedEntry = entry as Record<string, unknown>;
            const name = parseString(typedEntry.name);
            if (!name) {
              return null;
            }

            const rawType = parseString(typedEntry.type).toLowerCase();
            const type = rawType === "enemy" || rawType === "npc" ? rawType : "character";
            const summary = parseString(typedEntry.summary) || undefined;
            const hp = parseCombatResourceString(typedEntry.hp);
            const idValue = parseString(typedEntry.id) || undefined;
            const statusEffects = Array.isArray(typedEntry.statusEffects)
              ? typedEntry.statusEffects
                  .filter((value): value is string => typeof value === "string")
                  .map((value) => value.trim())
                  .filter(Boolean)
              : undefined;
            const statusDurations = normalizeCombatStatusDurations(typedEntry.statusDurations);

            const linkedCharacter =
              type === "character"
                ? findCharacterByRef(campaign.characters, idValue || name)
                : null;

            return {
              id: idValue,
              name,
              type,
              summary: defaultEnemySummaryForProfile(
                adapterProfile,
                summary,
              ),
              hp:
                hp ||
                (linkedCharacter
                  ? deriveHpFromCharacterSheet(linkedCharacter.sheetJson)
                  : type === "enemy"
                    ? defaultEnemyHpForProfile(adapterProfile)
                    : undefined),
              statusEffects,
              statusDurations,
              initiativeModifier: getInitiativeModifier({
                ruleset: campaign.ruleset,
                rosterType: type,
                character: linkedCharacter,
                explicitModifier: parseOptionalNumber(typedEntry.initiativeModifier),
              }),
            };
          })
          .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      : [];

    const fallbackBootstrap = buildInitialCampaignBootstrap({
      title: campaign.title,
      ruleset: campaign.ruleset,
      startingScenario: campaign.messages[0]?.content ?? "",
    });
    const normalizedBootstrap = normalizeCampaignBootstrap(
      (campaign as { bootstrapJson?: unknown }).bootstrapJson,
      fallbackBootstrap,
    );
    const seedInput = parseString(body.seedInput) || `${id}|${messageIdForSeed}|start`;
    const encounterResolved = resolveEncounterStart({
      ruleset: campaign.ruleset,
      adapterProfile,
      bootstrap: normalizedBootstrap,
      combatants: seeds,
      characters: campaign.characters.map((entry) => ({
        id: entry.id,
        name: entry.name,
        sheetJson: entry.sheetJson,
      })),
      seedInput,
    });
    const resolvedSeeds = encounterResolved.combatants;
    const { startReadyCombatants: startReadySeeds, enemyAssignments: resolvedEnemyTelemetry } =
      normalizeCombatStartSeedsWithTelemetry({
        inputCombatants: seeds,
        resolvedCombatants: resolvedSeeds,
        adapterProfile,
      });
    const encounterRiskScore = computeEncounterRiskScore({
      partySize: encounterResolved.debug.partySize,
      enemyCountTarget: encounterResolved.debug.enemyCountTarget,
      averageResourceRatio: encounterResolved.debug.averageResourceRatio,
      averageLevel: encounterResolved.debug.averageLevel,
    });
    const encounterRisk = classifyEncounterRisk(encounterRiskScore);

    if (startReadySeeds.length < 2) {
      return NextResponse.json(
        { error: "At least two combatants are required to start combat." },
        { status: 400 },
      );
    }

    const activeName = parseString(body.activeName) || undefined;
    const initiative = buildInitiativeState({
      seeds: startReadySeeds,
      profile: adapterProfile,
      deadlandsJokerEffectsEnabled:
        adapterProfile === "deadlands"
          ? parseBoolean(body.deadlandsJokerEffectsEnabled, false)
          : false,
      activeName,
      round: 1,
      seedInput,
    });

    await prisma.campaign.update({
      where: { id },
      data: {
        combatStateJson: initiative.state,
      } as never,
    });

    if (debugLoggingEnabled) {
      console.info("[combat] start", {
        campaignId: id,
        ruleset: campaign.ruleset,
        adapterProfile,
        combatants: startReadySeeds.map((seed) => ({
          id: seed.id,
          name: seed.name,
          type: seed.type,
          initiativeModifier: seed.initiativeModifier,
        })),
        encounterResolver: encounterResolved.debug,
        encounterRisk: {
          score: encounterRiskScore,
          label: encounterRisk.label,
        },
      });
    }

    return NextResponse.json({
      combatStateJson: initiative.state,
      rollLog: initiative.rollLog,
      adapterDebug: {
        ruleset: campaign.ruleset,
        profile: adapterProfile,
        encounterResolver: encounterResolved.debug,
        encounterRisk: {
          score: encounterRiskScore,
          label: encounterRisk.label,
        },
        encounterStart: {
          seedInput,
          inputCombatantCount: seeds.length,
          resolvedCombatantCount: startReadySeeds.length,
          inputEnemyCount: seeds.filter((entry) => entry.type === "enemy").length,
          resolvedEnemyCount: resolvedEnemyTelemetry.length,
          enemyAssignments: resolvedEnemyTelemetry,
        },
      },
    });
  }

  if (action === "submit") {
    const kind = parseString(body.kind).toLowerCase();
    if (
      kind !== "attack" &&
      kind !== "cast-spell" &&
      kind !== "defend" &&
      kind !== "pass" &&
      kind !== "help" &&
      kind !== "disengage" &&
      kind !== "dash" &&
      kind !== "take-cover" &&
      kind !== "aim" &&
      kind !== "surrender" &&
      kind !== "attempt-escape"
    ) {
      return NextResponse.json(
        {
          error:
            "Unsupported action kind. Supported: attack, cast-spell, defend, pass, help, disengage, dash, take-cover, aim, surrender, attempt-escape.",
        },
        { status: 400 },
      );
    }

    const actor = parseString(body.actor);
    const target = parseString(body.target);
    if (!actor) {
      return NextResponse.json(
        { error: "Combat action requires actor." },
        { status: 400 },
      );
    }
    if ((kind === "attack" || kind === "cast-spell") && !target) {
      return NextResponse.json(
        { error: "Attack/cast-spell action requires actor and target." },
        { status: 400 },
      );
    }

    const seedInput =
      parseString(body.seedInput) || `${id}|${messageIdForSeed}|submit|${actor}|${target}`;
    const actorEntry =
      hydratedCombatState.roster.find((entry) => {
        const ref = entry.id || entry.name;
        return ref.trim().toLowerCase() === actor.trim().toLowerCase();
      }) ??
      hydratedCombatState.roster.find(
        (entry) => entry.name.trim().toLowerCase() === actor.trim().toLowerCase(),
      ) ??
      null;
    const actorType = actorEntry?.type ?? "character";
    const actorCharacter = findCharacterByRef(campaign.characters, actor);
    const targetCharacter = target ? findCharacterByRef(campaign.characters, target) : null;
    const defaults = getAttackDefaults({
      ruleset: campaign.ruleset,
      actorType,
      actorCharacter,
      targetCharacter,
    });
    const spellName = parseString(body.spellName) || undefined;
    const catalogEffect = resolveCatalogEffect({
      profile: adapterProfile,
      kind: kind as "attack" | "cast-spell",
      spellName,
    });
    const attackDie =
      kind === "cast-spell" && catalogEffect?.attackDieOverride
        ? catalogEffect.attackDieOverride
        : parseNumber(
            body.attackDie,
            catalogEffect?.attackDieOverride ?? defaults.attackDie,
          );
    const attackBonus = parseNumber(
      body.attackBonus,
      defaults.attackBonus + (catalogEffect?.attackBonusModifier ?? 0),
    );
    const targetAc = parseNumber(body.targetAc, defaults.targetAc);
    const damageDie =
      kind === "cast-spell" && catalogEffect?.damageDieOverride
        ? catalogEffect.damageDieOverride
        : parseNumber(
            body.damageDie,
            catalogEffect?.damageDieOverride ?? defaults.damageDie,
          );
    const damageDiceCount = parseNumber(
      body.damageDiceCount,
      catalogEffect?.damageDiceCountOverride ?? 1,
    );
    const damageBonus = parseNumber(
      body.damageBonus,
      defaults.damageBonus + (catalogEffect?.damageBonusModifier ?? 0),
    );
    const requestedSpellSlot = parseString(body.spellSlot) || undefined;
    const reactionDecision = parseString(body.reactionDecision).toLowerCase();
    const shouldConsumeSpellSlot =
      kind === "cast-spell" ? (catalogEffect?.cost?.consumesSpellSlot ?? true) : false;
    const actorLevel = getCharacterLevel(
      actorCharacter?.sheetJson as Record<string, unknown> | null,
    );
    const scaledDamageDiceCount =
      kind === "cast-spell" &&
      adapterProfile === "dnd" &&
      catalogEffect?.cost?.cantripScaling === "dnd"
        ? getDndCantripDamageDiceCount(actorLevel)
        : damageDiceCount;
    const prevalidatedSpellSlotResult =
      kind === "cast-spell" && shouldConsumeSpellSlot && actorCharacter
        ? consumeSpellSlot(actorCharacter.sheetJson as Record<string, unknown> | null, requestedSpellSlot)
        : null;
    if (
      kind === "cast-spell" &&
      shouldConsumeSpellSlot &&
      prevalidatedSpellSlotResult &&
      !prevalidatedSpellSlotResult.ok
    ) {
      return NextResponse.json(
        { error: prevalidatedSpellSlotResult.reason ?? "No spell slots remaining." },
        { status: 400 },
      );
    }

    const isMagicMissile =
      kind === "cast-spell" &&
      catalogEffect?.id === "dnd_magic_missile" &&
      catalogEffect.delivery === "auto-hit";
    if (isMagicMissile) {
      const slotLevel = parseSpellSlotLevel(requestedSpellSlot);
      const missileCount = Math.max(1, slotLevel + 2); // 5e: 3 missiles at level 1, +1 per slot level.
      const magicMissileResult = resolveAutoHitAction(hydratedCombatState, {
        actor,
        target,
        profile: adapterProfile,
        damageDie: catalogEffect.damageDieOverride ?? 4,
        damageDiceCount: missileCount,
        damageBonus: missileCount * (catalogEffect.damageBonusModifier ?? 1),
        targetConSaveBonus: getAbilitySaveBonus(
          targetCharacter?.sheetJson as Record<string, unknown> | null,
          "con",
        ),
        seedInput: `${seedInput}|magic-missile|${slotLevel}`,
      });

      if (magicMissileResult.error || !magicMissileResult.resolution) {
        return NextResponse.json(
          { error: magicMissileResult.error ?? "Unable to resolve Magic Missile." },
          { status: 400 },
        );
      }

      let updatedCharacters = campaign.characters;
      const parsedTargetHpAfter = parseHpString(magicMissileResult.resolution.targetHpAfter);
      if (targetCharacter && parsedTargetHpAfter) {
        const currentSheet = asObject(targetCharacter.sheetJson) ?? {};
        const nextSheet = { ...currentSheet };
        if (adapterProfile === "deadlands" || asObject(currentSheet.wind)) {
          const currentWind = asObject(currentSheet.wind) ?? {};
          nextSheet.wind = {
            ...currentWind,
            current: parsedTargetHpAfter.current,
            max: parsedTargetHpAfter.max,
          };
        } else {
          const currentHp = asObject(currentSheet.hp) ?? {};
          nextSheet.hp = {
            ...currentHp,
            current: parsedTargetHpAfter.current,
            max: parsedTargetHpAfter.max,
          };
        }

        const savedCharacter = await prisma.character.update({
          where: { id: targetCharacter.id },
          data: {
            sheetJson: nextSheet,
          } as never,
          select: {
            id: true,
            name: true,
            sheetJson: true,
          },
        });

        updatedCharacters = updatedCharacters.map((character) =>
          character.id === savedCharacter.id
            ? {
                ...character,
                sheetJson: savedCharacter.sheetJson,
              }
            : character,
        );
      }

      if (actorCharacter) {
        const slotResult = prevalidatedSpellSlotResult;
        if (!slotResult || !slotResult.ok) {
          return NextResponse.json(
            { error: "Unable to consume spell slot." },
            { status: 400 },
          );
        }

        const savedCaster = await prisma.character.update({
          where: { id: actorCharacter.id },
          data: {
            sheetJson: slotResult.nextSheet,
          } as never,
          select: {
            id: true,
            name: true,
            sheetJson: true,
          },
        });

        updatedCharacters = updatedCharacters.map((character) =>
          character.id === savedCaster.id
            ? {
                ...character,
                sheetJson: savedCaster.sheetJson,
              }
            : character,
        );
      }

      await prisma.campaign.update({
        where: { id },
        data: {
          combatStateJson: magicMissileResult.state,
        } as never,
      });

      return NextResponse.json({
        combatStateJson: magicMissileResult.state,
        resolution: {
          ...magicMissileResult.resolution,
          spellName,
          catalogEffectId: catalogEffect.id,
          catalogEffectName: catalogEffect.name,
        },
        characters: updatedCharacters,
      });
    }

    const isFireballAoe =
      kind === "cast-spell" &&
      catalogEffect?.id === "dnd_fireball" &&
      catalogEffect.delivery === "save";
    if (isFireballAoe) {
      const requestedTargetRefs = Array.isArray(body.targetRefs)
        ? body.targetRefs
            .filter((value): value is string => typeof value === "string")
            .map((value) => value.trim())
            .filter(Boolean)
        : [];
      const targetRefs = [
        ...new Set([...(target ? [target] : []), ...requestedTargetRefs]),
      ];
      if (targetRefs.length === 0) {
        return NextResponse.json(
          { error: "Fireball requires at least one target." },
          { status: 400 },
        );
      }

      const saveAbility = catalogEffect.save?.ability;
      const saveDc =
        getSpellSaveDc(actorCharacter?.sheetJson as Record<string, unknown> | null) ??
        catalogEffect.save?.dc;
      if (!saveAbility || !saveDc) {
        return NextResponse.json(
          { error: "Unable to resolve Fireball save metadata." },
          { status: 400 },
        );
      }

      let workingState = hydratedCombatState;
      const aoeResolutions: Array<Record<string, unknown>> = [];

      for (const [index, targetRef] of targetRefs.entries()) {
        const loopTargetCharacter = findCharacterByRef(campaign.characters, targetRef);
        const loopSaveBonus = getAbilitySaveBonus(
          loopTargetCharacter?.sheetJson as Record<string, unknown> | null,
          saveAbility,
        );
        const loopResult = resolveSaveAction(workingState, {
          actor,
          target: targetRef,
          profile: adapterProfile,
          saveAbility,
          saveDc,
          saveBonus: loopSaveBonus,
          damageDie,
          damageDiceCount: scaledDamageDiceCount,
          damageBonus,
          targetConSaveBonus: getAbilitySaveBonus(
            loopTargetCharacter?.sheetJson as Record<string, unknown> | null,
            "con",
          ),
          onSave: catalogEffect.save?.onSave ?? "none",
          onFailedSaveTargetStatusEffects:
            catalogEffect.onFailedSaveTargetStatusEffects ?? [],
          advanceTurn: false,
          seedInput: `${seedInput}|aoe|${index}`,
        });

        if (loopResult.error || !loopResult.resolution) {
          return NextResponse.json(
            {
              error:
                loopResult.error ??
                `Unable to resolve Fireball target: ${targetRef}.`,
            },
            { status: 400 },
          );
        }

        const loopResolution = loopResult.resolution as { saveSucceeded?: boolean };
        const loopDurationPayload =
          !loopResolution.saveSucceeded &&
          Array.isArray(catalogEffect.onFailedSaveTargetStatusDurations)
            ? catalogEffect.onFailedSaveTargetStatusDurations
                .filter((entry) => entry.effect && Number.isFinite(entry.durationRounds))
                .map((entry) => ({
                  effect: entry.effect.trim(),
                  remainingRounds: Math.max(1, Math.trunc(entry.durationRounds)),
                  kind: entry.kind ?? "timed",
                  breakOnDamage: entry.breakOnDamage === true,
                }))
            : [];
        workingState =
          loopDurationPayload.length > 0
            ? applyStatusEffectsToCombatState(loopResult.state, targetRef, [], {
                durations: loopDurationPayload,
              })
            : loopResult.state;
        aoeResolutions.push({
          ...loopResult.resolution,
          targetRef,
        });
      }

      const advancedAoeState = advanceTurn(workingState);
      const concentrationStatusLabel =
        catalogEffect.concentration?.required && spellName
          ? buildConcentrationStatusLabel()
          : null;
      const concentrationDuration =
        catalogEffect.concentration?.required && spellName
          ? buildConcentrationDuration(
              spellName,
              catalogEffect.concentration.durationRounds,
              catalogEffect.concentration.breakOnDamage !== false,
            )
          : null;
      const stateWithConcentration =
        concentrationStatusLabel && actor
          ? applyStatusEffectsToCombatState(advancedAoeState, actor, [
              concentrationStatusLabel,
            ], {
              durations: concentrationDuration ? [concentrationDuration] : [],
              replaceConcentration: true,
            })
          : advancedAoeState;

      await prisma.campaign.update({
        where: { id },
        data: {
          combatStateJson: stateWithConcentration,
        } as never,
      });

      let updatedCharacters = campaign.characters;

      for (const resolutionEntry of aoeResolutions) {
        const loopTargetRef = parseString(resolutionEntry.targetRef);
        const loopTargetCharacter = findCharacterByRef(campaign.characters, loopTargetRef);
        if (!loopTargetCharacter) {
          continue;
        }

        const parsedHp = parseHpString(
          typeof resolutionEntry.targetHpAfter === "string"
            ? resolutionEntry.targetHpAfter
            : undefined,
        );
        const effectsApplied = Array.isArray(resolutionEntry.effectsApplied)
          ? resolutionEntry.effectsApplied.filter(
              (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
            )
          : [];
        if (!parsedHp && effectsApplied.length === 0) {
          continue;
        }

        const currentSheet = asObject(loopTargetCharacter.sheetJson) ?? {};
        const nextSheet = { ...currentSheet };

        if (adapterProfile === "deadlands" || asObject(currentSheet.wind)) {
          const currentWind = asObject(currentSheet.wind) ?? {};
          nextSheet.wind = {
            ...currentWind,
            current: parsedHp?.current ?? parseNumber(currentWind.current, 0),
            max: parsedHp?.max ?? parseNumber(currentWind.max, 1),
          };
        } else {
          const currentHp = asObject(currentSheet.hp) ?? {};
          if (parsedHp) {
            nextSheet.hp = {
              ...currentHp,
              current: parsedHp.current,
              max: parsedHp.max,
            };
          }
        }
        if (effectsApplied.length > 0) {
          nextSheet.statusEffects = mergeUniqueStatusEffects(
            nextSheet.statusEffects,
            effectsApplied,
          );
        }
        const combatEntry = getCombatEntryByRef(
          stateWithConcentration,
          loopTargetCharacter.id,
        );
        nextSheet.statusEffects = syncConcentrationStatusEffect(
          nextSheet.statusEffects,
          combatEntry?.statusEffects,
        );

        const savedCharacter = await prisma.character.update({
          where: { id: loopTargetCharacter.id },
          data: {
            sheetJson: nextSheet,
          } as never,
          select: {
            id: true,
            name: true,
            sheetJson: true,
          },
        });

        updatedCharacters = updatedCharacters.map((character) =>
          character.id === savedCharacter.id
            ? {
                ...character,
                sheetJson: savedCharacter.sheetJson,
              }
            : character,
        );
      }

      if (actorCharacter) {
        const slotResult = prevalidatedSpellSlotResult;
        if (!slotResult || !slotResult.ok) {
          return NextResponse.json(
            { error: "Unable to consume spell slot." },
            { status: 400 },
          );
        }

        const nextCasterSheet = asObject(slotResult.nextSheet) ?? {};
        if (concentrationStatusLabel) {
          const withoutConcentrating = syncConcentrationStatusEffect(
            nextCasterSheet.statusEffects,
            [],
          );
          nextCasterSheet.statusEffects = mergeUniqueStatusEffects(withoutConcentrating, [
            concentrationStatusLabel,
          ]);
        } else {
          const combatEntry = getCombatEntryByRef(
            stateWithConcentration,
            actorCharacter.id,
          );
          nextCasterSheet.statusEffects = syncConcentrationStatusEffect(
            nextCasterSheet.statusEffects,
            combatEntry?.statusEffects,
          );
        }

        const savedCaster = await prisma.character.update({
          where: { id: actorCharacter.id },
          data: {
            sheetJson: nextCasterSheet,
          } as never,
          select: {
            id: true,
            name: true,
            sheetJson: true,
          },
        });

        updatedCharacters = updatedCharacters.map((character) =>
          character.id === savedCaster.id
            ? {
                ...character,
                sheetJson: savedCaster.sheetJson,
              }
            : character,
        );
      }

      if (debugLoggingEnabled) {
        console.info("[combat] submit", {
          campaignId: id,
          ruleset: campaign.ruleset,
          adapterProfile,
          kind,
          actor,
          target,
          targetRefs,
          spellName,
          aoe: true,
          catalogEffect: {
            id: catalogEffect.id,
            name: catalogEffect.name,
            delivery: catalogEffect.delivery,
            save: catalogEffect.save,
            concentration: catalogEffect.concentration,
          },
          applied: {
            damageDie,
            damageDiceCount,
            damageBonus,
            saveAbility,
            saveDc,
          },
        });
      }

      return NextResponse.json({
        combatStateJson: stateWithConcentration,
        resolution: {
          kind: "cast-spell",
          delivery: "save",
          aoe: true,
          actor: actorEntry?.name ?? actor,
          spellName,
          catalogEffectId: catalogEffect.id,
          catalogEffectName: catalogEffect.name,
          catalogConcentration: catalogEffect.concentration ?? null,
          catalogReactionHooks: catalogEffect.reactionHooks ?? null,
          targets: aoeResolutions,
        },
        characters: updatedCharacters,
        adapterDebug: {
          ruleset: campaign.ruleset,
          profile: adapterProfile,
          kind,
          actor,
          target,
          targetRefs,
          spellName,
          aoe: true,
        },
      });
    }

    const saveAbility = catalogEffect?.save?.ability;
    const saveDc =
      (kind === "cast-spell" && saveAbility
        ? getSpellSaveDc(actorCharacter?.sheetJson as Record<string, unknown> | null) ??
          catalogEffect?.save?.dc
        : undefined) ?? undefined;
    const targetSaveBonus =
      kind === "cast-spell" && saveAbility
        ? getAbilitySaveBonus(
            targetCharacter?.sheetJson as Record<string, unknown> | null,
            saveAbility,
          )
        : undefined;
    const targetConSaveBonus = getAbilitySaveBonus(
      targetCharacter?.sheetJson as Record<string, unknown> | null,
      "con",
    );

    const isAttackDeliveryAction =
      kind === "attack" ||
      (kind === "cast-spell" &&
        (catalogEffect?.delivery === undefined || catalogEffect.delivery === "attack"));
    const targetReactionUsed =
      isAttackDeliveryAction &&
      isReactionUsedInCombatState(hydratedCombatState, target);
    const targetCanReactWithShield =
      isAttackDeliveryAction &&
      !targetReactionUsed &&
      targetHasShieldReaction(targetCharacter) &&
      targetHasAvailableSpellSlots(targetCharacter);
    const usingShieldReaction =
      isAttackDeliveryAction &&
      reactionDecision === "use-shield" &&
      targetCanReactWithShield;
    const shieldReactionSlotResult =
      usingShieldReaction && targetCharacter
        ? consumeSpellSlot(
            targetCharacter.sheetJson as Record<string, unknown> | null,
            undefined,
          )
        : null;
    if (usingShieldReaction && shieldReactionSlotResult && !shieldReactionSlotResult.ok) {
      return NextResponse.json(
        { error: shieldReactionSlotResult.reason ?? "No spell slots remaining for Shield." },
        { status: 400 },
      );
    }
    const stateForResolution = usingShieldReaction
      ? applyStatusEffectsToCombatState(hydratedCombatState, target, [
          "Reaction Used",
          "Shielded",
        ])
      : hydratedCombatState;
    const previewTargetAc = targetAc;
    const effectiveTargetAc =
      isAttackDeliveryAction &&
      targetCanReactWithShield &&
      reactionDecision === "use-shield"
        ? targetAc + 5
        : targetAc;
    const initialAttackResult = isAttackDeliveryAction
      ? resolveAttackAction(hydratedCombatState, {
          actor,
          target,
          profile: adapterProfile,
          attackDie,
          attackBonus,
          targetAc: previewTargetAc,
          damageDie,
          damageDiceCount: scaledDamageDiceCount,
          damageBonus,
          seedInput,
        })
      : null;
    if (
      isAttackDeliveryAction &&
      initialAttackResult?.resolution &&
      !initialAttackResult.error &&
      targetCanReactWithShield &&
      (initialAttackResult.resolution as { hit?: boolean }).hit &&
      reactionDecision !== "use-shield" &&
      reactionDecision !== "decline"
    ) {
      return NextResponse.json({
        requiresReaction: true,
        reactionPrompt: {
          targetRef: targetCharacter?.id ?? target,
          targetName: targetCharacter?.name ?? target,
          options: ["use-shield", "decline"],
          detail: "Shield can be used to add +5 AC against this triggering attack.",
        },
        previewResolution: initialAttackResult.resolution,
      });
    }

    const result =
      kind === "cast-spell" && catalogEffect?.delivery === "save" && saveAbility && saveDc
        ? resolveSaveAction(stateForResolution, {
            actor,
            target,
            profile: adapterProfile,
            saveAbility,
            saveDc,
            saveBonus: targetSaveBonus,
            damageDie,
            damageDiceCount: scaledDamageDiceCount,
            damageBonus,
            targetConSaveBonus,
            onSave: catalogEffect.save?.onSave ?? "none",
            onFailedSaveTargetStatusEffects:
              catalogEffect.onFailedSaveTargetStatusEffects ?? [],
            seedInput,
          })
        : isAttackDeliveryAction
        ? resolveAttackAction(stateForResolution, {
            actor,
            target,
            profile: adapterProfile,
            attackDie,
            attackBonus,
            targetAc: effectiveTargetAc,
            damageDie,
            damageDiceCount: scaledDamageDiceCount,
            damageBonus,
            targetConSaveBonus,
            seedInput,
          })
        : resolveUtilityAction(hydratedCombatState, {
            actor,
            kind: kind as
              | "defend"
              | "pass"
              | "help"
              | "disengage"
              | "dash"
              | "take-cover"
              | "aim"
              | "surrender"
              | "attempt-escape",
            profile: adapterProfile,
            seedInput,
          });

    if (result.error || !result.resolution) {
      return NextResponse.json(
        { error: result.error ?? "Unable to resolve action." },
        { status: 400 },
      );
    }

    const attackResolution =
      kind === "attack" || kind === "cast-spell"
        ? (result.resolution as {
            targetHpAfter?: string;
            hit?: boolean;
            delivery?: "attack" | "save";
            saveSucceeded?: boolean;
            targetWoundsAfter?: number;
            targetWoundLocation?:
              | "head"
              | "guts"
              | "leftArm"
              | "rightArm"
              | "leftLeg"
              | "rightLeg";
            targetWoundLocationAfter?: number;
            targetIncapacitated?: boolean;
          })
        : null;
    const catalogStatusEffects =
      catalogEffect?.delivery === "save"
        ? !attackResolution?.saveSucceeded && catalogEffect?.onFailedSaveTargetStatusEffects
          ? catalogEffect.onFailedSaveTargetStatusEffects
          : []
        : attackResolution?.hit && catalogEffect?.onHitTargetStatusEffects
          ? catalogEffect.onHitTargetStatusEffects
          : [];
    const catalogStatusDurations: CombatStatusDuration[] =
      catalogEffect?.delivery === "save"
        ? !attackResolution?.saveSucceeded &&
          Array.isArray(catalogEffect?.onFailedSaveTargetStatusDurations)
          ? catalogEffect.onFailedSaveTargetStatusDurations
              .filter((entry) => entry.effect && Number.isFinite(entry.durationRounds))
              .map((entry) => ({
                effect: entry.effect.trim(),
                remainingRounds: Math.max(1, Math.trunc(entry.durationRounds)),
                kind: entry.kind ?? "timed",
                breakOnDamage: entry.breakOnDamage === true,
              }))
          : []
        : attackResolution?.hit && Array.isArray(catalogEffect?.onHitTargetStatusDurations)
          ? catalogEffect.onHitTargetStatusDurations
              .filter((entry) => entry.effect && Number.isFinite(entry.durationRounds))
              .map((entry) => ({
                effect: entry.effect.trim(),
                remainingRounds: Math.max(1, Math.trunc(entry.durationRounds)),
                kind: entry.kind ?? "timed",
                breakOnDamage: entry.breakOnDamage === true,
              }))
          : [];
    const hookSuccess =
      catalogEffect?.delivery === "save"
        ? !attackResolution?.saveSucceeded
        : attackResolution?.hit ?? false;
    const advantageHookStatusEffects =
      hookSuccess && catalogEffect?.advantageHooks?.targetGrantsAdvantageToAttackers
        ? ["Grant Advantage"]
        : [];
    const actorAdvantageHookStatusEffects =
      hookSuccess && catalogEffect?.advantageHooks?.actorGainsAdvantageOnNextAttack
        ? ["Advantage Next Attack"]
        : [];
    const concentrationStatusLabel =
      kind === "cast-spell" &&
      catalogEffect?.concentration?.required &&
      spellName
        ? buildConcentrationStatusLabel()
        : null;
    const concentrationDuration =
      kind === "cast-spell" &&
      catalogEffect?.concentration?.required &&
      spellName
        ? buildConcentrationDuration(
            spellName,
            catalogEffect.concentration.durationRounds,
            catalogEffect.concentration.breakOnDamage !== false,
          )
        : null;
    const stateWithTargetHookEffects =
      target && [...catalogStatusEffects, ...advantageHookStatusEffects].length > 0
        ? applyStatusEffectsToCombatState(result.state, target, [
            ...catalogStatusEffects,
            ...advantageHookStatusEffects,
          ], {
            durations: catalogStatusDurations,
          })
        : result.state;
    const stateWithCatalogEffects =
      actor && actorAdvantageHookStatusEffects.length > 0
        ? applyStatusEffectsToCombatState(stateWithTargetHookEffects, actor, [
            ...actorAdvantageHookStatusEffects,
          ])
        : stateWithTargetHookEffects;
    const stateWithConcentration =
      concentrationStatusLabel && actor
        ? applyStatusEffectsToCombatState(stateWithCatalogEffects, actor, [
            concentrationStatusLabel,
          ], {
            durations: concentrationDuration ? [concentrationDuration] : [],
            replaceConcentration: true,
          })
        : stateWithCatalogEffects;
    const parsedTargetHpAfter = parseHpString(attackResolution?.targetHpAfter);
    const reactionWindows = buildReactionWindows({
      kind,
      resolution: (result.resolution as Record<string, unknown>) ?? {},
      targetRef: target,
      targetName: targetCharacter?.name ?? target,
      targetCharacter,
      targetReactionUsed:
        usingShieldReaction ||
        isReactionUsedInCombatState(stateWithConcentration, target),
      catalogReactionHooks: catalogEffect?.reactionHooks ?? null,
    });
    let updatedCharacters = campaign.characters;

    await prisma.campaign.update({
      where: { id },
      data: {
        combatStateJson: stateWithConcentration,
      } as never,
    });

    if (
      targetCharacter &&
      (parsedTargetHpAfter || (usingShieldReaction && shieldReactionSlotResult?.ok))
    ) {
      const currentSheet =
        usingShieldReaction && shieldReactionSlotResult?.ok
          ? asObject(shieldReactionSlotResult.nextSheet) ?? {}
          : asObject(targetCharacter.sheetJson) ?? {};
      const nextSheet = { ...currentSheet };

      if (adapterProfile === "deadlands" || asObject(currentSheet.wind)) {
        const currentWind = asObject(currentSheet.wind) ?? {};
        nextSheet.wind = {
          ...currentWind,
          current: parsedTargetHpAfter.current,
          max: parsedTargetHpAfter.max,
        };

        if (typeof attackResolution?.targetWoundsAfter === "number") {
          const woundValue = Math.max(0, Math.min(4, Math.trunc(attackResolution.targetWoundsAfter)));
          const currentWounds = asObject(currentSheet.wounds) ?? {};
          nextSheet.wounds = {
            ...currentWounds,
            current: woundValue,
            max: 4,
            threshold: 4,
            level: toDeadlandsWoundLevel(woundValue),
            penalty: Math.min(0, -woundValue),
          };

          const currentLocations = asObject(currentSheet.woundsByLocation) ?? {};
          const nextLocations = {
            head: parseNumber(currentLocations.head, 0),
            guts: parseNumber(currentLocations.guts, 0),
            leftArm: parseNumber(currentLocations.leftArm, 0),
            rightArm: parseNumber(currentLocations.rightArm, 0),
            leftLeg: parseNumber(currentLocations.leftLeg, 0),
            rightLeg: parseNumber(currentLocations.rightLeg, 0),
          };

          if (
            attackResolution.targetWoundLocation &&
            typeof attackResolution.targetWoundLocationAfter === "number"
          ) {
            nextLocations[attackResolution.targetWoundLocation] = Math.max(
              0,
              Math.min(4, Math.trunc(attackResolution.targetWoundLocationAfter)),
            );
          }

          nextSheet.woundsByLocation = nextLocations;
          nextSheet.woundShorthand = `H${nextLocations.head} G${nextLocations.guts} LA${nextLocations.leftArm} RA${nextLocations.rightArm} LL${nextLocations.leftLeg} RL${nextLocations.rightLeg}`;

          const existingStatusEffects = Array.isArray(nextSheet.statusEffects)
            ? nextSheet.statusEffects.filter(
                (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
              )
            : [];
          const withoutIncapacitated = existingStatusEffects.filter(
            (entry) => entry.toLowerCase() !== "incapacitated",
          );
          nextSheet.statusEffects = attackResolution.targetIncapacitated
            ? [...withoutIncapacitated, "Incapacitated"]
            : withoutIncapacitated;
        }
      } else {
        const currentHp = asObject(currentSheet.hp) ?? {};
        if (parsedTargetHpAfter) {
          nextSheet.hp = {
            ...currentHp,
            current: parsedTargetHpAfter.current,
            max: parsedTargetHpAfter.max,
          };
        }
      }
      if ([...catalogStatusEffects, ...advantageHookStatusEffects].length > 0) {
        nextSheet.statusEffects = mergeUniqueStatusEffects(
          nextSheet.statusEffects,
          [...catalogStatusEffects, ...advantageHookStatusEffects],
        );
      }
      const targetCombatEntry = getCombatEntryByRef(
        stateWithConcentration,
        targetCharacter.id,
      );
      nextSheet.statusEffects = syncConcentrationStatusEffect(
        nextSheet.statusEffects,
        targetCombatEntry?.statusEffects,
      );

      const savedCharacter = await prisma.character.update({
        where: { id: targetCharacter.id },
        data: {
          sheetJson: nextSheet,
        } as never,
        select: {
          id: true,
          name: true,
          sheetJson: true,
        },
      });

      updatedCharacters = campaign.characters.map((character) =>
        character.id === savedCharacter.id
          ? {
              ...character,
              sheetJson: savedCharacter.sheetJson,
            }
          : character,
      );
    }

    const shouldUpdateCasterSheet =
      kind === "cast-spell" &&
      actorCharacter &&
      (shouldConsumeSpellSlot ||
        Boolean(concentrationStatusLabel) ||
        actorAdvantageHookStatusEffects.length > 0);
    if (shouldUpdateCasterSheet && actorCharacter) {
      const slotResult = prevalidatedSpellSlotResult;
      if (shouldConsumeSpellSlot && (!slotResult || !slotResult.ok)) {
        return NextResponse.json(
          { error: "Unable to consume spell slot." },
          { status: 400 },
        );
      }

      const casterBaseSheet =
        shouldConsumeSpellSlot && slotResult?.ok
          ? (asObject(slotResult.nextSheet) ?? {})
          : (asObject(actorCharacter.sheetJson) ?? {});
      const nextCasterSheet = { ...casterBaseSheet };
      const casterStatusAdditions = [
        ...(concentrationStatusLabel ? [concentrationStatusLabel] : []),
        ...actorAdvantageHookStatusEffects,
      ];
      if (casterStatusAdditions.length > 0) {
        nextCasterSheet.statusEffects = mergeUniqueStatusEffects(
          nextCasterSheet.statusEffects,
          casterStatusAdditions,
        );
      }
      const actorCombatEntry = getCombatEntryByRef(
        stateWithConcentration,
        actorCharacter.id,
      );
      nextCasterSheet.statusEffects = syncConcentrationStatusEffect(
        nextCasterSheet.statusEffects,
        actorCombatEntry?.statusEffects,
      );

      const savedCaster = await prisma.character.update({
        where: { id: actorCharacter.id },
        data: {
          sheetJson: nextCasterSheet,
        } as never,
        select: {
          id: true,
          name: true,
          sheetJson: true,
        },
      });

      updatedCharacters = updatedCharacters.map((character) =>
        character.id === savedCaster.id
          ? {
              ...character,
              sheetJson: savedCaster.sheetJson,
            }
          : character,
      );
    }

    if (debugLoggingEnabled) {
      console.info("[combat] submit", {
        campaignId: id,
        ruleset: campaign.ruleset,
        adapterProfile,
        kind,
        actor,
        target,
        spellName,
        catalogEffect: catalogEffect
          ? {
              id: catalogEffect.id,
              name: catalogEffect.name,
              delivery: catalogEffect.delivery,
              save: catalogEffect.save,
              concentration: catalogEffect.concentration,
              advantageHooks: catalogEffect.advantageHooks,
              reactionHooks: catalogEffect.reactionHooks,
              onHitTargetStatusEffects: catalogEffect.onHitTargetStatusEffects,
              onFailedSaveTargetStatusEffects: catalogEffect.onFailedSaveTargetStatusEffects,
            }
          : null,
        defaults,
        applied: {
          attackDie,
          attackBonus,
          targetAc,
          damageDie,
          damageDiceCount: scaledDamageDiceCount,
          damageBonus,
          saveAbility,
          saveDc,
          targetSaveBonus,
          reactionWindows,
        },
      });
    }

    return NextResponse.json({
      combatStateJson: stateWithConcentration,
      resolution:
        kind === "attack" || kind === "cast-spell"
          ? {
              ...result.resolution,
              effectsApplied: [...catalogStatusEffects, ...advantageHookStatusEffects],
              actorEffectsApplied: [...actorAdvantageHookStatusEffects],
              catalogEffectId: catalogEffect?.id ?? null,
              catalogEffectName: catalogEffect?.name ?? null,
              catalogDelivery: catalogEffect?.delivery ?? null,
              catalogSave: catalogEffect?.save ?? null,
              catalogConcentration: catalogEffect?.concentration ?? null,
              catalogAdvantageHooks: catalogEffect?.advantageHooks ?? null,
              catalogReactionHooks: catalogEffect?.reactionHooks ?? null,
              reactionWindows,
              reactionDecision:
                reactionDecision === "use-shield" || reactionDecision === "decline"
                  ? reactionDecision
                  : null,
            }
          : result.resolution,
      characters: updatedCharacters,
      adapterDebug: {
        ruleset: campaign.ruleset,
        profile: adapterProfile,
        kind,
        actor,
        target,
        spellName,
        defaultProfileContext: {
          actorType,
          targetType: targetCharacter ? "character" : "enemy",
          actorLevel: getCharacterLevel(
            actorCharacter?.sheetJson as Record<string, unknown> | null,
          ),
          targetLevel: getCharacterLevel(
            targetCharacter?.sheetJson as Record<string, unknown> | null,
          ),
        },
        catalogEffect: catalogEffect
          ? {
              id: catalogEffect.id,
              name: catalogEffect.name,
              delivery: catalogEffect.delivery,
              save: catalogEffect.save,
              concentration: catalogEffect.concentration,
              advantageHooks: catalogEffect.advantageHooks,
              reactionHooks: catalogEffect.reactionHooks,
              onHitTargetStatusEffects: catalogEffect.onHitTargetStatusEffects,
              onFailedSaveTargetStatusEffects: catalogEffect.onFailedSaveTargetStatusEffects,
            }
          : null,
        defaults,
        applied: {
          attackDie,
          attackBonus,
          targetAc: effectiveTargetAc,
          damageDie,
          damageDiceCount,
          damageBonus,
          saveAbility,
          saveDc,
          targetSaveBonus,
          reactionWindows,
        },
      },
    });
  }

  if (action === "advance-turn") {
    const nextState = advanceTurn(currentCombatState);

    await prisma.campaign.update({
      where: { id },
      data: {
        combatStateJson: nextState,
      } as never,
    });

    return NextResponse.json({
      combatStateJson: nextState,
    });
  }

  if (action === "end") {
    await prisma.campaign.update({
      where: { id },
      data: {
        combatStateJson: DEFAULT_COMBAT_STATE,
      } as never,
    });

    return NextResponse.json({
      combatStateJson: DEFAULT_COMBAT_STATE,
    });
  }

  return NextResponse.json({ error: "Unsupported combat action." }, { status: 400 });
}
