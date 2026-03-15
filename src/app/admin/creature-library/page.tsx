"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type CreatureLibraryEntry = {
  id: string;
  ruleset: string;
  source: string;
  sourceId: string;
  slug: string;
  name: string;
  creatureType: string | null;
  subtype: string | null;
  size: string | null;
  cr: string | null;
  xpDerived: number | null;
  hasToken?: boolean;
  updatedAt: string;
};

type ImportSummary = {
  ruleset: string;
  source: string;
  totalMonsters: number;
  upserted: number;
  skipped: number;
  failed: number;
  failures?: Array<{ key: string; reason: string }>;
};

export default function CreatureLibraryAdminPage() {
  const [entries, setEntries] = useState<CreatureLibraryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [generatingNext, setGeneratingNext] = useState(false);
  const [isBatchGenerating, setIsBatchGenerating] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [rulesetFilter, setRulesetFilter] = useState("D&D 5e");
  const [typeFilter, setTypeFilter] = useState("");
  const [nameFilter, setNameFilter] = useState("");
  const [needsTokenOnly, setNeedsTokenOnly] = useState(true);
  const [tokenStyle, setTokenStyle] = useState("stone-base");
  const [filePath, setFilePath] = useState("e:\\monster_library\\monsters_wotc_srd.json");

  const filteredEntries = useMemo(() => {
    const text = nameFilter.trim().toLowerCase();
    if (!text) {
      return entries;
    }
    return entries.filter((entry) => {
      const hay = `${entry.name} ${entry.slug} ${entry.creatureType ?? ""} ${entry.subtype ?? ""}`
        .toLowerCase()
        .trim();
      return hay.includes(text);
    });
  }, [entries, nameFilter]);

  async function loadEntries() {
    setLoading(true);
    setErrorMessage("");
    try {
      const params = new URLSearchParams();
      if (rulesetFilter.trim()) {
        params.set("ruleset", rulesetFilter.trim());
      }
      if (typeFilter.trim()) {
        params.set("creatureType", typeFilter.trim());
      }
      params.set("needsTokenOnly", needsTokenOnly ? "true" : "false");
      params.set("limit", "1000");
      const response = await fetch(`/api/admin/creature-library?${params.toString()}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        entries?: CreatureLibraryEntry[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load creature library.");
      }
      setEntries(Array.isArray(payload.entries) ? payload.entries : []);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to load creature library.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rulesetFilter, typeFilter, needsTokenOnly]);

  async function handleImportOpen5e() {
    setImporting(true);
    setErrorMessage("");
    setSuccessMessage("");
    setSummary(null);
    try {
      const response = await fetch("/api/admin/creature-library", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "import-open5e",
          filePath,
          ruleset: rulesetFilter || "D&D 5e",
          source: "open5e",
        }),
      });
      const payload = (await response.json()) as {
        summary?: ImportSummary;
        error?: string;
      };
      if (!response.ok || !payload.summary) {
        throw new Error(payload.error ?? "Import failed.");
      }
      setSummary(payload.summary);
      setSuccessMessage(
        `Import complete. Upserted ${payload.summary.upserted}/${payload.summary.totalMonsters}.`,
      );
      await loadEntries();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  }

  type GenerateNextPayload = {
    generated?: boolean;
    reason?: string;
    creature?: CreatureLibraryEntry;
    cacheHit?: boolean;
    queue?: {
      totalCandidates?: number;
      unboundCandidates?: number;
    };
    error?: string;
  };

  async function generateSingleNextToken() {
    const response = await fetch("/api/admin/creature-library", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "generate-next-token",
        ruleset: rulesetFilter || "D&D 5e",
        style: tokenStyle,
      }),
    });
    const payload = (await response.json()) as GenerateNextPayload;
    if (!response.ok) {
      throw new Error(payload.error ?? "Unable to generate token.");
    }
    return payload;
  }

  async function handleGenerateNextToken() {
    setGeneratingNext(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const payload = await generateSingleNextToken();
      if (!payload.generated) {
        setSuccessMessage(
          `${payload.reason ?? "No remaining creatures need a token."} ${
            payload.queue
              ? `(Candidates: ${payload.queue.totalCandidates ?? 0}, Unbound: ${payload.queue.unboundCandidates ?? 0})`
              : ""
          }`,
        );
      } else {
        setSuccessMessage(
          `${payload.cacheHit ? "Reused token for" : "Generated token for"} ${payload.creature?.name ?? "creature"}.${
            payload.queue
              ? ` Remaining unbound in scope: ${Math.max(0, (payload.queue.unboundCandidates ?? 1) - 1)}`
              : ""
          }`,
        );
      }
      await loadEntries();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to generate token.");
    } finally {
      setGeneratingNext(false);
    }
  }

  async function handleGenerateBatch(count: number) {
    if (count <= 0) {
      return;
    }
    setIsBatchGenerating(true);
    setErrorMessage("");
    setSuccessMessage("");
    let generatedCount = 0;
    let cacheHitCount = 0;
    let lastQueueUnbound = 0;
    try {
      for (let index = 0; index < count; index += 1) {
        setSuccessMessage(`Generating ${index + 1}/${count}...`);
        const payload = await generateSingleNextToken();
        if (!payload.generated) {
          lastQueueUnbound = payload.queue?.unboundCandidates ?? 0;
          setSuccessMessage(
            `Batch stopped after ${generatedCount}/${count}. ${payload.reason ?? "No remaining creatures need a token."} (Unbound: ${lastQueueUnbound})`,
          );
          break;
        }
        generatedCount += 1;
        if (payload.cacheHit) {
          cacheHitCount += 1;
        }
        lastQueueUnbound = payload.queue?.unboundCandidates ?? lastQueueUnbound;
      }
      if (generatedCount === count) {
        setSuccessMessage(
          `Batch complete: generated ${generatedCount}/${count} tokens (${cacheHitCount} cache hits). Estimated remaining unbound: ${Math.max(0, lastQueueUnbound - 1)}.`,
        );
      }
      await loadEntries();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? `Batch stopped after ${generatedCount}/${count}. ${error.message}`
          : `Batch stopped after ${generatedCount}/${count}.`,
      );
    } finally {
      setIsBatchGenerating(false);
    }
  }

  return (
    <main className="min-h-screen bg-zinc-950 p-5 text-zinc-100">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Creature Library</h1>
            <p className="text-sm text-zinc-400">
              Import and manage canonical creature data for encounter generation and token binding.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/admin/token-library"
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 hover:border-zinc-500"
            >
              Token Library
            </Link>
            <Link
              href="/admin/battle-maps"
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 hover:border-zinc-500"
            >
              Battle Maps
            </Link>
            <Link
              href="/"
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 hover:border-zinc-500"
            >
              Back to Launcher
            </Link>
          </div>
        </div>

        {errorMessage ? (
          <div className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {errorMessage}
          </div>
        ) : null}
        {successMessage ? (
          <div className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
            {successMessage}
          </div>
        ) : null}

        <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_180px_180px_160px_auto_auto]">
            <label className="text-xs text-zinc-300">
              Open5e JSON file path
              <input
                value={filePath}
                onChange={(event) => setFilePath(event.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-xs text-zinc-200 outline-none focus:border-zinc-500"
              />
            </label>
            <label className="text-xs text-zinc-300">
              Ruleset
              <input
                value={rulesetFilter}
                onChange={(event) => setRulesetFilter(event.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-xs text-zinc-200 outline-none focus:border-zinc-500"
              />
            </label>
            <label className="text-xs text-zinc-300">
              Type filter
              <input
                value={typeFilter}
                onChange={(event) => setTypeFilter(event.target.value)}
                placeholder="e.g. humanoid"
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-xs text-zinc-200 outline-none focus:border-zinc-500"
              />
            </label>
            <label className="text-xs text-zinc-300">
              Token style
              <select
                value={tokenStyle}
                onChange={(event) => setTokenStyle(event.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-xs text-zinc-200 outline-none focus:border-zinc-500"
              >
                <option value="stone-base">Stone Base</option>
                <option value="no-scenic-base">No Base / Invisible Base</option>
                <option value="grass-base">Grass Base</option>
                <option value="dirt-base">Dirt Base</option>
              </select>
            </label>
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => void handleImportOpen5e()}
                disabled={importing}
                className="w-full rounded-lg border border-cyan-400/40 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-100 hover:border-cyan-300/70 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {importing ? "Importing..." : "Import Open5e"}
              </button>
            </div>
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => void handleGenerateNextToken()}
                disabled={generatingNext || isBatchGenerating}
                className="w-full rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100 hover:border-emerald-300/70 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {generatingNext ? "Generating..." : "Generate Next Token"}
              </button>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleGenerateBatch(10)}
              disabled={generatingNext || isBatchGenerating}
              className="rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-100 hover:border-emerald-300/70 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isBatchGenerating ? "Generating..." : "Generate Next 10"}
            </button>
            <button
              type="button"
              onClick={() => void handleGenerateBatch(100)}
              disabled={generatingNext || isBatchGenerating}
              className="rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-100 hover:border-emerald-300/70 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isBatchGenerating ? "Generating..." : "Generate Next 100"}
            </button>
          </div>
          <label className="mt-2 inline-flex items-center gap-2 text-xs text-zinc-300">
            <input
              type="checkbox"
              checked={needsTokenOnly}
              onChange={(event) => setNeedsTokenOnly(event.target.checked)}
            />
            Show only creatures missing tokens
          </label>
          <div className="mt-1 text-[11px] text-zinc-500">
            Generate Next Token follows ruleset only; it ignores type/search filters.
          </div>
          {summary ? (
            <div className="mt-2 text-xs text-zinc-300">
              Imported: {summary.upserted} | Skipped: {summary.skipped} | Failed: {summary.failed} | Total:{" "}
              {summary.totalMonsters}
            </div>
          ) : null}
        </section>

        <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm text-zinc-300">Entries: {filteredEntries.length}</div>
            <input
              value={nameFilter}
              onChange={(event) => setNameFilter(event.target.value)}
              placeholder="Search name/slug/type"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-xs text-zinc-200 outline-none focus:border-zinc-500 md:w-72"
            />
          </div>
          {loading ? (
            <div className="text-sm text-zinc-400">Loading creature library...</div>
          ) : (
            <div className="max-h-[64vh] overflow-auto rounded-lg border border-zinc-800">
              <table className="min-w-full border-collapse text-left text-xs">
                <thead className="sticky top-0 bg-zinc-950 text-zinc-400">
                  <tr>
                    <th className="border-b border-zinc-800 px-2 py-2">Name</th>
                    <th className="border-b border-zinc-800 px-2 py-2">Slug</th>
                    <th className="border-b border-zinc-800 px-2 py-2">Type</th>
                    <th className="border-b border-zinc-800 px-2 py-2">Size</th>
                    <th className="border-b border-zinc-800 px-2 py-2">CR</th>
                    <th className="border-b border-zinc-800 px-2 py-2">XP</th>
                    <th className="border-b border-zinc-800 px-2 py-2">Token</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries.map((entry) => (
                    <tr key={entry.id} className="odd:bg-zinc-900/50">
                      <td className="border-b border-zinc-800 px-2 py-1.5 text-zinc-100">
                        {entry.name}
                      </td>
                      <td className="border-b border-zinc-800 px-2 py-1.5 text-zinc-300">
                        {entry.slug}
                      </td>
                      <td className="border-b border-zinc-800 px-2 py-1.5 text-zinc-300">
                        {entry.creatureType ?? "-"}
                      </td>
                      <td className="border-b border-zinc-800 px-2 py-1.5 text-zinc-300">
                        {entry.size ?? "-"}
                      </td>
                      <td className="border-b border-zinc-800 px-2 py-1.5 text-zinc-300">
                        {entry.cr ?? "-"}
                      </td>
                      <td className="border-b border-zinc-800 px-2 py-1.5 text-zinc-300">
                        {entry.xpDerived ?? "-"}
                      </td>
                      <td className="border-b border-zinc-800 px-2 py-1.5 text-zinc-300">
                        {entry.hasToken ? "Yes" : "No"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
