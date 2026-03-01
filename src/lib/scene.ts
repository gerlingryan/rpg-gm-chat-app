export type SceneSummary = {
  sceneTitle: string;
  location: string;
  mood: string;
  threat: string;
  goal: string;
  clock: string;
  context: string;
};

export const DEFAULT_SCENE_SUMMARY: SceneSummary = {
  sceneTitle: "Current Scene",
  location: "Current Area",
  mood: "Tense",
  threat: "Low Threat",
  goal: "Decide the next move",
  clock: "No visible timer",
  context: "Active scene",
};

const SCENE_KEYS: Array<keyof SceneSummary> = [
  "sceneTitle",
  "location",
  "mood",
  "threat",
  "goal",
  "clock",
  "context",
];

const SCENE_LABELS: Record<keyof SceneSummary, string> = {
  sceneTitle: "Title",
  location: "Place",
  mood: "Mood",
  threat: "Threat",
  goal: "Goal",
  clock: "Clock",
  context: "Context",
};

export function formatSceneBlock(scene: Partial<SceneSummary>) {
  const mergedScene = {
    ...DEFAULT_SCENE_SUMMARY,
    ...scene,
  };

  const lines = SCENE_KEYS.map(
    (key) => `${SCENE_LABELS[key]}: ${String(mergedScene[key]).trim() || DEFAULT_SCENE_SUMMARY[key]}`,
  );

  return ["SCENE:", ...lines, "ENDSCENE"].join("\n");
}

export function extractSceneBlock(text: string) {
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const startIndex = lines.findIndex(
    (line) => line.trim().toUpperCase() === "SCENE:",
  );
  const endIndex =
    startIndex >= 0
      ? lines.findIndex(
          (line, index) =>
            index > startIndex && line.trim().toUpperCase() === "ENDSCENE",
        )
      : -1;

  if (startIndex < 0 || endIndex < 0) {
    return {
      scene: null as SceneSummary | null,
      content: normalized.trim(),
    };
  }

  const sceneLines = lines.slice(startIndex + 1, endIndex);
  const scene: Partial<SceneSummary> = {};

  for (const line of sceneLines) {
    const parsedLine = line.match(/^([^:]+):\s*(.*)$/);

    if (!parsedLine) {
      continue;
    }

    const label = parsedLine[1].trim().toLowerCase();
    const value = parsedLine[2].trim();

    if (label === "title") {
      scene.sceneTitle = value || DEFAULT_SCENE_SUMMARY.sceneTitle;
    } else if (label === "place") {
      scene.location = value || DEFAULT_SCENE_SUMMARY.location;
    } else if (label === "mood") {
      scene.mood = value || DEFAULT_SCENE_SUMMARY.mood;
    } else if (label === "threat") {
      scene.threat = value || DEFAULT_SCENE_SUMMARY.threat;
    } else if (label === "goal") {
      scene.goal = value || DEFAULT_SCENE_SUMMARY.goal;
    } else if (label === "clock") {
      scene.clock = value || DEFAULT_SCENE_SUMMARY.clock;
    } else if (label === "context") {
      scene.context = value || DEFAULT_SCENE_SUMMARY.context;
    }
  }

  return {
    scene: {
      ...DEFAULT_SCENE_SUMMARY,
      ...scene,
    },
    content: [...lines.slice(0, startIndex), ...lines.slice(endIndex + 1)]
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  };
}

export function stripSceneBlock(text: string) {
  return extractSceneBlock(text).content;
}
