import assert from "node:assert/strict";
import test from "node:test";

import {
  CAMPAIGN_BOOTSTRAP_SCHEMA_VERSION,
  buildInitialCampaignBootstrap,
  normalizeCampaignBootstrap,
  projectCampaignBootstrapForPlayer,
} from "../campaign-bootstrap";

test("buildInitialCampaignBootstrap creates baseline packet", () => {
  const bootstrap = buildInitialCampaignBootstrap({
    title: "Frontier",
    ruleset: "D&D 5e",
    startingScenario: "You arrive at a ruined keep.",
  });

  assert.equal(bootstrap.schemaVersion, CAMPAIGN_BOOTSTRAP_SCHEMA_VERSION);
  assert.equal(bootstrap.campaign.ruleset, "D&D 5e");
  assert.ok(bootstrap.quests.length >= 1);
  assert.ok(bootstrap.clocks.length >= 1);
  assert.ok(bootstrap.world_roster.enemyTemplates.length >= 1);
  assert.ok(bootstrap.world_roster.encounterTables.length >= 1);
});

test("normalizeCampaignBootstrap falls back safely on invalid input", () => {
  const fallback = buildInitialCampaignBootstrap({
    title: "Fallback Campaign",
    ruleset: "Deadlands Classic",
    startingScenario: "Dusty street showdown.",
  });

  const normalized = normalizeCampaignBootstrap(null, fallback);
  assert.equal(normalized.campaign.ruleset, fallback.campaign.ruleset);
  assert.equal(normalized.seed, fallback.seed);
});

test("projectCampaignBootstrapForPlayer excludes hidden content", () => {
  const bootstrap = buildInitialCampaignBootstrap({
    title: "Projection Test",
    ruleset: "Savage Rifts",
    startingScenario: "Dimensional breach at dawn.",
  });

  const projected = projectCampaignBootstrapForPlayer(bootstrap);
  assert.ok(projected.quests.every((entry) => entry.visibility !== "gm_hidden"));
  assert.ok(projected.clocks.every((entry) => entry.visibility !== "gm_hidden"));
  assert.ok(projected.clues.every((entry) => entry.visibility !== "gm_hidden"));
});
