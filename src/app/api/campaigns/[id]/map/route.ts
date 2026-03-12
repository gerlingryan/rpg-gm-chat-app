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
  const imageType =
    typeof body.imageType === "string" ? body.imageType.trim().toLowerCase() : "";
  const imageStyle =
    typeof body.imageStyle === "string" ? body.imageStyle.trim() : "";
  const imageTitle =
    typeof body.imageTitle === "string" ? body.imageTitle.trim() : "";
  const imageSubtitle =
    typeof body.imageSubtitle === "string" ? body.imageSubtitle.trim() : "";
  const imageAspectRatio =
    typeof body.imageAspectRatio === "string"
      ? body.imageAspectRatio.trim().toLowerCase()
      : "";
  const imageSeedRaw =
    typeof body.imageSeed === "number"
      ? body.imageSeed
      : typeof body.imageSeed === "string" && body.imageSeed.trim()
        ? Number(body.imageSeed.trim())
        : null;
  const imageSeed =
    typeof imageSeedRaw === "number" && Number.isFinite(imageSeedRaw)
      ? Math.trunc(imageSeedRaw)
      : undefined;

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

  const generatedMapState = await generateSceneMap({
    ruleset: campaign.ruleset,
    campaignTitle: campaign.title,
    latestGmContent: latestGmMessage.content,
    scenePrompt,
    imageType:
      imageType === "portrait" ||
      imageType === "character" ||
      imageType === "action" ||
      imageType === "character-token" ||
      imageType === "scene"
        ? imageType
        : undefined,
    aspectRatio:
      imageAspectRatio === "portrait" || imageAspectRatio === "square"
        ? imageAspectRatio
        : "landscape",
    seed: imageSeed,
  });
  const normalizedImageType =
    imageType === "portrait" ||
    imageType === "character" ||
    imageType === "action" ||
    imageType === "character-token" ||
    imageType === "scene"
      ? imageType
      : generatedMapState.imageType;
  const resolvedSceneTitle = imageTitle || generatedMapState.sceneTitle;
  const resolvedPlace = imageSubtitle || generatedMapState.place;
  const mapState = {
    ...generatedMapState,
    title: resolvedPlace ? `${resolvedSceneTitle} - ${resolvedPlace}` : resolvedSceneTitle,
    sceneTitle: resolvedSceneTitle,
    place: resolvedPlace,
    imageType: normalizedImageType,
    imageStyle: imageStyle || generatedMapState.imageStyle,
  };
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
