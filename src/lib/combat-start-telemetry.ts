import type { EncounterStartCombatantSeed } from "@/lib/encounter-resolver";

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

function defaultEnemyHpForProfile(profile: "dnd" | "deadlands" | "generic") {
  if (profile === "dnd") {
    return "12/12";
  }
  if (profile === "deadlands") {
    return "10/10";
  }
  return "8/8";
}

function normalizeNameKey(value: string) {
  return value.trim().toLowerCase();
}

export type CombatStartEnemyAssignment = {
  name: string;
  hpBefore: string | null;
  hpAfter: string | null;
  hpAssignedByResolver: boolean;
  hpForcedFallback: boolean;
  initiativeModifier: number | null;
  summary: string | null;
  statusEffects: string[];
};

export function normalizeCombatStartSeedsWithTelemetry(params: {
  inputCombatants: EncounterStartCombatantSeed[];
  resolvedCombatants: EncounterStartCombatantSeed[];
  adapterProfile: "dnd" | "deadlands" | "generic";
}) {
  const { inputCombatants, resolvedCombatants, adapterProfile } = params;
  const inputEnemyByName = new Map(
    inputCombatants
      .filter((entry) => entry.type === "enemy")
      .map((entry) => [normalizeNameKey(entry.name), entry]),
  );

  const startReadyCombatants = resolvedCombatants.map((entry) => {
    if (entry.type !== "enemy") {
      return entry;
    }
    if (parseHpString(entry.hp)) {
      return entry;
    }
    return {
      ...entry,
      hp: defaultEnemyHpForProfile(adapterProfile),
    };
  });

  const enemyAssignments: CombatStartEnemyAssignment[] = startReadyCombatants
    .filter((entry) => entry.type === "enemy")
    .map((entry) => {
      const inputEnemy = inputEnemyByName.get(normalizeNameKey(entry.name));
      const resolvedBeforeFallback =
        resolvedCombatants.find(
          (candidate) =>
            candidate.type === "enemy" &&
            normalizeNameKey(candidate.name) === normalizeNameKey(entry.name),
        ) ?? null;
      const inputHpNumeric = parseHpString(inputEnemy?.hp ?? undefined);
      const resolvedBeforeNumeric = parseHpString(resolvedBeforeFallback?.hp ?? undefined);
      const resolvedAfterNumeric = parseHpString(entry.hp);

      return {
        name: entry.name,
        hpBefore: inputEnemy?.hp ?? null,
        hpAfter: entry.hp ?? null,
        hpAssignedByResolver: !inputHpNumeric && Boolean(resolvedBeforeNumeric),
        hpForcedFallback: !resolvedBeforeNumeric && Boolean(resolvedAfterNumeric),
        initiativeModifier: entry.initiativeModifier ?? null,
        summary: entry.summary ?? null,
        statusEffects: entry.statusEffects ?? [],
      };
    });

  return {
    startReadyCombatants,
    enemyAssignments,
  };
}

