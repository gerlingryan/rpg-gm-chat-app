"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { getDefaultStartingScenario } from "@/lib/campaigns";
import { getDndAsiSummaryText } from "@/lib/dnd-asi-summary";
import { appendQueryParamsToPath } from "@/lib/navigation";
import { type NarrationLevel } from "@/lib/party";

const RULESET_OPTIONS = [
  "D&D 5e",
  "Deadlands Classic",
  "Savage Rifts",
] as const;

const TONE_OPTIONS = ["heroic", "gritty", "horror", "comedic"] as const;
const THEME_OPTIONS = ["mystery", "heist", "war", "survival", "politics"] as const;
const SCOPE_OPTIONS = ["one city", "region", "globe"] as const;
const PARTY_TYPE_OPTIONS = ["mercs", "investigators", "rebels", "explorers"] as const;
const STARTING_HOOK_OPTIONS = [
  "job offer",
  "disaster",
  "betrayal",
  "missing person",
] as const;

type LibraryCharacter = {
  id: string;
  name: string;
  ruleset: string;
  role: string;
  sheetJson: Record<string, unknown> | null;
  memorySummary: string | null;
  createdAt: string;
  updatedAt: string;
};

type CampaignCreatePanelProps = {
  returnTo?: string;
};

export default function CampaignCreatePanel({
  returnTo = "/campaigns/new",
}: CampaignCreatePanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedRuleset = searchParams.get("ruleset")?.trim() ?? "";
  const usesListedRequestedRuleset =
    requestedRuleset &&
    RULESET_OPTIONS.includes(requestedRuleset as (typeof RULESET_OPTIONS)[number]);
  const [campaignTitle, setCampaignTitle] = useState("");
  const [selectedRuleset, setSelectedRuleset] = useState<string>(
    usesListedRequestedRuleset ? requestedRuleset : RULESET_OPTIONS[0],
  );
  const [customRuleset, setCustomRuleset] = useState(
    !usesListedRequestedRuleset && requestedRuleset ? requestedRuleset : "",
  );
  const [useCustomRuleset, setUseCustomRuleset] = useState(
    Boolean(!usesListedRequestedRuleset && requestedRuleset),
  );
  const [startingScenario, setStartingScenario] = useState(
    getDefaultStartingScenario(RULESET_OPTIONS[0]),
  );
  const [tone, setTone] = useState<(typeof TONE_OPTIONS)[number]>("heroic");
  const [theme, setTheme] = useState<(typeof THEME_OPTIONS)[number]>("mystery");
  const [scope, setScope] = useState<(typeof SCOPE_OPTIONS)[number]>("one city");
  const [partyType, setPartyType] =
    useState<(typeof PARTY_TYPE_OPTIONS)[number]>("investigators");
  const [startingHook, setStartingHook] =
    useState<(typeof STARTING_HOOK_OPTIONS)[number]>("job offer");
  const [linesLimits, setLinesLimits] = useState("");
  const [narrationLevel, setNarrationLevel] = useState<NarrationLevel>("medium");
  const [selectedLibraryCharacterId, setSelectedLibraryCharacterId] = useState("");
  const [selectedCompanionLibraryCharacterIds, setSelectedCompanionLibraryCharacterIds] =
    useState<string[]>([]);
  const [libraryCharacters, setLibraryCharacters] = useState<LibraryCharacter[]>([]);
  const [isLoadingLibraryCharacters, setIsLoadingLibraryCharacters] = useState(true);
  const [libraryError, setLibraryError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const activeRuleset = useMemo(() => {
    return useCustomRuleset ? customRuleset.trim() : selectedRuleset;
  }, [customRuleset, selectedRuleset, useCustomRuleset]);

  const selectedLibraryCharacter = libraryCharacters.find(
    (character) => character.id === selectedLibraryCharacterId,
  );
  const selectedCompanionCharacters = libraryCharacters.filter((character) =>
    selectedCompanionLibraryCharacterIds.includes(character.id),
  );
  const libraryReturnTo = appendQueryParamsToPath(returnTo, {
    ruleset: activeRuleset || undefined,
  });

  useEffect(() => {
    const scenarioRuleset = useCustomRuleset ? "Custom RPG" : selectedRuleset;
    setStartingScenario(getDefaultStartingScenario(scenarioRuleset));
    setSelectedLibraryCharacterId("");
    setSelectedCompanionLibraryCharacterIds([]);
  }, [selectedRuleset, useCustomRuleset]);

  useEffect(() => {
    if (!requestedRuleset) {
      return;
    }

    if (usesListedRequestedRuleset) {
      setUseCustomRuleset(false);
      setSelectedRuleset(requestedRuleset);
      return;
    }

    setUseCustomRuleset(true);
    setCustomRuleset(requestedRuleset);
  }, [requestedRuleset, usesListedRequestedRuleset]);

  useEffect(() => {
    async function loadLibraryCharacters() {
      if (!activeRuleset) {
        setLibraryCharacters([]);
        setSelectedLibraryCharacterId("");
        setIsLoadingLibraryCharacters(false);
        setLibraryError("");
        return;
      }

      try {
        setLibraryError("");
        setIsLoadingLibraryCharacters(true);

        const response = await fetch(
          `/api/library-characters?ruleset=${encodeURIComponent(activeRuleset)}`,
        );
        const data = await response.json();

        if (!response.ok || !Array.isArray(data.characters)) {
          throw new Error(data.error ?? "Unable to load library characters.");
        }

        setLibraryCharacters(data.characters);
      } catch (loadError) {
        setLibraryError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load library characters.",
        );
      } finally {
        setIsLoadingLibraryCharacters(false);
      }
    }

    loadLibraryCharacters();
  }, [activeRuleset]);

  useEffect(() => {
    const requestedLibraryCharacterId =
      searchParams.get("libraryCharacterId")?.trim() ?? "";

    if (
      requestedLibraryCharacterId &&
      libraryCharacters.some((character) => character.id === requestedLibraryCharacterId)
    ) {
      setSelectedLibraryCharacterId(requestedLibraryCharacterId);
    }
  }, [libraryCharacters, searchParams]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const ruleset = activeRuleset.trim();
    if (!ruleset || isSubmitting) {
      return;
    }

    setError("");
    setIsSubmitting(true);

    try {
      if (!selectedLibraryCharacterId) {
        throw new Error("Choose an existing character before creating the campaign.");
      }

        const response = await fetch("/api/campaigns", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: campaignTitle.trim(),
          ruleset,
          startingScenario: startingScenario.trim(),
          narrationLevel,
          tone,
          theme,
          scope,
          partyType,
          startingHook,
          linesLimits: linesLimits.trim(),
          libraryCharacterId: selectedLibraryCharacterId,
          companionLibraryCharacterIds: selectedCompanionLibraryCharacterIds,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.campaignId) {
        throw new Error(data.error ?? "Unable to create campaign.");
      }

      router.push(`/campaign/${data.campaignId}`);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Unable to create campaign.",
      );
      setIsSubmitting(false);
    }
  }

  function toggleCompanionLibraryCharacterId(characterId: string) {
    if (characterId === selectedLibraryCharacterId) {
      return;
    }
    setSelectedCompanionLibraryCharacterIds((current) =>
      current.includes(characterId)
        ? current.filter((entry) => entry !== characterId)
        : [...current, characterId],
    );
  }

  return (
    <section className="rounded-[2rem] border border-emerald-300/12 bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.08),transparent_28%),linear-gradient(180deg,rgba(15,23,42,0.92),rgba(12,18,30,0.92))] p-5 shadow-2xl shadow-black/40 backdrop-blur md:p-5.5">
      <div className="mb-3">
        <h2 className="text-2xl font-semibold text-emerald-50">
          Start a new adventure!
        </h2>
      </div>

      <form className="space-y-3.5" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <label
            className="block text-sm font-medium text-slate-200"
            htmlFor="campaign-title"
          >
            Campaign title
          </label>
          <input
            id="campaign-title"
            value={campaignTitle}
            onChange={(event) => setCampaignTitle(event.target.value)}
            placeholder="Optional, a title will be generated if left blank"
            className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-2.5 text-sm text-white outline-none transition focus:border-cyan-300/60"
          />
        </div>

        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-slate-200">
              RPG ruleset
            </label>
            <button
              type="button"
              onClick={() => setUseCustomRuleset((current) => !current)}
              className="text-sm font-medium text-cyan-200 transition hover:text-cyan-100"
            >
              {useCustomRuleset ? "Use listed rulesets" : "Enter custom"}
            </button>
          </div>

          {useCustomRuleset ? (
            <textarea
              value={customRuleset}
              onChange={(event) => setCustomRuleset(event.target.value)}
              placeholder="Example: Shadowrun 6e, homebrew d20 horror, custom mecha tactics..."
              className="min-h-[88px] w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-2.5 text-sm text-white outline-none transition focus:border-cyan-300/60"
            />
          ) : (
            <select
              value={selectedRuleset}
              onChange={(event) => setSelectedRuleset(event.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/60"
            >
              {RULESET_OPTIONS.map((ruleset) => (
                <option key={ruleset} value={ruleset}>
                  {ruleset}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-3.5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-medium text-slate-200">
                Main character
              </div>
              <p className="mt-1 text-xs text-slate-400">
                Choose an existing reusable character. New characters are
                created in the character library.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/characters?ruleset=${encodeURIComponent(activeRuleset || "")}&returnTo=${encodeURIComponent(libraryReturnTo)}`}
                className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-white/25 hover:text-white"
              >
                Open Library
              </Link>
            </div>
          </div>

          {isLoadingLibraryCharacters ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sm text-slate-300">
              Loading library characters...
            </div>
          ) : null}

          {!isLoadingLibraryCharacters && libraryError ? (
            <div className="rounded-2xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">
              {libraryError}
            </div>
          ) : null}

          {!isLoadingLibraryCharacters &&
          !libraryError &&
          libraryCharacters.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sm text-slate-300">
              No reusable characters exist for this ruleset yet. Create one
              in the character library before launching a campaign.
            </div>
          ) : null}

          {!isLoadingLibraryCharacters && libraryCharacters.length > 0 ? (
            <div className="space-y-3">
              <label
                className="block text-sm font-medium text-slate-200"
                htmlFor="main-character-select"
              >
                Choose a saved character
              </label>
              <select
                id="main-character-select"
                value={selectedLibraryCharacterId}
                onChange={(event) =>
                  setSelectedLibraryCharacterId(event.target.value)
                }
                className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/60"
              >
                <option value="">Select a character...</option>
                {libraryCharacters.map((character) => (
                  <option key={character.id} value={character.id}>
                    {buildLibraryCharacterOptionLabel(character)}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>

        <div className="space-y-2">
          <div className="rounded-2xl border border-white/10 bg-black/20 p-3.5">
            <div className="text-sm font-medium text-slate-200">Session Zero Lite</div>
            <p className="mt-1 text-xs text-slate-400">
              Optional guidance for campaign bootstrap generation.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="block text-xs font-medium uppercase tracking-[0.12em] text-slate-400">
                  Tone
                </span>
                <select
                  value={tone}
                  onChange={(event) => setTone(event.target.value as (typeof TONE_OPTIONS)[number])}
                  className="w-full rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 text-xs text-white outline-none transition focus:border-cyan-300/60"
                >
                  {TONE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1">
                <span className="block text-xs font-medium uppercase tracking-[0.12em] text-slate-400">
                  Theme
                </span>
                <select
                  value={theme}
                  onChange={(event) =>
                    setTheme(event.target.value as (typeof THEME_OPTIONS)[number])
                  }
                  className="w-full rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 text-xs text-white outline-none transition focus:border-cyan-300/60"
                >
                  {THEME_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1">
                <span className="block text-xs font-medium uppercase tracking-[0.12em] text-slate-400">
                  Scope
                </span>
                <select
                  value={scope}
                  onChange={(event) =>
                    setScope(event.target.value as (typeof SCOPE_OPTIONS)[number])
                  }
                  className="w-full rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 text-xs text-white outline-none transition focus:border-cyan-300/60"
                >
                  {SCOPE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1">
                <span className="block text-xs font-medium uppercase tracking-[0.12em] text-slate-400">
                  Party Type
                </span>
                <select
                  value={partyType}
                  onChange={(event) =>
                    setPartyType(event.target.value as (typeof PARTY_TYPE_OPTIONS)[number])
                  }
                  className="w-full rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 text-xs text-white outline-none transition focus:border-cyan-300/60"
                >
                  {PARTY_TYPE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1 sm:col-span-2">
                <span className="block text-xs font-medium uppercase tracking-[0.12em] text-slate-400">
                  Starting Hook
                </span>
                <select
                  value={startingHook}
                  onChange={(event) =>
                    setStartingHook(event.target.value as (typeof STARTING_HOOK_OPTIONS)[number])
                  }
                  className="w-full rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 text-xs text-white outline-none transition focus:border-cyan-300/60"
                >
                  {STARTING_HOOK_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1 sm:col-span-2">
                <span className="block text-xs font-medium uppercase tracking-[0.12em] text-slate-400">
                  Lines / Limits (Optional)
                </span>
                <textarea
                  value={linesLimits}
                  onChange={(event) => setLinesLimits(event.target.value)}
                  placeholder="Content boundaries or safety constraints."
                  className="min-h-[56px] w-full rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 text-xs text-white outline-none transition focus:border-cyan-300/60"
                />
              </label>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <label
              className="block text-sm font-medium text-slate-200"
              htmlFor="starting-scenario"
            >
              Starting scenario
            </label>
            <div className="flex items-center gap-2">
              <label
                className="text-xs font-medium uppercase tracking-[0.14em] text-slate-400"
                htmlFor="narration-level"
              >
                Narration
              </label>
              <select
                id="narration-level"
                value={narrationLevel}
                onChange={(event) =>
                  setNarrationLevel(event.target.value as NarrationLevel)
                }
                className="rounded-xl border border-white/10 bg-slate-950/80 px-2.5 py-1.5 text-xs text-white outline-none transition focus:border-cyan-300/60"
              >
                <option value="light">Light</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
          </div>
          <textarea
            id="starting-scenario"
            value={startingScenario}
            onChange={(event) => setStartingScenario(event.target.value)}
            placeholder="Describe the situation the party starts in."
            className="min-h-[74px] w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-2 text-xs text-white outline-none transition focus:border-cyan-300/60"
          />
          <p className="text-xs text-slate-400">
            This seeds the opening scenario scene.
          </p>
        </div>

        {selectedLibraryCharacter ? (
          <div className="rounded-2xl border border-cyan-300/20 bg-cyan-300/10 px-4 py-2.5">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100/80">
              Selected Character
            </div>
            <div className="mt-2 text-sm font-medium text-white">
              {selectedLibraryCharacter.name}
            </div>
            {selectedLibraryCharacter.memorySummary ? (
              <p
                className="mt-2 text-xs leading-6 text-cyan-50/85"
                style={{
                  display: "-webkit-box",
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {selectedLibraryCharacter.memorySummary}
              </p>
            ) : null}
          </div>
        ) : null}

        {!isLoadingLibraryCharacters && libraryCharacters.length > 1 ? (
          <div className="rounded-2xl border border-white/10 bg-black/20 p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-slate-200">
                  Starting companions (optional)
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  Import additional reusable characters now. You can still add or remove
                  characters later in the campaign.
                </p>
              </div>
              {selectedCompanionLibraryCharacterIds.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setSelectedCompanionLibraryCharacterIds([])}
                  className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-xs font-medium text-slate-200 transition hover:border-white/25 hover:text-white"
                >
                  Clear
                </button>
              ) : null}
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {libraryCharacters
                .filter((character) => character.id !== selectedLibraryCharacterId)
                .map((character) => {
                  const checked = selectedCompanionLibraryCharacterIds.includes(character.id);
                  return (
                    <label
                      key={character.id}
                      className={`flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2 text-xs transition ${
                        checked
                          ? "border-emerald-300/40 bg-emerald-300/10 text-emerald-50"
                          : "border-white/10 bg-slate-950/60 text-slate-200 hover:border-white/25"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleCompanionLibraryCharacterId(character.id)}
                        className="mt-0.5 h-4 w-4 rounded border-white/20 bg-slate-950 text-emerald-300"
                      />
                      <span className="leading-5">
                        {buildLibraryCharacterOptionLabel(character)}
                      </span>
                    </label>
                  );
                })}
            </div>

            {selectedCompanionCharacters.length > 0 ? (
              <div className="mt-3 rounded-xl border border-emerald-300/25 bg-emerald-300/10 px-3 py-2 text-xs text-emerald-100">
                Starting with companions:{" "}
                {selectedCompanionCharacters.map((character) => character.name).join(", ")}
              </div>
            ) : (
              <div className="mt-3 text-xs text-slate-500">
                No companions selected.
              </div>
            )}
          </div>
        ) : null}

        {error ? (
          <p className="rounded-2xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={!activeRuleset || !selectedLibraryCharacterId || isSubmitting}
          className="w-full rounded-2xl bg-gradient-to-r from-cyan-300 to-emerald-300 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? "Opening campaign..." : "Create Campaign"}
        </button>
      </form>
    </section>
  );
}

function buildLibraryCharacterOptionLabel(character: LibraryCharacter) {
  const summaryParts = getLibraryCharacterSummaryParts(character.sheetJson);

  return [character.name, ...summaryParts].filter(Boolean).join(" - ");
}

function getLibraryCharacterSummaryParts(
  sheetJson: Record<string, unknown> | null,
) {
  if (!sheetJson) {
    return [];
  }

  const role = getFirstStringValue(
    sheetJson,
    "class",
    "archetype",
    "framework",
    "school",
    "occupation",
    "clan",
    "role",
  );
  const ancestry = getFirstStringValue(
    sheetJson,
    "ancestry",
    "race",
    "heritage",
    "species",
    "kin",
    "lineage",
    "tribe",
  );
  const level = getLevelLikeValue(sheetJson);
  const ancestryBonusSummary = getDndAsiSummaryText(sheetJson);

  return [role, ancestry, level, ancestryBonusSummary].filter(Boolean);
}

function getFirstStringValue(
  sheetJson: Record<string, unknown>,
  ...keys: string[]
) {
  for (const key of keys) {
    const value = sheetJson[key];

    if (typeof value === "string" && value.trim() && value.trim() !== "None yet") {
      return value.trim();
    }
  }

  return "";
}

function getLevelLikeValue(sheetJson: Record<string, unknown>) {
  const level = sheetJson.level;

  if (typeof level === "number") {
    return `Lvl ${level}`;
  }

  if (typeof level === "string" && level.trim()) {
    return level.trim();
  }

  return getFirstStringValue(
    sheetJson,
    "rank",
    "tier",
    "circle",
    "generation",
  );
}
