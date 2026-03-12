import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { openai } from "@/lib/openai";
import { deriveBehaviorDirectives, deriveBehaviorSummary } from "@/lib/campaigns";
import {
  applyCombatUpdate,
  extractCombatBlock,
  formatCombatBlock,
  formatCombatStateForPrompt,
  normalizeCombatState,
  type CombatState,
} from "@/lib/combat";
import { buildInitiativeState } from "@/lib/combat-engine";
import { formatCombatBoundaryForPrompt } from "@/lib/combat-contract";
import {
  extractSceneBlock,
  formatSceneBlock,
  stripSceneBlock,
  type SceneSummary,
} from "@/lib/scene";
import {
  applyPartyUpdate,
  extractPartyBlock,
  formatPartyBlock,
  formatPartyStateForPrompt,
  getNarrationLevelPromptInstruction,
  normalizePartyState,
  type PartyUpdateInstruction,
} from "@/lib/party";
import { generateCampaignRecap } from "@/lib/recap";
import { normalizeCampaignChatModel, type CampaignChatModel } from "@/lib/chat-model";
import {
  applyCampaignBootstrapTurnUpdate,
  extractCampaignBootstrapBlock,
  formatCampaignBootstrapBlock,
  normalizeCampaignBootstrapTurnUpdate,
  type CampaignBootstrapTurnUpdate,
} from "@/lib/campaign-bootstrap-reducer";
import {
  buildInitialCampaignBootstrap,
  formatCampaignBootstrapForPrompt,
  normalizeCampaignBootstrap,
  projectCampaignBootstrapForPlayer,
} from "@/lib/campaign-bootstrap";
import {
  resolveBootstrapTurnPolicy,
  withBootstrapNoProgressStreak,
} from "@/lib/bootstrap-loop-breaker";

function truncatePromptText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3).trim()}...`;
}

type CharacterUpdateInstruction = {
  name: string;
  sheet?: Record<string, unknown>;
  memorySummary?: string;
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

  return [...new Set(
    entries
      .filter(
        (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
      )
      .map((entry) => normalizeEffectLabel(entry))
      .filter(Boolean),
  )];
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

function buildEffectPatch(label: string): Record<string, unknown> {
  const normalizedLabel = normalizeEffectLabel(label);

  if (!normalizedLabel) {
    return {};
  }

  switch (getEffectKind(normalizedLabel)) {
    case "buff":
      return { temporaryBuffs: [normalizedLabel] };
    case "debuff":
      return { temporaryDebuffs: [normalizedLabel] };
    default:
      return { statusEffects: [normalizedLabel] };
  }
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
            memorySummary?: unknown;
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
              memorySummary:
                typeof typedEntry.memorySummary === "string"
                  ? typedEntry.memorySummary.trim()
                : undefined,
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

function formatStateBlock(updates: CharacterUpdateInstruction[]) {
  return `STATE: ${JSON.stringify(updates)} ENDSTATE`;
}

function narrationSuggestsTrackedStateChange(text: string) {
  return /\b(hp|wind|wounds?|fate\s*chips?|sanity|hunger|strain|ammo|spell slots?|pact slots?|poisoned|stunned|slowed|blessed|hasted|inspired|invisible|shielded|frightened|prone|grappled|restrained|charmed|burning|blinded|deafened|petrified|incapacitated|exhausted)\b/i.test(
    text,
  );
}

async function extractStructuredStateFromNarration(
  narrationText: string,
  characterSummary: string,
  chatModel: CampaignChatModel,
) {
  const response = await openai.responses.create({
    model: chatModel,
    input: [
      {
        role: "system",
        content: [
          "You extract character sheet updates from RPG narration.",
          "Return only a valid hidden state block in this exact format:",
          "STATE: [...] ENDSTATE",
          "Use exact existing character names only.",
          "If no tracked character state changed, return STATE: [] ENDSTATE.",
          "Only include concrete tracked changes supported by the narration.",
          "Tracked changes include hp.current, wind.current/max, wounds.current or woundsByLocation, fateChips, sanity, hunger, strain, ammo, spellSlots, statusEffects, temporaryBuffs, and temporaryDebuffs.",
          "When narration is Deadlands-style, prefer wind.current/max, woundsByLocation {head,guts,leftArm,rightArm,leftLeg,rightLeg}, woundShorthand, and fateChips {white,red,blue,legend}.",
          "Use canonical effect labels such as Blessed, Hasted, Inspired, Invisible, Shielded, Poisoned, Stunned, Prone, Grappled, Restrained, Charmed, Burning, Frightened, Slowed, Blinded, Deafened, Petrified, Incapacitated, and Exhausted.",
          "Do not invent changes that are not directly supported by the narration.",
        ].join(" "),
      },
      {
        role: "user",
        content: [
          "Characters:",
          characterSummary,
          "",
          "Narration to extract from:",
          narrationText,
        ].join("\n"),
      },
    ],
  });

  const text = response.output_text ?? "STATE: [] ENDSTATE";
  return extractStateBlock(text);
}

function inferExactNamedEffectsFromNarration(
  narrationText: string,
  characters: Array<{ name: string }>,
) {
  const updates: CharacterUpdateInstruction[] = [];

  const pushEffect = (name: string, patch: Record<string, unknown>) => {
    const existing = updates.find(
      (update) => update.name.toLowerCase() === name.toLowerCase(),
    );

    if (existing) {
      existing.sheet = mergeSheetData(existing.sheet, patch) as Record<string, unknown>;
      return;
    }

    updates.push({
      name,
      sheet: patch,
    });
  };

  for (const character of characters) {
    const escapedName = character.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const snippets = Array.from(
      narrationText.matchAll(
        new RegExp(`${escapedName}(?:['â€™]s)?[\\s\\S]{0,260}`, "gi"),
      ),
    ).map((match) =>
      match[0].replace(/[*_`]/g, " ").replace(/\s+/g, " ").trim(),
    );

    for (const snippet of snippets) {
      const lowerSnippet = snippet.toLowerCase();
      const hasApplicationSignal =
        /\b(?:fails?|failed|latches|takes hold|is now|becomes|remains|under the effects|affected by|sluggish|stunned|poisoned|blessed|hasted|frightened|prone|grappled|restrained|charmed|burning|blinded|deafened|petrified|incapacitated|exhausted)\b/i.test(
          snippet,
        );

      if (!hasApplicationSignal) {
        continue;
      }

      if (
        /\bslow(?:ed)?\b/i.test(snippet) &&
        !/\b(?:resists?|resisted|succeeds?|succeeded|avoids?|avoided|miss(?:es|ed)|not slowed|no slow)\b/i.test(
          snippet,
        )
      ) {
        pushEffect(character.name, buildEffectPatch("Slowed"));
      }

      if (
        /\bstun(?:ned)?\b/i.test(snippet) &&
        !/\b(?:resists?|resisted|succeeds?|succeeded|avoids?|avoided|not stunned|no stun)\b/i.test(
          snippet,
        )
      ) {
        pushEffect(character.name, buildEffectPatch("Stunned"));
      }

      if (
        /\bbless(?:ed|ing)?\b/i.test(snippet) &&
        !/\b(?:no bless|without bless|not blessed)\b/i.test(lowerSnippet)
      ) {
        pushEffect(character.name, buildEffectPatch("Blessed"));
      }
    }
  }

  return updates;
}

async function requestStructuredGmResponse(input: Array<{
  role: "system" | "user";
  content: string;
}>, characterSummary: string, characters: Array<{ name: string }>, chatModel: CampaignChatModel, options?: {
  lowLatency?: boolean;
}) {
  const canonicalizeStructuredMarkers = (rawText: string) =>
    rawText
      .replace(/(^|\n)\s*S+C+E+N+E+\s*:/gi, "$1SCENE:")
      .replace(/(^|\n)\s*E+N+D+S*C+E+N+E+\b/gi, "$1ENDSCENE")
      .replace(/(^|\n)\s*E+N+D+S*C+E+E+N+E+\b/gi, "$1ENDSCENE");

  const requestStart = Date.now();
  const getVisibleResponseContent = (text: string) =>
    extractStateBlock(
      extractCampaignBootstrapBlock(
        extractCombatBlock(extractPartyBlock(extractSceneBlock(text).content).content).content,
      ).content,
    ).content.trim();
  const hasAcceptableStructuredReply = (
    extractedParty: ReturnType<typeof extractPartyBlock>,
    extractedState: ReturnType<typeof extractStateBlock>,
  ) =>
    extractedParty.found &&
    extractedState.found &&
    (extractedState.updates.length > 0 ||
      !narrationSuggestsTrackedStateChange(extractedState.content));

  const firstCallStart = Date.now();
  const firstResponse = await openai.responses.create({
    model: chatModel,
    input,
  });
  const firstModelMs = Date.now() - firstCallStart;
  const firstText = canonicalizeStructuredMarkers(
    firstResponse.output_text ?? "The GM pauses, uncertain how to respond.",
  );
  const firstExtractedScene = extractSceneBlock(firstText);
  const firstExtractedParty = extractPartyBlock(firstExtractedScene.content);
  const firstExtractedBootstrap = extractCampaignBootstrapBlock(firstExtractedParty.content);
  const firstExtractedState = extractStateBlock(firstExtractedBootstrap.content);
  const firstVisibleContent = getVisibleResponseContent(firstText);
  const shouldPreferLowLatency = options?.lowLatency === true;

  if (
    hasAcceptableStructuredReply(firstExtractedParty, firstExtractedState) ||
    (shouldPreferLowLatency && firstVisibleContent.length > 0)
  ) {
    return {
      text: firstText,
      extractedScene: firstExtractedScene,
      extractedParty: firstExtractedParty,
      extractedBootstrap: firstExtractedBootstrap,
      extractedState: firstExtractedState,
      trace: {
        requestMs: Date.now() - requestStart,
        firstModelMs,
        retryModelMs: 0,
        stateRepairMs: 0,
        usedRetry: false,
        lowLatencyAccepted: shouldPreferLowLatency,
      },
    };
  }

  const retryCallStart = Date.now();
  const retryResponse = await openai.responses.create({
    model: chatModel,
    input: [
      ...input,
      {
        role: "system",
        content: [
          "Your previous reply was invalid because it did not include valid PARTY and STATE blocks.",
          "Repeat the same scene outcome and same mechanics, but this time include the required SCENE block, the required PARTY: {...} ENDPARTY block, and the required STATE: [...] ENDSTATE block.",
          "Do not change the fictional outcome. Only repair the formatting and include the exact state updates.",
        ].join(" "),
      },
      {
        role: "user",
        content: `Invalid prior reply to repair:\n${firstText}`,
      },
    ],
  });
  const retryModelMs = Date.now() - retryCallStart;
  const retryText = canonicalizeStructuredMarkers(
    retryResponse.output_text ?? "The GM pauses, uncertain how to respond.",
  );
  const retryExtractedScene = extractSceneBlock(retryText);
  const retryExtractedParty = extractPartyBlock(retryExtractedScene.content);
  const retryExtractedBootstrap = extractCampaignBootstrapBlock(retryExtractedParty.content);
  const retryExtractedState = extractStateBlock(retryExtractedBootstrap.content);
  const retryVisibleContent = getVisibleResponseContent(retryText);

  if (hasAcceptableStructuredReply(retryExtractedParty, retryExtractedState)) {
    return {
      text: retryText,
      extractedScene: retryExtractedScene,
      extractedParty: retryExtractedParty,
      extractedBootstrap: retryExtractedBootstrap,
      extractedState: retryExtractedState,
      trace: {
        requestMs: Date.now() - requestStart,
        firstModelMs,
        retryModelMs,
        stateRepairMs: 0,
        usedRetry: true,
        lowLatencyAccepted: false,
      },
    };
  }

  const stateRepairStart = Date.now();
  const repairedState = await extractStructuredStateFromNarration(
    retryExtractedState.content,
    characterSummary,
    chatModel,
  );
  const stateRepairMs = Date.now() - stateRepairStart;
  const deterministicFallback =
    repairedState.updates.length > 0
      ? repairedState
      : {
          found: true,
          updates: inferExactNamedEffectsFromNarration(
            retryExtractedState.content,
            characters,
          ),
          content: retryExtractedState.content,
        };

  return {
    text:
      retryVisibleContent || firstVisibleContent || "The situation advances. What do you do next?",
    extractedScene: retryExtractedScene,
    extractedParty: retryExtractedParty,
    extractedBootstrap: retryExtractedBootstrap,
    extractedState: deterministicFallback,
    trace: {
      requestMs: Date.now() - requestStart,
      firstModelMs,
      retryModelMs,
      stateRepairMs,
      usedRetry: true,
      lowLatencyAccepted: false,
    },
  };
}

function sanitizeVisibleGmContent(text: string) {
  const normalized = text.replace(/\r\n/g, "\n");
  return normalized
    .replace(/[*_`>\-\s]*PARTY:\s*[\s\S]*?[*_`>\-\s]*ENDPARTY/gi, "\n")
    .replace(/[*_`>\-\s]*COMBAT:\s*[\s\S]*?[*_`>\-\s]*ENDCOMBAT/gi, "\n")
    .replace(/[*_`>\-\s]*BOOTSTRAP:\s*[\s\S]*?[*_`>\-\s]*ENDBOOTSTRAP/gi, "\n")
    .replace(/[*_`>\-\s]*STATE:\s*[\s\S]*?[*_`>\-\s]*ENDSTATE/gi, "\n")
    .replace(/^\s*SCENE:\s*/im, "")
    .replace(
      /^\s*(?:Title|Place|Mood|Threat|Goal|Clock|Context):\s*[^\n]*\n?/gim,
      "",
    )
    .replace(/(?:^|\n)\s*END[ A-Z]*SCEN[ A-Z]*\s*(?=\n|$)/gi, "\n")
    .replace(/(?:^|\n)\s*ENDS?CEN?E?\s*(?=\n|$)/gi, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

function formatValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((entry) => formatValue(entry)).join(", ");
  }

  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, nestedValue]) => `${key}: ${formatValue(nestedValue)}`)
      .join("; ");
  }

  return String(value);
}

type PromptCharacterDetailFlags = {
  includeSpellcasting: boolean;
  includeEquipment: boolean;
  includeSkills: boolean;
  includeResources: boolean;
};

function derivePromptCharacterDetailFlags(params: {
  promptMessage: string;
  gmContext: string;
  combatActive: boolean;
  ruleset: string;
}) {
  const sourceText = `${params.promptMessage}\n${params.gmContext}`.toLowerCase();
  const isDeadlands = params.ruleset.trim().toLowerCase() === "deadlands classic";
  const includeSpellcasting =
    /\b(spell|cast|magic|cantrip|slot|hex|miracle|arcane|bless|sorcer|wizard|cleric|huckster|shaman|blessed)\b/i.test(
      sourceText,
    );
  const includeEquipment =
    params.combatActive ||
    /\b(weapon|armor|equip|equipment|item|inventory|draw|reload|ammo|shield|rifle|revolver|pistol|sword|bow|shotgun)\b/i.test(
      sourceText,
    );
  const includeSkills =
    /\b(check|roll|skill|stealth|persuasion|investigation|perception|faith|guts|shootin|hexslingin)\b/i.test(
      sourceText,
    );
  const includeResources =
    params.combatActive ||
    isDeadlands ||
    /\b(hp|wind|wound|fate|chip|heal|damage|hurt|injur|status|condition|buff|debuff)\b/i.test(
      sourceText,
    );

  return {
    includeSpellcasting,
    includeEquipment,
    includeSkills,
    includeResources,
  } satisfies PromptCharacterDetailFlags;
}

function normalizeNameForLookup(value: string) {
  return value.trim().toLowerCase();
}

function getRelevantCharacterSet(params: {
  campaign: {
    characters: Array<{
      id: string;
      name: string;
      role: string;
      isMainCharacter: boolean;
      memorySummary: string | null;
      sheetJson: unknown;
    }>;
  };
  promptMessage: string;
  gmContext: string;
  combatState: CombatState;
}) {
  const mainCharacter =
    params.campaign.characters.find((character) => character.isMainCharacter) ?? null;
  const selected = new Map<string, (typeof params.campaign.characters)[number]>();
  if (mainCharacter) {
    selected.set(mainCharacter.id, mainCharacter);
  }

  const textForNameMatch = `${params.promptMessage}\n${params.gmContext}`.toLowerCase();
  const normalizedByName = new Map(
    params.campaign.characters.map((character) => [
      normalizeNameForLookup(character.name),
      character,
    ]),
  );

  for (const character of params.campaign.characters) {
    if (character.isMainCharacter) {
      continue;
    }
    const escapedName = character.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escapedName}\\b`, "i").test(textForNameMatch)) {
      selected.set(character.id, character);
    }
  }

  if (params.combatState.combatActive) {
    for (const rosterEntry of params.combatState.roster) {
      if (rosterEntry.type !== "character") {
        continue;
      }
      const matched =
        (typeof rosterEntry.id === "string"
          ? params.campaign.characters.find((character) => character.id === rosterEntry.id)
          : null) ??
        normalizedByName.get(normalizeNameForLookup(rosterEntry.name));
      if (matched) {
        selected.set(matched.id, matched);
      }
    }
  }

  return Array.from(selected.values());
}

