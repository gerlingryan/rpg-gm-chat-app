import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { CombatRosterEntry, CombatState } from "@/lib/combat";

type CampaignCharacter = {
  id: string;
  name: string;
  isMainCharacter: boolean;
  sheetJson: Record<string, unknown> | null;
};

type ChatMessage = {
  speakerName: string;
  role: string;
  content: string;
  isEnemyNarration?: boolean;
};

type CombatActionKind =
  | "attack"
  | "cast-spell"
  | "help"
  | "disengage"
  | "dash"
  | "defend"
  | "take-cover"
  | "aim"
  | "surrender"
  | "attempt-escape"
  | "pass";

type PendingReactionState = {
  actorRef: string;
  targetRef: string;
  kind: CombatActionKind;
  seedInput: string;
  targetName: string;
  selectedAttackPresetId: string;
  spellSlot?: string;
  spellName?: string;
  detail?: string;
};

type CombatEngineLogEntry = {
  id: string;
  text: string;
};

type AutoAction = {
  kind: CombatActionKind;
  attackPresetId?: string;
  attackRangeMode?: "melee" | "ranged";
  moveDestination?: { x: number; y: number };
  attackBonus?: number;
  damageDie?: number;
  damageBonus?: number;
  spellName?: string;
  spellSlot?: string;
};

type AutoEnemyPlan = AutoAction & {
  targetRef?: string;
  autoEnemyTelemetry?: unknown;
};

