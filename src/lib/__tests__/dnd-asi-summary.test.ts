import assert from "node:assert/strict";
import test from "node:test";

import { getDndAsiSummaryFields, getDndAsiSummaryText } from "../dnd-asi-summary";

test("getDndAsiSummaryText formats legacy bonuses", () => {
  const text = getDndAsiSummaryText({
    abilityScoreRuleSet: "legacy-fixed",
    abilityScoreBonuses: {
      con: 2,
      wis: 1,
      str: 0,
    },
  });

  assert.equal(text, "Ancestry ASI: +2 CON, +1 WIS");
});

test("getDndAsiSummaryText formats flexible bonuses", () => {
  const text = getDndAsiSummaryText({
    abilityScoreRuleSet: "modern-flexible",
    abilityScoreBonuses: {
      int: 2,
      dex: 1,
    },
  });

  assert.equal(text, "Flexible ASI: +2 INT, +1 DEX");
});

test("getDndAsiSummaryFields returns method and ancestry fields", () => {
  const fields = getDndAsiSummaryFields({
    abilityGenerationSummary: {
      method: "point-buy",
    },
    abilityScoreRuleSet: "legacy-fixed",
    abilityScoreBonuses: {
      con: 2,
      wis: 1,
    },
  });

  assert.equal(fields[0]?.label, "Ability Method");
  assert.equal(fields[0]?.value, "Point Buy");
  assert.equal(fields[1]?.label, "Ancestry Bonuses");
  assert.equal(fields[1]?.value, "+2 CON, +1 WIS");
});