function buildAdaptiveCharacterSummary(params: {
  campaign: {
    characters: Array<{
      id: string;
      name: string;
      role: string;
      isMainCharacter: boolean;
      memorySummary: string | null;
      sheetJson: unknown;
    }>;
  };
  promptMessage: string;
  gmContext: string;
  combatState: CombatState;
  ruleset: string;
}) {
  const relevantCharacters = getRelevantCharacterSet({
    campaign: params.campaign,
    promptMessage: params.promptMessage,
    gmContext: params.gmContext,
    combatState: params.combatState,
  });
  if (relevantCharacters.length === 0) {
    return "No characters are defined.";
  }

  const flags = derivePromptCharacterDetailFlags({
    promptMessage: params.promptMessage,
    gmContext: params.gmContext,
    combatActive: params.combatState.combatActive,
    ruleset: params.ruleset,
  });
  const isDeadlands = params.ruleset.trim().toLowerCase() === "deadlands classic";

  return relevantCharacters
    .map((character) => {
      const sheet =
        character.sheetJson &&
        typeof character.sheetJson === "object" &&
        !Array.isArray(character.sheetJson)
          ? (character.sheetJson as Record<string, unknown>)
          : {};
      const className =
        typeof sheet.class === "string" && sheet.class.trim() ? sheet.class.trim() : "";
      const level =
        typeof sheet.level === "number"
          ? sheet.level
          : typeof sheet.level === "string" && sheet.level.trim()
            ? Number.parseInt(sheet.level, 10)
            : null;
      const ancestry =
        typeof sheet.ancestry === "string" && sheet.ancestry.trim()
          ? sheet.ancestry.trim()
          : typeof sheet.race === "string" && sheet.race.trim()
            ? sheet.race.trim()
            : "";
      const hp =
        sheet.hp && typeof sheet.hp === "object" && !Array.isArray(sheet.hp)
          ? (sheet.hp as Record<string, unknown>)
          : null;
      const hpCurrent =
        hp && typeof hp.current === "number"
          ? hp.current
          : hp && typeof hp.current === "string" && hp.current.trim()
            ? Number.parseInt(hp.current, 10)
            : null;
      const hpMax =
        hp && typeof hp.max === "number"
          ? hp.max
          : hp && typeof hp.max === "string" && hp.max.trim()
            ? Number.parseInt(hp.max, 10)
            : null;
      const lines = [
        [
          character.isMainCharacter ? "Main Character" : "Party Character",
          character.name,
          `Role: ${character.role}`,
          className ? `Class: ${className}${level ? ` ${level}` : ""}` : "",
          ancestry ? `Ancestry: ${ancestry}` : "",
          hpCurrent !== null || hpMax !== null ? `HP: ${hpCurrent ?? "?"}/${hpMax ?? "?"}` : "",
          `Memory: ${
            character.memorySummary
              ? truncatePromptText(character.memorySummary, 120)
              : "None"
          }`,
        ]
          .filter(Boolean)
          .join(" | "),
      ];

      if (flags.includeResources) {
        const resourceSegments: string[] = [];
        if (isDeadlands) {
          if (sheet.wind && typeof sheet.wind === "object" && !Array.isArray(sheet.wind)) {
            const wind = sheet.wind as Record<string, unknown>;
            resourceSegments.push(`Wind: ${String(wind.current ?? "?")}/${String(wind.max ?? "?")}`);
          }
          if (sheet.wounds && typeof sheet.wounds === "object" && !Array.isArray(sheet.wounds)) {
            const wounds = sheet.wounds as Record<string, unknown>;
            resourceSegments.push(`Wounds: ${String(wounds.current ?? "?")}/${String(wounds.max ?? "?")}`);
          }
          if (sheet.fateChipShorthand && typeof sheet.fateChipShorthand === "string") {
            resourceSegments.push(`Fate: ${sheet.fateChipShorthand}`);
          }
        }
        const statusEffects = Array.isArray(sheet.statusEffects)
          ? (sheet.statusEffects as unknown[]).filter((entry) => typeof entry === "string")
          : [];
        if (statusEffects.length > 0) {
          resourceSegments.push(`Status: ${statusEffects.join(", ")}`);
        }
        if (resourceSegments.length > 0) {
          lines.push(`Resources: ${resourceSegments.join(" | ")}`);
        }
      }

      if (flags.includeSpellcasting) {
        const spellSegments = [
          typeof sheet.spellcastingAbility === "string" && sheet.spellcastingAbility
            ? `Ability: ${sheet.spellcastingAbility}`
            : "",
          typeof sheet.spellSaveDc === "number"
            ? `Save DC: ${sheet.spellSaveDc}`
            : typeof sheet.spellSaveDc === "string" && sheet.spellSaveDc
              ? `Save DC: ${sheet.spellSaveDc}`
              : "",
          typeof sheet.spellAttackBonus === "number"
            ? `Spell Atk: +${sheet.spellAttackBonus}`
            : typeof sheet.spellAttackBonus === "string" && sheet.spellAttackBonus
              ? `Spell Atk: +${sheet.spellAttackBonus}`
              : "",
          sheet.spellSlots ? `Slots: ${formatValue(sheet.spellSlots)}` : "",
          sheet.spells ? `Spells: ${truncatePromptText(formatValue(sheet.spells), 180)}` : "",
        ].filter(Boolean);
        if (spellSegments.length > 0) {
          lines.push(`Spellcasting: ${spellSegments.join(" | ")}`);
        }
      }

      if (flags.includeEquipment) {
        const equipmentSegments = [
          typeof sheet.mainHand === "string" && sheet.mainHand ? `Main: ${sheet.mainHand}` : "",
          typeof sheet.offHand === "string" && sheet.offHand ? `Off: ${sheet.offHand}` : "",
          typeof sheet.rangedWeapon === "string" && sheet.rangedWeapon
            ? `Ranged: ${sheet.rangedWeapon}`
            : "",
          typeof sheet.longarm === "string" && sheet.longarm ? `Longarm: ${sheet.longarm}` : "",
          sheet.attackProfiles ? `Attacks: ${truncatePromptText(formatValue(sheet.attackProfiles), 120)}` : "",
          sheet.equipment ? `Gear: ${truncatePromptText(formatValue(sheet.equipment), 160)}` : "",
        ].filter(Boolean);
        if (equipmentSegments.length > 0) {
          lines.push(`Loadout: ${equipmentSegments.join(" | ")}`);
        }
      }

      if (flags.includeSkills) {
        const skillSegments = [
          sheet.skills ? `Skills: ${truncatePromptText(formatValue(sheet.skills), 140)}` : "",
          sheet.stats ? `Stats: ${truncatePromptText(formatValue(sheet.stats), 120)}` : "",
          sheet.traits ? `Traits: ${truncatePromptText(formatValue(sheet.traits), 120)}` : "",
          typeof sheet.proficiencyBonus === "number" ? `Prof: +${sheet.proficiencyBonus}` : "",
        ].filter(Boolean);
        if (skillSegments.length > 0) {
          lines.push(`Checks: ${skillSegments.join(" | ")}`);
        }
      }

      return lines.join("\n");
    })
    .join("\n\n");
}

type CompanionBehaviorProfile = {
  name: string;
  summary: string;
  directives: string[];
};

function normalizeCharacterNameKey(value: string) {
  return value.trim().toLowerCase();
}

function buildCompanionBehaviorProfiles(campaign: {
  characters: Array<{
    name: string;
    isMainCharacter: boolean;
    memorySummary: string | null;
    sheetJson: unknown;
  }>;
}) {
  return campaign.characters
    .filter((character) => !character.isMainCharacter)
    .map((character) => {
      const typedSheet =
        character.sheetJson &&
        typeof character.sheetJson === "object" &&
        !Array.isArray(character.sheetJson)
          ? (character.sheetJson as Record<string, unknown>)
          : {};
      const summary =
        typeof typedSheet.behaviorSummary === "string" && typedSheet.behaviorSummary.trim()
          ? typedSheet.behaviorSummary.trim()
          : deriveBehaviorSummary(typedSheet, character.name, character.memorySummary);
      const directives =
        Array.isArray(typedSheet.behaviorDirectives) &&
        typedSheet.behaviorDirectives.every((entry) => typeof entry === "string")
          ? (typedSheet.behaviorDirectives as string[])
              .map((entry) => entry.trim())
              .filter(Boolean)
              .slice(0, 5)
          : deriveBehaviorDirectives(typedSheet);

      return {
        name: character.name,
        summary,
        directives,
      } satisfies CompanionBehaviorProfile;
    });
}

function formatCompanionBehaviorContracts(profiles: CompanionBehaviorProfile[]) {
  if (profiles.length === 0) {
    return "No companion behavior contracts.";
  }

  return profiles
    .map((profile) => {
      const directiveText =
        profile.directives.length > 0
          ? profile.directives.join(" | ")
          : "No explicit directives; follow behaviorSummary closely.";
      return `${profile.name}: ${directiveText}`;
    })
    .join("\n");
}

function getSceneIdentity(messageContent: string) {
  const extractedScene = extractSceneBlock(messageContent).scene;

  if (!extractedScene) {
    return "";
  }

  return `${extractedScene.sceneTitle}||${extractedScene.location}`.toLowerCase();
}

function getVisibleTranscriptContent(content: string) {
  const visibleContent = extractStateBlock(
    extractCampaignBootstrapBlock(
      extractCombatBlock(extractPartyBlock(stripSceneBlock(content)).content).content,
    ).content,
  ).content;

  return visibleContent
    .split("\n")
    .filter((line) => !/^\s*\d+\.\s+/.test(line))
    .join("\n")
    .trim();
}

function buildRecentTranscript(campaign: {
  messages: Array<{
    speakerName: string;
    role: string;
    content: string;
  }>;
}) {
  if (campaign.messages.length === 0) {
    return "No prior messages.";
  }

  const latestGmMessage = [...campaign.messages]
    .reverse()
    .find((message) => message.role === "gm");
  const latestSceneIdentity = latestGmMessage
    ? getSceneIdentity(latestGmMessage.content)
    : "";
  let sceneStartIndex = Math.max(0, campaign.messages.length - 6);

  if (latestSceneIdentity) {
    for (let index = campaign.messages.length - 1; index >= 0; index -= 1) {
      const message = campaign.messages[index];

      if (message.role !== "gm") {
        continue;
      }

      const sceneIdentity = getSceneIdentity(message.content);

      if (!sceneIdentity) {
        continue;
      }

      if (sceneIdentity !== latestSceneIdentity) {
        sceneStartIndex = Math.max(index + 1, campaign.messages.length - 6);
        break;
      }

      sceneStartIndex = index;
    }
  }

  return campaign.messages
    .slice(Math.max(sceneStartIndex, campaign.messages.length - 4))
    .map(
      (message) =>
        `${message.speakerName} (${message.role}): ${truncatePromptText(
          getVisibleTranscriptContent(message.content),
          320,
        )}`,
    )
    .join("\n");
}

function buildLatestGmContext(campaign: {
  messages: Array<{
    speakerName: string;
    role: string;
    content: string;
  }>;
}) {
  const latestGmMessage = [...campaign.messages]
    .reverse()
    .find((message) => message.role === "gm");

  if (!latestGmMessage) {
    return "No recent GM context.";
  }

  return `GM (gm): ${truncatePromptText(getVisibleTranscriptContent(latestGmMessage.content), 500)}`;
}

type ParsedResponseMessage = {
  speakerName: string;
  role: "gm" | "companion";
  content: string;
};

