import { NextRequest, NextResponse } from "next/server";
import {
  buildDefaultTokenKey,
  findOrGenerateToken,
  normalizeTokenKey,
  type TokenEntityType,
} from "@/lib/token-library";

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
  const entityType: TokenEntityType | "" =
    entityTypeRaw === "enemy" ? "enemy" : entityTypeRaw === "character" ? "character" : "";
  const ruleset = typeof typedBody.ruleset === "string" ? typedBody.ruleset.trim() : "";
  const category =
    typeof typedBody.category === "string" && typedBody.category.trim()
      ? typedBody.category.trim()
      : "general";
  const subtype =
    typeof typedBody.subtype === "string" ? typedBody.subtype.trim() : "";
  const label = typeof typedBody.label === "string" ? typedBody.label.trim() : "";
  const customDescription =
    typeof typedBody.customDescription === "string" ? typedBody.customDescription.trim() : "";
  const style =
    typeof typedBody.style === "string" && typedBody.style.trim()
      ? typedBody.style.trim()
      : "stone-base";
  const instructions =
    typeof typedBody.instructions === "string" ? typedBody.instructions.trim() : "";
  const normalizedKeyInput =
    typeof typedBody.normalizedKey === "string" ? typedBody.normalizedKey.trim() : "";
  const forceRegenerate = Boolean(typedBody.forceRegenerate);
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

  const normalizedKey = normalizeTokenKey(
    normalizedKeyInput ||
      buildDefaultTokenKey({ entityType, category, subtype, label }),
  );
  if (!normalizedKey) {
    return NextResponse.json({ error: "normalizedKey is invalid." }, { status: 400 });
  }

  try {
    const result = await findOrGenerateToken({
      entityType,
      ruleset,
      category,
      subtype,
      normalizedKey,
      label,
      customDescription:
        customDescription ||
        `Character name: ${label}. Token type: ${entityType}.`,
      style,
      instructions,
      forceRegenerate,
      approved,
    });

    return NextResponse.json({
      entry: result.token,
      cacheHit: result.cacheHit,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to generate token image.",
      },
      { status: 502 },
    );
  }
}
