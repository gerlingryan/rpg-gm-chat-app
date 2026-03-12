import { extractPartyBlock } from "@/lib/party";
import { DEFAULT_SCENE_SUMMARY, extractSceneBlock } from "@/lib/scene";
import { extractCombatBlock } from "@/lib/combat";

function stripStateBlock(text: string) {
  return text.replace(/STATE:\s*[\s\S]*?\s*ENDSTATE/gi, "").trim();
}

export function stripMapPromptMetadata(text: string) {
  const withoutScene = extractSceneBlock(text).content;
  const withoutParty = extractPartyBlock(withoutScene).content;
  return stripStateBlock(withoutParty).trim();
}

function stripNumberedOptionsFromText(value: string) {
  return value
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return true;
      }
      if (/^\d+\.\s+/.test(trimmed)) {
        return false;
      }
      if (/^\*\*?\s*\d+\.\s+/.test(trimmed)) {
        return false;
      }
      if (/^numbered options\s*:?$/i.test(trimmed.replace(/\*+/g, ""))) {
        return false;
      }
      return true;
    })
    .join("\n");
}

export function getSceneImageInstructionTemplate(
  promptType: "scene" | "portrait" | "character" | "action" | "character-token",
  gameEngine: string,
) {
  const engine = gameEngine.trim() || "tabletop RPG";
  if (promptType === "portrait") {
    return `Create a character portrait for a ${engine} campaign, focused on face, expression, and signature visual identity.`;
  }
  if (promptType === "character") {
    return `Create a full-body, head-to-toe image of a single character for a ${engine} campaign in a neutral standing pose.`;
  }
  if (promptType === "action") {
    return `Create a dynamic action illustration for a ${engine} campaign that captures one clear cinematic moment.`;
  }
  if (promptType === "character-token") {
    return "TRUE TOP-DOWN TOKEN. Camera is mounted directly above the miniature (90° overhead), looking straight down. Orthographic / no perspective. No tilt. No horizon.\nThe round base must be a perfect circle (not an ellipse). Square image. Centered.\nThis is a VTT token / flat-lay overhead shot: the miniature should appear foreshortened from above; as seen from directly above (do NOT try to show the face like a portrait).\nOnly one character on one round 32mm base with a clean black rim. Background transparent or flat neutral gray. Top-lit studio lighting ";
  }
  return `Create a top-down narrative scene map for a ${engine} campaign, with clear terrain, landmarks, and encounter readability.`;
}

export function getSceneImageStyleTemplate(
  stylePreset:
    | "cinematic-realism"
    | "fantasy-illustration"
    | "stone-base"
    | "comic-book"
    | "manga"
    | "stylized-3d"
    | "noir"
    | "pulp-poster"
    | "parchment-map"
    | "tactical-map",
) {
  if (stylePreset === "stone-base") {
    return "Style: highly detailed painted 3D tabletop miniature (hand-painted mini look), crisp edges, clean shading. Base top surface: weathered stone cobblestones/flagstones, cracked paving stones, drybrushed highlights, scattered grit, a few yellow-green grass tufts.\n\nNegative: isometric, 3/4 view, angled camera, perspective, tilt, low angle, front view, portrait view, eye-level, horizon, dramatic cinematic angle, face-forward, product photo angle, cropped, cut off base, missing base, blurry, lowres, extra limbs, extra fingers, duplicate body, multiple characters, text, watermark, logo ";
  }
  if (stylePreset === "cinematic-realism") {
    return "Cinematic realism, dramatic lighting, natural textures, atmospheric depth, high-detail materials, filmic color grading, sharp focal subject.";
  }
  if (stylePreset === "comic-book") {
    return "Comic book style, bold inks, strong outlines, dynamic framing, halftone texture hints, saturated colors, energetic motion language.";
  }
  if (stylePreset === "manga") {
    return "Manga style, clean linework, expressive faces, speed-line energy where appropriate, high contrast shading, stylized anatomy, readable silhouettes.";
  }
  if (stylePreset === "stylized-3d") {
    return "Stylized 3D render look, clean forms, sculpted shapes, controlled highlights, soft global illumination, modern game-art finish.";
  }
  if (stylePreset === "noir") {
    return "Noir style, high-contrast chiaroscuro, moody shadows, desaturated palette with selective highlights, tense atmosphere, dramatic composition.";
  }
  if (stylePreset === "pulp-poster") {
    return "Pulp poster aesthetic, bold typography space (without text), vintage print vibe, dynamic heroic poses, strong color blocks, retro adventure tone.";
  }
  if (stylePreset === "parchment-map") {
    return "Aged parchment map style, hand-drawn ink lines, cartographic ornament motifs, weathered paper texture, muted earth tones, antique fantasy atlas look.";
  }
  if (stylePreset === "tactical-map") {
    return "Clear tactical map presentation, top-down readability, distinct terrain zones, obstacle clarity, movement-friendly layout, low visual noise.";
  }
  return "Fantasy illustration style, painterly brushwork, rich atmospheric lighting, magical ambience, detailed environment storytelling, cohesive color palette.";
}

