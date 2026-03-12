import test from "node:test";
import assert from "node:assert/strict";

import {
  advanceTurn,
  buildInitiativeState,
  resolveAttackAction,
  resolveUtilityAction,
} from "../combat-engine";
import { normalizeCombatState } from "../combat";

function makeSeededRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

test("deterministic fixture: D&D initiative and first attack are stable", () => {
  const seeds = [
    { id: "pc-1", name: "Raint", type: "character" as const, hp: "20/20", initiativeModifier: 2 },
    { id: "pc-2", name: "Buck", type: "character" as const, hp: "14/14", initiativeModifier: 1 },
    { name: "Goblin 1", type: "enemy" as const, hp: "12/12", initiativeModifier: 1 },
    { name: "Goblin 2", type: "enemy" as const, hp: "12/12", initiativeModifier: 1 },
  ];

  const a = buildInitiativeState({
    seeds,
    seedInput: "fixture-dnd-encounter-1",
    profile: "dnd",
  });
  const b = buildInitiativeState({
    seeds,
    seedInput: "fixture-dnd-encounter-1",
    profile: "dnd",
  });

  assert.deepEqual(a.rollLog, b.rollLog);
  assert.deepEqual(a.state.roster.map((entry) => entry.name), b.state.roster.map((entry) => entry.name));

  const state = normalizeCombatState(a.state);
  const actor = state.roster.find((entry) => entry.active);
  assert.ok(actor, "expected active actor");
  const target = state.roster.find((entry) => entry.type === "enemy");
  assert.ok(target, "expected enemy target");

  const attackA = resolveAttackAction(state, {
    actor: actor.name,
    target: target.name,
    profile: "dnd",
    attackDie: 20,
    attackBonus: 5,
    targetAc: 12,
    damageDie: 8,
    damageDiceCount: 1,
    damageBonus: 2,
    seedInput: "fixture-dnd-attack-1",
  });
  const attackB = resolveAttackAction(state, {
    actor: actor.name,
    target: target.name,
    profile: "dnd",
    attackDie: 20,
    attackBonus: 5,
    targetAc: 12,
    damageDie: 8,
    damageDiceCount: 1,
    damageBonus: 2,
    seedInput: "fixture-dnd-attack-1",
  });

  assert.equal(attackA.error, null);
  assert.equal(attackB.error, null);
  assert.deepEqual(attackA.resolution, attackB.resolution);
});

test("deterministic fixture: Deadlands initiative card draw is stable", () => {
  const seeds = [
    { id: "pc-1", name: "Karen", type: "character" as const, hp: "11/11", initiativeModifier: 3 },
    { id: "pc-2", name: "Lars", type: "character" as const, hp: "11/11", initiativeModifier: 3 },
    { name: "Bandit 1", type: "enemy" as const, hp: "10/10", initiativeModifier: 2 },
    { name: "Bandit 2", type: "enemy" as const, hp: "10/10", initiativeModifier: 2 },
  ];

  const a = buildInitiativeState({
    seeds,
    seedInput: "fixture-deadlands-encounter-1",
    profile: "deadlands",
    deadlandsJokerEffectsEnabled: true,
  });
  const b = buildInitiativeState({
    seeds,
    seedInput: "fixture-deadlands-encounter-1",
    profile: "deadlands",
    deadlandsJokerEffectsEnabled: true,
  });

  assert.deepEqual(a.rollLog, b.rollLog);
  assert.deepEqual(
    a.state.roster.map((entry) => ({ name: entry.name, init: entry.initiative, effects: entry.statusEffects ?? [] })),
    b.state.roster.map((entry) => ({ name: entry.name, init: entry.initiative, effects: entry.statusEffects ?? [] })),
  );
});

