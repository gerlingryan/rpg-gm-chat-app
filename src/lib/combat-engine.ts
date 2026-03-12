import {
  type CombatRosterEntry,
  type CombatState,
  type CombatStatusDuration,
  normalizeCombatState,
} from "@/lib/combat";

export type InitiativeRollLogEntry = {
  combatantId: string;
  combatantName: string;
  mode?: "d20" | "deadlands-cards";
  roll: number;
  modifier: number;
  total: number;
  drawnCards?: string[];
  chosenCard?: string;
};

export type InitiativeBuildResult = {
  state: CombatState;
  rollLog: InitiativeRollLogEntry[];
};

type EngineCombatantSeed = {
  id?: string;
  name: string;
  type: CombatRosterEntry["type"];
  summary?: string;
  hp?: string;
  statusEffects?: string[];
  statusDurations?: CombatStatusDuration[];
  initiativeModifier?: number;
};

type AttackActionInput = {
  actor: string;
  target: string;
  profile?: "dnd" | "deadlands" | "generic";
  attackDie?: number;
  attackBonus?: number;
  targetAc?: number;
  damageDie?: number;
  damageDiceCount?: number;
  damageBonus?: number;
  targetConSaveBonus?: number;
  seedInput: string;
};

type SaveActionInput = {
  actor: string;
  target: string;
  profile?: "dnd" | "deadlands" | "generic";
  saveAbility: "str" | "dex" | "con" | "int" | "wis" | "cha";
  saveDc: number;
  saveBonus?: number;
  damageDie?: number;
  damageDiceCount?: number;
  damageBonus?: number;
  targetConSaveBonus?: number;
  onSave?: "none" | "half";
  onFailedSaveTargetStatusEffects?: string[];
  advanceTurn?: boolean;
  seedInput: string;
};

type UtilityActionInput = {
  actor: string;
  kind:
    | "defend"
    | "pass"
    | "help"
    | "disengage"
    | "dash"
    | "take-cover"
    | "aim"
    | "surrender"
    | "attempt-escape";
  profile?: "dnd" | "deadlands" | "generic";
  seedInput?: string;
};

export type AttackResolution = {
  kind?: "attack";
  profile?: "dnd" | "deadlands" | "generic";
  actor: string;
  target: string;
  attackDie: number;
  attackRoll: number;
  attackRollSecondary?: number;
  attackRollMode?: "normal" | "advantage" | "disadvantage";
  attackBonus: number;
  attackTotal: number;
  targetLabel: "AC" | "TN";
  targetAc: number;
  raises?: number;
  hit: boolean;
  damageDie: number;
  damageRoll: number;
  damageRolls?: number[];
  damageDiceCount?: number;
  raiseBonusRoll?: number;
  damageBonus: number;
  damageTotal: number;
  resourceLabel: "HP" | "Wind";
  targetHpBefore?: string;
  targetHpAfter?: string;
  targetWoundsBefore?: number;
  targetWoundsAfter?: number;
  targetWoundLocation?: "head" | "guts" | "leftArm" | "rightArm" | "leftLeg" | "rightLeg";
  targetWoundLocationBefore?: number;
  targetWoundLocationAfter?: number;
  targetIncapacitated?: boolean;
  concentrationCheck?: {
    required: boolean;
    dc: number;
    roll: number;
    bonus: number;
    total: number;
    success: boolean;
    concentrationBroken: boolean;
  };
  turnAdvanced: boolean;
};

export type SaveResolution = {
  kind: "cast-spell";
  profile?: "dnd" | "deadlands" | "generic";
  delivery: "save";
  actor: string;
  target: string;
  saveAbility: "str" | "dex" | "con" | "int" | "wis" | "cha";
  saveRoll: number;
  saveBonus: number;
  saveTotal: number;
  saveDc: number;
  saveSucceeded: boolean;
  saveOnSuccess: "none" | "half";
  damageDie: number;
  damageDiceCount: number;
  damageBonus: number;
  damageRollTotal: number;
  damageTotal: number;
  resourceLabel: "HP" | "Wind";
  targetHpBefore?: string;
  targetHpAfter?: string;
  effectsApplied?: string[];
  concentrationCheck?: {
    required: boolean;
    dc: number;
    roll: number;
    bonus: number;
    total: number;
    success: boolean;
    concentrationBroken: boolean;
  };
  turnAdvanced: boolean;
};

export type AutoHitResolution = {
  kind: "cast-spell";
  profile?: "dnd" | "deadlands" | "generic";
  delivery: "auto-hit";
  actor: string;
  target: string;
  damageDie: number;
  damageDiceCount: number;
  damageBonus: number;
  damageRolls: number[];
  damageTotal: number;
  resourceLabel: "HP" | "Wind";
  targetHpBefore?: string;
  targetHpAfter?: string;
  concentrationCheck?: {
    required: boolean;
    dc: number;
    roll: number;
    bonus: number;
    total: number;
    success: boolean;
    concentrationBroken: boolean;
  };
  turnAdvanced: boolean;
};

export type UtilityResolution = {
  kind:
    | "defend"
    | "pass"
    | "help"
    | "disengage"
    | "dash"
    | "take-cover"
    | "aim"
    | "surrender"
    | "attempt-escape";
  actor: string;
  detail: string;
  escapeCheck?: {
    die: number;
    roll: number;
    dc: number;
    success: boolean;
  };
  combatEnded?: boolean;
  combatOutcome?: "surrendered" | "escaped" | "escape-failed";
  turnAdvanced: boolean;
};

const TRANSIENT_DEFENSIVE_EFFECTS = new Set([
  "Defending",
  "In Cover",
  "Reaction Used",
  "Shielded",
]);

function stableHash32(value: string) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function createDeterministicRng(seed: string) {
  let state = stableHash32(seed) || 1;

  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0xffffffff;
  };
}

function rollD20(nextRandom: () => number) {
  return Math.max(1, Math.min(20, Math.floor(nextRandom() * 20) + 1));
}

function rollDie(nextRandom: () => number, sides: number) {
  const safeSides = Math.max(1, Math.trunc(sides));
  return Math.max(1, Math.min(safeSides, Math.floor(nextRandom() * safeSides) + 1));
}

function rollExplodingDie(nextRandom: () => number, sides: number, maxExplosions = 5) {
  const safeSides = Math.max(2, Math.trunc(sides));
  let total = 0;
  let roll = rollDie(nextRandom, safeSides);
  let explosions = 0;
  total += roll;

  while (roll === safeSides && explosions < maxExplosions) {
    roll = rollDie(nextRandom, safeSides);
    total += roll;
    explosions += 1;
  }

  return total;
}

