export type BattleGridPreset = {
  cols: number;
  rows: number;
  label: string;
};

export const BATTLE_GRID_PRESETS: BattleGridPreset[] = [
  { cols: 12, rows: 10, label: "12x10" },
  { cols: 12, rows: 12, label: "12x12" },
  { cols: 16, rows: 12, label: "16x12" },
  { cols: 20, rows: 12, label: "20x12" },
  { cols: 16, rows: 16, label: "16x16" },
  { cols: 20, rows: 20, label: "20x20" },
  { cols: 30, rows: 30, label: "30x30" },
];

export const DEFAULT_BATTLE_GRID_PRESET: BattleGridPreset = BATTLE_GRID_PRESETS[1];
export const DEFAULT_BATTLE_TILE_SIZE_PX = 64;
