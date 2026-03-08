"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSearchParams } from "next/navigation";

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

type ConfirmationState = {
  character: LibraryCharacter;
  title: string;
  message: string;
  confirmLabel: string;
};

const DEFAULT_PORTRAIT_DATA_URL =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 256 256'>" +
      "<rect width='256' height='256' fill='#18181b'/>" +
      "<circle cx='128' cy='92' r='42' fill='#3f3f46'/>" +
      "<path d='M52 224c10-46 44-74 76-74s66 28 76 74' fill='#3f3f46'/>" +
      "<circle cx='128' cy='128' r='92' fill='none' stroke='#52525b' stroke-width='6'/>" +
    "</svg>",
  );

export default function CharacterLibraryPage() {
  const searchParams = useSearchParams();
  const requestedRuleset = searchParams.get("ruleset")?.trim() ?? "";
  const returnTo = searchParams.get("returnTo")?.trim() || "/";
  const isCompanionFlow = /\/campaign\/[^/]+\/companions$/.test(returnTo);
  const [selectedRuleset, setSelectedRuleset] = useState(
    requestedRuleset || RULESET_OPTIONS[0],
  );
  const [characters, setCharacters] = useState<LibraryCharacter[]>([]);
  const [selectedRoleFilter, setSelectedRoleFilter] = useState("all");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [deletingCharacterId, setDeletingCharacterId] = useState("");
  const [confirmationState, setConfirmationState] = useState<ConfirmationState | null>(null);

  const rulesetOptions = useMemo(() => {
    if (!requestedRuleset || RULESET_OPTIONS.includes(requestedRuleset as (typeof RULESET_OPTIONS)[number])) {
      return RULESET_OPTIONS;
    }

    return [requestedRuleset, ...RULESET_OPTIONS];
  }, [requestedRuleset]);

  const roleOptions = useMemo(() => {
    const uniqueRoles = Array.from(
      new Set(
        characters
          .map((character) => getCharacterRoleLabel(character.sheetJson))
          .filter(Boolean),
      ),
    ).sort((left, right) => left.localeCompare(right));

    return uniqueRoles;
  }, [characters]);

  const filteredCharacters = useMemo(() => {
    if (selectedRoleFilter === "all") {
      return characters;
    }

    return characters.filter(
      (character) =>
        getCharacterRoleLabel(character.sheetJson) === selectedRoleFilter,
    );
  }, [characters, selectedRoleFilter]);

  useEffect(() => {
    async function loadCharacters() {
      try {
        setError("");
        setIsLoading(true);

        const response = await fetch(
          `/api/library-characters?ruleset=${encodeURIComponent(selectedRuleset)}`,
        );
        const data = await response.json();

        if (!response.ok || !Array.isArray(data.characters)) {
          throw new Error(data.error ?? "Unable to load library characters.");
        }

        setCharacters(data.characters);
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load library characters.",
        );
      } finally {
        setIsLoading(false);
      }
    }

    loadCharacters();
  }, [selectedRuleset]);

  useEffect(() => {
    setSelectedRoleFilter("all");
  }, [selectedRuleset]);

  useEffect(() => {
    if (
      selectedRoleFilter !== "all" &&
      !roleOptions.includes(selectedRoleFilter)
    ) {
      setSelectedRoleFilter("all");
    }
  }, [roleOptions, selectedRoleFilter]);

  function formatTimestamp(value: string) {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  }

  function handleDeleteCharacter(character: LibraryCharacter) {
    if (deletingCharacterId) {
      return;
    }

    setConfirmationState({
      character,
      title: "Warning",
      message: `Remove ${character.name} from the reusable character library? Existing campaign copies will stay in those campaigns, but this master library character will be deleted.`,
      confirmLabel: "Remove",
    });
  }

  async function handleConfirmDeleteCharacter() {
    if (!confirmationState || deletingCharacterId) {
      return;
    }

    const targetCharacter = confirmationState.character;
    setConfirmationState(null);
    setError("");
    setDeletingCharacterId(targetCharacter.id);

    try {
      const response = await fetch(
        `/api/library-characters/${encodeURIComponent(targetCharacter.id)}`,
        {
          method: "DELETE",
        },
      );
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Unable to remove reusable character.");
      }

      setCharacters((currentCharacters) =>
        currentCharacters.filter((character) => character.id !== targetCharacter.id),
      );
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Unable to remove reusable character.",
      );
    } finally {
      setDeletingCharacterId("");
    }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(155,231,255,0.12),_transparent_32%),linear-gradient(135deg,_#08111f_0%,_#101b31_45%,_#170f22_100%)] px-4 py-8 text-slate-100 sm:px-6 lg:px-8">
      {confirmationState ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-950 p-5 shadow-2xl">
            <div className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-200">
              {confirmationState.title}
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-200">
              {confirmationState.message}
            </p>
            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmationState(null)}
                className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-medium text-slate-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteCharacter}
                className="rounded-xl bg-red-300 px-4 py-2 text-sm font-medium text-slate-950"
              >
                {confirmationState.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mx-auto max-w-5xl space-y-6">
        <section className="rounded-[2rem] border border-white/10 bg-slate-950/65 p-6 shadow-2xl shadow-black/40 backdrop-blur md:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-amber-200/90">
                Character Library
              </p>
              <h1 className="mt-2 text-3xl font-semibold text-white">
                Reusable Player Characters
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300">
                Build and manage reusable characters here, then import one into a
                new campaign from the launcher.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/characters/new?ruleset=${encodeURIComponent(
                  selectedRuleset,
                )}&returnTo=${encodeURIComponent(returnTo)}`}
                className="rounded-xl border border-cyan-300/40 bg-cyan-300/10 px-3 py-2 text-sm font-medium text-cyan-100 transition hover:border-cyan-300/70 hover:text-white"
              >
                Create Character
              </Link>
              <Link
                href={returnTo}
                className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-white/25 hover:text-white"
              >
                {isCompanionFlow ? "Back to Companion Picker" : "Back to Launcher"}
              </Link>
            </div>
          </div>
        </section>

        <section className="rounded-[2rem] border border-white/10 bg-slate-900/80 p-6 shadow-2xl shadow-black/40 backdrop-blur md:p-8">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-200">
                Filter by ruleset
              </label>
              <select
                value={selectedRuleset}
                onChange={(event) => setSelectedRuleset(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/60"
              >
                {rulesetOptions.map((ruleset) => (
                  <option key={ruleset} value={ruleset}>
                    {ruleset}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-200">
                Filter by class / role
              </label>
              <select
                value={selectedRoleFilter}
                onChange={(event) => setSelectedRoleFilter(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/60"
              >
                <option value="all">All classes / roles</option>
                {roleOptions.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-6 space-y-3">
            {isLoading ? (
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-5 text-sm text-slate-300">
                Loading library characters...
              </div>
            ) : null}

            {!isLoading && error ? (
              <div className="rounded-2xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">
                {error}
              </div>
            ) : null}

            {!isLoading && !error && characters.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-5 text-sm text-slate-300">
                No saved characters exist for {selectedRuleset} yet.
              </div>
            ) : null}

            {!isLoading &&
            !error &&
            characters.length > 0 &&
            filteredCharacters.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-5 text-sm text-slate-300">
                No saved characters match the selected class / role filter.
              </div>
            ) : null}

            {!isLoading && filteredCharacters.length > 0
                ? filteredCharacters.map((character) => (
                  <div
                    key={character.id}
                    className="relative rounded-2xl border border-white/10 bg-white/5 p-4 pl-20"
                  >
                    <div className="absolute left-4 top-4 h-14 w-14 overflow-hidden rounded-xl border border-white/10 bg-slate-950/70">
                      <Image
                        src={getCharacterPortraitDataUrl(character)}
                        alt={`${character.name} portrait`}
                        fill
                        sizes="56px"
                        className="object-cover"
                      />
                    </div>

                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <h2 className="text-base font-semibold text-white">
                          {character.name}
                        </h2>
                        <p className="mt-1 text-xs uppercase tracking-[0.16em] text-cyan-100">
                          {character.ruleset}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/characters/${encodeURIComponent(
                            character.id,
                          )}?returnTo=${encodeURIComponent(
                            `/characters?ruleset=${encodeURIComponent(
                              selectedRuleset,
                            )}&returnTo=${encodeURIComponent(returnTo)}`,
                          )}`}
                          className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-white/25 hover:text-white"
                        >
                          Edit
                        </Link>
                        <button
                          type="button"
                          onClick={() => handleDeleteCharacter(character)}
                          disabled={deletingCharacterId === character.id}
                          className="rounded-xl border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm font-medium text-red-200 transition hover:border-red-400/60 hover:text-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {deletingCharacterId === character.id ? "Removing..." : "Remove"}
                        </button>
                        <Link
                          href={`${returnTo}?ruleset=${encodeURIComponent(
                            selectedRuleset,
                          )}&libraryCharacterId=${encodeURIComponent(character.id)}`}
                          className="rounded-xl border border-cyan-300/40 bg-cyan-300/10 px-3 py-2 text-sm font-medium text-cyan-100 transition hover:border-cyan-300/70 hover:text-white"
                        >
                          {isCompanionFlow ? "Choose Companion" : "Use on Launcher"}
                        </Link>
                      </div>
                    </div>

                    {buildCharacterPreview(character) ? (
                      <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-300">
                        {buildCharacterPreview(character)}
                      </p>
                    ) : null}

                    <div className="mt-4 text-xs uppercase tracking-[0.16em] text-slate-400">
                      Updated {formatTimestamp(character.updatedAt)}
                    </div>
                  </div>
                ))
              : null}
          </div>
        </section>
      </div>
    </main>
  );
}