function normalizeName(value: string) {
  return value.trim().toLowerCase();
}

export function buildInitiativeState(params: {
  seeds: EngineCombatantSeed[];
  seedInput: string;
  profile?: "dnd" | "deadlands" | "generic";
  deadlandsJokerEffectsEnabled?: boolean;
  round?: number;
  activeName?: string;
}) {
  const seeds = params.seeds.filter((seed) => seed.name.trim().length > 0);

  if (seeds.length === 0) {
    return {
      state: normalizeCombatState({ combatActive: false, round: 1, turnIndex: 0, roster: [] }),
      rollLog: [],
    } satisfies InitiativeBuildResult;
  }

  const nextRandom = createDeterministicRng(params.seedInput);
  const profile = params.profile ?? "generic";
  const deadlandsJokerEffectsEnabled = params.deadlandsJokerEffectsEnabled === true;
  const rollLog: InitiativeRollLogEntry[] = [];
  const deadlandsDeck = buildDeadlandsDeck();
  const drawFromDeck = () => {
    if (deadlandsDeck.length === 0) {
      deadlandsDeck.push(...buildDeadlandsDeck());
    }
    const index = Math.floor(nextRandom() * deadlandsDeck.length);
    const [card] = deadlandsDeck.splice(Math.max(0, Math.min(deadlandsDeck.length - 1, index)), 1);
    return card ?? "2C";
  };

  const scored = seeds.map((seed, index) => {
    const modifier = Number.isFinite(seed.initiativeModifier) ? Number(seed.initiativeModifier) : 0;
    const combatantId = seed.id?.trim() || `seed-${index}-${normalizeName(seed.name)}`;
    if (profile === "deadlands") {
      const drawCount = getDeadlandsInitiativeDrawCount(modifier);
      const drawnCards = Array.from({ length: drawCount }, () => drawFromDeck());
      const chosenCard = drawnCards.reduce((best, current) =>
        compareDeadlandsCards(current, best) > 0 ? current : best,
      );
      const total = deadlandsCardScore(chosenCard);
      rollLog.push({
        combatantId,
        combatantName: seed.name,
        mode: "deadlands-cards",
        roll: total,
        modifier,
        total,
        drawnCards,
        chosenCard,
      });

      return {
        seed,
        combatantId,
        total,
        roll: total,
        chosenCard,
        index,
      };
    }

    const roll = rollD20(nextRandom);
    const total = roll + modifier;
    rollLog.push({
      combatantId,
      combatantName: seed.name,
      mode: "d20",
      roll,
      modifier,
      total,
    });

    return {
      seed,
      combatantId,
      total,
      roll,
      index,
    };
  });

  scored.sort((left, right) => {
    if (right.total !== left.total) {
      return right.total - left.total;
    }
    if (right.roll !== left.roll) {
      return right.roll - left.roll;
    }
    const nameCompare = left.seed.name.localeCompare(right.seed.name, undefined, {
      sensitivity: "base",
    });
    if (nameCompare !== 0) {
      return nameCompare;
    }
    return left.index - right.index;
  });

  const defaultActiveName = params.activeName?.trim().toLowerCase() ?? "";
  let activeIndex = 0;

  if (defaultActiveName) {
    const foundIndex = scored.findIndex(
      (entry) => normalizeName(entry.seed.name) === defaultActiveName,
    );
    if (foundIndex >= 0) {
      activeIndex = foundIndex;
    }
  }

  const roster: CombatRosterEntry[] = scored.map((entry, index) => ({
    id: entry.seed.id,
    name: entry.seed.name,
    type: entry.seed.type,
    initiative: entry.total,
    active: index === activeIndex,
    summary: entry.seed.summary,
    hp: entry.seed.hp,
    statusEffects: [
      ...(entry.seed.statusEffects ?? []),
      ...(profile === "deadlands" &&
      deadlandsJokerEffectsEnabled &&
      entry.chosenCard &&
      /^J[RB]$/i.test(entry.chosenCard)
        ? ["Joker"]
        : []),
    ],
    statusDurations: normalizeStatusDurations(entry.seed.statusDurations),
  }));

  return {
    state: normalizeCombatState({
      combatActive: true,
      round: Math.max(1, Math.trunc(params.round ?? 1)),
      turnIndex: activeIndex,
      roster,
    }),
    rollLog,
  } satisfies InitiativeBuildResult;
}

type DeadlandsCard = {
  rank: string;
  suit: "C" | "D" | "H" | "S" | "R" | "B";
};

function buildDeadlandsDeck() {
  const ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
  const suits: Array<DeadlandsCard["suit"]> = ["C", "D", "H", "S"];
  const cards: string[] = [];
  for (const rank of ranks) {
    for (const suit of suits) {
      cards.push(`${rank}${suit}`);
    }
  }
  cards.push("JR");
  cards.push("JB");
  return cards;
}

function parseDeadlandsCard(card: string): DeadlandsCard {
  const trimmed = card.trim().toUpperCase();
  if (trimmed === "JR") {
    return { rank: "JOKER", suit: "R" };
  }
  if (trimmed === "JB") {
    return { rank: "JOKER", suit: "B" };
  }
  const match = trimmed.match(/^(10|[2-9JQKA])([CDHS])$/);
  if (!match) {
    return { rank: "2", suit: "C" };
  }
  return { rank: match[1], suit: match[2] as DeadlandsCard["suit"] };
}

function deadlandsCardScore(card: string) {
  const parsed = parseDeadlandsCard(card);
  if (parsed.rank === "JOKER") {
    return parsed.suit === "R" ? 2000 : 1999;
  }
  const rankScore: Record<string, number> = {
    "2": 2,
    "3": 3,
    "4": 4,
    "5": 5,
    "6": 6,
    "7": 7,
    "8": 8,
    "9": 9,
    "10": 10,
    J: 11,
    Q: 12,
    K: 13,
    A: 14,
  };
  const suitScore: Record<Exclude<DeadlandsCard["suit"], "R" | "B">, number> = {
    C: 1,
    D: 2,
    H: 3,
    S: 4,
  };

  return rankScore[parsed.rank] * 10 + suitScore[parsed.suit as "C" | "D" | "H" | "S"];
}

function compareDeadlandsCards(left: string, right: string) {
  return deadlandsCardScore(left) - deadlandsCardScore(right);
}

function getDeadlandsInitiativeDrawCount(quicknessStep: number) {
  const step = Math.max(1, Math.min(5, Math.trunc(quicknessStep)));
  if (step <= 2) {
    return 1;
  }
  if (step <= 4) {
    return 2;
  }
  return 3;
}

