export type SummaryField = {
  label: string;
  value: string;
};

function asObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getBonuses(sheetJson: Record<string, unknown> | null) {
  if (!sheetJson) {
    return null;
  }
  const bonuses = asObject(sheetJson.abilityScoreBonuses);
  if (!bonuses) {
    return null;
  }
  return Object.entries(bonuses)
    .filter(([, value]) => typeof value === "number" && value !== 0)
    .map(([key, value]) => {
      const numericValue = value as number;
      return `${numericValue > 0 ? "+" : ""}${numericValue} ${key.toUpperCase()}`;
    });
}

export function getDndAsiSummaryText(sheetJson: Record<string, unknown> | null) {
  const bonusParts = getBonuses(sheetJson);
  if (!bonusParts || bonusParts.length === 0) {
    return "";
  }
  const ruleSet =
    sheetJson && typeof sheetJson.abilityScoreRuleSet === "string"
      ? sheetJson.abilityScoreRuleSet
      : "legacy-fixed";
  return `${ruleSet === "modern-flexible" ? "Flexible ASI" : "Ancestry ASI"}: ${bonusParts.join(", ")}`;
}

export function getDndAsiSummaryFields(sheetJson: Record<string, unknown> | null): SummaryField[] {
  if (!sheetJson) {
    return [];
  }
  const summary = asObject(sheetJson.abilityGenerationSummary);
  const fields: SummaryField[] = [];
  if (summary && typeof summary.method === "string") {
    const methodRaw = summary.method;
    const method =
      methodRaw === "standard-array"
        ? "Standard Array"
        : methodRaw === "point-buy"
          ? "Point Buy"
          : methodRaw === "roll-4d6"
            ? "Roll 4d6 Drop Lowest"
            : methodRaw === "manual-enter"
              ? "Manual Entry"
              : methodRaw;
    fields.push({ label: "Ability Method", value: method });
  }
  const asiText = getDndAsiSummaryText(sheetJson);
  if (asiText) {
    fields.push({ label: "Ancestry Bonuses", value: asiText.replace(/^.+?:\s*/, "") });
  }
  return fields;
}
