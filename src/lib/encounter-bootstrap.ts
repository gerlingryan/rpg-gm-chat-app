export type EncounterDifficultyMode = "cinematic" | "standard" | "deadly";
export type EncounterVariance = "low" | "medium" | "high";
export type EncounterTemplateTier = "minion" | "standard" | "elite" | "boss";
export type EncounterIntent = "easy" | "standard" | "hard";

export type EncounterCombatGenerationConfig = {
  difficultyMode: EncounterDifficultyMode;
  encounterIntent: EncounterIntent;
  encounterVariance: EncounterVariance;
  minOpponents: number;
  maxOpponents: number;
  partyResourceWeight: number;
  clockPressureWeight: number;
};

export type EncounterEnemyTemplate = {
  id: string;
  name: string;
  faction: string;
  roles: string[];
  tier: EncounterTemplateTier;
  threat: number;
  levelBand: {
    min: number;
    max: number;
  };
  tags: string[];
};

export type EncounterTableEntry = {
  id: string;
  contextTag: string;
  faction: string;
  levelBand: {
    min: number;
    max: number;
  };
  baseBudget: number;
  templateIds: string[];
  notes: string;
};

export type EncounterNpcSeed = {
  id: string;
  name: string;
  role: string;
  faction: string;
  motivation: string;
  likelyContexts: string[];
};

export type EncounterQuestlineSeed = {
  id: string;
  title: string;
  faction: string;
  threat: "low" | "medium" | "high";
  hook: string;
  likelyOppositionTags: string[];
};

export type WorldRosterPack = {
  generatedAt: string;
  enemyTemplates: EncounterEnemyTemplate[];
  encounterTables: EncounterTableEntry[];
  npcSeeds: EncounterNpcSeed[];
  questlineSeeds: EncounterQuestlineSeed[];
};

export type EncounterBootstrapPayload = {
  combatGeneration: EncounterCombatGenerationConfig;
  worldRoster: WorldRosterPack;
};

function normalizeRulesetKey(value: string) {
  return value.trim().toLowerCase();
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asStringList(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function asInt(value: unknown, fallback: number, min = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(min, Math.trunc(value));
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed)) {
      return Math.max(min, parsed);
    }
  }
  return Math.max(min, Math.trunc(fallback));
}

function asFloat(value: unknown, fallback: number, min = 0, max = 1) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(min, Math.min(max, value));
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(min, Math.min(max, parsed));
    }
  }
  return Math.max(min, Math.min(max, fallback));
}

function normalizeDifficultyMode(
  value: unknown,
  fallback: EncounterDifficultyMode,
): EncounterDifficultyMode {
  const text = asString(value).toLowerCase();
  if (text === "cinematic" || text === "standard" || text === "deadly") {
    return text;
  }
  return fallback;
}

function normalizeEncounterVariance(
  value: unknown,
  fallback: EncounterVariance,
): EncounterVariance {
  const text = asString(value).toLowerCase();
  if (text === "low" || text === "medium" || text === "high") {
    return text;
  }
  return fallback;
}

function normalizeEncounterIntent(
  value: unknown,
  fallback: EncounterIntent,
): EncounterIntent {
  const text = asString(value).toLowerCase();
  if (text === "easy" || text === "standard" || text === "hard") {
    return text;
  }
  return fallback;
}

function normalizeTier(
  value: unknown,
  fallback: EncounterTemplateTier,
): EncounterTemplateTier {
  const text = asString(value).toLowerCase();
  if (text === "minion" || text === "standard" || text === "elite" || text === "boss") {
    return text;
  }
  return fallback;
}

