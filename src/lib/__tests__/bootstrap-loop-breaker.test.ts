import assert from "node:assert/strict";
import test from "node:test";

import { buildInitialCampaignBootstrap } from "../campaign-bootstrap";
import { resolveBootstrapTurnPolicy, withBootstrapNoProgressStreak } from "../bootstrap-loop-breaker";

test("applies loop breaker after consecutive no-progress turns", () => {
  const base = buildInitialCampaignBootstrap({
    title: "Loop Policy Test",
    ruleset: "D&D 5e",
    startingScenario: "Start scene.",
  });
  const seeded = withBootstrapNoProgressStreak(base, 1);

  const result = resolveBootstrapTurnPolicy({
    currentBootstrap: seeded,
    incomingUpdate: {
      scene_title: "Tense Pause",
      objective: "Evaluate options",
    },
    effectiveScene: {
      sceneTitle: "Tense Pause",
      location: "Crossroads",
      mood: "Tense",
      threat: "Unknown",
      goal: "Evaluate options",
      clock: "No timer",
      context: "Party planning",
    },
    gmQueryMode: false,
  });

  assert.equal(result.loopBreakerApplied, true);
  assert.ok(Array.isArray(result.effectiveUpdate.clocks_advanced));
  assert.ok((result.effectiveUpdate.clocks_advanced?.length ?? 0) >= 1);
  assert.ok(
    typeof result.effectiveUpdate.loop_breaker_reason === "string" &&
      result.effectiveUpdate.loop_breaker_reason.length > 0,
  );
  assert.equal(result.nextNoProgressStreak, 0);
});

test("resets streak when incoming update already has progress", () => {
  const base = buildInitialCampaignBootstrap({
    title: "Loop Policy Reset Test",
    ruleset: "D&D 5e",
    startingScenario: "Start scene.",
  });
  const seeded = withBootstrapNoProgressStreak(base, 2);

  const result = resolveBootstrapTurnPolicy({
    currentBootstrap: seeded,
    incomingUpdate: {
      clocks_advanced: [{ id: "CLK1", delta: 1 }],
    },
    effectiveScene: {
      sceneTitle: "Action",
      location: "Road",
      mood: "Urgent",
      threat: "Pursuit",
      goal: "Stay ahead",
      clock: "Pressure rising",
      context: "Enemy scouts",
    },
    gmQueryMode: false,
  });

  assert.equal(result.loopBreakerApplied, false);
  assert.equal(result.nextNoProgressStreak, 0);
  assert.equal(result.effectiveUpdate.clocks_advanced?.[0]?.id, "CLK1");
});