function getCharacterRoleLabel(sheetJson: Record<string, unknown> | null) {
  if (!sheetJson) {
    return "";
  }

  const keys = [
    "class",
    "archetype",
    "framework",
    "school",
    "occupation",
    "clan",
    "role",
  ] as const;

  for (const key of keys) {
    const value = sheetJson[key];

    if (typeof value === "string" && value.trim() && value.trim() !== "None yet") {
      return value.trim();
    }
  }

  return "";
}

function buildCharacterPreview(character: LibraryCharacter) {
  const behaviorSummary =
    character.sheetJson &&
    typeof character.sheetJson.behaviorSummary === "string" &&
    character.sheetJson.behaviorSummary.trim()
      ? character.sheetJson.behaviorSummary.trim()
      : "";
  const fallbackSummary =
    typeof character.memorySummary === "string" ? character.memorySummary.trim() : "";
  const summary = behaviorSummary || fallbackSummary;

  if (!summary) {
    return "";
  }

  if (summary.length <= 260) {
    return summary;
  }

  return `${summary.slice(0, 257).trim()}...`;
}

function getCharacterPortraitDataUrl(character: LibraryCharacter) {
  const portraitDataUrl = character.sheetJson?.portraitDataUrl;

  if (typeof portraitDataUrl === "string" && portraitDataUrl.startsWith("data:image/")) {
    return portraitDataUrl;
  }

  return DEFAULT_PORTRAIT_DATA_URL;
}
