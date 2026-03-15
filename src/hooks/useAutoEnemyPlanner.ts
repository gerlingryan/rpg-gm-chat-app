import { useCallback } from "react";
import type { CombatRosterEntry, CombatState } from "@/lib/combat";

type AutoEnemyCharacter = {
  sheetJson: Record<string, unknown> | null;
};

type AutoEnemyMainCharacter = {
  id: string;
  name: string;
};

type AutoEnemyMoveDestination = {
  x: number;
  y: number;
};

type AutoEnemyTelemetry = {
  decision: string;
  actor: string;
  target: string;
  attackRangeMode?: "melee" | "ranged";
  enemyHasRangedCapability: boolean;
  moveTiles: number;
  dashTiles?: number;
  distanceBefore: number;
  distanceAfter?: number;
  moveDestination?: AutoEnemyMoveDestination;
  reachableNormalTiles?: number;
  reachableDashTiles?: number;
};

export type AutoEnemyActionPlan = {
  kind: "attack" | "dash" | "pass";
  targetRef?: string;
  attackRangeMode?: "melee" | "ranged";
  moveDestination?: AutoEnemyMoveDestination;
  attackPresetId: string;
  attackBonus?: number;
  damageDie?: number;
  damageBonus?: number;
  spellName?: string;
  spellSlot?: string;
  autoEnemyTelemetry: AutoEnemyTelemetry;
};

