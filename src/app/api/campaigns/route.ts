import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  buildOpeningMessageFromScenario,
  buildCampaignTitle,
  getDefaultStartingScenario,
  withDerivedBehaviorSummary,
} from "@/lib/campaigns";
import { buildInitialPartyState } from "@/lib/party";
import { DEFAULT_CAMPAIGN_CHAT_MODEL } from "@/lib/chat-model";
import {
  DEFAULT_PROGRESSION_STATE,
  getDefaultProgressionCurrencyForRuleset,
} from "@/lib/progression";

export async function GET(req: NextRequest) {
  const limitParam = req.nextUrl.searchParams.get("limit")?.trim() ?? "";
  const parsedLimit = Number.parseInt(limitParam, 10);
  const take =
    Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : undefined;

  const campaigns = await prisma.campaign.findMany({
    orderBy: {
      updatedAt: "desc",
    },
    take,
    include: {
      _count: {
        select: {
          messages: true,
          characters: true,
        },
      },
    },
  });

  return NextResponse.json({
    campaigns: campaigns.map((campaign) => ({
      id: campaign.id,
      title: campaign.title,
      ruleset: campaign.ruleset,
      createdAt: campaign.createdAt,
      updatedAt: campaign.updatedAt,
      messageCount: campaign._count.messages,
      characterCount: campaign._count.characters,
    })),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const title =
    typeof body.title === "string" ? body.title.trim() : "";
  const ruleset =
    typeof body.ruleset === "string" ? body.ruleset.trim() : "";
  const startingScenario =
    typeof body.startingScenario === "string" ? body.startingScenario.trim() : "";
  const narrationLevelRaw =
    typeof body.narrationLevel === "string" ? body.narrationLevel.trim().toLowerCase() : "";
  const libraryCharacterId =
    typeof body.libraryCharacterId === "string"
      ? body.libraryCharacterId.trim()
      : "";
  const narrationLevel =
    narrationLevelRaw === "light" || narrationLevelRaw === "high"
      ? narrationLevelRaw
      : "medium";

  if (!ruleset) {
    return NextResponse.json(
      { error: "ruleset is required" },
      { status: 400 },
    );
  }
  const initialScenario =
    startingScenario || getDefaultStartingScenario(ruleset);

  if (!libraryCharacterId) {
    return NextResponse.json(
      { error: "libraryCharacterId is required." },
      { status: 400 },
    );
  }

  const libraryCharacter = await prisma.libraryCharacter.findUnique({
    where: { id: libraryCharacterId },
  });

  if (!libraryCharacter) {
    return NextResponse.json(
      { error: "Selected library character was not found." },
      { status: 404 },
    );
  }

  if (libraryCharacter.ruleset.trim().toLowerCase() !== ruleset.trim().toLowerCase()) {
    return NextResponse.json(
      { error: "Selected library character does not match the chosen ruleset." },
      { status: 400 },
    );
  }

  const importedSheet =
    libraryCharacter.sheetJson &&
    typeof libraryCharacter.sheetJson === "object" &&
    !Array.isArray(libraryCharacter.sheetJson)
      ? JSON.parse(JSON.stringify(libraryCharacter.sheetJson)) as Record<string, unknown>
      : {};

  const resolvedTitle = buildCampaignTitle(title, ruleset);
  const initialPartyState = {
    ...buildInitialPartyState(resolvedTitle),
    narrationLevel,
  };

  const campaignCreateData = {
    title: resolvedTitle,
    ruleset,
    chatModel: DEFAULT_CAMPAIGN_CHAT_MODEL,
    progressionStateJson: {
      ...DEFAULT_PROGRESSION_STATE,
      currency: getDefaultProgressionCurrencyForRuleset(ruleset),
      updatedAt: new Date().toISOString(),
    },
    progressionEventsJson: [],
    partyStateJson: initialPartyState,
    characters: {
      create: [
        {
          name: libraryCharacter.name,
          role: "player",
          isMainCharacter: true,
          originLibraryCharacterId: libraryCharacter.id,
          sheetJson: withDerivedBehaviorSummary(
            {
              ...importedSheet,
              source: "user-generated",
            },
            libraryCharacter.name,
            libraryCharacter.memorySummary,
          ),
          memorySummary:
            libraryCharacter.memorySummary ??
            "Imported from the shared character library.",
        },
      ],
    },
    messages: {
      create: [
        {
          speakerName: "GM",
          role: "gm",
          content: buildOpeningMessageFromScenario(initialScenario),
        },
      ],
    },
  };

  const campaign = await prisma.campaign.create({
    data: campaignCreateData as never,
  });

  return NextResponse.json({
    campaignId: campaign.id,
    title: campaign.title,
    characterCount: 1,
    messageCount: 1,
    libraryCharacterId: libraryCharacter.id,
  });
}
