export type ProgressionMode = "character" | "party" | "milestone";
export type ProgressionCurrency = "xp" | "bounty";

export type ProgressionEvent = {
  id: string;
  createdAt: string;
  amount: number;
  reason: string;
  note: string;
  recipientType: "party" | "character";
  characterIds: string[];
  currency: ProgressionCurrency;
};

export type ProgressionCharacterTotal = {
  characterId: string;
  total: number;
};

export type ProgressionState = {
  mode: ProgressionMode;
  currency: ProgressionCurrency;
  autoApplyLevels: boolean;
  partyTotal: number;
  characterTotals: ProgressionCharacterTotal[];
  updatedAt: string;
};

export type ProgressionCharacterInsight = {
  characterId: string;
  total: number;
  currentLevel: number;
  suggestedLevel: number;
  nextLevel: number | null;
  nextTarget: number | null;
  remainingToNext: number | null;
  readyToLevel: boolean;
};

export type ProgressionInsights = {
  maxLevel: number;
  levelLabel: string;
  party: {
    total: number;
    suggestedLevel: number;
    nextLevel: number | null;
    nextTarget: number | null;
    remainingToNext: number | null;
  };
  characters: ProgressionCharacterInsight[];
};

export const DEFAULT_PROGRESSION_STATE: ProgressionState = {
  mode: "character",
  currency: "xp",
  autoApplyLevels: false,
  partyTotal: 0,
  characterTotals: [],
  updatedAt: new Date(0).toISOString(),
};

type ProgressionTrackStep = {
  level: number;
  minimumTotal: number;
};

const DND_XP_THRESHOLDS: ProgressionTrackStep[] = [
  { level: 1, minimumTotal: 0 },
  { level: 2, minimumTotal: 300 },
  { level: 3, minimumTotal: 900 },
  { level: 4, minimumTotal: 2700 },
  { level: 5, minimumTotal: 6500 },
  { level: 6, minimumTotal: 14000 },
  { level: 7, minimumTotal: 23000 },
  { level: 8, minimumTotal: 34000 },
  { level: 9, minimumTotal: 48000 },
  { level: 10, minimumTotal: 64000 },
  { level: 11, minimumTotal: 85000 },
  { level: 12, minimumTotal: 100000 },
  { level: 13, minimumTotal: 120000 },
  { level: 14, minimumTotal: 140000 },
  { level: 15, minimumTotal: 165000 },
  { level: 16, minimumTotal: 195000 },
  { level: 17, minimumTotal: 225000 },
  { level: 18, minimumTotal: 265000 },
  { level: 19, minimumTotal: 305000 },
  { level: 20, minimumTotal: 355000 },
];

function normalizeRulesetKey(value: string) {
  return value.trim().toLowerCase();
}

function isDndRuleset(value: string) {
  const normalized = normalizeRulesetKey(value);
  return normalized.includes("d&d") || normalized.includes("dnd");
}

function isDeadlandsRuleset(value: string) {
  return normalizeRulesetKey(value).includes("deadlands");
}

export function getDefaultProgressionCurrencyForRuleset(ruleset: string): ProgressionCurrency {
  return isDeadlandsRuleset(ruleset) ? "bounty" : "xp";
}

function buildLinearTrack(params: {
  maxLevel: number;
  firstLevelTotal: number;
  increment: number;
}) {
  const steps: ProgressionTrackStep[] = [];

  for (let level = 1; level <= params.maxLevel; level += 1) {
    steps.push({
      level,
      minimumTotal: params.firstLevelTotal + (level - 1) * params.increment,
    });
  }

  return steps;
}