test("fuzz: invalid actor/target transitions never succeed", () => {
  const base = buildInitiativeState({
    seeds: [
      { id: "pc-1", name: "A", type: "character", hp: "10/10", initiativeModifier: 2 },
      { name: "E1", type: "enemy", hp: "8/8", initiativeModifier: 1 },
    ],
    seedInput: "fuzz-base",
    profile: "dnd",
  }).state;
  const state = normalizeCombatState(base);
  const active = state.roster.find((entry) => entry.active);
  assert.ok(active, "expected active combatant");

  const rng = makeSeededRng(42);
  const invalidRefs = ["", "  ", "missing", "unknown-target", "###"];
  let checked = 0;

  for (let i = 0; i < 120; i += 1) {
    const badActor = invalidRefs[Math.floor(rng() * invalidRefs.length)];
    const badTarget = invalidRefs[Math.floor(rng() * invalidRefs.length)];

    const result = resolveAttackAction(state, {
      actor: badActor || "missing-actor",
      target: badTarget || "missing-target",
      profile: "dnd",
      attackDie: 20,
      attackBonus: 2,
      targetAc: 12,
      damageDie: 6,
      damageDiceCount: 1,
      damageBonus: 1,
      seedInput: `fuzz-attack-${i}`,
    });

    assert.ok(result.error, "expected invalid transition to produce error");
    checked += 1;
  }

  assert.equal(checked, 120);
});

test("fuzz: out-of-turn utility action is rejected", () => {
  const started = buildInitiativeState({
    seeds: [
      { id: "pc-1", name: "A", type: "character", hp: "10/10", initiativeModifier: 2 },
      { id: "pc-2", name: "B", type: "character", hp: "10/10", initiativeModifier: 1 },
      { name: "E1", type: "enemy", hp: "8/8", initiativeModifier: 1 },
    ],
    seedInput: "fuzz-turn-order",
    profile: "dnd",
  }).state;

  const state = normalizeCombatState(started);
  const active = state.roster.find((entry) => entry.active);
  assert.ok(active);
  const nonActive = state.roster.find((entry) => entry.name !== active.name);
  assert.ok(nonActive);

  const result = resolveUtilityAction(state, {
    actor: nonActive.name,
    kind: "defend",
    profile: "dnd",
    seedInput: "fuzz-turn-order-1",
  });

  assert.ok(result.error);
  assert.match(result.error ?? "", /currently .*'s turn/i);
});

test("state transition: run away success ends combat deterministically", () => {
  const started = buildInitiativeState({
    seeds: [
      { id: "pc-1", name: "A", type: "character", hp: "10/10", initiativeModifier: 2 },
      { name: "E1", type: "enemy", hp: "8/8", initiativeModifier: 1 },
    ],
    seedInput: "escape-start",
    profile: "dnd",
  }).state;
  const state = normalizeCombatState(started);
  const active = state.roster.find((entry) => entry.active);
  assert.ok(active);

  const result = resolveUtilityAction(state, {
    actor: active.name,
    kind: "attempt-escape",
    profile: "dnd",
    seedInput: "escape-guaranteed-seed",
  });

  assert.equal(result.error, null);
  assert.ok(result.resolution);
  if (result.resolution?.combatOutcome === "escaped") {
    assert.equal(result.state.combatActive, false);
    assert.equal(result.state.roster.length, 0);
  } else {
    assert.equal(result.state.combatActive, true);
    assert.ok(result.state.roster.length > 0);
  }
});

test("state transition: advanceTurn preserves normalized active index", () => {
  const started = buildInitiativeState({
    seeds: [
      { id: "pc-1", name: "A", type: "character", hp: "10/10", initiativeModifier: 2 },
      { name: "E1", type: "enemy", hp: "8/8", initiativeModifier: 1 },
      { name: "E2", type: "enemy", hp: "8/8", initiativeModifier: 1 },
    ],
    seedInput: "advance-turn-fixture",
    profile: "dnd",
  }).state;

  let state = normalizeCombatState(started);
  for (let i = 0; i < 10; i += 1) {
    state = advanceTurn(state);
    if (!state.combatActive) {
      break;
    }
    const activeCount = state.roster.filter((entry) => entry.active).length;
    assert.equal(activeCount, 1);
    assert.ok(state.turnIndex >= 0 && state.turnIndex < state.roster.length);
    assert.equal(state.roster[state.turnIndex]?.active, true);
  }
});
