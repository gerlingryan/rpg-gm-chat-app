import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  type CampaignBootstrap,
  buildInitialCampaignBootstrap,
  normalizeCampaignBootstrap,
  projectCampaignBootstrapForPlayer,
} from "@/lib/campaign-bootstrap";
import { applyCampaignBootstrapTurnUpdate } from "@/lib/campaign-bootstrap-reducer";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function hasDebugAccess(req: NextRequest) {
  if (process.env.NODE_ENV !== "production") {
    return true;
  }

  const requestDebugHeader = req.headers.get("x-debug-state-logging")?.trim().toLowerCase();
  if (requestDebugHeader === "true" || requestDebugHeader === "1") {
    return true;
  }

  const expectedToken = process.env.CAMPAIGN_DEBUG_TOKEN?.trim();
  const providedToken =
    req.headers.get("x-campaign-debug-token")?.trim() ??
    req.nextUrl.searchParams.get("debugToken")?.trim() ??
    "";

  if (expectedToken && providedToken && expectedToken === providedToken) {
    return true;
  }

  return false;
}

export async function GET(req: NextRequest, context: RouteContext) {
  if (!hasDebugAccess(req)) {
    return NextResponse.json({ error: "Debug bootstrap access denied." }, { status: 403 });
  }

  const { id } = await context.params;

  const campaign = await prisma.campaign.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      ruleset: true,
      bootstrapJson: true,
      updatedAt: true,
      messages: {
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { content: true },
      },
    },
  });

  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const fallbackBootstrap = buildInitialCampaignBootstrap({
    title: campaign.title,
    ruleset: campaign.ruleset,
    startingScenario: campaign.messages[0]?.content ?? "",
  });
  const bootstrap = normalizeCampaignBootstrap(campaign.bootstrapJson, fallbackBootstrap);

  return NextResponse.json({
    bootstrap: {
      campaignId: campaign.id,
      schemaVersion: bootstrap.schemaVersion,
      updatedAt: campaign.updatedAt,
      publicView: projectCampaignBootstrapForPlayer(bootstrap),
      hiddenView: bootstrap,
    },
  });
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function applyDebugBootstrapAction(
  bootstrap: CampaignBootstrap,
  body: Record<string, unknown>,
) {
  const action = typeof body.action === "string" ? body.action.trim().toLowerCase() : "";
  const difficultyModeRaw =
    typeof body.difficultyMode === "string" ? body.difficultyMode.trim().toLowerCase() : "";
  const varianceRaw =
    typeof body.encounterVariance === "string"
      ? body.encounterVariance.trim().toLowerCase()
      : "";
  const difficultyMode =
    difficultyModeRaw === "cinematic" ||
    difficultyModeRaw === "standard" ||
    difficultyModeRaw === "deadly"
      ? difficultyModeRaw
      : null;
  const encounterVariance =
    varianceRaw === "low" || varianceRaw === "medium" || varianceRaw === "high"
      ? varianceRaw
      : null;

  if (action === "advance-clock") {
    const clockId = typeof body.clockId === "string" ? body.clockId.trim() : "";
    const deltaRaw = typeof body.delta === "number" ? body.delta : Number(body.delta);
    const delta =
      Number.isFinite(deltaRaw) && Math.trunc(deltaRaw) !== 0 ? Math.trunc(deltaRaw) : 1;
    if (!clockId) {
      return bootstrap;
    }
    return applyCampaignBootstrapTurnUpdate(bootstrap, {
      clocks_advanced: [{ id: clockId, delta }],
      loop_breaker_reason: "Debug override: manual clock advance.",
    });
  }

  if (action === "reveal-quest") {
    const questId = typeof body.questId === "string" ? body.questId.trim() : "";
    if (!questId) {
      return bootstrap;
    }
    return applyCampaignBootstrapTurnUpdate(bootstrap, {
      quest_updates: [{ id: questId, visibility: "player", status: "active" }],
      loop_breaker_reason: "Debug override: quest manually revealed.",
    });
  }

  if (action === "reveal-clue") {
    const clueId = typeof body.clueId === "string" ? body.clueId.trim() : "";
    if (!clueId) {
      return bootstrap;
    }
    return applyCampaignBootstrapTurnUpdate(bootstrap, {
      clues_revealed: [clueId],
      loop_breaker_reason: "Debug override: clue manually revealed.",
    });
  }

  if (action === "set-combat-generation") {
    if (!difficultyMode && !encounterVariance) {
      return bootstrap;
    }

    return {
      ...bootstrap,
      combat_generation: {
        ...bootstrap.combat_generation,
        ...(difficultyMode ? { difficultyMode } : {}),
        ...(encounterVariance ? { encounterVariance } : {}),
      },
      gm_notes: {
        ...bootstrap.gm_notes,
        offscreen_pressure: [
          ...bootstrap.gm_notes.offscreen_pressure,
          `Debug override: combat_generation set to ${difficultyMode ?? bootstrap.combat_generation.difficultyMode}/${encounterVariance ?? bootstrap.combat_generation.encounterVariance}.`,
        ].slice(-20),
      },
    };
  }

  return bootstrap;
}

export async function POST(req: NextRequest, context: RouteContext) {
  if (!hasDebugAccess(req)) {
    return NextResponse.json({ error: "Debug bootstrap access denied." }, { status: 403 });
  }

  const { id } = await context.params;
  const body = asObject(await req.json());
  if (!body) {
    return NextResponse.json({ error: "Invalid debug bootstrap payload." }, { status: 400 });
  }

  const campaign = await prisma.campaign.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      ruleset: true,
      bootstrapJson: true,
      updatedAt: true,
      messages: {
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { content: true },
      },
    },
  });

  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const fallbackBootstrap = buildInitialCampaignBootstrap({
    title: campaign.title,
    ruleset: campaign.ruleset,
    startingScenario: campaign.messages[0]?.content ?? "",
  });
  const currentBootstrap = normalizeCampaignBootstrap(campaign.bootstrapJson, fallbackBootstrap);
  const updatedBootstrap = applyDebugBootstrapAction(currentBootstrap, body);

  const saved = await prisma.campaign.update({
    where: { id },
    data: {
      bootstrapJson: updatedBootstrap,
    },
    select: {
      id: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({
    bootstrap: {
      campaignId: saved.id,
      schemaVersion: updatedBootstrap.schemaVersion,
      updatedAt: saved.updatedAt,
      publicView: projectCampaignBootstrapForPlayer(updatedBootstrap),
      hiddenView: updatedBootstrap,
    },
  });
}
