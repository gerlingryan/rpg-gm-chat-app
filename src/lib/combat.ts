export type CombatRosterEntry = {
  id?: string;
  name: string;
  type: "character" | "enemy" | "npc";
  initiative: number;
  active: boolean;
  summary?: string;
  hp?: string;
  statusEffects?: string[];
  statusDurations?: CombatStatusDuration[];
};

export type CombatStatusDuration = {
  effect: string;
  remainingRounds: number;
  source?: string;
  kind?: "concentration" | "timed";
  breakOnDamage?: boolean;
};

export type CombatState = {
  combatActive: boolean;
  round: number;
  turnIndex: number;
  roster: CombatRosterEntry[];
};

export const DEFAULT_COMBAT_STATE: CombatState = {
  combatActive: false,
  round: 1,
  turnIndex: 0,
  roster: [],
};

function normalizeCombatRosterEntry(value: unknown): CombatRosterEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const typedValue = value as Record<string, unknown>;
  const name =
    typeof typedValue.name === "string" ? typedValue.name.trim() : "";

  if (!name) {
    return null;
  }

  const rawType =
    typeof typedValue.type === "string" ? typedValue.type.trim().toLowerCase() : "";
  const type: CombatRosterEntry["type"] =
    rawType === "enemy" || rawType === "npc" ? rawType : "character";

  const initiative =
    typeof typedValue.initiative === "number" && Number.isFinite(typedValue.initiative)
      ? typedValue.initiative
      : 0;
  const active = typedValue.active === true;
  const id =
    typeof typedValue.id === "string" && typedValue.id.trim()
      ? typedValue.id.trim()
      : undefined;
  const summary =
    typeof typedValue.summary === "string" && typedValue.summary.trim()
      ? typedValue.summary.trim()
      : undefined;
  const hp =
    typeof typedValue.hp === "string" && typedValue.hp.trim()
      ? typedValue.hp.trim()
      : undefined;
  const statusEffects = Array.isArray(typedValue.statusEffects)
    ? typedValue.statusEffects
        .filter(
          (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
        )
        .map((entry) => entry.trim())
    : [];
  const explicitDurations = Array.isArray(typedValue.statusDurations)
    ? typedValue.statusDurations
        .map((entry) => normalizeCombatStatusDuration(entry))
        .filter((entry): entry is CombatStatusDuration => Boolean(entry))
    : [];
  const inferredDurations = inferStatusDurationsFromStatusEffects(statusEffects);
  const statusDurations = mergeStatusDurations(explicitDurations, inferredDurations);
  const normalizedStatusEffects = normalizeStatusEffectsWithDurations(statusEffects, statusDurations);

  return {
    id,
    name,
    type,
    initiative,
    active,
    summary,
    hp,
    statusEffects: normalizedStatusEffects,
    statusDurations,
  };
}

function normalizeCombatStatusDuration(value: unknown): CombatStatusDuration | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const typedValue = value as Record<string, unknown>;
  const effect = typeof typedValue.effect === "string" ? typedValue.effect.trim() : "";
  if (!effect) {
    return null;
  }
  const remainingRoundsRaw =
    typeof typedValue.remainingRounds === "number" && Number.isFinite(typedValue.remainingRounds)
      ? typedValue.remainingRounds
      : Number.NaN;
  const remainingRounds = Number.isFinite(remainingRoundsRaw)
    ? Math.max(0, Math.trunc(remainingRoundsRaw))
    : 0;
  const source =
    typeof typedValue.source === "string" && typedValue.source.trim()
      ? typedValue.source.trim()
      : undefined;
  const kindRaw =
    typeof typedValue.kind === "string" ? typedValue.kind.trim().toLowerCase() : "";
  const kind: CombatStatusDuration["kind"] =
    kindRaw === "concentration" || kindRaw === "timed" ? kindRaw : undefined;
  const breakOnDamage = typedValue.breakOnDamage === true;

  return {
    effect,
    remainingRounds,
    source,
    kind,
    breakOnDamage,
  };
}

function normalizeDurationKey(effect: string, source?: string) {
  return `${effect.trim().toLowerCase()}::${(source ?? "").trim().toLowerCase()}`;
}

