import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  buildInitialCampaignBootstrap,
  normalizeCampaignBootstrap,
  projectCampaignBootstrapForPlayer,
} from "@/lib/campaign-bootstrap";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_req: NextRequest, context: RouteContext) {
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
    },
  });
}
