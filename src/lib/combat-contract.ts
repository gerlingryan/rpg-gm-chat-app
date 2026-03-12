export const COMBAT_CONTRACT_VERSION = 1 as const;

export type CombatControlMode = "gm-managed" | "engine-managed";

export const DEFAULT_COMBAT_CONTROL_MODE: CombatControlMode = "gm-managed";

export type CombatStartEnemySeed = {
  name: string;
  summary?: string;
  hp?: string;
  abilities?: string[];
};

export type CombatStartContract = {
  triggered: boolean;
  reason: string;
  enemies: CombatStartEnemySeed[];
};

export const DEFAULT_COMBAT_START_CONTRACT: CombatStartContract = {
  triggered: false,
  reason: "",
  enemies: [],
};

export function normalizeCombatStartContract(value: unknown): CombatStartContract {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_COMBAT_START_CONTRACT;
  }

  const typedValue = value as Record<string, unknown>;
  const triggered = typedValue.triggered === true;
  const reason =
    typeof typedValue.reason === "string" ? typedValue.reason.trim().slice(0, 280) : "";
  const enemies = Array.isArray(typedValue.enemies)
    ? typedValue.enemies
        .map((entry) => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            return null;
          }

          const typedEntry = entry as Record<string, unknown>;
          const name =
            typeof typedEntry.name === "string" ? typedEntry.name.trim().slice(0, 120) : "";
          if (!name) {
            return null;
          }
          const summary =
            typeof typedEntry.summary === "string"
              ? typedEntry.summary.trim().slice(0, 280)
              : undefined;
          const hp =
            typeof typedEntry.hp === "string" ? typedEntry.hp.trim().slice(0, 32) : undefined;
          const abilities = Array.isArray(typedEntry.abilities)
            ? typedEntry.abilities
                .filter((ability): ability is string => typeof ability === "string")
                .map((ability) => ability.trim())
                .filter(Boolean)
                .slice(0, 12)
            : undefined;

          return {
            name,
            summary,
            hp,
            abilities,
          } satisfies CombatStartEnemySeed;
        })
        .filter((entry): entry is CombatStartEnemySeed => Boolean(entry))
        .slice(0, 20)
    : [];

  return {
    triggered,
    reason,
    enemies,
  };
}

export function formatCombatBoundaryForPrompt() {
  return [
    `Combat contract version: ${COMBAT_CONTRACT_VERSION}.`,
    `Combat control mode: ${DEFAULT_COMBAT_CONTROL_MODE}.`,
    "Phase 0 boundary: GM controls combat state for now, but must keep combat updates machine-readable and deterministic.",
    "When combat starts, include combatants with concise summaries, hp string if known, and notable abilities in roster/summary fields.",
    "Do not rely on prose-only combat state. The COMBAT block is canonical.",
  ].join(" ");
}
