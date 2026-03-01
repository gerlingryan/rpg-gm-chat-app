import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  buildGeneratedCharacter,
  validateCharacterAnswers,
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
  const answers =
    body.answers && typeof body.answers === "object" && !Array.isArray(body.answers)
      ? (body.answers as Record<string, string | number | null | undefined>)
      : {};

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: {
      characters: true,
    },
  });

  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const validationError = validateCharacterAnswers(campaign.ruleset, answers);

  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const generatedCharacter = buildGeneratedCharacter(campaign.ruleset, name, answers);
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
