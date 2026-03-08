"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useParams, useRouter, useSearchParams } from "next/navigation";

type CampaignDetails = {
  id: string;
  title: string;
  ruleset: string;
  characters: Array<{
    id: string;
    name: string;
    originLibraryCharacterId?: string | null;
  }>;
};

type LibraryCharacter = {
  id: string;
  name: string;
  ruleset: string;
  role: string;
  sheetJson: Record<string, unknown> | null;
  memorySummary: string | null;
  updatedAt: string;
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

export default function CompanionPickerPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const campaignId = params.id as string;
  const preferredLibraryCharacterId =
    searchParams.get("libraryCharacterId")?.trim() ?? "";
  const [campaign, setCampaign] = useState<CampaignDetails | null>(null);
  const [characters, setCharacters] = useState<LibraryCharacter[]>([]);
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<string[]>(
    preferredLibraryCharacterId ? [preferredLibraryCharacterId] : [],
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const returnTo = useMemo(
    () => `/campaign/${campaignId}/companions`,
    [campaignId],
  );

  useEffect(() => {
    if (!campaignId) {
      return;
    }

    async function loadData() {
      try {
        setError("");
        setIsLoading(true);

        const campaignResponse = await fetch(`/api/campaigns/${campaignId}`);
        const campaignData = await campaignResponse.json();

        if (!campaignResponse.ok || !campaignData.campaign) {
          throw new Error(campaignData.error ?? "Unable to load campaign.");
        }

        setCampaign({
          id: campaignData.campaign.id,
          title: campaignData.campaign.title,
          ruleset: campaignData.campaign.ruleset,
          characters: Array.isArray(campaignData.campaign.characters)
            ? campaignData.campaign.characters
            : [],
        });

        const libraryResponse = await fetch(
          `/api/library-characters?ruleset=${encodeURIComponent(
            campaignData.campaign.ruleset,
          )}`,
        );
        const libraryData = await libraryResponse.json();

        if (!libraryResponse.ok || !Array.isArray(libraryData.characters)) {
          throw new Error(
            libraryData.error ?? "Unable to load library characters.",
          );
        }

        setCharacters(libraryData.characters);
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load companion choices.",
        );
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
  }, [campaignId]);

  useEffect(() => {
    if (!preferredLibraryCharacterId || characters.length === 0) {
      return;
    }

    const matchingCharacter = characters.find(
      (character) => character.id === preferredLibraryCharacterId,
    );

    if (matchingCharacter) {
      setSelectedCharacterIds((currentIds) =>
        currentIds.includes(matchingCharacter.id)
          ? currentIds
          : [...currentIds, matchingCharacter.id],
      );
    }
  }, [characters, preferredLibraryCharacterId]);

  const alreadyAddedLibraryCharacterIds = useMemo(
    () =>
      new Set(
        (campaign?.characters ?? [])
          .map((character) => character.originLibraryCharacterId)
          .filter(
            (characterId): characterId is string =>
              typeof characterId === "string" && characterId.trim().length > 0,
          ),
      ),
    [campaign?.characters],
  );

  const availableSelectedCharacterIds = selectedCharacterIds.filter(
    (characterId) => !alreadyAddedLibraryCharacterIds.has(characterId),
  );

  async function handleAddCompanion() {
    if (!campaignId || availableSelectedCharacterIds.length === 0 || isSubmitting) {
      return;
    }

    setError("");
    setIsSubmitting(true);

    try {
      for (const selectedCharacterId of availableSelectedCharacterIds) {
        const response = await fetch(`/api/campaigns/${campaignId}/character`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            slot: "companion",
            libraryCharacterId: selectedCharacterId,
          }),
        });
        const data = await response.json();

        if (!response.ok || !data.character) {
          throw new Error(data.error ?? "Unable to add companion.");
        }
      }

      router.push(`/campaign/${campaignId}`);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Unable to add companion.",
      );
      setIsSubmitting(false);
    }
  }

  function formatTimestamp(value: string) {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.12),_transparent_32%),linear-gradient(135deg,_#08111f_0%,_#101b31_45%,_#170f22_100%)] px-4 py-8 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <section className="rounded-[2rem] border border-white/10 bg-slate-950/65 p-6 shadow-2xl shadow-black/40 backdrop-blur md:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-cyan-200/90">
                Companion Selection
              </p>
              <h1 className="mt-2 text-3xl font-semibold text-white">
                Pick a Library Character
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300">
                Choose an existing character from the library and copy them into{" "}
                {campaign?.title ?? "this campaign"} as a companion.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {campaign ? (
                <Link
                  href={`/characters?ruleset=${encodeURIComponent(
                    campaign.ruleset,
                  )}&returnTo=${encodeURIComponent(returnTo)}`}
                  className="rounded-xl border border-cyan-300/40 bg-cyan-300/10 px-3 py-2 text-sm font-medium text-cyan-100 transition hover:border-cyan-300/70 hover:text-white"
                >
                  Open character library
                </Link>
              ) : null}
              <Link
                href={`/campaign/${campaignId}`}
                className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-white/25 hover:text-white"
              >
                Back to campaign
              </Link>
            </div>
          </div>
        </section>

        <section className="rounded-[2rem] border border-white/10 bg-slate-900/80 p-6 shadow-2xl shadow-black/40 backdrop-blur md:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-slate-200">
                {campaign?.ruleset ?? "Loading ruleset..."}
              </p>
              <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-400">
                Compatible library characters are shown. Already-added characters cannot be selected again.
              </p>
            </div>

            <button
              type="button"
              onClick={handleAddCompanion}
              disabled={availableSelectedCharacterIds.length === 0 || isSubmitting}
              className="rounded-xl bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting
                ? "Adding characters..."
                : `Add selected (${availableSelectedCharacterIds.length})`}
            </button>
          </div>

          {error ? (
            <div className="mt-6 rounded-2xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          ) : null}

          {isLoading ? (
            <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 px-4 py-5 text-sm text-slate-300">
              Loading library characters...
            </div>
          ) : null}

          {!isLoading && !error && characters.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 px-4 py-5 text-sm text-slate-300">
              No saved characters exist for this ruleset yet. Open the character
              library to create one first.
            </div>
          ) : null}

          {!isLoading && characters.length > 0 ? (
            <div className="mt-6 space-y-3">
              {characters.map((character) => {
                const selected = selectedCharacterIds.includes(character.id);
                const alreadyAdded = alreadyAddedLibraryCharacterIds.has(character.id);

                return (
                  <button
                    key={character.id}
                    type="button"
                    onClick={() =>
                      setSelectedCharacterIds((currentIds) => {
                        if (alreadyAdded) {
                          return currentIds;
                        }

                        return currentIds.includes(character.id)
                          ? currentIds.filter((currentId) => currentId !== character.id)
                          : [...currentIds, character.id];
                      })
                    }
                    disabled={alreadyAdded}
                    className={`w-full rounded-2xl border p-4 text-left transition ${
                      selected
                        ? "border-cyan-300/80 bg-cyan-300/10"
                        : alreadyAdded
                          ? "border-white/10 bg-white/[0.03] opacity-60"
                          : "border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/[0.07]"
                    }`}
                  >
                    <div className="relative flex flex-wrap items-start justify-between gap-4 pl-[4.25rem]">
                      <div className="absolute left-0 top-0 h-14 w-14 overflow-hidden rounded-xl border border-white/10 bg-slate-950/70">
                        <Image
                          src={getLibraryCharacterPortraitDataUrl(character)}
                          alt={`${character.name} portrait`}
                          fill
                          sizes="56px"
                          className="object-cover"
                        />
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`inline-flex h-5 w-5 items-center justify-center rounded-md border text-[11px] font-semibold ${
                              selected
                                ? "border-cyan-300/70 bg-cyan-300/15 text-cyan-100"
                                : "border-white/15 bg-slate-950/60 text-slate-400"
                            }`}
                          >
                            {selected ? "✓" : ""}
                          </span>
                          <h2 className="text-base font-semibold text-white">
                            {character.name}
                          </h2>
                          {alreadyAdded ? (
                            <span className="rounded-full bg-amber-300/15 px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.14em] text-amber-100">
                              Already added
                            </span>
                          ) : selected ? (
                            <span className="rounded-full bg-cyan-300/15 px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.14em] text-cyan-100">
                              Selected
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-sm text-slate-300">
                          {buildLibraryCharacterHeadline(character)}
                        </p>
                      </div>

                      <div className="text-xs uppercase tracking-[0.16em] text-slate-400">
                        Updated {formatTimestamp(character.updatedAt)}
                      </div>
                    </div>

                    {buildLibraryCharacterPreview(character) ? (
                      <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-300">
                        {buildLibraryCharacterPreview(character)}
                      </p>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function buildLibraryCharacterHeadline(character: LibraryCharacter) {
  const sheet = character.sheetJson;

  if (!sheet) {
    return character.ruleset;
  }

  const role = getStringValue(
    sheet,
    "class",
    "archetype",
    "framework",
    "school",
    "occupation",
    "clan",
    "role",
  );
  const subclass = getStringValue(sheet, "subclass");
  const level = typeof sheet.level === "number" ? `Lvl ${sheet.level}` : "";

  return [role, subclass, level].filter(Boolean).join(" | ") || character.ruleset;
}

function buildLibraryCharacterPreview(character: LibraryCharacter) {
  const sheet = character.sheetJson;
  const behaviorSummary =
    sheet &&
    typeof sheet.behaviorSummary === "string" &&
    sheet.behaviorSummary.trim()
      ? sheet.behaviorSummary.trim()
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

function getLibraryCharacterPortraitDataUrl(character: LibraryCharacter) {
  const portraitDataUrl = character.sheetJson?.portraitDataUrl;

  if (typeof portraitDataUrl === "string" && portraitDataUrl.startsWith("data:image/")) {
    return portraitDataUrl;
  }

  return DEFAULT_PORTRAIT_DATA_URL;
}

function getStringValue(
  sheet: Record<string, unknown>,
  ...keys: string[]
) {
  for (const key of keys) {
    const value = sheet[key];

    if (typeof value === "string" && value.trim() && value.trim() !== "None yet") {
      return value.trim();
    }
  }

  return "";
}
