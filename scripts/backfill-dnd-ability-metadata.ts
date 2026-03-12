import { loadEnvConfig } from "@next/env";
import { prisma } from "../src/lib/prisma";
import { getDndPointBuySpent, isStandardArrayMatch } from "../src/lib/dnd-ability-builder";

loadEnvConfig(process.cwd());

type BackfillOptions = {
  ruleset: string;
  dryRun: boolean;
};

function parseBackfillOptions(argv: string[]): BackfillOptions {
  let ruleset = "D&D 5e";
  let dryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg.startsWith("--ruleset=")) {
      ruleset = arg.slice("--ruleset=".length).trim() || ruleset;
      continue;
    }
    if (arg === "--ruleset") {
      const next = argv[index + 1];
      if (next && !next.startsWith("--")) {
        ruleset = next.trim() || ruleset;
        index += 1;
      }
    }
  }

  return { ruleset, dryRun };
}

function asObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function deriveAbilitySummary(sheet: Record<string, unknown>) {
  const statsObj = asObject(sheet.stats);
  const scoreKeys = ["str", "dex", "con", "int", "wis", "cha"] as const;
  const scores = scoreKeys.map((key) => {
    const value = statsObj?.[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof sheet[key] === "number" && Number.isFinite(sheet[key])) {
      return sheet[key] as number;
    }
    return 10;
  });
  const method =
    typeof sheet.abilityGenerationMethod === "string" && sheet.abilityGenerationMethod.trim()
      ? sheet.abilityGenerationMethod.trim()
      : "manual-enter";
  const pointBuySpent = getDndPointBuySpent(scores);
  return {
    method,
    standardArrayMatch: isStandardArrayMatch(scores),
    pointBuySpent,
    pointBuyLegal:
      method === "point-buy" &&
      scores.every((score) => score >= 8 && score <= 15) &&
      pointBuySpent <= 27,
  };
}

function deriveFallbackDerivedStats(sheet: Record<string, unknown>) {
  const hpObj = asObject(sheet.hp);
  const hpMax =
    (hpObj && typeof hpObj.max === "number" ? hpObj.max : null) ??
    (typeof sheet.hp === "number" ? sheet.hp : 1);
  const ac = typeof sheet.ac === "number" ? sheet.ac : 10;
  const spellAttackBonus =
    typeof sheet.spellAttackBonus === "number" ? sheet.spellAttackBonus : null;
  const spellSaveDc =
    typeof sheet.spellSaveDc === "number" ? sheet.spellSaveDc : null;
  return {
    computed: {
      hpMax,
      ac,
      spellAttackBonus,
      spellSaveDc,
    },
    applied: {
      hpMax,
      ac,
      spellAttackBonus,
      spellSaveDc,
    },
    overrides: {
      hpMax: false,
      ac: false,
      spellAttackBonus: false,
      spellSaveDc: false,
    },
  };
}

async function backfillLibraryCharacters(options: BackfillOptions) {
  const records = await prisma.libraryCharacter.findMany({
    where: {
      ruleset: options.ruleset,
    },
    select: {
      id: true,
      sheetJson: true,
    },
  });

  let updated = 0;
  for (const record of records) {
    const sheet = asObject(record.sheetJson);
    if (!sheet) {
      continue;
    }
    const nextSheet = { ...sheet };
    let changed = false;
    if (!asObject(nextSheet.abilityGenerationSummary)) {
      nextSheet.abilityGenerationSummary = deriveAbilitySummary(nextSheet);
      changed = true;
    }
    if (!asObject(nextSheet.derivedStats)) {
      nextSheet.derivedStats = deriveFallbackDerivedStats(nextSheet);
      changed = true;
    }
    if (changed) {
      if (options.dryRun) {
        updated += 1;
        continue;
      }
      await prisma.libraryCharacter.update({
        where: { id: record.id },
        data: { sheetJson: nextSheet },
      });
      updated += 1;
    }
  }
  return updated;
}

async function backfillCampaignCharacters(options: BackfillOptions) {
  const records = await prisma.character.findMany({
    where: {
      campaign: {
        ruleset: options.ruleset,
      },
    },
    select: {
      id: true,
      sheetJson: true,
    },
  });

  let updated = 0;
  for (const record of records) {
    const sheet = asObject(record.sheetJson);
    if (!sheet) {
      continue;
    }
    const nextSheet = { ...sheet };
    let changed = false;
    if (!asObject(nextSheet.abilityGenerationSummary)) {
      nextSheet.abilityGenerationSummary = deriveAbilitySummary(nextSheet);
      changed = true;
    }
    if (!asObject(nextSheet.derivedStats)) {
      nextSheet.derivedStats = deriveFallbackDerivedStats(nextSheet);
      changed = true;
    }
    if (changed) {
      if (options.dryRun) {
        updated += 1;
        continue;
      }
      await prisma.character.update({
        where: { id: record.id },
        data: { sheetJson: nextSheet },
      });
      updated += 1;
    }
  }
  return updated;
}

async function main() {
  const options = parseBackfillOptions(process.argv.slice(2));
  const [libraryUpdated, campaignUpdated] = await Promise.all([
    backfillLibraryCharacters(options),
    backfillCampaignCharacters(options),
  ]);
  const modeLabel = options.dryRun ? "Dry-run complete" : "Backfill complete";
  console.log(`${modeLabel} for ruleset "${options.ruleset}".`);
  console.log(
    `Library updated: ${libraryUpdated}, campaign characters updated: ${campaignUpdated}.`,
  );
}

main()
  .catch((error) => {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "ECONNREFUSED"
    ) {
      const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL || "";
      let hostHint = "unknown host";
      try {
        if (connectionString) {
          const parsed = new URL(connectionString);
          hostHint = `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`;
        }
      } catch {
        // Ignore URL parse errors for non-standard connection strings.
      }
      console.error(
        `Backfill failed: could not connect to database at ${hostHint}. Ensure DB is running and env vars are loaded (.env/.env.local).`,
      );
    }
    console.error("Backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
