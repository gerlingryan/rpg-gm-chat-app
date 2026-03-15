import {
  BATTLE_GRID_PRESETS,
  DEFAULT_BATTLE_GRID_PRESET,
  DEFAULT_BATTLE_TILE_SIZE_PX,
} from "@/lib/battle-map-grid";

export type NormalizedBattleMapTemplateInput = {
  ruleset: string;
  locationKey: string;
  title: string;
  imageDataUrl: string | null;
  referenceUrl: string | null;
  gridCols: number;
  gridRows: number;
  tileSizePx: number;
  blockedTilesJson: Array<[number, number]>;
  playerSpawnTilesJson: Array<[number, number]>;
  enemySpawnTilesJson: Array<[number, number]>;
  tagsJson: string[] | null;
};

export type NormalizeResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asCleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeLocationKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function parsePositiveInt(value: unknown, fallback: number) {
  const raw =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : NaN;
  if (!Number.isFinite(raw)) {
    return fallback;
  }
  return Math.max(1, Math.floor(raw));
}

function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeTags(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const tags = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 30);
  return tags.length > 0 ? tags : null;
}

function normalizeTileCoordinates(
  value: unknown,
  cols: number,
  rows: number,
): Array<[number, number]> {
  if (!Array.isArray(value)) {
    return [];
  }

  const unique = new Set<string>();
  const output: Array<[number, number]> = [];

  for (const entry of value) {
    let x = NaN;
    let y = NaN;
    if (Array.isArray(entry) && entry.length >= 2) {
      x = Number(entry[0]);
      y = Number(entry[1]);
    } else if (entry && typeof entry === "object") {
      const typed = entry as Record<string, unknown>;
      x = Number(typed.x);
      y = Number(typed.y);
    }

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      continue;
    }

    const xi = Math.floor(x);
    const yi = Math.floor(y);
    if (xi < 0 || yi < 0 || xi >= cols || yi >= rows) {
      continue;
    }

    const key = `${xi},${yi}`;
    if (unique.has(key)) {
      continue;
    }
    unique.add(key);
    output.push([xi, yi]);
  }

  return output;
}

export function normalizeBattleMapTemplateCreateInput(
  rawBody: unknown,
): NormalizeResult<NormalizedBattleMapTemplateInput> {
  const body = asObject(rawBody);
  const ruleset = asCleanString(body.ruleset);
  const locationKey = normalizeLocationKey(asCleanString(body.locationKey));
  const title = asCleanString(body.title);
  const imageDataUrl = asCleanString(body.imageDataUrl);
  const referenceUrl = asCleanString(body.referenceUrl);

  if (!ruleset) {
    return { ok: false, error: "ruleset is required." };
  }
  if (!locationKey) {
    return { ok: false, error: "locationKey is required." };
  }
  if (!title) {
    return { ok: false, error: "title is required." };
  }

  const gridCols = clampInt(
    parsePositiveInt(body.gridCols, DEFAULT_BATTLE_GRID_PRESET.cols),
    4,
    100,
  );
  const gridRows = clampInt(
    parsePositiveInt(body.gridRows, DEFAULT_BATTLE_GRID_PRESET.rows),
    4,
    100,
  );
  const tileSizePx = clampInt(
    parsePositiveInt(body.tileSizePx, DEFAULT_BATTLE_TILE_SIZE_PX),
    16,
    256,
  );
  const blockedTilesJson = normalizeTileCoordinates(body.blockedTilesJson, gridCols, gridRows);
  const playerSpawnTilesJson = normalizeTileCoordinates(
    body.playerSpawnTilesJson,
    gridCols,
    gridRows,
  );
  const enemySpawnTilesJson = normalizeTileCoordinates(
    body.enemySpawnTilesJson,
    gridCols,
    gridRows,
  );
  const tagsJson = normalizeTags(body.tagsJson);

  return {
    ok: true,
    value: {
      ruleset,
      locationKey,
      title: title.slice(0, 160),
      imageDataUrl: imageDataUrl || null,
      referenceUrl: referenceUrl || null,
      gridCols,
      gridRows,
      tileSizePx,
      blockedTilesJson,
      playerSpawnTilesJson,
      enemySpawnTilesJson,
      tagsJson,
    },
  };
}

