import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_COMBAT_STATE,
  type CombatStatusDuration,
  normalizeCombatState,
} from "@/lib/combat";
import {
  advanceTurn,
  buildInitiativeState,
  resolveAutoHitAction,
  resolveAttackAction,
  resolveSaveAction,
  resolveUtilityAction,
} from "@/lib/combat-engine";
import {
  findCharacterByRef,
  getCombatRulesetProfile,
  getAttackDefaults,
  getInitiativeModifier,
} from "@/lib/combat-ruleset-adapter";
import { resolveCatalogEffect } from "@/lib/spell-ability-catalog";
import {
  buildInitialCampaignBootstrap,
  normalizeCampaignBootstrap,
} from "@/lib/campaign-bootstrap";
import { resolveEncounterStart } from "@/lib/encounter-resolver";
import { normalizeCombatStartSeedsWithTelemetry } from "@/lib/combat-start-telemetry";
import {
  classifyEncounterRisk,
  computeEncounterRiskScore,
} from "@/lib/encounter-risk";
import { extractSceneBlock } from "@/lib/scene";
import { getBattleLocationCatalogForRuleset } from "@/lib/battle-map-catalog";
import { normalizeTokenKey } from "@/lib/token-library";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function parseString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseCombatResourceString(value: unknown) {
  const text = parseString(value);
  if (!text) {
    return undefined;
  }

  if (
    /^(n\/a|na|unknown|\?)$/i.test(text) ||
    /^\?+\s*\/\s*\?+$/i.test(text) ||
    /^unknown\s*\/\s*unknown$/i.test(text)
  ) {
    return undefined;
  }

  return text;
}

function parseNumber(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function parseOptionalNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function parseBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }
  return fallback;
}

type BattleMapTemplateRecord = {
  id: string;
  ruleset: string;
  locationKey: string;
  title?: string;
  blockedTilesJson?: unknown;
  playerSpawnTilesJson?: unknown;
  enemySpawnTilesJson?: unknown;
  updatedAt?: unknown;
};

type TokenLibraryEntryRecord = {
  id: string;
  entityType: string;
  ruleset: string;
  category: string;
  subtype: string | null;
  normalizedKey: string;
  label: string;
  imageDataUrl?: string | null;
};

type CreatureLibraryEntryRecord = {
  id: string;
  ruleset: string;
  name: string;
  slug: string;
  size: string | null;
  creatureType: string | null;
  subtype: string | null;
  cr: string | null;
  xpDerived: number | null;
  acJson: unknown;
  hpFormula: string | null;
  hpAvg: number | null;
  speedJson: unknown;
  abilityModsJson: unknown;
  attackProfilesJson: unknown;
};

function normalizeFootprintValue(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 1;
  }
  return Math.max(1, Math.min(6, Math.trunc(value)));
}

function getFootprintFromCreatureSize(size: string | null | undefined) {
  const normalized = (size ?? "").trim().toLowerCase();
  if (!normalized) {
    return { cols: 1, rows: 1 };
  }
  if (
    normalized === "large" ||
    normalized === "l" ||
    normalized.startsWith("large ")
  ) {
    return { cols: 2, rows: 2 };
  }
  if (
    normalized === "huge" ||
    normalized === "h" ||
    normalized.startsWith("huge ")
  ) {
    return { cols: 3, rows: 3 };
  }
  if (
    normalized === "gargantuan" ||
    normalized === "g" ||
    normalized.startsWith("gargantuan ")
  ) {
    return { cols: 4, rows: 4 };
  }
  return { cols: 1, rows: 1 };
}

function parseFirstNumberFromText(value: string) {
  const match = value.match(/-?\d+/);
  if (!match) {
    return null;
  }
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCreatureArmorClass(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1, Math.trunc(value));
  }
  if (typeof value === "string") {
    const fromText = parseFirstNumberFromText(value);
    return fromText === null ? null : Math.max(1, Math.trunc(fromText));
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const parsed = parseCreatureArmorClass(entry);
      if (parsed !== null) {
        return parsed;
      }
    }
    return null;
  }
  if (value && typeof value === "object") {
    const typed = value as Record<string, unknown>;
    return (
      parseCreatureArmorClass(typed.ac) ??
      parseCreatureArmorClass(typed.value) ??
      parseCreatureArmorClass(typed.base)
    );
  }
  return null;
}

function parseCreatureSpeedFeet(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(5, Math.trunc(value));
  }
  if (typeof value === "string") {
    const parsed = parseFirstNumberFromText(value);
    return parsed === null ? null : Math.max(5, Math.trunc(parsed));
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const parsed = parseCreatureSpeedFeet(entry);
      if (parsed !== null) {
        return parsed;
      }
    }
    return null;
  }
  if (value && typeof value === "object") {
    const typed = value as Record<string, unknown>;
    return (
      parseCreatureSpeedFeet(typed.walk) ??
      parseCreatureSpeedFeet(typed.land) ??
      parseCreatureSpeedFeet(typed.value) ??
      parseCreatureSpeedFeet(typed.speed)
    );
  }
  return null;
}

function parseDamageExpression(value: string) {
  const text = value.trim().toLowerCase();
  const diceMatch = text.match(/(\d+)\s*d\s*(\d+)/);
  const bonusMatches = [...text.matchAll(/([+-])\s*(\d+)/g)];
  const bonus = bonusMatches.reduce((sum, match) => {
    const sign = match[1] === "-" ? -1 : 1;
    return sum + sign * Number(match[2]);
  }, 0);
  const diceCount = diceMatch ? Math.max(1, Math.trunc(Number(diceMatch[1]))) : 1;
  const diceSides = diceMatch ? Math.max(4, Math.trunc(Number(diceMatch[2]))) : 6;
  const averageExtraDiceBonus =
    diceCount > 1 ? (diceCount - 1) * Math.round((diceSides + 1) / 2) : 0;
  return {
    damageDie: Math.max(4, Math.min(20, diceSides)),
    damageBonus: Math.max(-10, Math.min(50, Math.trunc(bonus + averageExtraDiceBonus))),
  };
}

function parseCreatureAttackOverrides(entry: CreatureLibraryEntryRecord) {
  const abilityMods = asObject(entry.abilityModsJson);
  const strMod =
    getFirstNumber(abilityMods, [["str"], ["strength"]]) ??
    getFirstNumber(abilityMods, [["STR"], ["Strength"]]);
  const dexMod =
    getFirstNumber(abilityMods, [["dex"], ["dexterity"]]) ??
    getFirstNumber(abilityMods, [["DEX"], ["Dexterity"]]);
  const baseAttackBonus = Math.max(
    1,
    Math.trunc(Math.max(strMod ?? Number.NEGATIVE_INFINITY, dexMod ?? Number.NEGATIVE_INFINITY)),
  );
  let attackBonus: number | null = Number.isFinite(baseAttackBonus) ? baseAttackBonus : null;
  let damageDie: number | null = null;
  let damageBonus: number | null = null;

  const attackProfiles = entry.attackProfilesJson;
  const collectFromProfile = (profile: unknown) => {
    const typed = asObject(profile);
    if (!typed) {
      return false;
    }
    const profileAttackBonus =
      parseOptionalNumber(typed.attackBonus) ??
      parseOptionalNumber(typed.attack_bonus) ??
      parseOptionalNumber(typed.toHit) ??
      parseOptionalNumber(typed.to_hit);
    const damageText =
      parseString(typed.damage) ||
      parseString(typed.damageDice) ||
      parseString(typed.damage_dice);
    if (profileAttackBonus !== undefined) {
      attackBonus = Math.max(-20, Math.min(30, Math.trunc(profileAttackBonus)));
    }
    if (damageText) {
      const parsedDamage = parseDamageExpression(damageText);
      damageDie = parsedDamage.damageDie;
      damageBonus = parsedDamage.damageBonus;
      return true;
    }
    return profileAttackBonus !== undefined;
  };

  if (Array.isArray(attackProfiles)) {
    for (const profile of attackProfiles) {
      if (collectFromProfile(profile)) {
        break;
      }
    }
  } else if (attackProfiles && typeof attackProfiles === "object") {
    const typed = attackProfiles as Record<string, unknown>;
    const values = Object.values(typed);
    for (const profile of values) {
      if (collectFromProfile(profile)) {
        break;
      }
    }
    if (damageDie === null && damageBonus === null) {
      collectFromProfile(typed);
    }
  }

  return {
    attackBonusOverride:
      attackBonus === null ? undefined : Math.max(-20, Math.min(30, Math.trunc(attackBonus))),
    damageDieOverride:
      damageDie === null ? undefined : Math.max(4, Math.min(20, Math.trunc(damageDie))),
    damageBonusOverride:
      damageBonus === null ? undefined : Math.max(-20, Math.min(50, Math.trunc(damageBonus))),
  };
}

function parseCreatureHasRangedCapability(entry: CreatureLibraryEntryRecord) {
  const profileHasRangedSignal = (profile: unknown) => {
    const typed = asObject(profile);
    if (!typed) {
      return false;
    }
    const mergedText = [
      parseString(typed.attackType),
      parseString(typed.attack_type),
      parseString(typed.rangeType),
      parseString(typed.range_type),
      parseString(typed.range),
      parseString(typed.type),
      parseString(typed.name),
      parseString(typed.label),
      parseString(typed.description),
      parseString(typed.desc),
      parseString(typed.notes),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!mergedText) {
      return false;
    }
    return [
      "ranged",
      "missile",
      "thrown",
      "bow",
      "crossbow",
      "sling",
      "javelin",
      "dart",
      "ray",
      "bolt",
      "spell",
      "cantrip",
    ].some((keyword) => mergedText.includes(keyword));
  };

  const attackProfiles = entry.attackProfilesJson;
  if (Array.isArray(attackProfiles)) {
    for (const profile of attackProfiles) {
      if (profileHasRangedSignal(profile)) {
        return true;
      }
    }
    return false;
  }
  if (attackProfiles && typeof attackProfiles === "object") {
    const typed = attackProfiles as Record<string, unknown>;
    if (profileHasRangedSignal(typed)) {
      return true;
    }
    for (const profile of Object.values(typed)) {
      if (profileHasRangedSignal(profile)) {
        return true;
      }
    }
  }
  return false;
}

function buildCreatureEntryLookup(entries: CreatureLibraryEntryRecord[]) {
  const byName = new Map<string, CreatureLibraryEntryRecord>();
  const bySlug = new Map<string, CreatureLibraryEntryRecord>();
  const uniqueById = new Map<string, CreatureLibraryEntryRecord>();
  for (const entry of entries) {
    if (!uniqueById.has(entry.id)) {
      uniqueById.set(entry.id, entry);
    }
    const normalizedName = entry.name.trim().toLowerCase();
    const strippedName = stripTrailingEnemySerial(entry.name).trim().toLowerCase();
    const normalizedLookup = normalizeCreatureNameForLookup(entry.name);
    const normalizedSlug = normalizeCreatureSlugForLookup(entry.slug);
    if (normalizedName) {
      byName.set(normalizedName, entry);
    }
    if (strippedName) {
      byName.set(strippedName, entry);
    }
    if (normalizedLookup) {
      byName.set(normalizedLookup, entry);
    }
    if (entry.slug.trim()) {
      bySlug.set(entry.slug.trim().toLowerCase(), entry);
    }
    if (normalizedSlug) {
      bySlug.set(normalizedSlug, entry);
    }
  }
  return { byName, bySlug, entries: Array.from(uniqueById.values()) };
}

function resolveCreatureEntryForCombatant(
  lookup: ReturnType<typeof buildCreatureEntryLookup>,
  combatant: { name: string; creatureSlug?: string },
) {
  const requestedSlug = normalizeCreatureSlugForLookup(combatant.creatureSlug ?? "");
  const requestedSlugRaw = (combatant.creatureSlug ?? "").trim().toLowerCase();
  if (requestedSlugRaw && lookup.bySlug.has(requestedSlugRaw)) {
    return {
      entry: lookup.bySlug.get(requestedSlugRaw) ?? null,
      source: "slug" as const,
    };
  }
  if (requestedSlug && lookup.bySlug.has(requestedSlug)) {
    return {
      entry: lookup.bySlug.get(requestedSlug) ?? null,
      source: "slug" as const,
    };
  }
  const normalizedName = combatant.name.trim().toLowerCase();
  const strippedName = stripTrailingEnemySerial(combatant.name).trim().toLowerCase();
  const normalizedLookup = normalizeCreatureNameForLookup(combatant.name);
  const byName =
    lookup.byName.get(normalizedName) ??
    lookup.byName.get(strippedName) ??
    lookup.byName.get(normalizedLookup) ??
    null;
  if (byName) {
    return {
      entry: byName,
      source: "name" as const,
    };
  }
  const requestedWords = getNormalizedStemWords(combatant.name);
  if (requestedWords.length > 0) {
    let best:
      | {
          entry: CreatureLibraryEntryRecord;
          score: number;
        }
      | null = null;
    for (const candidate of lookup.entries) {
      const candidateWords = getNormalizedStemWords(candidate.name);
      if (candidateWords.length === 0) {
        continue;
      }
      let score = 0;
      if (normalizedLookup && normalizeCreatureNameForLookup(candidate.name).includes(normalizedLookup)) {
        score += 20;
      }
      if (normalizedLookup && normalizedLookup.includes(normalizeCreatureNameForLookup(candidate.name))) {
        score += 20;
      }
      for (const requestedWord of requestedWords) {
        if (candidateWords.some((candidateWord) => candidateWord === requestedWord)) {
          score += 12;
          continue;
        }
        if (
          candidateWords.some((candidateWord) =>
            areStemSimilar(candidateWord, requestedWord),
          )
        ) {
          score += 7;
        }
      }
      if (!best || score > best.score) {
        best = { entry: candidate, score };
      }
    }
    if (best && best.score >= 18) {
      return {
        entry: best.entry,
        source: "name" as const,
      };
    }
  }
  return {
    entry: null,
    source: "none" as const,
  };
}

function hydrateEnemyCombatantsFromCreatureLibrary(
  combatants: Array<{
    id?: string;
    name: string;
    type: "character" | "enemy" | "npc";
    gridX?: number;
    gridY?: number;
    summary?: string;
    hp?: string;
    creatureSlug?: string;
    creatureSize?: string;
    armorClass?: number;
    hpMax?: number;
    attackBonusOverride?: number;
    damageDieOverride?: number;
    damageBonusOverride?: number;
    moveTilesOverride?: number;
    hasRangedCapability?: boolean;
    tokenFootprintCols?: number;
    tokenFootprintRows?: number;
    tokenLibraryId?: string;
    tokenImageDataUrl?: string;
    tokenLabel?: string;
    initiativeModifier?: number;
  }>,
  creatureEntries: CreatureLibraryEntryRecord[],
) {
  const creatureLookup = buildCreatureEntryLookup(creatureEntries);
  let matched = 0;
  let matchedBySlug = 0;
  let matchedByName = 0;
  let slugBackfilled = 0;
  let acHydrated = 0;
  let hpHydrated = 0;
  let attackHydrated = 0;
  let moveHydrated = 0;
  let rangedCapabilityHydrated = 0;
  let acMissing = 0;
  let attackMissing = 0;
  let speedMissing = 0;
  const nextCombatants = combatants.map((combatant) => {
    if (combatant.type !== "enemy") {
      return combatant;
    }
    const creatureResolution = resolveCreatureEntryForCombatant(
      creatureLookup,
      combatant,
    );
    const creature = creatureResolution.entry;
    if (!creature) {
      return combatant;
    }

    matched += 1;
    const hadCreatureSlug = Boolean(parseString(combatant.creatureSlug));
    if (creatureResolution.source === "slug") {
      matchedBySlug += 1;
    } else if (creatureResolution.source === "name") {
      if (!hadCreatureSlug && creature.slug.trim()) {
        slugBackfilled += 1;
        matchedBySlug += 1;
      } else {
        matchedByName += 1;
      }
    }
    const armorClass = parseCreatureArmorClass(creature.acJson);
    if (typeof armorClass === "number") {
      acHydrated += 1;
    } else {
      acMissing += 1;
    }
    const hpMax =
      typeof creature.hpAvg === "number" && Number.isFinite(creature.hpAvg)
        ? Math.max(1, Math.trunc(creature.hpAvg))
        : null;
    const hpValue =
      !combatant.hp && hpMax
        ? `${hpMax}/${hpMax}`
        : combatant.hp;
    if (!combatant.hp && hpMax) {
      hpHydrated += 1;
    }
    const speedFeet = parseCreatureSpeedFeet(creature.speedJson);
    const moveTilesOverride =
      typeof speedFeet === "number"
        ? Math.max(1, Math.floor(Math.max(5, speedFeet) / 5))
        : undefined;
    if (typeof moveTilesOverride === "number") {
      moveHydrated += 1;
    } else {
      speedMissing += 1;
    }
    const attackOverrides = parseCreatureAttackOverrides(creature);
    const hasRangedCapability = parseCreatureHasRangedCapability(creature);
    rangedCapabilityHydrated += 1;
    if (
      attackOverrides.attackBonusOverride !== undefined ||
      attackOverrides.damageDieOverride !== undefined ||
      attackOverrides.damageBonusOverride !== undefined
    ) {
      attackHydrated += 1;
    } else {
      attackMissing += 1;
    }
    return {
      ...combatant,
      creatureSlug: creature.slug,
      creatureSize: creature.size ?? combatant.creatureSize,
      armorClass: armorClass ?? undefined,
      hp: hpValue,
      hpMax: hpMax ?? undefined,
      moveTilesOverride,
      hasRangedCapability,
      ...attackOverrides,
    };
  });

  return {
    combatants: nextCombatants,
    telemetry: {
      matched,
      matchedBySlug,
      matchedByName,
      slugBackfilled,
      acHydrated,
      hpHydrated,
      attackHydrated,
      moveHydrated,
      rangedCapabilityHydrated,
      acMissing,
      attackMissing,
      speedMissing,
    },
  };
}

function getCombatantOccupiedKeys(seed: {
  gridX?: number;
  gridY?: number;
  tokenFootprintCols?: number;
  tokenFootprintRows?: number;
}) {
  if (
    typeof seed.gridX !== "number" ||
    !Number.isFinite(seed.gridX) ||
    typeof seed.gridY !== "number" ||
    !Number.isFinite(seed.gridY)
  ) {
    return [] as string[];
  }
  const cols = normalizeFootprintValue(seed.tokenFootprintCols);
  const rows = normalizeFootprintValue(seed.tokenFootprintRows);
  const occupied: string[] = [];
  for (let dx = 0; dx < cols; dx += 1) {
    for (let dy = 0; dy < rows; dy += 1) {
      occupied.push(`${seed.gridX + dx},${seed.gridY + dy}`);
    }
  }
  return occupied;
}

