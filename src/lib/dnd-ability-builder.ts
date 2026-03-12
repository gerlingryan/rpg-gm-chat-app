export const DND_ABILITY_IDS = ["str", "dex", "con", "int", "wis", "cha"] as const;
export type DndAbilityId = (typeof DND_ABILITY_IDS)[number];

export const DND_STANDARD_ARRAY = [15, 14, 13, 12, 10, 8] as const;

export const DND_POINT_BUY_COST_BY_SCORE: Record<number, number> = {
  8: 0,
  9: 1,
  10: 2,
  11: 3,
  12: 4,
  13: 5,
  14: 7,
  15: 9,
};

export const DND_RECOMMENDED_ARRAY_BY_CLASS: Record<string, readonly DndAbilityId[]> = {
  Barbarian: ["str", "con", "dex", "wis", "cha", "int"],
  Bard: ["cha", "dex", "con", "wis", "int", "str"],
  Cleric: ["wis", "con", "str", "dex", "cha", "int"],
  Druid: ["wis", "con", "dex", "int", "cha", "str"],
  Fighter: ["str", "con", "dex", "wis", "cha", "int"],
  Monk: ["dex", "wis", "con", "str", "int", "cha"],
  Paladin: ["str", "cha", "con", "wis", "dex", "int"],
  Ranger: ["dex", "wis", "con", "str", "cha", "int"],
  Rogue: ["dex", "con", "int", "wis", "cha", "str"],
  Sorcerer: ["cha", "con", "dex", "wis", "int", "str"],
  Warlock: ["cha", "con", "dex", "wis", "int", "str"],
  Wizard: ["int", "con", "dex", "wis", "cha", "str"],
};

export function getDndPointBuySpent(scores: number[]) {
  return scores.reduce((total, score) => {
    const normalizedScore = Math.max(8, Math.min(15, Math.trunc(score)));
    return total + (DND_POINT_BUY_COST_BY_SCORE[normalizedScore] ?? 0);
  }, 0);
}

export function isStandardArrayMatch(scores: number[]) {
  const provided = [...scores].map((value) => Math.trunc(value)).sort((a, b) => b - a);
  const expected = [...DND_STANDARD_ARRAY].sort((a, b) => b - a);
  return provided.length === expected.length && provided.every((value, index) => value === expected[index]);
}

export function canAssignStandardArrayValue(
  scores: Record<DndAbilityId, number>,
  abilityId: DndAbilityId,
  value: number,
) {
  if (!DND_STANDARD_ARRAY.includes(value as (typeof DND_STANDARD_ARRAY)[number])) {
    return false;
  }
  return !DND_ABILITY_IDS.some((id) => id !== abilityId && scores[id] === value);
}

export function canIncreasePointBuyScore(
  scores: Record<DndAbilityId, number>,
  abilityId: DndAbilityId,
) {
  const current = scores[abilityId];
  if (current >= 15) {
    return false;
  }
  const projected = DND_ABILITY_IDS.map((id) => (id === abilityId ? current + 1 : scores[id]));
  return getDndPointBuySpent(projected) <= 27;
}

export function applyRecommendedStandardArrayForClass(className: string) {
  const priorityOrder =
    DND_RECOMMENDED_ARRAY_BY_CLASS[className] ??
    ["str", "con", "dex", "wis", "cha", "int"];

  const result: Record<DndAbilityId, number> = {
    str: 10,
    dex: 10,
    con: 10,
    int: 10,
    wis: 10,
    cha: 10,
  };

  for (let index = 0; index < priorityOrder.length; index += 1) {
    result[priorityOrder[index]] = DND_STANDARD_ARRAY[index];
  }

  return result;
}

function seededRandom(seedInput: string) {
  let hash = 2166136261;
  for (let index = 0; index < seedInput.length; index += 1) {
    hash ^= seedInput.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  let state = hash >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function roll4d6DropLowest(rng: () => number) {
  const rolls = Array.from({ length: 4 }, () => Math.floor(rng() * 6) + 1);
  rolls.sort((a, b) => a - b);
  return rolls[1] + rolls[2] + rolls[3];
}

export function rollAbilityScoresFromSeed(seedInput: string) {
  const rng = seededRandom(seedInput);
  const results = DND_ABILITY_IDS.map(() => roll4d6DropLowest(rng));
  return Object.fromEntries(
    DND_ABILITY_IDS.map((id, index) => [id, results[index]]),
  ) as Record<DndAbilityId, number>;
}

export function getDndAsiBonuses(params: {
  ancestry: string;
  abilityScoreRuleSet: string;
  asiPlusTwo: string;
  asiPlusOne: string;
}) {
  const bonuses: Record<DndAbilityId, number> = {
    str: 0,
    dex: 0,
    con: 0,
    int: 0,
    wis: 0,
    cha: 0,
  };

  if (params.abilityScoreRuleSet === "modern-flexible") {
    if (params.asiPlusTwo in bonuses) {
      bonuses[params.asiPlusTwo as DndAbilityId] += 2;
    }
    if (params.asiPlusOne in bonuses) {
      bonuses[params.asiPlusOne as DndAbilityId] += 1;
    }
    return bonuses;
  }

  const legacyBonuses: Record<string, Partial<Record<DndAbilityId, number>>> = {
    Aasimar: { cha: 2, wis: 1 },
    Dragonborn: { str: 2, cha: 1 },
    Dwarf: { con: 2, wis: 1 },
    Elf: { dex: 2, int: 1 },
    Gnome: { int: 2, dex: 1 },
    Goliath: { str: 2, con: 1 },
    "Half-Elf": { cha: 2, dex: 1, con: 1 },
    "Half-Orc": { str: 2, con: 1 },
    Halfling: { dex: 2, cha: 1 },
    Human: { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 },
    Orc: { str: 2, con: 1 },
    Tiefling: { cha: 2, int: 1 },
  };
  const selected = legacyBonuses[params.ancestry] ?? {};
  for (const [key, value] of Object.entries(selected)) {
    if (key in bonuses && typeof value === "number") {
      bonuses[key as DndAbilityId] += value;
    }
  }
  return bonuses;
}
