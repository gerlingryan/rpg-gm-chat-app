import test from "node:test";
import assert from "node:assert/strict";

import { normalizeChoiceTextForDisplay } from "@/lib/chat-display";

test("normalizeChoiceTextForDisplay splits escaped-newline numbered options into separate lines", () => {
  const input =
    "And what if we refuse?\\n\\nA slight, chilling laugh escapes the lead figure.\\n\\n1. Ask for details about the item they seek.\\n2. Change the subject, trying to gather more information about them.\\n3. Offer a different trade, like gold or favor.\\n4. Signal for the group to withdraw and discuss the danger quietly.";

  const normalized = normalizeChoiceTextForDisplay(input);
  const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);

  assert.ok(lines.includes("1. Ask for details about the item they seek."));
  assert.ok(lines.includes("2. Change the subject, trying to gather more information about them."));
  assert.ok(lines.includes("3. Offer a different trade, like gold or favor."));
  assert.ok(lines.includes("4. Signal for the group to withdraw and discuss the danger quietly."));
});

test("normalizeChoiceTextForDisplay splits inline multi-option lines", () => {
  const input =
    "1. Approach cautiously. 2. Check for traps. 3. Cast a scouting spell. 4. Fall back.";
  const normalized = normalizeChoiceTextForDisplay(input);
  const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);

  assert.deepEqual(lines, [
    "1. Approach cautiously.",
    "2. Check for traps.",
    "3. Cast a scouting spell.",
    "4. Fall back.",
  ]);
});

test("normalizeChoiceTextForDisplay does not split combat math like AC 15.", () => {
  const input =
    "Thug 1 attacks Buck Bradley: d20(13) + 3 = 16 vs AC 15. Hit for damage roll d6(2) + 1 = 3 (HP 27/35 -> 24/35).";
  const normalized = normalizeChoiceTextForDisplay(input);
  const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);

  assert.equal(lines.length, 1);
  assert.equal(lines[0], input);
});

test("normalizeChoiceTextForDisplay does not split combat TN 5. Miss text", () => {
  const input =
    "Smuggler Contact attacks Gang Lieutenant: d6(2) + 1 = 3 vs TN 5. Miss. (Wounds 0 -> 0) (Location Guts: 0 -> 0)";
  const normalized = normalizeChoiceTextForDisplay(input);
  const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);

  assert.equal(lines.length, 1);
  assert.equal(lines[0], input);
});
