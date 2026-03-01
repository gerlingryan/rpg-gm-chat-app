"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getDefaultStartingScenario } from "@/lib/campaigns";

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

export default function Home() {
  const router = useRouter();
  const [campaignTitle, setCampaignTitle] = useState("");
  const [selectedRuleset, setSelectedRuleset] = useState<string>(
    RULESET_OPTIONS[0],
  );
  const [customRuleset, setCustomRuleset] = useState("");
  const [useCustomRuleset, setUseCustomRuleset] = useState(false);
  const [startingScenario, setStartingScenario] = useState(
    getDefaultStartingScenario(RULESET_OPTIONS[0]),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [recentCampaigns, setRecentCampaigns] = useState<RecentCampaign[]>([]);
  const [isLoadingCampaigns, setIsLoadingCampaigns] = useState(true);
  const [campaignListError, setCampaignListError] = useState("");
  const [deletingCampaignId, setDeletingCampaignId] = useState("");

  const activeRuleset = useMemo(() => {
    return useCustomRuleset ? customRuleset.trim() : selectedRuleset;
  }, [customRuleset, selectedRuleset, useCustomRuleset]);

  useEffect(() => {
    const scenarioRuleset = useCustomRuleset ? "Custom RPG" : selectedRuleset;
    setStartingScenario(getDefaultStartingScenario(scenarioRuleset));
  }, [selectedRuleset, useCustomRuleset]);

  useEffect(() => {
    async function loadRecentCampaigns() {
      try {
        setCampaignListError("");

        const response = await fetch("/api/campaigns");
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
      const response = await fetch("/api/campaigns", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: campaignTitle.trim(),
          ruleset,
          startingScenario: startingScenario.trim(),
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

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(155,231,255,0.15),_transparent_35%),linear-gradient(135deg,_#08111f_0%,_#101b31_45%,_#170f22_100%)] px-4 py-8 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-6xl gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-[2rem] border border-white/10 bg-slate-950/65 p-6 shadow-2xl shadow-black/40 backdrop-blur md:p-10">
          <div className="inline-flex rounded-full border border-cyan-300/30 bg-cyan-300/10 px-4 py-1 text-xs font-semibold uppercase tracking-[0.28em] text-cyan-100">
            Table Control
          </div>

          <h1 className="mt-6 max-w-xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            Launch a new campaign and hand the table to the GM.
          </h1>

          <p className="mt-5 max-w-2xl text-base leading-8 text-slate-300 sm:text-lg">
            Pick a supported ruleset, or define your own. The app will spin up
            a fresh session, establish the party, and drop the player into the
            opening scene.
          </p>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
              <div className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">
                Built For
              </div>
              <p className="mt-3 text-sm leading-7 text-slate-200">
                GM narration, party state, and character-driven responses inside
                a single campaign thread.
              </p>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
              <div className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">
                Launcher Mode
              </div>
              <p className="mt-3 text-sm leading-7 text-slate-200">
                Use a listed system for fast setup, or enter any custom ruleset
                the GM should follow.
              </p>
            </div>
          </div>

          <div className="mt-8 rounded-[1.75rem] border border-white/10 bg-black/20 p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">
                  Recent Campaigns
                </p>
                <p className="mt-2 text-sm text-slate-300">
                  Resume a prior session or clear out old test runs.
                </p>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {isLoadingCampaigns ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-5 text-sm text-slate-300">
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
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-5 text-sm text-slate-300">
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
                        className="rounded-2xl border border-white/10 bg-white/5 p-4"
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

                        <div className="mt-4 grid gap-2 text-xs uppercase tracking-[0.16em] text-slate-400 sm:grid-cols-3">
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

        <section className="rounded-[2rem] border border-white/10 bg-slate-900/80 p-6 shadow-2xl shadow-black/40 backdrop-blur md:p-8">
          <div className="mb-6">
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-amber-200/90">
              Campaign Launcher
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-white">
              Start a new table
            </h2>
          </div>

          <form className="space-y-6" onSubmit={handleSubmit}>
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
                className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/60"
              />
            </div>

            <div className="space-y-3">
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
                  className="min-h-28 w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/60"
                />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {RULESET_OPTIONS.map((ruleset) => {
                    const checked = selectedRuleset === ruleset;

                    return (
                      <label
                        key={ruleset}
                        className={`cursor-pointer rounded-2xl border p-4 text-sm transition ${
                          checked
                            ? "border-cyan-300/80 bg-cyan-300/10 text-white"
                            : "border-white/10 bg-slate-950/70 text-slate-300 hover:border-white/25 hover:text-white"
                        }`}
                      >
                        <input
                          type="radio"
                          name="ruleset"
                          value={ruleset}
                          checked={checked}
                          onChange={() => setSelectedRuleset(ruleset)}
                          className="sr-only"
                        />
                        {ruleset}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                Selected Ruleset
              </div>
              <div className="mt-2 text-sm text-slate-100">
                {activeRuleset || "Enter a ruleset to continue"}
              </div>
            </div>

            <div className="space-y-2">
              <label
                className="block text-sm font-medium text-slate-200"
                htmlFor="starting-scenario"
              >
                Starting scenario
              </label>
              <textarea
                id="starting-scenario"
                value={startingScenario}
                onChange={(event) => setStartingScenario(event.target.value)}
                placeholder="Describe the situation the party starts in."
                className="min-h-28 w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/60"
              />
              <p className="text-xs text-slate-400">
                This seeds the opening GM scene. Changing the ruleset resets the
                default scenario suggestion.
              </p>
            </div>

            {error ? (
              <p className="rounded-2xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={!activeRuleset || isSubmitting}
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
