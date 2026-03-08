import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  applyCombatUpdate,
  DEFAULT_COMBAT_STATE,
  extractCombatBlock,
  normalizeCombatState,
} from "@/lib/combat";
import {
  applyPartyUpdate,
  buildInitialPartyState,
  extractPartyBlock,
  normalizePartyState,
  type PartyState,
} from "@/lib/party";
import { generateCampaignRecap } from "@/lib/recap";
import { stripSceneBlock } from "@/lib/scene";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type CharacterUpdateInstruction = {
  name: string;
  sheet?: Record<string, unknown>;
};

const EFFECT_ARRAY_KEYS = [
  "statusEffects",
  "temporaryBuffs",
  "temporaryDebuffs",
] as const;

type EffectKind = "status" | "buff" | "debuff";

function getEffectKind(label: string): EffectKind {
  switch (label) {
    case "Blessed":
    case "Hasted":
    case "Inspired":
    case "Invisible":
    case "Shielded":
      return "buff";
    case "Frightened":
    case "Slowed":
      return "debuff";
    default:
      return "status";
  }
}

function normalizeEffectLabel(value: string) {
  const cleanedValue = value.replace(/[*_`]/g, " ").replace(/\s+/g, " ").trim();
  const normalized = cleanedValue.toLowerCase();

  if (!normalized) {
    return "";
  }

  if (/(^|\b)(bless|blessed|blessing)(\b|$)/.test(normalized)) {
    return "Blessed";
  }

  if (/(^|\b)(haste|hasted)(\b|$)/.test(normalized)) {
    return "Hasted";
  }

  if (/(^|\b)(inspire|inspired|inspiration)(\b|$)/.test(normalized)) {
    return "Inspired";
  }

  if (/(^|\b)(invisible|invisibility|vanished|hidden from sight)(\b|$)/.test(normalized)) {
    return "Invisible";
  }

  if (/(^|\b)(shielded|warded|protected|shield of faith)(\b|$)/.test(normalized)) {
    return "Shielded";
  }

  if (/(^|\b)(poison|poisoned)(\b|$)/.test(normalized)) {
    return "Poisoned";
  }

  if (/(^|\b)(fear|frightened|terrified)(\b|$)/.test(normalized)) {
    return "Frightened";
  }

  if (/(^|\b)(stun|stunned|dazed)(\b|$)/.test(normalized)) {
    return "Stunned";
  }

  if (/(^|\b)(prone|knocked down)(\b|$)/.test(normalized)) {
    return "Prone";
  }

  if (/(^|\b)(grapple|grappled|held fast)(\b|$)/.test(normalized)) {
    return "Grappled";
  }

  if (/(^|\b)(restrain|restrained|pinned)(\b|$)/.test(normalized)) {
    return "Restrained";
  }

  if (/(^|\b)(charm|charmed|entranced)(\b|$)/.test(normalized)) {
    return "Charmed";
  }

  if (/(^|\b)(burning|on fire|aflame|set on fire|catches fire)(\b|$)/.test(normalized)) {
    return "Burning";
  }

  if (/(^|\b)(slow|slowed)(\b|$)/.test(normalized)) {
    return "Slowed";
  }

  if (/(^|\b)(blind|blinded)(\b|$)/.test(normalized)) {
    return "Blinded";
  }

  if (/(^|\b)(deaf|deafened)(\b|$)/.test(normalized)) {
    return "Deafened";
  }

  if (/(^|\b)(petrified|turned to stone)(\b|$)/.test(normalized)) {
    return "Petrified";
  }

  if (/(^|\b)(incapacitated|staggered|unable to act)(\b|$)/.test(normalized)) {
    return "Incapacitated";
  }

  if (/(^|\b)(exhausted|exhaustion|fatigued)(\b|$)/.test(normalized)) {
    return "Exhausted";
  }

  return cleanedValue;
}

function normalizeEffectList(value: unknown) {
  const entries = Array.isArray(value) ? value : [value];

  return [
    ...new Set(
      entries
        .filter(
          (entry): entry is string =>
            typeof entry === "string" && entry.trim().length > 0,
        )
        .map((entry) => normalizeEffectLabel(entry))
        .filter(Boolean),
    ),
  ];
}

function parseBoundedInteger(value: unknown, min: number, max: number) {
  const numericValue =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim().length > 0
        ? Number(value)
        : null;

  if (numericValue === null || !Number.isFinite(numericValue)) {
    return null;
  }

  return Math.max(min, Math.min(max, Math.trunc(numericValue)));
}

function parseFateChipShorthand(
  value: unknown,
): { white: number; red: number; blue: number; legend: number } | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const match = value
    .trim()
    .match(/\bW\s*(\d+)\s+R\s*(\d+)\s+B\s*(\d+)\s+L\s*(\d+)\b/i);
  if (!match) {
    return null;
  }

  return {
    white: Math.max(0, Math.min(10, Number(match[1]))),
    red: Math.max(0, Math.min(10, Number(match[2]))),
    blue: Math.max(0, Math.min(10, Number(match[3]))),
    legend: Math.max(0, Math.min(10, Number(match[4]))),
  };
}

function isLikelyDeadlandsSheet(sheet: Record<string, unknown>) {
  return (
    "woundsByLocation" in sheet ||
    "fateChips" in sheet ||
    "fateChipShorthand" in sheet ||
    "woundShorthand" in sheet ||
    "grit" in sheet ||
    "longarm" in sheet ||
    (typeof sheet.archetype === "string" && sheet.archetype.trim().length > 0)
  );
}

function normalizeDeadlandsStateFields(sheet: Record<string, unknown>) {
  if (!isLikelyDeadlandsSheet(sheet)) {
    return sheet;
  }

  const normalizedSheet = { ...sheet };
  const hpValue =
    normalizedSheet.hp &&
    typeof normalizedSheet.hp === "object" &&
    !Array.isArray(normalizedSheet.hp)
      ? (normalizedSheet.hp as Record<string, unknown>)
      : null;
  const hpCurrent = parseBoundedInteger(hpValue?.current, 0, 999);
  const hpMax = parseBoundedInteger(hpValue?.max, 0, 999);

  const rawWind = normalizedSheet.wind;
  if (rawWind && typeof rawWind === "object" && !Array.isArray(rawWind)) {
    const typedWind = rawWind as Record<string, unknown>;
    const current = parseBoundedInteger(typedWind.current, 0, 999);
    const max = parseBoundedInteger(typedWind.max, 0, 999);
    if (current !== null || max !== null) {
      const safeMax = max ?? current ?? 0;
      normalizedSheet.wind = {
        current: Math.max(0, Math.min(safeMax, current ?? safeMax)),
        max: safeMax,
      };
    }
  } else {
    const numericWind = parseBoundedInteger(rawWind, 0, 999);
    if (numericWind !== null) {
      normalizedSheet.wind = {
        current: numericWind,
        max: numericWind,
      };
    } else if (hpCurrent !== null || hpMax !== null) {
      const fallbackMax = hpMax ?? hpCurrent ?? 0;
      normalizedSheet.wind = {
        current: hpCurrent ?? fallbackMax,
        max: fallbackMax,
      };
    }
  }
  delete normalizedSheet.hp;

  const typedWounds =
    normalizedSheet.wounds &&
    typeof normalizedSheet.wounds === "object" &&
    !Array.isArray(normalizedSheet.wounds)
      ? (normalizedSheet.wounds as Record<string, unknown>)
      : {};
  const rawLocations =
    normalizedSheet.woundsByLocation &&
    typeof normalizedSheet.woundsByLocation === "object" &&
    !Array.isArray(normalizedSheet.woundsByLocation)
      ? (normalizedSheet.woundsByLocation as Record<string, unknown>)
      : null;
  const legacyCurrent = parseBoundedInteger(typedWounds.current, 0, 4);
  const hasLocationData =
    rawLocations !== null ||
    legacyCurrent !== null ||
    typeof normalizedSheet.woundShorthand === "string";
  if (hasLocationData) {
    const head = parseBoundedInteger(rawLocations?.head, 0, 4) ?? 0;
    const guts = parseBoundedInteger(rawLocations?.guts, 0, 4) ?? legacyCurrent ?? 0;
    const leftArm = parseBoundedInteger(rawLocations?.leftArm, 0, 4) ?? 0;
    const rightArm = parseBoundedInteger(rawLocations?.rightArm, 0, 4) ?? 0;
    const leftLeg = parseBoundedInteger(rawLocations?.leftLeg, 0, 4) ?? 0;
    const rightLeg = parseBoundedInteger(rawLocations?.rightLeg, 0, 4) ?? 0;
    const highest = Math.max(head, guts, leftArm, rightArm, leftLeg, rightLeg);
    const total = head + guts + leftArm + rightArm + leftLeg + rightLeg;
    const woundLevelByValue = ["Unharmed", "Light", "Heavy", "Serious", "Critical"] as const;
    const ignoreSource =
      typeof typedWounds.ignoreSource === "string"
        ? typedWounds.ignoreSource
        : typeof normalizedSheet.woundIgnore === "string"
          ? normalizedSheet.woundIgnore
          : "None";
    const ignoreReduction =
      ignoreSource === "Nerves o' Steel" || ignoreSource === "Veteran Resolve" ? 1 : 0;

    normalizedSheet.woundsByLocation = {
      head,
      guts,
      leftArm,
      rightArm,
      leftLeg,
      rightLeg,
    };
    normalizedSheet.woundShorthand = `H${head} G${guts} LA${leftArm} RA${rightArm} LL${leftLeg} RL${rightLeg}`;
    normalizedSheet.wounds = {
      ...typedWounds,
      current: highest,
      max: 4,
      threshold: 4,
      level: woundLevelByValue[highest] ?? "Critical",
      penalty: Math.min(0, ignoreReduction - highest),
      total,
      ignoreSource,
    };
  }

  const shorthandFate = parseFateChipShorthand(normalizedSheet.fateChipShorthand);
  const rawFateChips =
    normalizedSheet.fateChips &&
    typeof normalizedSheet.fateChips === "object" &&
    !Array.isArray(normalizedSheet.fateChips)
      ? (normalizedSheet.fateChips as Record<string, unknown>)
      : null;
  const inferredWhite =
    parseBoundedInteger(rawFateChips?.white, 0, 10) ??
    parseBoundedInteger(normalizedSheet.fateWhite, 0, 10) ??
    shorthandFate?.white;
  const inferredRed =
    parseBoundedInteger(rawFateChips?.red, 0, 10) ??
    parseBoundedInteger(normalizedSheet.fateRed, 0, 10) ??
    shorthandFate?.red;
  const inferredBlue =
    parseBoundedInteger(rawFateChips?.blue, 0, 10) ??
    parseBoundedInteger(normalizedSheet.fateBlue, 0, 10) ??
    shorthandFate?.blue;
  const inferredLegend =
    parseBoundedInteger(rawFateChips?.legend, 0, 10) ??
    parseBoundedInteger(normalizedSheet.fateLegend, 0, 10) ??
    shorthandFate?.legend;

  if (
    inferredWhite !== undefined ||
    inferredRed !== undefined ||
    inferredBlue !== undefined ||
    inferredLegend !== undefined
  ) {
    const white = inferredWhite ?? 2;
    const red = inferredRed ?? 1;
    const blue = inferredBlue ?? 0;
    const legend = inferredLegend ?? 0;
    normalizedSheet.fateChips = { white, red, blue, legend };
    normalizedSheet.fateChipShorthand = `W${white} R${red} B${blue} L${legend}`;
    delete normalizedSheet.fateWhite;
    delete normalizedSheet.fateRed;
    delete normalizedSheet.fateBlue;
    delete normalizedSheet.fateLegend;
  }

  return normalizedSheet;
}

function normalizeSheetPatch(sheet: Record<string, unknown> | undefined) {
  if (!sheet) {
    return sheet;
  }

  const normalizedSheet: Record<string, unknown> = { ...sheet };
  const redistributedEffects: Record<(typeof EFFECT_ARRAY_KEYS)[number], string[]> = {
    statusEffects: [],
    temporaryBuffs: [],
    temporaryDebuffs: [],
  };

  for (const key of EFFECT_ARRAY_KEYS) {
    const normalizedList = normalizeEffectList(normalizedSheet[key]);

    for (const effect of normalizedList) {
      switch (getEffectKind(effect)) {
        case "buff":
          redistributedEffects.temporaryBuffs.push(effect);
          break;
        case "debuff":
          redistributedEffects.temporaryDebuffs.push(effect);
          break;
        default:
          redistributedEffects.statusEffects.push(effect);
          break;
      }
    }
  }

  for (const key of EFFECT_ARRAY_KEYS) {
    normalizedSheet[key] = [...new Set(redistributedEffects[key])];
  }

  return normalizeDeadlandsStateFields(normalizedSheet);
}

function mergeSheetData(currentValue: unknown, patchValue: unknown): unknown {
  if (
    !currentValue ||
    typeof currentValue !== "object" ||
    Array.isArray(currentValue) ||
    !patchValue ||
    typeof patchValue !== "object" ||
    Array.isArray(patchValue)
  ) {
    return patchValue;
  }

  const mergedEntries = new Map<string, unknown>(
    Object.entries(currentValue as Record<string, unknown>),
  );

  for (const [key, value] of Object.entries(patchValue as Record<string, unknown>)) {
    const existingValue = mergedEntries.get(key);
    mergedEntries.set(key, mergeSheetData(existingValue, value));
  }

  return Object.fromEntries(mergedEntries);
}

function extractStateBlock(text: string) {
  const normalized = text.replace(/\r\n/g, "\n");
  const inlineMatch = normalized.match(
    /[*_`>\-\s]*STATE:\s*([\s\S]*?)\s*[*_`>\-\s]*ENDSTATE/i,
  );

  if (!inlineMatch) {
    return {
      found: false,
      updates: [] as CharacterUpdateInstruction[],
      content: normalized.trim(),
    };
  }

  const blockText = inlineMatch[1].trim();
  let updates: CharacterUpdateInstruction[] = [];

  try {
    const parsed = JSON.parse(blockText);
    if (Array.isArray(parsed)) {
      updates = parsed
        .filter(
          (entry) =>
            entry &&
            typeof entry === "object" &&
            !Array.isArray(entry) &&
            typeof (entry as { name?: unknown }).name === "string",
        )
        .map((entry) => {
          const typedEntry = entry as {
            name: string;
            sheet?: unknown;
          };

          return {
            name: typedEntry.name.trim(),
            sheet: normalizeSheetPatch(
              typedEntry.sheet &&
                typeof typedEntry.sheet === "object" &&
                !Array.isArray(typedEntry.sheet)
                ? (typedEntry.sheet as Record<string, unknown>)
                : undefined,
            ),
          };
        })
        .filter((entry) => entry.name);
    }
  } catch {
    updates = [];
  }

  return {
    found: true,
    updates,
    content: normalized
      .replace(inlineMatch[0], "")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  };
}

function resetTransientEffectArrays(sheetJson: unknown) {
  const currentSheet =
    sheetJson && typeof sheetJson === "object" && !Array.isArray(sheetJson)
      ? (sheetJson as Record<string, unknown>)
      : {};

  return {
    ...currentSheet,
    statusEffects: [],
    temporaryBuffs: [],
    temporaryDebuffs: [],
  };
}

export async function POST(_req: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: {
      characters: {
        orderBy: [
          { isMainCharacter: "desc" },
          { id: "asc" },
        ],
      },
      messages: {
        orderBy: [
          { createdAt: "asc" },
          { id: "asc" },
        ],
        select: {
          id: true,
          role: true,
          speakerName: true,
          content: true,
          createdAt: true,
        },
      },
    },
  });

  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const lastUserIndex = [...campaign.messages]
    .reverse()
    .findIndex((message) => message.role === "user");

  if (lastUserIndex === -1) {
    return NextResponse.json(
      { error: "There is no player turn to undo." },
      { status: 400 },
    );
  }

  const resolvedLastUserIndex = campaign.messages.length - 1 - lastUserIndex;
  const survivingMessages = campaign.messages.slice(0, resolvedLastUserIndex);
  const deletedMessages = campaign.messages.slice(resolvedLastUserIndex);

  const rebuiltCharacters = campaign.characters.map((character) => ({
    ...character,
    sheetJson: resetTransientEffectArrays(character.sheetJson),
  }));

  let rebuiltPartyState: PartyState = {
    ...buildInitialPartyState(campaign.title),
    narrationLevel: normalizePartyState(
      (campaign as { partyStateJson?: unknown }).partyStateJson,
    ).narrationLevel,
  };
  let rebuiltCombatState = DEFAULT_COMBAT_STATE;

  for (const message of survivingMessages) {
    if (message.role === "user") {
      continue;
    }

    const stateExtract = extractStateBlock(message.content);
    const partyExtract = extractPartyBlock(stateExtract.content);
    const combatExtract = extractCombatBlock(partyExtract.content);
    const visibleContent = stripSceneBlock(combatExtract.content);

    if (partyExtract.found) {
      rebuiltPartyState = applyPartyUpdate(rebuiltPartyState, partyExtract.update);
    }

    if (combatExtract.found) {
      rebuiltCombatState = applyCombatUpdate(rebuiltCombatState, combatExtract.update);
    }

    if (!stateExtract.found || stateExtract.updates.length === 0) {
      void visibleContent;
      continue;
    }

    for (const update of stateExtract.updates) {
      const matchingCharacter = rebuiltCharacters.find(
        (character) => character.name.toLowerCase() === update.name.toLowerCase(),
      );

      if (!matchingCharacter || !update.sheet) {
        continue;
      }

      matchingCharacter.sheetJson = mergeSheetData(
        matchingCharacter.sheetJson,
        normalizeSheetPatch(update.sheet),
      );
    }
  }

  rebuiltPartyState = {
    ...rebuiltPartyState,
    recap: await generateCampaignRecap({
      campaignTitle: campaign.title,
      ruleset: campaign.ruleset,
      partyState: rebuiltPartyState,
      recentMessages: survivingMessages.map((message) => ({
        role: message.role,
        speakerName: message.speakerName,
        content: message.content,
      })),
    }),
  };

  const deletedMessageIds = deletedMessages.map((message) => message.id);
  if (deletedMessageIds.length > 0) {
    await prisma.message.deleteMany({
      where: {
        id: {
          in: deletedMessageIds,
        },
      },
    });
  }

  const updatedCharacters = await Promise.all(
    rebuiltCharacters.map((character) =>
      prisma.character.update({
        where: { id: character.id },
        data: {
          sheetJson: character.sheetJson,
        },
      }),
    ),
  );

  await prisma.campaign.update({
    where: { id },
    data: {
      partyStateJson: normalizePartyState(rebuiltPartyState),
      combatStateJson: normalizeCombatState(rebuiltCombatState),
    } as never,
  });

  return NextResponse.json({
    messages: survivingMessages.map((message) => ({
      id: message.id,
      role: message.role,
      speakerName: message.speakerName,
      content: message.content,
    })),
    characters: updatedCharacters,
    partyStateJson: normalizePartyState(rebuiltPartyState),
    combatStateJson: normalizeCombatState(rebuiltCombatState),
  });
}
