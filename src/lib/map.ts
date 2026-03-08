import { openai } from "@/lib/openai";
import {
  DEFAULT_SCENE_SUMMARY,
  extractSceneBlock,
  type SceneSummary,
} from "@/lib/scene";
import { buildSceneMapImagePrompt, stripMapPromptMetadata } from "@/lib/map-prompt";

export type SceneMapState = {
  title: string;
  sceneTitle: string;
  place: string;
  summary: string;
  imageDataUrl: string | null;
  generatedAt: string;
};

export type SceneImageHistoryEntry = SceneMapState;

export type WorldMapPin = {
  id: string;
  label: string;
  x: number;
  y: number;
  color: string;
};

const DEFAULT_WORLD_MAP_PIN_COLOR = "#fbbf24";

export type WorldMapState = {
  mode: "generated" | "reference";
  title: string;
  worldDescription: string;
  referenceUrl: string;
  summary: string;
  imageDataUrl: string | null;
  pins: WorldMapPin[];
  generatedAt: string;
};

export type WorldMapHistoryEntry = WorldMapState;

export { stripMapPromptMetadata };

export function normalizeSceneMapState(value: unknown): SceneMapState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const typedValue = value as Record<string, unknown>;
  const title =
    typeof typedValue.title === "string" && typedValue.title.trim()
      ? typedValue.title.trim()
      : "Scene Map";
  const sceneTitle =
    typeof typedValue.sceneTitle === "string" && typedValue.sceneTitle.trim()
      ? typedValue.sceneTitle.trim()
      : title;
  const place =
    typeof typedValue.place === "string" && typedValue.place.trim()
      ? typedValue.place.trim()
      : "Current Area";
  const summary =
    typeof typedValue.summary === "string" && typedValue.summary.trim()
      ? typedValue.summary.trim()
      : "A visual impression of the current scene.";
  const imageDataUrl =
    typeof typedValue.imageDataUrl === "string" &&
    typedValue.imageDataUrl.startsWith("data:image/")
      ? typedValue.imageDataUrl
      : null;
  const generatedAt =
    typeof typedValue.generatedAt === "string" && typedValue.generatedAt.trim()
      ? typedValue.generatedAt.trim()
      : new Date().toISOString();

  return {
    title,
    sceneTitle,
    place,
    summary,
    imageDataUrl,
    generatedAt,
  };
}

export function normalizeSceneImageHistory(
  value: unknown,
): SceneImageHistoryEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => normalizeSceneMapState(entry))
    .filter(
      (entry): entry is SceneImageHistoryEntry =>
        Boolean(entry && entry.imageDataUrl),
    );
}

export function normalizeWorldMapState(value: unknown): WorldMapState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const typedValue = value as Record<string, unknown>;
  const rawMode =
    typeof typedValue.mode === "string" ? typedValue.mode.trim().toLowerCase() : "";
  const mode: WorldMapState["mode"] = rawMode === "reference" ? "reference" : "generated";
  const title =
    typeof typedValue.title === "string" && typedValue.title.trim()
      ? typedValue.title.trim()
      : "World Map";
  const worldDescription =
    typeof typedValue.worldDescription === "string" && typedValue.worldDescription.trim()
      ? typedValue.worldDescription.trim()
      : "";
  const referenceUrl =
    typeof typedValue.referenceUrl === "string" && typedValue.referenceUrl.trim()
      ? typedValue.referenceUrl.trim()
      : "";
  const summary =
    typeof typedValue.summary === "string" && typedValue.summary.trim()
      ? typedValue.summary.trim()
      : "A broad map of the realm.";
  const imageDataUrl =
    typeof typedValue.imageDataUrl === "string" &&
    typedValue.imageDataUrl.startsWith("data:image/")
      ? typedValue.imageDataUrl
      : null;
  const pins = normalizeWorldMapPins(typedValue.pins);
  const generatedAt =
    typeof typedValue.generatedAt === "string" && typedValue.generatedAt.trim()
      ? typedValue.generatedAt.trim()
      : new Date().toISOString();

  return {
    mode,
    title,
    worldDescription,
    referenceUrl,
    summary,
    imageDataUrl,
    pins,
    generatedAt,
  };
}

