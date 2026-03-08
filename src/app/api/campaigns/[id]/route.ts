import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizePartyState } from "@/lib/party";
import { normalizeCombatState } from "@/lib/combat";
import {
  normalizeSceneImageHistory,
  normalizeSceneMapState,
  normalizeWorldMapHistory,
  normalizeWorldMapState,
} from "@/lib/map";
import { normalizeCampaignChatModel } from "@/lib/chat-model";
import {
  buildProgressionStateFromEvents,
  getDefaultProgressionCurrencyForRuleset,
  normalizeProgressionEvents,
  normalizeProgressionState,
} from "@/lib/progression";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_req: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: {
      characters: {
        orderBy: [
          { isMainCharacter: "desc" },
          { id: "asc" },
        ],
      },
    },
  });

  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }
  const progressionEvents = normalizeProgressionEvents(
    (campaign as { progressionEventsJson?: unknown }).progressionEventsJson,
  );
  const normalizedBaseProgressionState = normalizeProgressionState(
    (campaign as { progressionStateJson?: unknown }).progressionStateJson,
  );
  const progressionState = buildProgressionStateFromEvents({
    events: progressionEvents,
    characterIds: campaign.characters.map((character) => character.id),
    baseState: {
      ...normalizedBaseProgressionState,
      currency:
        (campaign as { progressionStateJson?: unknown }).progressionStateJson == null
          ? getDefaultProgressionCurrencyForRuleset(campaign.ruleset)
          : normalizedBaseProgressionState.currency,
    },
  });

  return NextResponse.json({
    campaign: {
      id: campaign.id,
      title: campaign.title,
      ruleset: campaign.ruleset,
      chatModel: normalizeCampaignChatModel(
        (campaign as { chatModel?: unknown }).chatModel,
      ),
      progressionStateJson: progressionState,
      progressionEventsJson: progressionEvents,
      partyStateJson: normalizePartyState(
        (campaign as { partyStateJson?: unknown }).partyStateJson,
      ),
      mapStateJson: normalizeSceneMapState(
        (campaign as { mapStateJson?: unknown }).mapStateJson,
      ),
      worldMapJson: normalizeWorldMapState(
        (campaign as { worldMapJson?: unknown }).worldMapJson,
      ),
      worldMapHistoryJson: normalizeWorldMapHistory(
        (campaign as { worldMapHistoryJson?: unknown }).worldMapHistoryJson,
      ),
      sceneImageHistoryJson: normalizeSceneImageHistory(
        (campaign as { sceneImageHistoryJson?: unknown }).sceneImageHistoryJson,
      ),
      combatStateJson: normalizeCombatState(
        (campaign as { combatStateJson?: unknown }).combatStateJson,
      ),
      createdAt: campaign.createdAt,
      updatedAt: campaign.updatedAt,
      characters: campaign.characters,
    },
  });
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const rawBody = await req.json();
  const body =
    rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
      ? (rawBody as Record<string, unknown>)
      : {};
  const hasPartyState = Object.prototype.hasOwnProperty.call(body, "partyState");
  const hasSceneImageHistory = Object.prototype.hasOwnProperty.call(
    body,
    "sceneImageHistory",
  );
  const hasMapState = Object.prototype.hasOwnProperty.call(body, "mapState");
  const hasWorldMap = Object.prototype.hasOwnProperty.call(body, "worldMap");
  const hasWorldMapHistory = Object.prototype.hasOwnProperty.call(
    body,
    "worldMapHistory",
  );
  const hasCombatState = Object.prototype.hasOwnProperty.call(body, "combatState");
  const hasChatModel = Object.prototype.hasOwnProperty.call(body, "chatModel");
  const hasProgressionState = Object.prototype.hasOwnProperty.call(
    body,
    "progressionState",
  );
  const hasProgressionEvents = Object.prototype.hasOwnProperty.call(
    body,
    "progressionEvents",
  );

  if (
    hasPartyState ||
    hasSceneImageHistory ||
    hasMapState ||
    hasWorldMap ||
    hasWorldMapHistory ||
    hasCombatState ||
    hasChatModel ||
    hasProgressionState ||
    hasProgressionEvents
  ) {
    const existingCampaign = await prisma.campaign.findUnique({
      where: { id },
      select: {
        id: true,
      },
    });

    if (!existingCampaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const updatedCampaign = await prisma.campaign.update({
      where: { id },
      data: {
        ...(hasPartyState
          ? {
              partyStateJson: normalizePartyState(body.partyState),
            }
          : {}),
        ...(hasSceneImageHistory
          ? {
              sceneImageHistoryJson: normalizeSceneImageHistory(
                body.sceneImageHistory,
              ),
            }
          : {}),
        ...(hasMapState
          ? {
              mapStateJson: normalizeSceneMapState(body.mapState),
            }
          : {}),
        ...(hasWorldMap
          ? {
              worldMapJson: normalizeWorldMapState(body.worldMap),
            }
          : {}),
        ...(hasWorldMapHistory
          ? {
              worldMapHistoryJson: normalizeWorldMapHistory(body.worldMapHistory),
            }
          : {}),
        ...(hasCombatState
          ? {
              combatStateJson: normalizeCombatState(body.combatState),
            }
          : {}),
        ...(hasChatModel
          ? {
              chatModel: normalizeCampaignChatModel(body.chatModel),
            }
          : {}),
        ...(hasProgressionState
          ? {
              progressionStateJson: normalizeProgressionState(body.progressionState),
            }
          : {}),
        ...(hasProgressionEvents
          ? {
              progressionEventsJson: normalizeProgressionEvents(
                body.progressionEvents,
              ),
            }
          : {}),
      } as never,
      include: {
        characters: {
          orderBy: [
            { isMainCharacter: "desc" },
            { id: "asc" },
          ],
        },
      },
    });

    return NextResponse.json({
      campaign: {
        id: updatedCampaign.id,
        title: updatedCampaign.title,
        ruleset: updatedCampaign.ruleset,
        chatModel: normalizeCampaignChatModel(
          (updatedCampaign as { chatModel?: unknown }).chatModel,
        ),
        progressionStateJson: buildProgressionStateFromEvents({
          events: normalizeProgressionEvents(
            (updatedCampaign as { progressionEventsJson?: unknown }).progressionEventsJson,
          ),
          characterIds: updatedCampaign.characters.map((character) => character.id),
          baseState: {
            ...normalizeProgressionState(
              (updatedCampaign as { progressionStateJson?: unknown }).progressionStateJson,
            ),
            currency:
              (updatedCampaign as { progressionStateJson?: unknown }).progressionStateJson ==
              null
                ? getDefaultProgressionCurrencyForRuleset(updatedCampaign.ruleset)
                : normalizeProgressionState(
                    (updatedCampaign as { progressionStateJson?: unknown }).progressionStateJson,
                  ).currency,
          },
        }),
        progressionEventsJson: normalizeProgressionEvents(
          (updatedCampaign as { progressionEventsJson?: unknown }).progressionEventsJson,
        ),
        partyStateJson: normalizePartyState(
          (updatedCampaign as { partyStateJson?: unknown }).partyStateJson,
        ),
        mapStateJson: normalizeSceneMapState(
          (updatedCampaign as { mapStateJson?: unknown }).mapStateJson,
        ),
        worldMapJson: normalizeWorldMapState(
          (updatedCampaign as { worldMapJson?: unknown }).worldMapJson,
        ),
        worldMapHistoryJson: normalizeWorldMapHistory(
          (updatedCampaign as { worldMapHistoryJson?: unknown }).worldMapHistoryJson,
        ),
        sceneImageHistoryJson: normalizeSceneImageHistory(
          (updatedCampaign as { sceneImageHistoryJson?: unknown }).sceneImageHistoryJson,
        ),
        combatStateJson: normalizeCombatState(
          (updatedCampaign as { combatStateJson?: unknown }).combatStateJson,
        ),
        createdAt: updatedCampaign.createdAt,
        updatedAt: updatedCampaign.updatedAt,
        characters: updatedCampaign.characters,
      },
    });
  }

  const startingScenario =
    typeof body.startingScenario === "string" ? body.startingScenario.trim() : "";

  if (!startingScenario) {
    return NextResponse.json(
      { error: "Starting scenario is required." },
      { status: 400 },
    );
  }

  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
        take: 1,
      },
    },
  });

  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const scenarioMessage = campaign.messages[0];

  if (!scenarioMessage) {
    return NextResponse.json(
      { error: "Scenario message not found" },
      { status: 400 },
    );
  }

  if (scenarioMessage.role !== "gm") {
    return NextResponse.json(
      { error: "Scenario message is not editable." },
      { status: 400 },
    );
  }

  if ((await prisma.message.count({ where: { campaignId: id } })) > 1) {
    return NextResponse.json(
      { error: "The starting scenario can only be changed before the campaign starts." },
      { status: 400 },
    );
  }

  const updatedMessage = await prisma.message.update({
    where: { id: scenarioMessage.id },
    data: {
      content: startingScenario,
    },
  });

  return NextResponse.json({
    message: updatedMessage,
  });
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  const existingCampaign = await prisma.campaign.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!existingCampaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  await prisma.$transaction([
    prisma.message.deleteMany({
      where: { campaignId: id },
    }),
    prisma.character.deleteMany({
      where: { campaignId: id },
    }),
    prisma.campaign.delete({
      where: { id },
    }),
  ]);

  return NextResponse.json({ success: true });
}
