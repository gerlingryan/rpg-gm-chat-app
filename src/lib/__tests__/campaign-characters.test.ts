import test from "node:test";
import assert from "node:assert/strict";
import { upsertMainCharacter } from "../campaign-characters";

type TestCharacter = {
  id: string;
  isMainCharacter: boolean;
  name: string;
};

test("upsertMainCharacter places new main first and keeps companions", () => {
  const characters: TestCharacter[] = [
    { id: "main-old", isMainCharacter: true, name: "Old Main" },
    { id: "comp-1", isMainCharacter: false, name: "Companion 1" },
    { id: "comp-2", isMainCharacter: false, name: "Companion 2" },
  ];
  const createdMain: TestCharacter = {
    id: "main-new",
    isMainCharacter: true,
    name: "New Main",
  };

  const result = upsertMainCharacter(characters, createdMain);

  assert.equal(result[0].id, "main-new");
  assert.equal(result.length, 3);
  assert.deepEqual(
    result.slice(1).map((entry) => entry.id),
    ["comp-1", "comp-2"],
  );
});

test("upsertMainCharacter inserts when no existing main is present", () => {
  const characters: TestCharacter[] = [
    { id: "comp-1", isMainCharacter: false, name: "Companion 1" },
  ];
  const createdMain: TestCharacter = {
    id: "main-new",
    isMainCharacter: true,
    name: "New Main",
  };

  const result = upsertMainCharacter(characters, createdMain);

  assert.deepEqual(
    result.map((entry) => entry.id),
    ["main-new", "comp-1"],
  );
});
