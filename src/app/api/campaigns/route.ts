import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  buildOpeningMessageFromScenario,
  buildCampaignTitle,
  getDefaultStartingScenario,
  withDerivedBehaviorSummary,
} from "@/lib/campaigns";
import { buildInitialCampaignBootstrap } from "@/lib/campaign-bootstrap";
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
  const companionLibraryCharacterIds = Array.isArray(body.companionLibraryCharacterIds)
    ? body.companionLibraryCharacterIds
        .filter((entry: unknown): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
  const narrationLevel =
    narrationLevelRaw === "light" || narrationLevelRaw === "high"
      ? narrationLevelRaw
      : "medium";
  const tone = typeof body.tone === "string" ? body.tone.trim() : "";
  const scope = typeof body.scope === "string" ? body.scope.trim() : "";
  const theme = typeof body.theme === "string" ? body.theme.trim() : "";
  const partyType = typeof body.partyType === "string" ? body.partyType.trim() : "";
  const startingHook = typeof body.startingHook === "string" ? body.startingHook.trim() : "";
  const linesLimits = typeof body.linesLimits === "string" ? body.linesLimits.trim() : "";

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

  const uniqueCompanionIds = [...new Set(companionLibraryCharacterIds)].filter(
    (id) => id !== libraryCharacterId,
  );
  const companionLibraryCharacters =
    uniqueCompanionIds.length > 0
      ? await prisma.libraryCharacter.findMany({
          where: {
            id: {
              in: uniqueCompanionIds,
            },
          },
        })
      : [];

  if (companionLibraryCharacters.length !== uniqueCompanionIds.length) {
    return NextResponse.json(
      { error: "One or more selected companion characters were not found." },
      { status: 404 },
    );
  }

  const mismatchedCompanions = companionLibraryCharacters.filter(
    (character) => character.ruleset.trim().toLowerCase() !== ruleset.trim().toLowerCase(),
  );
  if (mismatchedCompanions.length > 0) {
    return NextResponse.json(
      { error: "One or more selected companions do not match the chosen ruleset." },
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
  const initialBootstrap = buildInitialCampaignBootstrap({
    title: resolvedTitle,
    ruleset,
    startingScenario: initialScenario,
    tone,
    scope,
    theme,
    partyType,
    startingHook,
    linesLimits,
  });

  const campaignCreateData = {
    title: resolvedTitle,
    ruleset,
    chatModel: DEFAULT_CAMPAIGN_CHAT_MODEL,
    bootstrapJson: initialBootstrap,
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
        ...companionLibraryCharacters.map((companion) => {
          const importedCompanionSheet =
            companion.sheetJson &&
            typeof companion.sheetJson === "object" &&
            !Array.isArray(companion.sheetJson)
              ? (JSON.parse(JSON.stringify(companion.sheetJson)) as Record<string, unknown>)
              : {};
          return {
            name: companion.name,
            role: "companion",
            isMainCharacter: false,
            originLibraryCharacterId: companion.id,
            sheetJson: withDerivedBehaviorSummary(
              {
                ...importedCompanionSheet,
                source: "user-generated",
              },
              companion.name,
              companion.memorySummary,
            ),
            memorySummary:
              companion.memorySummary ?? "Imported from the shared character library.",
          };
        }),
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
    characterCount: 1 + companionLibraryCharacters.length,
    messageCount: 1,
    libraryCharacterId: libraryCharacter.id,
    companionLibraryCharacterIds: companionLibraryCharacters.map((character) => character.id),
  });
}