export function useCombatAutoTurns(params: {
  campaignId: string;
  engineCombatModeEnabled: boolean;
  autoCompanionCombatEnabled: boolean;
  debugStateLoggingEnabled: boolean;
  mainCharacter: { id: string; name: string } | null;
  combatMapBlockedSet: Set<string>;
  characterMapById: Map<string, CampaignCharacter>;
  characterMapByName: Map<string, CampaignCharacter>;
  normalizeCharacterLookupName: (value: string) => string;
  isMainCharacterCombatTurn: (state: CombatState) => boolean;
  isMainCharacterCombatEntry: (entry: CombatRosterEntry) => boolean;
  buildAutoEnemyTurnPlan: (input: {
    state: CombatState;
    actor: CombatRosterEntry;
    actorCharacter: CampaignCharacter | null;
  }) => AutoEnemyPlan | null;
  chooseAutoCombatTarget: (state: CombatState, actor: CombatRosterEntry) => CombatRosterEntry | null;
  chooseAutoEngineActionForCombatant: (input: {
    actorEntry: CombatRosterEntry;
    actorCharacter: CampaignCharacter | null;
    targetEntry: CombatRosterEntry | null;
    ruleset: string;
  }) => AutoAction | null;
  findCombatTargetFromRef: (targetRef: string, combatState: CombatState) => CombatRosterEntry | null;
  mergeCampaignCharacters: (
    current: CampaignCharacter[],
    incoming: unknown,
  ) => CampaignCharacter[];
  resolveEngineActionSpeaker: (
    actorRef: string | undefined,
    fallbackName?: string,
  ) => Pick<ChatMessage, "speakerName" | "role" | "isEnemyNarration">;
  buildCombatEngineResolutionNarration: (resolution: Record<string, unknown>) => string;
  getReactionRefreshLogLine: (previousState: CombatState, nextState: CombatState) => string | null;
  appendCombatTrace: (phase: string, payload: unknown) => void;
  queueCombatCheckpointPersist: (params: {
    combatState: CombatState;
    characters: CampaignCharacter[];
    reason: string;
  }) => void;
  setIsAutoResolvingCombat: Dispatch<SetStateAction<boolean>>;
  setPendingReaction: Dispatch<SetStateAction<PendingReactionState | null>>;
  setCombatEngineLogEntries: Dispatch<SetStateAction<CombatEngineLogEntry[]>>;
  setCampaign: Dispatch<
    SetStateAction<{
      combatStateJson: CombatState;
      characters: CampaignCharacter[];
    } | null>
  >;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setLastCombatResolution: Dispatch<
    SetStateAction<{
      narration: string;
      resolution: Record<string, unknown>;
      phase: "player" | "auto" | "reaction";
      createdAt: string;
    } | null>
  >;
}) {
  const runEngineAutoTurns = useCallback(
    async (
      startState: CombatState,
      runtime: { ruleset: string; characters: CampaignCharacter[] },
    ) => {
      if (
        !params.campaignId ||
        !params.engineCombatModeEnabled ||
        !startState.combatActive ||
        !params.mainCharacter
      ) {
        return startState;
      }

      params.setIsAutoResolvingCombat(true);
      let workingState = startState;
      let workingCharacters = runtime.characters;
      let safetyCounter = 0;

      try {
        while (
          workingState.combatActive &&
          workingState.roster.length > 0 &&
          !params.isMainCharacterCombatTurn(workingState) &&
          safetyCounter < 24
        ) {
          const activeEntry =
            workingState.roster.find((entry) => entry.active) ??
            workingState.roster[workingState.turnIndex] ??
            null;
          if (!activeEntry) {
            break;
          }
          if (
            activeEntry.type === "character" &&
            !params.isMainCharacterCombatEntry(activeEntry) &&
            !params.autoCompanionCombatEnabled
          ) {
            break;
          }

          const actorCharacter =
            (activeEntry.id ? params.characterMapById.get(activeEntry.id) : null) ??
            params.characterMapByName.get(
              params.normalizeCharacterLookupName(activeEntry.name),
            ) ??
            null;
          const enemyPlan =
            activeEntry.type === "enemy"
              ? params.buildAutoEnemyTurnPlan({
                  state: workingState,
                  actor: activeEntry,
                  actorCharacter,
                })
              : null;
          const targetEntry = enemyPlan?.targetRef
            ? params.findCombatTargetFromRef(enemyPlan.targetRef, workingState)
            : params.chooseAutoCombatTarget(workingState, activeEntry);
          const autoAction =
            enemyPlan ??
            params.chooseAutoEngineActionForCombatant({
              actorEntry: activeEntry,
              actorCharacter,
              targetEntry,
              ruleset: runtime.ruleset,
            });
          if (!autoAction) {
            break;
          }
          if (enemyPlan?.autoEnemyTelemetry) {
            params.appendCombatTrace("auto-enemy-plan", {
              autoEnemyPlan: enemyPlan.autoEnemyTelemetry,
            });
          }
          params.setCombatEngineLogEntries((current) => [
            ...current,
            {
              id: crypto.randomUUID(),
              text: `[Auto] ${activeEntry.name} ${
                autoAction.kind === "attack"
                  ? "is attacking..."
                  : autoAction.kind === "dash"
                    ? "is dashing..."
                    : autoAction.kind === "cast-spell"
                      ? "is casting..."
                      : "is acting..."
              }`,
            },
          ]);

          const actionSeedInput = crypto.randomUUID();
          const basePayload = {
            action: "submit",
            localFastMode: true,
            runtime: {
              ruleset: runtime.ruleset,
              combatStateJson: workingState,
              characters: workingCharacters,
            },
            kind: autoAction.kind,
            actor: activeEntry.id ?? activeEntry.name,
            target:
              autoAction.kind === "attack" || autoAction.kind === "cast-spell"
                ? targetEntry?.id ?? targetEntry?.name
                : undefined,
            moveToX: autoAction.moveDestination?.x,
            moveToY: autoAction.moveDestination?.y,
            attackRangeMode: autoAction.attackRangeMode,
            attackBonus: autoAction.attackBonus,
            damageDie: autoAction.damageDie,
            damageBonus: autoAction.damageBonus,
            spellName: autoAction.spellName,
            spellSlot: autoAction.spellSlot,
            blockedTileKeys: Array.from(params.combatMapBlockedSet),
            seedInput: actionSeedInput,
          };
          const response = await fetch(`/api/campaigns/${params.campaignId}/combat`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Debug-State-Logging": params.debugStateLoggingEnabled ? "true" : "false",
            },
            body: JSON.stringify(basePayload),
          });
          let data = await response.json();
          if (response.ok && data?.requiresReaction && data?.reactionPrompt) {
            const prompt = data.reactionPrompt as {
              targetRef?: string;
              targetName?: string;
              detail?: string;
            };
            const isMainReactionTarget =
              Boolean(params.mainCharacter) &&
              (String(prompt.targetRef ?? "").trim() === params.mainCharacter?.id ||
                params.normalizeCharacterLookupName(String(prompt.targetName ?? "")) ===
                  params.normalizeCharacterLookupName(params.mainCharacter?.name ?? ""));
            if (isMainReactionTarget) {
              params.appendCombatTrace("auto-reaction-required", {
                adapterDebug: "adapterDebug" in data ? data.adapterDebug : null,
                reactionPrompt: data.reactionPrompt,
                previewResolution: data.previewResolution ?? null,
              });
              params.setPendingReaction({
                actorRef: String(basePayload.actor ?? ""),
                targetRef: String(prompt.targetRef ?? basePayload.target ?? ""),
                kind: basePayload.kind as CombatActionKind,
                seedInput: actionSeedInput,
                targetName: String(prompt.targetName ?? "Target"),
                selectedAttackPresetId: autoAction.attackPresetId ?? "basic",
                spellSlot: autoAction.spellSlot,
                spellName: autoAction.spellName,
                detail: typeof prompt.detail === "string" ? prompt.detail : undefined,
              });
              params.setCombatEngineLogEntries((current) => [
                ...current,
                {
                  id: crypto.randomUUID(),
                  text: `Reaction available: ${String(
                    prompt.targetName ?? "Target",
                  )} can use Shield.`,
                },
              ]);
              break;
            }

            const reactionResponse = await fetch(`/api/campaigns/${params.campaignId}/combat`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Debug-State-Logging": params.debugStateLoggingEnabled ? "true" : "false",
              },
              body: JSON.stringify({
                ...basePayload,
                reactionDecision: "decline",
              }),
            });
            data = await reactionResponse.json();
            if (reactionResponse.ok) {
              params.appendCombatTrace("auto-reaction-decline", {
                adapterDebug: "adapterDebug" in data ? data.adapterDebug : null,
                resolution: data.resolution ?? null,
              });
            }
            if (!reactionResponse.ok || !data.combatStateJson || !data.resolution) {
              throw new Error(data.error ?? "Unable to auto-resolve reaction turn.");
            }
          }

          if (!response.ok || !data.combatStateJson || !data.resolution) {
            throw new Error(data.error ?? "Unable to auto-resolve combat turn.");
          }

          const nextState = data.combatStateJson as CombatState;
          const typedResolution = data.resolution as Record<string, unknown>;
          params.appendCombatTrace("auto-submit", {
            adapterDebug: "adapterDebug" in data ? data.adapterDebug : null,
            resolution: typedResolution,
          });
          const reactionRefreshLine = params.getReactionRefreshLogLine(workingState, nextState);
          const mergedCharacters = params.mergeCampaignCharacters(workingCharacters, data.characters);
          workingCharacters = mergedCharacters;

          params.setCampaign((currentCampaign) =>
            currentCampaign
              ? {
                  ...currentCampaign,
                  combatStateJson: nextState,
                  characters: mergedCharacters,
                }
              : currentCampaign,
          );
          params.queueCombatCheckpointPersist({
            combatState: nextState,
            characters: mergedCharacters,
            reason: nextState.round !== workingState.round ? "round-transition" : "auto-action",
          });
          const speaker = params.resolveEngineActionSpeaker(
            typeof typedResolution.actor === "string" ? typedResolution.actor : undefined,
            activeEntry.name,
          );
          const narration = params.buildCombatEngineResolutionNarration(typedResolution);
          params.setMessages((prev) => [
            ...prev,
            {
              speakerName: speaker.speakerName,
              role: speaker.role,
              content: narration,
              isEnemyNarration: speaker.isEnemyNarration,
            },
          ]);
          params.setCombatEngineLogEntries((current) => [
            ...current,
            {
              id: crypto.randomUUID(),
              text: `[Auto] ${narration}`,
            },
            ...(reactionRefreshLine
              ? [
                  {
                    id: crypto.randomUUID(),
                    text: `[Auto] ${reactionRefreshLine}`,
                  },
                ]
              : []),
            ...("adapterDebug" in data && data.adapterDebug
              ? [
                  {
                    id: crypto.randomUUID(),
                    text: `[Adapter] ${String(
                      (data.adapterDebug as { profile?: string }).profile ?? "unknown",
                    )} (${String(
                      (data.adapterDebug as { ruleset?: string }).ruleset ?? "unknown ruleset",
                    )})`,
                  },
                ]
              : []),
          ]);
          params.setLastCombatResolution({
            narration,
            resolution: typedResolution,
            phase: "auto",
            createdAt: new Date().toISOString(),
          });

          workingState = nextState;
          safetyCounter += 1;
        }

        if (safetyCounter >= 24) {
          params.setCombatEngineLogEntries((current) => [
            ...current,
            {
              id: crypto.randomUUID(),
              text: "Auto-turn safety stop reached.",
            },
          ]);
        }
      } finally {
        params.setIsAutoResolvingCombat(false);
      }

      return workingState;
    },
    [params],
  );

  return {
    runEngineAutoTurns,
  };
}
