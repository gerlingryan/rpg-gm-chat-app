export type EncounterRiskInput = {
  partySize: number;
  enemyCountTarget: number;
  averageResourceRatio: number;
  averageLevel: number;
  enemyAttackBonus?: number;
  enemyDamageDie?: number;
  enemyDamageBonus?: number;
};

export function computeEncounterRiskScore(input: EncounterRiskInput) {
  let score = 0;

  if (input.partySize > 0 && input.enemyCountTarget >= input.partySize + 1) {
    score += 2;
  } else if (input.partySize > 0 && input.enemyCountTarget >= input.partySize) {
    score += 1;
  }

  if (input.averageResourceRatio <= 0.55) {
    score += 2;
  } else if (input.averageResourceRatio <= 0.75) {
    score += 1;
  }

  if (input.averageLevel <= 2 && input.enemyCountTarget >= input.partySize && input.partySize > 0) {
    score += 1;
  }

  if ((input.enemyAttackBonus ?? 0) >= 4) {
    score += 1;
  }
  if ((input.enemyDamageDie ?? 0) >= 8) {
    score += 1;
  }
  if ((input.enemyDamageBonus ?? 0) >= 2) {
    score += 1;
  }

  return score;
}

export function classifyEncounterRisk(score: number) {
  if (score >= 5) {
    return { label: "Hard" as const };
  }
  if (score >= 3) {
    return { label: "Fair" as const };
  }
  return { label: "Easy" as const };
}

