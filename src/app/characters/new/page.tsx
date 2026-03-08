"use client";

import { useSearchParams } from "next/navigation";
import { LibraryCharacterBuilder } from "@/components/LibraryCharacterBuilder";

const RULESET_OPTIONS = [
  "D&D 5e",
  "Deadlands Classic",
  "Savage Rifts",
  "Mutants in the Now",
  "Astonishing Super Heroes",
  "Star Wars RPG",
  "Legend of 5 Rings 4e",
  "Vampire: The Masqureade V5",
  "Call of Cthulhu",
] as const;

export default function NewCharacterPage() {
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("returnTo")?.trim() || "/";
  const isCompanionFlow = /\/campaign\/[^/]+\/companions$/.test(returnTo);
  const requestedRuleset = searchParams.get("ruleset")?.trim() || RULESET_OPTIONS[0];

  const rulesetOptions =
    !requestedRuleset || RULESET_OPTIONS.includes(requestedRuleset as (typeof RULESET_OPTIONS)[number])
      ? RULESET_OPTIONS
      : ([requestedRuleset, ...RULESET_OPTIONS] as const);

  return (
    <LibraryCharacterBuilder
      mode="create"
      initialRuleset={requestedRuleset}
      rulesetOptions={rulesetOptions}
      submitUrl="/api/library-characters"
      submitMethod="POST"
      returnTo={returnTo}
      backHref={`/characters?ruleset=${encodeURIComponent(requestedRuleset)}&returnTo=${encodeURIComponent(returnTo)}`}
      backLabel={isCompanionFlow ? "Open Library" : "Open Library"}
      headingKicker="Character Creation"
      headingTitle="Create a Reusable Character"
      headingDescription="Build a reusable library character once, then import them into any new campaign that uses the same ruleset."
    />
  );
}