export function useAutoEnemyPlanner(params: {
  ruleset: string;
  mainCharacter: AutoEnemyMainCharacter | null;
  combatMapTemplate: { gridCols: number; gridRows: number } | null;
  combatMapBlockedSet: Set<string>;
  getMinimumTileDistanceBetweenCombatants: (
    actor: Pick<CombatRosterEntry, "gridX" | "gridY" | "tokenFootprintCols" | "tokenFootprintRows">,
    target: Pick<CombatRosterEntry, "gridX" | "gridY" | "tokenFootprintCols" | "tokenFootprintRows">,
  ) => number;
  getCombatantFootprintCols: (entry: Pick<CombatRosterEntry, "tokenFootprintCols">) => number;
  getCombatantFootprintRows: (entry: Pick<CombatRosterEntry, "tokenFootprintRows">) => number;
  getCombatantOccupiedTileKeys: (
    entry: Pick<
      CombatRosterEntry,
      "gridX" | "gridY" | "tokenFootprintCols" | "tokenFootprintRows"
    >,
  ) => string[];
  hasBlockedTilesOnLineOfSightClient: (params: {
    actor: Pick<CombatRosterEntry, "gridX" | "gridY" | "tokenFootprintCols" | "tokenFootprintRows">;
    target: Pick<CombatRosterEntry, "gridX" | "gridY" | "tokenFootprintCols" | "tokenFootprintRows">;
    blockedTileSet: Set<string>;
  }) => boolean;
  getCombatMovementTilesPerMove: (
    ruleset: string,
    sheetJson: Record<string, unknown> | null,
  ) => number;
  isCombatHpDepleted: (value: string | undefined) => boolean;
  normalizeCombatLookup: (value: string) => string;
}) {
  const getCombatLegalTargetsForActor = useCallback(
    (state: CombatState, actor: CombatRosterEntry) => {
      const targetType = actor.type === "enemy" ? "character" : "enemy";
      return state.roster.filter(
        (entry) =>
          entry.type === targetType &&
          !params.isCombatHpDepleted(entry.hp) &&
          (entry.id ?? entry.name) !== (actor.id ?? actor.name),
      );
    },
    [params],
  );

  const chooseAutoCombatTarget = useCallback(
    (state: CombatState, actor: CombatRosterEntry) => {
      const legalTargets = getCombatLegalTargetsForActor(state, actor);
      if (legalTargets.length === 0) {
        return null;
      }
      const sorted = [...legalTargets].sort((left, right) => {
        const leftDistance = params.getMinimumTileDistanceBetweenCombatants(actor, left);
        const rightDistance = params.getMinimumTileDistanceBetweenCombatants(actor, right);
        if (leftDistance !== rightDistance) {
          return leftDistance - rightDistance;
        }
        if (actor.type === "enemy" && params.mainCharacter) {
          const leftIsMain =
            (left.id && left.id === params.mainCharacter.id) ||
            params.normalizeCombatLookup(left.name) ===
              params.normalizeCombatLookup(params.mainCharacter.name);
          const rightIsMain =
            (right.id && right.id === params.mainCharacter.id) ||
            params.normalizeCombatLookup(right.name) ===
              params.normalizeCombatLookup(params.mainCharacter.name);
          if (leftIsMain !== rightIsMain) {
            return leftIsMain ? -1 : 1;
          }
        }
        return left.name.localeCompare(right.name);
      });
      return sorted[0] ?? legalTargets[0];
    },
    [getCombatLegalTargetsForActor, params],
  );

  const getAutoCombatMovementTiles = useCallback(
    (actor: CombatRosterEntry, actorCharacter: AutoEnemyCharacter | null) => {
      const fromRuleset = params.getCombatMovementTilesPerMove(
        params.ruleset,
        actorCharacter?.sheetJson ?? null,
      );
      if (
        typeof actor.moveTilesOverride === "number" &&
        Number.isFinite(actor.moveTilesOverride)
      ) {
        return Math.max(1, Math.trunc(actor.moveTilesOverride));
      }
      return fromRuleset;
    },
    [params],
  );

  const isAutoDestinationValid = useCallback(
    (state: CombatState, actor: CombatRosterEntry, destination: AutoEnemyMoveDestination) => {
      const cols = params.getCombatantFootprintCols(actor);
      const rows = params.getCombatantFootprintRows(actor);
      if (params.combatMapTemplate) {
        if (
          destination.x < 0 ||
          destination.y < 0 ||
          destination.x + cols > params.combatMapTemplate.gridCols ||
          destination.y + rows > params.combatMapTemplate.gridRows
        ) {
          return false;
        }
      }
      const actorOccupied = new Set(params.getCombatantOccupiedTileKeys(actor));
      const destinationKeys = params.getCombatantOccupiedTileKeys({
        ...actor,
        gridX: destination.x,
        gridY: destination.y,
      });
      if (
        destinationKeys.some(
          (tileKey) =>
            params.combatMapBlockedSet.has(tileKey) && !actorOccupied.has(tileKey),
        )
      ) {
        return false;
      }
      const occupiedByOther = state.roster.some((entry) => {
        if ((entry.id ?? entry.name) === (actor.id ?? actor.name)) {
          return false;
        }
        const occupied = new Set(params.getCombatantOccupiedTileKeys(entry));
        return destinationKeys.some((tileKey) => occupied.has(tileKey));
      });
      return !occupiedByOther;
    },
    [params],
  );

  const getReachableAutoDestinations = useCallback(
    (state: CombatState, actor: CombatRosterEntry, maxTiles: number) => {
      if (
        typeof actor.gridX !== "number" ||
        !Number.isFinite(actor.gridX) ||
        typeof actor.gridY !== "number" ||
        !Number.isFinite(actor.gridY)
      ) {
        return [] as Array<{ x: number; y: number; distance: number }>;
      }
      const output: Array<{ x: number; y: number; distance: number }> = [];
      for (let dx = -maxTiles; dx <= maxTiles; dx += 1) {
        for (let dy = -maxTiles; dy <= maxTiles; dy += 1) {
          const distance = Math.max(Math.abs(dx), Math.abs(dy));
          if (distance > maxTiles) {
            continue;
          }
          const destination = { x: actor.gridX + dx, y: actor.gridY + dy };
          if (!isAutoDestinationValid(state, actor, destination)) {
            continue;
          }
          output.push({ ...destination, distance });
        }
      }
      output.sort((left, right) => left.distance - right.distance);
      return output;
    },
    [isAutoDestinationValid],
  );

  const inferEnemyHasRangedCapability = useCallback((entry: CombatRosterEntry) => {
    return entry.hasRangedCapability === true;
  }, []);

  const buildAutoEnemyTurnPlan = useCallback(
    (input: {
      state: CombatState;
      actor: CombatRosterEntry;
      actorCharacter: AutoEnemyCharacter | null;
    }) => {
      const legalTargets = getCombatLegalTargetsForActor(input.state, input.actor);
      if (legalTargets.length === 0) {
        return null;
      }
      const sortedTargets = [...legalTargets].sort(
        (left, right) =>
          params.getMinimumTileDistanceBetweenCombatants(input.actor, left) -
          params.getMinimumTileDistanceBetweenCombatants(input.actor, right),
      );
      const preferredTarget =
        chooseAutoCombatTarget(input.state, input.actor) ??
        sortedTargets[0] ??
        legalTargets[0];
      if (!preferredTarget) {
        return null;
      }
      const distanceBefore = params.getMinimumTileDistanceBetweenCombatants(
        input.actor,
        preferredTarget,
      );
      const enemyHasRangedCapability = inferEnemyHasRangedCapability(input.actor);
      const canMeleeNow = distanceBefore <= 1;
      const canRangedNow =
        enemyHasRangedCapability &&
        !params.hasBlockedTilesOnLineOfSightClient({
          actor: input.actor,
          target: preferredTarget,
          blockedTileSet: params.combatMapBlockedSet,
        });
      const moveTiles = getAutoCombatMovementTiles(input.actor, input.actorCharacter);
      if (canMeleeNow || canRangedNow) {
        return {
          kind: "attack",
          targetRef: preferredTarget.id ?? preferredTarget.name,
          attackRangeMode: canMeleeNow ? "melee" : "ranged",
          moveDestination: undefined,
          attackPresetId: "basic",
          attackBonus: undefined,
          damageDie: undefined,
          damageBonus: undefined,
          spellName: undefined,
          spellSlot: undefined,
          autoEnemyTelemetry: {
            decision: "attack-in-place",
            actor: input.actor.name,
            target: preferredTarget.name,
            attackRangeMode: canMeleeNow ? "melee" : "ranged",
            enemyHasRangedCapability,
            moveTiles,
            distanceBefore,
            distanceAfter: distanceBefore,
          },
        } satisfies AutoEnemyActionPlan;
      }

      const normalDestinations = getReachableAutoDestinations(input.state, input.actor, moveTiles);
      let bestAttackAfterMove: {
        destination: { x: number; y: number };
        target: CombatRosterEntry;
        rangeMode: "melee" | "ranged";
        score: number;
      } | null = null;

      for (const destination of normalDestinations) {
        const movedActor = {
          ...input.actor,
          gridX: destination.x,
          gridY: destination.y,
        };
        for (const target of sortedTargets) {
          const melee = params.getMinimumTileDistanceBetweenCombatants(movedActor, target) <= 1;
          const ranged =
            enemyHasRangedCapability &&
            !params.hasBlockedTilesOnLineOfSightClient({
              actor: movedActor,
              target,
              blockedTileSet: params.combatMapBlockedSet,
            });
          if (!melee && !ranged) {
            continue;
          }
          const targetDistance = params.getMinimumTileDistanceBetweenCombatants(
            movedActor,
            target,
          );
          const score = (melee ? 0 : 100) + targetDistance;
          if (!bestAttackAfterMove || score < bestAttackAfterMove.score) {
            bestAttackAfterMove = {
              destination: { x: destination.x, y: destination.y },
              target,
              rangeMode: melee ? "melee" : "ranged",
              score,
            };
          }
        }
      }

      if (bestAttackAfterMove) {
        const distanceAfter = params.getMinimumTileDistanceBetweenCombatants(
          {
            ...input.actor,
            gridX: bestAttackAfterMove.destination.x,
            gridY: bestAttackAfterMove.destination.y,
          },
          bestAttackAfterMove.target,
        );
        return {
          kind: "attack",
          targetRef: bestAttackAfterMove.target.id ?? bestAttackAfterMove.target.name,
          attackRangeMode: bestAttackAfterMove.rangeMode,
          moveDestination: bestAttackAfterMove.destination,
          attackPresetId: "basic",
          attackBonus: undefined,
          damageDie: undefined,
          damageBonus: undefined,
          spellName: undefined,
          spellSlot: undefined,
          autoEnemyTelemetry: {
            decision: "move-and-attack",
            actor: input.actor.name,
            target: bestAttackAfterMove.target.name,
            attackRangeMode: bestAttackAfterMove.rangeMode,
            enemyHasRangedCapability,
            moveTiles,
            distanceBefore,
            distanceAfter,
            moveDestination: bestAttackAfterMove.destination,
            reachableNormalTiles: normalDestinations.length,
          },
        } satisfies AutoEnemyActionPlan;
      }

      const dashTiles = moveTiles * 2;
      const dashDestinations = getReachableAutoDestinations(input.state, input.actor, dashTiles);
      const chaseDestination =
        dashDestinations
          .map((destination) => {
            const movedActor = {
              ...input.actor,
              gridX: destination.x,
              gridY: destination.y,
            };
            const nearestDistance =
              sortedTargets.reduce(
                (minimum, target) =>
                  Math.min(
                    minimum,
                    params.getMinimumTileDistanceBetweenCombatants(movedActor, target),
                  ),
                Number.POSITIVE_INFINITY,
              ) ?? Number.POSITIVE_INFINITY;
            return { destination, nearestDistance };
          })
          .sort((left, right) => left.nearestDistance - right.nearestDistance)[0]?.destination ??
        null;

      if (chaseDestination) {
        const nearestAfterDash = sortedTargets.reduce(
          (minimum, target) =>
            Math.min(
              minimum,
              params.getMinimumTileDistanceBetweenCombatants(
                {
                  ...input.actor,
                  gridX: chaseDestination.x,
                  gridY: chaseDestination.y,
                },
                target,
              ),
            ),
          Number.POSITIVE_INFINITY,
        );
        return {
          kind: "dash",
          targetRef: undefined,
          attackRangeMode: undefined,
          moveDestination: { x: chaseDestination.x, y: chaseDestination.y },
          attackPresetId: "basic",
          attackBonus: undefined,
          damageDie: undefined,
          damageBonus: undefined,
          spellName: undefined,
          spellSlot: undefined,
          autoEnemyTelemetry: {
            decision: "dash-toward-target",
            actor: input.actor.name,
            target: preferredTarget.name,
            enemyHasRangedCapability,
            moveTiles,
            dashTiles,
            distanceBefore,
            distanceAfter: nearestAfterDash,
            moveDestination: { x: chaseDestination.x, y: chaseDestination.y },
            reachableNormalTiles: normalDestinations.length,
            reachableDashTiles: dashDestinations.length,
          },
        } satisfies AutoEnemyActionPlan;
      }

      return {
        kind: "pass",
        targetRef: undefined,
        attackRangeMode: undefined,
        moveDestination: undefined,
        attackPresetId: "basic",
        attackBonus: undefined,
        damageDie: undefined,
        damageBonus: undefined,
        spellName: undefined,
        spellSlot: undefined,
        autoEnemyTelemetry: {
          decision: "pass-no-legal-plan",
          actor: input.actor.name,
          target: preferredTarget.name,
          enemyHasRangedCapability,
          moveTiles,
          distanceBefore,
          reachableNormalTiles: normalDestinations.length,
          reachableDashTiles: dashDestinations.length,
        },
      } satisfies AutoEnemyActionPlan;
    },
    [
      chooseAutoCombatTarget,
      getAutoCombatMovementTiles,
      getCombatLegalTargetsForActor,
      getReachableAutoDestinations,
      inferEnemyHasRangedCapability,
      params,
    ],
  );

  return {
    chooseAutoCombatTarget,
    buildAutoEnemyTurnPlan,
  };
}
