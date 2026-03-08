import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { openai } from "@/lib/openai";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function mergeSheetJson(
  sheetJson: unknown,
  patch: Record<string, unknown>,
) {
  const currentSheet =
    sheetJson && typeof sheetJson === "object" && !Array.isArray(sheetJson)
      ? (sheetJson as Record<string, unknown>)
      : {};

  return {
    ...currentSheet,
    ...patch,
  };
}

export async function POST(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const body = await req.json();
  const explicitDescription =
    typeof body.physicalDescription === "string"
      ? body.physicalDescription.trim()
      : "";
  const uploadedPortraitDataUrl =
    typeof body.portraitDataUrl === "string" &&
    body.portraitDataUrl.startsWith("data:image/")
      ? body.portraitDataUrl
      : "";

  const character = await prisma.character.findUnique({
    where: { id },
    include: {
      campaign: true,
    },
  });

  if (!character) {
    return NextResponse.json({ error: "Character not found" }, { status: 404 });
  }

  const currentSheet =
    character.sheetJson && typeof character.sheetJson === "object" && !Array.isArray(character.sheetJson)
      ? (character.sheetJson as Record<string, unknown>)
      : {};
  const storedDescription =
    typeof currentSheet.physicalDescription === "string"
      ? currentSheet.physicalDescription.trim()
      : "";
  const physicalDescription = explicitDescription || storedDescription;

  if (uploadedPortraitDataUrl) {
    const updatedCharacter = await prisma.character.update({
      where: { id: character.id },
      data: {
        sheetJson: mergeSheetJson(character.sheetJson, {
          physicalDescription: physicalDescription || "Not specified.",
          portraitDataUrl: uploadedPortraitDataUrl,
        }),
      },
    });

    return NextResponse.json({
      character: updatedCharacter,
    });
  }

  if (!physicalDescription || physicalDescription === "Not specified.") {
    return NextResponse.json(
      { error: "A physical description is required before generating a portrait." },
      { status: 400 },
    );
  }

  const imageResponse = (await openai.images.generate({
    model: "gpt-image-1-mini",
    size: "1024x1024",
    prompt: [
      `Create a character portrait for a ${character.campaign.ruleset} tabletop RPG.`,
      `Character name: ${character.name}.`,
      `Physical description: ${physicalDescription}.`,
      "Show a single character portrait from the chest up.",
      "Detailed, readable facial features, fantasy portrait style, neutral background.",
      "Do not include any text, letters, captions, labels, symbols, logos, signatures, or watermarks anywhere in the image.",
    ].join(" "),
  })) as unknown as {
    data?: Array<{
      b64_json?: string | null;
    }>;
  };

  const b64Json = imageResponse.data?.[0]?.b64_json;

  if (!b64Json) {
    return NextResponse.json(
      { error: "Unable to generate portrait image." },
      { status: 502 },
    );
  }

  const updatedCharacter = await prisma.character.update({
    where: { id: character.id },
    data: {
      sheetJson: mergeSheetJson(character.sheetJson, {
        physicalDescription,
        portraitDataUrl: `data:image/png;base64,${b64Json}`,
      }),
    },
  });

  return NextResponse.json({
    character: updatedCharacter,
  });
}
