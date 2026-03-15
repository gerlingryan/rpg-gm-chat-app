import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeBattleMapTemplatePatchInput } from "@/lib/battle-map-validation";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

const prismaAny = prisma as unknown as {
  battleMapTemplate: {
    findUnique: (args: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
    update: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
    delete: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  };
};

export async function GET(_req: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  const template = await prismaAny.battleMapTemplate.findUnique({
    where: { id },
  });

  if (!template) {
    return NextResponse.json({ error: "Battle map template not found." }, { status: 404 });
  }

  return NextResponse.json({ template });
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  const existing = await prismaAny.battleMapTemplate.findUnique({
    where: { id },
  });
  if (!existing) {
    return NextResponse.json({ error: "Battle map template not found." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const normalized = normalizeBattleMapTemplatePatchInput(body, {
    gridCols:
      typeof existing.gridCols === "number" && Number.isFinite(existing.gridCols)
        ? existing.gridCols
        : 20,
    gridRows:
      typeof existing.gridRows === "number" && Number.isFinite(existing.gridRows)
        ? existing.gridRows
        : 20,
  });
  if (!normalized.ok) {
    return NextResponse.json({ error: normalized.error }, { status: 400 });
  }

  if (Object.keys(normalized.value).length === 0) {
    return NextResponse.json({ template: existing });
  }

  let updated: Record<string, unknown>;
  try {
    updated = await prismaAny.battleMapTemplate.update({
      where: { id },
      data: normalized.value,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const isSpawnFieldSchemaMismatch =
      message.includes("Unknown argument `playerSpawnTilesJson`") ||
      message.includes("Unknown argument `enemySpawnTilesJson`");
    if (isSpawnFieldSchemaMismatch) {
      return NextResponse.json(
        {
          error:
            "Battle map spawn columns are not in the database yet. Run the latest Prisma migration, then retry.",
          hint:
            "pnpm prisma migrate dev",
        },
        { status: 400 },
      );
    }
    throw error;
  }

  return NextResponse.json({ template: updated });
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  const existing = await prismaAny.battleMapTemplate.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Battle map template not found." }, { status: 404 });
  }

  await prismaAny.battleMapTemplate.delete({
    where: { id },
  });

  return NextResponse.json({ success: true });
}