function buildDndTemplates(theme: string): EncounterEnemyTemplate[] {
  const shadowTag = theme.toLowerCase().includes("mystery") ? "investigation" : "frontier";
  return [
    {
      id: "dnd_bandit_skirmisher",
      name: "Bandit Skirmisher",
      faction: "Outlaws",
      roles: ["frontline"],
      tier: "minion",
      threat: 12,
      levelBand: { min: 1, max: 4 },
      tags: ["humanoid", "road", shadowTag],
    },
    {
      id: "dnd_bandit_archer",
      name: "Bandit Archer",
      faction: "Outlaws",
      roles: ["ranged"],
      tier: "standard",
      threat: 16,
      levelBand: { min: 1, max: 6 },
      tags: ["humanoid", "road", "ambush"],
    },
    {
      id: "dnd_wolf_pack",
      name: "Wolf Pack Hunter",
      faction: "Wilds",
      roles: ["skirmisher"],
      tier: "standard",
      threat: 18,
      levelBand: { min: 1, max: 8 },
      tags: ["beast", "forest", "night"],
    },
    {
      id: "dnd_cult_acolyte",
      name: "Cult Acolyte",
      faction: "Ashen Hand",
      roles: ["controller"],
      tier: "standard",
      threat: 22,
      levelBand: { min: 2, max: 9 },
      tags: ["caster", "ritual", shadowTag],
    },
    {
      id: "dnd_veteran_enforcer",
      name: "Veteran Enforcer",
      faction: "Ashen Hand",
      roles: ["frontline", "leader"],
      tier: "elite",
      threat: 35,
      levelBand: { min: 3, max: 12 },
      tags: ["humanoid", "armored"],
    },
    {
      id: "dnd_arc_captain",
      name: "Arc Captain",
      faction: "Ashen Hand",
      roles: ["leader", "controller"],
      tier: "boss",
      threat: 55,
      levelBand: { min: 5, max: 20 },
      tags: ["boss", "caster"],
    },
  ];
}

function buildDeadlandsTemplates(theme: string): EncounterEnemyTemplate[] {
  const occultTag = theme.toLowerCase().includes("horror") ? "fear" : "frontier";
  return [
    {
      id: "dlc_ruffian",
      name: "Street Ruffian",
      faction: "Local Gang",
      roles: ["frontline"],
      tier: "minion",
      threat: 12,
      levelBand: { min: 1, max: 4 },
      tags: ["gunfight", "town", occultTag],
    },
    {
      id: "dlc_bandit_shooter",
      name: "Bandit Shooter",
      faction: "Red Jack Gang",
      roles: ["ranged"],
      tier: "standard",
      threat: 18,
      levelBand: { min: 1, max: 7 },
      tags: ["gunfight", "ambush"],
    },
    {
      id: "dlc_huckster_hench",
      name: "Hex-Slinging Henchman",
      faction: "Occult Syndicate",
      roles: ["controller"],
      tier: "standard",
      threat: 24,
      levelBand: { min: 2, max: 10 },
      tags: ["arcane", "occult"],
    },
    {
      id: "dlc_deputy_turncoat",
      name: "Turncoat Deputy",
      faction: "Corrupt Law",
      roles: ["leader", "ranged"],
      tier: "elite",
      threat: 34,
      levelBand: { min: 3, max: 12 },
      tags: ["town", "law", "boss-lieutenant"],
    },
    {
      id: "dlc_harrowed_revenant",
      name: "Harrowed Revenant",
      faction: "Harrowed",
      roles: ["frontline", "fear"],
      tier: "elite",
      threat: 40,
      levelBand: { min: 4, max: 14 },
      tags: ["undead", "fear", "night"],
    },
    {
      id: "dlc_warlord",
      name: "Ghost Rock Warlord",
      faction: "Occult Syndicate",
      roles: ["leader", "boss"],
      tier: "boss",
      threat: 60,
      levelBand: { min: 5, max: 20 },
      tags: ["boss", "town", "showdown"],
    },
  ];
}

