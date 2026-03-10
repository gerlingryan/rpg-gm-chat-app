import test from "node:test";
import assert from "node:assert/strict";
import {
  clampText,
  extractRequestedFields,
  extractRequestedOptionCount,
  formatCoachReplyWithSections,
  normalizeCoachApiResponse,
  parseJsonObject,
} from "../character-coach";

test("extractRequestedOptionCount reads explicit counts and clamps", () => {
  assert.equal(extractRequestedOptionCount("give me 3 options"), 3);
  assert.equal(extractRequestedOptionCount("give me 99 options"), 10);
  assert.equal(extractRequestedOptionCount("give me a few ideas"), 3);
  assert.equal(extractRequestedOptionCount("just one idea"), null);
});

test("extractRequestedFields identifies requested field scope", () => {
  const fields = extractRequestedFields("Give me background and personality options.");
  assert.equal(fields.has("background"), true);
  assert.equal(fields.has("personality"), true);
  assert.equal(fields.has("physicalDescription"), false);
});

test("parseJsonObject supports fenced JSON payloads", () => {
  const parsed = parseJsonObject('```json\n{"reply":"ok"}\n```');
  assert.deepEqual(parsed, { reply: "ok" });
  assert.equal(parseJsonObject("not-json"), null);
});

test("clampText enforces max length and empty fallback", () => {
  assert.equal(clampText("hello", 3), "hel");
  assert.equal(clampText(undefined, 3), "");
});

test("formatCoachReplyWithSections appends section tags when options exist", () => {
  const formatted = formatCoachReplyWithSections({
    reply: "Here are options.",
    personalityCount: 2,
    backgroundCount: 0,
    physicalCount: 1,
  });
  assert.match(formatted, /Sections: Personality • Physical options/);
});

test("normalizeCoachApiResponse returns safe fallback for malformed payload", () => {
  const normalized = normalizeCoachApiResponse({ bad: "payload" });
  assert.ok(normalized.message.content.length > 0);
  assert.equal(normalized.warning, "empty payload");
  assert.deepEqual(normalized.options.personalityOptions, []);
  assert.equal(normalized.suggestions.personality, undefined);
});

test("normalizeCoachApiResponse preserves valid options and suggestions", () => {
  const normalized = normalizeCoachApiResponse({
    message: { content: "Here you go" },
    suggestions: { personality: "Quiet and observant." },
    options: {
      personalityOptions: ["A", "B"],
      backgroundOptions: ["C"],
      physicalDescriptionOptions: ["D"],
    },
    meta: { retryUsed: true },
  });
  assert.equal(normalized.message.content, "Here you go");
  assert.equal(normalized.suggestions.personality, "Quiet and observant.");
  assert.deepEqual(normalized.options.personalityOptions, ["A", "B"]);
  assert.equal(normalized.warning, undefined);
});
