import assert from "node:assert/strict";
import test from "node:test";

import { appendQueryParamsToPath } from "../navigation";

test("appendQueryParamsToPath appends query params to clean path", () => {
  const value = appendQueryParamsToPath("/campaigns/new", {
    ruleset: "D&D 5e",
    libraryCharacterId: "abc123",
  });
  assert.equal(value, "/campaigns/new?ruleset=D%26D+5e&libraryCharacterId=abc123");
});

test("appendQueryParamsToPath merges with existing query params", () => {
  const value = appendQueryParamsToPath("/campaigns/new?foo=bar", {
    ruleset: "Deadlands Classic",
  });
  assert.equal(value, "/campaigns/new?foo=bar&ruleset=Deadlands+Classic");
});

test("appendQueryParamsToPath updates existing values and preserves hash", () => {
  const value = appendQueryParamsToPath("/campaigns/new?ruleset=old#section", {
    ruleset: "Savage Rifts",
    libraryCharacterId: "x9",
  });
  assert.equal(value, "/campaigns/new?ruleset=Savage+Rifts&libraryCharacterId=x9#section");
});

test("appendQueryParamsToPath removes params for empty values", () => {
  const value = appendQueryParamsToPath("/campaigns/new?ruleset=D%26D+5e&libraryCharacterId=abc", {
    ruleset: "",
    libraryCharacterId: undefined,
  });
  assert.equal(value, "/campaigns/new");
});