export function advanceTurn(state: unknown) {
  const normalized = normalizeCombatState(state);

  if (!normalized.combatActive || normalized.roster.length === 0) {
    return normalized;
  }

  const currentIndex = normalized.roster.findIndex((entry) => entry.active);
  const safeCurrentIndex = currentIndex >= 0 ? currentIndex : normalized.turnIndex;
  let nextIndex = safeCurrentIndex;
  let checked = 0;
  while (checked < normalized.roster.length) {
    nextIndex = (nextIndex + 1) % normalized.roster.length;
    const candidateAtTurnStart = tickStatusDurationsForTurnStart(
      removeTransientDefensiveEffectsForTurnStart(normalized.roster[nextIndex], true),
    );
    if (!isCombatantUnableToAct(candidateAtTurnStart)) {
      break;
    }
    checked += 1;
  }

  if (checked >= normalized.roster.length) {
    return normalizeCombatState({
      combatActive: false,
      round: 1,
      turnIndex: 0,
      roster: [],
    });
  }

  const roundIncrement = nextIndex <= safeCurrentIndex ? 1 : 0;

  return normalizeCombatState({
    ...normalized,
    round: normalized.round + roundIncrement,
    turnIndex: nextIndex,
    roster: normalized.roster.map((entry, index) => ({
      ...(index === nextIndex
        ? tickStatusDurationsForTurnStart(
            removeTransientDefensiveEffectsForTurnStart(entry, true),
          )
        : removeTransientDefensiveEffectsForTurnStart(entry, false)),
      active: index === nextIndex,
    })),
  });
}

function parseHp(value: string | undefined) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  const slashMatch = trimmed.match(/(-?\d+)\s*\/\s*(-?\d+)/);
  if (slashMatch) {
    const current = Number(slashMatch[1]);
    const max = Number(slashMatch[2]);
    if (Number.isFinite(current) && Number.isFinite(max) && max >= 0) {
      return {
        current: Math.max(0, Math.min(max, Math.trunc(current))),
        max: Math.max(0, Math.trunc(max)),
        format: "fraction" as const,
      };
    }
  }

  const numericMatch = trimmed.match(/-?\d+/);
  const numeric = numericMatch ? Number(numericMatch[0]) : Number.NaN;
  if (Number.isFinite(numeric)) {
    return {
      current: Math.max(0, Math.trunc(numeric)),
      max: null,
      format: "numeric" as const,
    };
  }

  return null;
}

function formatHp(current: number, max: number | null) {
  if (max === null) {
    return String(current);
  }

  return `${Math.max(0, Math.min(max, current))}/${max}`;
}

function normalizeStatusEffects(value: string[] | undefined) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }
  return value.map((entry) => entry.trim()).filter(Boolean);
}

function normalizeStatusDurations(value: CombatStatusDuration[] | undefined) {
  if (!Array.isArray(value)) {
    return [] as CombatStatusDuration[];
  }
  return value
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      effect: String(entry.effect ?? "").trim(),
      remainingRounds: Math.max(0, Math.trunc(Number(entry.remainingRounds ?? 0))),
      source:
        typeof entry.source === "string" && entry.source.trim().length > 0
          ? entry.source.trim()
          : undefined,
      kind:
        entry.kind === "concentration" || entry.kind === "timed"
          ? entry.kind
          : undefined,
      breakOnDamage: entry.breakOnDamage === true,
    }))
    .filter((entry) => entry.effect.length > 0 && entry.remainingRounds > 0);
}

function removeConcentrationDurations(durations: CombatStatusDuration[]) {
  return durations.filter(
    (entry) =>
      !(entry.kind === "concentration" || entry.effect.trim().toLowerCase() === "concentrating"),
  );
}

function syncEntryStatusEffectsWithDurations(entry: CombatRosterEntry) {
  const durations = normalizeStatusDurations(entry.statusDurations);
  const durationEffects = new Set(
    durations.map((duration) => duration.effect.trim().toLowerCase()).filter(Boolean),
  );
  const statusEffects = normalizeStatusEffects(entry.statusEffects);
  const filteredStatusEffects = statusEffects.filter((effect) => {
    const lowered = effect.trim().toLowerCase();
    if (lowered === "concentrating" && !durationEffects.has("concentrating")) {
      return false;
    }
    return true;
  });
  for (const duration of durations) {
    const effect = duration.effect.trim();
    if (!effect) {
      continue;
    }
    if (!filteredStatusEffects.some((existing) => existing.toLowerCase() === effect.toLowerCase())) {
      filteredStatusEffects.push(effect);
    }
  }
  return {
    ...entry,
    statusEffects: filteredStatusEffects,
    statusDurations: durations,
  };
}

function hasStatusEffect(entry: CombatRosterEntry, effect: string) {
  return normalizeStatusEffects(entry.statusEffects).some(
    (current) => current.toLowerCase() === effect.toLowerCase(),
  );
}

function hasActiveConcentration(entry: CombatRosterEntry) {
  const durations = normalizeStatusDurations(entry.statusDurations);
  return durations.some(
    (duration) =>
      duration.kind === "concentration" ||
      duration.effect.trim().toLowerCase() === "concentrating",
  );
}

function hasAnyStatusEffect(entry: CombatRosterEntry, patterns: string[]) {
  const lowered = normalizeStatusEffects(entry.statusEffects).map((value) => value.toLowerCase());
  return patterns.some((pattern) =>
    lowered.some((status) => status.includes(pattern.toLowerCase())),
  );
}

function addStatusEffect(entry: CombatRosterEntry, effect: string) {
  const existing = normalizeStatusEffects(entry.statusEffects);
  if (existing.some((current) => current.toLowerCase() === effect.toLowerCase())) {
    return entry;
  }
  return {
    ...entry,
    statusEffects: [...existing, effect],
  };
}

function removeStatusEffect(entry: CombatRosterEntry, effect: string) {
  const filtered = normalizeStatusEffects(entry.statusEffects).filter(
    (current) => current.toLowerCase() !== effect.toLowerCase(),
  );
  return {
    ...entry,
    statusEffects: filtered,
  };
}

function tickStatusDurationsForTurnStart(entry: CombatRosterEntry) {
  const durations = normalizeStatusDurations(entry.statusDurations);
  if (durations.length === 0) {
    return syncEntryStatusEffectsWithDurations(entry);
  }
  const decremented = durations
    .map((duration) => ({
      ...duration,
      remainingRounds: Math.max(0, duration.remainingRounds - 1),
    }))
    .filter((duration) => duration.remainingRounds > 0);
  return syncEntryStatusEffectsWithDurations({
    ...entry,
    statusDurations: decremented,
  });
}