export function buildSceneImageCustomDescriptionFromGmContent(latestGmContent: string) {
  const extractedScene = extractSceneBlock(latestGmContent.trim());
  const scene = extractedScene.scene ?? DEFAULT_SCENE_SUMMARY;
  const rawNarrative = extractCombatBlock(extractPartyBlock(extractedScene.content).content).content;
  const narrative = stripNumberedOptionsFromText(rawNarrative)
    .replace(/^\s*\*{2,}\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const sceneDetails = [
    scene.sceneTitle.trim() ? `Scene: ${scene.sceneTitle.trim()}` : "",
    scene.location.trim() ? `Location: ${scene.location.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return [sceneDetails, narrative].filter(Boolean).join("\n\n").trim();
}

export function buildSceneImagePromptFromSections(params: {
  instructions: string;
  customDescription: string;
  styleDescription: string;
}) {
  return [params.instructions.trim(), params.customDescription.trim(), params.styleDescription.trim()]
    .filter(Boolean)
    .join(" ");
}

export function buildDefaultStartSceneImagePrompt(params: {
  ruleset: string;
  latestGmContent: string;
}) {
  return buildSceneImagePromptFromSections({
    instructions: getSceneImageInstructionTemplate("scene", params.ruleset),
    customDescription: buildSceneImageCustomDescriptionFromGmContent(params.latestGmContent),
    styleDescription: getSceneImageStyleTemplate("fantasy-illustration"),
  });
}

export function buildSceneMapImagePrompt(params: {
  ruleset: string;
  campaignTitle: string;
  latestGmContent: string;
  narrativeOverride?: string;
}) {
  const latestGmContent = params.latestGmContent.trim();
  const extractedScene = extractSceneBlock(latestGmContent);
  const scene = extractedScene.scene ?? DEFAULT_SCENE_SUMMARY;
  const override = typeof params.narrativeOverride === "string" ? params.narrativeOverride.trim() : "";
  const narrative = override || stripMapPromptMetadata(latestGmContent);

  return [
    `Create a top-down narrative scene map illustration for a ${params.ruleset} tabletop RPG.`,
    `Campaign title: ${params.campaignTitle}.`,
    `Scene title: ${scene.sceneTitle}.`,
    `Place: ${scene.location}.`,
    `Mood: ${scene.mood}.`,
    `Threat: ${scene.threat}.`,
    `Goal: ${scene.goal}.`,
    `Context: ${scene.context}.`,
    `Narrative details: ${narrative || "Use the current scene information to imply the layout."}`,
    "This image supports narrative understanding and is not a tactical combat grid.",
    "Show a readable overhead or isometric scene layout with key environmental areas, pathways, entrances, and major features implied visually.",
    "Do not include labels, text, letters, captions, symbols, logos, signatures, or watermarks anywhere in the image.",
  ].join(" ");
}
