"use client";

import { type SceneSummary } from "@/lib/scene";
import { type DebugBootstrapState } from "@/hooks/useBootstrapDebugTools";

type DebugSnapshot = {
  scene: SceneSummary;
  stateUpdates: unknown;
  partyUpdate: unknown;
  combatUpdate: unknown;
} | null;

type CombatEngineLogEntry = {
  id: string;
  text: string;
};

type CombatTraceEntry = {
  id: string;
  timestamp: string;
  phase: string;
  payload: unknown;
};

type AdapterTelemetryLike = {
  ruleset?: string;
  profile?: string;
  kind?: string;
  actor?: string;
  target?: string;
  spellName?: string;
  encounterResolver?: {
    partySize?: number;
    averageLevel?: number;
    averageResourceRatio?: number;
    difficultyMode?: string;
    encounterIntent?: string;
    variance?: string;
    enemyCountExisting?: number;
    enemyCountTarget?: number;
    enemyCountAdded?: number;
    templatePoolSize?: number;
  };
  encounterStart?: {
    inputEnemyCount?: number;
    resolvedEnemyCount?: number;
    enemyAssignments?: Array<{
      name?: string;
      hpBefore?: string | null;
      hpAfter?: string | null;
      hpAssignedByResolver?: boolean;
    }>;
  };
  defaultProfileContext?: {
    actorType?: string;
    targetType?: string;
    actorLevel?: number;
    targetLevel?: number;
  };
  defaults?: {
    attackBonus?: number;
    targetAc?: number;
    damageDie?: number;
    damageBonus?: number;
  };
  applied?: {
    attackBonus?: number;
    targetAc?: number;
    damageDie?: number;
    damageDiceCount?: number;
    damageBonus?: number;
  };
};

function extractLatestAdapterDebug(entries: CombatTraceEntry[]) {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const payload = entries[index]?.payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      continue;
    }
    const typed = payload as Record<string, unknown>;
    if ("adapterDebug" in typed && typed.adapterDebug) {
      return typed.adapterDebug;
    }
  }
  return null;
}

function extractAdapterTelemetryHistory(entries: CombatTraceEntry[]) {
  const history: Array<{ timestamp: string; adapterDebug: AdapterTelemetryLike }> = [];

  for (const entry of entries) {
    const payload = entry?.payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      continue;
    }
    const typed = payload as Record<string, unknown>;
    const adapterDebug = typed.adapterDebug;
    if (!adapterDebug || typeof adapterDebug !== "object" || Array.isArray(adapterDebug)) {
      continue;
    }
    history.push({
      timestamp: entry.timestamp,
      adapterDebug: adapterDebug as AdapterTelemetryLike,
    });
  }

  return history.slice(-10);
}

function renderAdapterSummary(adapterDebug: AdapterTelemetryLike | null) {
  if (!adapterDebug) {
    return "No adapter telemetry summary yet.";
  }

  const lines: string[] = [];
  const ruleText = `${adapterDebug.ruleset ?? "unknown ruleset"} / ${adapterDebug.profile ?? "unknown profile"}`;
  lines.push(`Ruleset/Profile: ${ruleText}`);

  if (adapterDebug.encounterResolver) {
    const resolver = adapterDebug.encounterResolver;
    lines.push(
      `Encounter: party=${resolver.partySize ?? "?"}, avgLevel=${resolver.averageLevel ?? "?"}, avgResources=${resolver.averageResourceRatio ?? "?"}`,
    );
    lines.push(
      `Enemy Count: existing=${resolver.enemyCountExisting ?? "?"}, target=${resolver.enemyCountTarget ?? "?"}, added=${resolver.enemyCountAdded ?? "?"}`,
    );
    lines.push(
      `Mode: ${resolver.difficultyMode ?? "?"}/${resolver.variance ?? "?"}/${resolver.encounterIntent ?? "?"}, templatePool=${resolver.templatePoolSize ?? "?"}`,
    );
  }

  if (adapterDebug.encounterStart?.enemyAssignments?.length) {
    const assignmentText = adapterDebug.encounterStart.enemyAssignments
      .map((entry) => {
        const name = entry.name ?? "Enemy";
        const hpAfter = entry.hpAfter ?? "?";
        const source = entry.hpAssignedByResolver ? "resolver" : "seed";
        return `${name}: ${hpAfter} (${source})`;
      })
      .join(" | ");
    lines.push(`Enemy HP: ${assignmentText}`);
  }

  if (adapterDebug.defaultProfileContext) {
    const context = adapterDebug.defaultProfileContext;
    lines.push(
      `Action Context: kind=${adapterDebug.kind ?? "?"}, actorType=${context.actorType ?? "?"}, targetType=${context.targetType ?? "?"}, actorLevel=${context.actorLevel ?? "?"}, targetLevel=${context.targetLevel ?? "?"}`,
    );
  }

  if (adapterDebug.defaults || adapterDebug.applied) {
    const defaults = adapterDebug.defaults;
    const applied = adapterDebug.applied;
    lines.push(
      `Defaults: atk+${defaults?.attackBonus ?? "?"}, AC ${defaults?.targetAc ?? "?"}, dmg d${defaults?.damageDie ?? "?"}${typeof defaults?.damageBonus === "number" ? `+${defaults.damageBonus}` : ""}`,
    );
    lines.push(
      `Applied: atk+${applied?.attackBonus ?? "?"}, AC ${applied?.targetAc ?? "?"}, dmg ${applied?.damageDiceCount ?? 1}d${applied?.damageDie ?? "?"}${typeof applied?.damageBonus === "number" ? `+${applied.damageBonus}` : ""}`,
    );
  }

  return lines.join("\n");
}

