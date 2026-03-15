import { readFile } from "node:fs/promises";
import { prisma } from "@/lib/prisma";
import { findOrGenerateToken, normalizeTokenKey } from "@/lib/token-library";

type CreatureLibraryRecord = {
  id: string;
  ruleset: string;
  source: string;
  sourceId: string;
  slug: string;
  name: string;
  aliasesJson: unknown;
  size: string | null;
  creatureType: string | null;
  subtype: string | null;
  alignment: string | null;
  acJson: unknown;
  hpFormula: string | null;
  hpAvg: number | null;
  speedJson: unknown;
  abilityModsJson: unknown;
  attackProfilesJson: unknown;
  cr: string | null;
  xpDerived: number | null;
  tagsJson: unknown;
  rawJson: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type TokenKeyRecord = {
  normalizedKey: string;
  label: string;
};

const CR_XP_TABLE: Record<string, number> = {
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

const prismaAny = prisma as unknown as {
  creatureLibraryEntry: {
    findMany: (args: Record<string, unknown>) => Promise<CreatureLibraryRecord[]>;
    upsert: (args: Record<string, unknown>) => Promise<CreatureLibraryRecord>;
  };
  tokenLibraryEntry: {
    findMany: (args: Record<string, unknown>) => Promise<TokenKeyRecord[]>;
  };
};

function getCreatureLibraryDelegate() {
  const delegate = (prismaAny as { creatureLibraryEntry?: unknown }).creatureLibraryEntry;
  if (!delegate) {
    throw new Error(
      "CreatureLibraryEntry model is unavailable in Prisma Client. Run migrations and regenerate Prisma client.",
    );
  }
  return delegate as {
    findMany: (args: Record<string, unknown>) => Promise<CreatureLibraryRecord[]>;
    upsert: (args: Record<string, unknown>) => Promise<CreatureLibraryRecord>;
  };
}

function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asOptionalInt(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function normalizeSlugPart(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function deriveXpFromCr(cr: string) {
  const normalized = cr.trim();
  if (!normalized) {
    return null;
  }
  if (normalized in CR_XP_TABLE) {
    return CR_XP_TABLE[normalized];
  }
  return null;
}

export function buildCreatureTokenNormalizedKey(slug: string) {
  return normalizeTokenKey(`enemy:creature:${slug}`);
}

export type CreatureLibraryListEntry = CreatureLibraryRecord & {
  hasToken: boolean;
};

export async function listCreatureLibraryEntries(params: {
  ruleset?: string;
  creatureType?: string;
  name?: string;
  limit?: number;
  needsTokenOnly?: boolean;
}) {
  const where: Record<string, unknown> = {};
  if (params.ruleset?.trim()) {
    where.ruleset = { equals: params.ruleset.trim(), mode: "insensitive" };
  }
  if (params.creatureType?.trim()) {
    where.creatureType = { equals: params.creatureType.trim(), mode: "insensitive" };
  }
  if (params.name?.trim()) {
    where.name = { contains: params.name.trim(), mode: "insensitive" };
  }
  const entries = await getCreatureLibraryDelegate().findMany({
    where,
    orderBy: [{ name: "asc" }],
    take: Math.max(1, Math.min(1000, params.limit ?? 200)),
  });
  if (!entries.length) {
    return [] as CreatureLibraryListEntry[];
  }

  const tokenWhere: Record<string, unknown> = {
    entityType: { equals: "enemy", mode: "insensitive" },
  };
  if (params.ruleset?.trim()) {
    tokenWhere.ruleset = { equals: params.ruleset.trim(), mode: "insensitive" };
  }
  const tokenEntries = await prismaAny.tokenLibraryEntry.findMany({
    where: tokenWhere,
    select: { normalizedKey: true, label: true },
    take: 5000,
  });
  const tokenKeys = new Set(tokenEntries.map((entry) => entry.normalizedKey));
  const tokenLabels = new Set(
    tokenEntries
      .map((entry) => entry.label?.trim().toLowerCase())
      .filter((value): value is string => Boolean(value)),
  );

  const withTokenState = entries.map((entry) => ({
    ...entry,
    hasToken:
      tokenKeys.has(buildCreatureTokenNormalizedKey(entry.slug)) ||
      tokenLabels.has(entry.name.trim().toLowerCase()),
  }));
  if (params.needsTokenOnly) {
    return withTokenState.filter((entry) => !entry.hasToken);
  }
  return withTokenState;
}

function toTitleCase(value: string) {
  return value
    .trim()
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function buildCreatureTokenDescription(entry: CreatureLibraryRecord) {
  const footprint =
    entry.size?.trim().toLowerCase() === "large"
      ? "2x2"
      : entry.size?.trim().toLowerCase() === "huge"
        ? "3x3"
        : entry.size?.trim().toLowerCase() === "gargantuan"
          ? "4x4"
          : "1x1";
  const details = [
    `Creature name: ${entry.name}.`,
    entry.size ? `Size: ${entry.size}.` : "",
    entry.creatureType ? `Type: ${entry.creatureType}.` : "",
    entry.subtype ? `Subtype: ${entry.subtype}.` : "",
    entry.alignment ? `Alignment: ${entry.alignment}.` : "",
    entry.cr ? `Challenge rating: ${entry.cr}.` : "",
    entry.hpAvg ? `Average hit points: ${entry.hpAvg}.` : "",
    `Footprint: ${footprint} tiles.`,
  ].filter(Boolean);
  return `${details.join(" ")} Build one tabletop token miniature matching this creature footprint.`;
}

export async function generateNextCreatureToken(params: {
  ruleset: string;
  style?: string;
  forceRegenerate?: boolean;
  approved?: boolean;
  creatureType?: string;
  name?: string;
}) {
  const where: Record<string, unknown> = {};
  if (params.ruleset?.trim()) {
    where.ruleset = { equals: params.ruleset.trim(), mode: "insensitive" };
  }
  if (params.creatureType?.trim()) {
    where.creatureType = { equals: params.creatureType.trim(), mode: "insensitive" };
  }
  if (params.name?.trim()) {
    where.name = { contains: params.name.trim(), mode: "insensitive" };
  }

  const candidateEntries = await getCreatureLibraryDelegate().findMany({
    where,
    orderBy: [{ name: "asc" }],
    take: 1000,
  });

  const tokenWhere: Record<string, unknown> = {
    entityType: { equals: "enemy", mode: "insensitive" },
  };
  if (params.ruleset?.trim()) {
    tokenWhere.ruleset = { equals: params.ruleset.trim(), mode: "insensitive" };
  }
  const tokenEntries = await prismaAny.tokenLibraryEntry.findMany({
    where: tokenWhere,
    select: { normalizedKey: true, label: true },
    take: 5000,
  });
  const tokenKeys = new Set(tokenEntries.map((entry) => entry.normalizedKey));

  const nextEntry =
    candidateEntries.find(
      (entry) => !tokenKeys.has(buildCreatureTokenNormalizedKey(entry.slug)),
    ) ?? null;
  if (!nextEntry) {
    return {
      generated: false as const,
      reason: "No unbound creatures found.",
      queue: {
        totalCandidates: candidateEntries.length,
        unboundCandidates: 0,
      },
    };
  }

  const category = nextEntry.creatureType?.trim()
    ? toTitleCase(nextEntry.creatureType)
    : "Creature";
  const subtype = nextEntry.subtype?.trim() || null;

  const result = await findOrGenerateToken({
    entityType: "enemy",
    ruleset: params.ruleset,
    category,
    subtype: subtype ?? undefined,
    normalizedKey: buildCreatureTokenNormalizedKey(nextEntry.slug),
    label: nextEntry.name,
    customDescription: buildCreatureTokenDescription(nextEntry),
    style: params.style?.trim() || "stone-base",
    forceRegenerate: params.forceRegenerate ?? false,
    approved: params.approved ?? false,
  });

  return {
    generated: true as const,
    creature: nextEntry,
    token: result.token,
    cacheHit: result.cacheHit,
    queue: {
      totalCandidates: candidateEntries.length,
      unboundCandidates: candidateEntries.filter(
        (entry) => !tokenKeys.has(buildCreatureTokenNormalizedKey(entry.slug)),
      ).length,
    },
  };
}

export async function importOpen5eCreatureLibrary(params: {
  filePath: string;
  ruleset?: string;
  source?: string;
}) {
  const fileText = await readFile(params.filePath, "utf8");
  const parsed = JSON.parse(fileText) as unknown;
  const root = asRecord(parsed);
  if (!root) {
    throw new Error("Invalid Open5e JSON: root object missing.");
  }
  const monstersRecord = asRecord(root.monsters);
  if (!monstersRecord) {
    throw new Error("Invalid Open5e JSON: monsters object missing.");
  }

  const ruleset = params.ruleset?.trim() || "D&D 5e";
  const source = params.source?.trim() || asString(root.source) || "open5e";

  let upserted = 0;
  let skipped = 0;
  let failed = 0;
  const failures: Array<{ key: string; reason: string }> = [];

  for (const [key, value] of Object.entries(monstersRecord)) {
    const monster = asRecord(value);
    if (!monster) {
      skipped += 1;
      continue;
    }
    try {
      const sourceId = asString(monster.id) || key;
      const name = asString(monster.name);
      if (!sourceId || !name) {
        skipped += 1;
        continue;
      }
      const fallbackSlugPart = normalizeSlugPart(sourceId.includes(":") ? sourceId.split(":").pop() ?? sourceId : sourceId);
      const slug = `dnd5e_${fallbackSlugPart || normalizeSlugPart(name) || "creature"}`;
      const aliases = Array.isArray(monster.alias)
        ? monster.alias.filter((entry): entry is string => typeof entry === "string")
        : [];
      const cr = asString(monster.cr);
      const xpDerived = deriveXpFromCr(cr);

      await getCreatureLibraryDelegate().upsert({
        where: {
          ruleset_source_sourceId: {
            ruleset,
            source,
            sourceId,
          },
        },
        create: {
          ruleset,
          source,
          sourceId,
          slug,
          name,
          aliasesJson: aliases,
          size: asString(monster.size) || null,
          creatureType: asString(monster.type) || null,
          subtype: asString(monster.subtype) || null,
          alignment: asString(monster.alignment) || null,
          acJson: monster.ac ?? null,
          hpFormula: asString(monster.hp_formula) || null,
          hpAvg: asOptionalInt(monster.hp_avg),
          speedJson: monster.speed ?? null,
          abilityModsJson: monster.ability_mods ?? null,
          attackProfilesJson: monster.attack_profiles ?? null,
          cr: cr || null,
          xpDerived,
          tagsJson: Array.isArray(monster.tags) ? monster.tags : null,
          rawJson: monster,
        },
        update: {
          slug,
          name,
          aliasesJson: aliases,
          size: asString(monster.size) || null,
          creatureType: asString(monster.type) || null,
          subtype: asString(monster.subtype) || null,
          alignment: asString(monster.alignment) || null,
          acJson: monster.ac ?? null,
          hpFormula: asString(monster.hp_formula) || null,
          hpAvg: asOptionalInt(monster.hp_avg),
          speedJson: monster.speed ?? null,
          abilityModsJson: monster.ability_mods ?? null,
          attackProfilesJson: monster.attack_profiles ?? null,
          cr: cr || null,
          xpDerived,
          tagsJson: Array.isArray(monster.tags) ? monster.tags : null,
          rawJson: monster,
        },
      });
      upserted += 1;
    } catch (error) {
      failed += 1;
      failures.push({
        key,
        reason: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return {
    ruleset,
    source,
    totalMonsters: Object.keys(monstersRecord).length,
    upserted,
    skipped,
    failed,
    failures: failures.slice(0, 25),
  };
}
