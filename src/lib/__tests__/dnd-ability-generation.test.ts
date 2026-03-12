import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGeneratedCharacter,
  validateCharacterAnswersDetailed,
} from "../campaigns";

test("validation: standard array requires unique 15,14,13,12,10,8", () => {
  const result = validateCharacterAnswersDetailed("D&D 5e", {
    abilityGenerationMethod: "standard-array",
    str: 15,
    dex: 15,
    con: 13,
    int: 12,
    wis: 10,
    cha: 8,
  });

  assert.ok(result.fieldErrors.abilityGenerationMethod);
  assert.match(result.fieldErrors.abilityGenerationMethod, /Standard Array/i);
});

test("validation: point buy over 27 is rejected", () => {
  const result = validateCharacterAnswersDetailed("D&D 5e", {
    abilityGenerationMethod: "point-buy",
    str: 15,
    dex: 15,
    con: 15,
    int: 15,
    wis: 15,
    cha: 15,
  });

  assert.ok(result.fieldErrors.abilityGenerationMethod);
  assert.match(result.fieldErrors.abilityGenerationMethod, /overspent/i);
});

test("validation: roll mode enforces 3..18 bounds", () => {
  const result = validateCharacterAnswersDetailed("D&D 5e", {
    abilityGenerationMethod: "roll-4d6",
    str: 19,
    dex: 12,
    con: 10,
    int: 9,
    wis: 8,
    cha: 7,
  });

  assert.ok(result.fieldErrors.str);
  assert.match(result.fieldErrors.str, /between 3 and 18/i);
});

test("buildGeneratedCharacter: stores ability metadata and derived stat audit", () => {
  const generated = buildGeneratedCharacter("D&D 5e", "Test Wizard", {
    level: 5,
    class: "Wizard",
    ancestry: "Human",
    abilityGenerationMethod: "point-buy",
    str: 8,
    dex: 14,
    con: 15,
    int: 15,
    wis: 10,
    cha: 8,
    armor: "No Armor",
    shieldEquipped: "No",
    overrideAcEnabled: "true",
    overrideAc: 18,
  });

  const sheet = generated.sheetJson as Record<string, unknown>;
  const summary = sheet.abilityGenerationSummary as Record<string, unknown>;
  const derivedStats = sheet.derivedStats as Record<string, unknown>;
  const overrides =
    derivedStats && typeof derivedStats === "object"
      ? (derivedStats.overrides as Record<string, unknown>)
      : null;

  assert.equal(summary.method, "point-buy");
  assert.equal(summary.pointBuySpent, 27);
  assert.equal(summary.pointBuyLegal, true);
  assert.equal(sheet.pointBuySpent, 27);
  assert.ok(derivedStats);
  assert.equal(overrides?.ac, true);
  assert.equal(sheet.ac, 18);
});

test("buildGeneratedCharacter: applies legacy ancestry bonuses to final stats", () => {
  const generated = buildGeneratedCharacter("D&D 5e", "Legacy Dwarf", {
    class: "Cleric",
    ancestry: "Dwarf",
    abilityScoreRuleSet: "legacy-fixed",
    str: 10,
    dex: 10,
    con: 10,
    int: 10,
    wis: 10,
    cha: 10,
  });

  const sheet = generated.sheetJson as Record<string, unknown>;
  const stats = sheet.stats as Record<string, number>;
  assert.equal(stats.con, 12);
  assert.equal(stats.wis, 11);
});
