import test from "node:test";
import assert from "node:assert/strict";

import { prisma } from "@/lib/prisma";
import { POST } from "./route";

type CampaignDelegateLike = {
  findUnique: (...args: unknown[]) => Promise<unknown>;
  update: (...args: unknown[]) => Promise<unknown>;
};

type PrismaLike = {
  campaign: CampaignDelegateLike;
};

test("combat start normalizes enemy hp and returns encounter telemetry", async () => {
  const prismaLike = prisma as unknown as PrismaLike;
  const originalFindUnique = prismaLike.campaign.findUnique;
  const originalUpdate = prismaLike.campaign.update;

  const campaignUpdateCalls: Array<Record<string, unknown>> = [];

  prismaLike.campaign.findUnique = async () => ({
    id: "cmp-1",
    title: "Route Test Campaign",
    ruleset: "D&D 5e",
    bootstrapJson: null,
    combatStateJson: null,
    characters: [
      {
        id: "pc-1",
        name: "Raint",
        sheetJson: {
          level: 1,
          hp: { current: 9, max: 9 },
          ac: 13,
        },
      },
      {
        id: "pc-2",
        name: "Buck",
        sheetJson: {
          level: 1,
          hp: { current: 12, max: 12 },
          ac: 15,
        },
      },
    ],
    messages: [{ id: "m-1", content: "Starting tavern standoff." }],
  });

  prismaLike.campaign.update = async (args: Record<string, unknown>) => {
    campaignUpdateCalls.push(args);
    return { id: "cmp-1" };
  };

  try {
    const req = new Request("http://localhost/api/campaigns/cmp-1/combat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-State-Logging": "true",
      },
      body: JSON.stringify({
        action: "start",
        seedInput: "route-test-seed",
        combatants: [
          { id: "pc-1", name: "Raint", type: "character" },
          { id: "pc-2", name: "Buck", type: "character" },
          { name: "Gang Lieutenant", type: "enemy", hp: "Unknown" },
          { name: "Gang Enforcer 1", type: "enemy", hp: "??/??" },
          { name: "Gang Enforcer 2", type: "enemy", hp: "Unknown" },
        ],
      }),
    });

    const res = await POST(req as unknown as Parameters<typeof POST>[0], {
      params: Promise.resolve({ id: "cmp-1" }),
    });
    assert.equal(res.status, 200);
    const data = (await res.json()) as Record<string, unknown>;

    assert.ok(data.combatStateJson, "expected combat state");
    assert.ok(data.adapterDebug, "expected adapter debug payload");
    const adapterDebug = data.adapterDebug as Record<string, unknown>;
    assert.ok(adapterDebug.encounterStart, "expected encounter start telemetry");
    assert.ok(adapterDebug.encounterRisk, "expected encounter risk telemetry");

    const encounterStart = adapterDebug.encounterStart as Record<string, unknown>;
    const enemyAssignments = encounterStart.enemyAssignments as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(enemyAssignments));
    assert.equal(enemyAssignments.length, 3);
    for (const assignment of enemyAssignments) {
      assert.match(String(assignment.hpAfter ?? ""), /^\d+\/\d+$/);
    }

    const combatState = data.combatStateJson as Record<string, unknown>;
    const roster = (combatState.roster as Array<Record<string, unknown>>) ?? [];
    const enemyRoster = roster.filter((entry) => entry.type === "enemy");
    assert.ok(enemyRoster.length >= 3, "expected enemies in initiative roster");
    for (const enemy of enemyRoster) {
      assert.match(String(enemy.hp ?? ""), /^\d+\/\d+$/);
    }

    assert.ok(campaignUpdateCalls.length > 0, "expected campaign update to persist combat state");
  } finally {
    prismaLike.campaign.findUnique = originalFindUnique;
    prismaLike.campaign.update = originalUpdate;
  }
});