function getEncounterRiskBadge(adapterDebug: AdapterTelemetryLike | null) {
  if (!adapterDebug) {
    return {
      label: "Unknown",
      score: 0,
      badgeClass: "border-zinc-700 bg-zinc-900 text-zinc-300",
      detail: "No telemetry yet.",
    };
  }

  const resolver = adapterDebug.encounterResolver;
  const context = adapterDebug.defaultProfileContext;
  const defaults = adapterDebug.defaults;
  let score = 0;

  if (resolver) {
    const partySize = resolver.partySize ?? 0;
    const enemyTarget = resolver.enemyCountTarget ?? 0;
    const avgResources = resolver.averageResourceRatio ?? 1;
    const avgLevel = resolver.averageLevel ?? 1;

    if (partySize > 0 && enemyTarget >= partySize + 1) {
      score += 2;
    } else if (partySize > 0 && enemyTarget >= partySize) {
      score += 1;
    }
    if (avgResources <= 0.55) {
      score += 2;
    } else if (avgResources <= 0.75) {
      score += 1;
    }
    if (avgLevel <= 2 && enemyTarget >= partySize && partySize > 0) {
      score += 1;
    }
  }

  if (context && defaults && context.actorType === "enemy") {
    if ((defaults.attackBonus ?? 0) >= 4) {
      score += 1;
    }
    if ((defaults.damageDie ?? 0) >= 8) {
      score += 1;
    }
    if ((defaults.damageBonus ?? 0) >= 2) {
      score += 1;
    }
  }

  if (score >= 5) {
    return {
      label: "Hard",
      score,
      badgeClass: "border-rose-700 bg-rose-950/60 text-rose-200",
      detail: "Likely punishing without strong tactics or luck.",
    };
  }
  if (score >= 3) {
    return {
      label: "Fair",
      score,
      badgeClass: "border-amber-700 bg-amber-950/60 text-amber-200",
      detail: "Moderate pressure; expect resource drain.",
    };
  }
  return {
    label: "Easy",
    score,
    badgeClass: "border-emerald-700 bg-emerald-950/60 text-emerald-200",
    detail: "Low immediate pressure based on current telemetry.",
  };
}

function DebugPanel({
  title,
  content,
}: {
  title: string;
  content: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
        {title}
      </div>
      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-zinc-200">
        {content}
      </pre>
    </div>
  );
}

function formatTimestamp(value: string) {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return "Unknown time";
  }

  return parsed.toLocaleString();
}

