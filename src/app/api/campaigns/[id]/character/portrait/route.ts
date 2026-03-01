import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { openai } from "@/lib/openai";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const body = await req.json();
  const physicalDescription =
    typeof body.physicalDescription === "string"
      ? body.physicalDescription.trim()
      : "";
  const characterName =
    typeof body.name === "string" ? body.name.trim() : "Character";

  if (!physicalDescription) {
    return NextResponse.json(
      { error: "Physical description is required." },
      { status: 400 },
    );
  }

  const campaign = await prisma.campaign.findUnique({
    where: { id },
  });

  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const imageResponse = (await openai.images.generate({
    model: "gpt-image-1",
    size: "1024x1024",
    prompt: [
      `Create a character portrait for a ${campaign.ruleset} tabletop RPG.`,
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
