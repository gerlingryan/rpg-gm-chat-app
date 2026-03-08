"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type CampaignListItem = {
  id: string;
  title: string;
  ruleset: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  characterCount: number;
};

type ConfirmationState = {
  campaign: CampaignListItem;
  title: string;
  message: string;
  confirmLabel: string;
};

export default function CampaignsPage() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<CampaignListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [deletingCampaignId, setDeletingCampaignId] = useState("");
  const [confirmationState, setConfirmationState] = useState<ConfirmationState | null>(null);

  useEffect(() => {
    async function loadCampaigns() {
      try {
        setError("");
        setIsLoading(true);

        const response = await fetch("/api/campaigns");
        const data = await response.json();

        if (!response.ok || !Array.isArray(data.campaigns)) {
          throw new Error(data.error ?? "Unable to load campaigns.");
        }

        setCampaigns(data.campaigns);
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load campaigns.",
        );
      } finally {
        setIsLoading(false);
      }
    }

    loadCampaigns();
  }, []);

  function handleDeleteCampaign(campaign: CampaignListItem) {
    if (deletingCampaignId) {
      return;
    }

    setConfirmationState({
      campaign,
      title: "Warning",
      message: `Delete ${campaign.title}? This will remove the campaign and all of its messages and characters.`,
      confirmLabel: "Delete",
    });
  }

  async function performDeleteCampaign(campaignId: string) {
    if (deletingCampaignId) {
      return;
    }

    setError("");
    setDeletingCampaignId(campaignId);

    try {
      const response = await fetch(`/api/campaigns/${campaignId}`, {
        method: "DELETE",
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Unable to delete campaign.");
      }

      setCampaigns((currentCampaigns) =>
        currentCampaigns.filter((campaign) => campaign.id !== campaignId),
      );
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Unable to delete campaign.",
      );
    } finally {
      setDeletingCampaignId("");
    }
  }

  async function handleConfirmDelete() {
    if (!confirmationState) {
      return;
    }

    const pendingConfirmation = confirmationState;
    setConfirmationState(null);
    await performDeleteCampaign(pendingConfirmation.campaign.id);
  }

  function formatTimestamp(value: string) {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(155,231,255,0.15),_transparent_35%),linear-gradient(135deg,_#08111f_0%,_#101b31_45%,_#170f22_100%)] px-4 py-8 text-slate-100 sm:px-6 lg:px-8">
      {confirmationState ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl">
            <div className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-200">
              {confirmationState.title}
            </div>
            <p className="mt-3 text-sm leading-6 text-zinc-200">
              {confirmationState.message}
            </p>
            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmationState(null)}
                className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm font-medium text-zinc-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="rounded-xl bg-red-300 px-4 py-2 text-sm font-medium text-zinc-950"
              >
                {confirmationState.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mx-auto max-w-6xl space-y-6">
        <section className="rounded-[2rem] border border-white/10 bg-slate-950/65 p-6 shadow-2xl shadow-black/40 backdrop-blur md:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-cyan-100">
                Campaign Archive
              </p>
              <h1 className="mt-2 text-3xl font-semibold text-white">
                All Campaigns
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300">
                Review every saved campaign, resume one, or remove old test runs.
              </p>
            </div>

            <Link
              href="/"
              className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-white/25 hover:text-white"
            >
              Back to Launcher
            </Link>
          </div>
        </section>

        <section className="rounded-[2rem] border border-white/10 bg-slate-900/80 p-6 shadow-2xl shadow-black/40 backdrop-blur md:p-8">
          {isLoading ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-5 text-sm text-slate-300">
              Loading campaigns...
            </div>
          ) : null}

          {!isLoading && error ? (
            <div className="rounded-2xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          ) : null}

          {!isLoading && !error && campaigns.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-5 text-sm text-slate-300">
              No saved campaigns yet.
            </div>
          ) : null}

          {!isLoading && campaigns.length > 0 ? (
            <div className="space-y-3">
              {campaigns.map((campaign) => {
                const isDeleting = deletingCampaignId === campaign.id;

                return (
                  <div
                    key={campaign.id}
                    className="rounded-2xl border border-white/10 bg-white/5 p-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h2 className="text-base font-semibold text-white">
                          {campaign.title}
                        </h2>
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
                          onClick={() => handleDeleteCampaign(campaign)}
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
              })}
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
