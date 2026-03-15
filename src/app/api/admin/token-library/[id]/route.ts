import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

const prismaAny = prisma as unknown as {
  tokenLibraryEntry: {
    findUnique: (args: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
    update: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
    delete: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  };
};

export async function GET(_req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const entry = await prismaAny.tokenLibraryEntry.findUnique({ where: { id } });
  if (!entry) {
    return NextResponse.json({ error: "Token entry not found." }, { status: 404 });
  }
  return NextResponse.json({ entry });
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const existing = await prismaAny.tokenLibraryEntry.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Token entry not found." }, { status: 404 });
  }

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
  const has = (key: string) => Object.prototype.hasOwnProperty.call(typedBody, key);
  const data: Record<string, unknown> = {};

  if (has("label")) {
    const label = typeof typedBody.label === "string" ? typedBody.label.trim() : "";
    if (!label) {
      return NextResponse.json({ error: "label cannot be empty." }, { status: 400 });
    }
    data.label = label;
  }
  if (has("category")) {
    const category =
      typeof typedBody.category === "string" ? typedBody.category.trim() : "";
    if (!category) {
      return NextResponse.json({ error: "category cannot be empty." }, { status: 400 });
    }
    data.category = category;
  }
  if (has("subtype")) {
    data.subtype =
      typeof typedBody.subtype === "string" && typedBody.subtype.trim()
        ? typedBody.subtype.trim()
        : null;
  }
  if (has("approved")) {
    data.approved = Boolean(typedBody.approved);
  }
  if (has("imageDataUrl")) {
    const imageDataUrl =
      typeof typedBody.imageDataUrl === "string" && typedBody.imageDataUrl.startsWith("data:image/")
        ? typedBody.imageDataUrl
        : "";
    if (!imageDataUrl) {
      return NextResponse.json({ error: "imageDataUrl must be a valid data URL." }, { status: 400 });
    }
    data.imageDataUrl = imageDataUrl;
  }
  if (has("sourcePrompt")) {
    data.sourcePrompt = typeof typedBody.sourcePrompt === "string" ? typedBody.sourcePrompt : null;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ entry: existing });
  }

  const entry = await prismaAny.tokenLibraryEntry.update({
    where: { id },
    data,
  });
  return NextResponse.json({ entry });
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const existing = await prismaAny.tokenLibraryEntry.findUnique({ where: { id }, select: { id: true } });
  if (!existing) {
    return NextResponse.json({ error: "Token entry not found." }, { status: 404 });
  }
  await prismaAny.tokenLibraryEntry.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