function getProgressionTrack(params: {
  ruleset: string;
  currency: ProgressionCurrency;
  mode: ProgressionMode;
}) {
  if (params.mode === "milestone") {
    return {
      steps: buildLinearTrack({
        maxLevel: 20,
        firstLevelTotal: 0,
        increment: 1,
      }),
      maxLevel: 20,
      levelLabel: isDeadlandsRuleset(params.ruleset) ? "Rank" : "Level",
    };
  }

  if (isDndRuleset(params.ruleset) && params.currency === "xp") {
    return {
      steps: DND_XP_THRESHOLDS,
      maxLevel: 20,
      levelLabel: "Level",
    };
  }

  if (isDeadlandsRuleset(params.ruleset) || params.currency === "bounty") {
    return {
      steps: buildLinearTrack({
        maxLevel: 20,
        firstLevelTotal: 0,
        increment: 5,
      }),
      maxLevel: 20,
      levelLabel: "Rank",
    };
  }

  return {
    steps: buildLinearTrack({
      maxLevel: 20,
      firstLevelTotal: 0,
      increment: 1000,
    }),
    maxLevel: 20,
    levelLabel: "Level",
  };
}

function getSuggestedLevelForTotal(total: number, track: ProgressionTrackStep[]) {
  const normalizedTotal = Number.isFinite(total) ? Math.max(0, Math.trunc(total)) : 0;
  let suggestedLevel = track[0]?.level ?? 1;

  for (const step of track) {
    if (normalizedTotal >= step.minimumTotal) {
      suggestedLevel = step.level;
      continue;
    }
    break;
  }

  return suggestedLevel;
}

function getNextStep(level: number, track: ProgressionTrackStep[]) {
  return track.find((step) => step.level === level + 1) ?? null;
}

function parseIntegerLike(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed);
    }
  }

  return null;
}

function getCharacterCurrentLevel(
  sheetJson: Record<string, unknown> | null,
  maxLevel: number,
) {
  if (!sheetJson) {
    return 1;
  }

  const explicitLevel = parseIntegerLike(sheetJson.level);
  if (explicitLevel !== null) {
    return Math.max(1, Math.min(maxLevel, explicitLevel));
  }

  return 1;
}

function normalizeProgressionMode(value: unknown): ProgressionMode {
  if (value === "party" || value === "milestone") {
    return value;
  }

  return "character";
}

function normalizeProgressionCurrency(value: unknown): ProgressionCurrency {
  if (value === "bounty") {
    return "bounty";
  }

  return "xp";
}

function normalizeProgressionAmount(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed);
    }
  }

  return 0;
}

function normalizeCharacterIds(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim());
}

function normalizeProgressionEvent(value: unknown): ProgressionEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const typedValue = value as Record<string, unknown>;
  const id = typeof typedValue.id === "string" && typedValue.id.trim() ? typedValue.id.trim() : "";
  const reason =
    typeof typedValue.reason === "string" && typedValue.reason.trim()
      ? typedValue.reason.trim()
      : "";

  if (!id || !reason) {
    return null;
  }

  const createdAt =
    typeof typedValue.createdAt === "string" && typedValue.createdAt.trim()
      ? typedValue.createdAt.trim()
      : new Date().toISOString();
  const note =
    typeof typedValue.note === "string" && typedValue.note.trim()
      ? typedValue.note.trim()
      : "";
  const recipientType =
    typedValue.recipientType === "character" ? "character" : "party";

  return {
    id,
    createdAt,
    amount: normalizeProgressionAmount(typedValue.amount),
    reason,
    note,
    recipientType,
    characterIds: normalizeCharacterIds(typedValue.characterIds),
    currency: normalizeProgressionCurrency(typedValue.currency),
  };
}

export function normalizeProgressionEvents(value: unknown): ProgressionEvent[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => normalizeProgressionEvent(entry))
    .filter((entry): entry is ProgressionEvent => Boolean(entry))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function normalizeProgressionState(value: unknown): ProgressionState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      ...DEFAULT_PROGRESSION_STATE,
      updatedAt: new Date().toISOString(),
    };
  }

  const typedValue = value as Record<string, unknown>;
  const characterTotals = Array.isArray(typedValue.characterTotals)
    ? typedValue.characterTotals
        .map((entry) => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            return null;
          }
          const typedEntry = entry as Record<string, unknown>;
          const characterId =
            typeof typedEntry.characterId === "string" && typedEntry.characterId.trim()
              ? typedEntry.characterId.trim()
              : "";
          if (!characterId) {
            return null;
          }

          return {
            characterId,
            total: normalizeProgressionAmount(typedEntry.total),
          } satisfies ProgressionCharacterTotal;
        })
        .filter(
          (entry): entry is ProgressionCharacterTotal => Boolean(entry),
        )
    : [];

  return {
    mode: normalizeProgressionMode(typedValue.mode),
    currency: normalizeProgressionCurrency(typedValue.currency),
    autoApplyLevels: typedValue.autoApplyLevels === true,
    partyTotal: normalizeProgressionAmount(typedValue.partyTotal),
    characterTotals,
    updatedAt:
      typeof typedValue.updatedAt === "string" && typedValue.updatedAt.trim()
        ? typedValue.updatedAt.trim()
        : new Date().toISOString(),
  };
}

