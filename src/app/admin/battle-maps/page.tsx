"use client";

import Link from "next/link";
import { type ChangeEvent, useEffect, useMemo, useState } from "react";
import {
  BATTLE_GRID_PRESETS,
  DEFAULT_BATTLE_GRID_PRESET,
  DEFAULT_BATTLE_TILE_SIZE_PX,
  type BattleGridPreset,
} from "@/lib/battle-map-grid";
import { getBattleLocationCatalogForRuleset } from "@/lib/battle-map-catalog";

type BattleMapTemplate = {
  id: string;
  ruleset: string;
  locationKey: string;
  title: string;
  imageDataUrl: string | null;
  referenceUrl: string | null;
  gridCols: number;
  gridRows: number;
  tileSizePx: number;
  blockedTilesJson: unknown;
  playerSpawnTilesJson?: unknown;
  enemySpawnTilesJson?: unknown;
  tagsJson: unknown;
  createdAt?: string;
  updatedAt?: string;
};

type BattleMapDraft = {
  id: string;
  ruleset: string;
  locationKey: string;
  title: string;
  imageDataUrl: string;
  referenceUrl: string;
  gridCols: number;
  gridRows: number;
  tileSizePx: number;
  blockedTiles: Array<[number, number]>;
  playerSpawnTiles: Array<[number, number]>;
  enemySpawnTiles: Array<[number, number]>;
  tagsText: string;
};

type TokenLibraryPaletteEntry = {
  id: string;
  label: string;
  entityType: "character" | "enemy";
  category: string;
  subtype: string | null;
  imageDataUrl: string;
};

type PlacedToken = {
  id: string;
  tokenLibraryId: string;
  label: string;
  imageDataUrl: string;
  x: number;
  y: number;
};

type BackgroundPromptPreset = {
  id: string;
  label: string;
  prompt: string;
};

type BackgroundStylePreset = {
  id: string;
  label: string;
  guidance: string;
};

type CustomBackgroundPromptPreset = {
  id: string;
  ruleset: string;
  label: string;
  prompt: string;
};

const CUSTOM_PRESET_STORAGE_KEY = "battle-map-custom-prompt-presets:v1";

const GENERIC_BACKGROUND_PROMPT_PRESETS: BackgroundPromptPreset[] = [
  {
    id: "city-street",
    label: "City Street",
    prompt:
      "Top-down tactical city street at dusk with cobblestone lanes, alley branches, market stalls, handcarts, crates, and lamp posts. Keep clear movement lanes and readable obstacle edges.",
  },
  {
    id: "graveyard",
    label: "Graveyard",
    prompt:
      "Top-down graveyard combat map with old tombstones, mausoleum walls, iron fencing, narrow paths, dead trees, and broken statuary. Strong readability for blocked choke points.",
  },
  {
    id: "forest",
    label: "Forest",
    prompt:
      "Top-down forest battle map with tree clusters, roots, brush patches, fallen logs, and a dirt trail crossing the scene. Keep varied but readable terrain zones for tactical play.",
  },
  {
    id: "cave",
    label: "Cave",
    prompt:
      "Top-down cave interior with winding tunnels, rocky pillars, stalagmites, shallow pits, and a central chamber. Emphasize clear passable lanes versus hard obstructions.",
  },
];

const DND_BACKGROUND_PROMPT_PRESETS: BackgroundPromptPreset[] = [
  ...GENERIC_BACKGROUND_PROMPT_PRESETS,
  {
    id: "crypt",
    label: "Crypt",
    prompt:
      "Top-down forgotten crypt with sarcophagi, cracked stone floors, collapsed pillars, ritual markings, and narrow corridors. Keep tactical lines and obstacle silhouettes clear.",
  },
  {
    id: "sewer",
    label: "Sewer",
    prompt:
      "Top-down sewer map with brick channels, sludge basins, walkway ledges, broken gates, and side tunnels. Keep contrast high so walkable versus blocked areas are obvious.",
  },
];

const DEADLANDS_BACKGROUND_PROMPT_PRESETS: BackgroundPromptPreset[] = [
  ...GENERIC_BACKGROUND_PROMPT_PRESETS,
  {
    id: "saloon",
    label: "Saloon",
    prompt:
      "Top-down old west saloon interior with tables, bar counter, piano corner, stair access, support posts, and shattered furniture. Keep tactical movement and cover-like blockers readable.",
  },
  {
    id: "rail-yard",
    label: "Rail Yard",
    prompt:
      "Top-down frontier rail yard with tracks, boxcars, cargo stacks, loading platforms, and maintenance sheds. Strong lane readability for flanking and blocked zones.",
  },
];

const SAVAGE_RIFTS_BACKGROUND_PROMPT_PRESETS: BackgroundPromptPreset[] = [
  ...GENERIC_BACKGROUND_PROMPT_PRESETS,
  {
    id: "ruined-city",
    label: "Ruined City",
    prompt:
      "Top-down post-apocalyptic ruined city block with collapsed walls, wrecked vehicles, concrete barriers, and broken streets. Keep obstacle silhouettes clean for tactical use.",
  },
  {
    id: "bunker",
    label: "Bunker",
    prompt:
      "Top-down bunker corridor network with blast doors, control rooms, generator bay, and chokepoints. Maintain clear movement lanes and hard blocked sections.",
  },
];

const BACKGROUND_STYLE_PRESETS: BackgroundStylePreset[] = [
  {
    id: "tactical-realism",
    label: "Tactical Realism",
    guidance:
      "Grounded realistic materials, natural lighting, high texture detail, believable wear, and practical battlefield readability.",
  },
  {
    id: "fantasy-painterly",
    label: "Fantasy Painterly",
    guidance:
      "Hand-painted fantasy concept art style with rich brushwork, controlled color harmony, and readable overhead silhouettes.",
  },
  {
    id: "gritty-cinematic",
    label: "Gritty Cinematic",
    guidance:
      "Moody, high-contrast cinematic realism with weathering, grime, and dramatic but still readable tactical shapes.",
  },
  {
    id: "inked-illustration",
    label: "Inked Illustration",
    guidance:
      "Stylized illustrated map with clean ink contours, painterly fills, and strong shape definition from a top-down view.",
  },
  {
    id: "old-school-rpg",
    label: "Old School RPG",
    guidance:
      "Classic CRPG-inspired environment art, restrained palette, clear tile readability, and strong obstacle boundaries.",
  },
  {
    id: "muted-naturalistic",
    label: "Muted Naturalistic",
    guidance:
      "Naturalistic terrain tones, softer contrast, realistic textures, and less saturation while preserving tactical clarity.",
  },
    {
    id: "3d-realism",
    label: "3D Realism",
    guidance:
      "Top-down tabletop RPG battlemap, camera high overhead (85-90 deg), minimal perspective, designed for VTT readability. Style: looks like a 3D model / game-engine render (Unreal Engine 5 / Unity HDRP), high-poly environment, PBR materials, realistic ambient occlusion, soft contact shadows, global illumination, crisp texture detail, realistic scale and proportions.\nInclude subtle height/depth cues (rocks, roots, steps, walls, props) but keep it clearly top-down and navigable.\nComposition: clear walkable areas, readable obstacles, natural-looking edge framing. No characters, no creatures, no vehicles (unless specified).\nOutput: square image, seamless edges if possible, no labels, no text, no watermark. GRID: none\nAvoid: isometric view, 3/4 angle, low angle, horizon, dramatic cinematic framing, portrait composition, extreme perspective distortion, fisheye, blurry, lowres, UI elements, labels, numbers, compass rose, watermark, logo.",
  },
];