function mergeStatusDurations(
  primary: CombatStatusDuration[],
  secondary: CombatStatusDuration[],
) {
  const merged: CombatStatusDuration[] = [];
  const seen = new Set<string>();
  for (const duration of [...primary, ...secondary]) {
    const key = normalizeDurationKey(duration.effect, duration.source);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(duration);
  }
  return merged.filter((duration) => duration.remainingRounds > 0);
}

function inferStatusDurationsFromStatusEffects(statusEffects: string[]) {
  const durations: CombatStatusDuration[] = [];
  for (const effect of statusEffects) {
    const concentrationMatch = effect.match(/^Concentrating:\s*(.+?)\s*\((\d+)r\)$/i);
    if (concentrationMatch) {
      durations.push({
        effect: "Concentrating",
        source: concentrationMatch[1].trim(),
        remainingRounds: Math.max(0, Number(concentrationMatch[2])),
        kind: "concentration",
        breakOnDamage: true,
      });
      continue;
    }

    const genericDurationMatch = effect.match(/^(.+?)\s*\((\d+)r\)$/i);
    if (genericDurationMatch) {
      durations.push({
        effect: genericDurationMatch[1].trim(),
        remainingRounds: Math.max(0, Number(genericDurationMatch[2])),
        kind: "timed",
      });
    }
  }
  return durations.filter((entry) => entry.remainingRounds > 0);
}

function normalizeStatusEffectsWithDurations(
  statusEffects: string[],
  statusDurations: CombatStatusDuration[],
) {
  const normalized = statusEffects
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const concentrationMatch = entry.match(/^Concentrating:\s*(.+?)\s*\((\d+)r\)$/i);
      if (concentrationMatch) {
        return "Concentrating";
      }
      const genericDurationMatch = entry.match(/^(.+?)\s*\((\d+)r\)$/i);
      if (genericDurationMatch) {
        return genericDurationMatch[1].trim();
      }
      return entry;
    });

  const normalizedLower = new Set(normalized.map((entry) => entry.toLowerCase()));
  for (const duration of statusDurations) {
    const base = duration.effect.trim();
    if (!base) {
      continue;
    }
    if (!normalizedLower.has(base.toLowerCase())) {
      normalized.push(base);
      normalizedLower.add(base.toLowerCase());
    }
  }
  return normalized;
}

export function normalizeCombatState(value: unknown): CombatState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_COMBAT_STATE;
  }

  const typedValue = value as Record<string, unknown>;
  const roster = Array.isArray(typedValue.roster)
    ? typedValue.roster
        .map((entry) => normalizeCombatRosterEntry(entry))
        .filter((entry): entry is CombatRosterEntry => Boolean(entry))
    : [];
  const combatActive = typedValue.combatActive === true && roster.length > 0;
  const round =
    typeof typedValue.round === "number" && Number.isFinite(typedValue.round)
      ? Math.max(1, Math.floor(typedValue.round))
      : 1;
  let turnIndex =
    typeof typedValue.turnIndex === "number" && Number.isFinite(typedValue.turnIndex)
      ? Math.max(0, Math.floor(typedValue.turnIndex))
      : 0;

  if (!combatActive) {
    return DEFAULT_COMBAT_STATE;
  }

  const clampedTurnIndex = Math.min(turnIndex, Math.max(roster.length - 1, 0));
  const activeEntries = roster
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.active);
  const chosenActiveIndex =
    activeEntries.find(({ index }) => index === clampedTurnIndex)?.index ??
    activeEntries[0]?.index ??
    clampedTurnIndex;
  const normalizedRoster = roster.map((entry, index) => ({
    ...entry,
    active: index === chosenActiveIndex,
  }));
  turnIndex = chosenActiveIndex;

  return {
    combatActive,
    round,
    turnIndex,
    roster: normalizedRoster,
  };
}

