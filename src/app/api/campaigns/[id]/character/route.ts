import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  buildGeneratedCharacter,
  sanitizeCharacterAnswersForLimits,
  validateCharacterAnswers,
  withDerivedBehaviorSummary,
} from "@/lib/campaigns";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const body = await req.json();
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const slot = body.slot === "companion" ? "companion" : "main";
  const libraryCharacterId =
    typeof body.libraryCharacterId === "string"
      ? body.libraryCharacterId.trim()
      : "";
  const answers =
    body.answers && typeof body.answers === "object" && !Array.isArray(body.answers)
      ? (body.answers as Record<string, string | number | null | undefined>)
      : {};
  const sanitizedAnswers = sanitizeCharacterAnswersForLimits(answers);

  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: {
      characters: true,
    },
  });

  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  if (libraryCharacterId) {
    const libraryCharacter = await prisma.libraryCharacter.findUnique({
      where: { id: libraryCharacterId },
    });

    if (!libraryCharacter) {
      return NextResponse.json(
        { error: "Selected library character was not found." },
        { status: 404 },
      );
    }

    if (libraryCharacter.ruleset.trim().toLowerCase() !== campaign.ruleset.trim().toLowerCase()) {
      return NextResponse.json(
        { error: "Selected library character does not match the campaign ruleset." },
        { status: 400 },
      );
    }

    const copiedSheet =
      libraryCharacter.sheetJson &&
      typeof libraryCharacter.sheetJson === "object" &&
      !Array.isArray(libraryCharacter.sheetJson)
        ? JSON.parse(JSON.stringify(libraryCharacter.sheetJson)) as Record<string, unknown>
        : {};

    const existingMainCharacter = campaign.characters.find(
      (character) => character.isMainCharacter,
    );

    const character =
      slot === "main" && existingMainCharacter
        ? await prisma.character.update({
            where: { id: existingMainCharacter.id },
            data: {
              name: libraryCharacter.name,
              role: "player",
              isMainCharacter: true,
              originLibraryCharacterId: libraryCharacter.id,
              sheetJson: withDerivedBehaviorSummary(
                {
                  ...copiedSheet,
                  source: "user-generated",
                },
                libraryCharacter.name,
                libraryCharacter.memorySummary,
              ),
              memorySummary:
                libraryCharacter.memorySummary ??
                "Imported from the shared character library.",
            },
          })
        : await prisma.character.create({
            data: {
              campaignId: campaign.id,
              name: libraryCharacter.name,
              role: slot === "companion" ? "companion" : "player",
              isMainCharacter: slot === "main",
              originLibraryCharacterId: libraryCharacter.id,
              sheetJson: withDerivedBehaviorSummary(
                {
                  ...copiedSheet,
                  source: "user-generated",
                },
                libraryCharacter.name,
                libraryCharacter.memorySummary,
              ),
              memorySummary:
                libraryCharacter.memorySummary ??
                "Imported from the shared character library.",
            },
          });

    return NextResponse.json({
      character,
    });
  }

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const validationError = validateCharacterAnswers(
    campaign.ruleset,
    sanitizedAnswers,
  );

  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const generatedCharacter = buildGeneratedCharacter(
    campaign.ruleset,
    name,
    sanitizedAnswers,
  );
  const existingMainCharacter = campaign.characters.find(
    (character) => character.isMainCharacter,
  );

  const character =
    slot === "main" && existingMainCharacter
      ? await prisma.character.update({
          where: { id: existingMainCharacter.id },
          data: {
            name: generatedCharacter.name,
            role: "player",
            isMainCharacter: true,
            sheetJson: generatedCharacter.sheetJson,
            memorySummary: generatedCharacter.memorySummary,
          },
        })
      : await prisma.character.create({
        data: {
          campaignId: campaign.id,
          name: generatedCharacter.name,
          role: slot === "companion" ? "companion" : "player",
          isMainCharacter: slot === "main",
          sheetJson: generatedCharacter.sheetJson,
          memorySummary: generatedCharacter.memorySummary,
        },
      });

  return NextResponse.json({
    character,
  });
}
