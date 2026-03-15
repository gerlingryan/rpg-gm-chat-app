import type { CombatStatusDuration } from "@/lib/combat";
import type { CampaignBootstrap } from "@/lib/campaign-bootstrap";

export type EncounterStartCombatantSeed = {
  id?: string;
  name: string;
  type: "character" | "enemy" | "npc";
  creatureSlug?: string;
  creatureSize?: string;
  summary?: string;
  hp?: string;
  statusEffects?: string[];
  statusDurations?: CombatStatusDuration[];
  initiativeModifier?: number;
};

type EncounterResolverCharacter = {
  id: string;
  name: string;
  sheetJson: Record<string, unknown> | null;
};

type EncounterResolverInput = {
  ruleset: string;
  adapterProfile: "dnd" | "deadlands" | "generic";
  bootstrap: CampaignBootstrap;
  combatants: EncounterStartCombatantSeed[];
  characters: EncounterResolverCharacter[];
  seedInput: string;
};

export type EncounterResolutionDebug = {
  partySize: number;
  averageLevel: number;
  averageResourceRatio: number;
  difficultyMode: string;
  encounterIntent: string;
  variance: string;
  enemyCountExisting: number;
  enemyCountTarget: number;
  enemyCountAdded: number;
  enemyCountTrimmed: number;
  templatePoolSize: number;
  usedTemplates: string[];
};

export type EncounterResolverOutput = {
  combatants: EncounterStartCombatantSeed[];
  debug: EncounterResolutionDebug;
};

function stableHash32(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createDeterministicRng(seed: string) {
  let state = stableHash32(seed) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0xffffffff;
  };
}

function asObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseOptionalNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeRulesetKey(value: string) {
  return value.trim().toLowerCase();
}

function isDeadlandsRuleset(value: string) {
  return normalizeRulesetKey(value).includes("deadlands");
}

function isSavageRiftsRuleset(value: string) {
  const normalized = normalizeRulesetKey(value);
  return normalized.includes("savage rifts") || normalized.includes("rifts");
}

