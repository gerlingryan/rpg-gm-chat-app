import { useCallback, useState } from "react";

export type CombatTraceEntry = {
  id: string;
  timestamp: string;
  phase: string;
  payload: unknown;
};

export function useCombatTrace(maxEntries = 60) {
  const [combatTraceEntries, setCombatTraceEntries] = useState<CombatTraceEntry[]>([]);

  const appendCombatTrace = useCallback(
    (phase: string, payload: unknown) => {
      if (
        !payload ||
        (typeof payload === "object" &&
          payload !== null &&
          Object.keys(payload as Record<string, unknown>).length === 0)
      ) {
        return;
      }
      setCombatTraceEntries((current) => {
        const next = [
          ...current,
          {
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            phase,
            payload,
          },
        ];
        return next.length > maxEntries ? next.slice(next.length - maxEntries) : next;
      });
    },
    [maxEntries],
  );

  const clearCombatTrace = useCallback(() => {
    setCombatTraceEntries([]);
  }, []);

  return {
    combatTraceEntries,
    appendCombatTrace,
    clearCombatTrace,
  };
}
