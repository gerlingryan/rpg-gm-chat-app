import { NextRequest, NextResponse } from "next/server";
import { openai } from "@/lib/openai";
import { buildTokenPrompt } from "@/lib/token-library";

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
  const stylePresetRaw =
    typeof body.stylePreset === "string" ? body.stylePreset.trim().toLowerCase() : "";
  const stylePreset =
    stylePresetRaw === "stone-base" ||
    stylePresetRaw === "no-scenic-base" ||
    stylePresetRaw === "grass-base" ||
    stylePresetRaw === "dirt-base"
      ? stylePresetRaw
      : "stone-base";

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

  const tokenPrompt = buildTokenPrompt({
    ruleset,
    label: characterName,
    customDescription: `Character name: ${characterName}. Physical description: ${physicalDescription}.`,
    style: stylePreset,
  });

  const generateToken = async (withTransparentBackground: boolean) => {
    const imageResponse = (await openai.images.generate({
      model: "gpt-image-1-mini",
      size: "1024x1024",
      prompt: tokenPrompt,
      ...(withTransparentBackground ? { transparent_background: true } : {}),
    } as never)) as unknown as {
      data?: Array<{
        b64_json?: string | null;
      }>;
    };

    return imageResponse.data?.[0]?.b64_json ?? null;
  };

  let b64Json: string | null = null;
  try {
    try {
      b64Json = await generateToken(true);
    } catch {
      b64Json = await generateToken(false);
    }
    if (!b64Json) {
      b64Json = await generateToken(false);
    }
  } catch {
    return NextResponse.json(
      { error: "Unable to generate token image." },
      { status: 502 },
    );
  }

  if (!b64Json) {
    return NextResponse.json(
      { error: "Unable to generate token image." },
      { status: 502 },
    );
  }

  return NextResponse.json({
    tokenDataUrl: `data:image/png;base64,${b64Json}`,
    stylePreset,
    tokenPrompt,
  });
}