function buildSavageRiftsTemplates(theme: string): EncounterEnemyTemplate[] {
  const warTag = theme.toLowerCase().includes("war") ? "warfront" : "frontier";
  return [
    {
      id: "sr_bandit_raider",
      name: "Bandit Raider",
      faction: "Waste Raiders",
      roles: ["frontline"],
      tier: "minion",
      threat: 14,
      levelBand: { min: 1, max: 5 },
      tags: ["wasteland", warTag],
    },
    {
      id: "sr_cs_grunt",
      name: "Coalition Grunt",
      faction: "Coalition",
      roles: ["ranged"],
      tier: "standard",
      threat: 20,
      levelBand: { min: 1, max: 8 },
      tags: ["military", "patrol"],
    },
    {
      id: "sr_tech_hunter",
      name: "Tech Hunter",
      faction: "Mercenary",
      roles: ["skirmisher"],
      tier: "standard",
      threat: 24,
      levelBand: { min: 2, max: 10 },
      tags: ["salvage", "ambush"],
    },
    {
      id: "sr_psionic_enforcer",
      name: "Psionic Enforcer",
      faction: "Coalition",
      roles: ["controller"],
      tier: "elite",
      threat: 36,
      levelBand: { min: 3, max: 12 },
      tags: ["psionic", "military"],
    },
    {
      id: "sr_juicer",
      name: "Juicer Shock Trooper",
      faction: "Mercenary",
      roles: ["frontline", "leader"],
      tier: "elite",
      threat: 42,
      levelBand: { min: 4, max: 14 },
      tags: ["shock", "raid"],
    },
    {
      id: "sr_rift_boss",
      name: "Rift Marshal",
      faction: "Unknown Patron",
      roles: ["leader", "boss"],
      tier: "boss",
      threat: 65,
      levelBand: { min: 6, max: 20 },
      tags: ["boss", "rift", "arcane-tech"],
    },
  ];
}

function buildEncounterTables(
  ruleset: string,
  templates: EncounterEnemyTemplate[],
): EncounterTableEntry[] {
  const factionPrimary = templates[0]?.faction || "Unknown";
  const factionSecondary = templates[3]?.faction || factionPrimary;
  const ids = (tier: EncounterTemplateTier) =>
    templates.filter((entry) => entry.tier === tier).map((entry) => entry.id);

  return [
    {
      id: "ET_ROAD_SKIRMISH",
      contextTag: "road",
      faction: factionPrimary,
      levelBand: { min: 1, max: 6 },
      baseBudget: 70,
      templateIds: [...ids("minion"), ...ids("standard")].slice(0, 4),
      notes: `${ruleset} roadside pressure encounter.`,
    },
    {
      id: "ET_TOWN_ESCALATION",
      contextTag: "town",
      faction: factionPrimary,
      levelBand: { min: 1, max: 10 },
      baseBudget: 90,
      templateIds: [...ids("standard"), ...ids("elite")].slice(0, 4),
      notes: "Urban confrontation with mixed opposition.",
    },
    {
      id: "ET_HIDEOUT_ASSAULT",
      contextTag: "hideout",
      faction: factionSecondary,
      levelBand: { min: 3, max: 14 },
      baseBudget: 120,
      templateIds: [...ids("standard"), ...ids("elite")].slice(0, 5),
      notes: "Prepared defenders and tactical terrain.",
    },
    {
      id: "ET_BOSS_SHOWDOWN",
      contextTag: "showdown",
      faction: factionSecondary,
      levelBand: { min: 5, max: 20 },
      baseBudget: 170,
      templateIds: [...ids("elite"), ...ids("boss")].slice(0, 4),
      notes: "High-stakes climax encounter.",
    },
  ];
}

function buildNpcSeeds(ruleset: string): EncounterNpcSeed[] {
  return [
    {
      id: "NS_FIXER",
      name: "Local Fixer",
      role: "broker",
      faction: "Neutral",
      motivation: "Profit and leverage.",
      likelyContexts: ["town", "tavern", "market"],
    },
    {
      id: "NS_SCOUT",
      name: `${ruleset} Scout`,
      role: "scout",
      faction: "Regional Cell",
      motivation: "Track rival movements and avoid direct battles.",
      likelyContexts: ["road", "forest", "outskirts"],
    },
    {
      id: "NS_CAPTAIN",
      name: "Field Captain",
      role: "commander",
      faction: "Primary Opposition",
      motivation: "Enforce control and isolate the party.",
      likelyContexts: ["town", "hideout", "checkpoint"],
    },
  ];
}