export function formatCombatStateForPrompt(value: unknown) {
  const combatState = normalizeCombatState(value);

  if (!combatState.combatActive || combatState.roster.length === 0) {
    return "No active combat.";
  }

  return [
    `Combat active: yes`,
    `Round: ${combatState.round}`,
    `Turn index: ${combatState.turnIndex}`,
    "Roster:",
    ...combatState.roster.map(
      (entry, index) =>
        `${index + 1}. ${entry.name} [${entry.type}] init ${entry.initiative}${entry.active ? " (active)" : ""}${entry.hp ? ` hp ${entry.hp}` : ""}${entry.summary ? ` - ${entry.summary}` : ""}${
          Array.isArray(entry.statusDurations) && entry.statusDurations.length > 0
            ? ` | durations: ${entry.statusDurations
                .map((duration) => {
                  const sourcePart = duration.source ? `:${duration.source}` : "";
                  return `${duration.effect}${sourcePart}(${duration.remainingRounds}r)`;
                })
                .join(", ")}`
            : ""
        }`,
    ),
  ].join("\n");
}

export function extractCombatBlock(text: string) {
  const normalized = text.replace(/\r\n/g, "\n");
  const inlineMatch = normalized.match(
    /[*_`>\-\s]*COMBAT:\s*([\s\S]*?)\s*[*_`>\-\s]*ENDCOMBAT/i,
  );

  const extractInlineCombatJson = () => {
    const labelIndex = normalized.search(/[*_`>\-\s]*COMBAT:\s*/i);
    if (labelIndex < 0) {
      return null;
    }

    const afterLabel = normalized
      .slice(labelIndex)
      .replace(/^[*_`>\-\s]*COMBAT:\s*/i, "");
    const objectStart = afterLabel.indexOf("{");
    if (objectStart < 0) {
      return null;
    }

    let depth = 0;
    let inString = false;
    let escaped = false;
    let objectEnd = -1;

    for (let index = objectStart; index < afterLabel.length; index += 1) {
      const char = afterLabel[index];

      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }

        if (char === "\\") {
          escaped = true;
          continue;
        }

        if (char === "\"") {
          inString = false;
        }

        continue;
      }

      if (char === "\"") {
        inString = true;
        continue;
      }

      if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;

        if (depth === 0) {
          objectEnd = index;
          break;
        }
      }
    }

    if (objectEnd < 0) {
      return null;
    }

    const jsonText = afterLabel.slice(objectStart, objectEnd + 1).trim();
    const fullMatch = `${normalized.slice(labelIndex).match(/^[*_`>\-\s]*COMBAT:\s*/i)?.[0] ?? "COMBAT: "}${jsonText}`;

    return {
      jsonText,
      fullMatch,
    };
  };

  if (!inlineMatch) {
    const inlineJson = extractInlineCombatJson();

    if (!inlineJson) {
      return {
        found: false,
        update: {} as Partial<CombatState>,
        content: normalized.trim(),
      };
    }

    try {
      const parsed = JSON.parse(inlineJson.jsonText) as Partial<CombatState>;
      return {
        found: true,
        update:
          parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {},
        content: normalized.replace(inlineJson.fullMatch, "").trim(),
      };
    } catch {
      return {
        found: false,
        update: {} as Partial<CombatState>,
        content: normalized.replace(inlineJson.fullMatch, "").trim(),
      };
    }
  }

  try {
    const parsed = JSON.parse(inlineMatch[1]) as Partial<CombatState>;
    return {
      found: true,
      update:
        parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {},
      content: normalized.replace(inlineMatch[0], "").trim(),
    };
  } catch {
    return {
      found: false,
      update: {} as Partial<CombatState>,
      content: normalized.replace(inlineMatch[0], "").trim(),
    };
  }
}

export function formatCombatBlock(value: Partial<CombatState>) {
  return `COMBAT:\n${JSON.stringify(value)}\nENDCOMBAT`;
}

export function applyCombatUpdate(
  currentCombatState: unknown,
  update: Partial<CombatState>,
) {
  const normalizedCurrentState = normalizeCombatState(currentCombatState);

  if (!update || Object.keys(update).length === 0) {
    return normalizedCurrentState;
  }

  if (update.combatActive === false) {
    return DEFAULT_COMBAT_STATE;
  }

  return normalizeCombatState({
    ...normalizedCurrentState,
    ...update,
  });
}
