import test from "node:test";
import assert from "node:assert/strict";

import { buildInitialCampaignBootstrap } from "../campaign-bootstrap";
import { resolveEncounterStart } from "../encounter-resolver";
import { getAttackDefaults } from "../combat-ruleset-adapter";

function makeCharacter(level: number, id: string) {
  return {
    id,
    name: `PC ${id}`,
    sheetJson: {
      level,
      hp: {
        current: 12,
        max: 12,
      },
      ac: 13,
    } as Record<string, unknown>,
  };
}

function makeBootstrap() {
  return buildInitialCampaignBootstrap({
    title: "Encounter Balance Fixture",
    ruleset: "D&D 5e",
    startingScenario: "Ambush at a roadside tavern.",
    tone: "adventure",
    scope: "local",
    theme: "mystery",
    startingHook: "job offer",
  });
}

test("encounter resolver scales enemy count by party level bands deterministically", () => {
  const bootstrap = makeBootstrap();
  const partySize = 4;

  const runAtLevel = (level: number, expectedTargetCount: number) => {
    const characters = Array.from({ length: partySize }, (_, index) =>
      makeCharacter(level, `c-${level}-${index + 1}`),
    );
    const baseSeeds = [
      { name: "Gang Lieutenant", type: "enemy" as const, hp: "Unknown" },
      { name: "Gang Enforcer 1", type: "enemy" as const, hp: "Unknown" },
      { name: "Gang Enforcer 2", type: "enemy" as const, hp: "Unknown" },
      { id: characters[0].id, name: characters[0].name, type: "character" as const },
    ];

    const resolved = resolveEncounterStart({
      ruleset: "D&D 5e",
      adapterProfile: "dnd",
      bootstrap,
      combatants: baseSeeds,
      characters,
      seedInput: `enc-balance-l${level}`,
    });

    assert.equal(resolved.debug.enemyCountTarget, expectedTargetCount);
    assert.equal(resolved.debug.enemyCountExisting, 3);

    const enemies = resolved.combatants.filter((entry) => entry.type === "enemy");
    assert.ok(
      enemies.every((entry) => typeof entry.hp === "string" && /^\d+\/\d+$/.test(entry.hp)),
      "expected resolver to assign numeric hp strings to all enemies",
    );
  };

  runAtLevel(1, 3);
  runAtLevel(5, 5);
  runAtLevel(10, 6);
});

test("D&D enemy default attack profile scales against target level", () => {
  const makeTarget = (level: number) => ({
    id: `target-${level}`,
    name: `Target ${level}`,
    sheetJson: {
      level,
      ac: 13,
      hp: { current: 14, max: 14 },
    } as Record<string, unknown>,
  });

  const low = getAttackDefaults({
    ruleset: "D&D 5e",
    actorType: "enemy",
    actorCharacter: null,
    targetCharacter: makeTarget(1),
  });
  assert.equal(low.attackBonus, 2);
  assert.equal(low.damageDie, 4);
  assert.equal(low.damageBonus, 0);

  const mid = getAttackDefaults({
    ruleset: "D&D 5e",
    actorType: "enemy",
    actorCharacter: null,
    targetCharacter: makeTarget(5),
  });
  assert.equal(mid.attackBonus, 3);
  assert.equal(mid.damageDie, 6);
  assert.equal(mid.damageBonus, 1);

  const high = getAttackDefaults({
    ruleset: "D&D 5e",
    actorType: "enemy",
    actorCharacter: null,
    targetCharacter: makeTarget(10),
  });
  assert.equal(high.attackBonus, 4);
  assert.equal(high.damageDie, 8);
  assert.equal(high.damageBonus, 2);
});

