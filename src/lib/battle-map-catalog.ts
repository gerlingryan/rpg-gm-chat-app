export type BattleLocationCatalogEntry = {
  key: string;
  label: string;
};

export const BATTLE_LOCATION_CATALOG_BY_RULESET: Record<
  string,
  BattleLocationCatalogEntry[]
> = {
  "d&d 5e": [
    { key: "city_street", label: "City Street" },
    { key: "tavern", label: "Tavern" },
    { key: "forest_path", label: "Forest Path" },
    { key: "cave", label: "Cave" },
    { key: "graveyard", label: "Graveyard" },
    { key: "crypt", label: "Crypt" },
    { key: "sewer", label: "Sewer" },
    { key: "ruins", label: "Ruins" },
  ],
  "deadlands classic": [
    { key: "dusty_main_street", label: "Dusty Main Street" },
    { key: "saloon", label: "Saloon" },
    { key: "rail_yard", label: "Rail Yard" },
    { key: "canyon", label: "Canyon" },
    { key: "graveyard", label: "Graveyard" },
    { key: "mine", label: "Mine" },
    { key: "ranch", label: "Ranch" },
  ],
  "savage rifts": [
    { key: "ruined_city", label: "Ruined City" },
    { key: "outpost", label: "Outpost" },
    { key: "badlands", label: "Badlands" },
    { key: "bunker", label: "Bunker" },
    { key: "scrapyard", label: "Scrapyard" },
    { key: "ley_line_site", label: "Ley Line Site" },
  ],
};

const FALLBACK_BATTLE_LOCATIONS: BattleLocationCatalogEntry[] = [
  { key: "city_street", label: "City Street" },
  { key: "forest_path", label: "Forest Path" },
  { key: "cave", label: "Cave" },
];

function normalizeRulesetKey(ruleset: string) {
  return ruleset.trim().toLowerCase();
}

export function getBattleLocationCatalogForRuleset(ruleset: string) {
  const normalized = normalizeRulesetKey(ruleset);
  return BATTLE_LOCATION_CATALOG_BY_RULESET[normalized] ?? FALLBACK_BATTLE_LOCATIONS;
}
