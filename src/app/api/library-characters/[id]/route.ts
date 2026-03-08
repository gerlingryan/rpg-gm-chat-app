import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  buildGeneratedCharacter,
  sanitizeCharacterAnswersForLimits,
  validateCharacterAnswers,
} from "@/lib/campaigns";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

async function hasLibraryCharacterNameConflict(name: string, excludeId: string) {
  const existingCharacter = await prisma.libraryCharacter.findFirst({
    where: {
      name: {
        equals: name,
        mode: "insensitive",
      },
      id: {
        not: excludeId,
      },
    },
    select: {
      id: true,
    },
  });

  return Boolean(existingCharacter);
}

export async function GET(_req: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  const character = await prisma.libraryCharacter.findUnique({
    where: { id },
  });

  if (!character) {
    return NextResponse.json(
      { error: "Library character not found." },
      { status: 404 },
    );
  }

  return NextResponse.json({
    character,
  });
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const body = await req.json();
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const answers =
    body.answers && typeof body.answers === "object" && !Array.isArray(body.answers)
      ? (body.answers as Record<string, string | number | null | undefined>)
      : {};
  const sanitizedAnswers = sanitizeCharacterAnswersForLimits(answers);

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const existingCharacter = await prisma.libraryCharacter.findUnique({
    where: { id },
  });

  if (!existingCharacter) {
    return NextResponse.json(
      { error: "Library character not found." },
      { status: 404 },
    );
  }

  if (await hasLibraryCharacterNameConflict(name, id)) {
    return NextResponse.json(
      { error: "A reusable character with that name already exists." },
      { status: 400 },
    );
  }

  const validationError = validateCharacterAnswers(
    existingCharacter.ruleset,
    sanitizedAnswers,
  );

  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const updatedCharacterSheet = buildGeneratedCharacter(
    existingCharacter.ruleset,
    name,
    sanitizedAnswers,
  );

  const character = await prisma.libraryCharacter.update({
    where: { id },
    data: {
      name: updatedCharacterSheet.name,
      role: "player",
      sheetJson: updatedCharacterSheet.sheetJson,
      memorySummary: updatedCharacterSheet.memorySummary,
    },
  });

  return NextResponse.json({
    character,
  });
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  const existingCharacter = await prisma.libraryCharacter.findUnique({
    where: { id },
    select: {
      id: true,
    },
  });

  if (!existingCharacter) {
    return NextResponse.json(
      { error: "Library character not found." },
      { status: 404 },
    );
  }

  await prisma.$transaction([
    prisma.character.updateMany({
      where: {
        originLibraryCharacterId: id,
      },
      data: {
        originLibraryCharacterId: null,
      },
    }),
    prisma.libraryCharacter.delete({
      where: { id },
    }),
  ]);

  return NextResponse.json({ success: true });
}