function extractNoProgressStreak(debugBootstrapState: DebugBootstrapState) {
  if (!debugBootstrapState) {
    return 0;
  }
  const marker = debugBootstrapState.hiddenView.gm_notes.offscreen_pressure.find((entry) =>
    entry.startsWith("META:no_progress_streak="),
  );
  if (!marker) {
    return 0;
  }
  const parsed = Number.parseInt(marker.split("=")[1] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

type EncounterPresetRecommendation = {
  label: string;
  difficultyMode: "cinematic" | "standard" | "deadly";
  encounterVariance: "low" | "medium" | "high";
  encounterIntent: "easy" | "standard" | "hard";
};

function getRulesetPresetRecommendations(ruleset: string): EncounterPresetRecommendation[] {
  const normalized = ruleset.trim().toLowerCase();

  if (normalized.includes("deadlands")) {
    return [
      {
        label: "Lv 1-2: standard / low",
        difficultyMode: "standard",
        encounterVariance: "low",
        encounterIntent: "easy",
      },
      {
        label: "Lv 3-5: standard / medium",
        difficultyMode: "standard",
        encounterVariance: "medium",
        encounterIntent: "standard",
      },
      {
        label: "Lv 6+: deadly / medium",
        difficultyMode: "deadly",
        encounterVariance: "medium",
        encounterIntent: "hard",
      },
    ];
  }

  if (normalized.includes("savage rifts") || normalized.includes("rifts")) {
    return [
      {
        label: "Lv 1-2: cinematic / low",
        difficultyMode: "cinematic",
        encounterVariance: "low",
        encounterIntent: "easy",
      },
      {
        label: "Lv 3-5: standard / low",
        difficultyMode: "standard",
        encounterVariance: "low",
        encounterIntent: "standard",
      },
      {
        label: "Lv 6+: standard / medium",
        difficultyMode: "standard",
        encounterVariance: "medium",
        encounterIntent: "hard",
      },
    ];
  }

  if (normalized.includes("d&d") || normalized.includes("dnd")) {
    return [
      {
        label: "Lv 1-2: standard / medium",
        difficultyMode: "standard",
        encounterVariance: "medium",
        encounterIntent: "easy",
      },
      {
        label: "Lv 3-5: standard / medium",
        difficultyMode: "standard",
        encounterVariance: "medium",
        encounterIntent: "standard",
      },
      {
        label: "Lv 6+: deadly / medium",
        difficultyMode: "deadly",
        encounterVariance: "medium",
        encounterIntent: "hard",
      },
    ];
  }

  return [
    {
      label: "Low level: standard / low",
      difficultyMode: "standard",
      encounterVariance: "low",
      encounterIntent: "easy",
    },
    {
      label: "Mid level: standard / medium",
      difficultyMode: "standard",
      encounterVariance: "medium",
      encounterIntent: "standard",
    },
    {
      label: "High level: deadly / medium",
      difficultyMode: "deadly",
      encounterVariance: "medium",
      encounterIntent: "hard",
    },
  ];
}

export function DebugInspectorModal(props: {
  isOpen: boolean;
  debugEnabled: boolean;
  onClose: () => void;
  debugSnapshot: DebugSnapshot;
  combatEngineLogEntries: CombatEngineLogEntry[];
  combatTraceEntries: CombatTraceEntry[];
  debugBootstrapState: DebugBootstrapState;
  isLoadingDebugBootstrapState: boolean;
  isApplyingDebugBootstrapAction: boolean;
  onRefreshBootstrap: () => void;
  onAdvanceClock: (clockId: string) => void;
  onRevealQuest: (questId: string) => void;
  onRevealClue: (clueId: string) => void;
  onSetCombatGeneration: (params: {
    difficultyMode?: "cinematic" | "standard" | "deadly";
    encounterVariance?: "low" | "medium" | "high";
    encounterIntent?: "easy" | "standard" | "hard";
  }) => void;
}) {
  const {
    isOpen,
    debugEnabled,
    onClose,
    debugSnapshot,
    combatEngineLogEntries,
    combatTraceEntries,
    debugBootstrapState,
    isLoadingDebugBootstrapState,
    isApplyingDebugBootstrapAction,
    onRefreshBootstrap,
    onAdvanceClock,
    onRevealQuest,
    onRevealClue,
    onSetCombatGeneration,
  } = props;

  if (!isOpen || !debugEnabled) {
    return null;
  }

  const latestAdapterDebug = extractLatestAdapterDebug(combatTraceEntries) as AdapterTelemetryLike | null;
  const encounterRisk = getEncounterRiskBadge(latestAdapterDebug);
  const encounterRiskHistory = extractAdapterTelemetryHistory(combatTraceEntries).map((entry) => {
    const risk = getEncounterRiskBadge(entry.adapterDebug);
    return {
      timestamp: entry.timestamp,
      label: risk.label,
      score: risk.score,
      kind: entry.adapterDebug.kind ?? (entry.adapterDebug.encounterResolver ? "start" : "unknown"),
    };
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 bg-zinc-900 pb-2">
          <div>
            <div className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-200">
              Debug Inspector
            </div>
            <p className="mt-1 text-xs text-zinc-400">
              Session-only view of the last parsed structured GM blocks.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm font-medium text-zinc-200"
          >
            Close
          </button>
        </div>
        <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
          {debugSnapshot ? (
            <div className="grid gap-4 md:grid-cols-2">
              <DebugPanel
                title="SCENE"
                content={JSON.stringify(debugSnapshot.scene, null, 2)}
              />
              <DebugPanel
                title="COMBAT"
                content={JSON.stringify(debugSnapshot.combatUpdate, null, 2)}
              />
              <DebugPanel
                title="STATE"
                content={JSON.stringify(debugSnapshot.stateUpdates, null, 2)}
              />
              <DebugPanel
                title="PARTY"
                content={JSON.stringify(debugSnapshot.partyUpdate, null, 2)}
              />
              <DebugPanel
                title="ENGINE LOG"
                content={
                  combatEngineLogEntries.length > 0
                    ? combatEngineLogEntries.map((entry) => entry.text).join("\n")
                    : "No engine log entries yet."
                }
              />
              <DebugPanel
                title="ENGINE TRACE"
                content={
                  combatTraceEntries.length > 0
                    ? JSON.stringify(combatTraceEntries, null, 2)
                    : "No engine trace entries yet."
                }
              />
              <DebugPanel
                title="ENCOUNTER BALANCE SUMMARY"
                content={renderAdapterSummary(latestAdapterDebug)}
              />
              <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                  Encounter Risk
                </div>
                <div className="mt-1 text-[11px] text-zinc-500">
                  Score factors: enemy count vs party size, party resource ratio, low-level pressure,
                  and enemy default offense. Ranges: Easy 0-2, Fair 3-4, Hard 5+.
                </div>
                <div
                  className={`mt-2 inline-flex items-center rounded-md border px-2 py-1 text-xs font-semibold ${encounterRisk.badgeClass}`}
                >
                  {encounterRisk.label} (score {encounterRisk.score})
                </div>
                <div className="mt-2 text-xs text-zinc-300">{encounterRisk.detail}</div>
              </div>
              <DebugPanel
                title="ADAPTER TELEMETRY"
                content={
                  latestAdapterDebug
                    ? JSON.stringify(latestAdapterDebug, null, 2)
                    : "No adapter telemetry yet."
                }
              />
              <DebugPanel
                title="ENCOUNTER RISK HISTORY"
                content={
                  encounterRiskHistory.length > 0
                    ? encounterRiskHistory
                        .map(
                          (entry) =>
                            `${formatTimestamp(entry.timestamp)} | ${entry.kind} | ${entry.label} (score ${entry.score})`,
                        )
                        .join("\n")
                    : "No risk history yet."
                }
              />
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-400">
                No debug snapshot yet. Send a GM turn while Debug On is enabled.
              </div>
              <DebugPanel
                title="ENGINE LOG"
                content={
                  combatEngineLogEntries.length > 0
                    ? combatEngineLogEntries.map((entry) => entry.text).join("\n")
                    : "No engine log entries yet."
                }
              />
              <DebugPanel
                title="ENGINE TRACE"
                content={
                  combatTraceEntries.length > 0
                    ? JSON.stringify(combatTraceEntries, null, 2)
                    : "No engine trace entries yet."
                }
              />
              <DebugPanel
                title="ENCOUNTER BALANCE SUMMARY"
                content={renderAdapterSummary(latestAdapterDebug)}
              />
              <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                  Encounter Risk
                </div>
                <div className="mt-1 text-[11px] text-zinc-500">
                  Score factors: enemy count vs party size, party resource ratio, low-level pressure,
                  and enemy default offense. Ranges: Easy 0-2, Fair 3-4, Hard 5+.
                </div>
                <div
                  className={`mt-2 inline-flex items-center rounded-md border px-2 py-1 text-xs font-semibold ${encounterRisk.badgeClass}`}
                >
                  {encounterRisk.label} (score {encounterRisk.score})
                </div>
                <div className="mt-2 text-xs text-zinc-300">{encounterRisk.detail}</div>
              </div>
              <DebugPanel
                title="ADAPTER TELEMETRY"
                content={
                  latestAdapterDebug
                    ? JSON.stringify(latestAdapterDebug, null, 2)
                    : "No adapter telemetry yet."
                }
              />
              <DebugPanel
                title="ENCOUNTER RISK HISTORY"
                content={
                  encounterRiskHistory.length > 0
                    ? encounterRiskHistory
                        .map(
                          (entry) =>
                            `${formatTimestamp(entry.timestamp)} | ${entry.kind} | ${entry.label} (score ${entry.score})`,
                        )
                        .join("\n")
                    : "No risk history yet."
                }
              />
            </div>
          )}
          <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400">
                Bootstrap QA Controls
              </div>
              <button
                type="button"
                onClick={onRefreshBootstrap}
                disabled={isLoadingDebugBootstrapState || isApplyingDebugBootstrapAction}
                className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isLoadingDebugBootstrapState ? "Refreshing..." : "Refresh"}
              </button>
            </div>
            {debugBootstrapState ? (
              <div className="mt-3 space-y-3">
                <DebugPanel
                  title="BOOTSTRAP HIDDEN"
                  content={JSON.stringify(debugBootstrapState.hiddenView, null, 2)}
                />
                <div className="text-[11px] text-zinc-500">
                  Updated: {formatTimestamp(debugBootstrapState.updatedAt ?? "")}
                </div>
                <div className="text-[11px] text-zinc-500">
                  No-progress streak: {extractNoProgressStreak(debugBootstrapState)}
                </div>
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                    Combat Generation Presets
                  </div>
                  <div className="text-[11px] text-zinc-400">
                    Current: {debugBootstrapState.hiddenView.combat_generation.difficultyMode}/
                    {debugBootstrapState.hiddenView.combat_generation.encounterVariance}/
                    {debugBootstrapState.hiddenView.combat_generation.encounterIntent}
                  </div>
                  <div className="grid gap-1.5 sm:grid-cols-3">
                    {(["cinematic", "standard", "deadly"] as const).map((mode) => (
                      <button
                        key={`difficulty-${mode}`}
                        type="button"
                        onClick={() => onSetCombatGeneration({ difficultyMode: mode })}
                        disabled={isApplyingDebugBootstrapAction}
                        className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-left text-[11px] text-zinc-200 transition hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Difficulty: {mode}
                      </button>
                    ))}
                  </div>
                  <div className="grid gap-1.5 sm:grid-cols-3">
                    {(["low", "medium", "high"] as const).map((variance) => (
                      <button
                        key={`variance-${variance}`}
                        type="button"
                        onClick={() => onSetCombatGeneration({ encounterVariance: variance })}
                        disabled={isApplyingDebugBootstrapAction}
                        className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-left text-[11px] text-zinc-200 transition hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Variance: {variance}
                      </button>
                    ))}
                  </div>
                  <div className="grid gap-1.5 sm:grid-cols-3">
                    {(["easy", "standard", "hard"] as const).map((intent) => (
                      <button
                        key={`intent-${intent}`}
                        type="button"
                        onClick={() => onSetCombatGeneration({ encounterIntent: intent })}
                        disabled={isApplyingDebugBootstrapAction}
                        className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-left text-[11px] text-zinc-200 transition hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Intent: {intent}
                      </button>
                    ))}
                  </div>
                  <div className="rounded-md border border-zinc-800 bg-zinc-900/50 p-2">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                      Recommended By Level
                    </div>
                    <div className="mt-1 space-y-0.5 text-[11px] text-zinc-300">
                      {getRulesetPresetRecommendations(
                        debugBootstrapState.hiddenView.campaign.ruleset,
                      ).map((preset) => (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() =>
                            onSetCombatGeneration({
                              difficultyMode: preset.difficultyMode,
                              encounterVariance: preset.encounterVariance,
                              encounterIntent: preset.encounterIntent,
                            })
                          }
                          disabled={isApplyingDebugBootstrapAction}
                          className="block w-full rounded px-1.5 py-1 text-left transition hover:bg-zinc-800/70 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                    Clocks
                  </div>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {debugBootstrapState.hiddenView.clocks.map((clock) => (
                      <button
                        key={clock.id}
                        type="button"
                        onClick={() => onAdvanceClock(clock.id)}
                        disabled={isApplyingDebugBootstrapAction}
                        className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-left text-[11px] text-zinc-200 transition hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        +1 {clock.name} ({clock.current}/{clock.max})
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                    Reveal Quest
                  </div>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {debugBootstrapState.hiddenView.quests.map((quest) => (
                      <button
                        key={quest.id}
                        type="button"
                        onClick={() => onRevealQuest(quest.id)}
                        disabled={isApplyingDebugBootstrapAction}
                        className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-left text-[11px] text-zinc-200 transition hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {quest.id}: {quest.title}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                    Reveal Clue
                  </div>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {debugBootstrapState.hiddenView.clues.map((clue) => (
                      <button
                        key={clue.id}
                        type="button"
                        onClick={() => onRevealClue(clue.id)}
                        disabled={isApplyingDebugBootstrapAction}
                        className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-left text-[11px] text-zinc-200 transition hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {clue.id}: {clue.text}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-3 text-[11px] text-zinc-500">
                {isLoadingDebugBootstrapState
                  ? "Loading bootstrap state..."
                  : "No debug bootstrap state loaded yet."}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
