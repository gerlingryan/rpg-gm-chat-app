import { NextRequest, NextResponse } from "next/server";
import { openai } from "@/lib/openai";

const STYLE_GUIDANCE_BY_ID: Record<string, string> = {
  "tactical-realism":
    "Visual style: tactical realism. Grounded materials, realistic light, natural textures, and practical environment detail.",
  "fantasy-painterly":
    "Visual style: fantasy painterly concept art. Rich brushwork, controlled palette, artistic but readable overhead shapes.",
  "gritty-cinematic":
    "Visual style: gritty cinematic realism. Weathered surfaces, dramatic contrast, moody atmosphere, clear tactical readability.",
  "inked-illustration":
    "Visual style: inked illustration. Clean contour lines, painted fills, stylized but clear overhead terrain definition.",
  "old-school-rpg":
    "Visual style: classic old-school CRPG battle map look with clear lanes and bold obstacle readability.",
  "muted-naturalistic":
    "Visual style: muted naturalistic. Lower saturation, believable terrain tones, and subtle but readable detail.",
  "3d-realism":
    "Visual style: Top-down tabletop RPG battlemap, camera high overhead (85-90 deg), minimal perspective, designed for VTT readability. Style: looks like a 3D model / game-engine render (Unreal Engine 5 / Unity HDRP), high-poly environment, PBR materials, realistic ambient occlusion, soft contact shadows, global illumination, crisp texture detail, realistic scale and proportions. Include subtle height/depth cues (rocks, roots, steps, walls, props) but keep it clearly top-down and navigable. Composition: clear walkable areas, readable obstacles, natural-looking edge framing. No characters, no creatures, no vehicles (unless specified). Output: square image, seamless edges if possible, no labels, no text, no watermark. GRID: none. Avoid: isometric view, 3/4 angle, low angle, horizon, dramatic cinematic framing, portrait composition, extreme perspective distortion, fisheye, blurry, lowres, UI elements, labels, numbers, compass rose, watermark, logo.",
};

function pickImageSize(cols: number, rows: number) {
  const safeCols = Number.isFinite(cols) ? Math.max(1, Math.floor(cols)) : 20;
  const safeRows = Number.isFinite(rows) ? Math.max(1, Math.floor(rows)) : 20;
  const ratio = safeCols / safeRows;
  if (ratio > 1.2) {
    return "1536x1024";
  }
  if (ratio < 0.83) {
    return "1024x1536";
  }
  return "1024x1024";
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const typedBody =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};

  const prompt =
    typeof typedBody.prompt === "string" ? typedBody.prompt.trim() : "";
  const styleId =
    typeof typedBody.styleId === "string"
      ? typedBody.styleId.trim().toLowerCase()
      : "";
  const ruleset =
    typeof typedBody.ruleset === "string" ? typedBody.ruleset.trim() : "";
  const cols =
    typeof typedBody.gridCols === "number"
      ? typedBody.gridCols
      : Number.parseInt(String(typedBody.gridCols ?? ""), 10);
  const rows =
    typeof typedBody.gridRows === "number"
      ? typedBody.gridRows
      : Number.parseInt(String(typedBody.gridRows ?? ""), 10);

  if (!prompt) {
    return NextResponse.json(
      { error: "Prompt is required." },
      { status: 400 },
    );
  }

  const styleGuidance =
    STYLE_GUIDANCE_BY_ID[styleId] ?? STYLE_GUIDANCE_BY_ID["tactical-realism"];

  const finalPrompt = [
    `Create a top-down tactical battle map background for ${ruleset || "a tabletop RPG"}.`,
    styleGuidance,
    prompt,
    "This is the background only. Do not draw grid lines.",
    "Do not include creatures, miniatures, characters, token bases, labels, text, symbols, logos, or watermarks.",
    "Keep terrain and obstacles readable for tactical play from overhead view.",
  ].join(" ");

  try {
    const imageResponse = (await openai.images.generate({
      model: "gpt-image-1-mini",
      size: pickImageSize(cols, rows),
      prompt: finalPrompt,
    } as never)) as unknown as {
      data?: Array<{
        b64_json?: string | null;
      }>;
    };

    const b64Json = imageResponse.data?.[0]?.b64_json;
    if (!b64Json) {
      return NextResponse.json(
        { error: "Unable to generate map background image." },
        { status: 502 },
      );
    }

    return NextResponse.json({
      imageDataUrl: `data:image/png;base64,${b64Json}`,
      size: pickImageSize(cols, rows),
      promptUsed: finalPrompt,
      styleApplied: styleId || "tactical-realism",
    });
  } catch {
    return NextResponse.json(
      { error: "Unable to generate map background image." },
      { status: 502 },
    );
  }
}

