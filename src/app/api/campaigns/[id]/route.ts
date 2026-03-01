import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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

  return NextResponse.json({
    campaign: {
      id: campaign.id,
      title: campaign.title,
      ruleset: campaign.ruleset,
      createdAt: campaign.createdAt,
      updatedAt: campaign.updatedAt,
      characters: campaign.characters,
    },
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
