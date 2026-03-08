import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
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

function inferStateUpdatesFromText(
  text: string,
  campaign: {
    characters: Array<{
      name: string;
      isMainCharacter: boolean;
    }>;
  },
) {
  const combinedText = text;
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

  const lineTargetsMainCharacter = (value: string) => {
    if (!mainCharacter) {
      return false;
    }

    const escapedMainName = mainCharacter.name.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    );

    return (
      /\b(you|your)\b/i.test(value) ||
      new RegExp(`\\b${escapedMainName}(?:['’]s)?\\b`, "i").test(value)
    );
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
          `${escapedName}(?:['’]s)?[^\\n.]*?${resourcePattern.source}`,
          "i",
        ),
      );

      if (namedMatch?.[1]) {
        foundNamedMatch = true;
        pushSheetPatch(character.name, buildPatch(Number(namedMatch[1])));
      }
    }

    if (!mainCharacter || foundNamedMatch || !lineTargetsMainCharacter(combinedText)) {
      return;
    }

    const genericMatch = combinedText.match(new RegExp(resourcePattern.source, "i"));
    if (genericMatch?.[1]) {
      pushSheetPatch(mainCharacter.name, buildPatch(Number(genericMatch[1])));
    }
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
          `${escapedName}(?:['’]s)?[^\\n.]*?${effectPattern.source}`,
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
          new RegExp(`${escapedName}(?:['’]s)?[^\\n]{0,220}`, "gi"),
        ),
      );

      for (const lineMatch of lineMatches) {
        const snippet = lineMatch[0];

        if (!triggerPattern.test(snippet)) {
          continue;
        }

        const cleanedSnippet = snippet
          .replace(/[*_`]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        const normalizedLabel = normalizeEffectLabel(snippet);

        if (!normalizedLabel || normalizedLabel === cleanedSnippet) {
          continue;
        }

        foundNamedMatch = true;
        pushSheetPatch(character.name, buildEffectPatch(normalizedLabel));
      }
    }

    if (!mainCharacter || foundNamedMatch) {
      return;
    }

    for (const line of combinedText.split("\n")) {
      if (!triggerPattern.test(line) || !lineTargetsMainCharacter(line)) {
        continue;
      }

      const cleanedLine = line.replace(/[*_`]/g, " ").replace(/\s+/g, " ").trim();
      const normalizedLabel = normalizeEffectLabel(line);

      if (!normalizedLabel || normalizedLabel === cleanedLine) {
        continue;
      }

      pushSheetPatch(mainCharacter.name, buildEffectPatch(normalizedLabel));
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
      /\b(?:Status|Condition):\s*([A-Za-z][A-Za-z0-9 +'-]{1,40})/gi,
    ),
  ).map((match) => match[1].trim());
  if (statusAddMatches.length > 0 && mainCharacter && lineTargetsMainCharacter(combinedText)) {
    pushSheetPatch(mainCharacter.name, {
      statusEffects: [...new Set(statusAddMatches)],
    });
  }

  const buffMatches = Array.from(
    combinedText.matchAll(/\bBuff:\s*([A-Za-z][A-Za-z0-9 +,'-]{1,60})/gi),
  ).map((match) => match[1].trim());
  if (buffMatches.length > 0 && mainCharacter && lineTargetsMainCharacter(combinedText)) {
    pushSheetPatch(mainCharacter.name, {
      temporaryBuffs: [...new Set(buffMatches)],
    });
  }

  const debuffMatches = Array.from(
    combinedText.matchAll(/\bDebuff:\s*([A-Za-z][A-Za-z0-9 +,'-]{1,60})/gi),
  ).map((match) => match[1].trim());
  if (debuffMatches.length > 0 && mainCharacter && lineTargetsMainCharacter(combinedText)) {
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
          role: true,
          content: true,
        },
      },
    },
  });

  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const rebuiltCharacters = campaign.characters.map((character) => ({
    ...character,
    sheetJson: resetTransientEffectArrays(character.sheetJson),
  }));

  for (const message of campaign.messages) {
    if (message.role === "user") {
      continue;
    }

    const stateBlock = extractStateBlock(stripSceneBlock(message.content));
    const content = stateBlock.content;
    const updates = stateBlock.found
      ? stateBlock.updates
      : content
        ? inferStateUpdatesFromText(content, {
            characters: rebuiltCharacters.map((character) => ({
              name: character.name,
              isMainCharacter: character.isMainCharacter,
            })),
          })
        : [];

    if (updates.length === 0) {
      continue;
    }

    for (const update of updates) {
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

  const updatedCharacters = await prisma.$transaction(
    rebuiltCharacters.map((character) =>
      prisma.character.update({
        where: { id: character.id },
        data: {
          sheetJson: character.sheetJson,
        },
      }),
    ),
  );

  return NextResponse.json({
    characters: updatedCharacters,
  });
}
