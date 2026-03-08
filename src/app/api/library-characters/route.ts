import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  buildGeneratedCharacter,
  sanitizeCharacterAnswersForLimits,
  validateCharacterAnswers,
} from "@/lib/campaigns";

function normalizeRuleset(value: string) {
  return value.trim().toLowerCase();
}

async function hasLibraryCharacterNameConflict(name: string) {
  const existingCharacter = await prisma.libraryCharacter.findFirst({
    where: {
      name: {
        equals: name,
        mode: "insensitive",
      },
    },
    select: {
      id: true,
    },
  });

  return Boolean(existingCharacter);
}

export async function GET(req: NextRequest) {
  const ruleset = req.nextUrl.searchParams.get("ruleset")?.trim() ?? "";

  const libraryCharacters = await prisma.libraryCharacter.findMany({
    where: ruleset
      ? {
          ruleset: {
            equals: normalizeRuleset(ruleset),
            mode: "insensitive",
          },
        }
      : undefined,
    orderBy: [
      { updatedAt: "desc" },
      { name: "asc" },
    ],
  });

  return NextResponse.json({
    characters: libraryCharacters,
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const ruleset = typeof body.ruleset === "string" ? body.ruleset.trim() : "";
  const answers =
    body.answers && typeof body.answers === "object" && !Array.isArray(body.answers)
      ? (body.answers as Record<string, string | number | null | undefined>)
      : {};
  const sanitizedAnswers = sanitizeCharacterAnswersForLimits(answers);

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  if (!ruleset) {
    return NextResponse.json({ error: "ruleset is required" }, { status: 400 });
  }

  if (await hasLibraryCharacterNameConflict(name)) {
    return NextResponse.json(
      { error: "A reusable character with that name already exists." },
      { status: 400 },
    );
  }

  const validationError = validateCharacterAnswers(ruleset, sanitizedAnswers);

  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const generatedCharacter = buildGeneratedCharacter(ruleset, name, sanitizedAnswers);

  const libraryCharacter = await prisma.libraryCharacter.create({
    data: {
      name: generatedCharacter.name,
      ruleset,
      role: "player",
      sheetJson: generatedCharacter.sheetJson,
      memorySummary: generatedCharacter.memorySummary,
    },
  });

  return NextResponse.json({
    character: libraryCharacter,
  });
}