function buildQuestlineSeeds(theme: string): EncounterQuestlineSeed[] {
  return [
    {
      id: "QS_MAIN",
      title: "Break the First Ring",
      faction: "Primary Opposition",
      threat: "medium",
      hook: "Follow early leads to identify command structure.",
      likelyOppositionTags: ["road", "town", "hideout"],
    },
    {
      id: "QS_SIDE",
      title: "Quiet Favors",
      faction: "Neutral Brokers",
      threat: "low",
      hook: `Turn ${theme} rumors into allies before they go cold.`,
      likelyOppositionTags: ["town", "market", "ambush"],
    },
    {
      id: "QS_PRESSURE",
      title: "Clockwork Response",
      faction: "Primary Opposition",
      threat: "high",
      hook: "Disrupt reinforcement routes before a crackdown begins.",
      likelyOppositionTags: ["road", "showdown", "checkpoint"],
    },
  ];
}

export function buildInitialEncounterBootstrap(params: {
  ruleset: string;
  theme: string;
  tone: string;
  scope: string;
  startingHook: string;
}): EncounterBootstrapPayload {
  const rulesetKey = normalizeRulesetKey(params.ruleset);
  const enemyTemplates =
    rulesetKey === "deadlands classic"
      ? buildDeadlandsTemplates(params.theme)
      : rulesetKey === "savage rifts"
        ? buildSavageRiftsTemplates(params.theme)
        : buildDndTemplates(params.theme);
  const encounterTables = buildEncounterTables(params.ruleset, enemyTemplates);
  const npcSeeds = buildNpcSeeds(params.ruleset);
  const questlineSeeds = buildQuestlineSeeds(params.theme);

  return {
    combatGeneration: {
      difficultyMode: "standard",
      encounterIntent: "standard",
      encounterVariance:
        params.tone.toLowerCase().includes("horror") || params.scope.toLowerCase() === "global"
          ? "high"
          : "medium",
      minOpponents: 1,
      maxOpponents: 6,
      partyResourceWeight: 0.35,
      clockPressureWeight: params.startingHook.toLowerCase().includes("disaster")
        ? 0.3
        : 0.2,
    },
    worldRoster: {
      generatedAt: new Date().toISOString(),
      enemyTemplates,
      encounterTables,
      npcSeeds,
      questlineSeeds,
    },
  };
}

function normalizeEnemyTemplate(
  value: unknown,
  index: number,
): EncounterEnemyTemplate | null {
  const typed = asObject(value);
  if (!typed) {
    return null;
  }
  const id = asString(typed.id) || `ETMPL_${index + 1}`;
  const name = asString(typed.name);
  const faction = asString(typed.faction);
  if (!name || !faction) {
    return null;
  }
  const levelBandValue = asObject(typed.levelBand);
  const min = asInt(levelBandValue?.min, 1, 1);
  const max = Math.max(min, asInt(levelBandValue?.max, min, min));
  return {
    id,
    name,
    faction,
    roles: asStringList(typed.roles),
    tier: normalizeTier(typed.tier, "standard"),
    threat: asInt(typed.threat, 10, 1),
    levelBand: { min, max },
    tags: asStringList(typed.tags),
  };
}

function normalizeEncounterTableEntry(
  value: unknown,
  index: number,
): EncounterTableEntry | null {
  const typed = asObject(value);
  if (!typed) {
    return null;
  }
  const id = asString(typed.id) || `ET_${index + 1}`;
  const contextTag = asString(typed.contextTag);
  const faction = asString(typed.faction);
  if (!contextTag || !faction) {
    return null;
  }
  const levelBandValue = asObject(typed.levelBand);
  const min = asInt(levelBandValue?.min, 1, 1);
  const max = Math.max(min, asInt(levelBandValue?.max, min, min));
  return {
    id,
    contextTag,
    faction,
    levelBand: { min, max },
    baseBudget: asInt(typed.baseBudget, 80, 1),
    templateIds: asStringList(typed.templateIds),
    notes: asString(typed.notes),
  };
}

function normalizeNpcSeed(value: unknown, index: number): EncounterNpcSeed | null {
  const typed = asObject(value);
  if (!typed) {
    return null;
  }
  const id = asString(typed.id) || `NS_${index + 1}`;
  const name = asString(typed.name);
  if (!name) {
    return null;
  }
  return {
    id,
    name,
    role: asString(typed.role),
    faction: asString(typed.faction),
    motivation: asString(typed.motivation),
    likelyContexts: asStringList(typed.likelyContexts),
  };
}

