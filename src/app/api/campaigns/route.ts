import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  buildOpeningMessageFromScenario,
  buildCampaignTitle,
  getDefaultStartingScenario,
  getStarterTemplate,
  markStarterCharacters,
} from "@/lib/campaigns";

export async function GET() {
  const campaigns = await prisma.campaign.findMany({
    orderBy: {
      updatedAt: "desc",
    },
    take: 8,
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

  if (!ruleset) {
    return NextResponse.json(
      { error: "ruleset is required" },
      { status: 400 },
    );
  }

  const starterTemplate = getStarterTemplate(ruleset);
  const starterMainCharacter = starterTemplate.characters.filter(
    (character) => character.isMainCharacter,
  );
  const initialScenario =
    startingScenario || getDefaultStartingScenario(ruleset);

  const campaign = await prisma.campaign.create({
    data: {
      title: buildCampaignTitle(title, ruleset),
      ruleset,
      characters: {
        create: markStarterCharacters(starterMainCharacter),
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
    },
  });

  return NextResponse.json({
    campaignId: campaign.id,
    title: campaign.title,
    characterCount: starterMainCharacter.length,
    messageCount: 1,
  });
}
