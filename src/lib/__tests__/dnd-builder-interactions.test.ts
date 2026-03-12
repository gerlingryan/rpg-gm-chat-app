import assert from "node:assert/strict";
import test from "node:test";

import {
  applyRecommendedStandardArrayForClass,
  canAssignStandardArrayValue,
  canIncreasePointBuyScore,
  DND_ABILITY_IDS,
  getDndAsiBonuses,
  getDndPointBuySpent,
  rollAbilityScoresFromSeed,
} from "../dnd-ability-builder";

test("recommended array applies class priority ordering", () => {
  const wizard = applyRecommendedStandardArrayForClass("Wizard");
  assert.equal(wizard.int, 15);
  assert.equal(wizard.con, 14);
  assert.equal(wizard.dex, 13);
});

test("standard array assignment prevents duplicates", () => {
  const scores = {
    str: 15,
    dex: 14,
    con: 13,
    int: 12,
    wis: 10,
    cha: 8,
  };
  assert.equal(canAssignStandardArrayValue(scores, "dex", 15), false);
  assert.equal(canAssignStandardArrayValue(scores, "dex", 14), true);
});

test("point-buy increase guard blocks overspending", () => {
  const scores = {
    str: 15,
    dex: 15,
    con: 15,
    int: 8,
    wis: 8,
    cha: 8,
  };
  assert.equal(getDndPointBuySpent(DND_ABILITY_IDS.map((id) => scores[id])), 27);
  assert.equal(canIncreasePointBuyScore(scores, "int"), false);
});

test("seeded 4d6 rolling is deterministic", () => {
  const a = rollAbilityScoresFromSeed("seed-123");
  const b = rollAbilityScoresFromSeed("seed-123");
  const c = rollAbilityScoresFromSeed("seed-124");
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  for (const value of Object.values(a)) {
    assert.ok(value >= 3 && value <= 18);
  }
});

test("legacy ancestry bonuses are applied", () => {
  const bonuses = getDndAsiBonuses({
    ancestry: "Dwarf",
    abilityScoreRuleSet: "legacy-fixed",
    asiPlusTwo: "str",
    asiPlusOne: "dex",
  });
  assert.equal(bonuses.con, 2);
  assert.equal(bonuses.wis, 1);
});

test("modern flexible bonuses follow selected abilities", () => {
  const bonuses = getDndAsiBonuses({
    ancestry: "Human",
    abilityScoreRuleSet: "modern-flexible",
    asiPlusTwo: "int",
    asiPlusOne: "dex",
  });
  assert.equal(bonuses.int, 2);
  assert.equal(bonuses.dex, 1);
  assert.equal(bonuses.str, 0);
});