test("Deadlands and Savage Rifts enemy defaults scale by target level bands", () => {
  const makeTarget = (level: number) => ({
    id: `target-${level}`,
    name: `Target ${level}`,
    sheetJson: {
      level,
      hp: { current: 14, max: 14 },
      ac: 13,
    } as Record<string, unknown>,
  });

  const deadlandsLow = getAttackDefaults({
    ruleset: "Deadlands Classic",
    actorType: "enemy",
    actorCharacter: null,
    targetCharacter: makeTarget(1),
  });
  assert.equal(deadlandsLow.attackBonus, 0);
  assert.equal(deadlandsLow.damageDie, 4);
  assert.equal(deadlandsLow.damageBonus, 0);

  const deadlandsMid = getAttackDefaults({
    ruleset: "Deadlands Classic",
    actorType: "enemy",
    actorCharacter: null,
    targetCharacter: makeTarget(8),
  });
  assert.equal(deadlandsMid.attackBonus, 2);
  assert.equal(deadlandsMid.damageDie, 8);
  assert.equal(deadlandsMid.damageBonus, 1);

  const riftsLow = getAttackDefaults({
    ruleset: "Savage Rifts",
    actorType: "enemy",
    actorCharacter: null,
    targetCharacter: makeTarget(1),
  });
  assert.equal(riftsLow.attackBonus, 2);
  assert.equal(riftsLow.damageDie, 6);
  assert.equal(riftsLow.damageBonus, 0);

  const riftsHigh = getAttackDefaults({
    ruleset: "Savage Rifts",
    actorType: "enemy",
    actorCharacter: null,
    targetCharacter: makeTarget(10),
  });
  assert.equal(riftsHigh.attackBonus, 4);
  assert.equal(riftsHigh.damageDie, 10);
  assert.equal(riftsHigh.damageBonus, 2);
});

test("encounter resolver applies lower low-level density for Savage Rifts than D&D", () => {
  const partySize = 4;
  const characters = Array.from({ length: partySize }, (_, index) =>
    makeCharacter(5, `cmp-${index + 1}`),
  );
  const baseSeeds = [
    { name: "Enemy 1", type: "enemy" as const, hp: "Unknown" },
    { name: "Enemy 2", type: "enemy" as const, hp: "Unknown" },
    { name: "Enemy 3", type: "enemy" as const, hp: "Unknown" },
    { id: characters[0].id, name: characters[0].name, type: "character" as const },
  ];

  const dndBootstrap = buildInitialCampaignBootstrap({
    title: "Dnd Density",
    ruleset: "D&D 5e",
    startingScenario: "Skirmish",
  });
  const dndResolved = resolveEncounterStart({
    ruleset: "D&D 5e",
    adapterProfile: "dnd",
    bootstrap: dndBootstrap,
    combatants: baseSeeds,
    characters,
    seedInput: "density-dnd",
  });

  const riftsBootstrap = buildInitialCampaignBootstrap({
    title: "Rifts Density",
    ruleset: "Savage Rifts",
    startingScenario: "Skirmish",
  });
  const riftsResolved = resolveEncounterStart({
    ruleset: "Savage Rifts",
    adapterProfile: "generic",
    bootstrap: riftsBootstrap,
    combatants: baseSeeds,
    characters,
    seedInput: "density-rifts",
  });

  assert.equal(dndResolved.debug.enemyCountTarget, 5);
  assert.equal(riftsResolved.debug.enemyCountTarget, 4);
});

test("encounter resolver uses conservative low-level density for Deadlands", () => {
  const characters = Array.from({ length: 4 }, (_, index) =>
    makeCharacter(1, `dl-${index + 1}`),
  );
  const seeds = [
    { name: "Ruffian 1", type: "enemy" as const, hp: "Unknown" },
    { name: "Ruffian 2", type: "enemy" as const, hp: "Unknown" },
    { name: "Ruffian 3", type: "enemy" as const, hp: "Unknown" },
    { id: characters[0].id, name: characters[0].name, type: "character" as const },
  ];
  const bootstrap = buildInitialCampaignBootstrap({
    title: "Deadlands Density",
    ruleset: "Deadlands Classic",
    startingScenario: "Street showdown",
  });
  const resolved = resolveEncounterStart({
    ruleset: "Deadlands Classic",
    adapterProfile: "deadlands",
    bootstrap,
    combatants: seeds,
    characters,
    seedInput: "density-deadlands",
  });

  assert.equal(resolved.debug.enemyCountTarget, 2);
  assert.equal(resolved.debug.enemyCountTrimmed, 1);
  assert.equal(
    resolved.combatants.filter((entry) => entry.type === "enemy").length,
    2,
  );
});
