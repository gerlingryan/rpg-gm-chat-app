import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getAllowedBattleGridPresets,
  normalizeBattleMapListFilters,
  normalizeBattleMapTemplateCreateInput,
} from "@/lib/battle-map-validation";

const prismaAny = prisma as unknown as {
  battleMapTemplate: {
    findMany: (args: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;
    create: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  };
};

export async function GET(req: NextRequest) {
  const { ruleset, locationKey, limit } = normalizeBattleMapListFilters(req.nextUrl.searchParams);

  const where: Record<string, unknown> = {};
  if (ruleset) {
    where.ruleset = { equals: ruleset, mode: "insensitive" };
  }
  if (locationKey) {
    where.locationKey = { equals: locationKey, mode: "insensitive" };
  }

  const templates = await prismaAny.battleMapTemplate.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    take: limit,
  });

  return NextResponse.json({
    templates,
    gridPresets: getAllowedBattleGridPresets(),
  });
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const normalized = normalizeBattleMapTemplateCreateInput(body);
  if (!normalized.ok) {
    return NextResponse.json({ error: normalized.error }, { status: 400 });
  }

  let created: Record<string, unknown>;
  try {
    created = await prismaAny.battleMapTemplate.create({
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

  return NextResponse.json({ template: created }, { status: 201 });
}
