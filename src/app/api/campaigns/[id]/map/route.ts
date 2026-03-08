import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { appendSceneImageHistory, generateSceneMap, normalizeSceneImageHistory } from "@/lib/map";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(_req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const rawBody = await _req.json().catch(() => ({}));
  const body =
    rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
      ? (rawBody as Record<string, unknown>)
      : {};
  const scenePrompt =
    typeof body.scenePrompt === "string" ? body.scenePrompt.trim() : "";

  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const latestGmMessage =
    [...campaign.messages]
      .reverse()
      .find((message) => message.role === "gm" && typeof message.content === "string") ??
    campaign.messages[0];

  if (!latestGmMessage) {
    return NextResponse.json(
      { error: "No GM scene is available to map." },
      { status: 400 },
    );
  }

  const mapState = await generateSceneMap({
    ruleset: campaign.ruleset,
    campaignTitle: campaign.title,
    latestGmContent: latestGmMessage.content,
    scenePrompt,
  });
  const sceneImageHistory = appendSceneImageHistory(
    (campaign as { sceneImageHistoryJson?: unknown }).sceneImageHistoryJson,
    mapState,
  );

  await prisma.campaign.update({
    where: { id },
    data: {
      mapStateJson: mapState,
      sceneImageHistoryJson: sceneImageHistory,
    } as never,
  });

  return NextResponse.json({
    mapStateJson: mapState,
    sceneImageHistoryJson: normalizeSceneImageHistory(sceneImageHistory),
  });
}