function normalizeQuestlineSeed(
  value: unknown,
  index: number,
): EncounterQuestlineSeed | null {
  const typed = asObject(value);
  if (!typed) {
    return null;
  }
  const id = asString(typed.id) || `QS_${index + 1}`;
  const title = asString(typed.title);
  const faction = asString(typed.faction);
  if (!title || !faction) {
    return null;
  }
  const threatRaw = asString(typed.threat).toLowerCase();
  const threat =
    threatRaw === "low" || threatRaw === "high" ? threatRaw : "medium";
  return {
    id,
    title,
    faction,
    threat,
    hook: asString(typed.hook),
    likelyOppositionTags: asStringList(typed.likelyOppositionTags),
  };
}

export function normalizeEncounterBootstrap(
  value: unknown,
  fallback: EncounterBootstrapPayload,
): EncounterBootstrapPayload {
  const typed = asObject(value);
  if (!typed) {
    return fallback;
  }

  const combatValue = asObject(typed.combatGeneration);
  const worldValue = asObject(typed.worldRoster);
  const normalizedEnemyTemplates = Array.isArray(worldValue?.enemyTemplates)
    ? worldValue?.enemyTemplates
        .map((entry, index) => normalizeEnemyTemplate(entry, index))
        .filter((entry): entry is EncounterEnemyTemplate => Boolean(entry))
    : fallback.worldRoster.enemyTemplates;
  const normalizedEncounterTables = Array.isArray(worldValue?.encounterTables)
    ? worldValue?.encounterTables
        .map((entry, index) => normalizeEncounterTableEntry(entry, index))
        .filter((entry): entry is EncounterTableEntry => Boolean(entry))
    : fallback.worldRoster.encounterTables;

  return {
    combatGeneration: {
      difficultyMode: normalizeDifficultyMode(
        combatValue?.difficultyMode,
        fallback.combatGeneration.difficultyMode,
      ),
      encounterIntent: normalizeEncounterIntent(
        combatValue?.encounterIntent,
        fallback.combatGeneration.encounterIntent,
      ),
      encounterVariance: normalizeEncounterVariance(
        combatValue?.encounterVariance,
        fallback.combatGeneration.encounterVariance,
      ),
      minOpponents: asInt(
        combatValue?.minOpponents,
        fallback.combatGeneration.minOpponents,
        1,
      ),
      maxOpponents: Math.max(
        asInt(combatValue?.minOpponents, fallback.combatGeneration.minOpponents, 1),
        asInt(combatValue?.maxOpponents, fallback.combatGeneration.maxOpponents, 1),
      ),
      partyResourceWeight: asFloat(
        combatValue?.partyResourceWeight,
        fallback.combatGeneration.partyResourceWeight,
        0,
        1,
      ),
      clockPressureWeight: asFloat(
        combatValue?.clockPressureWeight,
        fallback.combatGeneration.clockPressureWeight,
        0,
        1,
      ),
    },
    worldRoster: {
      generatedAt:
        asString(worldValue?.generatedAt) || fallback.worldRoster.generatedAt,
      enemyTemplates:
        normalizedEnemyTemplates.length > 0
          ? normalizedEnemyTemplates
          : fallback.worldRoster.enemyTemplates,
      encounterTables:
        normalizedEncounterTables.length > 0
          ? normalizedEncounterTables
          : fallback.worldRoster.encounterTables,
      npcSeeds: Array.isArray(worldValue?.npcSeeds)
        ? worldValue?.npcSeeds
            .map((entry, index) => normalizeNpcSeed(entry, index))
            .filter((entry): entry is EncounterNpcSeed => Boolean(entry))
        : fallback.worldRoster.npcSeeds,
      questlineSeeds: Array.isArray(worldValue?.questlineSeeds)
        ? worldValue?.questlineSeeds
            .map((entry, index) => normalizeQuestlineSeed(entry, index))
            .filter((entry): entry is EncounterQuestlineSeed => Boolean(entry))
        : fallback.worldRoster.questlineSeeds,
    },
  };
}
