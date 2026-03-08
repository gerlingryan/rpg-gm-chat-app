import { NextRequest, NextResponse } from "next/server";
import { openai } from "@/lib/openai";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const physicalDescription =
    typeof body.physicalDescription === "string"
      ? body.physicalDescription.trim()
      : "";
  const characterName =
    typeof body.name === "string" ? body.name.trim() : "Character";
  const ruleset =
    typeof body.ruleset === "string" ? body.ruleset.trim() : "";

  if (!ruleset) {
    return NextResponse.json(
      { error: "Ruleset is required." },
      { status: 400 },
    );
  }

  if (!physicalDescription) {
    return NextResponse.json(
      { error: "Physical description is required." },
      { status: 400 },
    );
  }

  const imageResponse = (await openai.images.generate({
    model: "gpt-image-1-mini",
    size: "1024x1024",
    prompt: [
      `Create a character portrait for a ${ruleset} tabletop RPG.`,
      `Character name: ${characterName}.`,
      `Physical description: ${physicalDescription}.`,
      "Show a single character portrait from the chest up.",
      "Detailed, readable facial features, dramatic but neutral background, portrait orientation.",
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

  return NextResponse.json({
    portraitDataUrl: `data:image/png;base64,${b64Json}`,
  });
}