type ExistingDimensions = {
  gridCols: number;
  gridRows: number;
};

export function normalizeBattleMapTemplatePatchInput(
  rawBody: unknown,
  existing: ExistingDimensions,
) {
  const body = asObject(rawBody);
  const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key);

  const resolvedCols = has("gridCols")
    ? clampInt(parsePositiveInt(body.gridCols, existing.gridCols), 4, 100)
    : existing.gridCols;
  const resolvedRows = has("gridRows")
    ? clampInt(parsePositiveInt(body.gridRows, existing.gridRows), 4, 100)
    : existing.gridRows;

  const data: Record<string, unknown> = {};

  if (has("ruleset")) {
    const ruleset = asCleanString(body.ruleset);
    if (!ruleset) {
      return { ok: false as const, error: "ruleset cannot be empty." };
    }
    data.ruleset = ruleset;
  }
  if (has("locationKey")) {
    const locationKey = normalizeLocationKey(asCleanString(body.locationKey));
    if (!locationKey) {
      return { ok: false as const, error: "locationKey cannot be empty." };
    }
    data.locationKey = locationKey;
  }
  if (has("title")) {
    const title = asCleanString(body.title);
    if (!title) {
      return { ok: false as const, error: "title cannot be empty." };
    }
    data.title = title.slice(0, 160);
  }
  if (has("imageDataUrl")) {
    const imageDataUrl = asCleanString(body.imageDataUrl);
    data.imageDataUrl = imageDataUrl || null;
  }
  if (has("referenceUrl")) {
    const referenceUrl = asCleanString(body.referenceUrl);
    data.referenceUrl = referenceUrl || null;
  }
  if (has("gridCols")) {
    data.gridCols = resolvedCols;
  }
  if (has("gridRows")) {
    data.gridRows = resolvedRows;
  }
  if (has("tileSizePx")) {
    data.tileSizePx = clampInt(
      parsePositiveInt(body.tileSizePx, DEFAULT_BATTLE_TILE_SIZE_PX),
      16,
      256,
    );
  }
  if (has("blockedTilesJson")) {
    data.blockedTilesJson = normalizeTileCoordinates(
      body.blockedTilesJson,
      resolvedCols,
      resolvedRows,
    );
  } else if (has("gridCols") || has("gridRows")) {
    data.blockedTilesJson = normalizeTileCoordinates([], resolvedCols, resolvedRows);
  }
  if (has("playerSpawnTilesJson")) {
    data.playerSpawnTilesJson = normalizeTileCoordinates(
      body.playerSpawnTilesJson,
      resolvedCols,
      resolvedRows,
    );
  } else if (has("gridCols") || has("gridRows")) {
    data.playerSpawnTilesJson = normalizeTileCoordinates([], resolvedCols, resolvedRows);
  }
  if (has("enemySpawnTilesJson")) {
    data.enemySpawnTilesJson = normalizeTileCoordinates(
      body.enemySpawnTilesJson,
      resolvedCols,
      resolvedRows,
    );
  } else if (has("gridCols") || has("gridRows")) {
    data.enemySpawnTilesJson = normalizeTileCoordinates([], resolvedCols, resolvedRows);
  }
  if (has("tagsJson")) {
    data.tagsJson = normalizeTags(body.tagsJson);
  }

  return { ok: true as const, value: data };
}

export function normalizeBattleMapListFilters(searchParams: URLSearchParams) {
  const ruleset = asCleanString(searchParams.get("ruleset"));
  const locationKey = normalizeLocationKey(asCleanString(searchParams.get("locationKey")));
  const limitRaw = Number.parseInt(asCleanString(searchParams.get("limit")), 10);
  const limit = Number.isFinite(limitRaw) ? clampInt(limitRaw, 1, 200) : 100;

  return { ruleset, locationKey, limit };
}

export function getAllowedBattleGridPresets() {
  return BATTLE_GRID_PRESETS;
}
