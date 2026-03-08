import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withDerivedBehaviorSummary } from "@/lib/campaigns";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function PATCH(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const body = await req.json();
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const memorySummary =
    typeof body.memorySummary === "string"
      ? body.memorySummary
      : body.memorySummary === null
        ? null
        : undefined;
  const sheetJson =
    body.sheetJson && typeof body.sheetJson === "object" && !Array.isArray(body.sheetJson)
      ? (body.sheetJson as Record<string, unknown>)
      : null;

  const existingCharacter = await prisma.character.findUnique({
    where: { id },
  });

  if (!existingCharacter) {
    return NextResponse.json({ error: "Character not found" }, { status: 404 });
  }

  if (!name) {
    return NextResponse.json({ error: "Character name is required" }, { status: 400 });
  }

  if (!sheetJson) {
    return NextResponse.json({ error: "A valid character sheet is required" }, { status: 400 });
  }

  const updatedCharacter = await prisma.character.update({
    where: { id },
    data: {
      name,
      sheetJson: withDerivedBehaviorSummary(sheetJson, name, existingCharacter.memorySummary),
      ...(memorySummary !== undefined ? { memorySummary } : {}),
    },
  });

  return NextResponse.json({
    character: updatedCharacter,
  });
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  const character = await prisma.character.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!character) {
    return NextResponse.json({ error: "Character not found" }, { status: 404 });
  }

  await prisma.character.delete({
    where: { id },
  });

  return NextResponse.json({ success: true });
}