function normalizeTileCoordinates(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as Array<[number, number]>;
  }
  const output: Array<[number, number]> = [];
  const seen = new Set<string>();
  for (const entry of value) {
    let x = Number.NaN;
    let y = Number.NaN;
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
    const xi = Math.max(0, Math.trunc(x));
    const yi = Math.max(0, Math.trunc(y));
    const key = `${xi},${yi}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push([xi, yi]);
  }
  return output;
}

function inferBattleMapLocationKey(params: {
  ruleset: string;
  sceneLocation: string;
  sceneTitle: string;
  bootstrapStartingScene: string;
  latestNarrative: string;
  offscreenPressure: string;
}) {
  const locationCatalog = getBattleLocationCatalogForRuleset(params.ruleset);
  const weightedSources = [
    { text: params.sceneLocation, weight: 120 },
    { text: params.sceneTitle, weight: 100 },
    { text: params.latestNarrative, weight: 90 },
    { text: params.bootstrapStartingScene, weight: 55 },
    { text: params.offscreenPressure, weight: 25 },
  ]
    .map((source) => ({
      text: source.text.trim().toLowerCase(),
      weight: source.weight,
    }))
    .filter((source) => source.text.length > 0);
  if (weightedSources.length === 0) {
    return locationCatalog[0]?.key ?? null;
  }

  const aliasesByLocationKey: Record<string, string[]> = {
    graveyard: ["graveyard", "grave", "cemetery", "mausoleum", "tomb", "burial"],
    crypt: ["crypt", "catacomb", "catacombs", "ossuary"],
    city_street: ["city", "street", "alley", "market", "plaza", "town"],
    tavern: ["tavern", "inn", "alehouse"],
    saloon: ["saloon"],
    forest_path: ["forest", "woods", "woodland", "trail", "path", "clearing"],
    cave: ["cave", "cavern", "grotto"],
    sewer: ["sewer", "sewers", "drain", "canal"],
    ruins: ["ruins", "ruin", "temple", "collapsed"],
  };

  const scored = locationCatalog.map((entry, index) => {
    const key = entry.key.toLowerCase();
    const label = entry.label.toLowerCase();
    const keyTokens = key.split(/[_\s-]+/).filter((token) => token.length >= 3);
    const labelTokens = label.split(/[\s-]+/).filter((token) => token.length >= 3);
    const aliases = aliasesByLocationKey[key] ?? [];
    let score = 0;
    for (const source of weightedSources) {
      if (source.text.includes(key)) {
        score += source.weight * 6;
      }
      if (source.text.includes(label)) {
        score += source.weight * 5;
      }
      for (const token of keyTokens) {
        if (source.text.includes(token)) {
          score += source.weight * 2;
        }
      }
      for (const token of labelTokens) {
        if (source.text.includes(token)) {
          score += source.weight;
        }
      }
      for (const alias of aliases) {
        if (alias.length >= 3 && source.text.includes(alias)) {
          score += source.weight * 3;
        }
      }
    }
    return { entry, score, index };
  });
  scored.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return left.index - right.index;
  });

  if ((scored[0]?.score ?? 0) > 0) {
    return scored[0]?.entry.key ?? null;
  }
  return locationCatalog[0]?.key ?? null;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isGenericHostileEnemyName(value: string) {
  const normalized = value.trim().toLowerCase();
  return /^hostile\s+\d+$/i.test(normalized) || /^enemy\s+\d+$/i.test(normalized);
}

function extractMentionedCreatureNamesFromNarrative(
  narrativeText: string,
  creatureNames: string[],
) {
  const narrative = narrativeText.trim().toLowerCase();
  if (!narrative) {
    return [] as string[];
  }
  const withIndex: Array<{ name: string; index: number }> = [];
  const seen = new Set<string>();
  for (const creatureName of creatureNames) {
    const name = creatureName.trim();
    if (!name) {
      continue;
    }
    const normalized = name.toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }
    const pattern = new RegExp(`\\b${escapeRegex(normalized)}\\b`, "i");
    const match = narrative.match(pattern);
    if (!match || typeof match.index !== "number") {
      continue;
    }
    seen.add(normalized);
    withIndex.push({ name, index: match.index });
  }
  withIndex.sort((left, right) => left.index - right.index);
  return withIndex.map((entry) => entry.name);
}

function repairGenericEnemyNamesFromNarrative(
  combatants: Array<{
    id?: string;
    name: string;
    type: "character" | "enemy" | "npc";
    creatureSlug?: string;
  }>,
  mentionedCreatureNames: string[],
) {
  if (!mentionedCreatureNames.length) {
    return {
      combatants,
      telemetry: {
        genericEnemyCount: 0,
        replacementsApplied: 0,
        matchedNarrativeCreatures: 0,
      },
    };
  }
  const genericEnemyIndexes = combatants
    .map((entry, index) => ({ entry, index }))
    .filter(
      ({ entry }) =>
        entry.type === "enemy" && isGenericHostileEnemyName(entry.name),
    )
    .map(({ index }) => index);
  if (!genericEnemyIndexes.length) {
    return {
      combatants,
      telemetry: {
        genericEnemyCount: 0,
        replacementsApplied: 0,
        matchedNarrativeCreatures: mentionedCreatureNames.length,
      },
    };
  }

  const nextCombatants = [...combatants];
  const replacementCounts = new Map<string, number>();
  let replacementsApplied = 0;
  for (let i = 0; i < genericEnemyIndexes.length; i += 1) {
    const replacementBaseName =
      mentionedCreatureNames[i] ??
      (mentionedCreatureNames.length > 0
        ? mentionedCreatureNames[i % mentionedCreatureNames.length]
        : undefined);
    if (!replacementBaseName) {
      break;
    }
    const count = (replacementCounts.get(replacementBaseName) ?? 0) + 1;
    replacementCounts.set(replacementBaseName, count);
    const replacementName = count > 1 ? `${replacementBaseName} ${count}` : replacementBaseName;
    const index = genericEnemyIndexes[i];
    const replacementSlug = normalizeCreatureSlugForLookup(replacementBaseName);
    nextCombatants[index] = {
      ...nextCombatants[index],
      name: replacementName,
      creatureSlug: replacementSlug || nextCombatants[index].creatureSlug,
    };
    replacementsApplied += 1;
  }

  return {
    combatants: nextCombatants,
    telemetry: {
      genericEnemyCount: genericEnemyIndexes.length,
      replacementsApplied,
      matchedNarrativeCreatures: mentionedCreatureNames.length,
    },
  };
}

function dedupeStartCombatants(
  combatants: Array<{
    id?: string;
    name: string;
    type: "character" | "enemy" | "npc";
  }>,
) {
  const seenFriendlyRefs = new Set<string>();
  let removedFriendlyDuplicates = 0;
  const deduped = combatants.filter((entry) => {
    if (entry.type === "enemy") {
      return true;
    }
    const ref = parseString(entry.id) || normalizeCreatureNameForLookup(entry.name);
    if (!ref) {
      return true;
    }
    const key = `${entry.type}:${ref.toLowerCase()}`;
    if (seenFriendlyRefs.has(key)) {
      removedFriendlyDuplicates += 1;
      return false;
    }
    seenFriendlyRefs.add(key);
    return true;
  });
  return {
    combatants: deduped,
    telemetry: {
      removedFriendlyDuplicates,
    },
  };
}

function ensureUniqueEnemyNames(
  combatants: Array<{
    id?: string;
    name: string;
    type: "character" | "enemy" | "npc";
  }>,
) {
  const seenNames = new Set<string>();
  const enemyBaseCounts = new Map<string, number>();
  let renamedEnemies = 0;
  const normalized = combatants.map((entry) => {
    const rawName = parseString(entry.name) || entry.name;
    if (entry.type !== "enemy") {
      seenNames.add(rawName.toLowerCase());
      return {
        ...entry,
        name: rawName,
      };
    }
    const baseName = stripTrailingEnemySerial(rawName) || rawName;
    let candidate = rawName;
    let nextCount = enemyBaseCounts.get(baseName.toLowerCase()) ?? 0;
    while (seenNames.has(candidate.toLowerCase())) {
      nextCount += 1;
      candidate = `${baseName} ${nextCount}`;
    }
    enemyBaseCounts.set(baseName.toLowerCase(), Math.max(nextCount, 1));
    seenNames.add(candidate.toLowerCase());
    if (candidate !== rawName) {
      renamedEnemies += 1;
    }
    return {
      ...entry,
      name: candidate,
    };
  });
  return {
    combatants: normalized,
    telemetry: {
      renamedEnemies,
    },
  };
}

function pickBestBattleMapTemplate(params: {
  templates: BattleMapTemplateRecord[];
  inferredLocationKey: string | null;
  contextText: string;
}) {
  if (!params.templates.length) {
    return null;
  }
  const inferred = (params.inferredLocationKey ?? "").trim().toLowerCase();
  if (inferred) {
    const exactInferredMatches = params.templates.filter(
      (template) => (template.locationKey ?? "").trim().toLowerCase() === inferred,
    );
    if (exactInferredMatches.length > 0) {
      exactInferredMatches.sort((left, right) => {
        const leftTime =
          left.updatedAt instanceof Date ? left.updatedAt.getTime() : Number.NEGATIVE_INFINITY;
        const rightTime =
          right.updatedAt instanceof Date ? right.updatedAt.getTime() : Number.NEGATIVE_INFINITY;
        return rightTime - leftTime;
      });
      return exactInferredMatches[0] ?? null;
    }
  }
  const context = params.contextText.trim().toLowerCase();
  const contextTokens = context.split(/[\s,_-]+/).filter((token) => token.length >= 3);
  const thematicKeywords = ["forest", "woods", "woodland", "clearing", "trail", "path", "cave", "crypt", "graveyard", "tavern", "saloon", "street", "city", "sewer", "ruins"];

  const scored = params.templates.map((template, index) => {
    const key = (template.locationKey ?? "").trim().toLowerCase();
    const title = (template.title ?? "").trim().toLowerCase();
    let score = 0;
    if (inferred && key === inferred) {
      score += 1000;
    }
    if (inferred && key.includes(inferred)) {
      score += 300;
    }
    if (inferred && title.includes(inferred.replaceAll("_", " "))) {
      score += 220;
    }
    if (context) {
      if (context.includes(key)) {
        score += 260;
      }
      if (title && context.includes(title)) {
        score += 180;
      }
      const keyTokens = key.split(/[\s,_-]+/).filter((token) => token.length >= 3);
      score += keyTokens.filter((token) => context.includes(token)).length * 45;
      if (title) {
        const titleTokens = title.split(/[\s,_-]+/).filter((token) => token.length >= 3);
        score += titleTokens.filter((token) => context.includes(token)).length * 30;
      }
      for (const keyword of thematicKeywords) {
        if (!context.includes(keyword)) {
          continue;
        }
        if (key.includes(keyword)) {
          score += 70;
        }
        if (title.includes(keyword)) {
          score += 45;
        }
      }
      for (const token of contextTokens) {
        if (key.includes(token)) {
          score += 20;
        }
        if (title.includes(token)) {
          score += 12;
        }
      }
    }
    return {
      template,
      score,
      index,
      updatedAtMs:
        template.updatedAt instanceof Date
          ? template.updatedAt.getTime()
          : Number.NaN,
    };
  });

  scored.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    const leftTime = Number.isFinite(left.updatedAtMs) ? left.updatedAtMs : Number.NEGATIVE_INFINITY;
    const rightTime = Number.isFinite(right.updatedAtMs) ? right.updatedAtMs : Number.NEGATIVE_INFINITY;
    if (rightTime !== leftTime) {
      return rightTime - leftTime;
    }
    return left.index - right.index;
  });

  return scored[0]?.template ?? null;
}

function assignSpawnTilesToCombatants(
  seeds: Array<{
    id?: string;
    name: string;
    type: "character" | "enemy" | "npc";
    gridX?: number;
    gridY?: number;
    tokenFootprintCols?: number;
    tokenFootprintRows?: number;
  }>,
  params: {
    playerSpawnTiles: Array<[number, number]>;
    enemySpawnTiles: Array<[number, number]>;
    blockedTiles: Array<[number, number]>;
  },
) {
  const blocked = new Set(params.blockedTiles.map(([x, y]) => `${x},${y}`));
  const occupied = new Set<string>();
  const validPlayerTiles = params.playerSpawnTiles.filter(
    ([x, y]) => !blocked.has(`${x},${y}`),
  );
  const validEnemyTiles = params.enemySpawnTiles.filter(
    ([x, y]) => !blocked.has(`${x},${y}`),
  );

  let playerCursor = 0;
  let enemyCursor = 0;
  let playerAssigned = 0;
  let enemyAssigned = 0;

  const assigned = seeds.map((seed) => {
    const isPlayerSide = seed.type === "character";
    const tilePool = isPlayerSide ? validPlayerTiles : validEnemyTiles;
    if (tilePool.length === 0) {
      return seed;
    }

    const startCursor = isPlayerSide ? playerCursor : enemyCursor;
    let assignedTile: [number, number] | null = null;
    const cols = normalizeFootprintValue(seed.tokenFootprintCols);
    const rows = normalizeFootprintValue(seed.tokenFootprintRows);
    for (let scanned = 0; scanned < tilePool.length; scanned += 1) {
      const nextIndex = (startCursor + scanned) % tilePool.length;
      const tile = tilePool[nextIndex];
      const candidateKeys: string[] = [];
      let valid = true;
      for (let dx = 0; dx < cols; dx += 1) {
        for (let dy = 0; dy < rows; dy += 1) {
          const key = `${tile[0] + dx},${tile[1] + dy}`;
          if (blocked.has(key) || occupied.has(key)) {
            valid = false;
            break;
          }
          candidateKeys.push(key);
        }
        if (!valid) {
          break;
        }
      }
      if (!valid) {
        continue;
      }
      assignedTile = tile;
      if (isPlayerSide) {
        playerCursor = (nextIndex + 1) % tilePool.length;
      } else {
        enemyCursor = (nextIndex + 1) % tilePool.length;
      }
      for (const key of candidateKeys) {
        occupied.add(key);
      }
      break;
    }

    if (!assignedTile) {
      return seed;
    }
    if (isPlayerSide) {
      playerAssigned += 1;
    } else {
      enemyAssigned += 1;
    }
    return {
      ...seed,
      gridX: assignedTile[0],
      gridY: assignedTile[1],
      tokenFootprintCols: cols,
      tokenFootprintRows: rows,
    };
  });

  return {
    combatants: assigned,
    telemetry: {
      playerSpawnTileCount: params.playerSpawnTiles.length,
      enemySpawnTileCount: params.enemySpawnTiles.length,
      blockedTileCount: params.blockedTiles.length,
      playerAssigned,
      enemyAssigned,
    },
  };
}

function stripTrailingEnemySerial(value: string) {
  return value
    .trim()
    .replace(/\s*(?:#\s*)?\d+$/i, "")
    .trim();
}

function normalizeCreatureNameForLookup(value: string) {
  return stripTrailingEnemySerial(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCreatureSlugForLookup(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!normalized) {
    return "";
  }
  return normalized.replace(
    /^(?:dnd\d*|dnd5e|deadlands|savage_rifts|savage|rifts|open5e|wotc|srd)_/,
    "",
  );
}

function normalizeStem(value: string) {
  const base = value.trim().toLowerCase();
  if (!base) {
    return "";
  }
  return base
    .replace(/(ical|ingly|edly|ment|tion|sion|ness|ship|ward|ling|ing|ers|er|ed|es|s|al|ic|or|ar)$/i, "")
    .trim();
}

function getNormalizedStemWords(value: string) {
  return normalizeCreatureNameForLookup(value)
    .split(" ")
    .map((part) => normalizeStem(part))
    .filter((part) => part.length >= 3);
}

function areStemSimilar(left: string, right: string) {
  if (!left || !right) {
    return false;
  }
  if (left === right) {
    return true;
  }
  const minPrefixLength = 5;
  if (
    (left.length >= minPrefixLength || right.length >= minPrefixLength) &&
    (left.startsWith(right) || right.startsWith(left))
  ) {
    return true;
  }
  return false;
}

function parseEnemyCategorySubtype(name: string, summary?: string) {
  const base = stripTrailingEnemySerial(name);
  const tokens = base.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return { category: "", subtype: "" };
  }
  const category = normalizeTokenKey(tokens[0]);
  const subtypeFromName = normalizeTokenKey(tokens.slice(1).join(" "));
  if (subtypeFromName) {
    return { category, subtype: subtypeFromName };
  }
  const summarySubtype = normalizeTokenKey(
    (summary ?? "")
      .replace(/[^\w\s-]/g, " ")
      .trim()
      .split(/\s+/)
      .slice(0, 3)
      .join(" "),
  );
  return { category, subtype: summarySubtype };
}

function getSubtypeMatchScore(requestedSubtype: string, candidateSubtype: string, label: string) {
  const requested = normalizeTokenKey(requestedSubtype);
  const candidate = normalizeTokenKey(candidateSubtype);
  const normalizedLabel = normalizeTokenKey(label);
  if (!requested) {
    return 0;
  }
  if (requested === candidate) {
    return 100;
  }
  if (candidate.startsWith(requested) || requested.startsWith(candidate)) {
    return 85;
  }
  if (candidate.includes(requested) || requested.includes(candidate)) {
    return 70;
  }
  // Common truncation/inflection tolerance, e.g. sling -> slinger.
  const requestedStem = requested.replace(/(?:er|ers|ing|ings|ed|s)$/i, "");
  const candidateStem = candidate.replace(/(?:er|ers|ing|ings|ed|s)$/i, "");
  if (requestedStem.length >= 3 && requestedStem === candidateStem) {
    return 60;
  }
  if (requestedStem.length >= 3 && candidateStem.includes(requestedStem)) {
    return 52;
  }
  if (normalizedLabel.includes(requested)) {
    return 45;
  }
  if (requestedStem.length >= 3 && normalizedLabel.includes(requestedStem)) {
    return 35;
  }
  return 0;
}

function bindEnemyTokensToCombatants(
  combatants: Array<{
    id?: string;
    name: string;
    type: "character" | "enemy" | "npc";
    creatureSlug?: string;
    creatureSize?: string;
    summary?: string;
    tokenFootprintCols?: number;
    tokenFootprintRows?: number;
    tokenLibraryId?: string;
    tokenImageDataUrl?: string;
    tokenLabel?: string;
  }>,
  tokenEntries: TokenLibraryEntryRecord[],
  creatureEntries: CreatureLibraryEntryRecord[],
) {
  const enemyEntries = tokenEntries.filter(
    (entry) => entry.entityType.trim().toLowerCase() === "enemy",
  );
  const enemyByNormalizedKey = new Map(
    enemyEntries.map((entry) => [entry.normalizedKey.trim().toLowerCase(), entry] as const),
  );
  let matchedExactSubtype = 0;
  let matchedByCreatureKey = 0;
  let matchedByNameOrSubtype = 0;
  let matchedCategoryOnly = 0;
  let matchedFallback = 0;
  let unmatched = 0;

  const genericFallbackPool = enemyEntries.filter((entry) => {
    const category = normalizeTokenKey(entry.category);
    const subtype = normalizeTokenKey(entry.subtype ?? "");
    return (
      category === "general" ||
      category === "generic" ||
      category === "enemy" ||
      subtype === "base" ||
      subtype === "generic"
    );
  });

  const creatureLookup = buildCreatureEntryLookup(creatureEntries);

  const nextCombatants = combatants.map((combatant) => {
    if (combatant.type !== "enemy") {
      return combatant;
    }
    const { category, subtype } = parseEnemyCategorySubtype(combatant.name, combatant.summary);

    const combatantNameNormalized = combatant.name.trim().toLowerCase();
    const combatantNameStripped = stripTrailingEnemySerial(combatant.name)
      .trim()
      .toLowerCase();
    const creatureResolution = resolveCreatureEntryForCombatant(
      creatureLookup,
      combatant,
    );
    const creatureEntry = creatureResolution.entry;
    const creatureFootprint = getFootprintFromCreatureSize(creatureEntry?.size);
    const creatureSize = creatureEntry?.size ?? combatant.creatureSize;
    const creatureKeyMatch =
      creatureEntry?.slug
        ? enemyByNormalizedKey.get(
            normalizeTokenKey(`enemy:creature:${creatureEntry.slug}`).trim().toLowerCase(),
          ) ?? null
        : null;
    if (creatureKeyMatch) {
      matchedExactSubtype += 1;
      matchedByCreatureKey += 1;
      return {
        ...combatant,
        tokenLibraryId: creatureKeyMatch.id,
        tokenImageDataUrl: creatureKeyMatch.imageDataUrl,
        tokenLabel: creatureKeyMatch.label,
        tokenFootprintCols: creatureFootprint.cols,
        tokenFootprintRows: creatureFootprint.rows,
        creatureSize,
      };
    }

    const exactLabelMatch =
      enemyEntries.find(
        (entry) => entry.label.trim().toLowerCase() === combatantNameNormalized,
      ) ??
      enemyEntries.find(
        (entry) => entry.label.trim().toLowerCase() === combatantNameStripped,
      ) ??
      null;
    if (exactLabelMatch) {
      matchedExactSubtype += 1;
      matchedByNameOrSubtype += 1;
      return {
        ...combatant,
        tokenLibraryId: exactLabelMatch.id,
        tokenImageDataUrl: exactLabelMatch.imageDataUrl,
        tokenLabel: exactLabelMatch.label,
        tokenFootprintCols: creatureFootprint.cols,
        tokenFootprintRows: creatureFootprint.rows,
        creatureSize,
      };
    }

    const fuzzyLabelMatch =
      enemyEntries
        .map((entry) => {
          const normalizedLabel = entry.label.trim().toLowerCase();
          let score = 0;
          if (normalizedLabel && combatantNameStripped.includes(normalizedLabel)) {
            score = Math.max(score, 95);
          }
          if (normalizedLabel && normalizedLabel.includes(combatantNameStripped)) {
            score = Math.max(score, 90);
          }
          const strippedTokens = combatantNameStripped
            .split(/[\s_-]+/)
            .filter((token) => token.length >= 3);
          const tokenHits = strippedTokens.filter((token) =>
            normalizedLabel.includes(token),
          ).length;
          if (tokenHits > 0) {
            score = Math.max(score, 50 + tokenHits * 12);
          }
          return { entry, score };
        })
        .filter((candidate) => candidate.score >= 70)
        .sort((left, right) => right.score - left.score)[0]?.entry ?? null;
    if (fuzzyLabelMatch) {
      matchedExactSubtype += 1;
      matchedByNameOrSubtype += 1;
      return {
        ...combatant,
        tokenLibraryId: fuzzyLabelMatch.id,
        tokenImageDataUrl: fuzzyLabelMatch.imageDataUrl,
        tokenLabel: fuzzyLabelMatch.label,
        tokenFootprintCols: creatureFootprint.cols,
        tokenFootprintRows: creatureFootprint.rows,
        creatureSize,
      };
    }

    const exactSubtypeMatch =
      category && subtype
        ? enemyEntries.find(
            (entry) =>
              normalizeTokenKey(entry.category) === category &&
              normalizeTokenKey(entry.subtype ?? "") === subtype,
          ) ?? null
        : null;
    if (exactSubtypeMatch) {
      matchedExactSubtype += 1;
      matchedByNameOrSubtype += 1;
      return {
        ...combatant,
        tokenLibraryId: exactSubtypeMatch.id,
        tokenImageDataUrl: exactSubtypeMatch.imageDataUrl,
        tokenLabel: exactSubtypeMatch.label,
        tokenFootprintCols: creatureFootprint.cols,
        tokenFootprintRows: creatureFootprint.rows,
        creatureSize,
      };
    }

    const fuzzySubtypeMatch =
      category && subtype
        ? enemyEntries
            .filter((entry) => normalizeTokenKey(entry.category) === category)
            .map((entry) => ({
              entry,
              score: getSubtypeMatchScore(subtype, entry.subtype ?? "", entry.label),
            }))
            .filter((entry) => entry.score > 0)
            .sort((left, right) => right.score - left.score)[0]?.entry ?? null
        : null;
    if (fuzzySubtypeMatch) {
      matchedExactSubtype += 1;
      matchedByNameOrSubtype += 1;
      return {
        ...combatant,
        tokenLibraryId: fuzzySubtypeMatch.id,
        tokenImageDataUrl: fuzzySubtypeMatch.imageDataUrl,
        tokenLabel: fuzzySubtypeMatch.label,
        tokenFootprintCols: creatureFootprint.cols,
        tokenFootprintRows: creatureFootprint.rows,
        creatureSize,
      };
    }

    const categoryMatch =
      category
        ? enemyEntries.find((entry) => normalizeTokenKey(entry.category) === category) ?? null
        : null;
    if (categoryMatch) {
      matchedCategoryOnly += 1;
      return {
        ...combatant,
        tokenLibraryId: categoryMatch.id,
        tokenImageDataUrl: categoryMatch.imageDataUrl,
        tokenLabel: categoryMatch.label,
        tokenFootprintCols: creatureFootprint.cols,
        tokenFootprintRows: creatureFootprint.rows,
        creatureSize,
      };
    }

    const fallbackMatch = genericFallbackPool[0] ?? enemyEntries[0] ?? null;
    if (fallbackMatch) {
      matchedFallback += 1;
      return {
        ...combatant,
        tokenLibraryId: fallbackMatch.id,
        tokenImageDataUrl: fallbackMatch.imageDataUrl,
        tokenLabel: fallbackMatch.label,
        tokenFootprintCols: creatureFootprint.cols,
        tokenFootprintRows: creatureFootprint.rows,
        creatureSize,
      };
    }

    unmatched += 1;
    return {
      ...combatant,
      tokenFootprintCols: creatureFootprint.cols,
      tokenFootprintRows: creatureFootprint.rows,
      creatureSize,
    };
  });

  return {
    combatants: nextCombatants,
    telemetry: {
      tokenPoolEnemyCount: enemyEntries.length,
      matchedExactSubtype,
      matchedByCreatureKey,
      matchedByNameOrSubtype,
      matchedCategoryOnly,
      matchedFallback,
      unmatched,
    },
  };
}

function deriveCharacterTokenDataUrl(sheetJson: unknown) {
  const sheet = asObject(sheetJson);
  const tokenDataUrl = sheet?.tokenDataUrl;
  if (typeof tokenDataUrl === "string" && tokenDataUrl.startsWith("data:image/")) {
    return tokenDataUrl;
  }
  return undefined;
}

function asObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function mergeUniqueStatusEffects(existing: unknown, additions: string[]) {
  const current = Array.isArray(existing)
    ? existing.filter(
        (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
      )
    : [];
  const merged = [...current];
  for (const addition of additions) {
    if (
      typeof addition === "string" &&
      addition.trim().length > 0 &&
      !merged.some((entry) => entry.toLowerCase() === addition.trim().toLowerCase())
    ) {
      merged.push(addition.trim());
    }
  }
  return merged;
}

function getNestedValue(source: unknown, path: string[]) {
  let cursor: unknown = source;
  for (const key of path) {
    const cursorObject = asObject(cursor);
    if (!cursorObject || !(key in cursorObject)) {
      return null;
    }
    cursor = cursorObject[key];
  }
  return cursor;
}

function getFirstNumber(source: unknown, candidatePaths: string[][]) {
  for (const path of candidatePaths) {
    const value = getNestedValue(source, path);
    const parsed = parseOptionalNumber(value);
    if (parsed !== undefined) {
      return parsed;
    }
  }
  return undefined;
}

function getAbilitySaveBonus(
  sheetJson: Record<string, unknown> | null,
  ability: "str" | "dex" | "con" | "int" | "wis" | "cha",
) {
  return (
    getFirstNumber(sheetJson, [
      ["savingThrows", ability],
      ["saves", ability],
      ["abilities", ability, "save"],
      ["abilities", ability, "modifier"],
      [ability, "save"],
      [ability, "modifier"],
    ]) ?? 0
  );
}

function getSpellSaveDc(sheetJson: Record<string, unknown> | null) {
  return (
    getFirstNumber(sheetJson, [
      ["spellSaveDc"],
      ["spellcasting", "saveDc"],
      ["saveDc"],
    ]) ?? undefined
  );
}

function buildConcentrationStatusLabel() {
  return "Concentrating";
}

function buildConcentrationDuration(
  spellName: string,
  durationRounds: number,
  breakOnDamage = true,
) {
  return {
    effect: "Concentrating",
    source: spellName.trim() || "Spell",
    remainingRounds: Math.max(1, Math.trunc(durationRounds)),
    kind: "concentration" as const,
    breakOnDamage,
  } satisfies CombatStatusDuration;
}

function parseSpellSlotLevel(slot: string | undefined) {
  if (!slot) {
    return 1;
  }
  const match = slot.match(/(\d+)/);
  if (!match) {
    return 1;
  }
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  return Math.max(1, Math.trunc(parsed));
}

function getCharacterLevel(sheetJson: Record<string, unknown> | null) {
  return Math.max(
    1,
    Math.trunc(
      getFirstNumber(sheetJson, [["level"], ["characterLevel"], ["stats", "level"]]) ?? 1,
    ),
  );
}

const DND_XP_BY_CR: Record<string, number> = {
  "0": 10,
  "1/8": 25,
  "1/4": 50,
  "1/2": 100,
  "1": 200,
  "2": 450,
  "3": 700,
  "4": 1100,
  "5": 1800,
  "6": 2300,
  "7": 2900,
  "8": 3900,
  "9": 5000,
  "10": 5900,
  "11": 7200,
  "12": 8400,
  "13": 10000,
  "14": 11500,
  "15": 13000,
  "16": 15000,
  "17": 18000,
  "18": 20000,
  "19": 22000,
  "20": 25000,
  "21": 33000,
  "22": 41000,
  "23": 50000,
  "24": 62000,
  "25": 75000,
  "26": 90000,
  "27": 105000,
  "28": 120000,
  "29": 135000,
  "30": 155000,
};

const DND_THRESHOLDS_BY_LEVEL: Record<
  number,
  { easy: number; medium: number; hard: number; deadly: number }
> = {
  1: { easy: 25, medium: 50, hard: 75, deadly: 100 },
  2: { easy: 50, medium: 100, hard: 150, deadly: 200 },
  3: { easy: 75, medium: 150, hard: 225, deadly: 400 },
  4: { easy: 125, medium: 250, hard: 375, deadly: 500 },
  5: { easy: 250, medium: 500, hard: 750, deadly: 1100 },
  6: { easy: 300, medium: 600, hard: 900, deadly: 1400 },
  7: { easy: 350, medium: 750, hard: 1100, deadly: 1700 },
  8: { easy: 450, medium: 900, hard: 1400, deadly: 2100 },
  9: { easy: 550, medium: 1100, hard: 1600, deadly: 2400 },
  10: { easy: 600, medium: 1200, hard: 1900, deadly: 2800 },
  11: { easy: 800, medium: 1600, hard: 2400, deadly: 3600 },
  12: { easy: 1000, medium: 2000, hard: 3000, deadly: 4500 },
  13: { easy: 1100, medium: 2200, hard: 3400, deadly: 5100 },
  14: { easy: 1250, medium: 2500, hard: 3800, deadly: 5700 },
  15: { easy: 1400, medium: 2800, hard: 4300, deadly: 6400 },
  16: { easy: 1600, medium: 3200, hard: 4800, deadly: 7200 },
  17: { easy: 2000, medium: 3900, hard: 5900, deadly: 8800 },
  18: { easy: 2100, medium: 4200, hard: 6300, deadly: 9500 },
  19: { easy: 2400, medium: 4900, hard: 7300, deadly: 10900 },
  20: { easy: 2800, medium: 5700, hard: 8500, deadly: 12700 },
};

function deriveXpFromCr(cr: string | null | undefined) {
  if (!cr || !cr.trim()) {
    return null;
  }
  const normalized = cr.trim().toLowerCase();
  return DND_XP_BY_CR[normalized] ?? null;
}

function getEnemyMultiplierForAdjustedXp(enemyCount: number, partySize: number) {
  let multiplier = 1;
  if (enemyCount <= 1) {
    multiplier = 1;
  } else if (enemyCount === 2) {
    multiplier = 1.5;
  } else if (enemyCount <= 6) {
    multiplier = 2;
  } else if (enemyCount <= 10) {
    multiplier = 2.5;
  } else if (enemyCount <= 14) {
    multiplier = 3;
  } else {
    multiplier = 4;
  }

  const tierOrder = [1, 1.5, 2, 2.5, 3, 4];
  let tierIndex = tierOrder.indexOf(multiplier);
  if (tierIndex < 0) {
    tierIndex = 0;
  }
  if (partySize < 3 && tierIndex < tierOrder.length - 1) {
    tierIndex += 1;
  } else if (partySize > 5 && tierIndex > 0) {
    tierIndex -= 1;
  }
  return tierOrder[tierIndex] ?? multiplier;
}

function computeDndEncounterChallenge(params: {
  combatants: Array<{ type: "character" | "enemy" | "npc"; name: string; creatureSlug?: string }>;
  creatureEntries: CreatureLibraryEntryRecord[];
  partyLevels: number[];
}) {
  const enemyCombatants = params.combatants.filter((entry) => entry.type === "enemy");
  if (enemyCombatants.length === 0 || params.partyLevels.length === 0) {
    return {
      totalXp: 0,
      adjustedXp: 0,
      difficulty: "Unknown",
      enemyTotal: enemyCombatants.length,
      thresholds: { easy: 0, medium: 0, hard: 0, deadly: 0 },
    };
  }

  const creatureLookup = buildCreatureEntryLookup(params.creatureEntries);
  let totalXp = 0;
  for (const enemy of enemyCombatants) {
    const creature = resolveCreatureEntryForCombatant(creatureLookup, enemy).entry;
    const enemyXp =
      creature && typeof creature.xpDerived === "number" && Number.isFinite(creature.xpDerived)
        ? Math.max(0, Math.trunc(creature.xpDerived))
        : deriveXpFromCr(creature?.cr ?? null) ?? 0;
    totalXp += enemyXp;
  }

  const multiplier = getEnemyMultiplierForAdjustedXp(
    enemyCombatants.length,
    params.partyLevels.length,
  );
  const adjustedXp = Math.max(0, Math.trunc(totalXp * multiplier));

  const thresholds = params.partyLevels.reduce(
    (acc, levelRaw) => {
      const level = Math.max(1, Math.min(20, Math.trunc(levelRaw)));
      const levelThresholds = DND_THRESHOLDS_BY_LEVEL[level] ?? DND_THRESHOLDS_BY_LEVEL[1];
      acc.easy += levelThresholds.easy;
      acc.medium += levelThresholds.medium;
      acc.hard += levelThresholds.hard;
      acc.deadly += levelThresholds.deadly;
      return acc;
    },
    { easy: 0, medium: 0, hard: 0, deadly: 0 },
  );

  let difficulty = "Trivial";
  if (adjustedXp >= thresholds.deadly) {
    difficulty = "Deadly";
  } else if (adjustedXp >= thresholds.hard) {
    difficulty = "Hard";
  } else if (adjustedXp >= thresholds.medium) {
    difficulty = "Medium";
  } else if (adjustedXp >= thresholds.easy) {
    difficulty = "Easy";
  }

  return {
    totalXp,
    adjustedXp,
    difficulty,
    enemyTotal: enemyCombatants.length,
    thresholds,
  };
}

function rebalanceDndEncounterByIntent(params: {
  ruleset: string;
  encounterIntent: string;
  partySize: number;
  combatants: Array<{
    id?: string;
    name: string;
    type: "character" | "enemy" | "npc";
    creatureSlug?: string;
    summary?: string;
  }>;
  creatureEntries: CreatureLibraryEntryRecord[];
  partyLevels: number[];
}) {
  const isDnd = params.ruleset.toLowerCase().includes("d&d");
  if (!isDnd) {
    return {
      combatants: params.combatants,
      telemetry: {
        applied: false,
        beforeAdjustedXp: 0,
        afterAdjustedXp: 0,
        budgetCapXp: 0,
        removedEnemies: 0,
        removedByCountCap: 0,
      },
    };
  }

  const before = computeDndEncounterChallenge({
    combatants: params.combatants,
    creatureEntries: params.creatureEntries,
    partyLevels: params.partyLevels,
  });
  const intent = params.encounterIntent.toLowerCase();
  const budgetCapXp =
    intent === "easy"
      ? Math.max(0, before.thresholds.medium)
      : intent === "hard"
        ? Math.max(0, before.thresholds.deadly)
        : Math.max(0, before.thresholds.hard);
  const enemyCountCap =
    intent === "easy"
      ? Math.max(2, Math.min(3, params.partySize))
      : intent === "hard"
        ? Math.max(3, Math.min(6, params.partySize + 1))
        : Math.max(3, Math.min(4, params.partySize));
  if (budgetCapXp <= 0) {
    return {
      combatants: params.combatants,
      telemetry: {
        applied: false,
        beforeAdjustedXp: before.adjustedXp,
        afterAdjustedXp: before.adjustedXp,
        budgetCapXp,
        removedEnemies: 0,
        removedByCountCap: 0,
      },
    };
  }

  const creatureLookup = buildCreatureEntryLookup(params.creatureEntries);
  const nextCombatants = [...params.combatants];
  let removedEnemies = 0;
  let removedByCountCap = 0;

  while (true) {
    const enemyCount = nextCombatants.filter((entry) => entry.type === "enemy").length;
    if (enemyCount <= enemyCountCap || enemyCount <= 2) {
      break;
    }
    const enemyWithXp = nextCombatants
      .map((entry, index) => ({ entry, index }))
      .filter((item) => item.entry.type === "enemy")
      .map((item) => {
        const creature = resolveCreatureEntryForCombatant(creatureLookup, item.entry).entry;
        const xp =
          creature && typeof creature.xpDerived === "number" && Number.isFinite(creature.xpDerived)
            ? Math.max(0, Math.trunc(creature.xpDerived))
            : deriveXpFromCr(creature?.cr ?? null) ?? 0;
        return { index: item.index, xp };
      })
      .sort((left, right) => right.xp - left.xp);
    const highestXpEnemy = enemyWithXp[0];
    if (!highestXpEnemy) {
      break;
    }
    nextCombatants.splice(highestXpEnemy.index, 1);
    removedEnemies += 1;
    removedByCountCap += 1;
  }

  while (true) {
    const current = computeDndEncounterChallenge({
      combatants: nextCombatants,
      creatureEntries: params.creatureEntries,
      partyLevels: params.partyLevels,
    });
    const enemyCount = nextCombatants.filter((entry) => entry.type === "enemy").length;
    if (current.adjustedXp <= budgetCapXp || enemyCount <= 2) {
      break;
    }
    const enemyWithXp = nextCombatants
      .map((entry, index) => ({ entry, index }))
      .filter((item) => item.entry.type === "enemy")
      .map((item) => {
        const creature = resolveCreatureEntryForCombatant(creatureLookup, item.entry).entry;
        const xp =
          creature && typeof creature.xpDerived === "number" && Number.isFinite(creature.xpDerived)
            ? Math.max(0, Math.trunc(creature.xpDerived))
            : deriveXpFromCr(creature?.cr ?? null) ?? 0;
        return {
          index: item.index,
          xp,
        };
      })
      .sort((left, right) => right.xp - left.xp);
    const highestXpEnemy = enemyWithXp[0];
    if (!highestXpEnemy) {
      break;
    }
    nextCombatants.splice(highestXpEnemy.index, 1);
    removedEnemies += 1;
  }

  const uniqueEnemyNames = ensureUniqueEnemyNames(nextCombatants);
  const after = computeDndEncounterChallenge({
    combatants: uniqueEnemyNames.combatants,
    creatureEntries: params.creatureEntries,
    partyLevels: params.partyLevels,
  });

  return {
    combatants: uniqueEnemyNames.combatants,
    telemetry: {
      applied: removedEnemies > 0,
      beforeAdjustedXp: before.adjustedXp,
      afterAdjustedXp: after.adjustedXp,
      budgetCapXp,
      removedEnemies,
      removedByCountCap,
    },
  };
}

function composeDndEnemiesFromCreatureLibrary(params: {
  ruleset: string;
  encounterIntent: string;
  averageLevel: number;
  combatants: Array<{
    id?: string;
    name: string;
    type: "character" | "enemy" | "npc";
    creatureSlug?: string;
    summary?: string;
  }>;
  creatureEntries: CreatureLibraryEntryRecord[];
  narrativeMentionedCreatureNames: string[];
}) {
  const isDnd = params.ruleset.toLowerCase().includes("d&d");
  if (!isDnd) {
    return {
      combatants: params.combatants,
      telemetry: {
        applied: false,
        replacedUnmatched: 0,
        replacedOverCap: 0,
        xpCapPerEnemy: 0,
      },
    };
  }
  const creatureLookup = buildCreatureEntryLookup(params.creatureEntries);
  const narrativePool = params.narrativeMentionedCreatureNames
    .map((name) =>
      resolveCreatureEntryForCombatant(creatureLookup, {
        name,
      }).entry,
    )
    .filter((entry): entry is CreatureLibraryEntryRecord => Boolean(entry));
  const uniqueNarrativePool = Array.from(
    new Map(narrativePool.map((entry) => [entry.slug.toLowerCase(), entry])).values(),
  );
  const xpCapPerEnemy =
    params.encounterIntent === "easy"
      ? params.averageLevel <= 2
        ? 100
        : 200
      : params.encounterIntent === "hard"
        ? params.averageLevel <= 2
          ? 450
          : 700
        : params.averageLevel <= 2
          ? 200
          : 450;
  const getCreatureXp = (entry: CreatureLibraryEntryRecord) =>
    typeof entry.xpDerived === "number" && Number.isFinite(entry.xpDerived)
      ? Math.max(0, Math.trunc(entry.xpDerived))
      : deriveXpFromCr(entry.cr ?? null) ?? 0;
  const cappedNarrativePool = uniqueNarrativePool.filter(
    (entry) => getCreatureXp(entry) <= xpCapPerEnemy,
  );
  const cappedCreaturePool = params.creatureEntries.filter(
    (entry) => getCreatureXp(entry) <= xpCapPerEnemy,
  );
  const fallbackCreature =
    cappedNarrativePool[0] ??
    cappedCreaturePool.find((entry) =>
      normalizeCreatureNameForLookup(entry.name).includes("zombie"),
    ) ??
    cappedCreaturePool[0] ??
    params.creatureEntries.find((entry) =>
      normalizeCreatureNameForLookup(entry.name).includes("zombie"),
    ) ??
    params.creatureEntries[0] ??
    null;

  let replacedUnmatched = 0;
  let replacedOverCap = 0;
  const enemyNameCounts = new Map<string, number>();
  const buildUniqueEnemyName = (baseName: string) => {
    const normalizedBase = stripTrailingEnemySerial(baseName) || baseName;
    const nextCount = (enemyNameCounts.get(normalizedBase.toLowerCase()) ?? 0) + 1;
    enemyNameCounts.set(normalizedBase.toLowerCase(), nextCount);
    return nextCount <= 1 ? normalizedBase : `${normalizedBase} ${nextCount}`;
  };

  const composed = params.combatants.map((entry) => {
    if (entry.type !== "enemy") {
      return entry;
    }
    let resolved = resolveCreatureEntryForCombatant(creatureLookup, entry).entry;
    if (!resolved && fallbackCreature) {
      resolved = fallbackCreature;
      replacedUnmatched += 1;
    }
    if (!resolved) {
      return entry;
    }
    const resolvedXp = getCreatureXp(resolved);
    if (resolvedXp > xpCapPerEnemy) {
      const replacement =
        cappedNarrativePool[0] ??
        cappedCreaturePool.find((candidate) =>
          normalizeCreatureNameForLookup(candidate.name).includes("zombie"),
        ) ??
        cappedCreaturePool[0] ??
        null;
      if (replacement && replacement.slug !== resolved.slug) {
        resolved = replacement;
        replacedOverCap += 1;
      }
    }
    return {
      ...entry,
      name: buildUniqueEnemyName(resolved.name),
      creatureSlug: resolved.slug,
      summary: entry.summary ?? resolved.creatureType ?? undefined,
    };
  });

  return {
    combatants: composed,
    telemetry: {
      applied: replacedUnmatched > 0 || replacedOverCap > 0,
      replacedUnmatched,
      replacedOverCap,
      xpCapPerEnemy,
    },
  };
}

function getGridTileDistance(
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  return Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
}

function parseGridKey(key: string) {
  const [xRaw, yRaw] = key.split(",");
  const x = Number(xRaw);
  const y = Number(yRaw);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return {
    x: Math.trunc(x),
    y: Math.trunc(y),
  };
}

function getCombatantCenterPoint(seed: {
  gridX?: number;
  gridY?: number;
  tokenFootprintCols?: number;
  tokenFootprintRows?: number;
}) {
  if (
    typeof seed.gridX !== "number" ||
    !Number.isFinite(seed.gridX) ||
    typeof seed.gridY !== "number" ||
    !Number.isFinite(seed.gridY)
  ) {
    return null;
  }
  const cols = normalizeFootprintValue(seed.tokenFootprintCols);
  const rows = normalizeFootprintValue(seed.tokenFootprintRows);
  return {
    x: seed.gridX + cols / 2,
    y: seed.gridY + rows / 2,
  };
}

function getMinimumTileDistanceBetweenCombatants(
  actor: {
    gridX?: number;
    gridY?: number;
    tokenFootprintCols?: number;
    tokenFootprintRows?: number;
  },
  target: {
    gridX?: number;
    gridY?: number;
    tokenFootprintCols?: number;
    tokenFootprintRows?: number;
  },
) {
  const actorKeys = getCombatantOccupiedKeys(actor)
    .map(parseGridKey)
    .filter((entry): entry is { x: number; y: number } => Boolean(entry));
  const targetKeys = getCombatantOccupiedKeys(target)
    .map(parseGridKey)
    .filter((entry): entry is { x: number; y: number } => Boolean(entry));
  if (actorKeys.length === 0 || targetKeys.length === 0) {
    return Number.POSITIVE_INFINITY;
  }
  let minimumDistance = Number.POSITIVE_INFINITY;
  for (const actorKey of actorKeys) {
    for (const targetKey of targetKeys) {
      minimumDistance = Math.min(
        minimumDistance,
        getGridTileDistance(actorKey, targetKey),
      );
    }
  }
  return minimumDistance;
}

function hasBlockedTilesOnLineOfSight(params: {
  actor: {
    gridX?: number;
    gridY?: number;
    tokenFootprintCols?: number;
    tokenFootprintRows?: number;
  };
  target: {
    gridX?: number;
    gridY?: number;
    tokenFootprintCols?: number;
    tokenFootprintRows?: number;
  };
  blockedTileSet: Set<string>;
}) {
  if (params.blockedTileSet.size === 0) {
    return false;
  }
  const actorCenter = getCombatantCenterPoint(params.actor);
  const targetCenter = getCombatantCenterPoint(params.target);
  if (!actorCenter || !targetCenter) {
    return false;
  }

  const actorOccupied = new Set(getCombatantOccupiedKeys(params.actor));
  const targetOccupied = new Set(getCombatantOccupiedKeys(params.target));
  const steps = Math.max(
    1,
    Math.ceil(
      Math.max(
        Math.abs(targetCenter.x - actorCenter.x),
        Math.abs(targetCenter.y - actorCenter.y),
      ) * 4,
    ),
  );
  const visitedTiles = new Set<string>();
  for (let step = 0; step <= steps; step += 1) {
    const progress = step / steps;
    const x = actorCenter.x + (targetCenter.x - actorCenter.x) * progress;
    const y = actorCenter.y + (targetCenter.y - actorCenter.y) * progress;
    const tileKey = `${Math.floor(x)},${Math.floor(y)}`;
    if (visitedTiles.has(tileKey)) {
      continue;
    }
    visitedTiles.add(tileKey);
    if (actorOccupied.has(tileKey) || targetOccupied.has(tileKey)) {
      continue;
    }
    if (params.blockedTileSet.has(tileKey)) {
      return true;
    }
  }
  return false;
}

function getCombatMovementTilesPerMove(
  ruleset: string,
  sheetJson: Record<string, unknown> | null,
) {
  const normalizedRuleset = ruleset.trim().toLowerCase();
  if (!normalizedRuleset.includes("d&d")) {
    return 6;
  }
  const speedFeetRaw =
    getFirstNumber(sheetJson, [
      ["speed"],
      ["movement", "speed"],
      ["stats", "speed"],
      ["derivedStats", "speed"],
    ]) ?? 30;
  const speedFeet = Math.max(5, Math.trunc(speedFeetRaw));
  return Math.max(1, Math.floor(speedFeet / 5));
}

function applyMovementToCombatState(
  state: ReturnType<typeof normalizeCombatState>,
  actorRef: string,
  destination: { x: number; y: number },
) {
  const normalizedActorRef = actorRef.trim().toLowerCase();
  const actorIndex = state.roster.findIndex((entry) => {
    const ref = (entry.id ?? entry.name).trim().toLowerCase();
    return ref === normalizedActorRef;
  });
  if (actorIndex < 0) {
    return state;
  }
  const nextRoster = state.roster.map((entry, index) =>
    index === actorIndex
      ? {
          ...entry,
          gridX: destination.x,
          gridY: destination.y,
        }
      : entry,
  );
  return {
    ...state,
    roster: nextRoster,
  };
}

function getDndCantripDamageDiceCount(level: number) {
  if (level >= 17) {
    return 4;
  }
  if (level >= 11) {
    return 3;
  }
  if (level >= 5) {
    return 2;
  }
  return 1;
}

function collectSpellNamesFromNested(value: unknown, names: Set<string>, depth = 0) {
  if (depth > 6 || value == null) {
    return;
  }
  if (typeof value === "string") {
    if (value.trim()) {
      names.add(value.trim().toLowerCase());
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectSpellNamesFromNested(entry, names, depth + 1);
    }
    return;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.name === "string" && record.name.trim()) {
      names.add(record.name.trim().toLowerCase());
    }
    for (const nestedValue of Object.values(record)) {
      collectSpellNamesFromNested(nestedValue, names, depth + 1);
    }
  }
}

function getKnownSpellNames(sheetJson: Record<string, unknown> | null) {
  if (!sheetJson) {
    return new Set<string>();
  }
  const names = new Set<string>();
  collectSpellNamesFromNested(sheetJson.spells, names);
  collectSpellNamesFromNested(sheetJson.spellbook, names);
  collectSpellNamesFromNested(sheetJson.knownSpells, names);
  collectSpellNamesFromNested(sheetJson.spellcasting, names);
  collectSpellNamesFromNested(sheetJson.preparedSpells, names);
  collectSpellNamesFromNested(sheetJson.signatureSpell, names);
  return names;
}

type ReactionWindow = {
  targetRef: string;
  targetName: string;
  triggers: string[];
  availableReactions: string[];
};

function buildReactionWindows(params: {
  kind: string;
  resolution: Record<string, unknown>;
  targetRef: string;
  targetName: string;
  targetCharacter: { sheetJson: Record<string, unknown> | null } | null;
  targetReactionUsed?: boolean;
  catalogReactionHooks?: Array<{ trigger: string; note: string }> | null;
}) {
  const windows: ReactionWindow[] = [];
  if (params.kind !== "attack" && params.kind !== "cast-spell") {
    return windows;
  }

  const hit =
    typeof params.resolution.hit === "boolean"
      ? params.resolution.hit
      : typeof params.resolution.saveSucceeded === "boolean"
        ? !params.resolution.saveSucceeded
        : true;
  if (!hit) {
    return windows;
  }

  const spellNames = getKnownSpellNames(params.targetCharacter?.sheetJson ?? null);
  const availableReactions: string[] = [];
  const triggers = ["when_hit_by_attack"];

  if (spellNames.has("shield") && !params.targetReactionUsed) {
    availableReactions.push("Shield");
  }

  if (Array.isArray(params.catalogReactionHooks)) {
    for (const hook of params.catalogReactionHooks) {
      if (hook?.trigger && !triggers.includes(hook.trigger)) {
        triggers.push(hook.trigger);
      }
      if (hook?.note) {
        availableReactions.push(hook.note);
      }
    }
  }

  if (availableReactions.length === 0) {
    return windows;
  }

  windows.push({
    targetRef: params.targetRef,
    targetName: params.targetName,
    triggers,
    availableReactions,
  });

  return windows;
}

function targetHasShieldReaction(character: { sheetJson: Record<string, unknown> | null } | null) {
  const spellNames = getKnownSpellNames(character?.sheetJson ?? null);
  return spellNames.has("shield");
}

function targetHasAvailableSpellSlots(character: {
  sheetJson: Record<string, unknown> | null;
} | null) {
  const sheet = asObject(character?.sheetJson);
  const spellSlots = asObject(sheet?.spellSlots);
  if (!spellSlots) {
    return false;
  }
  return Object.values(spellSlots).some(
    (value) =>
      typeof value === "number" && Number.isFinite(value) && Math.trunc(value) > 0,
  );
}

function isReactionUsedInCombatState(
  state: ReturnType<typeof normalizeCombatState>,
  targetRef: string,
) {
  const normalizedTarget = targetRef.trim().toLowerCase();
  const entry =
    state.roster.find(
      (current) =>
        (current.id ?? "").trim().toLowerCase() === normalizedTarget ||
        current.name.trim().toLowerCase() === normalizedTarget,
    ) ?? null;
  if (!entry || !Array.isArray(entry.statusEffects)) {
    return false;
  }
  return entry.statusEffects.some(
    (effect) => typeof effect === "string" && effect.trim().toLowerCase() === "reaction used",
  );
}

function normalizeCombatStatusDurations(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as CombatStatusDuration[];
  }
  return value
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => {
      const typedEntry = entry as Record<string, unknown>;
      const effect = parseString(typedEntry.effect);
      const remainingRounds = parseOptionalNumber(typedEntry.remainingRounds);
      const source = parseString(typedEntry.source) || undefined;
      const kindRaw = parseString(typedEntry.kind).toLowerCase();
      const kind: CombatStatusDuration["kind"] =
        kindRaw === "concentration" || kindRaw === "timed" ? kindRaw : undefined;
      const breakOnDamage = typedEntry.breakOnDamage === true;
      if (!effect || !remainingRounds || remainingRounds <= 0) {
        return null;
      }
      return {
        effect,
        remainingRounds: Math.max(1, Math.trunc(remainingRounds)),
        source,
        kind,
        breakOnDamage,
      } satisfies CombatStatusDuration;
    })
    .filter((entry): entry is CombatStatusDuration => Boolean(entry));
}

function buildDurationKey(duration: CombatStatusDuration) {
  return `${duration.effect.trim().toLowerCase()}::${(duration.source ?? "").trim().toLowerCase()}`;
}

function applyStatusEffectsToCombatState(
  state: ReturnType<typeof normalizeCombatState>,
  targetRef: string,
  effects: string[],
  options?: {
    durations?: CombatStatusDuration[];
    replaceConcentration?: boolean;
  },
) {
  if (!effects.length && !(options?.durations?.length)) {
    return state;
  }

  const normalizedTarget = targetRef.trim().toLowerCase();
  const roster = state.roster.map((entry) => {
    const ref = (entry.id ?? entry.name).trim().toLowerCase();
    const name = entry.name.trim().toLowerCase();
    if (ref !== normalizedTarget && name !== normalizedTarget) {
      return entry;
    }

    const currentEffects = Array.isArray(entry.statusEffects)
      ? entry.statusEffects.filter(
          (effect): effect is string => typeof effect === "string" && effect.trim().length > 0,
        )
      : [];
    const currentDurations = normalizeCombatStatusDurations((entry as { statusDurations?: unknown }).statusDurations);
    const replacedDurations = options?.replaceConcentration
      ? currentDurations.filter(
          (duration) =>
            !(duration.kind === "concentration" || duration.effect.toLowerCase() === "concentrating"),
        )
      : currentDurations;
    const incomingDurations = normalizeCombatStatusDurations(options?.durations ?? []);
    const mergedDurationMap = new Map<string, CombatStatusDuration>();
    for (const duration of replacedDurations) {
      mergedDurationMap.set(buildDurationKey(duration), duration);
    }
    for (const duration of incomingDurations) {
      mergedDurationMap.set(buildDurationKey(duration), duration);
    }
    const mergedDurations = Array.from(mergedDurationMap.values());

    const merged = mergeUniqueStatusEffects(currentEffects, effects);
    for (const duration of mergedDurations) {
      if (!merged.some((effect) => effect.toLowerCase() === duration.effect.toLowerCase())) {
        merged.push(duration.effect);
      }
    }
    const normalizedMerged =
      options?.replaceConcentration
        ? merged.filter((effect) => effect.toLowerCase() !== "concentrating" || mergedDurations.some((duration) => duration.effect.toLowerCase() === "concentrating"))
        : merged;

    return {
      ...entry,
      statusEffects: normalizedMerged,
      statusDurations: mergedDurations,
    };
  });

  return normalizeCombatState({
    ...state,
    roster,
  });
}

function getCombatEntryByRef(
  state: ReturnType<typeof normalizeCombatState>,
  targetRef: string,
) {
  const normalizedTarget = targetRef.trim().toLowerCase();
  return (
    state.roster.find((entry) => {
      const ref = (entry.id ?? entry.name).trim().toLowerCase();
      const name = entry.name.trim().toLowerCase();
      return ref === normalizedTarget || name === normalizedTarget;
    }) ?? null
  );
}

function syncConcentrationStatusEffect(
  currentStatusEffects: unknown,
  combatEntryStatusEffects: unknown,
) {
  const current = Array.isArray(currentStatusEffects)
    ? currentStatusEffects.filter(
        (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
      )
    : [];
  const combat = Array.isArray(combatEntryStatusEffects)
    ? combatEntryStatusEffects.filter(
        (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
      )
    : [];
  const withoutConcentrating = current.filter(
    (entry) => entry.trim().toLowerCase() !== "concentrating",
  );
  if (combat.some((entry) => entry.trim().toLowerCase() === "concentrating")) {
    return mergeUniqueStatusEffects(withoutConcentrating, ["Concentrating"]);
  }
  return withoutConcentrating;
}

function parseHpString(value: string | undefined) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  const fractionMatch = trimmed.match(/^(-?\d+)\s*\/\s*(-?\d+)$/);
  if (fractionMatch) {
    const current = Number(fractionMatch[1]);
    const max = Number(fractionMatch[2]);
    if (Number.isFinite(current) && Number.isFinite(max) && max > 0) {
      return {
        current: Math.max(0, Math.min(max, Math.trunc(current))),
        max: Math.max(1, Math.trunc(max)),
      };
    }
  }

  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) {
    const safeValue = Math.max(0, Math.trunc(numeric));
    return {
      current: safeValue,
      max: safeValue,
    };
  }

  return null;
}

function deriveHpFromCharacterSheet(sheetJson: Record<string, unknown> | null) {
  const sheet = asObject(sheetJson);
  if (!sheet) {
    return undefined;
  }

  const windObject = asObject(sheet.wind);
  if (windObject) {
    const current = parseOptionalNumber(windObject.current);
    const max = parseOptionalNumber(windObject.max);
    if (current !== undefined || max !== undefined) {
      const safeMax = Math.max(1, Math.trunc(max ?? current ?? 1));
      const safeCurrent = Math.max(0, Math.min(safeMax, Math.trunc(current ?? safeMax)));
      return `${safeCurrent}/${safeMax}`;
    }
  }

  const windScalar = parseOptionalNumber(sheet.wind);
  if (windScalar !== undefined) {
    const safeValue = Math.max(0, Math.trunc(windScalar));
    return `${safeValue}/${Math.max(1, safeValue)}`;
  }

  const hpObject = asObject(sheet.hp);
  if (hpObject) {
    const current = parseOptionalNumber(hpObject.current);
    const max = parseOptionalNumber(hpObject.max);
    if (current !== undefined || max !== undefined) {
      const safeMax = Math.max(1, Math.trunc(max ?? current ?? 1));
      const safeCurrent = Math.max(0, Math.min(safeMax, Math.trunc(current ?? safeMax)));
      return `${safeCurrent}/${safeMax}`;
    }
  }

  const hpScalar = parseOptionalNumber(sheet.hp);
  if (hpScalar !== undefined) {
    const safeValue = Math.max(0, Math.trunc(hpScalar));
    return `${safeValue}/${Math.max(1, safeValue)}`;
  }

  return undefined;
}

function hydrateCombatStateResources(
  state: ReturnType<typeof normalizeCombatState>,
  characters: Array<{ id: string; name: string; sheetJson: Record<string, unknown> | null }>,
  adapterProfile: "dnd" | "deadlands" | "generic",
) {
  if (!state.combatActive || state.roster.length === 0) {
    return state;
  }

  const roster = state.roster.map((entry) => {
    const currentHp = parseCombatResourceString(entry.hp);
    if (currentHp && parseHpString(currentHp)) {
      return entry;
    }
    if (entry.type === "enemy") {
      return {
        ...entry,
        hp: defaultEnemyHpForProfile(adapterProfile),
      };
    }
    if (entry.type !== "character") {
      return entry;
    }

    const linkedCharacter = findCharacterByRef(characters, entry.id ?? entry.name);
    if (!linkedCharacter) {
      return entry;
    }

    const derivedHp = deriveHpFromCharacterSheet(linkedCharacter.sheetJson);
    if (!derivedHp) {
      return entry;
    }

    return {
      ...entry,
      hp: derivedHp,
    };
  });

  return normalizeCombatState({
    ...state,
    roster,
  });
}

function defaultEnemyHpForProfile(profile: string) {
  if (profile === "dnd") {
    return "12/12";
  }
  if (profile === "deadlands") {
    return "10/10";
  }
  return "8/8";
}

function defaultEnemySummaryForProfile(
  profile: string,
  currentSummary: string | undefined,
) {
  if (currentSummary && currentSummary.trim().length > 0) {
    return currentSummary.trim();
  }
  if (profile === "deadlands") {
    return "Wounds 0/4";
  }
  return undefined;
}

function toDeadlandsWoundLevel(wounds: number) {
  if (wounds <= 0) {
    return "Unharmed";
  }
  if (wounds === 1) {
    return "Light";
  }
  if (wounds === 2) {
    return "Heavy";
  }
  if (wounds === 3) {
    return "Serious";
  }
  return "Critical";
}

function consumeSpellSlot(
  sheetJson: Record<string, unknown> | null,
  requestedSlot: string | undefined,
) {
  const sheet = asObject(sheetJson);
  if (!sheet) {
    return {
      ok: false,
      reason: "Caster has no sheet data to track spell slots.",
      nextSheet: sheetJson,
    };
  }

  const spellSlots = asObject(sheet.spellSlots);
  if (!spellSlots) {
    return {
      ok: false,
      reason: "No spell slots are available.",
      nextSheet: sheet,
    };
  }

  const slotEntries = Object.entries(spellSlots).filter(([, value]) =>
    typeof value === "number" && Number.isFinite(value),
  ) as Array<[string, number]>;
  if (slotEntries.length === 0) {
    return {
      ok: false,
      reason: "No spell slots are available.",
      nextSheet: sheet,
    };
  }

  const chosenSlot =
    (requestedSlot && slotEntries.find(([slotName]) => slotName === requestedSlot)?.[0]) ??
    slotEntries.find(([, value]) => value > 0)?.[0] ??
    null;
  if (!chosenSlot) {
    return {
      ok: false,
      reason: "No spell slots remaining.",
      nextSheet: sheet,
    };
  }

  const currentValue = spellSlots[chosenSlot];
  const numericValue =
    typeof currentValue === "number" && Number.isFinite(currentValue)
      ? Math.max(0, Math.trunc(currentValue))
      : 0;
  if (numericValue <= 0) {
    return {
      ok: false,
      reason: `No remaining slots in ${chosenSlot}.`,
      nextSheet: sheet,
    };
  }

  const nextSlots = {
    ...spellSlots,
    [chosenSlot]: numericValue - 1,
  };

  return {
    ok: true,
    consumedSlot: chosenSlot,
    nextSheet: {
      ...sheet,
      spellSlots: nextSlots,
    },
  };
}

export async function POST(req: NextRequest, context: RouteContext) {
  const debugLoggingEnabled = req.headers.get("x-debug-state-logging") === "true";
  const requestStartedAt = Date.now();
  const submitTiming: Record<string, number | string | boolean> = {};
  const { id } = await context.params;
  const rawBody = await req.json().catch(() => ({}));
  const body =
    rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
      ? (rawBody as Record<string, unknown>)
      : {};
  const action = parseString(body.action).toLowerCase();
  const prismaAny = prisma as unknown as {
    battleMapTemplate: {
      findFirst: (args: Record<string, unknown>) => Promise<BattleMapTemplateRecord | null>;
      findMany: (args: Record<string, unknown>) => Promise<BattleMapTemplateRecord[]>;
      findUnique: (args: Record<string, unknown>) => Promise<BattleMapTemplateRecord | null>;
    };
    tokenLibraryEntry: {
      findMany: (args: Record<string, unknown>) => Promise<TokenLibraryEntryRecord[]>;
    };
  };

  if (!action) {
    return NextResponse.json({ error: "Action is required." }, { status: 400 });
  }
  const localFastModeRequested = action === "submit" && parseBoolean(body.localFastMode, false);
  const runtimePayload = asObject(body.runtime);
  const runtimeRuleset = parseString(runtimePayload?.ruleset);
  const runtimeCombatStateRaw = runtimePayload?.combatStateJson;
  const runtimeCharactersRaw = Array.isArray(runtimePayload?.characters)
    ? runtimePayload?.characters
    : [];
  const runtimeCharacters = runtimeCharactersRaw
    .map((entry) => {
      const typed = asObject(entry);
      if (!typed) {
        return null;
      }
      const idValue = parseString(typed.id);
      const name = parseString(typed.name);
      const sheetJson = asObject(typed.sheetJson);
      if (!idValue || !name) {
        return null;
      }
      return {
        id: idValue,
        name,
        sheetJson: sheetJson ?? null,
      };
    })
    .filter(
      (
        entry,
      ): entry is {
        id: string;
        name: string;
        sheetJson: Record<string, unknown> | null;
      } => Boolean(entry),
    );
  const usingRuntimeCampaign =
    localFastModeRequested &&
    runtimeRuleset.length > 0 &&
    runtimeCharacters.length > 0;

  const campaignLookupStartedAt = Date.now();
  const campaign = usingRuntimeCampaign
    ? ({
        id,
        title: "Runtime Combat",
        ruleset: runtimeRuleset,
        bootstrapJson: null,
        combatStateJson: runtimeCombatStateRaw ?? DEFAULT_COMBAT_STATE,
        characters: runtimeCharacters,
        messages: [],
      } as {
        id: string;
        title: string;
        ruleset: string;
        bootstrapJson: unknown;
        combatStateJson: unknown;
        characters: Array<{ id: string; name: string; sheetJson: Record<string, unknown> | null }>;
        messages: Array<{ id: string; role: string; content: string }>;
      })
    : action === "start"
      ? await prisma.campaign.findUnique({
          where: { id },
          select: {
            id: true,
            title: true,
            ruleset: true,
            bootstrapJson: true,
            combatStateJson: true,
            characters: {
              select: {
                id: true,
                name: true,
                sheetJson: true,
              },
            },
            messages: {
              orderBy: { createdAt: "desc" },
              take: 8,
              select: {
                id: true,
                role: true,
                content: true,
              },
            },
          },
        })
      : await prisma.campaign.findUnique({
          where: { id },
          select: {
            id: true,
            ruleset: true,
            combatStateJson: true,
            characters: {
              select: {
                id: true,
                name: true,
                sheetJson: true,
              },
            },
          },
        });
  submitTiming.campaignLookupMs = Date.now() - campaignLookupStartedAt;

  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }

  const currentCombatState = normalizeCombatState(
    (campaign as { combatStateJson?: unknown }).combatStateJson,
  );
  const adapterProfile = getCombatRulesetProfile(campaign.ruleset);
  const hydratedCombatState = hydrateCombatStateResources(
    currentCombatState,
    campaign.characters,
    adapterProfile,
  );
  const messageIdForSeed =
    "messages" in campaign &&
    Array.isArray((campaign as { messages?: Array<{ id?: string }> }).messages)
      ? ((campaign as { messages?: Array<{ id?: string }> }).messages?.[0]?.id ?? "no-message")
      : "no-message";

  if (action === "start") {
    const seeds = Array.isArray(body.combatants)
      ? body.combatants
          .map((entry) => {
            if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
              return null;
            }

            const typedEntry = entry as Record<string, unknown>;
            const name = parseString(typedEntry.name);
            if (!name) {
              return null;
            }

            const rawType = parseString(typedEntry.type).toLowerCase();
            const type = rawType === "enemy" || rawType === "npc" ? rawType : "character";
            const summary = parseString(typedEntry.summary) || undefined;
            const hp = parseCombatResourceString(typedEntry.hp);
            const idValue = parseString(typedEntry.id) || undefined;
            const statusEffects = Array.isArray(typedEntry.statusEffects)
              ? typedEntry.statusEffects
                  .filter((value): value is string => typeof value === "string")
                  .map((value) => value.trim())
                  .filter(Boolean)
              : undefined;
            const statusDurations = normalizeCombatStatusDurations(typedEntry.statusDurations);

            const linkedCharacter =
              type === "character"
                ? findCharacterByRef(campaign.characters, idValue || name)
                : null;
            const characterTokenDataUrl = linkedCharacter
              ? deriveCharacterTokenDataUrl(linkedCharacter.sheetJson)
              : undefined;

            return {
              id: idValue,
              name,
              type,
              creatureSlug: parseString(typedEntry.creatureSlug) || undefined,
              creatureSize: parseString(typedEntry.creatureSize) || undefined,
              gridX: parseOptionalNumber(typedEntry.gridX),
              gridY: parseOptionalNumber(typedEntry.gridY),
              tokenFootprintCols: parseOptionalNumber(typedEntry.tokenFootprintCols),
              tokenFootprintRows: parseOptionalNumber(typedEntry.tokenFootprintRows),
              summary: defaultEnemySummaryForProfile(
                adapterProfile,
                summary,
              ),
              hp:
                hp ||
                (linkedCharacter
                  ? deriveHpFromCharacterSheet(linkedCharacter.sheetJson)
                  : type === "enemy"
                    ? defaultEnemyHpForProfile(adapterProfile)
                    : undefined),
              statusEffects,
              statusDurations,
              tokenImageDataUrl: characterTokenDataUrl,
              tokenLabel: characterTokenDataUrl ? name : undefined,
              initiativeModifier: getInitiativeModifier({
                ruleset: campaign.ruleset,
                rosterType: type,
                character: linkedCharacter,
                explicitModifier: parseOptionalNumber(typedEntry.initiativeModifier),
              }),
            };
          })
          .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      : [];
    const dedupedSeeds = dedupeStartCombatants(seeds);

    const fallbackBootstrap = buildInitialCampaignBootstrap({
      title: campaign.title,
      ruleset: campaign.ruleset,
      startingScenario: campaign.messages[0]?.content ?? "",
    });
    const normalizedBootstrap = normalizeCampaignBootstrap(
      (campaign as { bootstrapJson?: unknown }).bootstrapJson,
      fallbackBootstrap,
    );
    const seedInput = parseString(body.seedInput) || `${id}|${messageIdForSeed}|start`;
    const encounterResolved = resolveEncounterStart({
      ruleset: campaign.ruleset,
      adapterProfile,
      bootstrap: normalizedBootstrap,
      combatants: dedupedSeeds.combatants,
      characters: campaign.characters.map((entry) => ({
        id: entry.id,
        name: entry.name,
        sheetJson: entry.sheetJson,
      })),
      seedInput,
    });
    const resolvedSeeds = encounterResolved.combatants;
    const latestMessageText = parseString(campaign.messages[0]?.content);
    const latestGmMessageText =
      parseString(
        campaign.messages.find((entry) => entry.role.trim().toLowerCase() === "gm")?.content,
      ) || "";
    const narrativeContextText = [latestGmMessageText, latestMessageText]
      .filter(Boolean)
      .join("\n");
    const genericEnemyCount = resolvedSeeds.filter(
      (entry) => entry.type === "enemy" && isGenericHostileEnemyName(entry.name),
    ).length;
    const narrativeCreatureCandidates =
      genericEnemyCount > 0
        ? await prisma.creatureLibraryEntry.findMany({
            where: {
              ruleset: { equals: campaign.ruleset, mode: "insensitive" },
            },
            select: {
              name: true,
            },
            orderBy: { name: "asc" },
            take: 2000,
          })
        : [];
    const narrativeMentionedCreatureNames =
      genericEnemyCount > 0
        ? extractMentionedCreatureNamesFromNarrative(
            narrativeContextText || normalizedBootstrap.campaign.starting_scene,
            narrativeCreatureCandidates.map((entry) => entry.name),
          )
        : [];
    const genericEnemyRepair = repairGenericEnemyNamesFromNarrative(
      resolvedSeeds,
      narrativeMentionedCreatureNames,
    );
    const uniqueEnemyNames = ensureUniqueEnemyNames(genericEnemyRepair.combatants);
    const partyLevels = campaign.characters.map((entry) =>
      getCharacterLevel(asObject(entry.sheetJson)),
    );
    const creatureEntries = uniqueEnemyNames.combatants.some((entry) => entry.type === "enemy")
      ? await prisma.creatureLibraryEntry.findMany({
          where: {
            ruleset: { equals: campaign.ruleset, mode: "insensitive" },
          },
          select: {
            id: true,
            ruleset: true,
            name: true,
            slug: true,
            size: true,
            creatureType: true,
            subtype: true,
            cr: true,
            xpDerived: true,
            acJson: true,
            hpFormula: true,
            hpAvg: true,
            speedJson: true,
            abilityModsJson: true,
            attackProfilesJson: true,
          },
          take: 2000,
        })
      : [];
    const intentComposed = composeDndEnemiesFromCreatureLibrary({
      ruleset: campaign.ruleset,
      encounterIntent:
        encounterResolved.debug.encounterIntent ||
        normalizedBootstrap.combat_generation.encounterIntent ||
        "standard",
      averageLevel: encounterResolved.debug.averageLevel,
      combatants: uniqueEnemyNames.combatants,
      creatureEntries,
      narrativeMentionedCreatureNames,
    });
    const intentRebalance = rebalanceDndEncounterByIntent({
      ruleset: campaign.ruleset,
      encounterIntent:
        encounterResolved.debug.encounterIntent ||
        normalizedBootstrap.combat_generation.encounterIntent ||
        "standard",
      partySize: encounterResolved.debug.partySize,
      combatants: intentComposed.combatants,
      creatureEntries,
      partyLevels,
    });
    const { startReadyCombatants: startReadySeeds, enemyAssignments: resolvedEnemyTelemetry } =
      normalizeCombatStartSeedsWithTelemetry({
        inputCombatants: dedupedSeeds.combatants,
        resolvedCombatants: intentRebalance.combatants,
        adapterProfile,
      });
    const tokenEntries = await prismaAny.tokenLibraryEntry.findMany({
      where: {
        ruleset: { equals: campaign.ruleset, mode: "insensitive" },
        entityType: { equals: "enemy", mode: "insensitive" },
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      take: 5000,
      select: {
        id: true,
        entityType: true,
        ruleset: true,
        category: true,
        subtype: true,
        normalizedKey: true,
        label: true,
      },
    });
    const tokenBindingBase = bindEnemyTokensToCombatants(
      startReadySeeds.map((entry) =>
        entry.type === "character"
          ? {
              ...entry,
              tokenFootprintCols: normalizeFootprintValue(entry.tokenFootprintCols),
              tokenFootprintRows: normalizeFootprintValue(entry.tokenFootprintRows),
            }
          : entry,
      ),
      tokenEntries,
      creatureEntries,
    );
    const selectedTokenIds = Array.from(
      new Set(
        tokenBindingBase.combatants
          .map((entry) => entry.tokenLibraryId)
          .filter(
            (tokenLibraryId): tokenLibraryId is string =>
              typeof tokenLibraryId === "string" && tokenLibraryId.trim().length > 0,
          ),
      ),
    );
    const selectedTokenImages =
      selectedTokenIds.length > 0
        ? await prismaAny.tokenLibraryEntry.findMany({
            where: {
              id: { in: selectedTokenIds },
            },
            select: {
              id: true,
              imageDataUrl: true,
            },
          })
        : [];
    const tokenImageById = new Map(
      selectedTokenImages.map((entry) => [entry.id, entry.imageDataUrl] as const),
    );
    const tokenBinding = {
      combatants: tokenBindingBase.combatants.map((entry) => {
        if (
          entry.type !== "enemy" ||
          typeof entry.tokenLibraryId !== "string" ||
          !entry.tokenLibraryId.trim()
        ) {
          return entry;
        }
        return {
          ...entry,
          tokenImageDataUrl: tokenImageById.get(entry.tokenLibraryId) ?? undefined,
        };
      }),
      telemetry: tokenBindingBase.telemetry,
    };
    const creatureHydration = hydrateEnemyCombatantsFromCreatureLibrary(
      tokenBinding.combatants,
      creatureEntries,
    );
    const sceneExtraction = extractSceneBlock(
      narrativeContextText || normalizedBootstrap.campaign.starting_scene,
    );
    const bootstrapObject =
      normalizedBootstrap && typeof normalizedBootstrap === "object"
        ? (normalizedBootstrap as Record<string, unknown>)
        : {};
    const gmNotes =
      bootstrapObject.gm_notes && typeof bootstrapObject.gm_notes === "object"
        ? (bootstrapObject.gm_notes as Record<string, unknown>)
        : {};
    const offscreenPressure =
      Array.isArray(gmNotes.offscreen_pressure)
        ? gmNotes.offscreen_pressure
            .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
            .join(" ")
        : "";
    const inferredLocationKey = inferBattleMapLocationKey({
      ruleset: campaign.ruleset,
      sceneLocation: sceneExtraction.scene?.location ?? "",
      sceneTitle: sceneExtraction.scene?.sceneTitle ?? "",
      bootstrapStartingScene: normalizedBootstrap.campaign.starting_scene,
      latestNarrative: narrativeContextText || latestMessageText,
      offscreenPressure,
    });
    const templatesForRuleset = await prismaAny.battleMapTemplate.findMany({
      where: {
        ruleset: { equals: campaign.ruleset, mode: "insensitive" },
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
      select: {
        id: true,
        ruleset: true,
        locationKey: true,
        title: true,
        blockedTilesJson: true,
        playerSpawnTilesJson: true,
        enemySpawnTilesJson: true,
        updatedAt: true,
      },
    });
    const battleMapTemplate = pickBestBattleMapTemplate({
      templates: templatesForRuleset,
      inferredLocationKey,
      contextText: [
        sceneExtraction.scene?.location ?? "",
        sceneExtraction.scene?.sceneTitle ?? "",
        narrativeContextText || latestMessageText,
        normalizedBootstrap.campaign.starting_scene,
        offscreenPressure,
      ]
        .filter(Boolean)
        .join(" "),
    });
    const spawnAssignment = battleMapTemplate
      ? assignSpawnTilesToCombatants(creatureHydration.combatants, {
          blockedTiles: normalizeTileCoordinates(battleMapTemplate.blockedTilesJson),
          playerSpawnTiles: normalizeTileCoordinates(battleMapTemplate.playerSpawnTilesJson),
          enemySpawnTiles: normalizeTileCoordinates(battleMapTemplate.enemySpawnTilesJson),
        })
      : {
          combatants: creatureHydration.combatants,
          telemetry: {
            playerSpawnTileCount: 0,
            enemySpawnTileCount: 0,
            blockedTileCount: 0,
            playerAssigned: 0,
            enemyAssigned: 0,
          },
        };
    const encounterChallenge = campaign.ruleset.toLowerCase().includes("d&d")
      ? computeDndEncounterChallenge({
          combatants: spawnAssignment.combatants,
          creatureEntries,
          partyLevels,
        })
      : {
          totalXp: 0,
          adjustedXp: 0,
          difficulty: "Unknown",
          enemyTotal: spawnAssignment.combatants.filter((entry) => entry.type === "enemy").length,
          thresholds: { easy: 0, medium: 0, hard: 0, deadly: 0 },
        };
    const encounterRiskFromChallenge = (() => {
      switch (encounterChallenge.difficulty.toLowerCase()) {
        case "deadly":
          return { score: 5, label: "Deadly" };
        case "hard":
          return { score: 4, label: "Hard" };
        case "medium":
          return { score: 3, label: "Medium" };
        case "easy":
          return { score: 2, label: "Easy" };
        default:
          return { score: 1, label: "Trivial" };
      }
    })();
    const fallbackEncounterRiskScore = computeEncounterRiskScore({
      partySize: encounterResolved.debug.partySize,
      enemyCountTarget: encounterResolved.debug.enemyCountTarget,
      averageResourceRatio: encounterResolved.debug.averageResourceRatio,
      averageLevel: encounterResolved.debug.averageLevel,
    });
    const fallbackEncounterRisk = classifyEncounterRisk(fallbackEncounterRiskScore);
    const encounterRisk = campaign.ruleset.toLowerCase().includes("d&d")
      ? encounterRiskFromChallenge
      : {
          score: fallbackEncounterRiskScore,
          label: fallbackEncounterRisk.label,
        };

    if (spawnAssignment.combatants.length < 2) {
      return NextResponse.json(
        { error: "At least two combatants are required to start combat." },
        { status: 400 },
      );
    }

    const activeName = parseString(body.activeName) || undefined;
    const initiative = buildInitiativeState({
      seeds: spawnAssignment.combatants,
      profile: adapterProfile,
      deadlandsJokerEffectsEnabled:
        adapterProfile === "deadlands"
          ? parseBoolean(body.deadlandsJokerEffectsEnabled, false)
          : false,
      activeName,
      round: 1,
      seedInput,
    });
    const combatStateWithMap = {
      ...initiative.state,
      mapTemplateId: battleMapTemplate?.id ?? undefined,
      mapTemplateLocationKey: battleMapTemplate?.locationKey ?? undefined,
      encounterTotalXp: encounterChallenge.totalXp,
      encounterAdjustedXp: encounterChallenge.adjustedXp,
      encounterDifficulty: encounterChallenge.difficulty,
      encounterEnemyTotal: encounterChallenge.enemyTotal,
      encounterThresholdEasy: encounterChallenge.thresholds.easy,
      encounterThresholdMedium: encounterChallenge.thresholds.medium,
      encounterThresholdHard: encounterChallenge.thresholds.hard,
      encounterThresholdDeadly: encounterChallenge.thresholds.deadly,
    };

    await prisma.campaign.update({
      where: { id },
      data: {
        combatStateJson: combatStateWithMap,
      } as never,
    });

    if (debugLoggingEnabled) {
      console.info("[combat] start", {
        campaignId: id,
        ruleset: campaign.ruleset,
        adapterProfile,
        combatants: spawnAssignment.combatants.map((seed) => ({
          id: seed.id,
          name: seed.name,
          type: seed.type,
          gridX: seed.gridX,
          gridY: seed.gridY,
          initiativeModifier: seed.initiativeModifier,
        })),
        encounterResolver: encounterResolved.debug,
        spawnPlacement: {
          templateId: battleMapTemplate?.id ?? null,
          templateLocationKey: battleMapTemplate?.locationKey ?? null,
          inferredLocationKey,
          ...spawnAssignment.telemetry,
        },
        tokenBinding: tokenBinding.telemetry,
        creatureHydration: creatureHydration.telemetry,
        genericEnemyRepair: genericEnemyRepair.telemetry,
        uniqueEnemyNames: uniqueEnemyNames.telemetry,
        intentComposition: intentComposed.telemetry,
        intentRebalance: intentRebalance.telemetry,
        rosterDedupe: dedupedSeeds.telemetry,
        encounterRisk: {
          score: encounterRisk.score,
          label: encounterRisk.label,
        },
        encounterChallenge,
        encounterFinal: {
          enemyCountFinal: encounterChallenge.enemyTotal,
          difficultyFinal: encounterChallenge.difficulty,
          adjustedXpFinal: encounterChallenge.adjustedXp,
        },
      });
    }

    return NextResponse.json({
      combatStateJson: combatStateWithMap,
      rollLog: initiative.rollLog,
      adapterDebug: {
        ruleset: campaign.ruleset,
        profile: adapterProfile,
        encounterResolver: encounterResolved.debug,
        encounterRisk: {
          score: encounterRisk.score,
          label: encounterRisk.label,
        },
        encounterChallenge,
        encounterStart: {
          seedInput,
          inputCombatantCount: seeds.length,
          dedupedInputCombatantCount: dedupedSeeds.combatants.length,
          resolvedCombatantCount: spawnAssignment.combatants.length,
          inputEnemyCount: seeds.filter((entry) => entry.type === "enemy").length,
          resolvedEnemyCount: resolvedEnemyTelemetry.length,
          enemyAssignments: resolvedEnemyTelemetry,
        },
        spawnPlacement: {
          templateId: battleMapTemplate?.id ?? null,
          templateLocationKey: battleMapTemplate?.locationKey ?? null,
          inferredLocationKey,
          ...spawnAssignment.telemetry,
        },
        tokenBinding: tokenBinding.telemetry,
        creatureHydration: creatureHydration.telemetry,
        genericEnemyRepair: genericEnemyRepair.telemetry,
        uniqueEnemyNames: uniqueEnemyNames.telemetry,
        intentComposition: intentComposed.telemetry,
        intentRebalance: intentRebalance.telemetry,
        rosterDedupe: dedupedSeeds.telemetry,
        encounterFinal: {
          enemyCountFinal: encounterChallenge.enemyTotal,
          difficultyFinal: encounterChallenge.difficulty,
          adjustedXpFinal: encounterChallenge.adjustedXp,
        },
      },
    });
  }

  if (action === "persist-runtime") {
    const snapshotState = normalizeCombatState(
      runtimeCombatStateRaw ?? body.combatStateJson ?? currentCombatState,
    );
    const snapshotCharacters = runtimeCharacters.length > 0 ? runtimeCharacters : campaign.characters;
    const campaignCharacterIds = new Set(campaign.characters.map((entry) => entry.id));
    const persistStartedAt = Date.now();
    await prisma.campaign.update({
      where: { id },
      data: {
        combatStateJson: snapshotState,
      } as never,
    });
    let updatedCharacterCount = 0;
    for (const character of snapshotCharacters) {
      if (!campaignCharacterIds.has(character.id)) {
        continue;
      }
      await prisma.character.update({
        where: { id: character.id },
        data: {
          sheetJson: character.sheetJson,
        } as never,
        select: { id: true },
      });
      updatedCharacterCount += 1;
    }
    const persistMs = Date.now() - persistStartedAt;
    if (debugLoggingEnabled) {
      console.info("[combat] persist-runtime", {
        campaignId: id,
        ruleset: campaign.ruleset,
        combatRound: snapshotState.round,
        combatActive: snapshotState.combatActive,
        updatedCharacterCount,
        persistMs,
      });
    }
    return NextResponse.json({
      ok: true,
      updatedCharacterCount,
      adapterDebug: {
        ruleset: campaign.ruleset,
        profile: adapterProfile,
        action: "persist-runtime",
        timings: {
          campaignLookupMs: submitTiming.campaignLookupMs ?? 0,
          persistMs,
          totalMs: Date.now() - requestStartedAt,
        },
      },
    });
  }

  if (action === "submit") {
    const kind = parseString(body.kind).toLowerCase();
    if (
      kind !== "attack" &&
      kind !== "cast-spell" &&
      kind !== "defend" &&
      kind !== "pass" &&
      kind !== "help" &&
      kind !== "disengage" &&
      kind !== "dash" &&
      kind !== "take-cover" &&
      kind !== "aim" &&
      kind !== "surrender" &&
      kind !== "attempt-escape"
    ) {
      return NextResponse.json(
        {
          error:
            "Unsupported action kind. Supported: attack, cast-spell, defend, pass, help, disengage, dash, take-cover, aim, surrender, attempt-escape.",
        },
        { status: 400 },
      );
    }

    const actor = parseString(body.actor);
    const target = parseString(body.target);
    if (!actor) {
      return NextResponse.json(
        { error: "Combat action requires actor." },
        { status: 400 },
      );
    }
    if ((kind === "attack" || kind === "cast-spell") && !target) {
      return NextResponse.json(
        { error: "Attack/cast-spell action requires actor and target." },
        { status: 400 },
      );
    }

    const seedInput =
      parseString(body.seedInput) || `${id}|${messageIdForSeed}|submit|${actor}|${target}`;
    const actorEntry =
      hydratedCombatState.roster.find((entry) => {
        const ref = entry.id || entry.name;
        return ref.trim().toLowerCase() === actor.trim().toLowerCase();
      }) ??
      hydratedCombatState.roster.find(
        (entry) => entry.name.trim().toLowerCase() === actor.trim().toLowerCase(),
      ) ??
      null;
    const targetEntry =
      target
        ? hydratedCombatState.roster.find((entry) => {
            const ref = entry.id || entry.name;
            return ref.trim().toLowerCase() === target.trim().toLowerCase();
          }) ??
          hydratedCombatState.roster.find(
            (entry) => entry.name.trim().toLowerCase() === target.trim().toLowerCase(),
          ) ??
          null
        : null;
    const actorType = actorEntry?.type ?? "character";
    const actorCharacter = findCharacterByRef(campaign.characters, actor);
    const targetCharacter = target ? findCharacterByRef(campaign.characters, target) : null;
    const moveToX = parseOptionalNumber(body.moveToX);
    const moveToY = parseOptionalNumber(body.moveToY);
    const hasMovementDestination = moveToX !== undefined && moveToY !== undefined;
    const moveDestination = hasMovementDestination
      ? {
          x: Math.max(0, Math.trunc(moveToX)),
          y: Math.max(0, Math.trunc(moveToY)),
        }
      : null;
    const actorRefNormalized = actor.trim().toLowerCase();
    const actorRosterIndex = hydratedCombatState.roster.findIndex((entry) => {
      const ref = (entry.id ?? entry.name).trim().toLowerCase();
      return ref === actorRefNormalized || entry.name.trim().toLowerCase() === actorRefNormalized;
    });
    const targetRefNormalized = target.trim().toLowerCase();
    const targetRosterIndex = hydratedCombatState.roster.findIndex((entry) => {
      const ref = (entry.id ?? entry.name).trim().toLowerCase();
      return ref === targetRefNormalized || entry.name.trim().toLowerCase() === targetRefNormalized;
    });
    if (moveDestination && actorRosterIndex < 0) {
      return NextResponse.json(
        { error: "Unable to resolve movement actor in combat roster." },
        { status: 400 },
      );
    }
    const actorRosterEntry =
      actorRosterIndex >= 0 ? hydratedCombatState.roster[actorRosterIndex] : null;
    const targetRosterEntry =
      targetRosterIndex >= 0 ? hydratedCombatState.roster[targetRosterIndex] : null;
    const blockedTileResolveStartedAt = Date.now();
    let blockedTileSet = new Set<string>();
    const blockedTileKeysFromBody = Array.isArray(body.blockedTileKeys)
      ? body.blockedTileKeys
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.trim())
          .filter((value) => /^\d+,\d+$/.test(value))
      : [];
    if (blockedTileKeysFromBody.length > 0) {
      blockedTileSet = new Set(blockedTileKeysFromBody);
      submitTiming.blockedTileSource = "request";
    } else {
      const templateId =
        typeof hydratedCombatState.mapTemplateId === "string" &&
        hydratedCombatState.mapTemplateId.trim()
          ? hydratedCombatState.mapTemplateId.trim()
          : "";
      if (templateId) {
        const template = await prismaAny.battleMapTemplate.findUnique({
          where: { id: templateId },
          select: {
            id: true,
            blockedTilesJson: true,
          },
        });
        if (template) {
          blockedTileSet = new Set(
            normalizeTileCoordinates(template.blockedTilesJson).map(
              ([x, y]) => `${x},${y}`,
            ),
          );
        }
      }
      submitTiming.blockedTileSource = "db-template";
    }
    submitTiming.blockedTileResolveMs = Date.now() - blockedTileResolveStartedAt;
    if (
      moveDestination &&
      (!actorRosterEntry ||
        typeof actorRosterEntry.gridX !== "number" ||
        !Number.isFinite(actorRosterEntry.gridX) ||
        typeof actorRosterEntry.gridY !== "number" ||
        !Number.isFinite(actorRosterEntry.gridY))
    ) {
      return NextResponse.json(
        { error: "Actor has no current grid position for movement." },
        { status: 400 },
      );
    }
    if (moveDestination && actorRosterEntry) {
      const actorGridX = actorRosterEntry.gridX;
      const actorGridY = actorRosterEntry.gridY;
      if (
        typeof actorGridX !== "number" ||
        !Number.isFinite(actorGridX) ||
        typeof actorGridY !== "number" ||
        !Number.isFinite(actorGridY)
      ) {
        return NextResponse.json(
          { error: "Actor has no current grid position for movement." },
          { status: 400 },
        );
      }
      const actorCurrentKeys = new Set(getCombatantOccupiedKeys(actorRosterEntry));
      const destinationKeys = getCombatantOccupiedKeys({
        gridX: moveDestination.x,
        gridY: moveDestination.y,
        tokenFootprintCols: actorRosterEntry.tokenFootprintCols,
        tokenFootprintRows: actorRosterEntry.tokenFootprintRows,
      });
      const occupiedByOther = hydratedCombatState.roster.some((entry, index) => {
        if (index === actorRosterIndex) {
          return false;
        }
        const entryOccupied = new Set(getCombatantOccupiedKeys(entry));
        return destinationKeys.some((key) => entryOccupied.has(key));
      });
      if (occupiedByOther) {
        return NextResponse.json(
          { error: "Destination tile is occupied." },
          { status: 400 },
        );
      }
      if (destinationKeys.some((key) => blockedTileSet.has(key) && !actorCurrentKeys.has(key))) {
        return NextResponse.json(
          { error: "Destination tile is blocked." },
          { status: 400 },
        );
      }

      const movementDistance = getGridTileDistance(
        { x: actorGridX, y: actorGridY },
        moveDestination,
      );
      const moveTiles = getCombatMovementTilesPerMove(
        campaign.ruleset,
        actorCharacter?.sheetJson as Record<string, unknown> | null,
      );
      const effectiveMoveTiles =
        typeof actorRosterEntry.moveTilesOverride === "number" &&
        Number.isFinite(actorRosterEntry.moveTilesOverride)
          ? Math.max(1, Math.trunc(actorRosterEntry.moveTilesOverride))
          : moveTiles;
      const movementLimit = kind === "dash" ? effectiveMoveTiles * 2 : effectiveMoveTiles;
      if (movementDistance > movementLimit) {
        return NextResponse.json(
          {
            error:
              kind !== "dash" && movementDistance <= effectiveMoveTiles * 2
                ? `Move is ${movementDistance} tiles. Use Dash for up to ${effectiveMoveTiles * 2}.`
                : `Move is ${movementDistance} tiles, exceeds ${movementLimit} for ${kind}.`,
          },
          { status: 400 },
        );
      }
    }
    if (kind === "attack" && actorRosterEntry && targetRosterEntry) {
      const attackRangeModeRaw = parseString(body.attackRangeMode).toLowerCase();
      const actorForRangeChecks = moveDestination
        ? {
            ...actorRosterEntry,
            gridX: moveDestination.x,
            gridY: moveDestination.y,
          }
        : actorRosterEntry;
      const minimumDistance = getMinimumTileDistanceBetweenCombatants(
        actorForRangeChecks,
        targetRosterEntry,
      );
      const inferredRangeMode =
        attackRangeModeRaw === "ranged" || attackRangeModeRaw === "melee"
          ? attackRangeModeRaw
          : actorRosterEntry.type === "enemy" || actorRosterEntry.type === "npc"
            ? minimumDistance <= 1
              ? "melee"
              : "ranged"
            : "melee";
      const attackRangeMode = inferredRangeMode === "ranged" ? "ranged" : "melee";
      if (attackRangeMode === "melee" && minimumDistance > 1) {
        return NextResponse.json(
          { error: "Melee attacks require an adjacent target (including diagonals)." },
          { status: 400 },
        );
      }
      if (
        attackRangeMode === "ranged" &&
        hasBlockedTilesOnLineOfSight({
          actor: actorForRangeChecks,
          target: targetRosterEntry,
          blockedTileSet,
        })
      ) {
        return NextResponse.json(
          { error: "Ranged attack is blocked by terrain." },
          { status: 400 },
        );
      }
    }
    const isUtilityActionKind =
      kind === "defend" ||
      kind === "pass" ||
      kind === "help" ||
      kind === "disengage" ||
      kind === "dash" ||
      kind === "take-cover" ||
      kind === "aim" ||
      kind === "surrender" ||
      kind === "attempt-escape";
    if (isUtilityActionKind) {
      const utilityResolveStartedAt = Date.now();
      const movementAppliedState =
        moveDestination && actorRosterEntry
          ? applyMovementToCombatState(hydratedCombatState, actor, moveDestination)
          : hydratedCombatState;
      const utilityResult = resolveUtilityAction(movementAppliedState, {
        actor,
        kind: kind as
          | "defend"
          | "pass"
          | "help"
          | "disengage"
          | "dash"
          | "take-cover"
          | "aim"
          | "surrender"
          | "attempt-escape",
        profile: adapterProfile,
        seedInput,
      });
      if (utilityResult.error || !utilityResult.resolution) {
        return NextResponse.json(
          { error: utilityResult.error ?? "Unable to resolve utility action." },
          { status: 400 },
        );
      }
      submitTiming.utilityResolveMs = Date.now() - utilityResolveStartedAt;
      if (usingRuntimeCampaign) {
        submitTiming.persistMs = 0;
      } else {
        const persistStartedAt = Date.now();
        await prisma.campaign.update({
          where: { id },
          data: {
            combatStateJson: utilityResult.state,
          } as never,
        });
        submitTiming.persistMs = Date.now() - persistStartedAt;
      }
      submitTiming.totalMs = Date.now() - requestStartedAt;
      if (debugLoggingEnabled) {
        console.info("[combat] submit", {
          campaignId: id,
          ruleset: campaign.ruleset,
          adapterProfile,
          kind,
          actor,
          target,
          utilityFastPath: true,
          timings: submitTiming,
        });
      }
      return NextResponse.json({
        combatStateJson: utilityResult.state,
        resolution: utilityResult.resolution,
        characters: campaign.characters,
        adapterDebug: {
          ruleset: campaign.ruleset,
          profile: adapterProfile,
          kind,
          actor,
          target,
          utilityFastPath: true,
          timings: submitTiming,
        },
      });
    }
    if (usingRuntimeCampaign && kind === "attack") {
      if (!target) {
        return NextResponse.json(
          { error: "Attack action requires actor and target." },
          { status: 400 },
        );
      }
      const defaults = getAttackDefaults({
        ruleset: campaign.ruleset,
        actorType,
        actorCharacter,
        targetCharacter,
        actorRuntime: actorEntry,
        targetRuntime: targetEntry,
      });
      const attackDie = parseNumber(body.attackDie, defaults.attackDie);
      const attackBonus = parseNumber(body.attackBonus, defaults.attackBonus);
      const targetAc = parseNumber(body.targetAc, defaults.targetAc);
      const damageDie = parseNumber(body.damageDie, defaults.damageDie);
      const damageDiceCount = parseNumber(body.damageDiceCount, 1);
      const damageBonus = parseNumber(body.damageBonus, defaults.damageBonus);
      const movementAppliedState =
        moveDestination && actorRosterEntry
          ? applyMovementToCombatState(hydratedCombatState, actor, moveDestination)
          : hydratedCombatState;
      const attackResult = resolveAttackAction(movementAppliedState, {
        actor,
        target,
        profile: adapterProfile,
        attackDie,
        attackBonus,
        targetAc,
        damageDie,
        damageDiceCount,
        damageBonus,
        targetConSaveBonus: getAbilitySaveBonus(
          targetCharacter?.sheetJson as Record<string, unknown> | null,
          "con",
        ),
        seedInput,
      });
      if (attackResult.error || !attackResult.resolution) {
        return NextResponse.json(
          { error: attackResult.error ?? "Unable to resolve action." },
          { status: 400 },
        );
      }
      const parsedTargetHpAfter = parseHpString(
        (attackResult.resolution as { targetHpAfter?: string }).targetHpAfter,
      );
      let updatedCharacters = campaign.characters;
      if (targetCharacter && parsedTargetHpAfter) {
        updatedCharacters = campaign.characters.map((character) => {
          if (character.id !== targetCharacter.id) {
            return character;
          }
          const currentSheet = asObject(character.sheetJson) ?? {};
          const nextSheet = { ...currentSheet };
          if (adapterProfile === "deadlands" || asObject(currentSheet.wind)) {
            const currentWind = asObject(currentSheet.wind) ?? {};
            nextSheet.wind = {
              ...currentWind,
              current: parsedTargetHpAfter.current,
              max: parsedTargetHpAfter.max,
            };
          } else {
            const currentHp = asObject(currentSheet.hp) ?? {};
            nextSheet.hp = {
              ...currentHp,
              current: parsedTargetHpAfter.current,
              max: parsedTargetHpAfter.max,
            };
          }
          return {
            ...character,
            sheetJson: nextSheet,
          };
        });
      }
      submitTiming.persistMs = 0;
      submitTiming.characterUpdateMs = 0;
      submitTiming.totalMs = Date.now() - requestStartedAt;
      if (debugLoggingEnabled) {
        console.info("[combat] submit", {
          campaignId: id,
          ruleset: campaign.ruleset,
          adapterProfile,
          kind,
          actor,
          target,
          localFastMode: true,
          defaults,
          applied: {
            attackDie,
            attackBonus,
            targetAc,
            damageDie,
            damageDiceCount,
            damageBonus,
          },
          timings: submitTiming,
        });
      }
      return NextResponse.json({
        combatStateJson: attackResult.state,
        resolution: attackResult.resolution,
        characters: updatedCharacters,
        adapterDebug: {
          ruleset: campaign.ruleset,
          profile: adapterProfile,
          kind,
          actor,
          target,
          localFastMode: true,
          defaults,
          applied: {
            attackDie,
            attackBonus,
            targetAc,
            damageDie,
            damageDiceCount,
            damageBonus,
          },
          timings: submitTiming,
        },
      });
    }
    if (usingRuntimeCampaign && kind === "cast-spell") {
      const defaults = getAttackDefaults({
        ruleset: campaign.ruleset,
        actorType,
        actorCharacter,
        targetCharacter,
        actorRuntime: actorEntry,
        targetRuntime: targetEntry,
      });
      const spellName = parseString(body.spellName) || undefined;
      const catalogEffect = resolveCatalogEffect({
        profile: adapterProfile,
        kind: "cast-spell",
        spellName,
      });
      const attackDie =
        catalogEffect?.attackDieOverride ?? parseNumber(body.attackDie, defaults.attackDie);
      const attackBonus = parseNumber(
        body.attackBonus,
        defaults.attackBonus + (catalogEffect?.attackBonusModifier ?? 0),
      );
      const targetAc = parseNumber(body.targetAc, defaults.targetAc);
      const damageDie =
        catalogEffect?.damageDieOverride ?? parseNumber(body.damageDie, defaults.damageDie);
      const damageDiceCount = parseNumber(
        body.damageDiceCount,
        catalogEffect?.damageDiceCountOverride ?? 1,
      );
      const damageBonus = parseNumber(
        body.damageBonus,
        defaults.damageBonus + (catalogEffect?.damageBonusModifier ?? 0),
      );
      const requestedSpellSlot = parseString(body.spellSlot) || undefined;
      const shouldConsumeSpellSlot = catalogEffect?.cost?.consumesSpellSlot ?? true;
      const actorLevel = getCharacterLevel(
        actorCharacter?.sheetJson as Record<string, unknown> | null,
      );
      const scaledDamageDiceCount =
        adapterProfile === "dnd" && catalogEffect?.cost?.cantripScaling === "dnd"
          ? getDndCantripDamageDiceCount(actorLevel)
          : damageDiceCount;
      const prevalidatedSpellSlotResult =
        shouldConsumeSpellSlot && actorCharacter
          ? consumeSpellSlot(
              actorCharacter.sheetJson as Record<string, unknown> | null,
              requestedSpellSlot,
            )
          : null;
      if (shouldConsumeSpellSlot && prevalidatedSpellSlotResult && !prevalidatedSpellSlotResult.ok) {
        return NextResponse.json(
          { error: prevalidatedSpellSlotResult.reason ?? "No spell slots remaining." },
          { status: 400 },
        );
      }
      const movementAppliedState =
        moveDestination && actorRosterEntry
          ? applyMovementToCombatState(hydratedCombatState, actor, moveDestination)
          : hydratedCombatState;
      let updatedCharacters = campaign.characters;
      const updateCharacterSheet = (
        characterId: string,
        updateFn: (sheet: Record<string, unknown>) => Record<string, unknown>,
      ) => {
        updatedCharacters = updatedCharacters.map((character) => {
          if (character.id !== characterId) {
            return character;
          }
          const currentSheet = asObject(character.sheetJson) ?? {};
          return {
            ...character,
            sheetJson: updateFn(currentSheet),
          };
        });
      };
      const syncHpOnSheet = (
        baseSheet: Record<string, unknown>,
        hp: ReturnType<typeof parseHpString>,
      ) => {
        if (!hp) {
          return baseSheet;
        }
        const nextSheet = { ...baseSheet };
        if (adapterProfile === "deadlands" || asObject(baseSheet.wind)) {
          const currentWind = asObject(baseSheet.wind) ?? {};
          nextSheet.wind = {
            ...currentWind,
            current: hp.current,
            max: hp.max,
          };
        } else {
          const currentHp = asObject(baseSheet.hp) ?? {};
          nextSheet.hp = {
            ...currentHp,
            current: hp.current,
            max: hp.max,
          };
        }
        return nextSheet;
      };

      const isMagicMissile =
        catalogEffect?.id === "dnd_magic_missile" && catalogEffect.delivery === "auto-hit";
      if (isMagicMissile) {
        if (!target) {
          return NextResponse.json(
            { error: "Spell action requires actor and target." },
            { status: 400 },
          );
        }
        const slotLevel = parseSpellSlotLevel(requestedSpellSlot);
        const missileCount = Math.max(1, slotLevel + 2);
        const magicMissileResult = resolveAutoHitAction(movementAppliedState, {
          actor,
          target,
          profile: adapterProfile,
          damageDie: catalogEffect.damageDieOverride ?? 4,
          damageDiceCount: missileCount,
          damageBonus: missileCount * (catalogEffect.damageBonusModifier ?? 1),
          targetConSaveBonus: getAbilitySaveBonus(
            targetCharacter?.sheetJson as Record<string, unknown> | null,
            "con",
          ),
          seedInput: `${seedInput}|magic-missile|${slotLevel}`,
        });
        if (magicMissileResult.error || !magicMissileResult.resolution) {
          return NextResponse.json(
            { error: magicMissileResult.error ?? "Unable to resolve Magic Missile." },
            { status: 400 },
          );
        }
        const parsedTargetHpAfter = parseHpString(magicMissileResult.resolution.targetHpAfter);
        if (targetCharacter && parsedTargetHpAfter) {
          updateCharacterSheet(targetCharacter.id, (sheet) =>
            syncHpOnSheet(sheet, parsedTargetHpAfter),
          );
        }
        if (actorCharacter && shouldConsumeSpellSlot) {
          const slotResult = prevalidatedSpellSlotResult;
          if (!slotResult || !slotResult.ok) {
            return NextResponse.json(
              { error: "Unable to consume spell slot." },
              { status: 400 },
            );
          }
          updateCharacterSheet(actorCharacter.id, () => {
            const nextSheet = asObject(slotResult.nextSheet) ?? {};
            return { ...nextSheet };
          });
        }
        submitTiming.persistMs = 0;
        submitTiming.characterUpdateMs = 0;
        submitTiming.casterUpdateMs = 0;
        submitTiming.totalMs = Date.now() - requestStartedAt;
        return NextResponse.json({
          combatStateJson: magicMissileResult.state,
          resolution: {
            ...magicMissileResult.resolution,
            spellName,
            catalogEffectId: catalogEffect.id,
            catalogEffectName: catalogEffect.name,
          },
          characters: updatedCharacters,
          adapterDebug: {
            ruleset: campaign.ruleset,
            profile: adapterProfile,
            kind,
            actor,
            target,
            localFastMode: true,
            spellName,
            timings: submitTiming,
          },
        });
      }

      const isFireballAoe =
        catalogEffect?.id === "dnd_fireball" && catalogEffect.delivery === "save";
      if (isFireballAoe) {
        const requestedTargetRefs = Array.isArray(body.targetRefs)
          ? body.targetRefs
              .filter((value): value is string => typeof value === "string")
              .map((value) => value.trim())
              .filter(Boolean)
          : [];
        const targetRefs = [...new Set([...(target ? [target] : []), ...requestedTargetRefs])];
        if (targetRefs.length === 0) {
          return NextResponse.json(
            { error: "Fireball requires at least one target." },
            { status: 400 },
          );
        }
        const saveAbility = catalogEffect.save?.ability;
        const saveDc =
          getSpellSaveDc(actorCharacter?.sheetJson as Record<string, unknown> | null) ??
          catalogEffect.save?.dc;
        if (!saveAbility || !saveDc) {
          return NextResponse.json(
            { error: "Unable to resolve Fireball save metadata." },
            { status: 400 },
          );
        }

        let workingState = movementAppliedState;
        const aoeResolutions: Array<Record<string, unknown>> = [];
        for (const [index, targetRef] of targetRefs.entries()) {
          const loopTargetCharacter = findCharacterByRef(campaign.characters, targetRef);
          const loopSaveBonus = getAbilitySaveBonus(
            loopTargetCharacter?.sheetJson as Record<string, unknown> | null,
            saveAbility,
          );
          const loopResult = resolveSaveAction(workingState, {
            actor,
            target: targetRef,
            profile: adapterProfile,
            saveAbility,
            saveDc,
            saveBonus: loopSaveBonus,
            damageDie,
            damageDiceCount: scaledDamageDiceCount,
            damageBonus,
            targetConSaveBonus: getAbilitySaveBonus(
              loopTargetCharacter?.sheetJson as Record<string, unknown> | null,
              "con",
            ),
            onSave: catalogEffect.save?.onSave ?? "none",
            onFailedSaveTargetStatusEffects: catalogEffect.onFailedSaveTargetStatusEffects ?? [],
            advanceTurn: false,
            seedInput: `${seedInput}|aoe|${index}`,
          });
          if (loopResult.error || !loopResult.resolution) {
            return NextResponse.json(
              { error: loopResult.error ?? `Unable to resolve Fireball target: ${targetRef}.` },
              { status: 400 },
            );
          }
          const loopResolution = loopResult.resolution as { saveSucceeded?: boolean };
          const loopDurationPayload =
            !loopResolution.saveSucceeded &&
            Array.isArray(catalogEffect.onFailedSaveTargetStatusDurations)
              ? catalogEffect.onFailedSaveTargetStatusDurations
                  .filter((entry) => entry.effect && Number.isFinite(entry.durationRounds))
                  .map((entry) => ({
                    effect: entry.effect.trim(),
                    remainingRounds: Math.max(1, Math.trunc(entry.durationRounds)),
                    kind: entry.kind ?? "timed",
                    breakOnDamage: entry.breakOnDamage === true,
                  }))
              : [];
          workingState =
            loopDurationPayload.length > 0
              ? applyStatusEffectsToCombatState(loopResult.state, targetRef, [], {
                  durations: loopDurationPayload,
                })
              : loopResult.state;
          aoeResolutions.push({
            ...loopResult.resolution,
            targetRef,
          });
        }
        const advancedAoeState = advanceTurn(workingState);
        const concentrationStatusLabel =
          catalogEffect.concentration?.required && spellName
            ? buildConcentrationStatusLabel()
            : null;
        const concentrationDuration =
          catalogEffect.concentration?.required && spellName
            ? buildConcentrationDuration(
                spellName,
                catalogEffect.concentration.durationRounds,
                catalogEffect.concentration.breakOnDamage !== false,
              )
            : null;
        const stateWithConcentration =
          concentrationStatusLabel && actor
            ? applyStatusEffectsToCombatState(advancedAoeState, actor, [concentrationStatusLabel], {
                durations: concentrationDuration ? [concentrationDuration] : [],
                replaceConcentration: true,
              })
            : advancedAoeState;

        for (const resolutionEntry of aoeResolutions) {
          const loopTargetRef = parseString(resolutionEntry.targetRef);
          const loopTargetCharacter = findCharacterByRef(campaign.characters, loopTargetRef);
          if (!loopTargetCharacter) {
            continue;
          }
          const parsedHp = parseHpString(
            typeof resolutionEntry.targetHpAfter === "string"
              ? resolutionEntry.targetHpAfter
              : undefined,
          );
          const effectsApplied = Array.isArray(resolutionEntry.effectsApplied)
            ? resolutionEntry.effectsApplied.filter(
                (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
              )
            : [];
          if (!parsedHp && effectsApplied.length === 0) {
            continue;
          }
          updateCharacterSheet(loopTargetCharacter.id, (sheet) => {
            let nextSheet = syncHpOnSheet(sheet, parsedHp);
            if (effectsApplied.length > 0) {
              nextSheet = {
                ...nextSheet,
                statusEffects: mergeUniqueStatusEffects(nextSheet.statusEffects, effectsApplied),
              };
            }
            const combatEntry = getCombatEntryByRef(stateWithConcentration, loopTargetCharacter.id);
            return {
              ...nextSheet,
              statusEffects: syncConcentrationStatusEffect(
                nextSheet.statusEffects,
                combatEntry?.statusEffects,
              ),
            };
          });
        }
        if (actorCharacter && shouldConsumeSpellSlot) {
          const slotResult = prevalidatedSpellSlotResult;
          if (!slotResult || !slotResult.ok) {
            return NextResponse.json(
              { error: "Unable to consume spell slot." },
              { status: 400 },
            );
          }
          updateCharacterSheet(actorCharacter.id, () => {
            const nextCasterSheet = { ...(asObject(slotResult.nextSheet) ?? {}) };
            if (concentrationStatusLabel) {
              const withoutConcentrating = syncConcentrationStatusEffect(
                nextCasterSheet.statusEffects,
                [],
              );
              nextCasterSheet.statusEffects = mergeUniqueStatusEffects(withoutConcentrating, [
                concentrationStatusLabel,
              ]);
            } else {
              const combatEntry = getCombatEntryByRef(stateWithConcentration, actorCharacter.id);
              nextCasterSheet.statusEffects = syncConcentrationStatusEffect(
                nextCasterSheet.statusEffects,
                combatEntry?.statusEffects,
              );
            }
            return nextCasterSheet;
          });
        }
        submitTiming.persistMs = 0;
        submitTiming.characterUpdateMs = 0;
        submitTiming.casterUpdateMs = 0;
        submitTiming.totalMs = Date.now() - requestStartedAt;
        return NextResponse.json({
          combatStateJson: stateWithConcentration,
          resolution: {
            kind: "cast-spell",
            delivery: "save",
            aoe: true,
            actor: actorEntry?.name ?? actor,
            spellName,
            catalogEffectId: catalogEffect.id,
            catalogEffectName: catalogEffect.name,
            catalogConcentration: catalogEffect.concentration ?? null,
            catalogReactionHooks: catalogEffect.reactionHooks ?? null,
            targets: aoeResolutions,
          },
          characters: updatedCharacters,
          adapterDebug: {
            ruleset: campaign.ruleset,
            profile: adapterProfile,
            kind,
            actor,
            target,
            targetRefs,
            spellName,
            localFastMode: true,
            timings: submitTiming,
          },
        });
      }

      if (!target) {
        return NextResponse.json(
          { error: "Spell action requires actor and target." },
          { status: 400 },
        );
      }
      const saveAbility = catalogEffect?.save?.ability;
      const saveDc = saveAbility
        ? getSpellSaveDc(actorCharacter?.sheetJson as Record<string, unknown> | null) ??
          catalogEffect?.save?.dc
        : undefined;
      const targetSaveBonus = saveAbility
        ? getAbilitySaveBonus(targetCharacter?.sheetJson as Record<string, unknown> | null, saveAbility)
        : undefined;
      const targetConSaveBonus = getAbilitySaveBonus(
        targetCharacter?.sheetJson as Record<string, unknown> | null,
        "con",
      );
      const spellResult =
        catalogEffect?.delivery === "save" && saveAbility && saveDc
          ? resolveSaveAction(movementAppliedState, {
              actor,
              target,
              profile: adapterProfile,
              saveAbility,
              saveDc,
              saveBonus: targetSaveBonus,
              damageDie,
              damageDiceCount: scaledDamageDiceCount,
              damageBonus,
              targetConSaveBonus,
              onSave: catalogEffect.save?.onSave ?? "none",
              onFailedSaveTargetStatusEffects: catalogEffect.onFailedSaveTargetStatusEffects ?? [],
              seedInput,
            })
          : resolveAttackAction(movementAppliedState, {
              actor,
              target,
              profile: adapterProfile,
              attackDie,
              attackBonus,
              targetAc,
              damageDie,
              damageDiceCount: scaledDamageDiceCount,
              damageBonus,
              targetConSaveBonus,
              seedInput,
            });
      if (spellResult.error || !spellResult.resolution) {
        return NextResponse.json(
          { error: spellResult.error ?? "Unable to resolve action." },
          { status: 400 },
        );
      }
      const spellResolution = spellResult.resolution as {
        targetHpAfter?: string;
        hit?: boolean;
        saveSucceeded?: boolean;
      };
      const catalogStatusEffects =
        catalogEffect?.delivery === "save"
          ? !spellResolution.saveSucceeded && catalogEffect?.onFailedSaveTargetStatusEffects
            ? catalogEffect.onFailedSaveTargetStatusEffects
            : []
          : spellResolution.hit && catalogEffect?.onHitTargetStatusEffects
            ? catalogEffect.onHitTargetStatusEffects
            : [];
      const concentrationStatusLabel =
        catalogEffect?.concentration?.required && spellName
          ? buildConcentrationStatusLabel()
          : null;
      const concentrationDuration =
        catalogEffect?.concentration?.required && spellName
          ? buildConcentrationDuration(
              spellName,
              catalogEffect.concentration.durationRounds,
              catalogEffect.concentration.breakOnDamage !== false,
            )
          : null;
      const stateWithTargetEffects =
        target && catalogStatusEffects.length > 0
          ? applyStatusEffectsToCombatState(spellResult.state, target, catalogStatusEffects)
          : spellResult.state;
      const stateWithConcentration =
        concentrationStatusLabel && actor
          ? applyStatusEffectsToCombatState(stateWithTargetEffects, actor, [concentrationStatusLabel], {
              durations: concentrationDuration ? [concentrationDuration] : [],
              replaceConcentration: true,
            })
          : stateWithTargetEffects;
      const parsedTargetHpAfter = parseHpString(spellResolution.targetHpAfter);
      if (targetCharacter && (parsedTargetHpAfter || catalogStatusEffects.length > 0)) {
        updateCharacterSheet(targetCharacter.id, (sheet) => {
          let nextSheet = syncHpOnSheet(sheet, parsedTargetHpAfter);
          if (catalogStatusEffects.length > 0) {
            nextSheet = {
              ...nextSheet,
              statusEffects: mergeUniqueStatusEffects(
                nextSheet.statusEffects,
                catalogStatusEffects,
              ),
            };
          }
          const targetCombatEntry = getCombatEntryByRef(stateWithConcentration, targetCharacter.id);
          return {
            ...nextSheet,
            statusEffects: syncConcentrationStatusEffect(
              nextSheet.statusEffects,
              targetCombatEntry?.statusEffects,
            ),
          };
        });
      }
      if (actorCharacter && shouldConsumeSpellSlot) {
        const slotResult = prevalidatedSpellSlotResult;
        if (!slotResult || !slotResult.ok) {
          return NextResponse.json(
            { error: "Unable to consume spell slot." },
            { status: 400 },
          );
        }
        updateCharacterSheet(actorCharacter.id, () => {
          const nextCasterSheet = { ...(asObject(slotResult.nextSheet) ?? {}) };
          if (concentrationStatusLabel) {
            nextCasterSheet.statusEffects = mergeUniqueStatusEffects(nextCasterSheet.statusEffects, [
              concentrationStatusLabel,
            ]);
          } else {
            const actorCombatEntry = getCombatEntryByRef(stateWithConcentration, actorCharacter.id);
            nextCasterSheet.statusEffects = syncConcentrationStatusEffect(
              nextCasterSheet.statusEffects,
              actorCombatEntry?.statusEffects,
            );
          }
          return nextCasterSheet;
        });
      }
      submitTiming.persistMs = 0;
      submitTiming.characterUpdateMs = 0;
      submitTiming.casterUpdateMs = 0;
      submitTiming.totalMs = Date.now() - requestStartedAt;
      return NextResponse.json({
        combatStateJson: stateWithConcentration,
        resolution: {
          ...spellResult.resolution,
          effectsApplied: catalogStatusEffects,
          catalogEffectId: catalogEffect?.id ?? null,
          catalogEffectName: catalogEffect?.name ?? null,
          catalogDelivery: catalogEffect?.delivery ?? null,
          catalogSave: catalogEffect?.save ?? null,
          catalogConcentration: catalogEffect?.concentration ?? null,
          catalogReactionHooks: catalogEffect?.reactionHooks ?? null,
        },
        characters: updatedCharacters,
        adapterDebug: {
          ruleset: campaign.ruleset,
          profile: adapterProfile,
          kind,
          actor,
          target,
          spellName,
          localFastMode: true,
          defaults,
          timings: submitTiming,
        },
      });
    }
    const defaults = getAttackDefaults({
      ruleset: campaign.ruleset,
      actorType,
      actorCharacter,
      targetCharacter,
      actorRuntime: actorEntry,
      targetRuntime: targetEntry,
    });
    const spellName = parseString(body.spellName) || undefined;
    const catalogEffect = resolveCatalogEffect({
      profile: adapterProfile,
      kind: kind as "attack" | "cast-spell",
      spellName,
    });
    const attackDie =
      kind === "cast-spell" && catalogEffect?.attackDieOverride
        ? catalogEffect.attackDieOverride
        : parseNumber(
            body.attackDie,
            catalogEffect?.attackDieOverride ?? defaults.attackDie,
          );
    const attackBonus = parseNumber(
      body.attackBonus,
      defaults.attackBonus + (catalogEffect?.attackBonusModifier ?? 0),
    );
    const targetAc = parseNumber(body.targetAc, defaults.targetAc);
    const damageDie =
      kind === "cast-spell" && catalogEffect?.damageDieOverride
        ? catalogEffect.damageDieOverride
        : parseNumber(
            body.damageDie,
            catalogEffect?.damageDieOverride ?? defaults.damageDie,
          );
    const damageDiceCount = parseNumber(
      body.damageDiceCount,
      catalogEffect?.damageDiceCountOverride ?? 1,
    );
    const damageBonus = parseNumber(
      body.damageBonus,
      defaults.damageBonus + (catalogEffect?.damageBonusModifier ?? 0),
    );
    const requestedSpellSlot = parseString(body.spellSlot) || undefined;
    const reactionDecision = parseString(body.reactionDecision).toLowerCase();
    const shouldConsumeSpellSlot =
      kind === "cast-spell" ? (catalogEffect?.cost?.consumesSpellSlot ?? true) : false;
    const actorLevel = getCharacterLevel(
      actorCharacter?.sheetJson as Record<string, unknown> | null,
    );
    const scaledDamageDiceCount =
      kind === "cast-spell" &&
      adapterProfile === "dnd" &&
      catalogEffect?.cost?.cantripScaling === "dnd"
        ? getDndCantripDamageDiceCount(actorLevel)
        : damageDiceCount;
    const prevalidatedSpellSlotResult =
      kind === "cast-spell" && shouldConsumeSpellSlot && actorCharacter
        ? consumeSpellSlot(actorCharacter.sheetJson as Record<string, unknown> | null, requestedSpellSlot)
        : null;
    if (
      kind === "cast-spell" &&
      shouldConsumeSpellSlot &&
      prevalidatedSpellSlotResult &&
      !prevalidatedSpellSlotResult.ok
    ) {
      return NextResponse.json(
        { error: prevalidatedSpellSlotResult.reason ?? "No spell slots remaining." },
        { status: 400 },
      );
    }

    const isMagicMissile =
      kind === "cast-spell" &&
      catalogEffect?.id === "dnd_magic_missile" &&
      catalogEffect.delivery === "auto-hit";
    if (isMagicMissile) {
      const slotLevel = parseSpellSlotLevel(requestedSpellSlot);
      const missileCount = Math.max(1, slotLevel + 2); // 5e: 3 missiles at level 1, +1 per slot level.
      const magicMissileResult = resolveAutoHitAction(hydratedCombatState, {
        actor,
        target,
        profile: adapterProfile,
        damageDie: catalogEffect.damageDieOverride ?? 4,
        damageDiceCount: missileCount,
        damageBonus: missileCount * (catalogEffect.damageBonusModifier ?? 1),
        targetConSaveBonus: getAbilitySaveBonus(
          targetCharacter?.sheetJson as Record<string, unknown> | null,
          "con",
        ),
        seedInput: `${seedInput}|magic-missile|${slotLevel}`,
      });

      if (magicMissileResult.error || !magicMissileResult.resolution) {
        return NextResponse.json(
          { error: magicMissileResult.error ?? "Unable to resolve Magic Missile." },
          { status: 400 },
        );
      }

      let updatedCharacters = campaign.characters;
      const parsedTargetHpAfter = parseHpString(magicMissileResult.resolution.targetHpAfter);
      if (targetCharacter && parsedTargetHpAfter) {
        const currentSheet = asObject(targetCharacter.sheetJson) ?? {};
        const nextSheet = { ...currentSheet };
        if (adapterProfile === "deadlands" || asObject(currentSheet.wind)) {
          const currentWind = asObject(currentSheet.wind) ?? {};
          nextSheet.wind = {
            ...currentWind,
            current: parsedTargetHpAfter.current,
            max: parsedTargetHpAfter.max,
          };
        } else {
          const currentHp = asObject(currentSheet.hp) ?? {};
          nextSheet.hp = {
            ...currentHp,
            current: parsedTargetHpAfter.current,
            max: parsedTargetHpAfter.max,
          };
        }

        const savedCharacter = await prisma.character.update({
          where: { id: targetCharacter.id },
          data: {
            sheetJson: nextSheet,
          } as never,
          select: {
            id: true,
            name: true,
            sheetJson: true,
          },
        });

        updatedCharacters = updatedCharacters.map((character) =>
          character.id === savedCharacter.id
            ? {
                ...character,
                sheetJson: savedCharacter.sheetJson,
              }
            : character,
        );
      }

      if (actorCharacter) {
        const slotResult = prevalidatedSpellSlotResult;
        if (!slotResult || !slotResult.ok) {
          return NextResponse.json(
            { error: "Unable to consume spell slot." },
            { status: 400 },
          );
        }

        const savedCaster = await prisma.character.update({
          where: { id: actorCharacter.id },
          data: {
            sheetJson: slotResult.nextSheet,
          } as never,
          select: {
            id: true,
            name: true,
            sheetJson: true,
          },
        });

        updatedCharacters = updatedCharacters.map((character) =>
          character.id === savedCaster.id
            ? {
                ...character,
                sheetJson: savedCaster.sheetJson,
              }
            : character,
        );
      }

      await prisma.campaign.update({
        where: { id },
        data: {
          combatStateJson: magicMissileResult.state,
        } as never,
      });

      return NextResponse.json({
        combatStateJson: magicMissileResult.state,
        resolution: {
          ...magicMissileResult.resolution,
          spellName,
          catalogEffectId: catalogEffect.id,
          catalogEffectName: catalogEffect.name,
        },
        characters: updatedCharacters,
      });
    }

    const isFireballAoe =
      kind === "cast-spell" &&
      catalogEffect?.id === "dnd_fireball" &&
      catalogEffect.delivery === "save";
    if (isFireballAoe) {
      const requestedTargetRefs = Array.isArray(body.targetRefs)
        ? body.targetRefs
            .filter((value): value is string => typeof value === "string")
            .map((value) => value.trim())
            .filter(Boolean)
        : [];
      const targetRefs = [
        ...new Set([...(target ? [target] : []), ...requestedTargetRefs]),
      ];
      if (targetRefs.length === 0) {
        return NextResponse.json(
          { error: "Fireball requires at least one target." },
          { status: 400 },
        );
      }

      const saveAbility = catalogEffect.save?.ability;
      const saveDc =
        getSpellSaveDc(actorCharacter?.sheetJson as Record<string, unknown> | null) ??
        catalogEffect.save?.dc;
      if (!saveAbility || !saveDc) {
        return NextResponse.json(
          { error: "Unable to resolve Fireball save metadata." },
          { status: 400 },
        );
      }

      let workingState = hydratedCombatState;
      const aoeResolutions: Array<Record<string, unknown>> = [];

      for (const [index, targetRef] of targetRefs.entries()) {
        const loopTargetCharacter = findCharacterByRef(campaign.characters, targetRef);
        const loopSaveBonus = getAbilitySaveBonus(
          loopTargetCharacter?.sheetJson as Record<string, unknown> | null,
          saveAbility,
        );
        const loopResult = resolveSaveAction(workingState, {
          actor,
          target: targetRef,
          profile: adapterProfile,
          saveAbility,
          saveDc,
          saveBonus: loopSaveBonus,
          damageDie,
          damageDiceCount: scaledDamageDiceCount,
          damageBonus,
          targetConSaveBonus: getAbilitySaveBonus(
            loopTargetCharacter?.sheetJson as Record<string, unknown> | null,
            "con",
          ),
          onSave: catalogEffect.save?.onSave ?? "none",
          onFailedSaveTargetStatusEffects:
            catalogEffect.onFailedSaveTargetStatusEffects ?? [],
          advanceTurn: false,
          seedInput: `${seedInput}|aoe|${index}`,
        });

        if (loopResult.error || !loopResult.resolution) {
          return NextResponse.json(
            {
              error:
                loopResult.error ??
                `Unable to resolve Fireball target: ${targetRef}.`,
            },
            { status: 400 },
          );
        }

        const loopResolution = loopResult.resolution as { saveSucceeded?: boolean };
        const loopDurationPayload =
          !loopResolution.saveSucceeded &&
          Array.isArray(catalogEffect.onFailedSaveTargetStatusDurations)
            ? catalogEffect.onFailedSaveTargetStatusDurations
                .filter((entry) => entry.effect && Number.isFinite(entry.durationRounds))
                .map((entry) => ({
                  effect: entry.effect.trim(),
                  remainingRounds: Math.max(1, Math.trunc(entry.durationRounds)),
                  kind: entry.kind ?? "timed",
                  breakOnDamage: entry.breakOnDamage === true,
                }))
            : [];
        workingState =
          loopDurationPayload.length > 0
            ? applyStatusEffectsToCombatState(loopResult.state, targetRef, [], {
                durations: loopDurationPayload,
              })
            : loopResult.state;
        aoeResolutions.push({
          ...loopResult.resolution,
          targetRef,
        });
      }

      const advancedAoeState = advanceTurn(workingState);
      const concentrationStatusLabel =
        catalogEffect.concentration?.required && spellName
          ? buildConcentrationStatusLabel()
          : null;
      const concentrationDuration =
        catalogEffect.concentration?.required && spellName
          ? buildConcentrationDuration(
              spellName,
              catalogEffect.concentration.durationRounds,
              catalogEffect.concentration.breakOnDamage !== false,
            )
          : null;
      const stateWithConcentration =
        concentrationStatusLabel && actor
          ? applyStatusEffectsToCombatState(advancedAoeState, actor, [
              concentrationStatusLabel,
            ], {
              durations: concentrationDuration ? [concentrationDuration] : [],
              replaceConcentration: true,
            })
          : advancedAoeState;

      await prisma.campaign.update({
        where: { id },
        data: {
          combatStateJson: stateWithConcentration,
        } as never,
      });

      let updatedCharacters = campaign.characters;

      for (const resolutionEntry of aoeResolutions) {
        const loopTargetRef = parseString(resolutionEntry.targetRef);
        const loopTargetCharacter = findCharacterByRef(campaign.characters, loopTargetRef);
        if (!loopTargetCharacter) {
          continue;
        }

        const parsedHp = parseHpString(
          typeof resolutionEntry.targetHpAfter === "string"
            ? resolutionEntry.targetHpAfter
            : undefined,
        );
        const effectsApplied = Array.isArray(resolutionEntry.effectsApplied)
          ? resolutionEntry.effectsApplied.filter(
              (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
            )
          : [];
        if (!parsedHp && effectsApplied.length === 0) {
          continue;
        }

        const currentSheet = asObject(loopTargetCharacter.sheetJson) ?? {};
        const nextSheet = { ...currentSheet };

        if (adapterProfile === "deadlands" || asObject(currentSheet.wind)) {
          const currentWind = asObject(currentSheet.wind) ?? {};
          nextSheet.wind = {
            ...currentWind,
            current: parsedHp?.current ?? parseNumber(currentWind.current, 0),
            max: parsedHp?.max ?? parseNumber(currentWind.max, 1),
          };
        } else {
          const currentHp = asObject(currentSheet.hp) ?? {};
          if (parsedHp) {
            nextSheet.hp = {
              ...currentHp,
              current: parsedHp.current,
              max: parsedHp.max,
            };
          }
        }
        if (effectsApplied.length > 0) {
          nextSheet.statusEffects = mergeUniqueStatusEffects(
            nextSheet.statusEffects,
            effectsApplied,
          );
        }
        const combatEntry = getCombatEntryByRef(
          stateWithConcentration,
          loopTargetCharacter.id,
        );
        nextSheet.statusEffects = syncConcentrationStatusEffect(
          nextSheet.statusEffects,
          combatEntry?.statusEffects,
        );

        const savedCharacter = await prisma.character.update({
          where: { id: loopTargetCharacter.id },
          data: {
            sheetJson: nextSheet,
          } as never,
          select: {
            id: true,
            name: true,
            sheetJson: true,
          },
        });

        updatedCharacters = updatedCharacters.map((character) =>
          character.id === savedCharacter.id
            ? {
                ...character,
                sheetJson: savedCharacter.sheetJson,
              }
            : character,
        );
      }

      if (actorCharacter) {
        const slotResult = prevalidatedSpellSlotResult;
        if (!slotResult || !slotResult.ok) {
          return NextResponse.json(
            { error: "Unable to consume spell slot." },
            { status: 400 },
          );
        }

        const nextCasterSheet = asObject(slotResult.nextSheet) ?? {};
        if (concentrationStatusLabel) {
          const withoutConcentrating = syncConcentrationStatusEffect(
            nextCasterSheet.statusEffects,
            [],
          );
          nextCasterSheet.statusEffects = mergeUniqueStatusEffects(withoutConcentrating, [
            concentrationStatusLabel,
          ]);
        } else {
          const combatEntry = getCombatEntryByRef(
            stateWithConcentration,
            actorCharacter.id,
          );
          nextCasterSheet.statusEffects = syncConcentrationStatusEffect(
            nextCasterSheet.statusEffects,
            combatEntry?.statusEffects,
          );
        }

        const savedCaster = await prisma.character.update({
          where: { id: actorCharacter.id },
          data: {
            sheetJson: nextCasterSheet,
          } as never,
          select: {
            id: true,
            name: true,
            sheetJson: true,
          },
        });

        updatedCharacters = updatedCharacters.map((character) =>
          character.id === savedCaster.id
            ? {
                ...character,
                sheetJson: savedCaster.sheetJson,
              }
            : character,
        );
      }

      if (debugLoggingEnabled) {
        console.info("[combat] submit", {
          campaignId: id,
          ruleset: campaign.ruleset,
          adapterProfile,
          kind,
          actor,
          target,
          targetRefs,
          spellName,
          aoe: true,
          catalogEffect: {
            id: catalogEffect.id,
            name: catalogEffect.name,
            delivery: catalogEffect.delivery,
            save: catalogEffect.save,
            concentration: catalogEffect.concentration,
          },
          applied: {
            damageDie,
            damageDiceCount,
            damageBonus,
            saveAbility,
            saveDc,
          },
        });
      }

      return NextResponse.json({
        combatStateJson: stateWithConcentration,
        resolution: {
          kind: "cast-spell",
          delivery: "save",
          aoe: true,
          actor: actorEntry?.name ?? actor,
          spellName,
          catalogEffectId: catalogEffect.id,
          catalogEffectName: catalogEffect.name,
          catalogConcentration: catalogEffect.concentration ?? null,
          catalogReactionHooks: catalogEffect.reactionHooks ?? null,
          targets: aoeResolutions,
        },
        characters: updatedCharacters,
        adapterDebug: {
          ruleset: campaign.ruleset,
          profile: adapterProfile,
          kind,
          actor,
          target,
          targetRefs,
          spellName,
          aoe: true,
        },
      });
    }

    const saveAbility = catalogEffect?.save?.ability;
    const saveDc =
      (kind === "cast-spell" && saveAbility
        ? getSpellSaveDc(actorCharacter?.sheetJson as Record<string, unknown> | null) ??
          catalogEffect?.save?.dc
        : undefined) ?? undefined;
    const targetSaveBonus =
      kind === "cast-spell" && saveAbility
        ? getAbilitySaveBonus(
            targetCharacter?.sheetJson as Record<string, unknown> | null,
            saveAbility,
          )
        : undefined;
    const targetConSaveBonus = getAbilitySaveBonus(
      targetCharacter?.sheetJson as Record<string, unknown> | null,
      "con",
    );

    const isAttackDeliveryAction =
      kind === "attack" ||
      (kind === "cast-spell" &&
        (catalogEffect?.delivery === undefined || catalogEffect.delivery === "attack"));
    const targetReactionUsed =
      isAttackDeliveryAction &&
      isReactionUsedInCombatState(hydratedCombatState, target);
    const targetCanReactWithShield =
      isAttackDeliveryAction &&
      !targetReactionUsed &&
      targetHasShieldReaction(targetCharacter) &&
      targetHasAvailableSpellSlots(targetCharacter);
    const usingShieldReaction =
      isAttackDeliveryAction &&
      reactionDecision === "use-shield" &&
      targetCanReactWithShield;
    const shieldReactionSlotResult =
      usingShieldReaction && targetCharacter
        ? consumeSpellSlot(
            targetCharacter.sheetJson as Record<string, unknown> | null,
            undefined,
          )
        : null;
    if (usingShieldReaction && shieldReactionSlotResult && !shieldReactionSlotResult.ok) {
      return NextResponse.json(
        { error: shieldReactionSlotResult.reason ?? "No spell slots remaining for Shield." },
        { status: 400 },
      );
    }
    const movementAppliedState =
      moveDestination && actorRosterEntry
        ? applyMovementToCombatState(hydratedCombatState, actor, moveDestination)
        : hydratedCombatState;
    const stateForResolution = usingShieldReaction
      ? applyStatusEffectsToCombatState(movementAppliedState, target, [
          "Reaction Used",
          "Shielded",
        ])
      : movementAppliedState;
    const previewTargetAc = targetAc;
    const effectiveTargetAc =
      isAttackDeliveryAction &&
      targetCanReactWithShield &&
      reactionDecision === "use-shield"
        ? targetAc + 5
        : targetAc;
    const initialAttackResult = isAttackDeliveryAction
      ? resolveAttackAction(movementAppliedState, {
          actor,
          target,
          profile: adapterProfile,
          attackDie,
          attackBonus,
          targetAc: previewTargetAc,
          damageDie,
          damageDiceCount: scaledDamageDiceCount,
          damageBonus,
          seedInput,
        })
      : null;
    if (
      isAttackDeliveryAction &&
      initialAttackResult?.resolution &&
      !initialAttackResult.error &&
      targetCanReactWithShield &&
      (initialAttackResult.resolution as { hit?: boolean }).hit &&
      reactionDecision !== "use-shield" &&
      reactionDecision !== "decline"
    ) {
      return NextResponse.json({
        requiresReaction: true,
        reactionPrompt: {
          targetRef: targetCharacter?.id ?? target,
          targetName: targetCharacter?.name ?? target,
          options: ["use-shield", "decline"],
          detail: "Shield can be used to add +5 AC against this triggering attack.",
        },
        previewResolution: initialAttackResult.resolution,
      });
    }

    const result =
      kind === "cast-spell" && catalogEffect?.delivery === "save" && saveAbility && saveDc
        ? resolveSaveAction(stateForResolution, {
            actor,
            target,
            profile: adapterProfile,
            saveAbility,
            saveDc,
            saveBonus: targetSaveBonus,
            damageDie,
            damageDiceCount: scaledDamageDiceCount,
            damageBonus,
            targetConSaveBonus,
            onSave: catalogEffect.save?.onSave ?? "none",
            onFailedSaveTargetStatusEffects:
              catalogEffect.onFailedSaveTargetStatusEffects ?? [],
            seedInput,
          })
        : isAttackDeliveryAction
        ? resolveAttackAction(stateForResolution, {
            actor,
            target,
            profile: adapterProfile,
            attackDie,
            attackBonus,
            targetAc: effectiveTargetAc,
            damageDie,
            damageDiceCount: scaledDamageDiceCount,
            damageBonus,
            targetConSaveBonus,
            seedInput,
          })
        : resolveUtilityAction(movementAppliedState, {
            actor,
            kind: kind as
              | "defend"
              | "pass"
              | "help"
              | "disengage"
              | "dash"
              | "take-cover"
              | "aim"
              | "surrender"
              | "attempt-escape",
            profile: adapterProfile,
            seedInput,
          });

    if (result.error || !result.resolution) {
      return NextResponse.json(
        { error: result.error ?? "Unable to resolve action." },
        { status: 400 },
      );
    }

    const attackResolution =
      kind === "attack" || kind === "cast-spell"
        ? (result.resolution as {
            targetHpAfter?: string;
            hit?: boolean;
            delivery?: "attack" | "save";
            saveSucceeded?: boolean;
            targetWoundsAfter?: number;
            targetWoundLocation?:
              | "head"
              | "guts"
              | "leftArm"
              | "rightArm"
              | "leftLeg"
              | "rightLeg";
            targetWoundLocationAfter?: number;
            targetIncapacitated?: boolean;
          })
        : null;
    const catalogStatusEffects =
      catalogEffect?.delivery === "save"
        ? !attackResolution?.saveSucceeded && catalogEffect?.onFailedSaveTargetStatusEffects
          ? catalogEffect.onFailedSaveTargetStatusEffects
          : []
        : attackResolution?.hit && catalogEffect?.onHitTargetStatusEffects
          ? catalogEffect.onHitTargetStatusEffects
          : [];
    const catalogStatusDurations: CombatStatusDuration[] =
      catalogEffect?.delivery === "save"
        ? !attackResolution?.saveSucceeded &&
          Array.isArray(catalogEffect?.onFailedSaveTargetStatusDurations)
          ? catalogEffect.onFailedSaveTargetStatusDurations
              .filter((entry) => entry.effect && Number.isFinite(entry.durationRounds))
              .map((entry) => ({
                effect: entry.effect.trim(),
                remainingRounds: Math.max(1, Math.trunc(entry.durationRounds)),
                kind: entry.kind ?? "timed",
                breakOnDamage: entry.breakOnDamage === true,
              }))
          : []
        : attackResolution?.hit && Array.isArray(catalogEffect?.onHitTargetStatusDurations)
          ? catalogEffect.onHitTargetStatusDurations
              .filter((entry) => entry.effect && Number.isFinite(entry.durationRounds))
              .map((entry) => ({
                effect: entry.effect.trim(),
                remainingRounds: Math.max(1, Math.trunc(entry.durationRounds)),
                kind: entry.kind ?? "timed",
                breakOnDamage: entry.breakOnDamage === true,
              }))
          : [];
    const hookSuccess =
      catalogEffect?.delivery === "save"
        ? !attackResolution?.saveSucceeded
        : attackResolution?.hit ?? false;
    const advantageHookStatusEffects =
      hookSuccess && catalogEffect?.advantageHooks?.targetGrantsAdvantageToAttackers
        ? ["Grant Advantage"]
        : [];
    const actorAdvantageHookStatusEffects =
      hookSuccess && catalogEffect?.advantageHooks?.actorGainsAdvantageOnNextAttack
        ? ["Advantage Next Attack"]
        : [];
    const concentrationStatusLabel =
      kind === "cast-spell" &&
      catalogEffect?.concentration?.required &&
      spellName
        ? buildConcentrationStatusLabel()
        : null;
    const concentrationDuration =
      kind === "cast-spell" &&
      catalogEffect?.concentration?.required &&
      spellName
        ? buildConcentrationDuration(
            spellName,
            catalogEffect.concentration.durationRounds,
            catalogEffect.concentration.breakOnDamage !== false,
          )
        : null;
    const stateWithTargetHookEffects =
      target && [...catalogStatusEffects, ...advantageHookStatusEffects].length > 0
        ? applyStatusEffectsToCombatState(result.state, target, [
            ...catalogStatusEffects,
            ...advantageHookStatusEffects,
          ], {
            durations: catalogStatusDurations,
          })
        : result.state;
    const stateWithCatalogEffects =
      actor && actorAdvantageHookStatusEffects.length > 0
        ? applyStatusEffectsToCombatState(stateWithTargetHookEffects, actor, [
            ...actorAdvantageHookStatusEffects,
          ])
        : stateWithTargetHookEffects;
    const stateWithConcentration =
      concentrationStatusLabel && actor
        ? applyStatusEffectsToCombatState(stateWithCatalogEffects, actor, [
            concentrationStatusLabel,
          ], {
            durations: concentrationDuration ? [concentrationDuration] : [],
            replaceConcentration: true,
          })
        : stateWithCatalogEffects;
    const parsedTargetHpAfter = parseHpString(attackResolution?.targetHpAfter);
    const reactionWindows = buildReactionWindows({
      kind,
      resolution: (result.resolution as Record<string, unknown>) ?? {},
      targetRef: target,
      targetName: targetCharacter?.name ?? target,
      targetCharacter,
      targetReactionUsed:
        usingShieldReaction ||
        isReactionUsedInCombatState(stateWithConcentration, target),
      catalogReactionHooks: catalogEffect?.reactionHooks ?? null,
    });
    let updatedCharacters = campaign.characters;
    let characterUpdateMs = 0;
    let casterUpdateMs = 0;
    const statePersistStartedAt = Date.now();
    await prisma.campaign.update({
      where: { id },
      data: {
        combatStateJson: stateWithConcentration,
      } as never,
    });
    submitTiming.statePersistMs = Date.now() - statePersistStartedAt;

    if (
      targetCharacter &&
      (parsedTargetHpAfter || (usingShieldReaction && shieldReactionSlotResult?.ok))
    ) {
      const currentSheet =
        usingShieldReaction && shieldReactionSlotResult?.ok
          ? asObject(shieldReactionSlotResult.nextSheet) ?? {}
          : asObject(targetCharacter.sheetJson) ?? {};
      const nextSheet = { ...currentSheet };

      if (adapterProfile === "deadlands" || asObject(currentSheet.wind)) {
        const currentWind = asObject(currentSheet.wind) ?? {};
        nextSheet.wind = {
          ...currentWind,
          current: parsedTargetHpAfter.current,
          max: parsedTargetHpAfter.max,
        };

        if (typeof attackResolution?.targetWoundsAfter === "number") {
          const woundValue = Math.max(0, Math.min(4, Math.trunc(attackResolution.targetWoundsAfter)));
          const currentWounds = asObject(currentSheet.wounds) ?? {};
          nextSheet.wounds = {
            ...currentWounds,
            current: woundValue,
            max: 4,
            threshold: 4,
            level: toDeadlandsWoundLevel(woundValue),
            penalty: Math.min(0, -woundValue),
          };

          const currentLocations = asObject(currentSheet.woundsByLocation) ?? {};
          const nextLocations = {
            head: parseNumber(currentLocations.head, 0),
            guts: parseNumber(currentLocations.guts, 0),
            leftArm: parseNumber(currentLocations.leftArm, 0),
            rightArm: parseNumber(currentLocations.rightArm, 0),
            leftLeg: parseNumber(currentLocations.leftLeg, 0),
            rightLeg: parseNumber(currentLocations.rightLeg, 0),
          };

          if (
            attackResolution.targetWoundLocation &&
            typeof attackResolution.targetWoundLocationAfter === "number"
          ) {
            nextLocations[attackResolution.targetWoundLocation] = Math.max(
              0,
              Math.min(4, Math.trunc(attackResolution.targetWoundLocationAfter)),
            );
          }

          nextSheet.woundsByLocation = nextLocations;
          nextSheet.woundShorthand = `H${nextLocations.head} G${nextLocations.guts} LA${nextLocations.leftArm} RA${nextLocations.rightArm} LL${nextLocations.leftLeg} RL${nextLocations.rightLeg}`;

          const existingStatusEffects = Array.isArray(nextSheet.statusEffects)
            ? nextSheet.statusEffects.filter(
                (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
              )
            : [];
          const withoutIncapacitated = existingStatusEffects.filter(
            (entry) => entry.toLowerCase() !== "incapacitated",
          );
          nextSheet.statusEffects = attackResolution.targetIncapacitated
            ? [...withoutIncapacitated, "Incapacitated"]
            : withoutIncapacitated;
        }
      } else {
        const currentHp = asObject(currentSheet.hp) ?? {};
        if (parsedTargetHpAfter) {
          nextSheet.hp = {
            ...currentHp,
            current: parsedTargetHpAfter.current,
            max: parsedTargetHpAfter.max,
          };
        }
      }
      if ([...catalogStatusEffects, ...advantageHookStatusEffects].length > 0) {
        nextSheet.statusEffects = mergeUniqueStatusEffects(
          nextSheet.statusEffects,
          [...catalogStatusEffects, ...advantageHookStatusEffects],
        );
      }
      const targetCombatEntry = getCombatEntryByRef(
        stateWithConcentration,
        targetCharacter.id,
      );
      nextSheet.statusEffects = syncConcentrationStatusEffect(
        nextSheet.statusEffects,
        targetCombatEntry?.statusEffects,
      );

      const characterPersistStartedAt = Date.now();
      const savedCharacter = await prisma.character.update({
        where: { id: targetCharacter.id },
        data: {
          sheetJson: nextSheet,
        } as never,
        select: {
          id: true,
          name: true,
          sheetJson: true,
        },
      });

      updatedCharacters = campaign.characters.map((character) =>
        character.id === savedCharacter.id
          ? {
              ...character,
              sheetJson: savedCharacter.sheetJson,
            }
          : character,
      );
      characterUpdateMs += Date.now() - characterPersistStartedAt;
    }

    const shouldUpdateCasterSheet =
      kind === "cast-spell" &&
      actorCharacter &&
      (shouldConsumeSpellSlot ||
        Boolean(concentrationStatusLabel) ||
        actorAdvantageHookStatusEffects.length > 0);
    if (shouldUpdateCasterSheet && actorCharacter) {
      const slotResult = prevalidatedSpellSlotResult;
      if (shouldConsumeSpellSlot && (!slotResult || !slotResult.ok)) {
        return NextResponse.json(
          { error: "Unable to consume spell slot." },
          { status: 400 },
        );
      }

      const casterBaseSheet =
        shouldConsumeSpellSlot && slotResult?.ok
          ? (asObject(slotResult.nextSheet) ?? {})
          : (asObject(actorCharacter.sheetJson) ?? {});
      const nextCasterSheet = { ...casterBaseSheet };
      const casterStatusAdditions = [
        ...(concentrationStatusLabel ? [concentrationStatusLabel] : []),
        ...actorAdvantageHookStatusEffects,
      ];
      if (casterStatusAdditions.length > 0) {
        nextCasterSheet.statusEffects = mergeUniqueStatusEffects(
          nextCasterSheet.statusEffects,
          casterStatusAdditions,
        );
      }
      const actorCombatEntry = getCombatEntryByRef(
        stateWithConcentration,
        actorCharacter.id,
      );
      nextCasterSheet.statusEffects = syncConcentrationStatusEffect(
        nextCasterSheet.statusEffects,
        actorCombatEntry?.statusEffects,
      );

      const casterPersistStartedAt = Date.now();
      const savedCaster = await prisma.character.update({
        where: { id: actorCharacter.id },
        data: {
          sheetJson: nextCasterSheet,
        } as never,
        select: {
          id: true,
          name: true,
          sheetJson: true,
        },
      });

      updatedCharacters = updatedCharacters.map((character) =>
        character.id === savedCaster.id
          ? {
              ...character,
              sheetJson: savedCaster.sheetJson,
            }
          : character,
      );
      casterUpdateMs += Date.now() - casterPersistStartedAt;
    }
    submitTiming.characterUpdateMs = characterUpdateMs;
    submitTiming.casterUpdateMs = casterUpdateMs;
    submitTiming.totalMs = Date.now() - requestStartedAt;

    if (debugLoggingEnabled) {
      console.info("[combat] submit", {
        campaignId: id,
        ruleset: campaign.ruleset,
        adapterProfile,
        kind,
        actor,
        target,
        spellName,
        catalogEffect: catalogEffect
          ? {
              id: catalogEffect.id,
              name: catalogEffect.name,
              delivery: catalogEffect.delivery,
              save: catalogEffect.save,
              concentration: catalogEffect.concentration,
              advantageHooks: catalogEffect.advantageHooks,
              reactionHooks: catalogEffect.reactionHooks,
              onHitTargetStatusEffects: catalogEffect.onHitTargetStatusEffects,
              onFailedSaveTargetStatusEffects: catalogEffect.onFailedSaveTargetStatusEffects,
            }
          : null,
        defaults,
        applied: {
          attackDie,
          attackBonus,
          targetAc,
          damageDie,
          damageDiceCount: scaledDamageDiceCount,
          damageBonus,
          saveAbility,
          saveDc,
          targetSaveBonus,
          reactionWindows,
        },
        timings: submitTiming,
      });
    }

    return NextResponse.json({
      combatStateJson: stateWithConcentration,
      resolution:
        kind === "attack" || kind === "cast-spell"
          ? {
              ...result.resolution,
              effectsApplied: [...catalogStatusEffects, ...advantageHookStatusEffects],
              actorEffectsApplied: [...actorAdvantageHookStatusEffects],
              catalogEffectId: catalogEffect?.id ?? null,
              catalogEffectName: catalogEffect?.name ?? null,
              catalogDelivery: catalogEffect?.delivery ?? null,
              catalogSave: catalogEffect?.save ?? null,
              catalogConcentration: catalogEffect?.concentration ?? null,
              catalogAdvantageHooks: catalogEffect?.advantageHooks ?? null,
              catalogReactionHooks: catalogEffect?.reactionHooks ?? null,
              reactionWindows,
              reactionDecision:
                reactionDecision === "use-shield" || reactionDecision === "decline"
                  ? reactionDecision
                  : null,
            }
          : result.resolution,
      characters: updatedCharacters,
      adapterDebug: {
        ruleset: campaign.ruleset,
        profile: adapterProfile,
        kind,
        actor,
        target,
        spellName,
        defaultProfileContext: {
          actorType,
          targetType: targetCharacter ? "character" : "enemy",
          actorLevel: getCharacterLevel(
            actorCharacter?.sheetJson as Record<string, unknown> | null,
          ),
          targetLevel: getCharacterLevel(
            targetCharacter?.sheetJson as Record<string, unknown> | null,
          ),
        },
        catalogEffect: catalogEffect
          ? {
              id: catalogEffect.id,
              name: catalogEffect.name,
              delivery: catalogEffect.delivery,
              save: catalogEffect.save,
              concentration: catalogEffect.concentration,
              advantageHooks: catalogEffect.advantageHooks,
              reactionHooks: catalogEffect.reactionHooks,
              onHitTargetStatusEffects: catalogEffect.onHitTargetStatusEffects,
              onFailedSaveTargetStatusEffects: catalogEffect.onFailedSaveTargetStatusEffects,
            }
          : null,
        defaults,
        applied: {
          attackDie,
          attackBonus,
          targetAc: effectiveTargetAc,
          damageDie,
          damageDiceCount,
          damageBonus,
          saveAbility,
          saveDc,
          targetSaveBonus,
          reactionWindows,
        },
        timings: submitTiming,
      },
    });
  }

  if (action === "advance-turn") {
    const nextState = advanceTurn(currentCombatState);

    await prisma.campaign.update({
      where: { id },
      data: {
        combatStateJson: nextState,
      } as never,
    });

    return NextResponse.json({
      combatStateJson: nextState,
    });
  }

  if (action === "end") {
    await prisma.campaign.update({
      where: { id },
      data: {
        combatStateJson: DEFAULT_COMBAT_STATE,
      } as never,
    });

    return NextResponse.json({
      combatStateJson: DEFAULT_COMBAT_STATE,
    });
  }

  return NextResponse.json({ error: "Unsupported combat action." }, { status: 400 });
}