export function normalizeWorldMapPins(value: unknown): WorldMapPin[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry, index) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return null;
      }

      const typedEntry = entry as Record<string, unknown>;
      const label =
        typeof typedEntry.label === "string" && typedEntry.label.trim()
          ? typedEntry.label.trim().slice(0, 80)
          : "";
      const rawX = typeof typedEntry.x === "number" ? typedEntry.x : NaN;
      const rawY = typeof typedEntry.y === "number" ? typedEntry.y : NaN;
      const x = Number.isFinite(rawX) ? Math.max(0, Math.min(100, rawX)) : NaN;
      const y = Number.isFinite(rawY) ? Math.max(0, Math.min(100, rawY)) : NaN;
      const rawColor =
        typeof typedEntry.color === "string" ? typedEntry.color.trim().toLowerCase() : "";
      const color = /^#[0-9a-f]{6}$/.test(rawColor)
        ? rawColor
        : DEFAULT_WORLD_MAP_PIN_COLOR;

      if (!label || !Number.isFinite(x) || !Number.isFinite(y)) {
        return null;
      }

      return {
        id:
          typeof typedEntry.id === "string" && typedEntry.id.trim()
            ? typedEntry.id.trim()
            : `pin-${index}-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        label,
        x,
        y,
        color,
      };
    })
    .filter((entry): entry is WorldMapPin => Boolean(entry));
}

export function normalizeWorldMapHistory(value: unknown): WorldMapHistoryEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => normalizeWorldMapState(entry))
    .filter(
      (entry): entry is WorldMapHistoryEntry =>
        Boolean(entry && (entry.imageDataUrl || entry.referenceUrl)),
    );
}

export function appendWorldMapHistory(
  currentHistory: unknown,
  nextMap: WorldMapState | null | undefined,
) {
  const normalizedHistory = normalizeWorldMapHistory(currentHistory);

  if (!nextMap || (!nextMap.imageDataUrl && !nextMap.referenceUrl)) {
    return normalizedHistory;
  }

  return [...normalizedHistory, nextMap];
}

export function appendSceneImageHistory(
  currentHistory: unknown,
  nextMap: SceneMapState | null | undefined,
) {
  const normalizedHistory = normalizeSceneImageHistory(currentHistory);

  if (!nextMap?.imageDataUrl) {
    return normalizedHistory;
  }

  return [...normalizedHistory, nextMap];
}

export function buildFallbackSceneMap(
  scene: Partial<SceneSummary> | null | undefined,
  narrative: string,
): SceneMapState {
  const mergedScene = {
    ...DEFAULT_SCENE_SUMMARY,
    ...(scene ?? {}),
  };
  const place = mergedScene.location || "Current Area";
  const title = `${mergedScene.sceneTitle} - ${place}`.trim();
  const trimmedNarrative = narrative.trim();
  const summary = trimmedNarrative
    ? `${trimmedNarrative.slice(0, 180).trim()}${trimmedNarrative.length > 180 ? "..." : ""}`
    : `${mergedScene.goal}. ${mergedScene.mood} atmosphere, ${mergedScene.threat.toLowerCase()}.`;

  return {
    title,
    sceneTitle: mergedScene.sceneTitle,
    place,
    summary,
    imageDataUrl: null,
    generatedAt: new Date().toISOString(),
  };
}

export async function generateSceneMap(params: {
  ruleset: string;
  campaignTitle: string;
  latestGmContent: string;
  scenePrompt?: string;
}) {
  const latestGmContent = params.latestGmContent.trim();
  const extractedScene = extractSceneBlock(latestGmContent);
  const overridePrompt = typeof params.scenePrompt === "string" ? params.scenePrompt.trim() : "";
  const narrative = stripMapPromptMetadata(latestGmContent);
  const fallbackMap = buildFallbackSceneMap(extractedScene.scene, narrative);

  try {
    const scenePrompt =
      overridePrompt ||
      buildSceneMapImagePrompt({
        ruleset: params.ruleset,
        campaignTitle: params.campaignTitle,
        latestGmContent,
      });
    const imageResponse = (await openai.images.generate({
      model: "gpt-image-1-mini",
      size: "1536x1024",
      prompt: scenePrompt,
    })) as unknown as {
      data?: Array<{
        b64_json?: string | null;
      }>;
    };

    const b64Json = imageResponse.data?.[0]?.b64_json;

    if (!b64Json) {
      return fallbackMap;
    }

    return {
      ...fallbackMap,
      imageDataUrl: `data:image/png;base64,${b64Json}`,
      generatedAt: new Date().toISOString(),
    };
  } catch {
    return fallbackMap;
  }
}

export async function generateWorldMap(params: {
  ruleset: string;
  campaignTitle: string;
  worldDescription: string;
  title?: string;
}) {
  const description = params.worldDescription.trim();
  const fallbackMap: WorldMapState = {
    mode: "generated",
    title: params.title?.trim() || `${params.campaignTitle} World Map`.trim() || "World Map",
    worldDescription: description,
    referenceUrl: "",
    summary: description
      ? `${description.slice(0, 180).trim()}${description.length > 180 ? "..." : ""}`
      : "A broad map of the realm.",
    imageDataUrl: null,
    pins: [],
    generatedAt: new Date().toISOString(),
  };

  try {
    const imageResponse = (await openai.images.generate({
      model: "gpt-image-1-mini",
      size: "1536x1024",
      prompt: [
        `Create a high-level world map illustration for a ${params.ruleset} tabletop RPG.`,
        `Campaign title: ${params.campaignTitle}.`,
        `World details: ${description || "Create a varied fantasy world with distinct regions."}`,
        "Show continents, coastlines, major terrain regions, and a clear sense of travel scale.",
        "Use a readable cartographic style suitable for campaign planning.",
        "Do not include labels, text, letters, captions, logos, signatures, or watermarks anywhere in the image.",
      ].join(" "),
    })) as unknown as {
      data?: Array<{
        b64_json?: string | null;
      }>;
    };

    const b64Json = imageResponse.data?.[0]?.b64_json;

    if (!b64Json) {
      return fallbackMap;
    }

    return {
      ...fallbackMap,
      imageDataUrl: `data:image/png;base64,${b64Json}`,
      generatedAt: new Date().toISOString(),
    };
  } catch {
    return fallbackMap;
  }
}
