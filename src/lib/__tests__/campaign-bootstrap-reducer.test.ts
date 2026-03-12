import assert from "node:assert/strict";
import test from "node:test";

import { buildInitialCampaignBootstrap } from "../campaign-bootstrap";
import {
  applyCampaignBootstrapTurnUpdate,
  normalizeCampaignBootstrapTurnUpdate,
} from "../campaign-bootstrap-reducer";

test("applies objective and clock advancement updates", () => {
  const base = buildInitialCampaignBootstrap({
    title: "Reducer Test",
    ruleset: "D&D 5e",
    startingScenario: "Start scene.",
  });

  const next = applyCampaignBootstrapTurnUpdate(base, {
    objective: "Secure the witness before dawn.",
    clocks_advanced: [{ id: "CLK1", delta: 2 }],
  });

  assert.equal(next.campaign.party_goal_public, "Secure the witness before dawn.");
  const clock = next.clocks.find((entry) => entry.id === "CLK1");
  assert.ok(clock);
  assert.equal(clock?.current, Math.min((base.clocks.find((c) => c.id === "CLK1")?.current ?? 0) + 2, clock?.max ?? 0));
});

test("applies quest step/lead updates and clue reveal", () => {
  const base = buildInitialCampaignBootstrap({
    title: "Quest Update Test",
    ruleset: "Deadlands Classic",
    startingScenario: "Street fight.",
  });

  const next = applyCampaignBootstrapTurnUpdate(base, {
    quest_updates: [
      {
        id: "Q1",
        addStep: "Question the tavern keeper.",
        addLead: "A coded ledger entry",
      },
    ],
    new_clue: {
      id: "CL9",
      text: "A signet ring etched with the same symbol.",
      visibility: "gm_hidden",
    },
    clues_revealed: ["CL1"],
  });

  const q1 = next.quests.find((entry) => entry.id === "Q1");
  assert.ok(q1);
  assert.ok(q1?.steps.includes("Question the tavern keeper."));
  assert.ok(q1?.leads.includes("A coded ledger entry"));
  assert.ok(next.clues.some((entry) => entry.id === "CL9"));
  assert.ok(next.clues.some((entry) => entry.id === "CL1" && entry.revealed));
});

test("reveals teased quests when activated and can create new quest entries", () => {
  const base = buildInitialCampaignBootstrap({
    title: "Reveal Test",
    ruleset: "D&D 5e",
    startingScenario: "Opening scene.",
  });

  const next = applyCampaignBootstrapTurnUpdate(base, {
    quest_updates: [
      {
        id: "Q2",
        status: "active",
        addStep: "Meet the rumor contact.",
      },
      {
        id: "Q9",
        title: "A New Thread",
        status: "active",
        objective: "Follow the fresh lead.",
      },
    ],
  });

  const q2 = next.quests.find((entry) => entry.id === "Q2");
  assert.ok(q2);
  assert.equal(q2?.status, "active");
  assert.equal(q2?.visibility, "player");
  assert.ok(q2?.steps.includes("Meet the rumor contact."));

  const q9 = next.quests.find((entry) => entry.id === "Q9");
  assert.ok(q9);
  assert.equal(q9?.title, "A New Thread");
  assert.equal(q9?.status, "active");
  assert.equal(q9?.visibility, "player");
  assert.equal(q9?.objective, "Follow the fresh lead.");
});

test("expands primary quest from revealed clues and clears unresolved clue list", () => {
  const base = buildInitialCampaignBootstrap({
    title: "Clue Expansion Test",
    ruleset: "D&D 5e",
    startingScenario: "Opening scene.",
  });

  const next = applyCampaignBootstrapTurnUpdate(base, {
    clues_revealed: ["CL1"],
  });

  const q1 = next.quests.find((entry) => entry.id === "Q1");
  assert.ok(q1);
  assert.ok(q1?.steps.some((step) => step.includes("Investigate clue CL1")));
  assert.ok(q1?.leads.some((lead) => lead.includes("CL1:")));
  assert.equal(next.gm_notes.unresolved_clues.includes("CL1"), false);
  assert.ok(next.expansion_events.some((event) => event.kind === "clue"));
});

test("expands quest and creates crisis side quest when a clock fills", () => {
  const base = buildInitialCampaignBootstrap({
    title: "Clock Expansion Test",
    ruleset: "D&D 5e",
    startingScenario: "Opening scene.",
  });

  const next = applyCampaignBootstrapTurnUpdate(base, {
    clocks_advanced: [{ id: "CLK2", current: 4 }],
  });

  const q1 = next.quests.find((entry) => entry.id === "Q1");
  assert.ok(q1);
  assert.ok(q1?.steps.some((step) => step.includes("Urgent: Public Pressure")));
  assert.ok(q1?.leads.some((lead) => lead.includes("Public Pressure trigger")));

  const crisisQuest = next.quests.find((entry) => entry.id === "QCLK_CLK2");
  assert.ok(crisisQuest);
  assert.equal(crisisQuest?.status, "active");
  assert.equal(crisisQuest?.visibility, "player");
  assert.ok(next.expansion_events.some((event) => event.kind === "clock"));
  assert.ok(next.expansion_events.some((event) => event.kind === "quest_created"));
});

test("normalizes malformed bootstrap turn updates to safe allowed shape", () => {
  const normalized = normalizeCampaignBootstrapTurnUpdate({
    scene_title: "  Test Scene ",
    objective: "  Hold the line ",
    clocks_advanced: [
      { id: "CLK1", delta: "2" },
      { id: "", delta: 1 },
      { name: "Public Pressure", current: "4" },
      "invalid",
    ],
    quest_updates: [
      { id: "Q1", addStep: "  Push forward " },
      { title: "New Quest", status: "ACTIVE", visibility: "player" },
      { id: "", title: "" },
      42,
    ],
    clues_revealed: ["CL1", "  ", 8],
    new_clue: { id: "CL9", text: " Hidden mark ", visibility: "gm_hidden" },
    invalid_key: "drop me",
  });

  assert.equal(normalized.scene_title, "Test Scene");
  assert.equal(normalized.objective, "Hold the line");
  assert.equal(normalized.clocks_advanced?.length, 2);
  assert.equal(normalized.clocks_advanced?.[0].id, "CLK1");
  assert.equal(normalized.clocks_advanced?.[0].delta, 2);
  assert.equal(normalized.clocks_advanced?.[1].name, "Public Pressure");
  assert.equal(normalized.clocks_advanced?.[1].current, 4);
  assert.equal(normalized.quest_updates?.length, 2);
  assert.equal(normalized.quest_updates?.[0].addStep, "Push forward");
  assert.equal(normalized.quest_updates?.[1].status, "active");
  assert.equal(normalized.clues_revealed?.length, 1);
  assert.equal(normalized.clues_revealed?.[0], "CL1");
  assert.equal(normalized.new_clue?.id, "CL9");
  assert.equal(normalized.new_clue?.text, "Hidden mark");
});

test("records loop breaker reason in gm notes offscreen pressure", () => {
  const base = buildInitialCampaignBootstrap({
    title: "Loop Break Test",
    ruleset: "D&D 5e",
    startingScenario: "Opening scene.",
  });

  const next = applyCampaignBootstrapTurnUpdate(base, {
    loop_breaker_reason: "Auto escalation triggered",
  });

  assert.ok(
    next.gm_notes.offscreen_pressure.some((entry) =>
      entry.includes("Loop-break: Auto escalation triggered"),
    ),
  );
});