function normalizeTileCoordinates(value: unknown, cols: number, rows: number) {
  if (!Array.isArray(value)) {
    return [] as Array<[number, number]>;
  }
  const seen = new Set<string>();
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
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push([xi, yi]);
  }
  return output;
}

function buildDraft(template?: BattleMapTemplate | null): BattleMapDraft {
  if (!template) {
    return {
      id: "",
      ruleset: "D&D 5e",
      locationKey: "city_street",
      title: "New Battle Map",
      imageDataUrl: "",
      referenceUrl: "",
      gridCols: DEFAULT_BATTLE_GRID_PRESET.cols,
      gridRows: DEFAULT_BATTLE_GRID_PRESET.rows,
      tileSizePx: DEFAULT_BATTLE_TILE_SIZE_PX,
      blockedTiles: [],
      playerSpawnTiles: [],
      enemySpawnTiles: [],
      tagsText: "",
    };
  }
  const tags = Array.isArray(template.tagsJson)
    ? template.tagsJson.filter((entry): entry is string => typeof entry === "string")
    : [];
  return {
    id: template.id,
    ruleset: template.ruleset,
    locationKey: template.locationKey,
    title: template.title,
    imageDataUrl: template.imageDataUrl ?? "",
    referenceUrl: template.referenceUrl ?? "",
    gridCols: template.gridCols,
    gridRows: template.gridRows,
    tileSizePx: template.tileSizePx,
    blockedTiles: normalizeTileCoordinates(
      template.blockedTilesJson,
      template.gridCols,
      template.gridRows,
    ),
    playerSpawnTiles: normalizeTileCoordinates(
      template.playerSpawnTilesJson,
      template.gridCols,
      template.gridRows,
    ),
    enemySpawnTiles: normalizeTileCoordinates(
      template.enemySpawnTilesJson,
      template.gridCols,
      template.gridRows,
    ),
    tagsText: tags.join(", "),
  };
}