function extractAttributedCompanionFromBlock(
  block: string,
  companionNames: string[],
) {
  const trimmedBlock = block.trim();
  if (!trimmedBlock) {
    return null;
  }

  const nameLeadMatch = trimmedBlock.match(
    /^([A-Z][A-Za-z' -]{1,48})\s*(?:,|\s)\s*(?:says?|said|asks?|asked|repl(?:y|ies|ied)|nods?|murmurs?|whispers?|shouts?|yells?|adds?|answers?|warns?|calls?)\b/i,
  );
  const nameColonMatch = trimmedBlock.match(/^([A-Z][A-Za-z' -]{1,48})\s*:\s*/);
  const nameQuoteTailMatch = trimmedBlock.match(
    /["â€œ][^"â€]{3,}["â€]\s*,?\s*([A-Z][A-Za-z' -]{1,48})\s*(?:says?|said|repl(?:y|ies|ied)|asks?|asked)\b/i,
  );
  const requestedName =
    nameLeadMatch?.[1] ?? nameColonMatch?.[1] ?? nameQuoteTailMatch?.[1] ?? "";

  if (!requestedName) {
    return null;
  }

  const matchedCompanionName = resolveCompanionName(requestedName, companionNames);
  if (!matchedCompanionName) {
    return null;
  }

  const quotedMatch = trimmedBlock.match(/["â€œ]([^"â€]{3,})["â€]/);
  const content =
    quotedMatch?.[1]?.trim() ||
    trimmedBlock
      .replace(/^([A-Z][A-Za-z' -]{1,48})\s*:\s*/i, "")
      .trim();

  if (!content) {
    return null;
  }

  return {
    speakerName: matchedCompanionName,
    role: "companion" as const,
    content,
  };
}

function parseResponseMessagesFromAttribution(
  text: string,
  companionNames: string[],
): ParsedResponseMessage[] | null {
  const blocks = text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  if (blocks.length === 0) {
    return null;
  }

  const parsedMessages: ParsedResponseMessage[] = [];
  const gmBuffer: string[] = [];
  const emittedCompanionKeys = new Set<string>();

  const flushGmBuffer = () => {
    const content = gmBuffer.join("\n\n").trim();
    if (!content) {
      gmBuffer.length = 0;
      return;
    }
    parsedMessages.push({
      speakerName: "GM",
      role: "gm",
      content,
    });
    gmBuffer.length = 0;
  };

  for (const block of blocks) {
    if (/^\d+\.\s+/.test(block)) {
      gmBuffer.push(block);
      continue;
    }

    const attributedCompanion = extractAttributedCompanionFromBlock(
      block,
      companionNames,
    );
    if (!attributedCompanion) {
      gmBuffer.push(block);
      continue;
    }

    const companionKey = normalizeCharacterNameKey(attributedCompanion.speakerName);
    if (emittedCompanionKeys.has(companionKey)) {
      gmBuffer.push(block);
      continue;
    }

    flushGmBuffer();
    parsedMessages.push(attributedCompanion);
    emittedCompanionKeys.add(companionKey);
  }

  flushGmBuffer();

  if (parsedMessages.every((message) => message.role === "gm")) {
    return null;
  }

  return parsedMessages.length > 0 ? parsedMessages : null;
}

async function repairCompanionMessagesWithPersonality(params: {
  messages: ParsedResponseMessage[];
  companionProfiles: CompanionBehaviorProfile[];
  chatModel: CampaignChatModel;
}) {
  const companionMessages = params.messages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => message.role === "companion");
  if (companionMessages.length === 0 || params.companionProfiles.length === 0) {
    return params.messages;
  }

  const profileByName = new Map(
    params.companionProfiles.map((profile) => [
      normalizeCharacterNameKey(profile.name),
      profile,
    ]),
  );
  const targets = companionMessages
    .map(({ message, index }) => {
      const profile = profileByName.get(normalizeCharacterNameKey(message.speakerName));
      if (!profile || profile.directives.length === 0) {
        return null;
      }

      return {
        index,
        name: message.speakerName,
        original: message.content,
        directives: profile.directives,
      };
    })
    .filter(
      (
        entry,
      ): entry is {
        index: number;
        name: string;
        original: string;
        directives: string[];
      } => Boolean(entry),
    );

  if (targets.length === 0) {
    return params.messages;
  }

  try {
    const response = await openai.responses.create({
      model: params.chatModel,
      input: [
        {
          role: "system",
          content: [
            "You repair companion dialogue so it aligns with character personality directives.",
            "Return JSON only as an array of objects: [{\"index\":0,\"content\":\"...\"}].",
            "Preserve each companion message's intent and action outcome.",
            "Adjust tone, wording, and priorities to match directives.",
            "Do not add new events, mechanics, or outcomes.",
            "Each rewritten content must stay concise and in-world.",
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify({
            targets,
          }),
        },
      ],
    });
    const rawText = (response.output_text ?? "[]").trim();
    const jsonText = (() => {
      if (rawText.startsWith("[")) {
        return rawText;
      }
      const fencedMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
      if (fencedMatch?.[1]) {
        return fencedMatch[1].trim();
      }
      const arrayMatch = rawText.match(/\[[\s\S]*\]/);
      return arrayMatch?.[0]?.trim() || "[]";
    })();
    const parsed = JSON.parse(jsonText) as Array<{
      index?: unknown;
      content?: unknown;
    }>;
    if (!Array.isArray(parsed)) {
      return params.messages;
    }

    const rewrites = new Map<number, string>();
    for (const entry of parsed) {
      const index =
        typeof entry.index === "number" && Number.isInteger(entry.index)
          ? entry.index
          : null;
      const content =
        typeof entry.content === "string" ? entry.content.trim() : "";

      if (index === null || !content) {
        continue;
      }

      rewrites.set(index, content);
    }

    if (rewrites.size === 0) {
      return params.messages;
    }

    return params.messages.map((message, index) =>
      rewrites.has(index)
        ? {
            ...message,
            content: rewrites.get(index) as string,
          }
        : message,
    );
  } catch {
    return params.messages;
  }
}

// Legacy fallback retained for older structured-state migration work.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function inferStateUpdatesFromNarration(
  messages: ParsedResponseMessage[],
  campaign: {
    characters: Array<{
      name: string;
      isMainCharacter: boolean;
    }>;
  },
) {
  const combinedText = messages.map((message) => message.content).join("\n");
  const updates: CharacterUpdateInstruction[] = [];
  const mainCharacter = campaign.characters.find(
    (character) => character.isMainCharacter,
  );

  const getUpdateFor = (name: string) => {
    let existingUpdate = updates.find(
      (update) => update.name.toLowerCase() === name.toLowerCase(),
    );

    if (!existingUpdate) {
      existingUpdate = { name, sheet: {} };
      updates.push(existingUpdate);
    }

    if (!existingUpdate.sheet) {
      existingUpdate.sheet = {};
    }

    return existingUpdate;
  };

  const pushSheetPatch = (name: string, patch: Record<string, unknown>) => {
    const update = getUpdateFor(name);
    const normalizedPatch = normalizeSheetPatch(patch);
    const nextSheet = mergeSheetData(
      update.sheet,
      normalizedPatch,
    ) as Record<string, unknown>;

    for (const key of EFFECT_ARRAY_KEYS) {
      const existingEffects = normalizeEffectList(update.sheet?.[key]);
      const incomingEffects = normalizeEffectList(normalizedPatch?.[key]);

      if (existingEffects.length > 0 || incomingEffects.length > 0) {
        nextSheet[key] = [...new Set([...existingEffects, ...incomingEffects])];
      }
    }

    update.sheet = nextSheet;
  };

  const lineTargetsMainCharacter = (text: string) => {
    if (!mainCharacter) {
      return false;
    }

    const escapedMainName = mainCharacter.name.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    );

    return (
      /\b(you|your)\b/i.test(text) ||
      new RegExp(`\\b${escapedMainName}(?:['â€™]s)?\\b`, "i").test(text)
    );
  };

  const applyFixedEffect = (
    effectPattern: RegExp,
    buildPatch: () => Record<string, unknown>,
  ) => {
    let foundNamedMatch = false;

    for (const character of campaign.characters) {
      const escapedName = character.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const namedMatch = combinedText.match(
        new RegExp(
          `${escapedName}(?:'s)?[^\\n.]*?${effectPattern.source}`,
          "i",
        ),
      );

      if (namedMatch) {
        foundNamedMatch = true;
        pushSheetPatch(character.name, buildPatch());
      }
    }

    if (!mainCharacter || foundNamedMatch) {
      return;
    }

    for (const line of combinedText.split("\n")) {
      if (
        new RegExp(effectPattern.source, "i").test(line) &&
        lineTargetsMainCharacter(line)
      ) {
        pushSheetPatch(mainCharacter.name, buildPatch());
        break;
      }
    }
  };

  const applyGenericNarratedEffects = () => {
    const triggerPattern =
      /\b(is|are|was|were|becomes?|remains?|gains?|suffers?|under|affected|wrapped|latches)\b/i;
    let foundNamedMatch = false;

    for (const character of campaign.characters) {
      const escapedName = character.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const lineMatches = Array.from(
        combinedText.matchAll(
          new RegExp(`${escapedName}(?:['â€™]s)?[^\\n]{0,220}`, "gi"),
        ),
      );

      for (const lineMatch of lineMatches) {
        const snippet = lineMatch[0];

        if (!triggerPattern.test(snippet)) {
          continue;
        }

        const normalizedLabel = normalizeEffectLabel(snippet);
        if (!normalizedLabel || normalizedLabel === snippet.replace(/[*_`]/g, " ").replace(/\s+/g, " ").trim()) {
          continue;
        }

        foundNamedMatch = true;
        pushSheetPatch(character.name, buildEffectPatch(normalizedLabel));
      }
    }

    if (!mainCharacter || foundNamedMatch) {
      return;
    }

    const lineMatches = combinedText.split("\n");
    for (const line of lineMatches) {
      if (!triggerPattern.test(line) || !lineTargetsMainCharacter(line)) {
        continue;
      }

      const normalizedLabel = normalizeEffectLabel(line);
      if (!normalizedLabel || normalizedLabel === line.replace(/[*_`]/g, " ").replace(/\s+/g, " ").trim()) {
        continue;
      }

      pushSheetPatch(mainCharacter.name, buildEffectPatch(normalizedLabel));
    }
  };

  const applyNumericResource = (
    resourcePattern: RegExp,
    buildPatch: (nextValue: number) => Record<string, unknown>,
  ) => {
    let foundNamedMatch = false;

    for (const character of campaign.characters) {
      const escapedName = character.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const namedMatch = combinedText.match(
        new RegExp(
          `${escapedName}(?:'s)?[^\\n.]*?${resourcePattern.source}`,
          "i",
        ),
      );

      if (namedMatch?.[1]) {
        foundNamedMatch = true;
        pushSheetPatch(character.name, buildPatch(Number(namedMatch[1])));
      }
    }

    if (!mainCharacter || foundNamedMatch) {
      return;
    }

    const genericMatch = combinedText.match(new RegExp(resourcePattern.source, "i"));
    if (genericMatch?.[1]) {
      pushSheetPatch(mainCharacter.name, buildPatch(Number(genericMatch[1])));
    }
  };

  applyNumericResource(
    /\bhp\s+(?:goes\s+from\s+\d+\s+to|is\s+now|now)\s+(\d+)/,
    (nextValue) => ({ hp: { current: nextValue } }),
  );
  applyNumericResource(
    /\bwind\s+(?:goes\s+from\s+\d+\s+to|is\s+now|now)\s+(\d+)/,
    (nextValue) => ({ wind: { current: nextValue } }),
  );
  applyNumericResource(
    /\bwounds?\s+(?:go(?:es)?\s+from\s+\d+\s+to|is\s+now|now)\s+(\d+)/,
    (nextValue) => ({ wounds: { current: nextValue } }),
  );
  const fateShorthandMatches = Array.from(
    combinedText.matchAll(/\bfate\s*chips?:?\s*W\s*(\d+)\s+R\s*(\d+)\s+B\s*(\d+)\s+L\s*(\d+)/gi),
  );
  if (fateShorthandMatches.length > 0 && mainCharacter) {
    const latestMatch = fateShorthandMatches.at(-1);
    if (latestMatch) {
      pushSheetPatch(mainCharacter.name, {
        fateChips: {
          white: Number(latestMatch[1]),
          red: Number(latestMatch[2]),
          blue: Number(latestMatch[3]),
          legend: Number(latestMatch[4]),
        },
      });
    }
  }
  const locationWoundsShorthandMatches = Array.from(
    combinedText.matchAll(
      /\bwounds?:?\s*H\s*(\d+)\s+G\s*(\d+)\s+LA\s*(\d+)\s+RA\s*(\d+)\s+LL\s*(\d+)\s+RL\s*(\d+)/gi,
    ),
  );
  if (locationWoundsShorthandMatches.length > 0 && mainCharacter) {
    const latestMatch = locationWoundsShorthandMatches.at(-1);
    if (latestMatch) {
      pushSheetPatch(mainCharacter.name, {
        woundsByLocation: {
          head: Number(latestMatch[1]),
          guts: Number(latestMatch[2]),
          leftArm: Number(latestMatch[3]),
          rightArm: Number(latestMatch[4]),
          leftLeg: Number(latestMatch[5]),
          rightLeg: Number(latestMatch[6]),
        },
      });
    }
  }
  const perLocationWoundsMatch = combinedText.match(
    /\bHead:\s*(\d+)[\s,\-|/]+Guts:\s*(\d+)[\s,\-|/]+L(?:eft)?\s*Arm:\s*(\d+)[\s,\-|/]+R(?:ight)?\s*Arm:\s*(\d+)[\s,\-|/]+L(?:eft)?\s*Leg:\s*(\d+)[\s,\-|/]+R(?:ight)?\s*Leg:\s*(\d+)/i,
  );
  if (perLocationWoundsMatch && mainCharacter) {
    pushSheetPatch(mainCharacter.name, {
      woundsByLocation: {
        head: Number(perLocationWoundsMatch[1]),
        guts: Number(perLocationWoundsMatch[2]),
        leftArm: Number(perLocationWoundsMatch[3]),
        rightArm: Number(perLocationWoundsMatch[4]),
        leftLeg: Number(perLocationWoundsMatch[5]),
        rightLeg: Number(perLocationWoundsMatch[6]),
      },
    });
  }
  applyNumericResource(
    /\bsanity\s+(?:goes\s+from\s+\d+\s+to|is\s+now|now)\s+(\d+)/,
    (nextValue) => ({ sanity: nextValue }),
  );
  applyNumericResource(
    /\bhunger\s+(?:goes\s+from\s+\d+\s+to|rises?\s+to|drops?\s+to|is\s+now|now)\s+(\d+)/,
    (nextValue) => ({ hunger: nextValue }),
  );
  applyNumericResource(
    /\bstrain\s+(?:goes\s+from\s+\d+\s+to|is\s+now|now)\s+(\d+)/,
    (nextValue) => ({ strain: nextValue }),
  );
  applyNumericResource(
    /\bammo\s+(?:goes\s+from\s+\d+\s+to|is\s+now|now)\s+(\d+)/,
    (nextValue) => ({ ammo: nextValue }),
  );
  applyNumericResource(
    /\bpact\s+slots?\s+(?:go(?:es)?\s+from\s+\d+\s+to|is\s+now|now)\s+(\d+)/,
    (nextValue) => ({ spellSlots: { pact: nextValue } }),
  );
  applyNumericResource(
    /\b1st[- ]level\s+spell\s+slots?\s+(?:go(?:es)?\s+from\s+\d+\s+to|is\s+now|now)\s+(\d+)/,
    (nextValue) => ({ spellSlots: { level1: nextValue } }),
  );
  applyNumericResource(
    /\b2nd[- ]level\s+spell\s+slots?\s+(?:go(?:es)?\s+from\s+\d+\s+to|is\s+now|now)\s+(\d+)/,
    (nextValue) => ({ spellSlots: { level2: nextValue } }),
  );
  applyNumericResource(
    /\b3rd[- ]level\s+spell\s+slots?\s+(?:go(?:es)?\s+from\s+\d+\s+to|is\s+now|now)\s+(\d+)/,
    (nextValue) => ({ spellSlots: { level3: nextValue } }),
  );

  const statusAddMatches = Array.from(
    combinedText.matchAll(
      /\b(?:Status|Condition|Buff|Debuff):\s*([A-Za-z][A-Za-z0-9 +'-]{1,40})/gi,
    ),
  ).map((match) => match[1].trim());
  if (statusAddMatches.length > 0 && mainCharacter) {
    pushSheetPatch(mainCharacter.name, {
      statusEffects: [...new Set(statusAddMatches)],
    });
  }

  const buffMatches = Array.from(
    combinedText.matchAll(/\bBuff:\s*([A-Za-z][A-Za-z0-9 +,'-]{1,60})/gi),
  ).map((match) => match[1].trim());
  if (buffMatches.length > 0 && mainCharacter) {
    pushSheetPatch(mainCharacter.name, {
      temporaryBuffs: [...new Set(buffMatches)],
    });
  }

  const debuffMatches = Array.from(
    combinedText.matchAll(/\bDebuff:\s*([A-Za-z][A-Za-z0-9 +,'-]{1,60})/gi),
  ).map((match) => match[1].trim());
  if (debuffMatches.length > 0 && mainCharacter) {
    pushSheetPatch(mainCharacter.name, {
      temporaryDebuffs: [...new Set(debuffMatches)],
    });
  }

  applyFixedEffect(
    /\b(?:is|becomes|remains)\s+blessed\b|\bgains?\s+(?:the\s+)?(?:bless|blessing)\b|\bunder\s+the\s+effects?\s+of\s+bless\b/,
    () => ({ temporaryBuffs: ["Blessed"] }),
  );
  applyFixedEffect(
    /\b(?:is|becomes|remains)\s+hasted\b|\bgains?\s+(?:the\s+)?haste\b|\bunder\s+the\s+effects?\s+of\s+haste\b/,
    () => ({ temporaryBuffs: ["Hasted"] }),
  );
  applyFixedEffect(
    /\b(?:is|becomes|remains)\s+inspired\b|\bgains?\s+inspiration\b|\bis\s+bolstered\b/,
    () => ({ temporaryBuffs: ["Inspired"] }),
  );
  applyFixedEffect(
    /\b(?:is|becomes|remains)\s+invisible\b|\bvanishes?\s+from\s+sight\b|\bfades?\s+from\s+view\b/,
    () => ({ temporaryBuffs: ["Invisible"] }),
  );
  applyFixedEffect(
    /\b(?:is|becomes|remains)\s+shielded\b|\bgains?\s+(?:a\s+)?protective\s+ward\b|\bshield\s+of\s+faith\b/,
    () => ({ temporaryBuffs: ["Shielded"] }),
  );
  applyFixedEffect(
    /\b(?:is|becomes|remains)\s+poisoned\b|\bis\s+poisoned\b|\bsuccumbs?\s+to\s+poison\b/,
    () => ({ statusEffects: ["Poisoned"] }),
  );
  applyFixedEffect(
    /\b(?:is|becomes|remains)\s+stunned\b|\bis\s+stunned\b|\bis\s+dazed\b/,
    () => ({ statusEffects: ["Stunned"] }),
  );
  applyFixedEffect(
    /\b(?:is|becomes|remains)\s+prone\b|\bis\s+knocked\s+prone\b|\bis\s+knocked\s+down\b/,
    () => ({ statusEffects: ["Prone"] }),
  );
  applyFixedEffect(
    /\b(?:is|becomes|remains)\s+grappled\b|\bis\s+grappled\b|\bis\s+held\s+fast\b/,
    () => ({ statusEffects: ["Grappled"] }),
  );
  applyFixedEffect(
    /\b(?:is|becomes|remains)\s+restrained\b|\bis\s+restrained\b|\bis\s+pinned\b/,
    () => ({ statusEffects: ["Restrained"] }),
  );
  applyFixedEffect(
    /\b(?:is|becomes|remains)\s+charmed\b|\bis\s+charmed\b|\bfalls?\s+under\s+their\s+spell\b/,
    () => ({ statusEffects: ["Charmed"] }),
  );
  applyFixedEffect(
    /\b(?:is|becomes|remains)\s+burning\b|\bis\s+on\s+fire\b|\bcatches?\s+fire\b|\bis\s+set\s+on\s+fire\b/,
    () => ({ statusEffects: ["Burning"] }),
  );
  applyFixedEffect(
    /\b(?:is|becomes|remains)\s+blinded\b|\bis\s+blinded\b/,
    () => ({ statusEffects: ["Blinded"] }),
  );
  applyFixedEffect(
    /\b(?:is|becomes|remains)\s+deafened\b|\bis\s+deafened\b/,
    () => ({ statusEffects: ["Deafened"] }),
  );
  applyFixedEffect(
    /\b(?:is|becomes|remains)\s+petrified\b|\bis\s+turned\s+to\s+stone\b/,
    () => ({ statusEffects: ["Petrified"] }),
  );
  applyFixedEffect(
    /\b(?:is|becomes|remains)\s+incapacitated\b|\bis\s+unable\s+to\s+act\b/,
    () => ({ statusEffects: ["Incapacitated"] }),
  );
  applyFixedEffect(
    /\b(?:is|becomes|remains)\s+exhausted\b|\bsuffers?\s+exhaustion\b|\bis\s+fatigued\b/,
    () => ({ statusEffects: ["Exhausted"] }),
  );
  applyFixedEffect(
    /\b(?:is|becomes|remains)\s+frightened\b|\bis\s+terrified\b|\bis\s+stricken\s+with\s+fear\b/,
    () => ({ temporaryDebuffs: ["Frightened"] }),
  );
  applyFixedEffect(
    /\b(?:is|becomes|remains)\s+\*?slowed?\b|\bis(?:\s+now)?\s+under(?:\s+a)?(?:\s+\w+){0,3}\s+\*?slow\*?\s+effect\b|\bis\s+under\s+the\s+effects?\s+of\s+\*?slow\b|\baffected\s+by\s+\*?slow\b|\bmovement\s+is\s+reduced\b/,
    () => ({ temporaryDebuffs: ["Slowed"] }),
  );
  applyGenericNarratedEffects();

  return updates;
}

function parseResponseMessages(
  text: string,
  companionNames: string[],
): ParsedResponseMessage[] {
  const trimmed = text.trim();

  if (!trimmed) {
    return [
      {
        speakerName: "GM",
        role: "gm",
        content: "The GM pauses, uncertain how to respond.",
      },
    ];
  }

  const normalized = trimmed.replace(/\r\n/g, "\n");
  const blockPattern = /^(GM|COMPANION:([^\n]+)):\s*/gm;
  const matches = Array.from(normalized.matchAll(blockPattern));

  if (matches.length === 0) {
    const attributedMessages = parseResponseMessagesFromAttribution(
      normalized,
      companionNames,
    );
    if (attributedMessages) {
      return attributedMessages;
    }

    return [
      {
        speakerName: "GM",
        role: "gm",
        content: trimmed,
      },
    ];
  }

  const parsedMessages: ParsedResponseMessage[] = [];
  const splitTrailingChoices = (content: string) => {
    const choiceMatch = content.match(/\n(?=\d+\.\s)/);

    if (!choiceMatch || typeof choiceMatch.index !== "number") {
      return {
        mainContent: content.trim(),
        choicesContent: "",
      };
    }

    return {
      mainContent: content.slice(0, choiceMatch.index).trim(),
      choicesContent: content.slice(choiceMatch.index + 1).trim(),
    };
  };

  for (let index = 0; index < matches.length; index += 1) {
    const currentMatch = matches[index];
    const nextMatch = matches[index + 1];
    const start = currentMatch.index ?? 0;
    const contentStart = start + currentMatch[0].length;
    const contentEnd = nextMatch?.index ?? normalized.length;
    const content = normalized.slice(contentStart, contentEnd).trim();

    if (!content) {
      continue;
    }

    if (currentMatch[1] === "GM") {
      parsedMessages.push({
        speakerName: "GM",
        role: "gm",
        content,
      });
      continue;
    }

    const requestedName = (currentMatch[2] ?? "").trim();
    const matchedCompanionName =
      resolveCompanionName(requestedName, companionNames) ?? requestedName;
    const { mainContent, choicesContent } = splitTrailingChoices(content);

    if (mainContent) {
      parsedMessages.push({
        speakerName: matchedCompanionName || "Companion",
        role: "companion",
        content: mainContent,
      });
    }

    if (choicesContent) {
      parsedMessages.push({
        speakerName: "GM",
        role: "gm",
        content: choicesContent,
      });
    }
  }

  return parsedMessages.length > 0
    ? parsedMessages
    : [
        {
          speakerName: "GM",
          role: "gm",
          content: trimmed,
        },
      ];
}

function normalizeCompanionName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveCompanionName(requestedName: string, companionNames: string[]) {
  const normalizedRequestedName = normalizeCompanionName(requestedName);

  if (!normalizedRequestedName) {
    return null;
  }

  const exactMatch = companionNames.find(
    (name) => normalizeCompanionName(name) === normalizedRequestedName,
  );

  if (exactMatch) {
    return exactMatch;
  }

  const inclusiveMatch = companionNames.find((name) => {
    const normalizedName = normalizeCompanionName(name);
    return (
      normalizedName.includes(normalizedRequestedName) ||
      normalizedRequestedName.includes(normalizedName)
    );
  });

  if (inclusiveMatch) {
    return inclusiveMatch;
  }

  const requestedTokens = normalizedRequestedName.split(" ").filter(Boolean);

  if (requestedTokens.length === 0) {
    return null;
  }

  let bestMatch = "";
  let bestScore = 0;

  for (const name of companionNames) {
    const nameTokens = normalizeCompanionName(name).split(" ").filter(Boolean);
    const score = requestedTokens.filter((token) => nameTokens.includes(token)).length;

    if (score > bestScore) {
      bestMatch = name;
      bestScore = score;
    }
  }

  return bestScore > 0 ? bestMatch : null;
}

function buildFallbackSceneSummary(campaign: {
  title: string;
  messages: Array<{ content: string }>;
}) {
  const priorGmContent = [...campaign.messages]
    .reverse()
    .map((message) => extractSceneBlock(message.content).scene)
    .find(Boolean);

  if (priorGmContent) {
    return priorGmContent;
  }

  return {
    sceneTitle: campaign.title || "Current Scene",
    location: "Current Area",
    mood: "Tense",
    threat: "Low Threat",
    goal: "Decide the next move",
    clock: "No visible timer",
    context: "Active scene",
  };
}

function parsePlayerInput(rawMessage: unknown) {
  const originalMessage =
    typeof rawMessage === "string" ? rawMessage.trim() : "";
  const gmQueryMatch = originalMessage.match(
    /^(?:GM:\s*|\/gm\s+|\\gm\s+)/i,
  );
  const gmQueryMode = Boolean(gmQueryMatch);
  const promptMessage = gmQueryMatch
    ? originalMessage.slice(gmQueryMatch[0].length).trim()
    : originalMessage;

  return {
    originalMessage,
    promptMessage,
    gmQueryMode,
  };
}

function detectCombatEndFromNarration(content: string) {
  const normalized = content.toLowerCase();

  return (
    /combat (?:is |has )?(?:over|ended|ends|finished)/.test(normalized) ||
    /\bthe fight is over\b/.test(normalized) ||
    /\bthe battle is over\b/.test(normalized) ||
    /\bthe brawl is over\b/.test(normalized) ||
    /\binitiative ends\b/.test(normalized) ||
    /\byou are out of combat\b/.test(normalized) ||
    /\bno enemies remain\b/.test(normalized) ||
    /\bno foes remain\b/.test(normalized) ||
    /\bthe last enemy (?:falls|drops|is defeated|goes down)\b/.test(normalized) ||
    /\bthe final enemy (?:falls|drops|is defeated|goes down)\b/.test(normalized)
  );
}

function narrationAllowsSameCombatant(content: string) {
  return /\b(extra turn|another turn|acts again|immediately acts again|takes another full turn)\b/i.test(
    content,
  );
}

function enforceCombatTurnProgression(
  previousCombatState: unknown,
  proposedUpdate: Partial<CombatState>,
  narrationText: string,
) {
  const previousState = normalizeCombatState(previousCombatState);
  const nextState = applyCombatUpdate(previousState, proposedUpdate);

  if (
    !previousState.combatActive ||
    !nextState.combatActive ||
    previousState.roster.length === 0 ||
    nextState.roster.length === 0
  ) {
    return proposedUpdate;
  }

  if (narrationAllowsSameCombatant(narrationText)) {
    return proposedUpdate;
  }

  const previousActiveIndex = previousState.roster.findIndex((entry) => entry.active);
  const nextActiveIndex = nextState.roster.findIndex((entry) => entry.active);
  if (previousActiveIndex < 0 || nextActiveIndex < 0) {
    return proposedUpdate;
  }

  if (previousActiveIndex !== nextActiveIndex) {
    return proposedUpdate;
  }

  const advancedIndex = (nextActiveIndex + 1) % nextState.roster.length;
  const roundIncrement = advancedIndex === 0 ? 1 : 0;

  return {
    ...proposedUpdate,
    combatActive: true,
    round: Math.max(1, nextState.round + roundIncrement),
    turnIndex: advancedIndex,
    roster: nextState.roster.map((entry, index) => ({
      ...entry,
      active: index === advancedIndex,
    })),
  };
}

function normalizeNarratedCombatName(value: string) {
  return value
    .replace(/[*_`]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9'\-\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNarratedCombatBoolean(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "no") {
    return false;
  }
  return null;
}

function parseNarratedCombatRosterFromBullets(
  lines: string[],
  characterNames: string[],
) {
  const characterNameSet = new Set(
    characterNames.map((name) => normalizeNarratedCombatName(name).toLowerCase()),
  );
  const rosterStartIndex = lines.findIndex((line) => /\broster\s*:/i.test(line));
  if (rosterStartIndex < 0) {
    return [] as Array<{
      name: string;
      type: "character" | "enemy" | "npc";
      initiative: number;
      active: boolean;
      summary?: string;
      hp?: string;
    }>;
  }

  const parsed: Array<{
    name: string;
    type: "character" | "enemy" | "npc";
    initiative: number;
    active: boolean;
    summary?: string;
    hp?: string;
  }> = [];

  for (let index = rosterStartIndex + 1; index < lines.length; index += 1) {
    const rawLine = lines[index].trim();
    if (!rawLine) {
      if (parsed.length > 0) {
        break;
      }
      continue;
    }
    if (!/^[\-\*]\s+/.test(rawLine)) {
      if (parsed.length > 0) {
        break;
      }
      continue;
    }

    const cleanedLine = rawLine
      .replace(/^[\-\*]\s+/, "")
      .replace(/\*\*/g, "")
      .trim();
    const headMatch = cleanedLine.match(/^(Character|Enemy|NPC)\s*:\s*([^,]+)(.*)$/i);
    if (!headMatch) {
      continue;
    }

    const rawType = headMatch[1].toLowerCase();
    const type: "character" | "enemy" | "npc" =
      rawType === "enemy" || rawType === "npc" ? rawType : "character";
    const name = normalizeNarratedCombatName(headMatch[2]);
    if (!name) {
      continue;
    }

    const remainder = headMatch[3] ?? "";
    const segments = remainder
      .split(",")
      .map((segment) => segment.trim())
      .filter(Boolean);

    let initiative = 0;
    let active = false;
    let summary: string | undefined;
    let hp: string | undefined;

    for (const segment of segments) {
      const keyValueMatch = segment.match(/^([a-z ]+)\s*:\s*(.+)$/i);
      if (!keyValueMatch) {
        continue;
      }
      const key = keyValueMatch[1].trim().toLowerCase();
      const value = keyValueMatch[2].trim();

      if (key === "initiative") {
        const parsedValue = Number(value);
        if (Number.isFinite(parsedValue)) {
          initiative = Math.max(1, Math.trunc(parsedValue));
        }
        continue;
      }
      if (key === "active") {
        const parsedValue = parseNarratedCombatBoolean(value);
        if (parsedValue !== null) {
          active = parsedValue;
        }
        continue;
      }
      if (key === "summary") {
        summary = value;
        const hpInSummaryMatch = value.match(/\bHP\s*:\s*([^,]+)/i);
        if (hpInSummaryMatch && !hp) {
          hp = hpInSummaryMatch[1].trim();
        }
        continue;
      }
      if (key === "hp") {
        hp = value;
      }
    }

    if (initiative <= 0) {
      initiative = Math.max(1, 20 - parsed.length);
    }

    parsed.push({
      name,
      type: characterNameSet.has(name.toLowerCase()) ? "character" : type,
      initiative,
      active,
      summary,
      hp,
    });
  }

  return parsed;
}

function parseNarratedCountToken(value: string) {
  const normalized = value.trim().toLowerCase();
  const numeric = Number(normalized);
  if (Number.isFinite(numeric)) {
    return Math.max(0, Math.trunc(numeric));
  }

  const wordMap: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
  };
  return wordMap[normalized] ?? 0;
}

function inferEnemyGroupFromNarration(content: string) {
  const remainingMatch = content.match(
    /\bremaining\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+([a-z][a-z0-9' -]{2,30})\b/i,
  );
  if (remainingMatch) {
    const count = parseNarratedCountToken(remainingMatch[1]);
    const rawLabel = normalizeNarratedCombatName(remainingMatch[2]);
    if (count > 0 && rawLabel) {
      return {
        name: rawLabel.replace(/(?:es|s)$/i, ""),
        count,
      };
    }
  }

  const countedHostileMatch = content.match(
    /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:(?:armed|angry|hostile|gang)\s+)?(enforcers?|thugs?|guards?|assassins?|wolves?|bandits?|goblins?|raiders?|patrons?)\b/i,
  );
  if (countedHostileMatch) {
    const count = parseNarratedCountToken(countedHostileMatch[1]);
    const rawLabel = normalizeNarratedCombatName(countedHostileMatch[2]);
    if (count > 0 && rawLabel) {
      return {
        name: rawLabel.replace(/(?:es|s)$/i, ""),
        count,
      };
    }
  }

  const genericMatch = content.match(
    /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+([a-z][a-z0-9' -]{2,30})\b/i,
  );
  if (genericMatch) {
    const count = parseNarratedCountToken(genericMatch[1]);
    const rawLabel = normalizeNarratedCombatName(genericMatch[2]);
    if (count > 1 && rawLabel) {
      return {
        name: rawLabel.replace(/(?:es|s)$/i, ""),
        count,
      };
    }
  }

  if (/\bgoblin(?:s)?\b/i.test(content)) {
    return { name: "Goblin", count: 4 };
  }
  if (/\bbandit(?:s)?\b/i.test(content)) {
    return { name: "Bandit", count: 3 };
  }
  if (/\braider(?:s)?\b/i.test(content)) {
    return { name: "Raider", count: 3 };
  }
  if (/\benforcer(?:s)?\b/i.test(content) || /\bthug(?:s)?\b/i.test(content)) {
    return { name: "Thug", count: 2 };
  }
  if (/\bgang lieutenant\b/i.test(content)) {
    return { name: "Gang Hostile", count: 3 };
  }

  return null;
}

function inferCombatStartFromNarration(
  content: string,
  characterNames: string[],
): Partial<CombatState> | null {
  if (
    !/\binitiative\b/i.test(content) &&
    !/\bturn order\b/i.test(content) &&
    !/\bcombat update\b/i.test(content) &&
    !/\bcombat (?:has )?begun\b/i.test(content)
  ) {
    return null;
  }

  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const orderStartIndex = lines.findIndex((line) =>
    /\b(?:(?:current|combat)\s+)?initiative order\b/i.test(line),
  );
  const names: string[] = [];

  if (orderStartIndex >= 0) {
    for (let index = orderStartIndex + 1; index < lines.length; index += 1) {
      const rawLine = lines[index].trim();
      if (!rawLine) {
        if (names.length > 0) {
          break;
        }
        continue;
      }
      if (
        /\bcurrent situation\b/i.test(rawLine) ||
        /\bwhat do you choose\b/i.test(rawLine) ||
        /\byour options\b/i.test(rawLine)
      ) {
        break;
      }
      if (/^\d+\.\s+/.test(rawLine)) {
        break;
      }
      if (/\bit(?:'|â€™)?s your turn\b/i.test(rawLine)) {
        break;
      }

      const cleanedLine = rawLine
        .replace(/^[*\- \s]+/, "")
        .replace(/[*\s]+$/, "")
        .trim();
      const normalizedName = normalizeNarratedCombatName(
        cleanedLine.replace(/^\d+\s*[\)\.\-:]\s*/, ""),
      );
      if (!normalizedName) {
        continue;
      }
      if (!names.some((name) => name.toLowerCase() === normalizedName.toLowerCase())) {
        names.push(normalizedName);
      }
    }
  }

  if (names.length < 2) {
    const currentInitiativeLine = lines.find((line) => /\bcurrent initiative\s*:/i.test(line));
    if (currentInitiativeLine) {
      const listMatch = currentInitiativeLine.match(/\bcurrent initiative\s*:\s*(.+)$/i);
      const entries = (listMatch?.[1] ?? "")
        .split(",")
        .map((entry) => normalizeNarratedCombatName(entry))
        .filter(Boolean);
      for (const entry of entries) {
        if (!names.some((name) => name.toLowerCase() === entry.toLowerCase())) {
          names.push(entry);
        }
      }
    }
  }

  const characterNameSet = new Set(
    characterNames.map((name) => normalizeNarratedCombatName(name).toLowerCase()),
  );
  const parsedRoster = parseNarratedCombatRosterFromBullets(lines, characterNames);
  const rosterFromNames = names.map((name, index) => ({
    name,
    type: characterNameSet.has(name.toLowerCase()) ? ("character" as const) : ("enemy" as const),
    initiative: Math.max(1, names.length - index),
    active: false,
  }));
  const roster = parsedRoster.length >= 2 ? parsedRoster : rosterFromNames;

  if (roster.length < 2) {
    const fallbackCharacters = characterNames
      .map((name) => normalizeNarratedCombatName(name))
      .filter(Boolean)
      .slice(0, 6);
    const inferredEnemyGroup = inferEnemyGroupFromNarration(content);
    if (fallbackCharacters.length === 0 || !inferredEnemyGroup) {
      return null;
    }

    const fallbackRoster = [
      ...fallbackCharacters.map((name, index) => ({
        name,
        type: "character" as const,
        initiative: Math.max(1, 20 - index),
        active: index === 0,
      })),
      ...Array.from({ length: Math.min(12, inferredEnemyGroup.count) }).map((_, index) => ({
        name: `${inferredEnemyGroup.name} ${index + 1}`,
        type: "enemy" as const,
        initiative: Math.max(1, 10 - index),
        active: false,
        summary: `Inferred from narration (${inferredEnemyGroup.count} total)`,
      })),
    ];

    return {
      combatActive: true,
      round: 1,
      turnIndex: 0,
      roster: fallbackRoster,
    };
  }

  const turnIndexMatch = content.match(/\bturn index\s*:\s*(\d+)\b/i);
  const indexedTurn =
    turnIndexMatch && Number.isFinite(Number(turnIndexMatch[1]))
      ? Math.max(0, Math.trunc(Number(turnIndexMatch[1])))
      : null;
  const explicitActiveIndex = roster.findIndex((entry) => entry.active);
  const activeTurnMatch = content.match(
    /([^,\n]{1,80}),\s*(?:it(?:'|â€™)?s your turn|you have the first move|you act first)/i,
  );
  const activeTurnName = activeTurnMatch
    ? normalizeNarratedCombatName(activeTurnMatch[1]).toLowerCase()
    : "";

  const activeIndex =
    explicitActiveIndex >= 0
      ? explicitActiveIndex
      : indexedTurn !== null && indexedTurn < roster.length
        ? indexedTurn
        : activeTurnName.length > 0
          ? Math.max(
              0,
              roster.findIndex((entry) => entry.name.toLowerCase() === activeTurnName),
            )
          : 0;

  if (roster[activeIndex]) {
    roster.forEach((entry, index) => {
      entry.active = index === activeIndex;
    });
  }

  return {
    combatActive: true,
    round: 1,
    turnIndex: activeIndex,
    roster,
  };
}

type CombatTriggerDecision = {
  decision: "NO_COMBAT" | "TENSION_ESCALATION" | "START_COMBAT";
  score: number;
  threshold: number;
  reasons: string[];
};

function evaluateCombatTriggerDecision(params: {
  inferredCombatStart: Partial<CombatState> | null;
  narrationText: string;
  playerPrompt: string;
  scene: SceneSummary;
  bootstrap: ReturnType<typeof normalizeCampaignBootstrap>;
  explicitOptionSelection: boolean;
}) {
  if (!params.inferredCombatStart) {
    return {
      decision: "NO_COMBAT",
      score: 0,
      threshold: 999,
      reasons: ["No inferred combat start state present."],
    } satisfies CombatTriggerDecision;
  }

  const lowerNarration = params.narrationText.toLowerCase();
  const lowerPrompt = params.playerPrompt.toLowerCase();
  const lowerSceneThreat = params.scene.threat.toLowerCase();
  const lowerSceneContext = params.scene.context.toLowerCase();
  const lowerSceneGoal = params.scene.goal.toLowerCase();
  const reasons: string[] = [];
  let score = 0;
  let hardStart = false;

  const directCombatStartIntent =
    /\b(attack|draw steel|draw guns?|join the fight|start(?:ing)? combat|open fire|charge|shoot|strike|stab|slash|engage)\b/.test(
      lowerPrompt,
    );
  const explicitStartLanguage =
    /\b(combat has begun|combat is now active|initiative order|roll initiative|you are first to act|turn order)\b/.test(
      lowerNarration,
    ) || directCombatStartIntent;
  if (explicitStartLanguage) {
    hardStart = true;
    reasons.push("Explicit combat start marker detected.");
  }

  if (
    /\b(attack|shoot|fire|strike|stab|slash|charge|join the fight|start combat|gunfight|draw guns?|open fire|kill|finish them)\b/.test(
      lowerPrompt,
    )
  ) {
    score += 4;
    reasons.push("Player prompt contains direct hostile action intent.");
  }
  if (params.explicitOptionSelection) {
    score += 1;
    reasons.push("Explicit numbered option selection committed this turn.");
  }
  if (/\b(threat|danger|hostile|ambush|surrounded|wolves|bandit|goblin|assassin)\b/.test(lowerSceneThreat)) {
    score += 2;
    reasons.push("Scene threat contains hostile indicators.");
  }
  if (/\b(hostile|armed|enemy|bandit|goblin|ambush|raid|siege)\b/.test(lowerSceneContext)) {
    score += 1;
    reasons.push("Scene context contains hostile actors.");
  }
  if (/\b(fight|defend|survive|escape|hold the line|break through)\b/.test(lowerSceneGoal)) {
    score += 1;
    reasons.push("Scene goal implies active conflict.");
  }
  if (/\b(surrender|retreat|withdraw|de-?escalat|negotiat|parley|avoid bloodshed|talk)\b/.test(lowerPrompt)) {
    score -= 2;
    reasons.push("Player prompt indicates de-escalation preference.");
  }
  if (/\b(ceasefire|tense standoff|hold fire|no one attacks)\b/.test(lowerNarration)) {
    score -= 2;
    reasons.push("Narration indicates temporary pause/de-escalation.");
  }

  const pressureRatio = params.bootstrap.clocks
    .filter((clock) => clock.visibility !== "gm_hidden")
    .reduce((maxRatio, clock) => {
      const ratio = clock.max > 0 ? clock.current / clock.max : 0;
      return Math.max(maxRatio, ratio);
    }, 0);
  if (pressureRatio >= 0.75) {
    score += 1;
    reasons.push("Visible pressure clock is near completion.");
  }
  if (pressureRatio >= 0.9) {
    score += 1;
    reasons.push("Visible pressure clock is critical.");
  }

  const difficultyMode = params.bootstrap.combat_generation?.difficultyMode ?? "standard";
  const variance = params.bootstrap.combat_generation?.encounterVariance ?? "medium";
  let threshold = difficultyMode === "cinematic" ? 6 : difficultyMode === "deadly" ? 8 : 7;
  if (variance === "high") {
    threshold -= 1;
    reasons.push("High encounter variance lowers trigger threshold.");
  } else if (variance === "low") {
    threshold += 1;
    reasons.push("Low encounter variance raises trigger threshold.");
  }
  threshold = Math.max(4, threshold);

  if (hardStart) {
    return {
      decision: "START_COMBAT",
      score: Math.max(score, threshold),
      threshold,
      reasons,
    } satisfies CombatTriggerDecision;
  }

  if (score >= threshold) {
    return {
      decision: "START_COMBAT",
      score,
      threshold,
      reasons,
    } satisfies CombatTriggerDecision;
  }
  if (score >= threshold - 2) {
    return {
      decision: "TENSION_ESCALATION",
      score,
      threshold,
      reasons: [...reasons, "Below auto-start threshold; maintain escalation without initiating combat."],
    } satisfies CombatTriggerDecision;
  }
  return {
    decision: "NO_COMBAT",
    score,
    threshold,
    reasons: [...reasons, "Insufficient trigger score for auto combat start."],
  } satisfies CombatTriggerDecision;
}

function hasDirectCombatStartIntent(prompt: string) {
  return /\b(attack|draw steel|draw guns?|join the fight|start(?:ing)? combat|open fire|charge|shoot|strike|stab|slash|engage)\b/i.test(
    prompt,
  );
}

function buildPromptForcedCombatStart(
  content: string,
  characterNames: string[],
): Partial<CombatState> | null {
  const fallbackCharacters = characterNames
    .map((name) => normalizeNarratedCombatName(name))
    .filter(Boolean)
    .slice(0, 6);
  const inferredEnemyGroup = inferEnemyGroupFromNarration(content);
  if (fallbackCharacters.length === 0 || !inferredEnemyGroup) {
    return null;
  }

  const fallbackRoster = [
    ...fallbackCharacters.map((name, index) => ({
      name,
      type: "character" as const,
      initiative: Math.max(1, 20 - index),
      active: index === 0,
    })),
    ...Array.from({ length: Math.min(12, inferredEnemyGroup.count) }).map((_, index) => ({
      name: `${inferredEnemyGroup.name} ${index + 1}`,
      type: "enemy" as const,
      initiative: Math.max(1, 10 - index),
      active: false,
      summary: `Prompt-forced start (${inferredEnemyGroup.count} inferred)`,
    })),
  ];

  return {
    combatActive: true,
    round: 1,
    turnIndex: 0,
    roster: fallbackRoster,
  };
}

function buildCombatShadowSeedInput(params: {
  campaignId: string;
  messageCount: number;
  narrationText: string;
}) {
  const compactNarration = params.narrationText
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);

  return `${params.campaignId}|${params.messageCount}|${compactNarration}`;
}

function shouldAutoRefreshRecap(update: PartyUpdateInstruction) {
  return (
    typeof update.summary === "string" ||
    Array.isArray(update.activeQuests) ||
    Array.isArray(update.completedQuests) ||
    Array.isArray(update.completedQuestsAdd) ||
    (Array.isArray(update.journalAdd) && update.journalAdd.length > 0)
  );
}

function normalizeQuestKey(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function inferMajorQuestFromScene(
  scene: SceneSummary,
  narrationText: string,
): string | null {
  const rawGoal = scene.goal.trim().replace(/\s+/g, " ").replace(/[.!?]+$/, "");
  if (!rawGoal) {
    return null;
  }

  const wordCount = rawGoal.split(" ").filter(Boolean).length;
  const lowerGoal = rawGoal.toLowerCase();
  const lowerContext = `${scene.threat} ${scene.clock} ${scene.context} ${narrationText}`
    .toLowerCase()
    .replace(/\s+/g, " ");

  if (/\b(?:choose|decide|what do you do|next move)\b/.test(lowerGoal)) {
    return null;
  }

  const majorVerbPattern =
    /\b(?:find|locate|recover|retrieve|rescue|escort|protect|investigate|discover|stop|prevent|defeat|escape|survive|reach|secure|negotiate|track|uncover|solve)\b/;
  const horizonCuePattern =
    /\b(?:reinforcements?|before|until|deadline|timer|mission|contact|artifact|relic|faction|stronghold|hideout|ritual|escape|rescue|recover|locate|track)\b/;
  const microGoalPattern =
    /\b(?:search|check|look|open|drink|use|inspect|hide|ambush|prepare)\b/;

  const hasMajorVerb = majorVerbPattern.test(lowerGoal);
  const hasHorizonCue = horizonCuePattern.test(lowerContext);
  const looksMicroOnly =
    microGoalPattern.test(lowerGoal) &&
    !hasHorizonCue &&
    wordCount <= 8;

  if (!hasMajorVerb || looksMicroOnly) {
    return null;
  }

  if (wordCount < 5 && !hasHorizonCue) {
    return null;
  }

  return rawGoal;
}


export async function POST(req: NextRequest) {
  const debugStateLoggingEnabled =
    req.headers.get("x-debug-state-logging") === "true";
  const postRequestStart = Date.now();
  const phaseTimings: Record<string, number | string | boolean> = {};
  const {
    campaignId,
    message,
    selectedOptionNumbers,
    engineCombatModeEnabled,
  } = await req.json();
  const parsedPlayerInput = parsePlayerInput(message);
  const explicitOptionSelection =
    Array.isArray(selectedOptionNumbers) &&
    selectedOptionNumbers.some((value) => typeof value === "number");

  const campaignLookupStart = Date.now();
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: {
      characters: true,
      messages: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
  phaseTimings.campaignLookupMs = Date.now() - campaignLookupStart;

  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  campaign.messages.reverse();

  if (!parsedPlayerInput.originalMessage) {
    return NextResponse.json({ error: "Message is required." }, { status: 400 });
  }

    const shouldUseCompactPrompt = true;
    const normalizedPartyState = normalizePartyState(
      (campaign as { partyStateJson?: unknown }).partyStateJson,
    );
    const partySummary = shouldUseCompactPrompt
      ? [
          `Party name: ${normalizedPartyState.partyName || "None"}`,
          `Active quests: ${normalizedPartyState.activeQuests.join(" | ") || "None"}`,
          `Shared inventory: ${normalizedPartyState.sharedInventory.join(" | ") || "None"}`,
          `Recap: ${truncatePromptText(normalizedPartyState.recap || "None", 180)}`,
        ].join("\n")
      : formatPartyStateForPrompt(
          (campaign as { partyStateJson?: unknown }).partyStateJson,
        );
  const combatStateForPrompt = normalizeCombatState(
    (campaign as { combatStateJson?: unknown }).combatStateJson,
  );
  const combatSummary = shouldUseCompactPrompt
    ? combatStateForPrompt.combatActive
      ? `Combat active: round ${combatStateForPrompt.round}, turn ${combatStateForPrompt.turnIndex}, roster ${combatStateForPrompt.roster.length}`
      : "No active combat."
    : formatCombatStateForPrompt(
        (campaign as { combatStateJson?: unknown }).combatStateJson,
      );
  const chatModel = normalizeCampaignChatModel(
    (campaign as { chatModel?: unknown }).chatModel,
  );
  const narrationLevel = normalizedPartyState.narrationLevel;
  const normalizedRuleset = campaign.ruleset.trim().toLowerCase();
  const isDeadlandsRuleset = normalizedRuleset === "deadlands classic";
  const recentTranscript = buildRecentTranscript(campaign);
  const latestGmContext = buildLatestGmContext(campaign);
  const characterSummary = buildAdaptiveCharacterSummary({
    campaign,
    promptMessage: parsedPlayerInput.promptMessage,
    gmContext: latestGmContext,
    combatState: combatStateForPrompt,
    ruleset: campaign.ruleset,
  });
  const mainCharacterName =
    campaign.characters.find((character) => character.isMainCharacter)?.name ??
    "Player";
  const companionNames = campaign.characters
    .filter((character) => !character.isMainCharacter)
    .map((character) => character.name);
  const companionBehaviorProfiles = buildCompanionBehaviorProfiles(campaign);
  const companionBehaviorContracts = formatCompanionBehaviorContracts(
    companionBehaviorProfiles,
  );
  const fallbackBootstrap = buildInitialCampaignBootstrap({
    title: campaign.title,
    ruleset: campaign.ruleset,
    startingScenario: campaign.messages[0]?.content ?? "",
  });
  const currentBootstrap = normalizeCampaignBootstrap(
    (campaign as { bootstrapJson?: unknown }).bootstrapJson,
    fallbackBootstrap,
  );
  const bootstrapSummary = shouldUseCompactPrompt
    ? [
        `Objective: ${currentBootstrap.campaign.party_goal_public || "None"}`,
        `Scene: ${currentBootstrap.campaign.starting_scene || "Unknown"}`,
        `Visible quests: ${
          currentBootstrap.quests
            .filter((quest) => quest.visibility === "player" || quest.visibility === "teased")
            .map((quest) => `${quest.id}:${quest.title}(${quest.status})`)
            .join(" | ") || "None"
        }`,
        `Visible clocks: ${
          currentBootstrap.clocks
            .filter((clock) => clock.visibility !== "gm_hidden")
            .map((clock) => `${clock.name} ${clock.current}/${clock.max}`)
            .join(" | ") || "None"
        }`,
      ].join("\n")
    : formatCampaignBootstrapForPrompt(currentBootstrap);
  const combatStateBeforeTurn = normalizeCombatState(
    (campaign as { combatStateJson?: unknown }).combatStateJson,
  );
  const shouldBlockPreEngineRollNarration =
    engineCombatModeEnabled === true && !combatStateBeforeTurn.combatActive;

  const modelInput: Array<{ role: "system" | "user"; content: string }> = [
    {
      role: "system",
      content: [
        "You are the GM for a tabletop RPG session.",
        "You must stay consistent with the campaign ruleset and the saved character sheets.",
        "You must also stay consistent with the saved party state, including quests, reputation, journal, and shared inventory.",
        "Treat the main character's stored class, stats, traits, and resources as canonical.",
        "Treat each character's saved behaviorSummary as the compact canonical guide to how they behave, what choices they prefer, and how they respond under stress.",
        "Use saved background, personality, and physical description as supporting detail, but rely primarily on behaviorSummary for consistent characterization.",
        "When companions act or speak, make those choices fit their saved behaviorSummary instead of treating them as generic helpers.",
        "Companion behavior contracts are hard constraints for tone, priorities, and decision style.",
        "When a companion speaks or acts, align with their contract even if it is less optimal tactically.",
        `Companion behavior contracts:\n${companionBehaviorContracts}`,
        "When the player attempts something, consider what their sheet supports before narrating outcomes.",
        shouldBlockPreEngineRollNarration
          ? "Engine combat pre-start mode: do not resolve or narrate combat dice rolls yet."
          : "You make every roll on behalf of the player and the world; never ask the player to roll dice.",
        shouldBlockPreEngineRollNarration
          ? "Before combat is started in COMBAT, avoid initiative, attack, damage, and save roll lines."
          : "When a roll matters, state it explicitly using the word Roll and include the exact numeric result.",
        shouldBlockPreEngineRollNarration
          ? "Pre-start responses should set up scene tension and list options without numeric combat resolution."
          : "Always show the dice expression and the total, such as `Roll: Athletics check d20(14) + 5 = 19`.",
        shouldBlockPreEngineRollNarration
          ? "Do not resolve contested checks, attacks, or damage until combat is active in COMBAT."
          : "For contested checks, opposed checks, attacks, saves, or damage, show both sides' exact numbers when relevant.",
        shouldBlockPreEngineRollNarration
          ? "Do not include rolled values before combat start."
          : "Do not say a roll was good, bad, enough, or not enough without also giving the actual rolled values and totals.",
        "When immediate risk appears, use the word Danger.",
        "Use Heals only for literal recovery: restored hp, reduced wounds, eased poison, recovered sanity, or another tracked health-like resource improving.",
        "Never use Heals metaphorically for morale, tension, positioning, crowd reaction, or any non-literal benefit.",
        "Use Success for a clear positive outcome that is not literal healing, such as gaining advantage, de-escalating tension, buying time, distracting enemies, or improving position.",
        "When the character notices, understands, or learns something important, use the word Realizes.",
        "Prefer a compact structure: narration first, then short mechanical lines when needed.",
        getNarrationLevelPromptInstruction(narrationLevel),
        "Narration level changes descriptive density only; it must not reduce forward motion or delay consequences.",
        "Begin every response with a structured scene block using this exact format:",
        "SCENE:",
        "Title: <short action-oriented scene title>",
        "Place: <short place name>",
        "Mood: <brief mood>",
        "Threat: <brief threat>",
        "Goal: <current objective>",
        "Clock: <current urgency or timer>",
        "Context: <key NPCs, factions, or tags>",
        "ENDSCENE",
        "The latest SCENE block is the canonical current scene.",
        "Do not return to prior scenes, locations, threats, or moment-to-moment action unless the latest transcript explicitly transitions back to them.",
        "Do not revive an earlier scene just because it was unresolved if the latest SCENE block has already moved the action elsewhere.",
        "After the scene block, include a hidden party-state block using this exact format:",
        "PARTY:",
        '{"activeQuests":["<active quest>"],"completedQuestsAdd":["<newly completed quest>"],"journalAdd":["<new journal entry>"],"reputation":[{"name":"<faction>","score":0,"status":"Neutral","notes":["<reputation note>"]}],"sharedInventory":["<notable item>"]}',
        "ENDPARTY",
        "This PARTY block is required on every response, even if no party values changed.",
        "If no party state changed this turn, return an empty object inside the party block.",
        "Allowed PARTY keys are partyName, summary, recap, activeQuests, completedQuests, completedQuestsAdd, journalAdd, reputation, and sharedInventory.",
        "Treat activeQuests as major multi-step objectives, not single-turn tactical actions.",
        "Do not add a new active quest for minor actions like searching one crate, taking one swing, or checking one room.",
        "Keep activeQuests stable across turns until the objective is clearly resolved or abandoned.",
        "Recap is optional in PARTY and should only be used when the situation has materially changed enough to justify rewriting the rolling summary.",
        "For activeQuests, completedQuests, sharedInventory, and reputation, provide the full current canonical list when they change.",
        "Use completedQuestsAdd to append one or more newly completed quests without replacing the existing completed quest history.",
        "Reputation entries must be objects with name, score, status, and notes.",
        "Use score values from -3 to 3, where negative is hostile, 0 is neutral, and positive is favorable.",
        "For journalAdd, provide one or two short new recap entries to append when something meaningful happens.",
        "After the party block, include a hidden combat-state block using this exact format:",
        "COMBAT:",
        '{"combatActive":true,"round":1,"turnIndex":0,"roster":[{"id":"character-id","name":"Buck Bradley","type":"character","initiative":18,"active":true},{"name":"Assassin","type":"enemy","initiative":14,"active":false,"summary":"Crossbowman","hp":"9/12","statusEffects":["Prone"]}]}',
        "ENDCOMBAT",
        "This COMBAT block is required on every response, even if combat state did not change.",
        "If combat state did not change, return an empty object inside the combat block.",
        "Use the combat block to start or end combat, advance turn order, and keep the current initiative roster accurate.",
        "When combat is active, exactly one roster entry must have active set to true.",
        "The turnIndex must point to that same single active roster entry.",
        "Do not mark multiple combatants active at the same time.",
        "During active combat, resolve exactly one combatant turn per response, then advance turnIndex to the next combatant unless a specific extra-turn effect is explicitly active.",
        "Do not keep the same combatant active across consecutive responses unless you explicitly narrate and encode an extra full turn effect.",
        "When combat ends, you must explicitly return {\"combatActive\":false,\"round\":1,\"turnIndex\":0,\"roster\":[]} inside the COMBAT block.",
        "Do not leave stale combatants in the roster once the fight, chase, or initiative sequence has ended.",
        "For non-party combatants, type should be enemy or npc and you may omit id.",
        shouldBlockPreEngineRollNarration
          ? "Engine combat mode is enabled and combat is not yet active. Do not narrate initiative rolls, attack rolls, damage rolls, saves, or any numeric combat resolution before combat is started in the COMBAT block."
          : "When a roll matters, state it explicitly using the word Roll and include the exact numeric result.",
        shouldBlockPreEngineRollNarration
          ? "In this mode, provide only combat setup and participants in COMBAT, then stop before resolving combat mechanics."
          : "Always show the dice expression and the total, such as `Roll: Athletics check d20(14) + 5 = 19`.",
        formatCombatBoundaryForPrompt(),
        "After the combat block, include a hidden bootstrap-update block using this exact format:",
        "BOOTSTRAP:",
        '{"scene_title":"<short current scene title>","objective":"<current objective>","clocks_advanced":[{"id":"CLK1","delta":1}],"quest_updates":[{"id":"Q1","status":"active","addStep":"Interview the witness"}],"clues_revealed":["CL1"],"new_clue":{"id":"CL9","text":"A bloodstained token with a crest","visibility":"gm_hidden"}}',
        "ENDBOOTSTRAP",
        "This BOOTSTRAP block is required on every response.",
        "If no bootstrap state changed this turn, return an empty object in BOOTSTRAP.",
        "Allowed BOOTSTRAP keys are scene_title, objective, clocks_advanced, quest_updates, clues_revealed, new_clue, and loop_breaker_reason.",
        "Changing only scene_title and/or objective does not count as structural progression.",
        "Use clocks_advanced, quest_updates, clues_revealed, or new_clue when meaningful progress occurs.",
        "Do not include full bootstrap state; include only incremental turn updates.",
        "After the scene block, include a hidden state block using this exact format:",
        "STATE:",
        '[{"name":"Exact Character Name","sheet":{"hp":{"current":9}},"memorySummary":"optional short update"}]',
        "ENDSTATE",
        "This STATE block is required on every response, even if no values changed.",
        "Use exact existing character names only.",
        "Inside the state block, include only characters whose stored sheet or memory should change this turn.",
        "Use canonical absolute values in sheet updates, not damage deltas. Example: set current hp to the new total, not minus 3.",
        "Track and update all relevant persistent resources in STATE, including hp.current, wounds.current, sanity, hunger, strain, ammo, and spellSlots.",
        isDeadlandsRuleset
          ? "Because this campaign uses Deadlands Classic, treat wind.current/max, woundsByLocation, woundShorthand, and fateChips as canonical STATE resources."
          : "For non-Deadlands rulesets, keep using each system's canonical tracked resources.",
        isDeadlandsRuleset
          ? "In Deadlands, glancing harm, fatigue, and exertion should usually change Wind; direct bodily injury should change woundsByLocation with a specific hit location."
          : "Use each ruleset's normal damage model.",
        "For spell slot use, update the exact slot bucket such as spellSlots.level1, spellSlots.level2, spellSlots.level3, or spellSlots.pact.",
        "For ongoing conditions, use arrays like statusEffects, temporaryBuffs, and temporaryDebuffs in the sheet update.",
        "Always include the full current arrays for statusEffects, temporaryBuffs, and temporaryDebuffs when any effect changes, not just the newly added entry.",
        "If an effect ends, remove it from the relevant array in STATE instead of only mentioning it in prose.",
        "Use canonical effect labels such as Blessed, Hasted, Inspired, Invisible, Shielded, Poisoned, Stunned, Prone, Grappled, Restrained, Charmed, Burning, Frightened, Slowed, Blinded, Deafened, Petrified, Incapacitated, and Exhausted.",
        "Example STATE sheet patch: {\"hp\":{\"current\":9},\"spellSlots\":{\"level1\":1},\"statusEffects\":[\"Poisoned\"],\"temporaryBuffs\":[\"Blessed\"],\"temporaryDebuffs\":[\"Frightened\"]}.",
        "If narration says hp changed, wounds changed, sanity changed, hunger changed, strain changed, ammo changed, spell slots changed, or a status/buff/debuff was applied or removed, you must include that exact updated state in the STATE block.",
        isDeadlandsRuleset
          ? "If narration says Wind, location wounds, or Fate Chips changed, include exact updated values in STATE using wind, woundsByLocation, and fateChips."
          : "If narration says tracked resources changed, include exact updated values in STATE.",
        "Do not describe a stat, resource, or effect change only in prose without also updating it in STATE.",
        "The STATE block is hidden bookkeeping for the app and should always be valid JSON.",
        "A response without a valid STATE block is invalid. Always include STATE: [...] ENDSTATE, even when the array is empty.",
        "If no character sheet changes this turn, return an empty array inside the state block.",
        "Format your reply as one or more tagged blocks.",
        "Use `GM:` for narration and rulings.",
        "Whenever a named companion speaks, reacts, comments, or takes an action independently, put that in a separate block using `COMPANION:Name:`.",
        "Do not bury companion dialogue or companion actions inside a GM block if a companion is involved.",
        "If a companion contributes, split that contribution into its own tagged block.",
        "Only use companion blocks for companions that exist in the campaign.",
        parsedPlayerInput.gmQueryMode
          ? "This turn is a direct out-of-character GM question for clarification, description, or a rules answer."
          : "This turn is a normal in-world player action and should advance the adventure.",
        parsedPlayerInput.gmQueryMode
          ? "Answer the question clearly and directly without advancing the scene, consuming time, escalating danger, moving NPCs forward, or introducing new consequences."
          : "Every GM response must move the scene forward.",
        parsedPlayerInput.gmQueryMode
          ? "Do not change character state, party state, quests, reputation, inventory, or the current scene during a GM question."
          : "After resolving the player's action, introduce at least one new development, consequence, clue, escalation, or shift in opportunity.",
        parsedPlayerInput.gmQueryMode
          ? "Do not include numbered options for a GM question."
          : "When it is the main character's turn to act or speak, end the GM block with exactly four numbered options on separate lines using the format `1. ...`, `2. ...`, and so on.",
        parsedPlayerInput.gmQueryMode
          ? "Keep the current SCENE block effectively unchanged from the existing scene unless you are only restating it for clarity."
          : "Those options should be concrete actions, questions, or responses the player could plausibly choose next.",
        parsedPlayerInput.gmQueryMode
          ? "Return PARTY: {} ENDPARTY and STATE: [] ENDSTATE for a GM question."
          : "Even when you provide numbered options, the player may still choose something else, so do not frame them as mandatory.",
        parsedPlayerInput.gmQueryMode
          ? "Do not shift the dramatic situation during a GM question."
          : "If the player clearly commits to a plan, whether by choosing a numbered option or by typing a custom version of it, do not restate or paraphrase that plan back to them.",
        !parsedPlayerInput.gmQueryMode && explicitOptionSelection
          ? "The player explicitly selected one of your numbered options this turn. Treat that option as definitively chosen and execute it immediately."
          : !parsedPlayerInput.gmQueryMode
            ? "If the player response closely matches one of the available options, treat it as a commitment to that course of action."
            : "Keep the answer in clarification mode.",
        parsedPlayerInput.gmQueryMode
          ? "Do not consume time or advance the clock during a GM question."
          : "Treat a committed action as already decided and immediately narrate the first concrete consequence, obstacle, reveal, or next beat caused by that choice.",
        parsedPlayerInput.gmQueryMode
          ? "Keep the answer informational and static."
          : "Do not re-explain or recap facts the player already knows unless something about them has changed.",
        parsedPlayerInput.gmQueryMode
          ? "Avoid introducing new actionable branches."
          : "On every normal in-world turn, change at least one of: the situation, the clock, the immediate risk, the available options, or the current position of the characters.",
        parsedPlayerInput.gmQueryMode
          ? "Do not progress to the next dramatic beat during a GM question."
          : "Do not produce another planning conversation in the same scene after the player has chosen a plan or committed to a course of action.",
        parsedPlayerInput.gmQueryMode
          ? "Keep the scene frozen for clarification."
          : "In static scenes such as waiting, custody, interrogation, stealth setup, or travel delay, jump directly to the next irreversible procedural beat instead of lingering in repeated discussion.",
        "Return concise in-world narration plus any immediate mechanical consequence that matters.",
      ].join(" "),
    },
    {
      role: "user",
      content: [
        `Campaign title: ${campaign.title}`,
        `Campaign ruleset: ${campaign.ruleset}`,
        "",
        "Party state:",
        partySummary,
        "",
        "Combat state:",
        combatSummary,
        "",
        "Campaign bootstrap state:",
        bootstrapSummary,
        "",
        "Characters:",
        characterSummary,
        "",
        explicitOptionSelection ? "Latest GM context:" : "Recent transcript:",
        explicitOptionSelection ? latestGmContext : recentTranscript,
        "",
        parsedPlayerInput.gmQueryMode
          ? `Direct GM question: ${parsedPlayerInput.promptMessage}`
          : !explicitOptionSelection
            ? `New player action: ${parsedPlayerInput.promptMessage}`
            : [
                `The player explicitly selected numbered option ${(selectedOptionNumbers as number[]).join(", ")}.`,
                "Treat this as a committed decision that is already being carried out right now.",
                `Execute this selected option immediately: ${parsedPlayerInput.promptMessage}`,
              ].join("\n"),
      ].join("\n"),
    },
  ];
  if (debugStateLoggingEnabled) {
    const systemPromptChars = modelInput[0]?.content?.length ?? 0;
    const userPromptChars = modelInput[1]?.content?.length ?? 0;
    const transcriptContext =
      explicitOptionSelection ? latestGmContext : recentTranscript;
    phaseTimings.promptSystemChars = systemPromptChars;
    phaseTimings.promptUserChars = userPromptChars;
    phaseTimings.promptTotalChars = systemPromptChars + userPromptChars;
    phaseTimings.promptApproxTokens = Math.ceil(
      (systemPromptChars + userPromptChars) / 4,
    );
    phaseTimings.promptCharacterSummaryChars = characterSummary.length;
    phaseTimings.promptPartySummaryChars = partySummary.length;
    phaseTimings.promptCombatSummaryChars = combatSummary.length;
    phaseTimings.promptBootstrapSummaryChars = bootstrapSummary.length;
    phaseTimings.promptTranscriptChars = transcriptContext.length;
    phaseTimings.promptMessageChars = parsedPlayerInput.promptMessage.length;
  }

  const structuredResponseStart = Date.now();
  const { text, extractedScene, extractedParty, extractedBootstrap, extractedState, trace } =
      await requestStructuredGmResponse(
        modelInput,
        characterSummary,
        campaign.characters.map((character) => ({ name: character.name })),
        chatModel,
        {
          lowLatency: explicitOptionSelection && !parsedPlayerInput.gmQueryMode,
        },
      );
    phaseTimings.structuredResponseMs = Date.now() - structuredResponseStart;
    if (trace && typeof trace === "object") {
      Object.assign(phaseTimings, {
        structuredFirstModelMs:
          typeof (trace as Record<string, unknown>).firstModelMs === "number"
            ? ((trace as Record<string, unknown>).firstModelMs as number)
            : 0,
        structuredRetryModelMs:
          typeof (trace as Record<string, unknown>).retryModelMs === "number"
            ? ((trace as Record<string, unknown>).retryModelMs as number)
            : 0,
        structuredStateRepairMs:
          typeof (trace as Record<string, unknown>).stateRepairMs === "number"
            ? ((trace as Record<string, unknown>).stateRepairMs as number)
            : 0,
        structuredUsedRetry:
          Boolean((trace as Record<string, unknown>).usedRetry),
        structuredLowLatencyAccepted:
          Boolean((trace as Record<string, unknown>).lowLatencyAccepted),
      });
    }
    const parsedVisibleResponseContent = extractStateBlock(
      extractCampaignBootstrapBlock(
        extractCombatBlock(extractPartyBlock(extractedScene.content).content).content,
      ).content,
    ).content;
    const visibleResponseContent = (() => {
      const parsed = parsedVisibleResponseContent.trim();
      if (parsed) {
        return parsed;
      }
      if (typeof text === "string" && text.trim()) {
        const sanitized = sanitizeVisibleGmContent(text);
        return sanitized || text.trim();
      }
      return "The situation advances. What do you do next?";
    })();
    const parsedBaseMessages = parseResponseMessages(visibleResponseContent, companionNames);
    const shouldSkipCompanionRepair =
      explicitOptionSelection && !parsedPlayerInput.gmQueryMode;
    const companionRepairStart = Date.now();
    const parsedMessages = shouldSkipCompanionRepair
      ? parsedBaseMessages
      : await repairCompanionMessagesWithPersonality({
          messages: parsedBaseMessages,
          companionProfiles: companionBehaviorProfiles,
          chatModel,
        });
    phaseTimings.companionRepairMs = Date.now() - companionRepairStart;
    phaseTimings.companionRepairSkipped = shouldSkipCompanionRepair;
    const stateUpdates = extractedState.found ? extractedState.updates : [];
    const partyUpdate: PartyUpdateInstruction =
      extractedParty.found ? extractedParty.update : {};
    const extractedCombat = extractCombatBlock(extractedParty.content);
    const bootstrapUpdate: CampaignBootstrapTurnUpdate =
      extractedBootstrap.found
        ? normalizeCampaignBootstrapTurnUpdate(extractedBootstrap.update)
        : {};
    const combatUpdate =
      extractedCombat.found && extractedCombat.update ? extractedCombat.update : {};
    const hasStructuredCombatUpdate = Object.keys(combatUpdate).length > 0;
    const hasStructuredCombatStartRequest =
      hasStructuredCombatUpdate && combatUpdate.combatActive === true;
    const structuredStartCandidate =
      !parsedPlayerInput.gmQueryMode &&
      hasStructuredCombatStartRequest
        ? combatUpdate
        : null;
    const previousCombatState = normalizeCombatState(
      (campaign as { combatStateJson?: unknown }).combatStateJson,
    );
    const inferredCombatStartRaw =
      !parsedPlayerInput.gmQueryMode && !hasStructuredCombatStartRequest
        ? inferCombatStartFromNarration(
            visibleResponseContent,
            campaign.characters.map((character) => character.name),
          )
        : null;
    const promptForcedCombatStart =
      !parsedPlayerInput.gmQueryMode &&
      !hasStructuredCombatStartRequest &&
      !inferredCombatStartRaw &&
      hasDirectCombatStartIntent(parsedPlayerInput.promptMessage)
        ? buildPromptForcedCombatStart(
            visibleResponseContent,
            campaign.characters.map((character) => character.name),
          )
        : null;
    if (debugStateLoggingEnabled) {
      console.log("[chat] promptUserContent", modelInput[1]?.content ?? "");
      console.log(
        "[chat] playerInput",
        JSON.stringify(
          {
            originalMessage: parsedPlayerInput.originalMessage,
            promptMessage: parsedPlayerInput.promptMessage,
            gmQueryMode: parsedPlayerInput.gmQueryMode,
            selectedOptionNumbers: Array.isArray(selectedOptionNumbers)
              ? selectedOptionNumbers
              : [],
            explicitOptionSelection,
          },
          null,
          2,
        ),
      );
      console.log("[chat] visibleResponseContent", visibleResponseContent);
      console.log("[chat] parsedMessages", JSON.stringify(parsedMessages, null, 2));
      console.log("[chat] stateUpdates", JSON.stringify(stateUpdates, null, 2));
      console.log("[chat] partyUpdate", JSON.stringify(partyUpdate, null, 2));
      console.log("[chat] combatUpdate", JSON.stringify(combatUpdate, null, 2));
      console.log("[chat] bootstrapUpdate", JSON.stringify(bootstrapUpdate, null, 2));
    }
    const safeScene = buildFallbackSceneSummary(campaign);
    const effectiveScene = parsedPlayerInput.gmQueryMode
      ? safeScene
      : (extractedScene.scene ?? safeScene);
    const combatStartCandidate =
      structuredStartCandidate ?? inferredCombatStartRaw ?? promptForcedCombatStart;
    const combatStartCandidateSource = structuredStartCandidate
      ? "structured"
      : inferredCombatStartRaw
        ? "inferred"
        : promptForcedCombatStart
          ? "prompt-forced"
        : "none";
    const combatTriggerDecision =
      !parsedPlayerInput.gmQueryMode && combatStartCandidate
        ? evaluateCombatTriggerDecision({
            inferredCombatStart: combatStartCandidate,
            narrationText: visibleResponseContent,
            playerPrompt: parsedPlayerInput.promptMessage,
            scene: effectiveScene,
            bootstrap: currentBootstrap,
            explicitOptionSelection,
          })
        : null;
    if (combatTriggerDecision) {
      phaseTimings.combatTriggerDecision = combatTriggerDecision.decision;
      phaseTimings.combatTriggerScore = combatTriggerDecision.score;
      phaseTimings.combatTriggerThreshold = combatTriggerDecision.threshold;
      phaseTimings.combatTriggerReasonCount = combatTriggerDecision.reasons.length;
      phaseTimings.combatTriggerSource = combatStartCandidateSource;
    }
    const approvedCombatStart =
      combatTriggerDecision?.decision === "START_COMBAT" ? combatStartCandidate : null;
    const inferredCombatStart =
      combatStartCandidateSource === "inferred" ? approvedCombatStart : null;
    const combatStartShadow =
      approvedCombatStart &&
      Array.isArray(approvedCombatStart.roster) &&
      approvedCombatStart.roster.length > 0
        ? buildInitiativeState({
            seeds: approvedCombatStart.roster.map((entry) => ({
              id: typeof entry.id === "string" ? entry.id : undefined,
              name: entry.name,
              type: entry.type,
              summary: entry.summary,
              hp: entry.hp,
              statusEffects: entry.statusEffects,
            })),
            activeName:
              approvedCombatStart.roster.find((entry) => entry.active)?.name ?? undefined,
            round:
              typeof approvedCombatStart.round === "number"
                ? approvedCombatStart.round
                : 1,
            seedInput: buildCombatShadowSeedInput({
              campaignId,
              messageCount: campaign.messages.length,
              narrationText: visibleResponseContent,
            }),
          })
        : null;
    const effectiveStateUpdates =
      parsedPlayerInput.gmQueryMode || engineCombatModeEnabled === true
        ? []
        : stateUpdates;
    const basePartyUpdate: PartyUpdateInstruction = parsedPlayerInput.gmQueryMode
      ? {}
      : partyUpdate;
    const currentPartyState = normalizePartyState(
      (campaign as { partyStateJson?: unknown }).partyStateJson,
    );
    const projectedPartyState = applyPartyUpdate(currentPartyState, basePartyUpdate);
    const inferredMajorQuest =
      !parsedPlayerInput.gmQueryMode &&
      projectedPartyState.activeQuests.length === 0 &&
      !(
        Array.isArray(basePartyUpdate.completedQuestsAdd) &&
        basePartyUpdate.completedQuestsAdd.length > 0
      )
        ? inferMajorQuestFromScene(effectiveScene, visibleResponseContent)
        : null;
    const effectivePartyUpdate: PartyUpdateInstruction =
      inferredMajorQuest &&
      !projectedPartyState.activeQuests.some(
        (quest) => normalizeQuestKey(quest) === normalizeQuestKey(inferredMajorQuest),
      )
        ? {
            ...basePartyUpdate,
            activeQuests: [inferredMajorQuest],
          }
        : basePartyUpdate;
    const inferredCombatEnd =
      !parsedPlayerInput.gmQueryMode &&
      !hasStructuredCombatUpdate &&
      previousCombatState.combatActive &&
      detectCombatEndFromNarration(visibleResponseContent);
    const effectiveCombatUpdate: Partial<CombatState> = parsedPlayerInput.gmQueryMode
      ? {}
      : inferredCombatEnd
        ? {
            combatActive: false,
            round: 1,
            turnIndex: 0,
            roster: [],
          }
        : approvedCombatStart
          ? structuredStartCandidate
            ? combatUpdate
            : approvedCombatStart
          : structuredStartCandidate
            ? {}
        : enforceCombatTurnProgression(
            previousCombatState,
            combatUpdate,
            visibleResponseContent,
          );
    const bootstrapUpdateWithFallbacks: CampaignBootstrapTurnUpdate =
      parsedPlayerInput.gmQueryMode
        ? {}
        : {
            ...bootstrapUpdate,
            ...(bootstrapUpdate.objective
              ? {}
              : effectiveScene.goal
                ? { objective: effectiveScene.goal }
                : {}),
            ...(bootstrapUpdate.scene_title
              ? {}
              : effectiveScene.sceneTitle
                ? { scene_title: effectiveScene.sceneTitle }
                : {}),
          };
    const bootstrapPolicy = resolveBootstrapTurnPolicy({
      currentBootstrap,
      incomingUpdate: bootstrapUpdateWithFallbacks,
      effectiveScene,
      gmQueryMode: parsedPlayerInput.gmQueryMode,
    });
    const effectiveBootstrapUpdate = bootstrapPolicy.effectiveUpdate;
    const nextNoProgressStreak = bootstrapPolicy.nextNoProgressStreak;
    if (debugStateLoggingEnabled) {
      console.log(
        "[chat] deadlandsResourceRouting",
        JSON.stringify(
          effectiveStateUpdates.map((update) => ({
            name: update.name,
            hasWind: Boolean(
              update.sheet && typeof update.sheet === "object" && "wind" in update.sheet,
            ),
            hasHp: Boolean(
              update.sheet && typeof update.sheet === "object" && "hp" in update.sheet,
            ),
            hasWoundsByLocation: Boolean(
              update.sheet &&
                typeof update.sheet === "object" &&
                "woundsByLocation" in update.sheet,
            ),
            hasFateChips: Boolean(
              update.sheet && typeof update.sheet === "object" && "fateChips" in update.sheet,
            ),
          })),
          null,
          2,
        ),
      );
      console.log(
        "[chat] inferredCombatStart",
        JSON.stringify(inferredCombatStart, null, 2),
      );
      console.log(
        "[chat] combatTriggerDecision",
        JSON.stringify(combatTriggerDecision, null, 2),
      );
      console.log("[chat] combatTriggerSource", combatStartCandidateSource);
      console.log(
        "[chat] combatStartShadow",
        JSON.stringify(combatStartShadow, null, 2),
      );
      console.log("[chat] inferredMajorQuest", inferredMajorQuest ?? "");
      console.log("[chat] effectiveCombatUpdate", JSON.stringify(effectiveCombatUpdate, null, 2));
      console.log(
        "[chat] effectiveBootstrapUpdate",
        JSON.stringify(effectiveBootstrapUpdate, null, 2),
      );
      console.log(
        "[chat] bootstrapLoopPolicy",
        JSON.stringify(
          {
            priorNoProgressStreak: bootstrapPolicy.priorNoProgressStreak,
            nextNoProgressStreak,
            loopBreakerApplied: bootstrapPolicy.loopBreakerApplied,
          },
          null,
          2,
        ),
      );
    }
    const sceneBlock = formatSceneBlock(effectiveScene);
  const persistedStateBlock = formatStateBlock(effectiveStateUpdates);
  const persistedPartyBlock = formatPartyBlock(effectivePartyUpdate);
  const persistedCombatBlock = formatCombatBlock(effectiveCombatUpdate);
  const persistedBootstrapBlock = formatCampaignBootstrapBlock(effectiveBootstrapUpdate);

  await prisma.message.create({
    data: {
      campaignId,
      speakerName: mainCharacterName,
      role: "user",
      content: parsedPlayerInput.originalMessage,
    },
  });

  const updatedCharacters = [...campaign.characters];
  const updatedPartyStateBase = applyPartyUpdate(
    (campaign as { partyStateJson?: unknown }).partyStateJson,
    effectivePartyUpdate,
  );
  const updatedPartyState =
    !parsedPlayerInput.gmQueryMode && shouldAutoRefreshRecap(effectivePartyUpdate)
      ? {
          ...updatedPartyStateBase,
          recap: await generateCampaignRecap({
            campaignTitle: campaign.title,
            ruleset: campaign.ruleset,
            partyState: updatedPartyStateBase,
            recentMessages: [
              ...campaign.messages.map((message) => ({
                speakerName: message.speakerName,
                role: message.role,
                content: message.content,
              })),
              {
                speakerName: mainCharacterName,
                role: "user",
                content: parsedPlayerInput.originalMessage,
              },
              {
                speakerName: "GM",
                role: "gm",
                content: visibleResponseContent,
              },
            ],
          }),
        }
      : updatedPartyStateBase;
  const updatedCombatState = applyCombatUpdate(
    (campaign as { combatStateJson?: unknown }).combatStateJson,
    effectiveCombatUpdate,
  );
  const updatedBootstrapBase = applyCampaignBootstrapTurnUpdate(
    currentBootstrap,
    effectiveBootstrapUpdate,
  );
  const updatedBootstrap = withBootstrapNoProgressStreak(
    updatedBootstrapBase,
    nextNoProgressStreak,
  );

  const characterUpdateOperations = effectiveStateUpdates
    .map((updateInstruction) => {
      const matchingCharacter = updatedCharacters.find(
        (character) =>
          character.name.toLowerCase() === updateInstruction.name.toLowerCase(),
      );

      if (!matchingCharacter) {
        return null;
      }

      const nextSheetJson = updateInstruction.sheet
        ? mergeSheetData(matchingCharacter.sheetJson, updateInstruction.sheet)
        : matchingCharacter.sheetJson;
      const nextMemorySummary =
        typeof updateInstruction.memorySummary === "string" &&
        updateInstruction.memorySummary
          ? updateInstruction.memorySummary
          : matchingCharacter.memorySummary;

      return prisma.character.update({
        where: { id: matchingCharacter.id },
        data: {
          sheetJson: nextSheetJson,
          memorySummary: nextMemorySummary,
        },
      });
    })
    .filter(
      (
        operation,
      ): operation is ReturnType<typeof prisma.character.update> =>
        operation !== null,
    );

  const characterPersistStart = Date.now();
  const persistedCharacterUpdates = characterUpdateOperations.length
    ? await Promise.all(characterUpdateOperations)
    : [];
  phaseTimings.characterPersistMs = Date.now() - characterPersistStart;

  for (const updatedCharacter of persistedCharacterUpdates) {
    const index = updatedCharacters.findIndex(
      (character) => character.id === updatedCharacter.id,
    );

    if (index >= 0) {
      updatedCharacters[index] = updatedCharacter;
    }
  }

  const buildMessageCreateOperations = () =>
    parsedMessages.map((parsedMessage, index) => {
      const content =
        parsedMessage.role === "gm" && index === 0
          ? `${sceneBlock}\n\n${persistedPartyBlock}\n\n${persistedCombatBlock}\n\n${persistedBootstrapBlock}\n\n${persistedStateBlock}\n\n${parsedMessage.content}`
          : parsedMessage.content;

      return prisma.message.create({
        data: {
          campaignId,
          speakerName: parsedMessage.speakerName,
          role: parsedMessage.role,
          content,
        },
      });
    });

  let createdMessages: Array<{ content: string }> = [];
  let bootstrapPersisted = true;

  try {
    const campaignPersistStart = Date.now();
    createdMessages = await prisma.$transaction([
      prisma.campaign.update({
        where: { id: campaignId },
        data: {
          partyStateJson: updatedPartyState,
          combatStateJson: updatedCombatState,
          bootstrapJson: updatedBootstrap,
        } as never,
      }),
      ...buildMessageCreateOperations(),
    ]);
    phaseTimings.campaignPersistMs = Date.now() - campaignPersistStart;
    phaseTimings.campaignPersistFallback = false;
  } catch (bootstrapPersistError) {
    bootstrapPersisted = false;
    console.error(
      "[chat] bootstrap persistence failed; retrying without bootstrap update",
      bootstrapPersistError,
    );
    const campaignPersistFallbackStart = Date.now();
    createdMessages = await prisma.$transaction([
      prisma.campaign.update({
        where: { id: campaignId },
        data: {
          partyStateJson: updatedPartyState,
          combatStateJson: updatedCombatState,
        } as never,
      }),
      ...buildMessageCreateOperations(),
    ]);
    phaseTimings.campaignPersistMs = Date.now() - campaignPersistFallbackStart;
    phaseTimings.campaignPersistFallback = true;
  }
  phaseTimings.totalRequestMs = Date.now() - postRequestStart;
  if (debugStateLoggingEnabled) {
    console.log("[chat] timing", JSON.stringify(phaseTimings, null, 2));
  }

  return NextResponse.json({
      reply: createdMessages[1]?.content ?? text,
      messages: createdMessages.slice(1),
      characters: updatedCharacters,
      partyStateJson: updatedPartyState,
      combatStateJson: updatedCombatState,
      bootstrapPublicJson: projectCampaignBootstrapForPlayer(updatedBootstrap),
      ...(debugStateLoggingEnabled
        ? {
            debug: {
              scene: effectiveScene,
              stateUpdates: effectiveStateUpdates,
              partyUpdate: effectivePartyUpdate,
              combatUpdate: effectiveCombatUpdate,
              bootstrapUpdate: effectiveBootstrapUpdate,
              combatShadow: combatStartShadow,
              bootstrap: updatedBootstrap,
              bootstrapPersisted,
              timings: phaseTimings,
            },
          }
        : {}),
    });
  }

