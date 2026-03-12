import test from "node:test";
import assert from "node:assert/strict";

import { normalizeCombatStartSeedsWithTelemetry } from "../combat-start-telemetry";

test("normalizes unknown enemy hp before combat start and marks forced fallback", () => {
  const inputCombatants = [
    { name: "Enemy A", type: "enemy" as const, hp: "Unknown" },
    { name: "Enemy B", type: "enemy" as const, hp: "10/10" },
    { name: "Hero", type: "character" as const, hp: "12/12" },
  ];
  const resolvedCombatants = [
    { name: "Enemy A", type: "enemy" as const, hp: "??/??", initiativeModifier: 1 },
    { name: "Enemy B", type: "enemy" as const, hp: "10/10", initiativeModifier: 1 },
    { name: "Hero", type: "character" as const, hp: "12/12", initiativeModifier: 2 },
  ];

  const normalized = normalizeCombatStartSeedsWithTelemetry({
    inputCombatants,
    resolvedCombatants,
    adapterProfile: "dnd",
  });

  const enemyA = normalized.startReadyCombatants.find((entry) => entry.name === "Enemy A");
  assert.ok(enemyA, "expected Enemy A in normalized combatants");
  assert.equal(enemyA?.hp, "12/12");

  const assignmentA = normalized.enemyAssignments.find((entry) => entry.name === "Enemy A");
  assert.ok(assignmentA, "expected Enemy A telemetry");
  assert.equal(assignmentA?.hpBefore, "Unknown");
  assert.equal(assignmentA?.hpAfter, "12/12");
  assert.equal(assignmentA?.hpForcedFallback, true);
});

test("marks hpAssignedByResolver when resolver fills hp from unknown seed", () => {
  const inputCombatants = [
    { name: "Enemy A", type: "enemy" as const, hp: "Unknown" },
    { name: "Hero", type: "character" as const, hp: "12/12" },
  ];
  const resolvedCombatants = [
    { name: "Enemy A", type: "enemy" as const, hp: "14/14", initiativeModifier: 1 },
    { name: "Hero", type: "character" as const, hp: "12/12", initiativeModifier: 2 },
  ];

  const normalized = normalizeCombatStartSeedsWithTelemetry({
    inputCombatants,
    resolvedCombatants,
    adapterProfile: "dnd",
  });

  const assignmentA = normalized.enemyAssignments.find((entry) => entry.name === "Enemy A");
  assert.ok(assignmentA, "expected Enemy A telemetry");
  assert.equal(assignmentA?.hpBefore, "Unknown");
  assert.equal(assignmentA?.hpAfter, "14/14");
  assert.equal(assignmentA?.hpAssignedByResolver, true);
  assert.equal(assignmentA?.hpForcedFallback, false);
});