function resolveConcentrationDamageCheck(params: {
  entry: CombatRosterEntry;
  damageTotal: number;
  conSaveBonus?: number;
  nextRandom: () => number;
  profile: "dnd" | "deadlands" | "generic";
}) {
  if (params.profile !== "dnd" || params.damageTotal <= 0) {
    return {
      entry: params.entry,
      check: null as AttackResolution["concentrationCheck"] | null,
    };
  }
  if (!hasActiveConcentration(params.entry)) {
    return {
      entry: params.entry,
      check: null as AttackResolution["concentrationCheck"] | null,
    };
  }
  const concentrationDurations = normalizeStatusDurations(params.entry.statusDurations).filter(
    (duration) =>
      duration.kind === "concentration" ||
      duration.effect.trim().toLowerCase() === "concentrating",
  );
  if (concentrationDurations.length === 0) {
    return {
      entry: params.entry,
      check: null as AttackResolution["concentrationCheck"] | null,
    };
  }
  if (!concentrationDurations.some((duration) => duration.breakOnDamage !== false)) {
    return {
      entry: params.entry,
      check: null as AttackResolution["concentrationCheck"] | null,
    };
  }
  const dc = Math.max(10, Math.floor(params.damageTotal / 2));
  const roll = rollD20(params.nextRandom);
  const bonus = Number.isFinite(params.conSaveBonus) ? Math.trunc(Number(params.conSaveBonus)) : 0;
  const total = roll + bonus;
  const success = total >= dc;
  if (success) {
    return {
      entry: params.entry,
      check: {
        required: true,
        dc,
        roll,
        bonus,
        total,
        success: true,
        concentrationBroken: false,
      },
    };
  }

  const nextDurations = removeConcentrationDurations(
    normalizeStatusDurations(params.entry.statusDurations),
  );
  const withoutConcentrating = removeStatusEffect(params.entry, "Concentrating");
  const updated = syncEntryStatusEffectsWithDurations({
    ...withoutConcentrating,
    statusDurations: nextDurations,
  });

  return {
    entry: updated,
    check: {
      required: true,
      dc,
      roll,
      bonus,
      total,
      success: false,
      concentrationBroken: true,
    },
  };
}

function upsertDeadlandsWoundsSummary(summary: string | undefined, wounds: number) {
  const safeWounds = Math.max(0, Math.min(4, Math.trunc(wounds)));
  const base = typeof summary === "string" ? summary.trim() : "";
  const woundToken = `Wounds ${safeWounds}/4`;
  if (!base) {
    return woundToken;
  }

  if (/wounds?\s+\d+\s*\/\s*4/i.test(base)) {
    return base.replace(/wounds?\s+\d+\s*\/\s*4/i, woundToken);
  }

  return `${base}, ${woundToken}`;
}

function deadlandsWoundLocationLabel(
  location: "head" | "guts" | "leftArm" | "rightArm" | "leftLeg" | "rightLeg",
) {
  switch (location) {
    case "head":
      return "Head";
    case "guts":
      return "Guts";
    case "leftArm":
      return "Left Arm";
    case "rightArm":
      return "Right Arm";
    case "leftLeg":
      return "Left Leg";
    case "rightLeg":
      return "Right Leg";
  }
}

function rollDeadlandsHitLocation(nextRandom: () => number) {
  const roll = rollDie(nextRandom, 20);
  if (roll <= 2) {
    return "head" as const;
  }
  if (roll <= 8) {
    return "guts" as const;
  }
  if (roll <= 11) {
    return "leftArm" as const;
  }
  if (roll <= 14) {
    return "rightArm" as const;
  }
  if (roll <= 17) {
    return "leftLeg" as const;
  }
  return "rightLeg" as const;
}

function parseDeadlandsWoundsFromEntry(entry: CombatRosterEntry) {
  const fromStatus = normalizeStatusEffects(entry.statusEffects).find((effect) =>
    /^wounds\s+\d+$/i.test(effect),
  );
  if (fromStatus) {
    const match = fromStatus.match(/(\d+)/);
    if (match) {
      const parsed = Number(match[1]);
      if (Number.isFinite(parsed)) {
        return Math.max(0, Math.min(4, Math.trunc(parsed)));
      }
    }
  }

  const summary = entry.summary ?? "";
  const summaryMatch = summary.match(/wounds?\s+(\d+)\s*\/\s*4/i);
  if (summaryMatch) {
    const parsed = Number(summaryMatch[1]);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.min(4, Math.trunc(parsed)));
    }
  }

  return 0;
}

function deadlandsWoundsFromDamage(
  damageTotal: number,
  location: "head" | "guts" | "leftArm" | "rightArm" | "leftLeg" | "rightLeg",
) {
  // Deadlands-style severity bands from raw damage.
  // 0-4 no wound, 5-9 one, 10-14 two, 15-19 three, 20+ four.
  let baseWounds = 0;
  if (damageTotal >= 5) {
    baseWounds = 1 + Math.floor((damageTotal - 5) / 5);
  }
  baseWounds = Math.max(0, Math.min(4, baseWounds));

  // Head/guts are more lethal: add one extra wound when any wound is dealt.
  if (baseWounds > 0 && (location === "head" || location === "guts")) {
    baseWounds += 1;
  }

  return Math.max(0, Math.min(4, baseWounds));
}

function isCombatantUnableToAct(entry: CombatRosterEntry) {
  const parsed = parseHp(entry.hp);
  if (parsed && parsed.current <= 0) {
    return true;
  }

  const statusEffects = normalizeStatusEffects(entry.statusEffects).map((effect) =>
    effect.toLowerCase(),
  );
  if (
    statusEffects.some((effect) =>
      /^(unconscious|incapacitated|dead|defeated|out of action)$/.test(effect),
    )
  ) {
    return true;
  }

  if (statusEffects.some((effect) => /^wounds\s+4$/.test(effect))) {
    return true;
  }

  return false;
}

function removeTransientDefensiveEffectsForTurnStart(
  entry: CombatRosterEntry,
  isTurnOwner: boolean,
) {
  if (!isTurnOwner) {
    return entry;
  }
  const filtered = normalizeStatusEffects(entry.statusEffects).filter(
    (effect) => !TRANSIENT_DEFENSIVE_EFFECTS.has(effect),
  );
  return {
    ...entry,
    statusEffects: filtered,
  };
}

