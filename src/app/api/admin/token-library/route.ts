import { NextRequest, NextResponse } from "next/server";
import { listTokenLibraryEntries, normalizeTokenKey, upsertTokenLibraryEntry } from "@/lib/token-library";

export async function GET(req: NextRequest) {
  const ruleset = req.nextUrl.searchParams.get("ruleset")?.trim() ?? "";
  const entityType = req.nextUrl.searchParams.get("entityType")?.trim() ?? "";
  const category = req.nextUrl.searchParams.get("category")?.trim() ?? "";
  const subtype = req.nextUrl.searchParams.get("subtype")?.trim() ?? "";
  const normalizedKey = req.nextUrl.searchParams.get("normalizedKey")?.trim() ?? "";
  const limitRaw = Number.parseInt(req.nextUrl.searchParams.get("limit")?.trim() ?? "", 10);
  const limit = Number.isFinite(limitRaw) ? limitRaw : 100;

  const entries = await listTokenLibraryEntries({
    ruleset,
    entityType,
    category,
    subtype,
    normalizedKey,
    limit,
  });

  return NextResponse.json({ entries });
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }
  const typedBody =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};

  const entityTypeRaw = typeof typedBody.entityType === "string" ? typedBody.entityType.trim().toLowerCase() : "";
  const entityType = entityTypeRaw === "enemy" ? "enemy" : entityTypeRaw === "character" ? "character" : "";
  const ruleset = typeof typedBody.ruleset === "string" ? typedBody.ruleset.trim() : "";
  const category =
    typeof typedBody.category === "string" && typedBody.category.trim()
      ? typedBody.category.trim()
      : "general";
  const subtype =
    typeof typedBody.subtype === "string" ? typedBody.subtype.trim() : "";
  const label = typeof typedBody.label === "string" ? typedBody.label.trim() : "";
  const style = typeof typedBody.style === "string" && typedBody.style.trim() ? typedBody.style.trim() : "stone-base";
  const imageDataUrl =
    typeof typedBody.imageDataUrl === "string" && typedBody.imageDataUrl.startsWith("data:image/")
      ? typedBody.imageDataUrl
      : "";
  const sourcePrompt = typeof typedBody.sourcePrompt === "string" ? typedBody.sourcePrompt : "";
  const normalizedKeyInput = typeof typedBody.normalizedKey === "string" ? typedBody.normalizedKey.trim() : "";
  const approved = Boolean(typedBody.approved);

  if (!entityType) {
    return NextResponse.json({ error: "entityType must be 'character' or 'enemy'." }, { status: 400 });
  }
  if (!ruleset) {
    return NextResponse.json({ error: "ruleset is required." }, { status: 400 });
  }
  if (!label) {
    return NextResponse.json({ error: "label is required." }, { status: 400 });
  }
  if (!imageDataUrl) {
    return NextResponse.json({ error: "imageDataUrl is required and must be a data URL." }, { status: 400 });
  }

  const normalizedKey = normalizeTokenKey(
    normalizedKeyInput || `${entityType}:${category}:${subtype || "base"}:${label}`,
  );
  if (!normalizedKey) {
    return NextResponse.json({ error: "normalizedKey is invalid." }, { status: 400 });
  }

  const entry = await upsertTokenLibraryEntry({
    entityType,
    ruleset,
    category,
    subtype,
    normalizedKey,
    label,
    style,
    imageDataUrl,
    sourcePrompt,
    approved,
  });

  return NextResponse.json({ entry }, { status: 201 });
}
