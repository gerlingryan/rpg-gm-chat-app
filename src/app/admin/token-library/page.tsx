"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { getSceneImageInstructionTemplate } from "@/lib/map-prompt";

type TokenLibraryEntry = {
  id: string;
  entityType: "character" | "enemy";
  ruleset: string;
  category: string;
  subtype: string | null;
  normalizedKey: string;
  label: string;
  style: string;
  imageDataUrl: string;
  sourcePrompt: string | null;
  approved: boolean;
  createdAt: string;
  updatedAt: string;
};

const TOKEN_STYLE_OPTIONS = [
  { id: "stone-base", label: "Stone Base" },
  { id: "no-scenic-base", label: "No Base / Invisible Base" },
  { id: "grass-base", label: "Grass Base" },
  { id: "dirt-base", label: "Dirt Base" },
] as const;

export default function TokenLibraryAdminPage() {
  const [entries, setEntries] = useState<TokenLibraryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [approvingAll, setApprovingAll] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [rulesetFilter, setRulesetFilter] = useState("");
  const [entityTypeFilter, setEntityTypeFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);

  const [entityType, setEntityType] = useState<"character" | "enemy">("enemy");
  const [ruleset, setRuleset] = useState("D&D 5e");
  const [category, setCategory] = useState("Goblin");
  const [subtype, setSubtype] = useState("Slinger");
  const [label, setLabel] = useState("");
  const [physicalDescription, setPhysicalDescription] = useState("");
  const [style, setStyle] = useState<(typeof TOKEN_STYLE_OPTIONS)[number]["id"]>("stone-base");
  const [forceRegenerate, setForceRegenerate] = useState(false);
  const [editingEntryId, setEditingEntryId] = useState("");
  const [editLabel, setEditLabel] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editSubtype, setEditSubtype] = useState("");
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [expandedTokenPreview, setExpandedTokenPreview] = useState<{
    src: string;
    alt: string;
  } | null>(null);

  const categoryFilterOptions = useMemo(
    () =>
      availableCategories.slice().sort((left, right) =>
        left.localeCompare(right, undefined, { sensitivity: "base" }),
      ),
    [availableCategories],
  );

  const generatedPromptPreview = useMemo(() => {
    const instructions = getSceneImageInstructionTemplate("character-token", ruleset);
    const customDescription = `Entity name: ${label || "Unnamed"}. Physical description: ${
      physicalDescription || "Not provided."
    }. Category: ${category || "general"}. Subtype: ${subtype || "base"}. Footprint: 1x1 tile.`;
    const styleLine = TOKEN_STYLE_OPTIONS.find((entry) => entry.id === style)?.label ?? style;
    return [instructions, customDescription, `Style preset: ${styleLine}.`]
      .filter(Boolean)
      .join("\n\n");
  }, [category, label, physicalDescription, ruleset, style, subtype]);

  async function loadEntries() {
    setLoading(true);
    setErrorMessage("");
    try {
      const params = new URLSearchParams();
      if (rulesetFilter.trim()) {
        params.set("ruleset", rulesetFilter.trim());
      }
      if (entityTypeFilter.trim()) {
        params.set("entityType", entityTypeFilter.trim());
      }
      if (categoryFilter.trim()) {
        params.set("category", categoryFilter.trim());
      }
      params.set("limit", "200");
      const response = await fetch(`/api/admin/token-library?${params.toString()}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        entries?: TokenLibraryEntry[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load token library.");
      }
      const nextEntries = Array.isArray(payload.entries) ? payload.entries : [];
      setEntries(nextEntries);
      setAvailableCategories((current) => {
        const merged = new Set(current);
        for (const entry of nextEntries) {
          const normalized = entry.category?.trim();
          if (normalized) {
            merged.add(normalized);
          }
        }
        return Array.from(merged);
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to load token library.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rulesetFilter, entityTypeFilter, categoryFilter]);

  useEffect(() => {
    setAvailableCategories([]);
  }, [rulesetFilter, entityTypeFilter]);

  async function handleGenerateToken() {
    setGenerating(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      if (!label.trim()) {
        throw new Error("Name is required.");
      }
      if (!physicalDescription.trim()) {
        throw new Error("Physical description is required.");
      }
      const customDescription = `Entity name: ${label.trim()}. Physical description: ${physicalDescription.trim()}. Category: ${
        category.trim() || "general"
      }. Subtype: ${subtype.trim() || "base"}. Footprint: 1x1 tile.`;
      const response = await fetch("/api/admin/token-library/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityType,
          ruleset,
          category,
          subtype,
          label,
          style,
          customDescription,
          forceRegenerate,
        }),
      });
      const payload = (await response.json()) as {
        entry?: TokenLibraryEntry;
        cacheHit?: boolean;
        error?: string;
      };
      if (!response.ok || !payload.entry) {
        throw new Error(payload.error ?? "Unable to generate token.");
      }
      setSuccessMessage(
        payload.cacheHit
          ? "Cache hit: existing token reused."
          : "Token generated and stored.",
      );
      await loadEntries();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to generate token.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleToggleApproved(entry: TokenLibraryEntry) {
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const response = await fetch(`/api/admin/token-library/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved: !entry.approved }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to update token.");
      }
      await loadEntries();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to update token.");
    }
  }

  function startEditing(entry: TokenLibraryEntry) {
    setEditingEntryId(entry.id);
    setEditLabel(entry.label);
    setEditCategory(entry.category);
    setEditSubtype(entry.subtype ?? "");
    setErrorMessage("");
    setSuccessMessage("");
  }

  function cancelEditing() {
    setEditingEntryId("");
    setEditLabel("");
    setEditCategory("");
    setEditSubtype("");
  }

  async function handleSaveEdit(entry: TokenLibraryEntry) {
    setErrorMessage("");
    setSuccessMessage("");
    setIsSavingEdit(true);
    try {
      const payload = {
        label: editLabel.trim(),
        category: editCategory.trim(),
        subtype: editSubtype.trim() || null,
      };

      if (!payload.label) {
        throw new Error("Name cannot be empty.");
      }
      if (!payload.category) {
        throw new Error("Category cannot be empty.");
      }

      const response = await fetch(`/api/admin/token-library/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(result.error ?? "Unable to update token.");
      }

      setSuccessMessage("Token metadata updated.");
      cancelEditing();
      await loadEntries();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to update token.");
    } finally {
      setIsSavingEdit(false);
    }
  }

  async function handleDelete(entry: TokenLibraryEntry) {
    if (!window.confirm(`Delete token "${entry.label}"?`)) {
      return;
    }
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const response = await fetch(`/api/admin/token-library/${entry.id}`, {
        method: "DELETE",
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to delete token.");
      }
      await loadEntries();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to delete token.");
    }
  }

  async function handleApproveAll() {
    setErrorMessage("");
    setSuccessMessage("");
    setApprovingAll(true);
    try {
      const pending = entries.filter((entry) => !entry.approved);
      if (pending.length === 0) {
        setSuccessMessage("All currently loaded tokens are already approved.");
        return;
      }
      let approvedCount = 0;
      for (let index = 0; index < pending.length; index += 1) {
        setSuccessMessage(`Approving ${index + 1}/${pending.length}...`);
        const entry = pending[index];
        const response = await fetch(`/api/admin/token-library/${entry.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ approved: true }),
        });
        const payload = (await response.json()) as { error?: string };
        if (!response.ok) {
          throw new Error(payload.error ?? `Unable to approve token "${entry.label}".`);
        }
        approvedCount += 1;
      }
      setSuccessMessage(`Approved ${approvedCount} token${approvedCount === 1 ? "" : "s"}.`);
      await loadEntries();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to approve all tokens.");
    } finally {
      setApprovingAll(false);
    }
  }

  return (
    <main className="min-h-screen bg-zinc-950 p-4 text-zinc-100 md:p-5">
      <div className="mx-auto flex w-full max-w-[95rem] flex-col gap-4">
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-3 shadow">
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-400">Admin</p>
            <h1 className="text-lg font-semibold text-zinc-100">Token Library</h1>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/admin/battle-maps"
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 transition hover:border-zinc-500"
            >
              Battle Maps
            </Link>
            <Link
              href="/"
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 transition hover:border-zinc-500"
            >
              Launch
            </Link>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-3 shadow">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
              Generate Token
            </div>

            <div className="mt-2 space-y-2">
              <label className="text-xs text-zinc-300">
                Entity Type
                <select
                  value={entityType}
                  onChange={(event) =>
                    setEntityType(event.target.value === "character" ? "character" : "enemy")
                  }
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-xs text-zinc-200 outline-none focus:border-zinc-500"
                >
                  <option value="enemy">Enemy</option>
                  <option value="character">Character</option>
                </select>
              </label>
              <label className="text-xs text-zinc-300">
                Ruleset
                <input
                  value={ruleset}
                  onChange={(event) => setRuleset(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-xs text-zinc-200 outline-none focus:border-zinc-500"
                />
              </label>
              <label className="text-xs text-zinc-300">
                Category
                <input
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                  placeholder="Goblin / Human / Beast"
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-xs text-zinc-200 outline-none focus:border-zinc-500"
                />
              </label>
              <label className="text-xs text-zinc-300">
                Subtype
                <input
                  value={subtype}
                  onChange={(event) => setSubtype(event.target.value)}
                  placeholder="Slinger / Guard / Wolf"
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-xs text-zinc-200 outline-none focus:border-zinc-500"
                />
              </label>
              <label className="text-xs text-zinc-300">
                Name
                <input
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder="Creature name"
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-xs text-zinc-200 outline-none focus:border-zinc-500"
                />
              </label>
              <label className="text-xs text-zinc-300">
                Style
                <select
                  value={style}
                  onChange={(event) =>
                    setStyle(
                      (TOKEN_STYLE_OPTIONS.find((entry) => entry.id === event.target.value)?.id ??
                        "stone-base") as (typeof TOKEN_STYLE_OPTIONS)[number]["id"],
                    )
                  }
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-xs text-zinc-200 outline-none focus:border-zinc-500"
                >
                  {TOKEN_STYLE_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-zinc-300">
                Footprint
                <input
                  value="1x1 (MVP)"
                  readOnly
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-xs text-zinc-400"
                />
              </label>
              <label className="text-xs text-zinc-300">
                Physical Description
                <textarea
                  value={physicalDescription}
                  onChange={(event) => setPhysicalDescription(event.target.value)}
                  rows={5}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-xs text-zinc-200 outline-none focus:border-zinc-500"
                />
              </label>
              <label className="inline-flex items-center gap-2 text-xs text-zinc-300">
                <input
                  type="checkbox"
                  checked={forceRegenerate}
                  onChange={(event) => setForceRegenerate(event.target.checked)}
                />
                Force regenerate (ignore cache)
              </label>
              <button
                type="button"
                onClick={() => void handleGenerateToken()}
                disabled={generating}
                className="w-full rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-2 text-xs font-medium text-emerald-200 transition hover:border-emerald-400/70 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {generating ? "Generating..." : "Generate Token"}
              </button>
            </div>
          </section>

          <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-3 shadow">
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-xs text-zinc-300">
                Ruleset Filter
                <input
                  value={rulesetFilter}
                  onChange={(event) => setRulesetFilter(event.target.value)}
                  className="mt-1 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-zinc-500"
                />
              </label>
              <label className="text-xs text-zinc-300">
                Entity Filter
                <select
                  value={entityTypeFilter}
                  onChange={(event) => setEntityTypeFilter(event.target.value)}
                  className="mt-1 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-zinc-500"
                >
                  <option value="">All</option>
                  <option value="enemy">Enemy</option>
                  <option value="character">Character</option>
                </select>
              </label>
              <label className="text-xs text-zinc-300">
                Category Filter
                <select
                  value={categoryFilter}
                  onChange={(event) => setCategoryFilter(event.target.value)}
                  className="mt-1 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-zinc-500"
                >
                  <option value="">All</option>
                  {categoryFilterOptions.map((categoryOption) => (
                    <option key={categoryOption} value={categoryOption}>
                      {categoryOption}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => void handleApproveAll()}
                disabled={approvingAll || loading}
                className="rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-200 transition hover:border-emerald-400/70 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {approvingAll ? "Approving..." : "Approve All"}
              </button>
            </div>

            {errorMessage ? (
              <div className="mt-2 rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-2 text-xs text-red-200">
                {errorMessage}
              </div>
            ) : null}
            {successMessage ? (
              <div className="mt-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-2 text-xs text-emerald-200">
                {successMessage}
              </div>
            ) : null}

            <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
              {loading ? (
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-400">
                  Loading token library...
                </div>
              ) : entries.length === 0 ? (
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-400">
                  No token entries found.
                </div>
              ) : (
                entries.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-xl border border-zinc-800 bg-zinc-950 p-2"
                  >
                    <div className="relative overflow-hidden rounded-lg border border-zinc-800/70 bg-zinc-900">
                      <Image
                        src={entry.imageDataUrl}
                        alt={`${entry.label} token`}
                        width={768}
                        height={768}
                        unoptimized
                        className="h-44 w-full object-contain"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedTokenPreview({
                            src: entry.imageDataUrl,
                            alt: `${entry.label} token`,
                          })
                        }
                        className="absolute bottom-1.5 right-1.5 rounded-md border border-zinc-500/80 bg-zinc-950/80 px-1.5 py-1 text-[10px] text-zinc-100 hover:border-zinc-300"
                        title="Expand token image"
                        aria-label="Expand token image"
                      >
                        ⤢
                      </button>
                    </div>
                    {editingEntryId === entry.id ? (
                      <div className="mt-2 space-y-2">
                        <label className="block text-[11px] text-zinc-300">
                          Name
                          <input
                            value={editLabel}
                            onChange={(event) => setEditLabel(event.target.value)}
                            className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-200 outline-none focus:border-zinc-500"
                          />
                        </label>
                        <label className="block text-[11px] text-zinc-300">
                          Category
                          <input
                            value={editCategory}
                            onChange={(event) => setEditCategory(event.target.value)}
                            className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-200 outline-none focus:border-zinc-500"
                          />
                        </label>
                        <label className="block text-[11px] text-zinc-300">
                          Subtype
                          <input
                            value={editSubtype}
                            onChange={(event) => setEditSubtype(event.target.value)}
                            placeholder="Optional"
                            className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-200 outline-none focus:border-zinc-500"
                          />
                        </label>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => void handleSaveEdit(entry)}
                            disabled={isSavingEdit}
                            className="rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2 py-1 text-[11px] text-emerald-200 transition hover:border-emerald-400/70 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {isSavingEdit ? "Saving..." : "Save"}
                          </button>
                          <button
                            type="button"
                            onClick={cancelEditing}
                            disabled={isSavingEdit}
                            className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-200 transition hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="mt-2 text-xs font-medium text-zinc-100">{entry.label}</div>
                        <div className="mt-1 text-[11px] text-zinc-400">
                          {entry.ruleset} | {entry.entityType} | {entry.category}
                          {entry.subtype ? `/${entry.subtype}` : ""} | {entry.style}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => startEditing(entry)}
                            className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-200 transition hover:border-zinc-500"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleToggleApproved(entry)}
                            className={`rounded-md border px-2 py-1 text-[11px] transition ${
                              entry.approved
                                ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-200"
                                : "border-zinc-700 bg-zinc-900 text-zinc-200 hover:border-zinc-500"
                            }`}
                          >
                            {entry.approved ? "Approved" : "Approve"}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDelete(entry)}
                            className="rounded-md border border-red-500/40 bg-red-500/15 px-2 py-1 text-[11px] text-red-200 transition hover:border-red-400/70"
                          >
                            Delete
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-3 shadow">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
            Prompt Preview
          </div>
          <pre className="mt-2 max-h-56 overflow-auto rounded-lg border border-zinc-800 bg-zinc-950 p-2 text-[11px] leading-5 text-zinc-300">
            {generatedPromptPreview}
          </pre>
        </section>
      </div>

      {expandedTokenPreview ? (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/85 p-4">
          <button
            type="button"
            aria-label="Close token preview"
            className="absolute right-4 top-4 rounded-lg border border-zinc-400/70 bg-zinc-900/90 px-3 py-1.5 text-xs text-zinc-100 hover:border-zinc-200"
            onClick={() => setExpandedTokenPreview(null)}
          >
            Close
          </button>
          <div className="relative h-[90vh] w-[90vw] max-w-[1200px]">
            <Image
              src={expandedTokenPreview.src}
              alt={expandedTokenPreview.alt}
              fill
              unoptimized
              className="object-contain"
            />
          </div>
        </div>
      ) : null}
    </main>
  );
}