function findRosterIndexByRef(roster: CombatRosterEntry[], ref: string) {
  const normalizedRef = normalizeName(ref);
  return roster.findIndex((entry) => {
    if (entry.id && normalizeName(entry.id) === normalizedRef) {
      return true;
    }
    return normalizeName(entry.name) === normalizedRef;
  });
}

export function resolveAttackAction(currentState: unknown, input: AttackActionInput) {
  const state = normalizeCombatState(currentState);
  if (!state.combatActive || state.roster.length === 0) {
    return {
      state,
      resolution: null as AttackResolution | null,
      error: "Combat is not active.",
    };
  }

  const actorIndex = findRosterIndexByRef(state.roster, input.actor);
  if (actorIndex < 0) {
    return {
      state,
      resolution: null as AttackResolution | null,
      error: "Actor was not found in combat roster.",
    };
  }

  const targetIndex = findRosterIndexByRef(state.roster, input.target);
  if (targetIndex < 0) {
    return {
      state,
      resolution: null as AttackResolution | null,
      error: "Target was not found in combat roster.",
    };
  }

  if (actorIndex === targetIndex) {
    return {
      state,
      resolution: null as AttackResolution | null,
      error: "Actor and target must be different combatants.",
    };
  }

  const activeIndex = state.roster.findIndex((entry) => entry.active);
  if (activeIndex >= 0 && activeIndex !== actorIndex) {
    return {
      state,
      resolution: null as AttackResolution | null,
      error: `It is currently ${state.roster[activeIndex]?.name}'s turn.`,
    };
  }

  const nextRandom = createDeterministicRng(input.seedInput);
  const profile = input.profile ?? "generic";
  const attackBonus = Number.isFinite(input.attackBonus) ? Number(input.attackBonus) : 0;
  const attackDie =
    Number.isFinite(input.attackDie) && Number(input.attackDie) > 0
      ? Math.trunc(Number(input.attackDie))
      : profile === "deadlands"
        ? 10
        : 20;
  const actorBefore = state.roster[actorIndex];
  const targetBefore = state.roster[targetIndex];
  const aimedBonus = hasStatusEffect(actorBefore, "Aimed") ? 2 : 0;
  const jokerBonus = hasStatusEffect(actorBefore, "Joker") ? 2 : 0;
  const defendingBonus = hasStatusEffect(targetBefore, "Defending") ? 2 : 0;
  const coverBonus = hasStatusEffect(targetBefore, "In Cover") ? 2 : 0;
  const targetAcBase = Number.isFinite(input.targetAc) ? Number(input.targetAc) : 10;
  const targetAc = targetAcBase + defendingBonus + coverBonus;
  const damageDie = Number.isFinite(input.damageDie) ? Number(input.damageDie) : 8;
  const damageDiceCount =
    Number.isFinite(input.damageDiceCount) && Number(input.damageDiceCount) > 0
      ? Math.trunc(Number(input.damageDiceCount))
      : 1;
  const damageBonus = Number.isFinite(input.damageBonus) ? Number(input.damageBonus) : 0;
  const hasGrantedAdvantage = hasAnyStatusEffect(targetBefore, [
    "grant advantage",
    "illuminated",
    "exposed",
  ]);
  const hasGrantedDisadvantage = hasAnyStatusEffect(actorBefore, ["disadvantaged"]);
  const hasActorAdvantage = hasAnyStatusEffect(actorBefore, ["advantage next attack"]);
  const rollMode =
    profile === "deadlands"
      ? "normal"
      : hasGrantedAdvantage || hasActorAdvantage
        ? hasGrantedDisadvantage
          ? "normal"
          : "advantage"
        : hasGrantedDisadvantage
          ? "disadvantage"
          : "normal";

  const primaryAttackRoll =
    profile === "deadlands"
      ? rollExplodingDie(nextRandom, attackDie)
      : rollD20(nextRandom);
  const secondaryAttackRoll =
    profile === "deadlands" || rollMode === "normal" ? undefined : rollD20(nextRandom);
  const attackRoll =
    secondaryAttackRoll === undefined
      ? primaryAttackRoll
      : rollMode === "advantage"
        ? Math.max(primaryAttackRoll, secondaryAttackRoll)
        : Math.min(primaryAttackRoll, secondaryAttackRoll);
  const attackTotal = attackRoll + attackBonus + aimedBonus + jokerBonus;
  const hit = attackTotal >= targetAc;
  const raises =
    profile === "deadlands" && hit ? Math.max(0, Math.floor((attackTotal - targetAc) / 5)) : 0;
  const damageRolls =
    hit && profile !== "deadlands"
      ? Array.from({ length: damageDiceCount }, () => rollDie(nextRandom, damageDie))
      : [];
  const damageRoll = hit
    ? profile === "deadlands"
      ? rollExplodingDie(nextRandom, damageDie)
      : damageRolls.reduce((sum, roll) => sum + roll, 0)
    : 0;
  const raiseBonusRoll =
    hit && profile === "deadlands" && raises >= 1 ? rollExplodingDie(nextRandom, 6) : 0;
  const damageTotal = hit
    ? Math.max(0, damageRoll + raiseBonusRoll + damageBonus + jokerBonus)
    : 0;
  const parsedHp = parseHp(targetBefore.hp);
  const nextRoster = [...state.roster];
  let targetHpBefore: string | undefined;
  let targetHpAfter: string | undefined;
  let targetWoundsBefore: number | undefined;
  let targetWoundsAfter: number | undefined;
  let targetWoundLocation:
    | "head"
    | "guts"
    | "leftArm"
    | "rightArm"
    | "leftLeg"
    | "rightLeg"
    | undefined;
  let targetWoundLocationBefore: number | undefined;
  let targetWoundLocationAfter: number | undefined;
  let targetIncapacitated: boolean | undefined;
  let concentrationCheck: AttackResolution["concentrationCheck"] | undefined;

  if (parsedHp) {
    targetHpBefore = formatHp(parsedHp.current, parsedHp.max);
    const nextCurrent = Math.max(0, parsedHp.current - damageTotal);
    targetHpAfter = formatHp(nextCurrent, parsedHp.max);
    nextRoster[targetIndex] = {
      ...targetBefore,
      hp: targetHpAfter,
    };

    if (profile === "deadlands") {
      const woundLocation = rollDeadlandsHitLocation(nextRandom);
      const incomingWounds = deadlandsWoundsFromDamage(damageTotal, woundLocation);
      const priorWounds = parseDeadlandsWoundsFromEntry(targetBefore);
      const nextWounds = Math.max(0, Math.min(4, priorWounds + incomingWounds));
      const woundLocationLabel = deadlandsWoundLocationLabel(woundLocation);
      const summaryText = targetBefore.summary ?? "";
      const locationPattern = new RegExp(`${woundLocationLabel}\\s+(\\d+)`, "i");
      const previousLocationMatch = summaryText.match(locationPattern);
      const previousLocationWounds = previousLocationMatch
        ? Math.max(0, Math.min(4, Math.trunc(Number(previousLocationMatch[1]))))
        : 0;
      const nextLocationWounds = Math.max(
        0,
        Math.min(4, previousLocationWounds + incomingWounds),
      );
      const woundEffect = `Wounds ${nextWounds}`;
      targetWoundsBefore = priorWounds;
      targetWoundsAfter = nextWounds;
      targetWoundLocation = woundLocation;
      targetWoundLocationBefore = previousLocationWounds;
      targetWoundLocationAfter = nextLocationWounds;
      const withoutExistingWoundTag = normalizeStatusEffects(
        nextRoster[targetIndex].statusEffects,
      ).filter((effect) => !/^wounds\s+\d+$/i.test(effect));
      const withoutIncapacitated = withoutExistingWoundTag.filter(
        (effect) => effect.toLowerCase() !== "incapacitated",
      );
      const isIncapacitated = nextCurrent <= 0 || nextLocationWounds >= 4 || nextWounds >= 4;
      targetIncapacitated = isIncapacitated;
      const nextStatusEffects = [...withoutIncapacitated];
      if (nextWounds > 0) {
        nextStatusEffects.push(woundEffect);
      }
      if (isIncapacitated) {
        nextStatusEffects.push("Incapacitated");
      }
      const strippedLocationSummary = summaryText
        .replace(/\b(Head|Guts|Left Arm|Right Arm|Left Leg|Right Leg)\s+\d+\b/gi, "")
        .replace(/\s+,/g, ",")
        .replace(/,\s*,/g, ",")
        .replace(/^,|,$/g, "")
        .trim();
      const locationSummary = [strippedLocationSummary, `${woundLocationLabel} ${nextLocationWounds}`]
        .filter(Boolean)
        .join(strippedLocationSummary ? ", " : "");
      nextRoster[targetIndex] = {
        ...nextRoster[targetIndex],
        statusEffects: nextStatusEffects,
        summary: upsertDeadlandsWoundsSummary(locationSummary, nextWounds),
      };
    }
  }
  if (hit) {
    const concentrationResult = resolveConcentrationDamageCheck({
      entry: nextRoster[targetIndex],
      damageTotal,
      conSaveBonus: input.targetConSaveBonus,
      nextRandom,
      profile,
    });
    nextRoster[targetIndex] = concentrationResult.entry;
    concentrationCheck = concentrationResult.check ?? undefined;
  }
  if (aimedBonus > 0 || jokerBonus > 0) {
    let actorAfter = nextRoster[actorIndex];
    if (aimedBonus > 0) {
      actorAfter = removeStatusEffect(actorAfter, "Aimed");
    }
    if (jokerBonus > 0) {
      actorAfter = removeStatusEffect(actorAfter, "Joker");
    }
    nextRoster[actorIndex] = actorAfter;
  }
  if (hasActorAdvantage) {
    nextRoster[actorIndex] = removeStatusEffect(nextRoster[actorIndex], "Advantage Next Attack");
  }
  if (hasGrantedAdvantage) {
    nextRoster[targetIndex] = removeStatusEffect(nextRoster[targetIndex], "Grant Advantage");
    nextRoster[targetIndex] = removeStatusEffect(nextRoster[targetIndex], "Illuminated");
    nextRoster[targetIndex] = removeStatusEffect(nextRoster[targetIndex], "Exposed");
  }

  const baseState = normalizeCombatState({
    ...state,
    roster: nextRoster.map((entry, index) => ({
      ...entry,
      active: index === actorIndex,
    })),
    turnIndex: actorIndex,
  });
  const advancedState = advanceTurn(baseState);

  return {
    state: advancedState,
    resolution: {
      actor: state.roster[actorIndex].name,
      target: state.roster[targetIndex].name,
      kind: "attack",
      profile,
      attackDie,
      attackRoll,
      attackRollSecondary: secondaryAttackRoll,
      attackRollMode: rollMode,
      attackBonus,
      attackTotal,
      targetLabel: profile === "deadlands" ? "TN" : "AC",
      targetAc,
      raises,
      hit,
      damageDie,
      damageRoll,
      damageRolls,
      damageDiceCount,
      raiseBonusRoll,
      damageBonus,
      damageTotal,
      resourceLabel: profile === "deadlands" ? "Wind" : "HP",
      targetHpBefore,
      targetHpAfter,
      targetWoundsBefore,
      targetWoundsAfter,
      targetWoundLocation,
      targetWoundLocationBefore,
      targetWoundLocationAfter,
      targetIncapacitated,
      concentrationCheck,
      turnAdvanced: true,
    } satisfies AttackResolution,
    error: null as string | null,
  };
}

