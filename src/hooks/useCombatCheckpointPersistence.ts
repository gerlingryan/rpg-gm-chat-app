import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CombatState } from "@/lib/combat";

type UseCombatCheckpointPersistenceParams = {
  campaignId: string;
  ruleset?: string;
  debugStateLoggingEnabled: boolean;
  combatActive: boolean;
  combatRound: number;
  appendCombatTrace?: (phase: string, payload: unknown) => void;
  actionsPerCheckpoint?: number;
};

type QueuePayload<TCharacter> = {
  combatState: CombatState;
  characters: TCharacter[];
  reason: string;
};

export function useCombatCheckpointPersistence<TCharacter>(
  params: UseCombatCheckpointPersistenceParams,
) {
  const {
    campaignId,
    ruleset,
    debugStateLoggingEnabled,
    combatActive,
    combatRound,
    appendCombatTrace,
    actionsPerCheckpoint: actionsPerCheckpointInput,
  } = params;
  const actionsPerCheckpoint = Math.max(1, actionsPerCheckpointInput ?? 5);
  const actionsSincePersistRef = useRef(0);
  const lastPersistedRoundRef = useRef<number | null>(null);
  const persistInFlightRef = useRef(false);
  const queuedRef = useRef<QueuePayload<TCharacter> | null>(null);
  const [isCombatCheckpointPersisting, setIsCombatCheckpointPersisting] = useState(false);
  const [combatCheckpointLastSavedAt, setCombatCheckpointLastSavedAt] = useState<string | null>(
    null,
  );
  const [combatCheckpointLastSavedReason, setCombatCheckpointLastSavedReason] = useState<
    string | null
  >(null);

  useEffect(() => {
    if (!combatActive) {
      actionsSincePersistRef.current = 0;
      lastPersistedRoundRef.current = null;
      return;
    }
    if (lastPersistedRoundRef.current === null) {
      lastPersistedRoundRef.current = combatRound;
    }
  }, [combatActive, combatRound]);

  const persistCombatCheckpointNow = useCallback(
    async (payload: QueuePayload<TCharacter>) => {
      if (!campaignId) {
        return;
      }
      setIsCombatCheckpointPersisting(true);
      try {
        const response = await fetch(`/api/campaigns/${campaignId}/combat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Debug-State-Logging": debugStateLoggingEnabled ? "true" : "false",
          },
          body: JSON.stringify({
            action: "persist-runtime",
            runtime: {
              ruleset: ruleset ?? "D&D 5e",
              combatStateJson: payload.combatState,
              characters: payload.characters,
            },
          }),
        });
        const data = await response.json().catch(() => ({}));
        appendCombatTrace?.("checkpoint-persist", {
          reason: payload.reason,
          ok: response.ok,
          adapterDebug: "adapterDebug" in data ? data.adapterDebug : null,
        });
        if (response.ok) {
          setCombatCheckpointLastSavedAt(new Date().toISOString());
          setCombatCheckpointLastSavedReason(payload.reason);
        }
      } finally {
        setIsCombatCheckpointPersisting(false);
      }
    },
    [appendCombatTrace, campaignId, debugStateLoggingEnabled, ruleset],
  );

  const flushCombatCheckpointQueue = useCallback(async () => {
    if (persistInFlightRef.current) {
      return;
    }
    persistInFlightRef.current = true;
    try {
      while (queuedRef.current) {
        const next = queuedRef.current;
        queuedRef.current = null;
        try {
          await persistCombatCheckpointNow(next);
        } catch (error) {
          appendCombatTrace?.("checkpoint-persist-error", {
            reason: next.reason,
            message: error instanceof Error ? error.message : "Persist failed.",
          });
        }
      }
    } finally {
      persistInFlightRef.current = false;
      if (queuedRef.current) {
        void flushCombatCheckpointQueue();
      }
    }
  }, [appendCombatTrace, persistCombatCheckpointNow]);

  const queueCombatCheckpointPersist = useCallback(
    (payload: QueuePayload<TCharacter> & { force?: boolean }) => {
      const force = payload.force === true;
      const roundChanged =
        lastPersistedRoundRef.current !== null &&
        payload.combatState.round !== lastPersistedRoundRef.current;
      if (!force) {
        actionsSincePersistRef.current += 1;
        if (!roundChanged && actionsSincePersistRef.current < actionsPerCheckpoint) {
          return;
        }
      }
      actionsSincePersistRef.current = 0;
      lastPersistedRoundRef.current = payload.combatState.round;
      queuedRef.current = {
        combatState: payload.combatState,
        characters: payload.characters,
        reason: payload.reason,
      };
      void flushCombatCheckpointQueue();
    },
    [actionsPerCheckpoint, flushCombatCheckpointQueue],
  );

  const combatCheckpointStatusText = useMemo(() => {
    if (isCombatCheckpointPersisting) {
      return "Saving checkpoint...";
    }
    if (!combatCheckpointLastSavedAt) {
      return "No checkpoint saved yet.";
    }
    const timestamp = new Date(combatCheckpointLastSavedAt);
    const formatted = Number.isNaN(timestamp.getTime())
      ? combatCheckpointLastSavedAt
      : timestamp.toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
          second: "2-digit",
        });
    return combatCheckpointLastSavedReason
      ? `Last saved ${formatted} (${combatCheckpointLastSavedReason}).`
      : `Last saved ${formatted}.`;
  }, [
    combatCheckpointLastSavedAt,
    combatCheckpointLastSavedReason,
    isCombatCheckpointPersisting,
  ]);

  return {
    combatCheckpointStatusText,
    persistCombatCheckpointNow,
    queueCombatCheckpointPersist,
  };
}
