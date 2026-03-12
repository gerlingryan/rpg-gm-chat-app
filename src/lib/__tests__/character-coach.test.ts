import test from "node:test";
import assert from "node:assert/strict";
import {
  clampText,
  extractRequestedFields,
  extractRequestedOptionCount,
  formatCoachReplyWithSections,
  normalizeCoachApiResponse,
  parseJsonObject,
  shouldGenerateFieldSuggestions,
} from "../character-coach";

test("extractRequestedOptionCount reads explicit counts and clamps", () => {
  assert.equal(extractRequestedOptionCount("give me 3 options"), 3);
  assert.equal(extractRequestedOptionCount("give me 99 options"), 10);
  assert.equal(extractRequestedOptionCount("give me 7 more names"), 7);
  assert.equal(extractRequestedOptionCount("need 6 background ideas"), 6);
  assert.equal(extractRequestedOptionCount("give 4 additional options"), 4);
  assert.equal(extractRequestedOptionCount("give me a few ideas"), 3);
  assert.equal(extractRequestedOptionCount("just one idea"), null);
});

test("extractRequestedFields identifies requested field scope", () => {
  const fields = extractRequestedFields(
    "Give me background, personality, and name options.",
  );
  assert.equal(fields.has("name"), true);
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
    nameCount: 1,
    personalityCount: 2,
    backgroundCount: 0,
    physicalCount: 1,
  });
  assert.match(formatted, /Sections: Name \| Personality \| Physical options/);
});

test("normalizeCoachApiResponse returns safe fallback for malformed payload", () => {
  const normalized = normalizeCoachApiResponse({ bad: "payload" });
  assert.ok(normalized.message.content.length > 0);
  assert.equal(normalized.warning, "empty payload");
  assert.deepEqual(normalized.options.nameOptions, []);
  assert.deepEqual(normalized.options.personalityOptions, []);
  assert.equal(normalized.suggestions.name, undefined);
  assert.equal(normalized.suggestions.personality, undefined);
});

test("normalizeCoachApiResponse preserves valid options and suggestions", () => {
  const normalized = normalizeCoachApiResponse({
    message: { content: "Here you go" },
    suggestions: { name: "Raven Blackwell", personality: "Quiet and observant." },
    options: {
      nameOptions: ["Raven Blackwell"],
      personalityOptions: ["A", "B"],
      backgroundOptions: ["C"],
      physicalDescriptionOptions: ["D"],
    },
    meta: { retryUsed: true },
  });
  assert.equal(normalized.message.content, "Here you go");
  assert.equal(normalized.suggestions.name, "Raven Blackwell");
  assert.equal(normalized.suggestions.personality, "Quiet and observant.");
  assert.deepEqual(normalized.options.nameOptions, ["Raven Blackwell"]);
  assert.deepEqual(normalized.options.personalityOptions, ["A", "B"]);
  assert.equal(normalized.warning, undefined);
});

test("shouldGenerateFieldSuggestions is false for advisory-only rules question", () => {
  assert.equal(
    shouldGenerateFieldSuggestions({
      message: "What does a cleric do?",
      explicitTargetField: "auto",
      requestedFields: new Set(),
      requestedOptionCount: null,
    }),
    false,
  );
});

test("shouldGenerateFieldSuggestions is true when asking for field ideas", () => {
  assert.equal(
    shouldGenerateFieldSuggestions({
      message: "Give me 3 background ideas for a dwarf cleric.",
      explicitTargetField: "auto",
      requestedFields: new Set(["background"]),
      requestedOptionCount: 3,
    }),
    true,
  );
});