export function resolveSaveAction(currentState: unknown, input: SaveActionInput) {
  const state = normalizeCombatState(currentState);
  if (!state.combatActive || state.roster.length === 0) {
    return {
      state,
      resolution: null as SaveResolution | null,
      error: "Combat is not active.",
    };
  }

  const actorIndex = findRosterIndexByRef(state.roster, input.actor);
  if (actorIndex < 0) {
    return {
      state,
      resolution: null as SaveResolution | null,
      error: "Actor was not found in combat roster.",
    };
  }

  const targetIndex = findRosterIndexByRef(state.roster, input.target);
  if (targetIndex < 0) {
    return {
      state,
      resolution: null as SaveResolution | null,
      error: "Target was not found in combat roster.",
    };
  }

  if (actorIndex === targetIndex) {
    return {
      state,
      resolution: null as SaveResolution | null,
      error: "Actor and target must be different combatants.",
    };
  }

  const activeIndex = state.roster.findIndex((entry) => entry.active);
  if (activeIndex >= 0 && activeIndex !== actorIndex) {
    return {
      state,
      resolution: null as SaveResolution | null,
      error: `It is currently ${state.roster[activeIndex]?.name}'s turn.`,
    };
  }

  const nextRandom = createDeterministicRng(input.seedInput);
  const profile = input.profile ?? "generic";
  const saveBonus = Number.isFinite(input.saveBonus) ? Math.trunc(Number(input.saveBonus)) : 0;
  const saveDc = Math.max(1, Math.trunc(input.saveDc));
  const saveRoll = rollD20(nextRandom);
  const saveTotal = saveRoll + saveBonus;
  const saveSucceeded = saveTotal >= saveDc;
  const damageDie =
    Number.isFinite(input.damageDie) && Number(input.damageDie) > 0
      ? Math.trunc(Number(input.damageDie))
      : 8;
  const damageDiceCount =
    Number.isFinite(input.damageDiceCount) && Number(input.damageDiceCount) > 0
      ? Math.trunc(Number(input.damageDiceCount))
      : 1;
  const damageBonus = Number.isFinite(input.damageBonus) ? Math.trunc(Number(input.damageBonus)) : 0;
  const damageRollTotal = Array.from({ length: damageDiceCount }).reduce(
    (sum) => sum + rollDie(nextRandom, damageDie),
    0,
  );
  const fullDamage = Math.max(0, damageRollTotal + damageBonus);
  const onSave = input.onSave ?? "none";
  const damageTotal = saveSucceeded
    ? onSave === "half"
      ? Math.floor(fullDamage / 2)
      : 0
    : fullDamage;
  const targetBefore = state.roster[targetIndex];
  const parsedHp = parseHp(targetBefore.hp);
  const nextRoster = [...state.roster];
  let targetHpBefore: string | undefined;
  let targetHpAfter: string | undefined;
  const effectsApplied = !saveSucceeded ? input.onFailedSaveTargetStatusEffects ?? [] : [];
  let concentrationCheck: SaveResolution["concentrationCheck"] | undefined;

  if (parsedHp) {
    targetHpBefore = formatHp(parsedHp.current, parsedHp.max);
    const nextCurrent = Math.max(0, parsedHp.current - damageTotal);
    targetHpAfter = formatHp(nextCurrent, parsedHp.max);
    nextRoster[targetIndex] = {
      ...targetBefore,
      hp: targetHpAfter,
      statusEffects:
        effectsApplied.length > 0
          ? [...normalizeStatusEffects(targetBefore.statusEffects), ...effectsApplied]
          : targetBefore.statusEffects,
    };
    const concentrationResult = resolveConcentrationDamageCheck({
      entry: nextRoster[targetIndex],
      damageTotal,
      conSaveBonus: input.targetConSaveBonus,
      nextRandom,
      profile,
    });
    nextRoster[targetIndex] = concentrationResult.entry;
    concentrationCheck = concentrationResult.check ?? undefined;
  }

  const baseState = normalizeCombatState({
    ...state,
    roster: nextRoster.map((entry, index) => ({
      ...entry,
      active: index === actorIndex,
    })),
    turnIndex: actorIndex,
  });
  const shouldAdvanceTurn = input.advanceTurn !== false;
  const advancedState = shouldAdvanceTurn ? advanceTurn(baseState) : baseState;

  return {
    state: advancedState,
    resolution: {
      kind: "cast-spell",
      profile,
      delivery: "save",
      actor: state.roster[actorIndex].name,
      target: state.roster[targetIndex].name,
      saveAbility: input.saveAbility,
      saveRoll,
      saveBonus,
      saveTotal,
      saveDc,
      saveSucceeded,
      saveOnSuccess: onSave,
      damageDie,
      damageDiceCount,
      damageBonus,
      damageRollTotal,
      damageTotal,
      resourceLabel: profile === "deadlands" ? "Wind" : "HP",
      targetHpBefore,
      targetHpAfter,
      effectsApplied,
      concentrationCheck,
      turnAdvanced: true,
    } satisfies SaveResolution,
    error: null as string | null,
  };
}

