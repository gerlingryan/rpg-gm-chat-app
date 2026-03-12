"use client";

import { useSearchParams } from "next/navigation";
import { LibraryCharacterBuilder } from "@/components/LibraryCharacterBuilder";

const RULESET_OPTIONS = [
  "D&D 5e",
  "Deadlands Classic",
  "Savage Rifts",
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
      headingTitle=""
      headingDescription=""
      showHeading={false}
      showInlineHeaderWhenNoHero
    />
  );
}
