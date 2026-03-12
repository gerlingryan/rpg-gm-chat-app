import { type SceneSummary } from "@/lib/scene";
import { type CampaignBootstrap } from "@/lib/campaign-bootstrap";
import { type CampaignBootstrapTurnUpdate } from "@/lib/campaign-bootstrap-reducer";

export const BOOTSTRAP_META_STREAK_PREFIX = "META:no_progress_streak=";

export function hasMeaningfulBootstrapProgress(update: CampaignBootstrapTurnUpdate) {
  return Boolean(
    (Array.isArray(update.clocks_advanced) && update.clocks_advanced.length > 0) ||
      (Array.isArray(update.quest_updates) && update.quest_updates.length > 0) ||
      (Array.isArray(update.clues_revealed) && update.clues_revealed.length > 0) ||
      (update.new_clue && typeof update.new_clue.text === "string" && update.new_clue.text.trim()),
  );
}

export function readBootstrapNoProgressStreak(bootstrap: CampaignBootstrap) {
  const marker = bootstrap.gm_notes.offscreen_pressure.find((entry) =>
    entry.startsWith(BOOTSTRAP_META_STREAK_PREFIX),
  );
  if (!marker) {
    return 0;
  }
  const parsed = Number.parseInt(
    marker.slice(BOOTSTRAP_META_STREAK_PREFIX.length).trim(),
    10,
  );
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

export function withBootstrapNoProgressStreak(bootstrap: CampaignBootstrap, streak: number) {
  const sanitizedStreak = Math.max(0, Math.min(10, Math.trunc(streak)));
  const nextOffscreenPressure = bootstrap.gm_notes.offscreen_pressure.filter(
    (entry) => !entry.startsWith(BOOTSTRAP_META_STREAK_PREFIX),
  );

  return {
    ...bootstrap,
    gm_notes: {
      ...bootstrap.gm_notes,
      offscreen_pressure:
        sanitizedStreak > 0
          ? [...nextOffscreenPressure, `${BOOTSTRAP_META_STREAK_PREFIX}${sanitizedStreak}`]
          : nextOffscreenPressure,
    },
  } satisfies CampaignBootstrap;
}

export function buildLoopBreakerBootstrapUpdate(
  bootstrap: CampaignBootstrap,
  scene: SceneSummary,
): CampaignBootstrapTurnUpdate {
  const firstAdvanceableClock = bootstrap.clocks.find((clock) => clock.current < clock.max);
  if (firstAdvanceableClock) {
    return {
      scene_title: scene.sceneTitle || undefined,
      objective: scene.goal || undefined,
      clocks_advanced: [{ id: firstAdvanceableClock.id, delta: 1 }],
      loop_breaker_reason:
        "Auto-escalation after consecutive low-progression turns.",
    };
  }

  const primaryQuest =
    bootstrap.quests.find((quest) => quest.status === "active") ?? bootstrap.quests[0];
  if (primaryQuest) {
    return {
      scene_title: scene.sceneTitle || undefined,
      objective: scene.goal || undefined,
      quest_updates: [
        {
          id: primaryQuest.id,
          addStep: "Time pressure increased; choose a committed next move immediately.",
        },
      ],
      loop_breaker_reason:
        "Auto-escalation added urgency to prevent repeated planning loops.",
    };
  }

  return {
    scene_title: scene.sceneTitle || undefined,
    objective: scene.goal || undefined,
    loop_breaker_reason:
      "Auto-escalation flagged due to repeated no-change turns.",
  };
}

export function resolveBootstrapTurnPolicy(params: {
  currentBootstrap: CampaignBootstrap;
  incomingUpdate: CampaignBootstrapTurnUpdate;
  effectiveScene: SceneSummary;
  gmQueryMode: boolean;
}) {
  const { currentBootstrap, incomingUpdate, effectiveScene, gmQueryMode } = params;
  const priorNoProgressStreak = readBootstrapNoProgressStreak(currentBootstrap);
  const incomingHasProgress = hasMeaningfulBootstrapProgress(incomingUpdate);
  const shouldAutoLoopBreak =
    !gmQueryMode &&
    !incomingHasProgress &&
    priorNoProgressStreak >= 1;
  const effectiveUpdate: CampaignBootstrapTurnUpdate = shouldAutoLoopBreak
    ? {
        ...incomingUpdate,
        ...buildLoopBreakerBootstrapUpdate(currentBootstrap, effectiveScene),
      }
    : incomingUpdate;
  const turnHasProgress = hasMeaningfulBootstrapProgress(effectiveUpdate);
  const nextNoProgressStreak = gmQueryMode
    ? priorNoProgressStreak
    : turnHasProgress
      ? 0
      : Math.min(10, priorNoProgressStreak + 1);

  return {
    effectiveUpdate,
    priorNoProgressStreak,
    nextNoProgressStreak,
    loopBreakerApplied: shouldAutoLoopBreak,
  };
}