export function resolveAutoHitAction(currentState: unknown, input: {
  actor: string;
  target: string;
  profile?: "dnd" | "deadlands" | "generic";
  damageDie?: number;
  damageDiceCount?: number;
  damageBonus?: number;
  targetConSaveBonus?: number;
  seedInput: string;
}) {
  const state = normalizeCombatState(currentState);
  if (!state.combatActive || state.roster.length === 0) {
    return {
      state,
      resolution: null as AutoHitResolution | null,
      error: "Combat is not active.",
    };
  }

  const actorIndex = findRosterIndexByRef(state.roster, input.actor);
  if (actorIndex < 0) {
    return {
      state,
      resolution: null as AutoHitResolution | null,
      error: "Actor was not found in combat roster.",
    };
  }

  const targetIndex = findRosterIndexByRef(state.roster, input.target);
  if (targetIndex < 0) {
    return {
      state,
      resolution: null as AutoHitResolution | null,
      error: "Target was not found in combat roster.",
    };
  }

  if (actorIndex === targetIndex) {
    return {
      state,
      resolution: null as AutoHitResolution | null,
      error: "Actor and target must be different combatants.",
    };
  }

  const activeIndex = state.roster.findIndex((entry) => entry.active);
  if (activeIndex >= 0 && activeIndex !== actorIndex) {
    return {
      state,
      resolution: null as AutoHitResolution | null,
      error: `It is currently ${state.roster[activeIndex]?.name}'s turn.`,
    };
  }

  const nextRandom = createDeterministicRng(input.seedInput);
  const profile = input.profile ?? "generic";
  const damageDie =
    Number.isFinite(input.damageDie) && Number(input.damageDie) > 0
      ? Math.trunc(Number(input.damageDie))
      : 4;
  const damageDiceCount =
    Number.isFinite(input.damageDiceCount) && Number(input.damageDiceCount) > 0
      ? Math.trunc(Number(input.damageDiceCount))
      : 1;
  const damageBonus = Number.isFinite(input.damageBonus) ? Math.trunc(Number(input.damageBonus)) : 0;
  const damageRolls = Array.from({ length: damageDiceCount }, () => rollDie(nextRandom, damageDie));
  const damageTotal = Math.max(0, damageRolls.reduce((sum, roll) => sum + roll, 0) + damageBonus);
  const targetBefore = state.roster[targetIndex];
  const parsedHp = parseHp(targetBefore.hp);
  const nextRoster = [...state.roster];
  let targetHpBefore: string | undefined;
  let targetHpAfter: string | undefined;
  let concentrationCheck: AutoHitResolution["concentrationCheck"] | undefined;

  if (parsedHp) {
    targetHpBefore = formatHp(parsedHp.current, parsedHp.max);
    const nextCurrent = Math.max(0, parsedHp.current - damageTotal);
    targetHpAfter = formatHp(nextCurrent, parsedHp.max);
    nextRoster[targetIndex] = {
      ...targetBefore,
      hp: targetHpAfter,
    };
    const concentrationResult = resolveConcentrationDamageCheck({
      entry: nextRoster[targetIndex],
      damageTotal,
      conSaveBonus: input.targetConSaveBonus,
      nextRandom,
      profile,
    });
    nextRoster[targetIndex] = concentrationResult.entry;
    concentrationCheck = concentrationResult.check ?? undefined;
  }

  const baseState = normalizeCombatState({
    ...state,
    roster: nextRoster.map((entry, index) => ({
      ...entry,
      active: index === actorIndex,
    })),
    turnIndex: actorIndex,
  });
  const advancedState = advanceTurn(baseState);

  return {
    state: advancedState,
    resolution: {
      kind: "cast-spell",
      profile,
      delivery: "auto-hit",
      actor: state.roster[actorIndex].name,
      target: state.roster[targetIndex].name,
      damageDie,
      damageDiceCount,
      damageBonus,
      damageRolls,
      damageTotal,
      resourceLabel: profile === "deadlands" ? "Wind" : "HP",
      targetHpBefore,
      targetHpAfter,
      concentrationCheck,
      turnAdvanced: true,
    } satisfies AutoHitResolution,
    error: null as string | null,
  };
}