export function buildProgressionStateFromEvents(params: {
  events: ProgressionEvent[];
  characterIds: string[];
  baseState?: ProgressionState | null;
}) {
  const baseState = params.baseState ?? DEFAULT_PROGRESSION_STATE;
  const totalsByCharacterId = new Map<string, number>();

  for (const characterId of params.characterIds) {
    totalsByCharacterId.set(characterId, 0);
  }

  let partyTotal = 0;
  let lastCurrency: ProgressionCurrency = baseState.currency;

  for (const event of params.events) {
    partyTotal += event.amount;
    lastCurrency = event.currency;

    if (event.recipientType === "party") {
      for (const characterId of params.characterIds) {
        totalsByCharacterId.set(
          characterId,
          (totalsByCharacterId.get(characterId) ?? 0) + event.amount,
        );
      }
      continue;
    }

    for (const characterId of event.characterIds) {
      totalsByCharacterId.set(
        characterId,
        (totalsByCharacterId.get(characterId) ?? 0) + event.amount,
      );
    }
  }

  return {
    mode: baseState.mode,
    currency: lastCurrency,
    autoApplyLevels: baseState.autoApplyLevels === true,
    partyTotal,
    characterTotals: [...totalsByCharacterId.entries()]
      .map(([characterId, total]) => ({ characterId, total }))
      .sort((left, right) => left.characterId.localeCompare(right.characterId)),
    updatedAt: new Date().toISOString(),
  } satisfies ProgressionState;
}

export function buildProgressionInsights(params: {
  ruleset: string;
  state: ProgressionState;
  characters: Array<{
    id: string;
    sheetJson: Record<string, unknown> | null;
  }>;
}) {
  const track = getProgressionTrack({
    ruleset: params.ruleset,
    currency: params.state.currency,
    mode: params.state.mode,
  });
  const totalByCharacterId = new Map(
    params.state.characterTotals.map((entry) => [entry.characterId, entry.total]),
  );
  const characters = params.characters.map((character) => {
    const total =
      params.state.mode === "character"
        ? totalByCharacterId.get(character.id) ?? 0
        : params.state.partyTotal;
    const suggestedLevel = getSuggestedLevelForTotal(total, track.steps);
    const currentLevel = getCharacterCurrentLevel(character.sheetJson, track.maxLevel);
    const nextStep = getNextStep(suggestedLevel, track.steps);

    return {
      characterId: character.id,
      total,
      currentLevel,
      suggestedLevel,
      nextLevel: nextStep?.level ?? null,
      nextTarget: nextStep?.minimumTotal ?? null,
      remainingToNext:
        nextStep && total < nextStep.minimumTotal ? nextStep.minimumTotal - total : null,
      readyToLevel: suggestedLevel > currentLevel,
    } satisfies ProgressionCharacterInsight;
  });

  const partySuggestedLevel = getSuggestedLevelForTotal(params.state.partyTotal, track.steps);
  const partyNextStep = getNextStep(partySuggestedLevel, track.steps);

  return {
    maxLevel: track.maxLevel,
    levelLabel: track.levelLabel,
    party: {
      total: params.state.partyTotal,
      suggestedLevel: partySuggestedLevel,
      nextLevel: partyNextStep?.level ?? null,
      nextTarget: partyNextStep?.minimumTotal ?? null,
      remainingToNext:
        partyNextStep && params.state.partyTotal < partyNextStep.minimumTotal
          ? partyNextStep.minimumTotal - params.state.partyTotal
          : null,
    },
    characters,
  } satisfies ProgressionInsights;
}