export default function BattleMapAdminPage() {
  const [templates, setTemplates] = useState<BattleMapTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [draft, setDraft] = useState<BattleMapDraft>(() => buildDraft());
  const [filters, setFilters] = useState({
    ruleset: "",
    locationKey: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [paintMode, setPaintMode] = useState<
    | "block"
    | "erase-block"
    | "player-spawn"
    | "erase-player-spawn"
    | "enemy-spawn"
    | "erase-enemy-spawn"
  >("block");
  const [isPainting, setIsPainting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [tokenTestMode, setTokenTestMode] = useState(false);
  const [tokenLibraryEntries, setTokenLibraryEntries] = useState<TokenLibraryPaletteEntry[]>([]);
  const [tokenLibraryLoading, setTokenLibraryLoading] = useState(false);
  const [selectedPaletteTokenId, setSelectedPaletteTokenId] = useState("");
  const [placedTokens, setPlacedTokens] = useState<PlacedToken[]>([]);
  const [selectedPlacedTokenId, setSelectedPlacedTokenId] = useState("");
  const [draggingPlacedTokenId, setDraggingPlacedTokenId] = useState("");
  const [tokenScalePercent, setTokenScalePercent] = useState(150);
  const [mapZoomPercent, setMapZoomPercent] = useState(100);
  const [backgroundPrompt, setBackgroundPrompt] = useState("");
  const [backgroundStyleId, setBackgroundStyleId] = useState("tactical-realism");
  const [isGeneratingBackground, setIsGeneratingBackground] = useState(false);
  const [customPresetLabel, setCustomPresetLabel] = useState("");
  const [customPromptPresets, setCustomPromptPresets] = useState<CustomBackgroundPromptPreset[]>(
    [],
  );

  const blockedSet = useMemo(
    () => new Set(draft.blockedTiles.map(([x, y]) => `${x},${y}`)),
    [draft.blockedTiles],
  );
  const playerSpawnSet = useMemo(
    () => new Set(draft.playerSpawnTiles.map(([x, y]) => `${x},${y}`)),
    [draft.playerSpawnTiles],
  );
  const enemySpawnSet = useMemo(
    () => new Set(draft.enemySpawnTiles.map(([x, y]) => `${x},${y}`)),
    [draft.enemySpawnTiles],
  );

  const activeLocationOptions = useMemo(
    () => getBattleLocationCatalogForRuleset(draft.ruleset),
    [draft.ruleset],
  );

  const gridCells = useMemo(() => {
    const cells: Array<{ x: number; y: number; key: string }> = [];
    for (let y = 0; y < draft.gridRows; y += 1) {
      for (let x = 0; x < draft.gridCols; x += 1) {
        cells.push({ x, y, key: `${x},${y}` });
      }
    }
    return cells;
  }, [draft.gridCols, draft.gridRows]);
  const placedTokenByCell = useMemo(() => {
    const map = new Map<string, PlacedToken>();
    for (const token of placedTokens) {
      map.set(`${token.x},${token.y}`, token);
    }
    return map;
  }, [placedTokens]);

  const mapValidationIssues = useMemo(() => {
    const issues: string[] = [];
    if (!draft.imageDataUrl.trim() && !draft.referenceUrl.trim()) {
      issues.push("No background image set yet.");
    }
    if (!draft.title.trim()) {
      issues.push("Title is empty.");
    }
    const blockedRatio =
      draft.gridCols * draft.gridRows > 0
        ? draft.blockedTiles.length / (draft.gridCols * draft.gridRows)
        : 0;
    if (blockedRatio > 0.6) {
      issues.push("More than 60% of tiles are blocked.");
    }
    if (draft.tileSizePx < 32) {
      issues.push("Tile size is very small (<32px).");
    }
    if (draft.playerSpawnTiles.length === 0) {
      issues.push("No player spawn tiles defined.");
    }
    if (draft.enemySpawnTiles.length === 0) {
      issues.push("No enemy spawn tiles defined.");
    }
    const blockedPlayerOverlap = draft.playerSpawnTiles.filter(([x, y]) =>
      blockedSet.has(`${x},${y}`),
    ).length;
    if (blockedPlayerOverlap > 0) {
      issues.push("Some player spawn tiles overlap blocked tiles.");
    }
    const blockedEnemyOverlap = draft.enemySpawnTiles.filter(([x, y]) =>
      blockedSet.has(`${x},${y}`),
    ).length;
    if (blockedEnemyOverlap > 0) {
      issues.push("Some enemy spawn tiles overlap blocked tiles.");
    }
    return issues;
  }, [
    draft.blockedTiles.length,
    draft.enemySpawnTiles,
    draft.gridCols,
    draft.gridRows,
    draft.imageDataUrl,
    draft.playerSpawnTiles,
    draft.referenceUrl,
    draft.tileSizePx,
    draft.title,
    blockedSet,
  ]);
  const backgroundPromptPresets = useMemo(() => {
    const ruleset = draft.ruleset.trim().toLowerCase();
    if (ruleset === "deadlands classic") {
      return DEADLANDS_BACKGROUND_PROMPT_PRESETS;
    }
    if (ruleset === "savage rifts") {
      return SAVAGE_RIFTS_BACKGROUND_PROMPT_PRESETS;
    }
    if (ruleset === "d&d 5e") {
      return DND_BACKGROUND_PROMPT_PRESETS;
    }
    return GENERIC_BACKGROUND_PROMPT_PRESETS;
  }, [draft.ruleset]);
  const filteredCustomPromptPresets = useMemo(() => {
    const rulesetKey = draft.ruleset.trim().toLowerCase();
    return customPromptPresets.filter(
      (preset) => preset.ruleset.trim().toLowerCase() === rulesetKey,
    );
  }, [customPromptPresets, draft.ruleset]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(CUSTOM_PRESET_STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return;
      }
      const normalized = parsed
        .map((entry) => {
          if (!entry || typeof entry !== "object") {
            return null;
          }
          const typed = entry as Record<string, unknown>;
          const id = typeof typed.id === "string" ? typed.id.trim() : "";
          const ruleset = typeof typed.ruleset === "string" ? typed.ruleset.trim() : "";
          const label = typeof typed.label === "string" ? typed.label.trim() : "";
          const prompt = typeof typed.prompt === "string" ? typed.prompt.trim() : "";
          if (!id || !ruleset || !label || !prompt) {
            return null;
          }
          return { id, ruleset, label, prompt } satisfies CustomBackgroundPromptPreset;
        })
        .filter((entry): entry is CustomBackgroundPromptPreset => Boolean(entry));
      setCustomPromptPresets(normalized);
    } catch {
      setCustomPromptPresets([]);
    }
  }, []);

  function persistCustomPromptPresets(nextPresets: CustomBackgroundPromptPreset[]) {
    setCustomPromptPresets(nextPresets);
    try {
      window.localStorage.setItem(CUSTOM_PRESET_STORAGE_KEY, JSON.stringify(nextPresets));
    } catch {
      // Ignore local storage errors.
    }
  }

  useEffect(() => {
    function handleMouseUp() {
      setIsPainting(false);
    }
    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, []);

  async function loadTemplates() {
    setLoading(true);
    setErrorMessage("");
    try {
      const params = new URLSearchParams();
      if (filters.ruleset.trim()) {
        params.set("ruleset", filters.ruleset.trim());
      }
      if (filters.locationKey.trim()) {
        params.set("locationKey", filters.locationKey.trim());
      }
      params.set("limit", "200");

      const response = await fetch(`/api/admin/battle-maps?${params.toString()}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        templates?: BattleMapTemplate[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load battle maps.");
      }
      const nextTemplates = Array.isArray(payload.templates) ? payload.templates : [];
      setTemplates(nextTemplates);

      if (selectedTemplateId) {
        const stillExists = nextTemplates.some((template) => template.id === selectedTemplateId);
        if (!stillExists) {
          setSelectedTemplateId("");
          setDraft(buildDraft());
        }
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load battle maps.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.ruleset, filters.locationKey]);

  async function loadTokenLibraryPalette() {
    setTokenLibraryLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("ruleset", draft.ruleset);
      params.set("limit", "100");
      const response = await fetch(`/api/admin/token-library?${params.toString()}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        entries?: Array<Record<string, unknown>>;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load token library.");
      }
      const parsedEntries = Array.isArray(payload.entries)
        ? payload.entries
            .map((entry) => {
              if (!entry || typeof entry !== "object") {
                return null;
              }
              const typed = entry as Record<string, unknown>;
              const id = typeof typed.id === "string" ? typed.id : "";
              const label = typeof typed.label === "string" ? typed.label : "";
              const imageDataUrl =
                typeof typed.imageDataUrl === "string" ? typed.imageDataUrl : "";
              if (!id || !label || !imageDataUrl) {
                return null;
              }
              return {
                id,
                label,
                entityType:
                  typeof typed.entityType === "string" &&
                  typed.entityType.toLowerCase() === "character"
                    ? "character"
                    : "enemy",
                category:
                  typeof typed.category === "string" && typed.category.trim()
                    ? typed.category.trim()
                    : "general",
                subtype:
                  typeof typed.subtype === "string" && typed.subtype.trim()
                    ? typed.subtype.trim()
                    : null,
                imageDataUrl,
              } satisfies TokenLibraryPaletteEntry;
            })
            .filter((entry): entry is TokenLibraryPaletteEntry => Boolean(entry))
        : [];
      setTokenLibraryEntries(parsedEntries);
      setSelectedPaletteTokenId((current) => {
        if (current && parsedEntries.some((entry) => entry.id === current)) {
          return current;
        }
        return parsedEntries[0]?.id ?? "";
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to load token library.");
    } finally {
      setTokenLibraryLoading(false);
    }
  }

  useEffect(() => {
    if (!tokenTestMode) {
      return;
    }
    void loadTokenLibraryPalette();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenTestMode, draft.ruleset]);

  useEffect(() => {
    if (!tokenTestMode) {
      return;
    }
    setPlacedTokens((current) =>
      current.filter(
        (token) =>
          token.x >= 0 &&
          token.y >= 0 &&
          token.x < draft.gridCols &&
          token.y < draft.gridRows &&
          !blockedSet.has(`${token.x},${token.y}`),
      ),
    );
  }, [blockedSet, draft.gridCols, draft.gridRows, tokenTestMode]);

  async function selectTemplate(templateId: string) {
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const response = await fetch(`/api/admin/battle-maps/${templateId}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        template?: BattleMapTemplate;
        error?: string;
      };
      if (!response.ok || !payload.template) {
        throw new Error(payload.error ?? "Template not found.");
      }
      setSelectedTemplateId(templateId);
      setDraft(buildDraft(payload.template));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to load template.");
    }
  }

  function applyPaint(x: number, y: number) {
    const key = `${x},${y}`;
    setDraft((current) => {
      const blockedSet = new Set(current.blockedTiles.map(([bx, by]) => `${bx},${by}`));
      const playerSet = new Set(current.playerSpawnTiles.map(([sx, sy]) => `${sx},${sy}`));
      const enemySet = new Set(current.enemySpawnTiles.map(([sx, sy]) => `${sx},${sy}`));

      if (paintMode === "block") {
        blockedSet.add(key);
      } else if (paintMode === "erase-block") {
        blockedSet.delete(key);
      } else if (paintMode === "player-spawn") {
        playerSet.add(key);
      } else if (paintMode === "erase-player-spawn") {
        playerSet.delete(key);
      } else if (paintMode === "enemy-spawn") {
        enemySet.add(key);
      } else if (paintMode === "erase-enemy-spawn") {
        enemySet.delete(key);
      }

      const toCoords = (set: Set<string>) =>
        [...set].map((entry) => {
          const [sx, sy] = entry.split(",");
          return [Number.parseInt(sx, 10), Number.parseInt(sy, 10)] as [number, number];
        });
      return {
        ...current,
        blockedTiles: toCoords(blockedSet),
        playerSpawnTiles: toCoords(playerSet),
        enemySpawnTiles: toCoords(enemySet),
      };
    });
  }

  function moveTokenToCell(tokenId: string, x: number, y: number) {
    if (!tokenId) {
      return;
    }
    if (blockedSet.has(`${x},${y}`)) {
      return;
    }
    setPlacedTokens((current) => {
      const occupiedByAnother = current.some(
        (token) => token.id !== tokenId && token.x === x && token.y === y,
      );
      if (occupiedByAnother) {
        return current;
      }
      return current.map((token) => (token.id === tokenId ? { ...token, x, y } : token));
    });
  }

  function placeTokenFromPalette(tokenLibraryId: string, x: number, y: number) {
    if (!tokenLibraryId || blockedSet.has(`${x},${y}`) || placedTokenByCell.has(`${x},${y}`)) {
      return;
    }
    const selected = tokenLibraryEntries.find((entry) => entry.id === tokenLibraryId);
    if (!selected) {
      return;
    }
    setPlacedTokens((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        tokenLibraryId: selected.id,
        label: selected.label,
        imageDataUrl: selected.imageDataUrl,
        x,
        y,
      },
    ]);
  }

  function handleAutoPlaceFromSpawns() {
    const playerPool = tokenLibraryEntries.filter((entry) => entry.entityType === "character");
    const enemyPool = tokenLibraryEntries.filter((entry) => entry.entityType === "enemy");

    const nextPlaced: PlacedToken[] = [];
    const occupied = new Set<string>();
    let placedPlayerCount = 0;
    let placedEnemyCount = 0;
    let skippedBlockedCount = 0;
    let skippedOccupiedCount = 0;

    const placeIntoSpawns = (
      spawns: Array<[number, number]>,
      pool: TokenLibraryPaletteEntry[],
      side: "player" | "enemy",
    ) => {
      if (pool.length === 0 || spawns.length === 0) {
        return;
      }
      for (let index = 0; index < spawns.length; index += 1) {
        const [x, y] = spawns[index];
        const key = `${x},${y}`;
        if (blockedSet.has(key)) {
          skippedBlockedCount += 1;
          continue;
        }
        if (occupied.has(key)) {
          skippedOccupiedCount += 1;
          continue;
        }
        const entry = pool[index % pool.length];
        nextPlaced.push({
          id: crypto.randomUUID(),
          tokenLibraryId: entry.id,
          label: entry.label,
          imageDataUrl: entry.imageDataUrl,
          x,
          y,
        });
        occupied.add(key);
        if (side === "player") {
          placedPlayerCount += 1;
        } else {
          placedEnemyCount += 1;
        }
      }
    };

    placeIntoSpawns(draft.playerSpawnTiles, playerPool, "player");
    placeIntoSpawns(draft.enemySpawnTiles, enemyPool, "enemy");

    setPlacedTokens(nextPlaced);
    setDraggingPlacedTokenId("");
    setSelectedPlacedTokenId("");

    const notes: string[] = [];
    if (draft.playerSpawnTiles.length > 0 && playerPool.length === 0) {
      notes.push("No character tokens available for player spawns.");
    }
    if (draft.enemySpawnTiles.length > 0 && enemyPool.length === 0) {
      notes.push("No enemy tokens available for enemy spawns.");
    }
    if (skippedBlockedCount > 0) {
      notes.push(`${skippedBlockedCount} spawn tile(s) skipped because blocked.`);
    }
    if (skippedOccupiedCount > 0) {
      notes.push(`${skippedOccupiedCount} spawn tile(s) skipped due to overlap.`);
    }

    if (nextPlaced.length === 0) {
      setErrorMessage(
        notes.length > 0 ? notes.join(" ") : "No tokens were placed from current spawn zones.",
      );
      setSuccessMessage("");
      return;
    }

    const summary = `Auto-placed ${placedPlayerCount} player and ${placedEnemyCount} enemy token(s).`;
    setSuccessMessage(notes.length > 0 ? `${summary} ${notes.join(" ")}` : summary);
    setErrorMessage("");
  }

  function handleGridPresetChange(preset: BattleGridPreset) {
    setDraft((current) => ({
      ...current,
      gridCols: preset.cols,
      gridRows: preset.rows,
      blockedTiles: current.blockedTiles.filter(
        ([x, y]) => x >= 0 && y >= 0 && x < preset.cols && y < preset.rows,
      ),
      playerSpawnTiles: current.playerSpawnTiles.filter(
        ([x, y]) => x >= 0 && y >= 0 && x < preset.cols && y < preset.rows,
      ),
      enemySpawnTiles: current.enemySpawnTiles.filter(
        ([x, y]) => x >= 0 && y >= 0 && x < preset.cols && y < preset.rows,
      ),
    }));
  }

  function buildPayload() {
    const tagsJson = draft.tagsText
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    return {
      ruleset: draft.ruleset,
      locationKey: draft.locationKey,
      title: draft.title,
      imageDataUrl: draft.imageDataUrl || null,
      referenceUrl: draft.referenceUrl || null,
      gridCols: draft.gridCols,
      gridRows: draft.gridRows,
      tileSizePx: draft.tileSizePx,
      blockedTilesJson: draft.blockedTiles,
      playerSpawnTilesJson: draft.playerSpawnTiles,
      enemySpawnTilesJson: draft.enemySpawnTiles,
      tagsJson,
    };
  }

  async function handleCreate() {
    setSaving(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const response = await fetch("/api/admin/battle-maps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      const payload = (await response.json()) as {
        template?: BattleMapTemplate;
        error?: string;
      };
      if (!response.ok || !payload.template) {
        throw new Error(payload.error ?? "Unable to create template.");
      }
      setSelectedTemplateId(payload.template.id);
      setDraft(buildDraft(payload.template));
      setSuccessMessage("Template created.");
      await loadTemplates();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to create template.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    if (!draft.id) {
      await handleCreate();
      return;
    }
    setSaving(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const response = await fetch(`/api/admin/battle-maps/${draft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      const payload = (await response.json()) as {
        template?: BattleMapTemplate;
        error?: string;
      };
      if (!response.ok || !payload.template) {
        throw new Error(payload.error ?? "Unable to save template.");
      }
      setDraft(buildDraft(payload.template));
      setSuccessMessage("Template saved.");
      await loadTemplates();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to save template.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!draft.id) {
      return;
    }
    if (!window.confirm("Delete this battle map template?")) {
      return;
    }
    setSaving(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const response = await fetch(`/api/admin/battle-maps/${draft.id}`, {
        method: "DELETE",
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to delete template.");
      }
      setSelectedTemplateId("");
      setDraft(buildDraft());
      setSuccessMessage("Template deleted.");
      await loadTemplates();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to delete template.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDuplicate() {
    const sourceTitle = draft.title.trim() || "Battle Map";
    const duplicateDraft: BattleMapDraft = {
      ...draft,
      id: "",
      title: `${sourceTitle} (Copy)`,
    };
    setDraft(duplicateDraft);
    setSelectedTemplateId("");
    setSuccessMessage("Draft duplicated. Save to create a new template.");
  }

  async function handleGenerateBackgroundImage() {
    setErrorMessage("");
    setSuccessMessage("");
    setIsGeneratingBackground(true);
    try {
      if (!backgroundPrompt.trim()) {
        throw new Error("Enter a background prompt first.");
      }

      const response = await fetch("/api/admin/battle-maps/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: backgroundPrompt.trim(),
          styleId: backgroundStyleId,
          ruleset: draft.ruleset,
          gridCols: draft.gridCols,
          gridRows: draft.gridRows,
        }),
      });
      const payload = (await response.json()) as {
        imageDataUrl?: string;
        error?: string;
      };
      if (!response.ok || !payload.imageDataUrl) {
        throw new Error(payload.error ?? "Unable to generate background image.");
      }

      setDraft((current) => ({
        ...current,
        imageDataUrl: payload.imageDataUrl ?? "",
      }));
      setSuccessMessage("Background image generated and applied.");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to generate background image.",
      );
    } finally {
      setIsGeneratingBackground(false);
    }
  }

  async function handleUploadBackgroundImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    if (!file.type.startsWith("image/")) {
      setErrorMessage("Please select an image file.");
      event.target.value = "";
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      setErrorMessage("Image file is too large. Maximum size is 12MB.");
      event.target.value = "";
      return;
    }

    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === "string") {
            resolve(reader.result);
            return;
          }
          reject(new Error("Unable to read image file."));
        };
        reader.onerror = () => reject(new Error("Unable to read image file."));
        reader.readAsDataURL(file);
      });
      setDraft((current) => ({
        ...current,
        imageDataUrl: dataUrl,
        referenceUrl: "",
      }));
      setErrorMessage("");
      setSuccessMessage("Background image uploaded and applied.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to upload image.");
    } finally {
      event.target.value = "";
    }
  }

  function handleSaveCustomPromptPreset() {
    const label = customPresetLabel.trim();
    const prompt = backgroundPrompt.trim();
    if (!label) {
      setErrorMessage("Enter a preset label first.");
      return;
    }
    if (!prompt) {
      setErrorMessage("Enter a prompt first.");
      return;
    }
    const ruleset = draft.ruleset.trim() || "Unknown Ruleset";
    const nextPreset: CustomBackgroundPromptPreset = {
      id: crypto.randomUUID(),
      ruleset,
      label: label.slice(0, 60),
      prompt,
    };
    const nextPresets = [nextPreset, ...customPromptPresets].slice(0, 100);
    persistCustomPromptPresets(nextPresets);
    setCustomPresetLabel("");
    setErrorMessage("");
    setSuccessMessage("Custom preset saved.");
  }

  function handleDeleteCustomPromptPreset(presetId: string) {
    const nextPresets = customPromptPresets.filter((preset) => preset.id !== presetId);
    persistCustomPromptPresets(nextPresets);
  }

  return (
    <main className="min-h-screen bg-zinc-950 p-4 text-zinc-100 md:p-5">
      <div className="mx-auto flex w-full max-w-[95rem] flex-col gap-4">
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-3 shadow">
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-400">Admin</p>
            <h1 className="text-lg font-semibold text-zinc-100">Battle Map Studio</h1>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/admin/token-library"
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 transition hover:border-zinc-500"
            >
              Token Library
            </Link>
            <Link
              href="/"
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 transition hover:border-zinc-500"
            >
              Back to Launch
            </Link>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-3 shadow">
            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
                Filters
              </div>
              <input
                value={filters.ruleset}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, ruleset: event.target.value }))
                }
                placeholder="Ruleset (ex: D&D 5e)"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-xs text-zinc-200 outline-none focus:border-zinc-500"
              />
              <input
                value={filters.locationKey}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, locationKey: event.target.value }))
                }
                placeholder="Location key (ex: city_street)"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-xs text-zinc-200 outline-none focus:border-zinc-500"
              />
              <button
                type="button"
                onClick={() => {
                  setSelectedTemplateId("");
                  setDraft(buildDraft());
                  setErrorMessage("");
                  setSuccessMessage("New draft started.");
                }}
                className="w-full rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-2 text-xs font-medium text-cyan-100 transition hover:border-cyan-400/60"
              >
                New Draft
              </button>
            </div>

            <div className="mt-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
              Templates
            </div>
            <div className="mt-2 max-h-[65vh] space-y-1.5 overflow-y-auto pr-1">
              {loading ? (
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-2 text-xs text-zinc-400">
                  Loading templates...
                </div>
              ) : templates.length === 0 ? (
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-2 text-xs text-zinc-400">
                  No templates found.
                </div>
              ) : (
                templates.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => void selectTemplate(template.id)}
                    className={`w-full rounded-lg border p-2 text-left transition ${
                      selectedTemplateId === template.id
                        ? "border-cyan-400/70 bg-cyan-500/10"
                        : "border-zinc-800 bg-zinc-950 hover:border-zinc-600"
                    }`}
                  >
                    <div className="text-xs font-medium text-zinc-100">{template.title}</div>
                    <div className="mt-1 text-[11px] text-zinc-400">
                      {template.ruleset} | {template.locationKey}
                    </div>
                  </button>
                ))
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-3 shadow">
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              <label className="text-xs text-zinc-300">
                Ruleset
                <input
                  value={draft.ruleset}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, ruleset: event.target.value }))
                  }
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-xs text-zinc-200 outline-none focus:border-zinc-500"
                />
              </label>
              <label className="text-xs text-zinc-300">
                Location
                <select
                  value={draft.locationKey}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, locationKey: event.target.value }))
                  }
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-xs text-zinc-200 outline-none focus:border-zinc-500"
                >
                  {activeLocationOptions.map((entry) => (
                    <option key={entry.key} value={entry.key}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-zinc-300">
                Title
                <input
                  value={draft.title}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, title: event.target.value }))
                  }
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-xs text-zinc-200 outline-none focus:border-zinc-500"
                />
              </label>
              <label className="text-xs text-zinc-300">
                Grid Preset
                <select
                  value={`${draft.gridCols}x${draft.gridRows}`}
                  onChange={(event) => {
                    const [colsRaw, rowsRaw] = event.target.value.split("x");
                    const cols = Number.parseInt(colsRaw, 10);
                    const rows = Number.parseInt(rowsRaw, 10);
                    const preset = BATTLE_GRID_PRESETS.find(
                      (entry) => entry.cols === cols && entry.rows === rows,
                    );
                    if (preset) {
                      handleGridPresetChange(preset);
                    }
                  }}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-xs text-zinc-200 outline-none focus:border-zinc-500"
                >
                  {BATTLE_GRID_PRESETS.map((preset) => (
                    <option key={preset.label} value={preset.label}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-zinc-300">
                Grid Cols
                <input
                  type="number"
                  min={4}
                  max={100}
                  value={draft.gridCols}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      gridCols: Math.max(4, Number.parseInt(event.target.value || "4", 10)),
                      blockedTiles: current.blockedTiles.filter(
                        ([x, y]) => x < Math.max(4, Number.parseInt(event.target.value || "4", 10)) && y < current.gridRows,
                      ),
                      playerSpawnTiles: current.playerSpawnTiles.filter(
                        ([x, y]) =>
                          x < Math.max(4, Number.parseInt(event.target.value || "4", 10)) &&
                          y < current.gridRows,
                      ),
                      enemySpawnTiles: current.enemySpawnTiles.filter(
                        ([x, y]) =>
                          x < Math.max(4, Number.parseInt(event.target.value || "4", 10)) &&
                          y < current.gridRows,
                      ),
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-xs text-zinc-200 outline-none focus:border-zinc-500"
                />
              </label>
              <label className="text-xs text-zinc-300">
                Grid Rows
                <input
                  type="number"
                  min={4}
                  max={100}
                  value={draft.gridRows}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      gridRows: Math.max(4, Number.parseInt(event.target.value || "4", 10)),
                      blockedTiles: current.blockedTiles.filter(
                        ([x, y]) => y < Math.max(4, Number.parseInt(event.target.value || "4", 10)) && x < current.gridCols,
                      ),
                      playerSpawnTiles: current.playerSpawnTiles.filter(
                        ([x, y]) =>
                          y < Math.max(4, Number.parseInt(event.target.value || "4", 10)) &&
                          x < current.gridCols,
                      ),
                      enemySpawnTiles: current.enemySpawnTiles.filter(
                        ([x, y]) =>
                          y < Math.max(4, Number.parseInt(event.target.value || "4", 10)) &&
                          x < current.gridCols,
                      ),
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-xs text-zinc-200 outline-none focus:border-zinc-500"
                />
              </label>
              <label className="text-xs text-zinc-300">
                Tile Size (px)
                <input
                  type="number"
                  min={16}
                  max={256}
                  value={draft.tileSizePx}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      tileSizePx: Math.max(16, Number.parseInt(event.target.value || "16", 10)),
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-xs text-zinc-200 outline-none focus:border-zinc-500"
                />
              </label>
              <label className="text-xs text-zinc-300 xl:col-span-2">
                Background URL
                <input
                  value={draft.referenceUrl}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, referenceUrl: event.target.value }))
                  }
                  placeholder="https://..."
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-xs text-zinc-200 outline-none focus:border-zinc-500"
                />
              </label>
              <label className="text-xs text-zinc-300 xl:col-span-1">
                Upload Background Image
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => void handleUploadBackgroundImage(event)}
                  className="mt-1 block w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 file:mr-2 file:rounded file:border-0 file:bg-zinc-800 file:px-2 file:py-1 file:text-xs file:text-zinc-100 focus:border-zinc-500"
                />
              </label>
              <label className="text-xs text-zinc-300 xl:col-span-3">
                Generate Background Prompt
                <textarea
                  value={backgroundPrompt}
                  onChange={(event) => setBackgroundPrompt(event.target.value)}
                  rows={3}
                  placeholder="Example: Narrow cobblestone alley with market stalls, crates, wagon obstacles, and lantern-lit corners at dusk."
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-xs text-zinc-200 outline-none focus:border-zinc-500"
                />
              </label>
              <label className="text-xs text-zinc-300 md:col-span-2 xl:col-span-2">
                Background Style
                <select
                  value={backgroundStyleId}
                  onChange={(event) => setBackgroundStyleId(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-xs text-zinc-200 outline-none focus:border-zinc-500"
                >
                  {BACKGROUND_STYLE_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </select>
                <div className="mt-1 text-[11px] text-zinc-500">
                  {
                    (BACKGROUND_STYLE_PRESETS.find((preset) => preset.id === backgroundStyleId)
                      ?.guidance ?? "")
                  }
                </div>
              </label>
              <div className="xl:col-span-3">
                <div className="mb-1 text-[11px] uppercase tracking-[0.12em] text-zinc-500">
                  Prompt Presets
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {backgroundPromptPresets.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => setBackgroundPrompt(preset.prompt)}
                      className="rounded-md border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-[11px] text-zinc-200 transition hover:border-zinc-500"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="xl:col-span-3">
                <div className="mb-1 text-[11px] uppercase tracking-[0.12em] text-zinc-500">
                  Custom Presets
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <input
                    value={customPresetLabel}
                    onChange={(event) => setCustomPresetLabel(event.target.value)}
                    placeholder="Preset label"
                    className="w-44 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-200 outline-none focus:border-zinc-500"
                  />
                  <button
                    type="button"
                    onClick={handleSaveCustomPromptPreset}
                    className="rounded-md border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-[11px] text-zinc-200 transition hover:border-zinc-500"
                  >
                    Save Current Prompt
                  </button>
                </div>
                {filteredCustomPromptPresets.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {filteredCustomPromptPresets.map((preset) => (
                      <div
                        key={preset.id}
                        className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-950 px-1 py-1"
                      >
                        <button
                          type="button"
                          onClick={() => setBackgroundPrompt(preset.prompt)}
                          className="rounded px-1.5 py-0.5 text-[11px] text-zinc-200 transition hover:bg-zinc-800"
                          title={preset.prompt}
                        >
                          {preset.label}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteCustomPromptPreset(preset.id)}
                          className="rounded px-1.5 py-0.5 text-[11px] text-red-300 transition hover:bg-red-500/15"
                          aria-label={`Delete preset ${preset.label}`}
                          title="Delete preset"
                        >
                          x
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-2 text-[11px] text-zinc-500">
                    No custom presets saved for this ruleset yet.
                  </div>
                )}
              </div>
              <div className="xl:col-span-3">
                <button
                  type="button"
                  onClick={() => void handleGenerateBackgroundImage()}
                  disabled={isGeneratingBackground}
                  className="rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-3 py-1.5 text-xs font-medium text-cyan-100 transition hover:border-cyan-400/70 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isGeneratingBackground ? "Generating..." : "Generate Background"}
                </button>
              </div>
              <label className="text-xs text-zinc-300 xl:col-span-3">
                Inline Image Data URL (optional)
                <textarea
                  value={draft.imageDataUrl}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, imageDataUrl: event.target.value }))
                  }
                  rows={2}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-xs text-zinc-200 outline-none focus:border-zinc-500"
                />
              </label>
              <label className="text-xs text-zinc-300 xl:col-span-3">
                Tags (comma separated)
                <input
                  value={draft.tagsText}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, tagsText: event.target.value }))
                  }
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-xs text-zinc-200 outline-none focus:border-zinc-500"
                />
              </label>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs text-zinc-400">Paint:</span>
              <button
                type="button"
                onClick={() => setPaintMode("block")}
                className={`rounded-lg border px-2.5 py-1 text-xs transition ${
                  paintMode === "block"
                    ? "border-red-400/60 bg-red-500/15 text-red-200"
                    : "border-zinc-700 bg-zinc-950 text-zinc-200 hover:border-zinc-500"
                }`}
              >
                Block
              </button>
              <button
                type="button"
                onClick={() => setPaintMode("erase-block")}
                className={`rounded-lg border px-2.5 py-1 text-xs transition ${
                  paintMode === "erase-block"
                    ? "border-emerald-400/60 bg-emerald-500/15 text-emerald-200"
                    : "border-zinc-700 bg-zinc-950 text-zinc-200 hover:border-zinc-500"
                }`}
              >
                Erase Block
              </button>
              <button
                type="button"
                onClick={() => setPaintMode("player-spawn")}
                className={`rounded-lg border px-2.5 py-1 text-xs transition ${
                  paintMode === "player-spawn"
                    ? "border-blue-400/60 bg-blue-500/15 text-blue-200"
                    : "border-zinc-700 bg-zinc-950 text-zinc-200 hover:border-zinc-500"
                }`}
              >
                Player Spawn
              </button>
              <button
                type="button"
                onClick={() => setPaintMode("erase-player-spawn")}
                className={`rounded-lg border px-2.5 py-1 text-xs transition ${
                  paintMode === "erase-player-spawn"
                    ? "border-blue-300/60 bg-blue-500/10 text-blue-100"
                    : "border-zinc-700 bg-zinc-950 text-zinc-200 hover:border-zinc-500"
                }`}
              >
                Erase Player
              </button>
              <button
                type="button"
                onClick={() => setPaintMode("enemy-spawn")}
                className={`rounded-lg border px-2.5 py-1 text-xs transition ${
                  paintMode === "enemy-spawn"
                    ? "border-amber-400/60 bg-amber-500/15 text-amber-200"
                    : "border-zinc-700 bg-zinc-950 text-zinc-200 hover:border-zinc-500"
                }`}
              >
                Enemy Spawn
              </button>
              <button
                type="button"
                onClick={() => setPaintMode("erase-enemy-spawn")}
                className={`rounded-lg border px-2.5 py-1 text-xs transition ${
                  paintMode === "erase-enemy-spawn"
                    ? "border-amber-300/60 bg-amber-500/10 text-amber-100"
                    : "border-zinc-700 bg-zinc-950 text-zinc-200 hover:border-zinc-500"
                }`}
              >
                Erase Enemy
              </button>
              <button
                type="button"
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    blockedTiles: [],
                  }))
                }
                className="rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-xs text-zinc-200 transition hover:border-zinc-500"
              >
                Clear Blocked
              </button>
              <button
                type="button"
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    playerSpawnTiles: [],
                  }))
                }
                className="rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-xs text-zinc-200 transition hover:border-zinc-500"
              >
                Clear Player Spawn
              </button>
              <button
                type="button"
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    enemySpawnTiles: [],
                  }))
                }
                className="rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-xs text-zinc-200 transition hover:border-zinc-500"
              >
                Clear Enemy Spawn
              </button>
              <span className="text-xs text-zinc-400">
                Blocked tiles: {draft.blockedTiles.length}
              </span>
              <span className="text-xs text-blue-300/90">
                Player spawns: {draft.playerSpawnTiles.length}
              </span>
              <span className="text-xs text-amber-300/90">
                Enemy spawns: {draft.enemySpawnTiles.length}
              </span>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setTokenTestMode((current) => {
                    const next = !current;
                    if (!next) {
                      setDraggingPlacedTokenId("");
                      setSelectedPlacedTokenId("");
                      setSelectedPaletteTokenId("");
                    }
                    return next;
                  });
                }}
                className={`rounded-lg border px-2.5 py-1 text-xs transition ${
                  tokenTestMode
                    ? "border-cyan-400/60 bg-cyan-500/15 text-cyan-100"
                    : "border-zinc-700 bg-zinc-950 text-zinc-200 hover:border-zinc-500"
                }`}
              >
                {tokenTestMode ? "Token Test: On" : "Token Test: Off"}
              </button>
              {tokenTestMode ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setPlacedTokens([]);
                      setSelectedPlacedTokenId("");
                    }}
                    className="rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-xs text-zinc-200 transition hover:border-zinc-500"
                  >
                    Clear Placed
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!selectedPlacedTokenId) {
                        return;
                      }
                      setPlacedTokens((current) =>
                        current.filter((token) => token.id !== selectedPlacedTokenId),
                      );
                      setSelectedPlacedTokenId("");
                    }}
                    disabled={!selectedPlacedTokenId}
                    className="rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-xs text-zinc-200 transition hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Remove Selected
                  </button>
                  <button
                    type="button"
                    onClick={() => void loadTokenLibraryPalette()}
                    disabled={tokenLibraryLoading}
                    className="rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-xs text-zinc-200 transition hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {tokenLibraryLoading ? "Loading..." : "Reload Library"}
                  </button>
                  <button
                    type="button"
                    onClick={handleAutoPlaceFromSpawns}
                    disabled={tokenLibraryLoading || tokenLibraryEntries.length === 0}
                    className="rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-xs text-zinc-200 transition hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Auto-Place from Spawns
                  </button>
                  <span className="text-xs text-zinc-400">
                    Select palette token, click tile to place, drag to move.
                  </span>
                  <label className="inline-flex items-center gap-2 text-xs text-zinc-300">
                    Token Size
                    <input
                      type="range"
                      min={40}
                      max={180}
                      step={5}
                      value={tokenScalePercent}
                      onChange={(event) =>
                        setTokenScalePercent(
                          Math.max(
                            40,
                            Math.min(180, Number.parseInt(event.target.value, 10) || 90),
                          ),
                        )
                      }
                      className="h-4 w-28 accent-cyan-400"
                    />
                    <span className="w-10 text-right text-[11px] text-zinc-400">
                      {tokenScalePercent}%
                    </span>
                  </label>
                </>
              ) : null}
            </div>

            {tokenTestMode ? (
              <div className="mt-2 rounded-lg border border-zinc-800 bg-zinc-950 p-2">
                <div className="mb-2 text-[11px] uppercase tracking-[0.12em] text-zinc-400">
                  Token Palette ({tokenLibraryEntries.length})
                </div>
                {tokenLibraryEntries.length === 0 ? (
                  <div className="text-xs text-zinc-400">
                    No token library entries for this ruleset yet. Create tokens in Token Library.
                  </div>
                ) : (
                  <div className="grid max-h-36 grid-cols-2 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-3 lg:grid-cols-4">
                    {tokenLibraryEntries.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() =>
                          setSelectedPaletteTokenId((current) =>
                            current === entry.id ? "" : entry.id,
                          )
                        }
                        className={`rounded-md border p-1 text-left transition ${
                          selectedPaletteTokenId === entry.id
                            ? "border-cyan-400/70 bg-cyan-500/10"
                            : "border-zinc-700 bg-zinc-900 hover:border-zinc-500"
                        }`}
                        title={`${entry.label} (${entry.category}${entry.subtype ? `/${entry.subtype}` : ""})`}
                      >
                        <div
                          className="mx-auto h-10 w-10 rounded border border-zinc-700 bg-cover bg-center bg-no-repeat"
                          style={{ backgroundImage: `url("${entry.imageDataUrl.replace(/"/g, '\\"')}")` }}
                        />
                        <div className="mt-1 truncate text-[10px] text-zinc-200">{entry.label}</div>
                        <div className="truncate text-[10px] text-zinc-500">
                          {entry.category}
                          {entry.subtype ? `/${entry.subtype}` : ""}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : null}

            {mapValidationIssues.length > 0 ? (
              <div className="mt-2 rounded-lg border border-amber-400/40 bg-amber-400/10 px-2.5 py-2 text-xs text-amber-100">
                <div className="font-medium">Validation notes</div>
                <ul className="mt-1 list-disc pl-4">
                  {mapValidationIssues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="mt-2 rounded-lg border border-emerald-400/40 bg-emerald-400/10 px-2.5 py-2 text-xs text-emerald-100">
                Map validation looks good.
              </div>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-xs text-zinc-400">Map Zoom</span>
              <button
                type="button"
                onClick={() => setMapZoomPercent((current) => Math.max(50, current - 10))}
                className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-200 transition hover:border-zinc-500"
              >
                -
              </button>
              <input
                type="range"
                min={50}
                max={250}
                step={10}
                value={mapZoomPercent}
                onChange={(event) =>
                  setMapZoomPercent(
                    Math.max(50, Math.min(250, Number.parseInt(event.target.value, 10) || 100)),
                  )
                }
                className="h-4 w-36 accent-cyan-400"
              />
              <button
                type="button"
                onClick={() => setMapZoomPercent((current) => Math.min(250, current + 10))}
                className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-200 transition hover:border-zinc-500"
              >
                +
              </button>
              <button
                type="button"
                onClick={() => setMapZoomPercent(100)}
                className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-200 transition hover:border-zinc-500"
              >
                Reset
              </button>
              <span className="text-xs text-zinc-400">{mapZoomPercent}%</span>
            </div>

            <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-950 p-2">
              <div className="max-h-[70vh] overflow-auto rounded-lg border border-zinc-800">
                <div
                  className="mx-auto"
                  style={{
                    width: `${Math.max(280, Math.round((780 * mapZoomPercent) / 100))}px`,
                  }}
                >
                  <div
                    className="relative w-full overflow-hidden"
                    style={{
                      aspectRatio: `${draft.gridCols} / ${draft.gridRows}`,
                      backgroundImage: (draft.imageDataUrl || draft.referenceUrl).trim()
                        ? `url("${(draft.imageDataUrl || draft.referenceUrl).replace(/"/g, '\\"')}")`
                        : undefined,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                      userSelect: "none",
                    }}
                  >
                    <div
                      className="grid h-full w-full"
                      style={{
                        gridTemplateColumns: `repeat(${draft.gridCols}, minmax(0, 1fr))`,
                        gridTemplateRows: `repeat(${draft.gridRows}, minmax(0, 1fr))`,
                      }}
                    >
                  {gridCells.map((cell) => {
                    const blocked = blockedSet.has(cell.key);
                    const isPlayerSpawn = playerSpawnSet.has(cell.key);
                    const isEnemySpawn = enemySpawnSet.has(cell.key);
                    const tokenInCell = placedTokenByCell.get(cell.key) ?? null;
                    const tileClass = blocked
                      ? "bg-red-500/35 hover:bg-red-500/45"
                      : isPlayerSpawn && isEnemySpawn
                        ? "bg-violet-500/25 hover:bg-violet-500/35"
                        : isPlayerSpawn
                          ? "bg-blue-500/20 hover:bg-blue-500/30"
                          : isEnemySpawn
                            ? "bg-amber-500/20 hover:bg-amber-500/30"
                            : "bg-black/10 hover:bg-black/20";
                    const tileState: string[] = [];
                    if (blocked) {
                      tileState.push("blocked");
                    }
                    if (isPlayerSpawn) {
                      tileState.push("player spawn");
                    }
                    if (isEnemySpawn) {
                      tileState.push("enemy spawn");
                    }
                    return (
                      <button
                        key={cell.key}
                        type="button"
                        onMouseDown={() => {
                          if (tokenTestMode) {
                            if (selectedPaletteTokenId) {
                              placeTokenFromPalette(selectedPaletteTokenId, cell.x, cell.y);
                              return;
                            }
                            if (selectedPlacedTokenId) {
                              moveTokenToCell(selectedPlacedTokenId, cell.x, cell.y);
                            }
                            return;
                          }
                          setIsPainting(true);
                          applyPaint(cell.x, cell.y);
                        }}
                        onMouseEnter={() => {
                          if (tokenTestMode) {
                            return;
                          }
                          if (isPainting) {
                            applyPaint(cell.x, cell.y);
                          }
                        }}
                        onDragOver={(event) => {
                          if (!tokenTestMode) {
                            return;
                          }
                          event.preventDefault();
                        }}
                        onDrop={(event) => {
                          if (!tokenTestMode) {
                            return;
                          }
                          event.preventDefault();
                          const tokenId =
                            event.dataTransfer.getData("text/plain") || draggingPlacedTokenId;
                          moveTokenToCell(tokenId, cell.x, cell.y);
                          setDraggingPlacedTokenId("");
                        }}
                        className={`border border-zinc-800/70 transition ${tileClass}`}
                        title={`${cell.x}, ${cell.y}${tileState.length > 0 ? ` (${tileState.join(", ")})` : ""}`}
                        aria-label={`Tile ${cell.x},${cell.y}`}
                      >
                        {tokenInCell ? (
                          <span
                            role="button"
                            tabIndex={0}
                            draggable={tokenTestMode}
                            onDragStart={(event) => {
                              event.dataTransfer.setData("text/plain", tokenInCell.id);
                              setDraggingPlacedTokenId(tokenInCell.id);
                              setSelectedPlacedTokenId(tokenInCell.id);
                            }}
                            onDragEnd={() => setDraggingPlacedTokenId("")}
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedPlacedTokenId(tokenInCell.id);
                            }}
                            className={`mx-auto inline-flex h-full w-full items-center justify-center ${
                              selectedPlacedTokenId === tokenInCell.id
                                ? "ring-2 ring-cyan-300/80"
                                : "ring-1 ring-black/40"
                            }`}
                            title={tokenInCell.label}
                          >
                            <span
                              className="rounded bg-cover bg-center bg-no-repeat"
                              style={{
                                width: `${tokenScalePercent}%`,
                                height: `${tokenScalePercent}%`,
                                backgroundImage: `url("${tokenInCell.imageDataUrl.replace(/"/g, '\\"')}")`,
                              }}
                            />
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving}
                className="rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-200 transition hover:border-emerald-400/70 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? "Saving..." : draft.id ? "Save Template" : "Create Template"}
              </button>
              <button
                type="button"
                onClick={() => void handleDuplicate()}
                disabled={saving}
                className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-200 transition hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Duplicate Draft
              </button>
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={saving || !draft.id}
                className="rounded-lg border border-red-500/40 bg-red-500/15 px-3 py-1.5 text-xs text-red-200 transition hover:border-red-400/70 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Delete Template
              </button>
            </div>

            {errorMessage ? (
              <div className="mt-2 rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-2 text-xs text-red-200">
                {errorMessage}
              </div>
            ) : null}
            {successMessage ? (
              <div className="mt-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-2 text-xs text-emerald-200">
                {successMessage}
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </main>
  );
}

