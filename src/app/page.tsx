"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

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
  const [recentCampaigns, setRecentCampaigns] = useState<RecentCampaign[]>([]);
  const [isLoadingCampaigns, setIsLoadingCampaigns] = useState(true);
  const [campaignListError, setCampaignListError] = useState("");
  const [deletingCampaignId, setDeletingCampaignId] = useState("");

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
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(155,231,255,0.15),_transparent_35%),linear-gradient(135deg,_#08111f_0%,_#101b31_45%,_#170f22_100%)] px-4 py-4 text-slate-100 sm:px-5 lg:px-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <section className="rounded-[2rem] border border-white/10 bg-slate-950/65 p-5 shadow-2xl shadow-black/40 backdrop-blur md:p-6">
          <h1 className="max-w-xl text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Campaign Dashboard
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
            Jump back into recent adventures, start a new campaign, or manage reusable characters.
          </p>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <Link
              href="/campaigns/new"
              className="block rounded-3xl border border-emerald-300/25 bg-[linear-gradient(135deg,rgba(16,185,129,0.16),rgba(6,78,59,0.28))] p-3.5 transition hover:border-emerald-300/45 hover:bg-[linear-gradient(135deg,rgba(16,185,129,0.2),rgba(6,78,59,0.34))]"
            >
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-100/90">
                New Campaign
              </div>
              <p className="mt-1.5 text-xs leading-5 text-emerald-50/90">
                Open dedicated setup flow and launch a fresh adventure.
              </p>
            </Link>

            <Link
              href="/characters?returnTo=%2F"
              className="block rounded-3xl border border-cyan-300/25 bg-[linear-gradient(135deg,rgba(34,211,238,0.12),rgba(8,47,73,0.22))] p-3.5 transition hover:border-cyan-300/45 hover:bg-[linear-gradient(135deg,rgba(34,211,238,0.16),rgba(8,47,73,0.28))]"
            >
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100/90">
                Character Library
              </div>
              <p className="mt-1.5 text-xs leading-5 text-cyan-50/90">
                Build and manage reusable characters for your campaigns.
              </p>
            </Link>
          </div>
        </section>

        <section className="rounded-[1.75rem] border border-white/10 bg-black/20 p-4">
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
                <p>No saved campaigns yet.</p>
                <Link
                  href="/campaigns/new"
                  className="mt-3 inline-flex rounded-xl border border-emerald-300/40 bg-emerald-300/10 px-3 py-2 text-sm font-medium text-emerald-100 transition hover:border-emerald-300/70 hover:text-white"
                >
                  Create your first campaign
                </Link>
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
        </section>
      </div>
    </main>
  );
}
