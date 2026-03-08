import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  appendWorldMapHistory,
  generateWorldMap,
  normalizeWorldMapPins,
  normalizeWorldMapHistory,
  normalizeWorldMapState,
  type WorldMapState,
} from "@/lib/map";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

async function tryFetchReferenceImageDataUrl(url: string) {
  try {
    const parsedUrl = new URL(url);

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return null;
    }

    const response = await fetch(parsedUrl.toString(), {
      method: "GET",
      redirect: "follow",
      headers: {
        Accept: "image/*,*/*;q=0.8",
        "User-Agent": "Mozilla/5.0 (compatible; RPG-GM-Chat/1.0)",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return null;
    }

    const contentTypeHeader = response.headers.get("content-type") ?? "";
    const contentType = contentTypeHeader.split(";")[0]?.trim().toLowerCase();

    if (!contentType || !contentType.startsWith("image/")) {
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const maxBytes = 8 * 1024 * 1024;

    if (arrayBuffer.byteLength <= 0 || arrayBuffer.byteLength > maxBytes) {
      return null;
    }

    const base64 = Buffer.from(arrayBuffer).toString("base64");
    return `data:${contentType};base64,${base64}`;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const rawBody = await req.json();
  const body =
    rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
      ? (rawBody as Record<string, unknown>)
      : {};
  const worldDescription =
    typeof body.worldDescription === "string" ? body.worldDescription.trim() : "";
  const mode =
    body.mode === "reference" ? "reference" : "generated";
  const title =
    typeof body.title === "string" ? body.title.trim() : "";
  const referenceUrl =
    typeof body.referenceUrl === "string" ? body.referenceUrl.trim() : "";
  const referenceImageDataUrl =
    typeof body.referenceImageDataUrl === "string" &&
    body.referenceImageDataUrl.startsWith("data:image/")
      ? body.referenceImageDataUrl
      : null;

  if (mode === "generated" && !worldDescription) {
    return NextResponse.json(
      { error: "World description is required." },
      { status: 400 },
    );
  }

  const campaign = await prisma.campaign.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      ruleset: true,
      worldMapHistoryJson: true,
    },
  });

  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  let worldMap: WorldMapState;

  if (mode === "reference") {
    if (!referenceUrl && !referenceImageDataUrl) {
      return NextResponse.json(
        { error: "Reference URL or uploaded image is required." },
        { status: 400 },
      );
    }

    const fetchedReferenceImageDataUrl =
      !referenceImageDataUrl && referenceUrl
        ? await tryFetchReferenceImageDataUrl(referenceUrl)
        : null;

    worldMap = {
      mode: "reference",
      title: title || `${campaign.title} World Map`.trim() || "World Map",
      worldDescription,
      referenceUrl,
      summary: referenceUrl
        ? "Reference map provided by URL."
        : "Reference map uploaded.",
      imageDataUrl: referenceImageDataUrl ?? fetchedReferenceImageDataUrl,
      pins: [],
      generatedAt: new Date().toISOString(),
    };
  } else {
    worldMap = await generateWorldMap({
      ruleset: campaign.ruleset,
      campaignTitle: campaign.title,
      worldDescription,
      title,
    });
  }

  const worldMapHistory = appendWorldMapHistory(
    (campaign as { worldMapHistoryJson?: unknown }).worldMapHistoryJson,
    worldMap,
  );

  await prisma.campaign.update({
    where: { id },
    data: {
      worldMapJson: worldMap,
      worldMapHistoryJson: worldMapHistory,
    } as never,
  });

  return NextResponse.json({
    worldMapJson: normalizeWorldMapState(worldMap),
    worldMapHistoryJson: normalizeWorldMapHistory(worldMapHistory),
  });
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const rawBody = await req.json();
  const body =
    rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
      ? (rawBody as Record<string, unknown>)
      : {};
  const action = typeof body.action === "string" ? body.action.trim() : "";

  if (action !== "update-title" && action !== "delete" && action !== "update-pins") {
    return NextResponse.json({ error: "Unsupported world map action." }, { status: 400 });
  }

  const index =
    typeof body.index === "number" && Number.isFinite(body.index)
      ? Math.trunc(body.index)
      : -1;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const pins = normalizeWorldMapPins(body.pins);

  if (index < 0 || (action === "update-title" && !title)) {
    return NextResponse.json(
      {
        error:
          action === "delete"
            ? "Valid map index is required."
            : "Valid map index and title are required.",
      },
      { status: 400 },
    );
  }

  const campaign = await prisma.campaign.findUnique({
    where: { id },
    select: {
      id: true,
      worldMapHistoryJson: true,
    },
  });

  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const history = normalizeWorldMapHistory(
    (campaign as { worldMapHistoryJson?: unknown }).worldMapHistoryJson,
  );

  if (index >= history.length) {
    return NextResponse.json({ error: "World map not found." }, { status: 404 });
  }

  const nextHistory =
    action === "delete"
      ? history.filter((_, entryIndex) => entryIndex !== index)
      : action === "update-pins"
        ? history.map((entry, entryIndex) =>
            entryIndex === index
              ? {
                  ...entry,
                  pins,
                }
              : entry,
          )
        : history.map((entry, entryIndex) =>
            entryIndex === index
              ? {
                  ...entry,
                  title,
                }
              : entry,
          );
  const latestMap = nextHistory[nextHistory.length - 1] ?? null;

  await prisma.campaign.update({
    where: { id },
    data: {
      worldMapJson: latestMap,
      worldMapHistoryJson: nextHistory,
    } as never,
  });

  return NextResponse.json({
    worldMapJson: normalizeWorldMapState(latestMap),
    worldMapHistoryJson: normalizeWorldMapHistory(nextHistory),
  });
}
