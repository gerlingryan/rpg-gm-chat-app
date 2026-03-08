"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { getDefaultStartingScenario } from "@/lib/campaigns";
import { type NarrationLevel } from "@/lib/party";

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

type RecentCampaign = {
  id: string;
  title: string;
  ruleset: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  characterCount: number;
};

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

export default function Home() {
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
  const [narrationLevel, setNarrationLevel] = useState<NarrationLevel>("medium");
  const [selectedLibraryCharacterId, setSelectedLibraryCharacterId] = useState("");
  const [libraryCharacters, setLibraryCharacters] = useState<LibraryCharacter[]>([]);
  const [isLoadingLibraryCharacters, setIsLoadingLibraryCharacters] = useState(true);
  const [libraryError, setLibraryError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [recentCampaigns, setRecentCampaigns] = useState<RecentCampaign[]>([]);
  const [isLoadingCampaigns, setIsLoadingCampaigns] = useState(true);
  const [campaignListError, setCampaignListError] = useState("");
  const [deletingCampaignId, setDeletingCampaignId] = useState("");

  const activeRuleset = useMemo(() => {
    return useCustomRuleset ? customRuleset.trim() : selectedRuleset;
  }, [customRuleset, selectedRuleset, useCustomRuleset]);

  const selectedLibraryCharacter = libraryCharacters.find(
    (character) => character.id === selectedLibraryCharacterId,
  );

  useEffect(() => {
    const scenarioRuleset = useCustomRuleset ? "Custom RPG" : selectedRuleset;
    setStartingScenario(getDefaultStartingScenario(scenarioRuleset));
    setSelectedLibraryCharacterId("");
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
      requestedRuleset &&
      requestedRuleset.toLowerCase() === activeRuleset.toLowerCase() &&
      requestedLibraryCharacterId &&
      libraryCharacters.some((character) => character.id === requestedLibraryCharacterId)
    ) {
      setSelectedLibraryCharacterId(requestedLibraryCharacterId);
    }
  }, [activeRuleset, libraryCharacters, requestedRuleset, searchParams]);

  useEffect(() => {
    async function loadRecentCampaigns() {
      try {
        setCampaignListError("");

          const response = await fetch("/api/campaigns?limit=3");
        const data = await response.json();

        if (!response.ok || !Array.isArray(data.campaigns)) {
          throw new Error(data.error ?? "Unable to load recent campaigns.");
        }

        setRecentCampaigns(data.campaigns);
      } catch (loadError) {
        setCampaignListError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load recent campaigns.",
        );
      } finally {
        setIsLoadingCampaigns(false);
      }
    }

    loadRecentCampaigns();
  }, []);

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
          libraryCharacterId: selectedLibraryCharacterId,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.campaignId) {
        throw new Error(data.error ?? "Unable to create campaign.");
      }

      setRecentCampaigns((currentCampaigns) => [
        {
          id: data.campaignId,
          title: data.title ?? (campaignTitle.trim() || `${ruleset} Campaign`),
          ruleset,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          messageCount:
            typeof data.messageCount === "number" ? data.messageCount : 1,
          characterCount:
            typeof data.characterCount === "number" ? data.characterCount : 1,
        },
        ...currentCampaigns,
      ].slice(0, 8));

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

  async function handleDeleteCampaign(campaignId: string) {
    if (deletingCampaignId) {
      return;
    }

    setCampaignListError("");
    setDeletingCampaignId(campaignId);

    try {
      const response = await fetch(`/api/campaigns/${campaignId}`, {
        method: "DELETE",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Unable to delete campaign.");
      }

      setRecentCampaigns((currentCampaigns) =>
        currentCampaigns.filter((campaign) => campaign.id !== campaignId),
      );
    } catch (deleteError) {
      setCampaignListError(
        deleteError instanceof Error
          ? deleteError.message
          : "Unable to delete campaign.",
      );
    } finally {
      setDeletingCampaignId("");
    }
  }

  function formatTimestamp(value: string) {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  }

  function buildLibraryCharacterOptionLabel(character: LibraryCharacter) {
    const summaryParts = getLibraryCharacterSummaryParts(character.sheetJson);

    return [character.name, ...summaryParts].filter(Boolean).join(" - ");
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(155,231,255,0.15),_transparent_35%),linear-gradient(135deg,_#08111f_0%,_#101b31_45%,_#170f22_100%)] px-4 py-4 text-slate-100 sm:px-5 lg:px-6">
      <div className="mx-auto grid min-h-[calc(100vh-2rem)] max-w-6xl gap-4 lg:grid-cols-[1.08fr_0.92fr]">
        <section className="rounded-[2rem] border border-white/10 bg-slate-950/65 p-5 shadow-2xl shadow-black/40 backdrop-blur md:p-6">
          <h1 className="max-w-xl text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Launch a new campaign...
          </h1>

          <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
            Pick a supported ruleset, choose a reusable main character, and let
            the GM spin up a fresh scene around them.
          </p>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="rounded-3xl border border-white/10 bg-white/5 p-3.5">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                Built For
              </div>
              <p className="mt-1.5 text-xs leading-5 text-slate-200">
                GM narration, party state, and character-driven responses inside
                a single campaign thread.
              </p>
            </div>

            <Link
              href={`/characters?ruleset=${encodeURIComponent(activeRuleset || "")}&returnTo=%2F`}
              className="block rounded-3xl border border-cyan-300/25 bg-[linear-gradient(135deg,rgba(34,211,238,0.12),rgba(8,47,73,0.22))] p-3.5 transition hover:border-cyan-300/45 hover:bg-[linear-gradient(135deg,rgba(34,211,238,0.16),rgba(8,47,73,0.28))]"
            >
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100/90">
                Character Library
              </div>
              <p className="mt-1.5 text-xs leading-5 text-cyan-50/90">
                Create reusable heroes separately, then import them into new
                campaigns as clean copies.
              </p>
            </Link>
          </div>

          <div className="mt-5 rounded-[1.75rem] border border-white/10 bg-black/20 p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">
                    Recent Campaigns
                  </p>
                  <p className="mt-1.5 text-sm text-slate-300">
                    Resume a prior session or clear out old test runs.
                  </p>
                </div>

                <Link
                  href="/campaigns"
                  className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-white/25 hover:text-white"
                >
                  View all
                </Link>
              </div>

            <div className="mt-4 space-y-2.5">
              {isLoadingCampaigns ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sm text-slate-300">
                  Loading recent campaigns...
                </div>
              ) : null}

              {!isLoadingCampaigns && campaignListError ? (
                <div className="rounded-2xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">
                  {campaignListError}
                </div>
              ) : null}

              {!isLoadingCampaigns &&
              !campaignListError &&
              recentCampaigns.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sm text-slate-300">
                  No saved campaigns yet. Create one to start building your
                  table history.
                </div>
              ) : null}

              {!isLoadingCampaigns && recentCampaigns.length > 0
                ? recentCampaigns.map((campaign) => {
                    const isDeleting = deletingCampaignId === campaign.id;

                    return (
                      <div
                        key={campaign.id}
                        className="rounded-2xl border border-white/10 bg-white/5 p-3.5"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <h3 className="text-base font-semibold text-white">
                              {campaign.title}
                            </h3>
                            <p className="mt-1 text-sm text-cyan-100">
                              {campaign.ruleset}
                            </p>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => router.push(`/campaign/${campaign.id}`)}
                              className="rounded-xl border border-cyan-300/40 bg-cyan-300/10 px-3 py-2 text-sm font-medium text-cyan-100 transition hover:border-cyan-300/70 hover:text-white"
                            >
                              Resume
                            </button>

                            <button
                              type="button"
                              disabled={isDeleting}
                              onClick={() => handleDeleteCampaign(campaign.id)}
                              className="rounded-xl border border-rose-300/30 bg-rose-300/10 px-3 py-2 text-sm font-medium text-rose-100 transition hover:border-rose-300/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {isDeleting ? "Deleting..." : "Delete"}
                            </button>
                          </div>
                        </div>

                        <div className="mt-3 grid gap-1.5 text-[11px] uppercase tracking-[0.14em] text-slate-400 sm:grid-cols-3">
                          <span>{campaign.characterCount} characters</span>
                          <span>{campaign.messageCount} messages</span>
                          <span>Updated {formatTimestamp(campaign.updatedAt)}</span>
                        </div>
                      </div>
                    );
                  })
                : null}
            </div>
          </div>
        </section>

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
                    href={`/characters?ruleset=${encodeURIComponent(activeRuleset || "")}&returnTo=%2F`}
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
      </div>
    </main>
  );
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

  return [role, ancestry, level].filter(Boolean);
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
