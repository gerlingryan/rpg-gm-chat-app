import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateCampaignRecap } from "@/lib/recap";
import { normalizePartyState } from "@/lib/party";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(_req: Request, context: RouteContext) {
  const { id } = await context.params;

  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: {
      messages: {
        orderBy: { createdAt: "desc" },
        take: 12,
      },
    },
  });

  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const recap = await generateCampaignRecap({
    campaignTitle: campaign.title,
    ruleset: campaign.ruleset,
    partyState: (campaign as { partyStateJson?: unknown }).partyStateJson,
    recentMessages: [...campaign.messages].reverse().map((message) => ({
      speakerName: message.speakerName,
      role: message.role,
      content: message.content,
    })),
  });

  const updatedPartyState = {
    ...normalizePartyState((campaign as { partyStateJson?: unknown }).partyStateJson),
    recap,
  };

  const updatedCampaign = await prisma.campaign.update({
    where: { id },
    data: {
      partyStateJson: updatedPartyState,
    } as never,
  });

  return NextResponse.json({
    partyStateJson: normalizePartyState(
      (updatedCampaign as { partyStateJson?: unknown }).partyStateJson,
    ),
  });
}
