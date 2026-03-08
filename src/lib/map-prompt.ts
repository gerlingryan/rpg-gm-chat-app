import { extractPartyBlock } from "@/lib/party";
import { DEFAULT_SCENE_SUMMARY, extractSceneBlock } from "@/lib/scene";

function stripStateBlock(text: string) {
  return text.replace(/STATE:\s*[\s\S]*?\s*ENDSTATE/gi, "").trim();
}

export function stripMapPromptMetadata(text: string) {
  const withoutScene = extractSceneBlock(text).content;
  const withoutParty = extractPartyBlock(withoutScene).content;
  return stripStateBlock(withoutParty).trim();
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