function isNumericHpString(value: string | undefined) {
  if (!value) {
    return false;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  if (/^\d+\s*\/\s*\d+$/i.test(trimmed)) {
    return true;
  }
  if (/^\d+$/i.test(trimmed)) {
    return true;
  }
  return false;
}

function parseHpRatio(sheet: Record<string, unknown> | null) {
  const typedSheet = asObject(sheet);
  if (!typedSheet) {
    return 1;
  }

  const hp = asObject(typedSheet.hp);
  if (hp) {
    const current = parseOptionalNumber(hp.current);
    const max = parseOptionalNumber(hp.max);
    if (current !== undefined && max !== undefined && max > 0) {
      return clamp(current / max, 0, 1);
    }
  }

  const wind = asObject(typedSheet.wind);
  if (wind) {
    const current = parseOptionalNumber(wind.current);
    const max = parseOptionalNumber(wind.max);
    if (current !== undefined && max !== undefined && max > 0) {
      return clamp(current / max, 0, 1);
    }
  }

  return 1;
}

function parseLevel(sheet: Record<string, unknown> | null) {
  const typedSheet = asObject(sheet);
  if (!typedSheet) {
    return 1;
  }
  const directLevel = parseOptionalNumber(typedSheet.level);
  if (directLevel !== undefined) {
    return Math.max(1, Math.trunc(directLevel));
  }
  const nestedStats = asObject(typedSheet.stats);
  const nestedLevel = parseOptionalNumber(nestedStats?.level);
  if (nestedLevel !== undefined) {
    return Math.max(1, Math.trunc(nestedLevel));
  }
  return 1;
}

function getTierInitiativeModifier(tier: string, adapterProfile: "dnd" | "deadlands" | "generic") {
  const base =
    tier === "boss" ? 4 : tier === "elite" ? 3 : tier === "standard" ? 2 : 1;
  if (adapterProfile === "deadlands") {
    return Math.max(1, base);
  }
  if (adapterProfile === "dnd") {
    return Math.max(0, base - 1);
  }
  return base;
}

function buildEnemyHpString(params: {
  threat: number;
  difficultyMode: string;
  adapterProfile: "dnd" | "deadlands" | "generic";
  ruleset: string;
  averageLevel: number;
}) {
  const multiplier =
    params.difficultyMode === "deadly"
      ? 1.25
      : params.difficultyMode === "cinematic"
        ? 0.85
        : 1;
  const scaled = Math.max(4, Math.round(params.threat * multiplier));
  if (isDeadlandsRuleset(params.ruleset) || params.adapterProfile === "deadlands") {
    const wind = clamp(Math.round(5 + scaled * 0.25), 5, 20);
    return `${wind}/${wind}`;
  }
  if (params.adapterProfile === "dnd") {
    // Keep level 1-2 encounters from generating over-tanky enemies.
    const levelFactor = clamp(0.7 + params.averageLevel * 0.08, 0.75, 2.2);
    const hp = clamp(Math.round((4 + scaled * 0.55) * levelFactor), 4, 180);
    return `${hp}/${hp}`;
  }
  if (isSavageRiftsRuleset(params.ruleset)) {
    const levelFactor = clamp(0.8 + params.averageLevel * 0.09, 0.9, 2.6);
    const hp = clamp(Math.round((8 + scaled * 0.8) * levelFactor), 8, 260);
    return `${hp}/${hp}`;
  }
  const generic = clamp(Math.round(6 + scaled), 6, 120);
  return `${generic}/${generic}`;
}

function normalizeNameKey(value: string) {
  return value.trim().toLowerCase();
}

function stripEnemySerialSuffix(value: string) {
  return value.trim().replace(/\s*(?:#\s*)?\d+$/i, "").trim();
}

function deriveCreatureSlugCandidate(value: string) {
  return stripEnemySerialSuffix(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function findTemplateForEnemySeed(
  templates: CampaignBootstrap["world_roster"]["enemyTemplates"],
  seed: EncounterStartCombatantSeed,
) {
  const enemyName = normalizeNameKey(stripEnemySerialSuffix(seed.name));
  const enemySlug = normalizeNameKey(seed.creatureSlug ?? "");
  return (
    templates.find((template) => {
      const templateName = normalizeNameKey(template.name);
      const templateSlug = normalizeNameKey(deriveCreatureSlugCandidate(template.name));
      if (enemySlug && (enemySlug === templateSlug || enemySlug.endsWith(`_${templateSlug}`))) {
        return true;
      }
      if (!enemyName) {
        return false;
      }
      return enemyName.includes(templateName) || templateName.includes(enemyName);
    }) ?? null
  );
}

function isPriorityEnemyName(name: string) {
  const normalized = normalizeNameKey(name);
  return /(lieutenant|captain|boss|leader|chief|warlord|marshal)/.test(normalized);
}

function inferEncounterContextTag(startingScene: string) {
  const text = normalizeNameKey(startingScene);
  if (/(grave|graveyard|cemetery|crypt|tomb|catacomb)/.test(text)) {
    return "hideout";
  }
  if (/(forest|woods|trail|path|road|clearing)/.test(text)) {
    return "road";
  }
  if (/(city|street|town|market|district|tavern|saloon)/.test(text)) {
    return "town";
  }
  if (/(ruin|sewer|cave|mine|hideout)/.test(text)) {
    return "hideout";
  }
  return "road";
}

function pickEncounterTable(
  bootstrap: CampaignBootstrap,
  averageLevel: number,
) {
  const contextTag = inferEncounterContextTag(bootstrap.campaign.starting_scene);
  const candidates = bootstrap.world_roster.encounterTables.filter(
    (entry) =>
      averageLevel >= entry.levelBand.min - 1 &&
      averageLevel <= entry.levelBand.max + 1,
  );
  const contextMatch = candidates.find(
    (entry) => normalizeNameKey(entry.contextTag) === contextTag,
  );
  return contextMatch ?? candidates[0] ?? null;
}

export function resolveEncounterStart(input: EncounterResolverInput): EncounterResolverOutput {
  const characters = input.characters;
  const partySize = Math.max(1, characters.length);
  const averageLevel =
    characters.length > 0
      ? characters.reduce((sum, character) => sum + parseLevel(character.sheetJson), 0) /
        characters.length
      : 1;
  const averageResourceRatio =
    characters.length > 0
      ? characters.reduce((sum, character) => sum + parseHpRatio(character.sheetJson), 0) /
        characters.length
      : 1;

  const config = input.bootstrap.combat_generation;
  const templates = input.bootstrap.world_roster.enemyTemplates.filter(
    (template) =>
      averageLevel >= template.levelBand.min - 1 &&
      averageLevel <= template.levelBand.max + 2,
  );
  const templatePool = templates.length > 0 ? templates : input.bootstrap.world_roster.enemyTemplates;
  const encounterTable = pickEncounterTable(input.bootstrap, averageLevel);
  const tableTemplateIds = new Set(encounterTable?.templateIds ?? []);
  const tableTemplatePool = templatePool.filter((entry) => tableTemplateIds.has(entry.id));
  const effectiveTemplatePool =
    tableTemplatePool.length > 0 ? tableTemplatePool : templatePool;
  const rng = createDeterministicRng(input.seedInput);

  const existingEnemies = input.combatants.filter((entry) => entry.type === "enemy");
  const enemyNameSet = new Set(input.combatants.map((entry) => normalizeNameKey(entry.name)));
  const difficultyMultiplier =
    config.difficultyMode === "deadly" ? 1.25 : config.difficultyMode === "cinematic" ? 0.8 : 1;
  const intentCountMultiplier =
    config.encounterIntent === "easy" ? 0.85 : config.encounterIntent === "hard" ? 1.2 : 1;
  const rulesetDensityFactor = isDeadlandsRuleset(input.ruleset)
    ? averageLevel <= 2
      ? 0.6
      : averageLevel <= 4
        ? 0.75
        : 0.9
    : isSavageRiftsRuleset(input.ruleset)
      ? averageLevel <= 2
        ? 0.7
        : averageLevel <= 5
          ? 0.85
          : 1
      : averageLevel <= 2
        ? 0.75
        : averageLevel <= 4
          ? 0.9
          : 1;
  const levelBonus = Math.floor(Math.max(0, averageLevel - 1) / 4);
  const resourceAdjustment = averageResourceRatio < 0.55 ? -1 : 0;
  let targetEnemyCount = clamp(
    Math.round(
      partySize * difficultyMultiplier * intentCountMultiplier * rulesetDensityFactor +
        levelBonus +
        resourceAdjustment,
    ),
    config.minOpponents,
    config.maxOpponents,
  );
  if (config.encounterIntent === "easy") {
    targetEnemyCount = Math.max(config.minOpponents, Math.min(targetEnemyCount, Math.max(2, Math.min(3, partySize))));
  } else if (config.encounterIntent === "standard") {
    targetEnemyCount = Math.max(config.minOpponents, Math.min(targetEnemyCount, Math.max(3, Math.min(4, partySize + 1))));
  }
  if (
    input.adapterProfile === "dnd" &&
    config.difficultyMode === "standard" &&
    averageLevel <= 2
  ) {
    const lowLevelCap = clamp(Math.max(3, Math.min(4, partySize)), config.minOpponents, config.maxOpponents);
    targetEnemyCount = Math.min(targetEnemyCount, lowLevelCap);
    if (existingEnemies.length >= 3) {
      targetEnemyCount = Math.min(targetEnemyCount, existingEnemies.length);
    }
  }

  const enhancedCombatants: EncounterStartCombatantSeed[] = input.combatants.map((entry) => {
    if (entry.type !== "enemy") {
      return entry;
    }

    const matchedTemplate =
      effectiveTemplatePool.find((template) =>
        normalizeNameKey(entry.name).includes(normalizeNameKey(template.name)),
      ) ??
      effectiveTemplatePool[Math.floor(rng() * Math.max(1, effectiveTemplatePool.length))];
    const resolvedCreatureSlug =
      typeof entry.creatureSlug === "string" && entry.creatureSlug.trim()
        ? entry.creatureSlug.trim()
        : deriveCreatureSlugCandidate(entry.name) ||
          deriveCreatureSlugCandidate(matchedTemplate?.name || "") ||
          undefined;

    if (isNumericHpString(entry.hp)) {
      return {
        ...entry,
        creatureSlug: resolvedCreatureSlug,
      };
    }

    if (!matchedTemplate) {
      return {
        ...entry,
        creatureSlug: resolvedCreatureSlug,
      };
    }

    return {
      ...entry,
      creatureSlug: resolvedCreatureSlug,
      hp: buildEnemyHpString({
        threat: matchedTemplate.threat,
        difficultyMode: config.difficultyMode,
        adapterProfile: input.adapterProfile,
        ruleset: input.ruleset,
        averageLevel,
      }),
      summary:
        entry.summary && entry.summary.trim()
          ? entry.summary
          : `${matchedTemplate.faction} ${matchedTemplate.roles.join("/")}`.trim(),
      initiativeModifier:
        typeof entry.initiativeModifier === "number"
          ? entry.initiativeModifier
          : getTierInitiativeModifier(matchedTemplate.tier, input.adapterProfile),
    };
  });

  const existingEnemyEntries = enhancedCombatants.filter((entry) => entry.type === "enemy");
  let trimmedEnemyCount = 0;
  if (existingEnemyEntries.length > targetEnemyCount) {
    const keepCount = Math.max(0, targetEnemyCount);
    const withIndex = enhancedCombatants.map((entry, index) => ({ entry, index }));
    const enemyWithIndex = withIndex.filter((item) => item.entry.type === "enemy");
    const priorityEnemies = enemyWithIndex.filter((item) => isPriorityEnemyName(item.entry.name));
    const nonPriorityEnemies = enemyWithIndex.filter((item) => !isPriorityEnemyName(item.entry.name));
    const selectedEnemyIndices = new Set<number>();

    for (const item of priorityEnemies) {
      if (selectedEnemyIndices.size >= keepCount) {
        break;
      }
      selectedEnemyIndices.add(item.index);
    }
    for (const item of nonPriorityEnemies) {
      if (selectedEnemyIndices.size >= keepCount) {
        break;
      }
      selectedEnemyIndices.add(item.index);
    }

    trimmedEnemyCount = Math.max(0, enemyWithIndex.length - selectedEnemyIndices.size);
    const nextCombatants: EncounterStartCombatantSeed[] = [];
    for (const item of withIndex) {
      if (item.entry.type !== "enemy" || selectedEnemyIndices.has(item.index)) {
        nextCombatants.push(item.entry);
      }
    }
    enhancedCombatants.length = 0;
    enhancedCombatants.push(...nextCombatants);

    enemyNameSet.clear();
    for (const entry of enhancedCombatants) {
      enemyNameSet.add(normalizeNameKey(entry.name));
    }
  }

  const enemiesAfterTrim = enhancedCombatants.filter((entry) => entry.type === "enemy").length;
  const enemiesToAdd = Math.max(0, targetEnemyCount - enemiesAfterTrim);
  const encounterMatchedTemplateIds = new Set<string>();
  for (const entry of enhancedCombatants) {
    if (entry.type !== "enemy") {
      continue;
    }
    const matchedTemplate = findTemplateForEnemySeed(effectiveTemplatePool, entry);
    if (matchedTemplate) {
      encounterMatchedTemplateIds.add(matchedTemplate.id);
    }
  }
  const preferredAddTemplatePool = effectiveTemplatePool.filter((template) =>
    encounterMatchedTemplateIds.has(template.id),
  );
  const addTemplatePool =
    preferredAddTemplatePool.length > 0 ? preferredAddTemplatePool : effectiveTemplatePool;
  const existingEnemyClonePool = enhancedCombatants.filter(
    (entry) => entry.type === "enemy",
  );
  const usedTemplates: string[] = [];
  for (let index = 0; index < enemiesToAdd; index += 1) {
    if (existingEnemyClonePool.length > 0) {
      const sourceEnemy =
        existingEnemyClonePool[Math.floor(rng() * existingEnemyClonePool.length)];
      if (sourceEnemy) {
        const baseName = stripEnemySerialSuffix(sourceEnemy.name) || sourceEnemy.name;
        let serial = 1;
        let generatedName = `${baseName} ${serial}`;
        while (enemyNameSet.has(normalizeNameKey(generatedName))) {
          serial += 1;
          generatedName = `${baseName} ${serial}`;
        }
        enemyNameSet.add(normalizeNameKey(generatedName));
        enhancedCombatants.push({
          ...sourceEnemy,
          id: undefined,
          name: generatedName,
          creatureSlug:
            sourceEnemy.creatureSlug && sourceEnemy.creatureSlug.trim()
              ? sourceEnemy.creatureSlug.trim()
              : deriveCreatureSlugCandidate(baseName) || undefined,
          statusEffects: [],
          statusDurations: [],
        });
        continue;
      }
    }
    if (addTemplatePool.length === 0) {
      break;
    }
    const roleUsage = new Map<string, number>();
    for (const entry of enhancedCombatants) {
      if (entry.type !== "enemy") {
        continue;
      }
      const matched = findTemplateForEnemySeed(addTemplatePool, entry);
      if (!matched) {
        continue;
      }
      for (const role of matched.roles) {
        roleUsage.set(role, (roleUsage.get(role) ?? 0) + 1);
      }
    }
    const sortedPool = [...addTemplatePool].sort((left, right) => {
      const leftScore = left.roles.reduce((sum, role) => sum + (roleUsage.get(role) ?? 0), 0);
      const rightScore = right.roles.reduce((sum, role) => sum + (roleUsage.get(role) ?? 0), 0);
      if (leftScore !== rightScore) {
        return leftScore - rightScore;
      }
      return left.threat - right.threat;
    });
    const template = sortedPool[Math.floor(rng() * Math.min(2, sortedPool.length))];
    if (!template) {
      break;
    }
    usedTemplates.push(template.id);

    let serial = 1;
    let generatedName = `${template.name} ${serial}`;
    while (enemyNameSet.has(normalizeNameKey(generatedName))) {
      serial += 1;
      generatedName = `${template.name} ${serial}`;
    }
    enemyNameSet.add(normalizeNameKey(generatedName));

    enhancedCombatants.push({
      name: generatedName,
      type: "enemy",
      creatureSlug: deriveCreatureSlugCandidate(template.name) || undefined,
      summary: `${template.faction} ${template.roles.join("/")}`.trim(),
      hp: buildEnemyHpString({
        threat: template.threat,
        difficultyMode: config.difficultyMode,
        adapterProfile: input.adapterProfile,
        ruleset: input.ruleset,
        averageLevel,
      }),
      initiativeModifier: getTierInitiativeModifier(template.tier, input.adapterProfile),
      statusEffects: [],
    });
  }

  return {
    combatants: enhancedCombatants,
    debug: {
      partySize,
      averageLevel: Number(averageLevel.toFixed(2)),
      averageResourceRatio: Number(averageResourceRatio.toFixed(2)),
      difficultyMode: config.difficultyMode,
      encounterIntent: config.encounterIntent,
      variance: config.encounterVariance,
      enemyCountExisting: existingEnemies.length,
      enemyCountTarget: targetEnemyCount,
      enemyCountAdded: enemiesToAdd,
      enemyCountTrimmed: trimmedEnemyCount,
      templatePoolSize: effectiveTemplatePool.length,
      usedTemplates,
    },
  };
}
