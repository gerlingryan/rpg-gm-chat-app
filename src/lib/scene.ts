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

function normalizeSceneLabel(label: string) {
  return label
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveSceneKey(label: string): keyof SceneSummary | null {
  const normalizedLabel = normalizeSceneLabel(label);

  if (!normalizedLabel) {
    return null;
  }

  if (["title", "scene", "scene title"].includes(normalizedLabel)) {
    return "sceneTitle";
  }

  if (["place", "location", "setting", "area"].includes(normalizedLabel)) {
    return "location";
  }

  if (["mood", "tone", "atmosphere"].includes(normalizedLabel)) {
    return "mood";
  }

  if (["threat", "danger", "risk", "pressure"].includes(normalizedLabel)) {
    return "threat";
  }

  if (["goal", "objective", "intent"].includes(normalizedLabel)) {
    return "goal";
  }

  if (["clock", "timer", "urgency", "deadline"].includes(normalizedLabel)) {
    return "clock";
  }

  if (["context", "npcs", "tags"].includes(normalizedLabel)) {
    return "context";
  }

  return null;
}

function sanitizeSceneFieldValue(value: string) {
  return value
    .trim()
    .replace(/^[*_`>\-\s]+/, "")
    .replace(/[*_`]+$/, "")
    .trim();
}

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
  const inlineMatch = normalized.match(/SCENE:\s*([\s\S]*?)\s*ENDSCENE/i);
  const sceneBlockText = inlineMatch ? inlineMatch[1].trim() : "";
  const sceneContentLines = sceneBlockText
    ? sceneBlockText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
    : [];
  const parsedScene: Partial<SceneSummary> = {};

  for (const line of sceneContentLines) {
    const parsedLine = line.match(/^([^:]+):\s*(.*)$/);

    if (!parsedLine) {
      continue;
    }

    const label = parsedLine[1].trim();
    const value = sanitizeSceneFieldValue(parsedLine[2]);
    const sceneKey = resolveSceneKey(label);

    if (!sceneKey) {
      continue;
    }

    parsedScene[sceneKey] = value || DEFAULT_SCENE_SUMMARY[sceneKey];
  }

  if (inlineMatch) {
    return {
      scene: {
        ...DEFAULT_SCENE_SUMMARY,
        ...parsedScene,
      },
      content: normalized
        .replace(inlineMatch[0], "")
        .replace(/\n{3,}/g, "\n\n")
        .trim(),
    };
  }

  const lines = normalized.split("\n");
  const normalizeSceneLine = (line: string) =>
    line.trim().replace(/^[*_`>\-\s]+/, "").trim().toUpperCase();
  const startIndex = lines.findIndex(
    (line) => normalizeSceneLine(line) === "SCENE:",
  );
  const endIndex =
    startIndex >= 0
      ? lines.findIndex(
          (line, index) =>
            index > startIndex && normalizeSceneLine(line) === "ENDSCENE",
        )
      : -1;

  if (startIndex < 0 || endIndex < 0) {
    const looseHeaderMatch = normalized.match(
      /(?:^|\n)\s*(?:GM:\s*)?[*_`>\-\s]*SCENE:\s*([\s\S]*)$/i,
    );

    if (looseHeaderMatch) {
      const rawAfterHeader = looseHeaderMatch[1];
      const cutPoints = [
        rawAfterHeader.search(/\n\s*\n/),
        rawAfterHeader.search(/\n\s*(?:GM|COMPANION:[^\n]+):/i),
        rawAfterHeader.search(/\n\s*(?:PARTY|COMBAT|STATE):/i),
      ].filter((index) => index >= 0);
      const cutIndex =
        cutPoints.length > 0 ? Math.min(...cutPoints) : rawAfterHeader.length;
      const looseBlock = rawAfterHeader.slice(0, cutIndex).trim();
      const looseScene: Partial<SceneSummary> = {};
      const looseFieldPattern =
        /[^a-z0-9]*(Title|Place|Mood|Threat|Goal|Clock|Context):\s*([\s\S]*?)(?=\s+[^a-z0-9]*(?:Title|Place|Mood|Threat|Goal|Clock|Context):|$)/gi;

      for (const match of looseBlock.matchAll(looseFieldPattern)) {
        const sceneKey = resolveSceneKey(match[1] ?? "");
        if (!sceneKey) {
          continue;
        }

        const value = sanitizeSceneFieldValue(match[2] ?? "");
        if (value) {
          looseScene[sceneKey] = value;
        }
      }

      if (Object.keys(looseScene).length >= 2) {
        const consumedLength =
          looseHeaderMatch[0].length - rawAfterHeader.length + cutIndex;
        const remainder = normalized
          .slice(consumedLength)
          .replace(/^\s+/, "")
          .replace(/\n{3,}/g, "\n\n")
          .trim();

        return {
          scene: {
            ...DEFAULT_SCENE_SUMMARY,
            ...looseScene,
          },
          content: remainder,
        };
      }
    }

    return {
      scene: null as SceneSummary | null,
      content: normalized.trim(),
    };
  }

  const sceneLines = lines.slice(startIndex + 1, endIndex);
  const scene: Partial<SceneSummary> = { ...parsedScene };

  for (const line of sceneLines) {
    const parsedLine = line.match(/^([^:]+):\s*(.*)$/);

    if (!parsedLine) {
      continue;
    }

    const label = parsedLine[1].trim();
    const value = sanitizeSceneFieldValue(parsedLine[2]);
    const sceneKey = resolveSceneKey(label);

    if (!sceneKey) {
      continue;
    }

    scene[sceneKey] = value || DEFAULT_SCENE_SUMMARY[sceneKey];
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