export function resolveUtilityAction(currentState: unknown, input: UtilityActionInput) {
  const state = normalizeCombatState(currentState);
  if (!state.combatActive || state.roster.length === 0) {
    return {
      state,
      resolution: null as UtilityResolution | null,
      error: "Combat is not active.",
    };
  }

  const actorIndex = findRosterIndexByRef(state.roster, input.actor);
  if (actorIndex < 0) {
    return {
      state,
      resolution: null as UtilityResolution | null,
      error: "Actor was not found in combat roster.",
    };
  }

  const activeIndex = state.roster.findIndex((entry) => entry.active);
  if (activeIndex >= 0 && activeIndex !== actorIndex) {
    return {
      state,
      resolution: null as UtilityResolution | null,
      error: `It is currently ${state.roster[activeIndex]?.name}'s turn.`,
    };
  }

  const nextRoster = [...state.roster];
  const actorName = state.roster[actorIndex].name;
  const profile = input.profile ?? "generic";
  const nextRandom = createDeterministicRng(
    input.seedInput ?? `${actorName}|${input.kind}|utility`,
  );

  if (input.kind === "surrender") {
    return {
      state: normalizeCombatState({
        combatActive: false,
        round: 1,
        turnIndex: 0,
        roster: [],
      }),
      resolution: {
        kind: input.kind,
        actor: actorName,
        detail: `${actorName} surrenders. Combat ends as terms are forced by the opposition.`,
        combatEnded: true,
        combatOutcome: "surrendered",
        turnAdvanced: false,
      } satisfies UtilityResolution,
      error: null as string | null,
    };
  }

  if (input.kind === "attempt-escape") {
    const die = profile === "deadlands" ? 10 : 20;
    const roll = profile === "deadlands" ? rollExplodingDie(nextRandom, die) : rollDie(nextRandom, die);
    const dc = profile === "deadlands" ? 5 : 12;
    const success = roll >= dc;
    if (success) {
      return {
        state: normalizeCombatState({
          combatActive: false,
          round: 1,
          turnIndex: 0,
          roster: [],
        }),
        resolution: {
          kind: input.kind,
          actor: actorName,
          detail: `${actorName} attempts escape: d${die}(${roll}) vs ${
            profile === "deadlands" ? "TN" : "DC"
          } ${dc}. Success. Combat ends as the party disengages.`,
          escapeCheck: {
            die,
            roll,
            dc,
            success,
          },
          combatEnded: true,
          combatOutcome: "escaped",
          turnAdvanced: false,
        } satisfies UtilityResolution,
        error: null as string | null,
      };
    }

    const baseState = normalizeCombatState({
      ...state,
      roster: nextRoster.map((entry, index) => ({
        ...entry,
        active: index === actorIndex,
      })),
      turnIndex: actorIndex,
    });
    const advancedState = advanceTurn(baseState);
    return {
      state: advancedState,
      resolution: {
        kind: input.kind,
        actor: actorName,
        detail: `${actorName} attempts escape: d${die}(${roll}) vs ${
          profile === "deadlands" ? "TN" : "DC"
        } ${dc}. Failed to break away.`,
        escapeCheck: {
          die,
          roll,
          dc,
          success,
        },
        combatEnded: false,
        combatOutcome: "escape-failed",
        turnAdvanced: true,
      } satisfies UtilityResolution,
      error: null as string | null,
    };
  }

  if (input.kind === "defend") {
    nextRoster[actorIndex] = addStatusEffect(nextRoster[actorIndex], "Defending");
  } else if (input.kind === "take-cover") {
    nextRoster[actorIndex] = addStatusEffect(nextRoster[actorIndex], "In Cover");
  } else if (input.kind === "aim") {
    nextRoster[actorIndex] = addStatusEffect(nextRoster[actorIndex], "Aimed");
  }
  if (hasStatusEffect(nextRoster[actorIndex], "Joker")) {
    nextRoster[actorIndex] = removeStatusEffect(nextRoster[actorIndex], "Joker");
  }

  const baseState = normalizeCombatState({
    ...state,
    roster: nextRoster.map((entry, index) => ({
      ...entry,
      active: index === actorIndex,
    })),
    turnIndex: actorIndex,
  });
  const advancedState = advanceTurn(baseState);

  return {
    state: advancedState,
    resolution: {
      kind: input.kind,
      actor: actorName,
      detail: buildUtilityActionDetail(input.kind, actorName),
      turnAdvanced: true,
    } satisfies UtilityResolution,
    error: null as string | null,
  };
}

function buildUtilityActionDetail(
  kind:
    | "defend"
    | "pass"
    | "help"
    | "disengage"
    | "dash"
    | "take-cover"
    | "aim"
    | "surrender"
    | "attempt-escape",
  actorName: string,
) {
  if (kind === "defend") {
    return `${actorName} takes a defensive stance and braces for incoming attacks.`;
  }
  if (kind === "help") {
    return `${actorName} helps an ally and improves the party's tactical position.`;
  }
  if (kind === "disengage") {
    return `${actorName} disengages safely and repositions out of immediate threat.`;
  }
  if (kind === "dash") {
    return `${actorName} dashes to a better position on the battlefield.`;
  }
  if (kind === "take-cover") {
    return `${actorName} takes cover to reduce incoming hit chances.`;
  }
  if (kind === "aim") {
    return `${actorName} carefully aims, preparing a more accurate next strike.`;
  }
  if (kind === "surrender") {
    return `${actorName} surrenders and yields the field.`;
  }
  if (kind === "attempt-escape") {
    return `${actorName} attempts to break contact and escape.`;
  }
  return `${actorName} holds position and passes the turn.`;
}
