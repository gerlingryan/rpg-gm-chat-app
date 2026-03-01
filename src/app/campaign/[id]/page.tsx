"use client";

import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useParams } from "next/navigation";
import {
  getCharacterQuestionnaire,
  getVisibleCharacterQuestions,
  type CharacterQuestion,
} from "@/lib/campaigns";
import {
  DEFAULT_SCENE_SUMMARY,
  extractSceneBlock,
  stripSceneBlock,
  type SceneSummary,
} from "@/lib/scene";

type ChatMessage = {
  id?: string;
  speakerName: string;
  role: string;
  content: string;
};

type CampaignCharacter = {
  id: string;
  name: string;
  role: string;
  isMainCharacter: boolean;
  sheetJson: Record<string, unknown> | null;
  memorySummary: string | null;
};

type CampaignDetails = {
  id: string;
  title: string;
  ruleset: string;
  characters: CampaignCharacter[];
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

type ConfirmationState =
  | {
      kind: "reset";
      title: string;
      message: string;
      confirmLabel: string;
    }
  | {
      kind: "delete-character";
      title: string;
      message: string;
      confirmLabel: string;
      character: CampaignCharacter;
    };

export default function CampaignPage() {
  const params = useParams();
  const campaignId = params.id as string;

  const [campaign, setCampaign] = useState<CampaignDetails | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      speakerName: "GM",
      role: "gm",
      content: "Welcome. This is a test campaign. What do you do?",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [campaignError, setCampaignError] = useState("");
  const [characterName, setCharacterName] = useState("");
  const [characterConcept, setCharacterConcept] = useState("");
  const [characterPortraitDataUrl, setCharacterPortraitDataUrl] = useState("");
  const [characterAnswers, setCharacterAnswers] = useState<Record<string, string | number>>({});
  const [characterError, setCharacterError] = useState("");
  const [isGeneratingCharacter, setIsGeneratingCharacter] = useState(false);
  const [isGeneratingCharacterPortrait, setIsGeneratingCharacterPortrait] = useState(false);
  const [companionName, setCompanionName] = useState("");
  const [companionConcept, setCompanionConcept] = useState("");
  const [companionPortraitDataUrl, setCompanionPortraitDataUrl] = useState("");
  const [companionAnswers, setCompanionAnswers] = useState<Record<string, string | number>>({});
  const [companionError, setCompanionError] = useState("");
  const [isGeneratingCompanion, setIsGeneratingCompanion] = useState(false);
  const [isGeneratingCompanionPortrait, setIsGeneratingCompanionPortrait] = useState(false);
  const [isAutofillingCharacter, setIsAutofillingCharacter] = useState(false);
  const [isAutofillingCompanion, setIsAutofillingCompanion] = useState(false);
  const [showCompanionForm, setShowCompanionForm] = useState(false);
  const [collapsedCards, setCollapsedCards] = useState<Record<string, boolean>>({});
  const [detailCardId, setDetailCardId] = useState("");
  const [isScenarioActive, setIsScenarioActive] = useState(false);
  const [isTogglingScenario, setIsTogglingScenario] = useState(false);
  const [deletingCharacterId, setDeletingCharacterId] = useState("");
  const [generatingPortraitId, setGeneratingPortraitId] = useState("");
  const [confirmationState, setConfirmationState] = useState<ConfirmationState | null>(null);

  useEffect(() => {
    if (!campaignId) return;

    async function loadCampaign() {
      try {
        const [campaignRes, messagesRes] = await Promise.all([
          fetch(`/api/campaigns/${campaignId}`),
          fetch(`/api/messages?campaignId=${campaignId}`),
        ]);

        if (!campaignRes.ok) {
          throw new Error("Unable to load campaign.");
        }

        const campaignData = await campaignRes.json();

        if (campaignData.campaign) {
          setCampaign(campaignData.campaign);
          setCharacterAnswers(
            buildDefaultAnswers(
              getCharacterQuestionnaire(campaignData.campaign.ruleset),
            ),
          );
          setCompanionAnswers(
            buildDefaultAnswers(
              getCharacterQuestionnaire(campaignData.campaign.ruleset),
            ),
          );

          const mainCharacter = (campaignData.campaign.characters as CampaignCharacter[]).find(
            (character) => character.isMainCharacter,
          );

          if (mainCharacter) {
            setCharacterName(
              mainCharacter.name === "Main Character" ? "" : mainCharacter.name,
            );
          }
        }

        if (messagesRes.ok) {
          const messagesData = await messagesRes.json();

          if (
            Array.isArray(messagesData.messages) &&
            messagesData.messages.length > 0
          ) {
            setMessages(messagesData.messages);
            setIsScenarioActive(messagesData.messages.length > 1);
          }
        }
      } catch {
        setCampaignError("Unable to load campaign data.");
      }
    }

    loadCampaign();
  }, [campaignId]);

  const mainCharacter =
    campaign?.characters.find((character) => character.isMainCharacter) ?? null;
  const companionCharacters =
    campaign?.characters.filter((character) => !character.isMainCharacter) ?? [];
  const companionColorMap = buildCompanionColorMap(companionCharacters);
  const mainCharacterSource = getSheetSource(mainCharacter?.sheetJson ?? null);
  const needsCharacterGeneration = !mainCharacter || mainCharacterSource !== "user-generated";
  const isChatLocked = needsCharacterGeneration || !isScenarioActive;
  const characterQuestions = campaign
    ? getCharacterQuestionnaire(campaign.ruleset)
    : [];
  const visibleCharacterQuestions = campaign
    ? getVisibleCharacterQuestions(campaign.ruleset, characterAnswers)
    : [];
  const visibleCompanionQuestions = campaign
    ? getVisibleCharacterQuestions(campaign.ruleset, companionAnswers)
    : [];
  const sceneSummary = buildSceneSummary(campaign, messages);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    const trimmed = input.trim();
    if (!trimmed || loading || !campaignId || isChatLocked) return;
    const resolvedInput = resolveSubmittedAction(trimmed, messages);

    setError("");
    setLoading(true);

    const userMessage: ChatMessage = {
      speakerName: mainCharacter?.name ?? "Player",
      role: "user",
      content: resolvedInput,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          campaignId,
          message: resolvedInput,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to send message.");
      }

        const data = await res.json();

        if (Array.isArray(data.messages) && data.messages.length > 0) {
          setMessages((prev) => [...prev, ...data.messages]);
        } else {
        setMessages((prev) => [
          ...prev,
          {
            speakerName: "GM",
            role: "gm",
            content: data.reply ?? "The GM does not respond.",
            },
          ]);
        }

        if (Array.isArray(data.characters)) {
          setCampaign((currentCampaign) =>
            currentCampaign
              ? {
                  ...currentCampaign,
                  characters: data.characters,
                }
              : currentCampaign,
          );
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      } finally {
        setLoading(false);
    }
  }

  async function handleGenerateCharacter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedName = characterName.trim();
    if (!trimmedName || !campaignId || isGeneratingCharacter) {
      return;
    }

    setCharacterError("");
    setIsGeneratingCharacter(true);

    try {
      const res = await fetch(`/api/campaigns/${campaignId}/character`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: trimmedName,
          slot: "main",
          answers: {
            ...characterAnswers,
            portraitDataUrl: characterPortraitDataUrl,
          },
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.character) {
        throw new Error(data.error ?? "Unable to generate character.");
      }

      setCampaign((currentCampaign) => {
        if (!currentCampaign) {
          return currentCampaign;
        }

        const remainingCharacters = currentCampaign.characters.filter(
          (character) => !character.isMainCharacter,
        );

        return {
          ...currentCampaign,
          characters: [data.character, ...remainingCharacters],
        };
      });
      setCharacterPortraitDataUrl("");
    } catch (generationError) {
      setCharacterError(
        generationError instanceof Error
          ? generationError.message
          : "Unable to generate character.",
      );
    } finally {
      setIsGeneratingCharacter(false);
    }
  }

  async function handleAutofillCharacter() {
    const trimmedConcept = characterConcept.trim();
    if (!trimmedConcept || !campaignId || isAutofillingCharacter) {
      return;
    }

    setCharacterError("");
    setIsAutofillingCharacter(true);

    try {
      const res = await fetch(`/api/campaigns/${campaignId}/character/suggest`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          concept: trimmedConcept,
          answers: characterAnswers,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.answers) {
        throw new Error(data.error ?? "Unable to suggest character details.");
      }

      setCharacterAnswers((currentAnswers) => ({
        ...currentAnswers,
        ...data.answers,
      }));
    } catch (autofillError) {
      setCharacterError(
        autofillError instanceof Error
          ? autofillError.message
          : "Unable to suggest character details.",
      );
    } finally {
      setIsAutofillingCharacter(false);
    }
  }

  async function handleGenerateCharacterPortrait() {
    const physicalDescription =
      typeof characterAnswers.physicalDescription === "string"
        ? characterAnswers.physicalDescription.trim()
        : "";

    if (!campaignId || !physicalDescription || isGeneratingCharacterPortrait) {
      return;
    }

    setCharacterError("");
    setIsGeneratingCharacterPortrait(true);

    try {
      const res = await fetch(`/api/campaigns/${campaignId}/character/portrait`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: characterName.trim() || "Character",
          physicalDescription,
        }),
      });

      const data = await res.json();

      if (!res.ok || typeof data.portraitDataUrl !== "string") {
        throw new Error(data.error ?? "Unable to generate portrait.");
      }

      setCharacterPortraitDataUrl(data.portraitDataUrl);
    } catch (portraitError) {
      setCharacterError(
        portraitError instanceof Error
          ? portraitError.message
          : "Unable to generate portrait.",
      );
    } finally {
      setIsGeneratingCharacterPortrait(false);
    }
  }

  async function handleCharacterPortraitUpload(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      setCharacterPortraitDataUrl(dataUrl);
    } catch {
      setCharacterError("Unable to load uploaded portrait.");
    }
  }

  async function handleGenerateCompanion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedName = companionName.trim();
    if (!trimmedName || !campaignId || isGeneratingCompanion) {
      return;
    }

    setCompanionError("");
    setIsGeneratingCompanion(true);

    try {
      const res = await fetch(`/api/campaigns/${campaignId}/character`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: trimmedName,
          slot: "companion",
          answers: {
            ...companionAnswers,
            portraitDataUrl: companionPortraitDataUrl,
          },
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.character) {
        throw new Error(data.error ?? "Unable to create companion.");
      }

      setCampaign((currentCampaign) => {
        if (!currentCampaign) {
          return currentCampaign;
        }

        return {
          ...currentCampaign,
          characters: [...currentCampaign.characters, data.character],
        };
      });
      setCompanionName("");
      setCompanionConcept("");
      setCompanionPortraitDataUrl("");
      setCompanionAnswers(buildDefaultAnswers(characterQuestions));
      setShowCompanionForm(false);
    } catch (generationError) {
      setCompanionError(
        generationError instanceof Error
          ? generationError.message
          : "Unable to create companion.",
      );
    } finally {
      setIsGeneratingCompanion(false);
    }
  }

  async function handleGenerateCompanionPortrait() {
    const physicalDescription =
      typeof companionAnswers.physicalDescription === "string"
        ? companionAnswers.physicalDescription.trim()
        : "";

    if (!campaignId || !physicalDescription || isGeneratingCompanionPortrait) {
      return;
    }

    setCompanionError("");
    setIsGeneratingCompanionPortrait(true);

    try {
      const res = await fetch(`/api/campaigns/${campaignId}/character/portrait`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: companionName.trim() || "Companion",
          physicalDescription,
        }),
      });

      const data = await res.json();

      if (!res.ok || typeof data.portraitDataUrl !== "string") {
        throw new Error(data.error ?? "Unable to generate portrait.");
      }

      setCompanionPortraitDataUrl(data.portraitDataUrl);
    } catch (portraitError) {
      setCompanionError(
        portraitError instanceof Error
          ? portraitError.message
          : "Unable to generate portrait.",
      );
    } finally {
      setIsGeneratingCompanionPortrait(false);
    }
  }

  async function handleCompanionPortraitUpload(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      setCompanionPortraitDataUrl(dataUrl);
    } catch {
      setCompanionError("Unable to load uploaded portrait.");
    }
  }

  async function handleAutofillCompanion() {
    const trimmedConcept = companionConcept.trim();
    if (!trimmedConcept || !campaignId || isAutofillingCompanion) {
      return;
    }

    setCompanionError("");
    setIsAutofillingCompanion(true);

    try {
      const res = await fetch(`/api/campaigns/${campaignId}/character/suggest`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          concept: trimmedConcept,
          answers: companionAnswers,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.answers) {
        throw new Error(data.error ?? "Unable to suggest companion details.");
      }

      setCompanionAnswers((currentAnswers) => ({
        ...currentAnswers,
        ...data.answers,
      }));
    } catch (autofillError) {
      setCompanionError(
        autofillError instanceof Error
          ? autofillError.message
          : "Unable to suggest companion details.",
      );
    } finally {
      setIsAutofillingCompanion(false);
    }
  }

  async function handleScenarioAction() {
    if (!campaignId || needsCharacterGeneration || isTogglingScenario) {
      return;
    }

    if (isScenarioActive) {
      setConfirmationState({
        kind: "reset",
        title: "Confirmation",
        message: "Reset the scenario and clear chat history after the opening scene?",
        confirmLabel: "Reset",
      });
      return;
    }

    await performScenarioAction();
  }

  async function performScenarioAction() {
    if (!campaignId || needsCharacterGeneration || isTogglingScenario) {
      return;
    }

    setError("");
    setIsTogglingScenario(true);

    try {
      const res = await fetch(`/api/campaigns/${campaignId}/session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: isScenarioActive ? "reset" : "start",
        }),
      });

      const data = await res.json();

      if (!res.ok || !Array.isArray(data.messages)) {
        throw new Error(data.error ?? "Unable to update scenario state.");
      }

      setMessages(data.messages);
      setIsScenarioActive(Boolean(data.started));
      setInput("");
    } catch (scenarioError) {
      setError(
        scenarioError instanceof Error
          ? scenarioError.message
          : "Unable to update scenario state.",
      );
    } finally {
      setIsTogglingScenario(false);
    }
  }

  async function handleDeleteCharacter(character: CampaignCharacter) {
    if (deletingCharacterId) {
      return;
    }

    setConfirmationState({
      kind: "delete-character",
      title: "Warning",
      message: `Delete ${character.name}? This removes the character from the campaign.`,
      confirmLabel: "Delete",
      character,
    });
  }

  async function performDeleteCharacter(character: CampaignCharacter) {
    if (deletingCharacterId) {
      return;
    }

    setError("");
    setDeletingCharacterId(character.id);

    try {
      const res = await fetch(`/api/characters/${character.id}`, {
        method: "DELETE",
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? "Unable to delete character.");
      }

      setCampaign((currentCampaign) => {
        if (!currentCampaign) {
          return currentCampaign;
        }

        return {
          ...currentCampaign,
          characters: currentCampaign.characters.filter(
            (currentCharacter) => currentCharacter.id !== character.id,
          ),
        };
      });
      setDetailCardId((currentDetailCardId) =>
        currentDetailCardId === character.id ? "" : currentDetailCardId,
      );
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Unable to delete character.",
      );
    } finally {
      setDeletingCharacterId("");
    }
  }

  async function handleConfirmAction() {
    if (!confirmationState) {
      return;
    }

    const pendingConfirmation = confirmationState;
    setConfirmationState(null);

    if (pendingConfirmation.kind === "reset") {
      await performScenarioAction();
      return;
    }

    await performDeleteCharacter(pendingConfirmation.character);
  }

  async function handleGeneratePortrait(character: CampaignCharacter) {
    if (generatingPortraitId) {
      return;
    }

    setError("");
    setGeneratingPortraitId(character.id);

    try {
      const res = await fetch(`/api/characters/${character.id}/portrait`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          physicalDescription:
            typeof character.sheetJson?.physicalDescription === "string"
              ? character.sheetJson.physicalDescription
              : "",
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.character) {
        throw new Error(data.error ?? "Unable to generate portrait.");
      }

      setCampaign((currentCampaign) =>
        currentCampaign
          ? {
              ...currentCampaign,
              characters: currentCampaign.characters.map((currentCharacter) =>
                currentCharacter.id === data.character.id ? data.character : currentCharacter,
              ),
            }
          : currentCampaign,
      );
    } catch (portraitError) {
      setError(
        portraitError instanceof Error
          ? portraitError.message
          : "Unable to generate portrait.",
      );
    } finally {
      setGeneratingPortraitId("");
    }
  }

  async function handleUploadPortrait(
    character: CampaignCharacter,
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file || generatingPortraitId) {
      return;
    }

    setError("");
    setGeneratingPortraitId(character.id);

    try {
      const portraitDataUrl = await readFileAsDataUrl(file);
      const res = await fetch(`/api/characters/${character.id}/portrait`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          physicalDescription:
            typeof character.sheetJson?.physicalDescription === "string"
              ? character.sheetJson.physicalDescription
              : "",
          portraitDataUrl,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.character) {
        throw new Error(data.error ?? "Unable to upload portrait.");
      }

      setCampaign((currentCampaign) =>
        currentCampaign
          ? {
              ...currentCampaign,
              characters: currentCampaign.characters.map((currentCharacter) =>
                currentCharacter.id === data.character.id ? data.character : currentCharacter,
              ),
            }
          : currentCampaign,
      );
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Unable to upload portrait.",
      );
    } finally {
      setGeneratingPortraitId("");
    }
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 p-4 md:p-5">
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
                onClick={handleConfirmAction}
                className="rounded-xl bg-red-300 px-4 py-2 text-sm font-medium text-zinc-950"
              >
                {confirmationState.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mx-auto max-w-7xl grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(420px,520px)]">
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-3 shadow">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold">
                {campaign?.title ?? "Campaign"}
              </h1>
              <p className="mt-0.5 text-sm text-zinc-400">
                {campaign?.ruleset ?? "Loading ruleset..."}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {!needsCharacterGeneration ? (
                <button
                  type="button"
                  onClick={handleScenarioAction}
                  disabled={isTogglingScenario}
                  className="rounded-xl bg-cyan-300 px-4 py-2 text-sm font-medium text-zinc-950 disabled:opacity-50"
                >
                  {isTogglingScenario
                    ? isScenarioActive
                      ? "Resetting..."
                      : "Starting..."
                    : isScenarioActive
                      ? "Reset"
                      : "Start"}
                </button>
              ) : null}

              {campaign && !needsCharacterGeneration ? (
                <button
                  type="button"
                  onClick={() => {
                    setCompanionError("");
                    setShowCompanionForm((current) => !current);
                  }}
                  className="rounded-xl border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-sm font-medium text-cyan-100 transition hover:border-cyan-300/60"
                >
                  {showCompanionForm ? "Hide companion form" : "Add companion"}
                </button>
              ) : null}

              <Link
                href="/"
                className="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm font-medium text-zinc-200 transition hover:border-zinc-500 hover:text-white"
              >
                Back to launcher
              </Link>
            </div>
          </div>

          {campaignError ? (
            <div className="mb-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
              {campaignError}
            </div>
          ) : null}

          {campaign && needsCharacterGeneration ? (
            <div className="mb-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3">
              <div className="mb-2">
                <h2 className="text-base font-semibold text-emerald-100">
                  Generate your main character
                </h2>
                <p className="mt-0.5 text-sm text-emerald-50/85">
                  Build a saved player character for {campaign.ruleset} before
                  you continue the adventure.
                </p>
              </div>

              <form className="space-y-3" onSubmit={handleGenerateCharacter}>
                <input
                  value={characterName}
                  onChange={(event) => setCharacterName(event.target.value)}
                  placeholder="Character name"
                  className="w-full rounded-xl border border-emerald-200/15 bg-zinc-950 px-3 py-2 outline-none focus:border-emerald-300/50"
                />

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-emerald-50">
                    Quick concept
                  </label>
                  <textarea
                    value={characterConcept}
                    onChange={(event) => setCharacterConcept(event.target.value)}
                    placeholder="Describe the kind of character you want and the AI will suggest values."
                    className="min-h-[84px] w-full rounded-xl border border-emerald-200/15 bg-zinc-950 px-3 py-2 outline-none focus:border-emerald-300/50"
                  />
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-emerald-50/70">
                      This fills the visible fields only. You can change anything before saving.
                    </p>
                    <button
                      type="button"
                      onClick={handleAutofillCharacter}
                      disabled={!characterConcept.trim() || isAutofillingCharacter || isGeneratingCharacter}
                      className="rounded-xl border border-emerald-300/30 bg-emerald-300/10 px-3 py-2 text-sm font-medium text-emerald-100 disabled:opacity-50"
                    >
                      {isAutofillingCharacter ? "Auto-filling..." : "Auto-fill"}
                    </button>
                  </div>
                </div>

                <div className="space-y-2 rounded-xl border border-emerald-200/10 bg-zinc-950/40 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-emerald-50">
                        Portrait
                      </div>
                      <p className="mt-0.5 text-xs text-emerald-50/70">
                        Generate from physical description or upload your own image.
                      </p>
                    </div>
                    <div className="h-20 w-20 overflow-hidden rounded-lg border border-emerald-200/10 bg-zinc-950">
                      <Image
                        src={characterPortraitDataUrl || DEFAULT_PORTRAIT_DATA_URL}
                        alt="Character portrait preview"
                        width={160}
                        height={160}
                        unoptimized
                        className="h-full w-full object-cover"
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleGenerateCharacterPortrait}
                      disabled={
                        isGeneratingCharacterPortrait ||
                        typeof characterAnswers.physicalDescription !== "string" ||
                        !characterAnswers.physicalDescription.trim()
                      }
                      className="rounded-xl border border-emerald-300/30 bg-emerald-300/10 px-3 py-2 text-sm font-medium text-emerald-100 disabled:opacity-50"
                    >
                      {isGeneratingCharacterPortrait ? "Generating..." : "Generate portrait"}
                    </button>
                    <label className="cursor-pointer rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm font-medium text-zinc-200">
                      Upload portrait
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleCharacterPortraitUpload}
                      />
                    </label>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  {visibleCharacterQuestions.map((question) => (
                    <CharacterQuestionField
                      key={question.id}
                      question={question}
                      value={characterAnswers[question.id]}
                      onChange={(value) =>
                        setCharacterAnswers((currentAnswers) => ({
                          ...currentAnswers,
                          [question.id]: value,
                        }))
                      }
                    />
                  ))}
                </div>

                {characterError ? (
                  <p className="text-sm text-red-300">{characterError}</p>
                ) : null}

                <button
                  type="submit"
                  disabled={!characterName.trim() || isGeneratingCharacter}
                  className="rounded-xl bg-emerald-300 px-4 py-2 font-medium text-zinc-950 disabled:opacity-60"
                >
                  {isGeneratingCharacter
                    ? "Generating character..."
                    : "Generate and save character"}
                </button>
              </form>
            </div>
          ) : null}

          {campaign && !needsCharacterGeneration ? (
            showCompanionForm ? (
              <div className="mb-3 rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-3">
                <form className="space-y-3" onSubmit={handleGenerateCompanion}>
                  <input
                    value={companionName}
                    onChange={(event) => setCompanionName(event.target.value)}
                    placeholder="Companion name"
                    className="w-full rounded-xl border border-cyan-200/15 bg-zinc-950 px-3 py-2 outline-none focus:border-cyan-300/50"
                  />

                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-cyan-50">
                      Quick concept
                    </label>
                    <textarea
                      value={companionConcept}
                      onChange={(event) => setCompanionConcept(event.target.value)}
                      placeholder="Describe the companion and the AI will suggest values."
                      className="min-h-[84px] w-full rounded-xl border border-cyan-200/15 bg-zinc-950 px-3 py-2 outline-none focus:border-cyan-300/50"
                    />
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs text-cyan-50/70">
                        This fills the visible fields only. You can adjust the results before saving.
                      </p>
                      <button
                        type="button"
                        onClick={handleAutofillCompanion}
                        disabled={!companionConcept.trim() || isAutofillingCompanion || isGeneratingCompanion}
                        className="rounded-xl border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-sm font-medium text-cyan-100 disabled:opacity-50"
                      >
                        {isAutofillingCompanion ? "Auto-filling..." : "Auto-fill"}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2 rounded-xl border border-cyan-200/10 bg-zinc-950/40 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-cyan-50">
                          Portrait
                        </div>
                        <p className="mt-0.5 text-xs text-cyan-50/70">
                          Generate from physical description or upload your own image.
                        </p>
                      </div>
                      <div className="h-20 w-20 overflow-hidden rounded-lg border border-cyan-200/10 bg-zinc-950">
                        <Image
                          src={companionPortraitDataUrl || DEFAULT_PORTRAIT_DATA_URL}
                          alt="Companion portrait preview"
                          width={160}
                          height={160}
                          unoptimized
                          className="h-full w-full object-cover"
                        />
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={handleGenerateCompanionPortrait}
                        disabled={
                          isGeneratingCompanionPortrait ||
                          typeof companionAnswers.physicalDescription !== "string" ||
                          !companionAnswers.physicalDescription.trim()
                        }
                        className="rounded-xl border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-sm font-medium text-cyan-100 disabled:opacity-50"
                      >
                        {isGeneratingCompanionPortrait ? "Generating..." : "Generate portrait"}
                      </button>
                      <label className="cursor-pointer rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm font-medium text-zinc-200">
                        Upload portrait
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={handleCompanionPortraitUpload}
                        />
                      </label>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    {visibleCompanionQuestions.map((question) => (
                      <CharacterQuestionField
                        key={`companion-${question.id}`}
                        question={question}
                        value={companionAnswers[question.id]}
                        onChange={(value) =>
                          setCompanionAnswers((currentAnswers) => ({
                            ...currentAnswers,
                            [question.id]: value,
                          }))
                        }
                      />
                    ))}
                  </div>

                  {companionError ? (
                    <p className="text-sm text-red-300">{companionError}</p>
                  ) : null}

                  <div className="flex items-center gap-3">
                    <button
                      type="submit"
                      disabled={!companionName.trim() || isGeneratingCompanion}
                      className="rounded-xl bg-cyan-300 px-4 py-2 font-medium text-zinc-950 disabled:opacity-60"
                    >
                      {isGeneratingCompanion
                        ? "Creating companion..."
                        : "Create companion"}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setShowCompanionForm(false);
                        setCompanionError("");
                      }}
                      className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm font-medium text-zinc-200"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            ) : null
          ) : null}

          <section className="mb-3 rounded-xl border border-zinc-800 bg-zinc-950/80 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
              Scene
            </div>
            <div className="mt-2 text-sm text-zinc-100">
              <span className="font-semibold">
                {buildResolvedSceneHeading(sceneSummary)}
              </span>
              <span className="px-2 text-zinc-600">•</span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${getMoodBadgeClass(
                  sceneSummary.mood,
                )}`}
              >
                {sceneSummary.mood}
              </span>
              <span className="px-2 text-zinc-600">•</span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${getThreatBadgeClass(
                  sceneSummary.threat,
                )}`}
              >
                {sceneSummary.threat}
              </span>
            </div>
              <div className="mt-3 flex flex-wrap gap-x-3 gap-y-2 text-sm">
                <span className="text-emerald-100">
                  <span className="font-medium text-emerald-300/80">Goal:</span>{" "}
                  {sceneSummary.goal}
                </span>
                <span className="text-zinc-600">|</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${getClockBadgeClass(
                    sceneSummary.clock,
                  )}`}
                >
                  <span className="font-medium">Clock:</span> {sceneSummary.clock}
                </span>
              </div>
            </section>

            <div className="h-[54vh] overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950 p-3 space-y-3">
            {messages.map((msg, index) => (
              (() => {
                const bubbleStyles = getMessageBubbleStyles(msg, companionColorMap);

                return (
              <div
                key={msg.id ?? `${msg.role}-${index}`}
                className={`rounded-xl border p-3 ${bubbleStyles.containerClass}`}
              >
                <div
                  className={`mb-1 text-xs uppercase tracking-[0.16em] ${bubbleStyles.labelClass}`}
                >
                  {msg.speakerName}
                </div>
                <MessageBody role={msg.role} content={msg.content} />
              </div>
                );
              })()
            ))}

            {loading && (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-3 text-zinc-400">
                GM is thinking...
              </div>
            )}
          </div>

          <form onSubmit={handleSubmit} className="mt-3 space-y-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={isChatLocked}
              placeholder={
                needsCharacterGeneration
                  ? "Generate your main character to begin."
                  : !isScenarioActive
                    ? "Press Start to begin the scenario."
                    : "Type your action..."
              }
              className="min-h-[84px] w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2.5 outline-none focus:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-60"
            />

            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={loading || !input.trim() || isChatLocked}
                  className="rounded-xl bg-zinc-100 px-4 py-2 font-medium text-zinc-900 disabled:opacity-50"
                >
                  Send
                </button>
                {error ? <p className="text-sm text-red-400">{error}</p> : null}
              </div>

              <div className="flex items-center gap-3">
                <span className="text-xs text-zinc-500">ID: {campaignId}</span>
              </div>
            </div>
          </form>
        </section>

        <aside className="rounded-2xl border border-zinc-800 bg-zinc-900 p-3 shadow">
          <h2 className="mb-2 text-base font-semibold">Characters</h2>

          <div className="max-h-[calc(100vh-6rem)] overflow-y-auto pr-1">
            <div
              className={`grid gap-3 text-xs text-zinc-300 ${
                "grid-cols-1"
                }`}
            >
            {mainCharacter && (!detailCardId || detailCardId === mainCharacter.id) ? (
                <CharacterCard
                  character={mainCharacter}
                  companionColorMap={companionColorMap}
                  isDeleting={deletingCharacterId === mainCharacter.id}
                  isGeneratingPortrait={generatingPortraitId === mainCharacter.id}
                  collapsed={Boolean(collapsedCards[mainCharacter.id])}
                  fullDetail={detailCardId === mainCharacter.id}
                  onDelete={() => handleDeleteCharacter(mainCharacter)}
                  onGeneratePortrait={() => handleGeneratePortrait(mainCharacter)}
                  onUploadPortrait={(event) => handleUploadPortrait(mainCharacter, event)}
                  onToggle={() => {
                    setCollapsedCards((current) => ({
                      ...current,
                      [mainCharacter.id]: !current[mainCharacter.id],
                    }));
                    setDetailCardId((currentDetailCardId) =>
                      currentDetailCardId === mainCharacter.id ? "" : currentDetailCardId,
                    );
                  }}
                  onToggleDetail={() => {
                    setCollapsedCards((current) => ({
                      ...current,
                      [mainCharacter.id]: false,
                    }));
                    setDetailCardId((currentDetailCardId) =>
                      currentDetailCardId === mainCharacter.id ? "" : mainCharacter.id,
                    );
                  }}
                />
              ) : !detailCardId ? (
                <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                  <div className="font-medium">Main Character</div>
                  <div className="mt-1 text-zinc-400">
                    Generate a character to populate the sheet.
                  </div>
                </div>
              ) : null}

            {companionCharacters.length > 0 ? (
                companionCharacters
                  .filter((character) => !detailCardId || detailCardId === character.id)
                  .map((character) => (
                  <CharacterCard
                    key={character.id}
                    character={character}
                    companionColorMap={companionColorMap}
                    isDeleting={deletingCharacterId === character.id}
                    isGeneratingPortrait={generatingPortraitId === character.id}
                    collapsed={Boolean(collapsedCards[character.id])}
                    fullDetail={detailCardId === character.id}
                    onDelete={() => handleDeleteCharacter(character)}
                    onGeneratePortrait={() => handleGeneratePortrait(character)}
                    onUploadPortrait={(event) => handleUploadPortrait(character, event)}
                    onToggle={() => {
                      setCollapsedCards((current) => ({
                        ...current,
                        [character.id]: !current[character.id],
                      }));
                      setDetailCardId((currentDetailCardId) =>
                        currentDetailCardId === character.id ? "" : currentDetailCardId,
                      );
                    }}
                    onToggleDetail={() => {
                      setCollapsedCards((current) => ({
                        ...current,
                        [character.id]: false,
                      }));
                      setDetailCardId((currentDetailCardId) =>
                        currentDetailCardId === character.id ? "" : character.id,
                      );
                    }}
                  />
                ))
              ) : !detailCardId ? (
                <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                  <div className="font-medium">Companion</div>
                  <div className="mt-1 text-zinc-400">No companion assigned.</div>
                </div>
              ) : null}
              </div>
            </div>
        </aside>
      </div>
    </main>
  );
}

function CharacterCard({
  character,
  companionColorMap,
  isDeleting,
  isGeneratingPortrait,
  collapsed,
  fullDetail,
  onDelete,
  onGeneratePortrait,
  onUploadPortrait,
  onToggle,
  onToggleDetail,
}: {
  character: CampaignCharacter;
  companionColorMap: Record<string, CompanionPalette>;
  isDeleting: boolean;
  isGeneratingPortrait: boolean;
  collapsed: boolean;
  fullDetail: boolean;
  onDelete: () => void;
  onGeneratePortrait: () => void;
  onUploadPortrait: (event: ChangeEvent<HTMLInputElement>) => void;
  onToggle: () => void;
  onToggleDetail: () => void;
}) {
  const longTextKeys = new Set(["background", "physicalDescription", "personality"]);
  const allStatEntries = Object.entries(character.sheetJson ?? {}).filter(
    ([key]) => key !== "source" && key !== "concept" && key !== "portraitDataUrl",
  );
  const detailEntries = allStatEntries.filter(([key]) => longTextKeys.has(key));
  const compactEntries = allStatEntries.filter(([key]) => !longTextKeys.has(key));
  const expandedCandidateEntries = compactEntries.filter(
    ([key]) => key !== "proficiencies" && key !== "stats",
  );
  const statBlockEntries =
    character.sheetJson?.stats &&
    typeof character.sheetJson.stats === "object" &&
    !Array.isArray(character.sheetJson.stats)
      ? Object.entries(character.sheetJson.stats as Record<string, unknown>)
      : [];
  const rankedAttributeEntries = statBlockEntries
    .map((entry) => ({
      entry,
      score: getComparableSheetValue(entry[1]),
    }))
    .filter((item) => item.score !== null)
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
    .slice(0, 4)
    .map((item) => item.entry);
  const expandedAttributeEntries = rankedAttributeEntries.slice(0, 4);
  const expandedEntries = fullDetail
    ? []
    : rankedAttributeEntries.length > 0
      ? rankedAttributeEntries
      : expandedCandidateEntries
        .map((entry) => ({
          entry,
          score: getComparableSheetValue(entry[1]),
        }))
        .filter((item) => item.score !== null)
        .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
        .slice(0, 4)
        .map((item) => item.entry);
  const statEntries = fullDetail
    ? compactEntries
    : expandedEntries.length > 0
      ? expandedEntries
      : expandedCandidateEntries.slice(0, 4);
  const compactStatRows = fullDetail
    ? []
    : statEntries.reduce<Array<Array<[string, unknown]>>>((rows, entry, index) => {
        if (index % 2 === 0) {
          rows.push([entry]);
        } else {
          rows[rows.length - 1].push(entry);
        }

        return rows;
      }, []);
  const compactRole = getCompactRole(character.sheetJson ?? null);
  const compactResource = getCompactResource(character.sheetJson ?? null);
  const armorClass =
    typeof character.sheetJson?.ac === "number"
      ? String(character.sheetJson.ac)
      : typeof character.sheetJson?.ac === "string" && character.sheetJson.ac.trim()
        ? character.sheetJson.ac
        : "";
  const portraitDataUrl =
    typeof character.sheetJson?.portraitDataUrl === "string"
      ? character.sheetJson.portraitDataUrl
      : "";
  const portraitSizeClass = collapsed
    ? "h-14 w-14"
    : fullDetail
      ? "h-44 w-44"
      : "h-28 w-28";
  const hasPhysicalDescription =
    typeof character.sheetJson?.physicalDescription === "string" &&
    character.sheetJson.physicalDescription.trim() &&
    character.sheetJson.physicalDescription !== "Not specified.";
  const displayName = character.isMainCharacter
    ? `* ${character.name} *`
    : character.name;
  const cardStyles = getCharacterCardStyles(character, companionColorMap);

  return (
    <div
      className={`rounded-xl border transition-colors ${cardStyles.hoverContainerClass} ${cardStyles.containerClass} ${
        collapsed ? "p-2" : fullDetail ? "p-4" : "p-3"
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`shrink-0 overflow-hidden rounded-lg border border-zinc-800/70 bg-zinc-950/60 ${portraitSizeClass}`}
        >
          <Image
            src={portraitDataUrl || DEFAULT_PORTRAIT_DATA_URL}
            alt={
              portraitDataUrl
                ? `${character.name} portrait`
                : `${character.name} placeholder portrait`
            }
            width={768}
            height={768}
            unoptimized
            className="h-full w-full object-cover"
          />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className={`${fullDetail ? "text-base" : "text-sm"} truncate font-medium ${cardStyles.nameClass}`}>
                {displayName}
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onToggleDetail}
                className={`rounded-md border px-1.5 py-1 text-[10px] transition ${cardStyles.toggleClass}`}
                aria-label={fullDetail ? "Exit full detail view" : "Show full detail view"}
                title={fullDetail ? "Exit full detail view" : "Show full detail view"}
              >
                {fullDetail ? "-" : "+"}
              </button>

              <button
                type="button"
                onClick={onToggle}
                className={`rounded-md border px-1.5 py-1 text-[10px] transition ${cardStyles.toggleClass}`}
                aria-label={collapsed ? "Expand character card" : "Collapse character card"}
              >
                {collapsed ? "v" : "^"}
              </button>
            </div>
          </div>

          {collapsed ? (
            <div className={`mt-1 text-[11px] ${cardStyles.summaryClass}`}>
              <span className={cardStyles.mutedClass}>{compactRole}</span>
              <span className={`px-1 ${cardStyles.dividerClass}`}>|</span>
              <span className={cardStyles.valueClass}>{compactResource}</span>
            </div>
          ) : fullDetail ? (
            <div className="mt-3 grid gap-x-5 gap-y-2 text-xs sm:grid-cols-2">
              {statEntries.length > 0 ? (
                statEntries.map(([key, value]) => (
                  <div key={key} className="flex items-start justify-between gap-3">
                    <span className={`capitalize ${cardStyles.mutedClass}`}>
                      {formatLabel(key)}
                    </span>
                    <span className={`text-right ${cardStyles.valueClass}`}>
                      {formatSheetValue(value)}
                    </span>
                  </div>
                ))
              ) : (
                <div className={cardStyles.mutedClass}>No saved stats yet.</div>
              )}
            </div>
          ) : (
            <div className="mt-2 space-y-2 text-[11px]">
              <div className={`rounded-md bg-zinc-950/20 px-2 py-1 ${cardStyles.summaryClass}`}>
                <span className={cardStyles.mutedClass}>{compactRole}</span>
                <span className={`px-1 ${cardStyles.dividerClass}`}>|</span>
                <span className={cardStyles.valueClass}>{compactResource}</span>
                {armorClass ? (
                  <>
                    <span className={`px-1 ${cardStyles.dividerClass}`}>|</span>
                    <span className={cardStyles.mutedClass}>AC</span>
                    <span className="px-1" />
                    <span className={cardStyles.valueClass}>{armorClass}</span>
                  </>
                ) : null}
              </div>

              {expandedAttributeEntries.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {expandedAttributeEntries.map(([key, value]) => (
                    <div
                      key={key}
                      className="flex items-center gap-1 rounded-md bg-zinc-950/20 px-2 py-1"
                    >
                      <span className={`uppercase ${cardStyles.mutedClass}`}>
                        {key}
                      </span>
                      <span className={cardStyles.valueClass}>
                        {formatSheetValue(value)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : compactStatRows.length > 0 ? (
                compactStatRows.map((row, rowIndex) => (
                  <div key={`row-${rowIndex}`} className="grid gap-2 sm:grid-cols-2">
                    {row.map(([key, value]) => (
                      <div
                        key={key}
                        className="flex items-center justify-between gap-2 rounded-md bg-zinc-950/20 px-2 py-1"
                      >
                        <span className={`truncate capitalize ${cardStyles.mutedClass}`}>
                          {formatLabel(key)}
                        </span>
                        <span className={`shrink-0 text-right ${cardStyles.valueClass}`}>
                          {formatSheetValue(value)}
                        </span>
                      </div>
                    ))}
                    {row.length === 1 ? <div /> : null}
                  </div>
                ))
              ) : (
                <div className={cardStyles.mutedClass}>No saved stats yet.</div>
              )}
            </div>
          )}

          {fullDetail && detailEntries.length > 0 ? (
            <div className="mt-3 space-y-3 text-xs">
              {detailEntries.map(([key, value]) => (
                <div key={key}>
                  <div className={`mb-1 capitalize ${cardStyles.mutedClass}`}>
                    {formatLabel(key)}
                  </div>
                  <p className={`leading-5 ${cardStyles.valueClass}`}>
                    {formatSheetValue(value)}
                  </p>
                </div>
              ))}
            </div>
          ) : null}

          {fullDetail ? (
            <div className="mt-4 flex items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={onGeneratePortrait}
                  disabled={!hasPhysicalDescription || isGeneratingPortrait}
                  className="rounded-md border border-zinc-700 px-2 py-1 text-[10px] text-zinc-200 transition hover:border-zinc-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  title={
                    hasPhysicalDescription
                      ? "Generate portrait from physical description"
                      : "Add a physical description first"
                  }
                >
                  {isGeneratingPortrait
                    ? "Generating portrait..."
                    : portraitDataUrl
                      ? "Regenerate portrait"
                      : "Generate portrait"}
                </button>
                <label className="cursor-pointer rounded-md border border-zinc-700 px-2 py-1 text-[10px] text-zinc-200 transition hover:border-zinc-500 hover:text-white">
                  Upload portrait
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={onUploadPortrait}
                  />
                </label>
              </div>
              <button
                type="button"
                onClick={onDelete}
                disabled={isDeleting}
                className="rounded-md border border-red-900/60 px-2 py-1 text-[10px] text-red-300 transition hover:border-red-500/80 hover:text-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label={`Delete ${character.name}`}
                title={`Delete ${character.name}`}
              >
                {isDeleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function getSheetSource(sheetJson: Record<string, unknown> | null) {
  if (!sheetJson) {
    return "";
  }

  return typeof sheetJson.source === "string" ? sheetJson.source : "";
}

function formatLabel(value: string) {
  return value.replace(/([A-Z])/g, " $1");
}

function formatSheetValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.join(", ");
  }

  if (value && typeof value === "object") {
    if ("current" in value && "max" in value) {
      return `${String(value.current)}/${String(value.max)}`;
    }

    return Object.entries(value as Record<string, unknown>)
      .map(([key, nestedValue]) => `${formatLabel(key)} ${String(nestedValue)}`)
      .join(", ");
  }

  return String(value);
}

function getComparableSheetValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    if ("current" in value && typeof value.current === "number") {
      return value.current;
    }

    if ("max" in value && typeof value.max === "number") {
      return value.max;
    }

    if ("threshold" in value && typeof value.threshold === "number") {
      return value.threshold;
    }
  }

  return null;
}

function MessageBody({
  role,
  content,
}: {
  role: string;
  content: string;
}) {
  const displayContent = role === "gm" ? stripVisibleSceneMetadata(content) : content;
  const typographyClass =
    role === "gm"
      ? "text-[15px] leading-7 text-zinc-100"
      : role === "companion"
        ? "text-[14px] leading-6 text-emerald-100"
        : "text-[14px] leading-6 text-blue-50";
  const contentLines = displayContent
    .split("\n")
    .map((line) => line.trimEnd());

  return (
    <div className={typographyClass}>
      {contentLines.length > 0 ? (
        renderMessageLines(contentLines)
      ) : (
        <p>{renderStyledText(displayContent)}</p>
      )}
    </div>
  );
}

function renderMessageLines(lines: string[]) {
  const elements: React.ReactNode[] = [];
  let bufferedParagraph: string[] = [];
  let bufferedChoices: Array<{ id: string; text: string }> = [];

  function flushParagraph() {
    if (bufferedParagraph.length === 0) {
      return;
    }

    elements.push(
      <p key={`paragraph-${elements.length}`} className={elements.length > 0 ? "mt-3" : undefined}>
        {renderStyledText(bufferedParagraph.join(" "))}
      </p>,
    );
    bufferedParagraph = [];
  }

  function flushChoices() {
    if (bufferedChoices.length === 0) {
      return;
    }

    elements.push(
      <ol key={`choices-${elements.length}`} className="mt-3 list-decimal space-y-1 pl-6">
        {bufferedChoices.map((choice) => (
          <li key={choice.id} className="pl-1 marker:font-semibold marker:text-cyan-200">
            {renderStyledText(choice.text)}
          </li>
        ))}
      </ol>,
    );
    bufferedChoices = [];
  }

  lines.forEach((line) => {
    const trimmedLine = line.trim();
    const choiceMatch = trimmedLine.match(/^(\d+\.)\s+(.+)$/);

    if (!trimmedLine) {
      flushParagraph();
      flushChoices();
      return;
    }

    if (choiceMatch) {
      flushParagraph();
      bufferedChoices.push({
        id: choiceMatch[1],
        text: choiceMatch[2],
      });
      return;
    }

    if (/^roll:/i.test(trimmedLine)) {
      flushParagraph();
      flushChoices();
      elements.push(
        <div
          key={`roll-${elements.length}`}
          className="mt-3 rounded-lg border border-violet-400/20 bg-violet-500/10 px-3 py-2 text-[13px] leading-6 text-violet-100"
        >
          <span className="mr-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-violet-200/80">
            Roll
          </span>
          {renderStyledText(trimmedLine.replace(/^roll:\s*/i, ""))}
        </div>,
      );
      return;
    }

    flushChoices();
    bufferedParagraph.push(trimmedLine);
  });

  flushParagraph();
  flushChoices();

  return elements;
}

function resolveSubmittedAction(input: string, messages: ChatMessage[]) {
  const selectedNumbers = parseSelectedOptionNumbers(input);

  if (!selectedNumbers || selectedNumbers.length === 0) {
    return input;
  }

  const latestChoiceMap = getLatestChoiceMap(messages);

  if (latestChoiceMap.size === 0) {
    return input;
  }

  const selectedChoices = selectedNumbers
    .map((number) => latestChoiceMap.get(number))
    .filter((choice): choice is string => Boolean(choice));

  if (selectedChoices.length !== selectedNumbers.length) {
    return input;
  }

  return selectedChoices.join(" / ");
}

function parseSelectedOptionNumbers(input: string) {
  const normalized = input
    .trim()
    .replace(/\band\b/gi, ",")
    .replace(/[+\/|]/g, ",");

  if (!normalized) {
    return null;
  }

  const rawTokens = normalized
    .split(/[,\s]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  if (rawTokens.length === 0) {
    return null;
  }

  const parsedTokens = rawTokens.map((token) => token.replace(/\.$/, ""));

  if (parsedTokens.some((token) => !/^\d+$/.test(token))) {
    return null;
  }

  return parsedTokens.map((token) => Number(token));
}

function getLatestChoiceMap(messages: ChatMessage[]) {
  const latestGmMessage = [...messages]
    .reverse()
    .find((message) => message.role === "gm");

  if (!latestGmMessage) {
    return new Map<number, string>();
  }

  const visibleContent = stripVisibleSceneMetadata(latestGmMessage.content);
  const choiceMap = new Map<number, string>();

  visibleContent.split("\n").forEach((line) => {
    const match = line.trim().match(/^(\d+)\.\s+(.+)$/);

    if (!match) {
      return;
    }

    choiceMap.set(Number(match[1]), match[2].trim());
  });

  return choiceMap;
}

function getMessageBubbleStyles(
  message: ChatMessage,
  companionColorMap: Record<string, CompanionPalette>,
) {
  if (message.role === "user") {
    return {
      containerClass: "border-blue-700 bg-blue-950/80",
      labelClass: "text-cyan-200",
    };
  }

  if (message.role === "companion") {
    const palette = companionColorMap[message.speakerName] ?? COMPANION_PALETTES[0];

    return {
      containerClass: palette.bubbleContainerClass,
      labelClass: palette.bubbleLabelClass,
    };
  }

  return {
    containerClass: "border-amber-900/60 bg-zinc-900",
    labelClass: "text-amber-200",
  };
}

function getCharacterCardStyles(
  character: CampaignCharacter,
  companionColorMap: Record<string, CompanionPalette>,
) {
  if (character.isMainCharacter) {
    return {
      containerClass: "border-blue-700/70 bg-blue-950/30",
      nameClass: "text-blue-100",
      mutedClass: "text-blue-200/70",
      valueClass: "text-blue-50",
      summaryClass: "text-blue-100/90",
      dividerClass: "text-blue-300/30",
      hoverContainerClass: "hover:border-blue-500/85",
      toggleClass:
        "border-blue-700/70 text-blue-200 hover:border-blue-400 hover:text-blue-50",
    };
  }

  const palette = companionColorMap[character.name] ?? COMPANION_PALETTES[0];

  return {
    containerClass: palette.cardContainerClass,
    nameClass: palette.cardNameClass,
    mutedClass: palette.cardMutedClass,
      valueClass: palette.cardValueClass,
      summaryClass: palette.cardSummaryClass,
      dividerClass: palette.cardDividerClass,
      hoverContainerClass: palette.hoverContainerClass,
      toggleClass: palette.cardToggleClass,
  };
}

type CompanionPalette = {
  bubbleContainerClass: string;
  bubbleLabelClass: string;
  cardContainerClass: string;
  cardNameClass: string;
  cardMutedClass: string;
  cardValueClass: string;
  cardSummaryClass: string;
  cardDividerClass: string;
  hoverContainerClass: string;
  cardToggleClass: string;
};

const COMPANION_PALETTES: CompanionPalette[] = [
  {
    bubbleContainerClass: "border-emerald-800/70 bg-emerald-950/40",
    bubbleLabelClass: "text-emerald-200",
    cardContainerClass: "border-emerald-800/70 bg-emerald-950/22",
    cardNameClass: "text-emerald-100",
    cardMutedClass: "text-emerald-200/70",
    cardValueClass: "text-emerald-50",
    cardSummaryClass: "text-emerald-100/90",
    cardDividerClass: "text-emerald-300/30",
    hoverContainerClass: "hover:border-emerald-500/85",
    cardToggleClass:
      "border-emerald-700/70 text-emerald-200 hover:border-emerald-400 hover:text-emerald-50",
  },
  {
    bubbleContainerClass: "border-fuchsia-800/60 bg-fuchsia-950/35",
    bubbleLabelClass: "text-fuchsia-200",
    cardContainerClass: "border-fuchsia-800/60 bg-fuchsia-950/20",
    cardNameClass: "text-fuchsia-100",
    cardMutedClass: "text-fuchsia-200/70",
    cardValueClass: "text-fuchsia-50",
    cardSummaryClass: "text-fuchsia-100/90",
    cardDividerClass: "text-fuchsia-300/30",
    hoverContainerClass: "hover:border-fuchsia-500/85",
    cardToggleClass:
      "border-fuchsia-700/70 text-fuchsia-200 hover:border-fuchsia-400 hover:text-fuchsia-50",
  },
  {
    bubbleContainerClass: "border-lime-800/60 bg-lime-950/35",
    bubbleLabelClass: "text-lime-200",
    cardContainerClass: "border-lime-800/60 bg-lime-950/20",
    cardNameClass: "text-lime-100",
    cardMutedClass: "text-lime-200/70",
    cardValueClass: "text-lime-50",
    cardSummaryClass: "text-lime-100/90",
    cardDividerClass: "text-lime-300/30",
    hoverContainerClass: "hover:border-lime-500/85",
    cardToggleClass:
      "border-lime-700/70 text-lime-200 hover:border-lime-400 hover:text-lime-50",
  },
  {
    bubbleContainerClass: "border-orange-800/60 bg-orange-950/35",
    bubbleLabelClass: "text-orange-200",
    cardContainerClass: "border-orange-800/60 bg-orange-950/18",
    cardNameClass: "text-orange-100",
    cardMutedClass: "text-orange-200/70",
    cardValueClass: "text-orange-50",
    cardSummaryClass: "text-orange-100/90",
    cardDividerClass: "text-orange-300/30",
    hoverContainerClass: "hover:border-orange-500/85",
    cardToggleClass:
      "border-orange-700/70 text-orange-200 hover:border-orange-400 hover:text-orange-50",
  },
  {
    bubbleContainerClass: "border-amber-800/60 bg-amber-950/35",
    bubbleLabelClass: "text-amber-200",
    cardContainerClass: "border-amber-800/60 bg-amber-950/20",
    cardNameClass: "text-amber-100",
    cardMutedClass: "text-amber-200/70",
    cardValueClass: "text-amber-50",
    cardSummaryClass: "text-amber-100/90",
    cardDividerClass: "text-amber-300/30",
    hoverContainerClass: "hover:border-amber-500/85",
    cardToggleClass:
      "border-amber-700/70 text-amber-200 hover:border-amber-400 hover:text-amber-50",
  },
  {
    bubbleContainerClass: "border-rose-800/60 bg-rose-950/35",
    bubbleLabelClass: "text-rose-200",
    cardContainerClass: "border-rose-800/60 bg-rose-950/20",
    cardNameClass: "text-rose-100",
    cardMutedClass: "text-rose-200/70",
    cardValueClass: "text-rose-50",
    cardSummaryClass: "text-rose-100/90",
    cardDividerClass: "text-rose-300/30",
    hoverContainerClass: "hover:border-rose-500/85",
    cardToggleClass:
      "border-rose-700/70 text-rose-200 hover:border-rose-400 hover:text-rose-50",
  },
];

function buildCompanionColorMap(companions: CampaignCharacter[]) {
  return companions.reduce<Record<string, CompanionPalette>>((map, companion, index) => {
    map[companion.name] = COMPANION_PALETTES[index % COMPANION_PALETTES.length];
    return map;
  }, {});
}

function renderStyledText(text: string) {
  const toneSegments = text.split(/(\*[^*]+\*)/g).filter(Boolean);

  return toneSegments.map((segment, index) => {
    const isTone = segment.startsWith("*") && segment.endsWith("*") && segment.length > 1;
    const rawText = isTone ? segment.slice(1, -1) : segment;

    return (
      <span
        key={`${rawText}-${index}`}
        className={isTone ? "italic text-zinc-50" : undefined}
      >
        {renderSemanticTokens(rawText)}
      </span>
    );
  });
}

function renderSemanticTokens(text: string) {
  const warningWords = new Set([
    "danger",
    "dangerous",
    "warning",
    "warn",
    "wounded",
    "bleeding",
    "burning",
    "critical",
    "threat",
    "threatens",
    "damage",
    "damaged",
    "injured",
    "pain",
    "dies",
    "death",
    "hostile",
  ]);
  const successWords = new Set([
    "heal",
    "healed",
    "healing",
    "recover",
    "recovered",
    "recovery",
    "success",
    "succeeds",
    "successful",
    "restored",
    "restore",
    "stabilized",
    "safe",
    "saved",
    "benefit",
    "boon",
  ]);
  const rollWords = new Set([
    "roll",
    "rolls",
    "rolled",
    "dice",
    "check",
    "checks",
  ]);
  const insightWords = new Set([
    "insight",
    "notice",
    "notices",
    "realize",
    "realizes",
    "realized",
    "sense",
    "senses",
    "intuition",
    "clue",
    "clues",
  ]);
  return text.split(/(\s+)/).map((token, index) => {
    if (!token.trim()) {
      return token;
    }

    const normalized = token.toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g, "");
    const semanticStyle = warningWords.has(normalized)
      ? { colorClass: "text-amber-300", icon: "⚠", iconClass: "text-amber-400/80" }
      : successWords.has(normalized)
        ? { colorClass: "text-emerald-300", icon: "❤️", iconClass: "text-emerald-400/80" }
        : rollWords.has(normalized)
          ? { colorClass: "text-violet-200", icon: "🎲", iconClass: "text-violet-300/75" }
          : insightWords.has(normalized)
            ? { colorClass: "text-sky-200", icon: "🧠", iconClass: "text-sky-300/75" }
            : null;

    return semanticStyle ? (
      <span key={`${token}-${index}`} className={semanticStyle.colorClass}>
        <span aria-hidden="true" className={`mr-1 inline-block ${semanticStyle.iconClass}`}>
          {semanticStyle.icon}
        </span>
        {token}
      </span>
    ) : (
      token
    );
  });
}

function getCompactRole(sheetJson: Record<string, unknown> | null) {
  if (!sheetJson) {
    return "Unknown";
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
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return "Unknown";
}

function getCompactResource(sheetJson: Record<string, unknown> | null) {
  if (!sheetJson) {
    return "N/A";
  }

  const hp = sheetJson.hp;
  if (hp && typeof hp === "object" && !Array.isArray(hp)) {
    if ("current" in hp && "max" in hp) {
      return `${String(hp.current)}/${String(hp.max)}`;
    }
  }
  if (typeof hp === "number") {
    return String(hp);
  }

  const health = sheetJson.health;
  if (typeof health === "number") {
    return String(health);
  }

  const wind = sheetJson.wind;
  if (typeof wind === "number") {
    return String(wind);
  }

  const wounds = sheetJson.wounds;
  if (wounds && typeof wounds === "object" && !Array.isArray(wounds)) {
    if ("current" in wounds && "threshold" in wounds) {
      return `${String(wounds.current)}/${String(wounds.threshold)}`;
    }
  }

  const sanity = sheetJson.sanity;
  if (typeof sanity === "number") {
    return String(sanity);
  }

  const toughness = sheetJson.toughness;
  if (typeof toughness === "number") {
    return String(toughness);
  }

  return "N/A";
}

function CharacterQuestionField({
  question,
  value,
  onChange,
}: {
  question: CharacterQuestion;
  value: string | number | undefined;
  onChange: (value: string | number) => void;
}) {
  const wrapperClass =
    question.kind === "textarea" ? "md:col-span-2 space-y-2" : "space-y-2";

  if (question.kind === "select") {
    return (
      <div className={wrapperClass}>
        <label className="block text-sm font-medium text-emerald-50">
          {question.label}
        </label>
        <select
          value={typeof value === "string" ? value : String(question.defaultValue ?? "")}
          onChange={(event) => onChange(event.target.value)}
          className="w-full rounded-xl border border-emerald-200/15 bg-zinc-950 px-3 py-2 outline-none focus:border-emerald-300/50"
        >
          {question.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {question.helpText ? (
          <p className="text-xs text-emerald-50/70">{question.helpText}</p>
        ) : null}
      </div>
    );
  }

  if (question.kind === "number") {
    return (
      <div className={wrapperClass}>
        <label className="block text-sm font-medium text-emerald-50">
          {question.label}
        </label>
        <input
          type="number"
          min={question.min}
          max={question.max}
          value={
            typeof value === "number"
              ? value
              : typeof question.defaultValue === "number"
                ? question.defaultValue
                : ""
          }
          onChange={(event) => onChange(Number(event.target.value))}
          className="w-full rounded-xl border border-emerald-200/15 bg-zinc-950 px-3 py-2 outline-none focus:border-emerald-300/50"
        />
        {question.helpText ? (
          <p className="text-xs text-emerald-50/70">{question.helpText}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className={wrapperClass}>
      <label className="block text-sm font-medium text-emerald-50">
        {question.label}
      </label>
      <textarea
        value={typeof value === "string" ? value : String(question.defaultValue ?? "")}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-[90px] w-full rounded-xl border border-emerald-200/15 bg-zinc-950 px-3 py-2 outline-none focus:border-emerald-300/50"
      />
      {question.helpText ? (
        <p className="text-xs text-emerald-50/70">{question.helpText}</p>
      ) : null}
    </div>
  );
}

function buildDefaultAnswers(questions: CharacterQuestion[]) {
  return questions.reduce<Record<string, string | number>>((answers, question) => {
    if (typeof question.defaultValue === "string" || typeof question.defaultValue === "number") {
      answers[question.id] = question.defaultValue;
    } else if (question.kind === "select" && question.options?.[0]) {
      answers[question.id] = question.options[0].value;
    } else if (question.kind === "number") {
      answers[question.id] = question.min ?? 0;
    } else {
      answers[question.id] = "";
    }

    return answers;
  }, {});
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === "string" && reader.result.startsWith("data:image/")) {
        resolve(reader.result);
        return;
      }

      reject(new Error("Invalid image file."));
    };

    reader.onerror = () => reject(reader.error ?? new Error("Unable to read file."));
    reader.readAsDataURL(file);
  });
}

function buildSceneSummary(
  campaign: CampaignDetails | null,
  messages: ChatMessage[],
): SceneSummary {
  const latestGmMessage = [...messages]
    .reverse()
    .find((message) => message.role === "gm");
  const extractedScene = latestGmMessage
    ? extractSceneBlock(latestGmMessage.content)
    : null;

  const baseText = latestGmMessage?.content?.trim() ?? "";
  const sanitizedText = stripChoiceLines(stripSceneBlock(baseText));
  const inferredLocation = inferSceneLocation(sanitizedText);
  const sceneTitle = inferSceneTitle(
    sanitizedText,
    inferredLocation,
    campaign?.title || DEFAULT_SCENE_SUMMARY.sceneTitle,
  );
  const lowerText = sanitizedText.toLowerCase();

  const heuristicScene: SceneSummary = {
    sceneTitle,
    location: inferredLocation,
    mood: inferSceneMood(lowerText),
    threat: inferSceneThreat(lowerText),
    goal: inferSceneGoal(sanitizedText),
    clock: inferSceneClock(lowerText),
    context: inferSceneContext(sanitizedText),
  };

  if (extractedScene?.scene) {
    return {
      sceneTitle:
        extractedScene.scene.sceneTitle === DEFAULT_SCENE_SUMMARY.sceneTitle
          ? heuristicScene.sceneTitle
          : extractedScene.scene.sceneTitle,
      location:
        extractedScene.scene.location === DEFAULT_SCENE_SUMMARY.location
          ? heuristicScene.location
          : extractedScene.scene.location,
      mood: normalizeSceneMood(
        extractedScene.scene.mood === DEFAULT_SCENE_SUMMARY.mood
          ? heuristicScene.mood
          : extractedScene.scene.mood,
      ),
      threat: normalizeSceneThreat(
        extractedScene.scene.threat === DEFAULT_SCENE_SUMMARY.threat
          ? heuristicScene.threat
          : extractedScene.scene.threat,
      ),
      goal:
        extractedScene.scene.goal === DEFAULT_SCENE_SUMMARY.goal
          ? heuristicScene.goal
          : extractedScene.scene.goal,
      clock: normalizeSceneClock(
        extractedScene.scene.clock === DEFAULT_SCENE_SUMMARY.clock
          ? heuristicScene.clock
          : extractedScene.scene.clock,
      ),
      context:
        extractedScene.scene.context === DEFAULT_SCENE_SUMMARY.context
          ? heuristicScene.context
          : extractedScene.scene.context,
    };
  }

  return {
    ...heuristicScene,
    mood: normalizeSceneMood(heuristicScene.mood),
    threat: normalizeSceneThreat(heuristicScene.threat),
    clock: normalizeSceneClock(heuristicScene.clock),
  };
}

function stripChoiceLines(text: string) {
  return text
    .split("\n")
    .filter((line) => !/^\s*\d+\.\s+/.test(line))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function inferSceneLocation(text: string) {
  const namedLocationMatch = text.match(
    /\b(?:in|at|inside|outside|near)\s+(?:the\s+)?([A-Z][A-Za-z0-9' -]*?(?:Taproom|Tavern|Inn|Court|Temple|Station|Outpost|Moon|Gallery|Market|Train|Street|Hall|Keep|Camp|Manor|Dock|Plaza))/,
  );

  if (namedLocationMatch?.[1]) {
    return namedLocationMatch[1].trim();
  }

  const genericLocationMatch = text.match(
    /\b(?:in|at|inside|outside|near)\s+(?:the\s+)?(taproom|tavern|inn|court|temple|station|outpost|gallery|market|train|street|hall|keep|camp|manor|dock|plaza)\b/i,
  );

  if (genericLocationMatch?.[1]) {
    return capitalizeSentence(genericLocationMatch[1].trim());
  }

  return DEFAULT_SCENE_SUMMARY.location;
}

function inferSceneTitle(
  text: string,
  location: string,
  fallback: string,
) {
  const trimmed = text.trim();
  const lowerText = trimmed.toLowerCase();
  const locationText =
    location && location !== DEFAULT_SCENE_SUMMARY.location ? location : "";

  const scenePatternTitle = inferScenePatternTitle(lowerText, locationText);
  if (scenePatternTitle) {
    return shortenSceneHeading(scenePatternTitle, 42);
  }

  const waitingMatch = trimmed.match(
    /\b(?:group|party|crew|coterie|investigators?|heroes?)\s+(?:starts?|begin|begins?|gathers?|waits?|waiting)\s+(?:in|at|inside|outside|near)\s+([^.,!?]+?)(?:\s+(?:waiting|for|when|while)\b|[.,!?]|$)/i,
  );
  if (waitingMatch?.[1]) {
    return shortenSceneHeading(
      `Waiting in ${normalizeScenePlace(waitingMatch[1])}`,
      42,
    );
  }

  const meetsMatch = trimmed.match(
    /\b(?:group|party|crew|coterie|investigators?|heroes?)\s+(?:meets?|gathers?)\s+(?:in|at)\s+([^.,!?]+?)(?:[.,!?]|$)/i,
  );
  if (meetsMatch?.[1]) {
    return shortenSceneHeading(
      `Meeting at ${normalizeScenePlace(meetsMatch[1])}`,
      42,
    );
  }

  if (locationText) {
    const locationLead = locationText.match(
      /\b(.+?)\s+(?:Tavern|Inn|Court|Temple|Station|Outpost|Moon|Gallery|Market|Train|Street|Hall|Keep|Camp|Manor|Dock|Plaza)\b/i,
    );
    if (/\bwait|waiting\b/i.test(trimmed)) {
      return shortenSceneHeading(
        `Waiting in ${locationLead ? locationText : locationText}`,
        42,
      );
    }

    if (/\barrive|arrives|arrival\b/i.test(trimmed)) {
      return shortenSceneHeading(`Arrival at ${locationText}`, 42);
    }

    if (/\bmeet|meets|meeting\b/i.test(trimmed)) {
      return shortenSceneHeading(`Meeting at ${locationText}`, 42);
    }

    return shortenSceneHeading(locationText, 42);
  }

  const firstSentence = trimmed
    .split(/(?<=[.!?])\s+/)
    .find((sentence) => sentence.trim());

  if (firstSentence) {
    return shortenSceneHeading(
      firstSentence.replace(/^(group|party|crew|coterie|investigators?|heroes?)\s+/i, ""),
      42,
    );
  }

  return shortenSceneHeading(fallback, 42);
}

function normalizeScenePlace(place: string) {
  const trimmed = place.trim().replace(/^(the)\s+/i, "the ");

  if (/^(a|an|the)\b/i.test(trimmed)) {
    return trimmed;
  }

  return `the ${trimmed}`;
}

function inferScenePatternTitle(text: string, location: string) {
  const place = location ? formatScenePlaceLabel(location) : "";

  if (/(brawl|bar fight|melee|chair|fistfight|tables? splinter|smash|smashed)/.test(text)) {
    return place ? `Brawl - ${place}` : "Brawl";
  }

  if (/(ambush|assassin|attack|raiders|hostile|gunfire|blades drawn|combat erupts)/.test(text)) {
    return place ? `Ambush - ${place}` : "Ambush";
  }

  if (/(meeting|contact|letter|stranger|hooded figure|messenger|summons)/.test(text)) {
    return place ? `Meeting - ${place}` : "Tense Meeting";
  }

  if (/(crime scene|body|corpse|murder|blood|locked room|investigation)/.test(text)) {
    return place ? `Investigation - ${place}` : "Investigation";
  }

  if (/(court|diplomat|governor|scandal|accus|clan|winter court)/.test(text)) {
    return place ? `Intrigue - ${place}` : "Court Intrigue";
  }

  if (/(masquerade|elysium|prince|breach|coterie)/.test(text)) {
    return place ? `Masquerade Trouble - ${place}` : "Masquerade Trouble";
  }

  if (/(distress signal|hyperspace|imperial|patrol|outer rim|debris field)/.test(text)) {
    return place ? `Distress Call - ${place}` : "Distress Call";
  }

  if (/(rift|portal|tear opens|dimensional|beacon)/.test(text)) {
    return place ? `Rift Crisis - ${place}` : "Rift Crisis";
  }

  return "";
}

function formatScenePlaceLabel(location: string) {
  return location.trim() || DEFAULT_SCENE_SUMMARY.location;
}

function inferSceneMood(text: string) {
  if (/(suspicious|uneasy|watchful|tense)/.test(text)) {
    return "Suspicious";
  }
  if (/(grim|fear|dread|ominous|dark)/.test(text)) {
    return "Grim";
  }
  if (/(chaos|panic|urgent|crisis)/.test(text)) {
    return "Chaotic";
  }
  if (/(quiet|calm|still)/.test(text)) {
    return "Quiet";
  }

  return "Tense";
}

function normalizeSceneMood(mood: string) {
  const normalized = mood.trim().toLowerCase();

  if (/(suspicious|uneasy|watchful|wary)/.test(normalized)) {
    return "Suspicious";
  }
  if (/(grim|fear|dread|ominous|dark|brooding)/.test(normalized)) {
    return "Grim";
  }
  if (/(chaos|chaotic|panic|urgent|crisis|violent|volatile)/.test(normalized)) {
    return "Chaotic";
  }
  if (/(quiet|calm|still|steady)/.test(normalized)) {
    return "Quiet";
  }

  return "Tense";
}

function inferSceneThreat(text: string) {
  if (/(critical|deadly|overwhelming|immediate danger|severe)/.test(text)) {
    return "High Threat";
  }
  if (/(danger|hostile|attack|ambush|armed|threat)/.test(text)) {
    return "Medium Threat";
  }

  return "Low Threat";
}

function normalizeSceneThreat(threat: string) {
  const normalized = threat.trim().toLowerCase();

  if (
    /(critical|deadly|overwhelming|immediate|severe|high|lethal)/.test(
      normalized,
    )
  ) {
    return "High Threat";
  }

  if (/(medium|rising|danger|hostile|attack|armed|unstable)/.test(normalized)) {
    return "Medium Threat";
  }

  return "Low Threat";
}

function inferSceneGoal(text: string) {
  const choiceMatch = text.match(/\b(?:must|need to|try to|goal is to)\s+([^.!?]+)/i);
  if (choiceMatch?.[1]) {
    return capitalizeSentence(choiceMatch[1].trim());
  }

  return "Decide the next move";
}

function inferSceneClock(text: string) {
  const clockMatch = text.match(/\b(?:in|within|before)\s+(\d+\s+(?:min|minutes|hour|hours|rounds?))/i);
  if (clockMatch?.[1]) {
    return capitalizeSentence(clockMatch[1].trim());
  }

  if (/(urgent|quickly|closing|countdown|soon)/.test(text)) {
    return "Time pressure rising";
  }

  return "No visible timer";
}

function normalizeSceneClock(clock: string) {
  const normalized = clock.trim().toLowerCase();
  const timeMatch = normalized.match(
    /(\d+\s*(?:min|mins|minute|minutes|hour|hours|round|rounds))/,
  );

  if (timeMatch?.[1]) {
    const value = timeMatch[1]
      .replace(/\bmins\b/, "min")
      .replace(/\bminutes\b/, "min")
      .replace(/\bminute\b/, "min")
      .replace(/\bhours\b/, "hr")
      .replace(/\bhour\b/, "hr")
      .replace(/\brounds\b/, "rounds")
      .replace(/\bround\b/, "round")
      .replace(/\s+/g, " ")
      .trim();

    return capitalizeSentence(value);
  }

  if (/(urgent|rising|countdown|soon|closing|immediate|seconds)/.test(normalized)) {
    return "Immediate";
  }

  if (/(no visible timer|none|stable|open-ended)/.test(normalized)) {
    return "No timer";
  }

  return "No timer";
}

function inferSceneContext(text: string) {
  const matches = Array.from(text.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g))
    .map((match) => match[1])
    .filter((value) =>
      ![
        "GM",
        "Player",
        "Roll",
        "Danger",
        "Heals",
        "Success",
        "Realizes",
      ].includes(value),
    );
  const unique = [...new Set(matches)].slice(0, 3);

  return unique.length > 0 ? unique.join(", ") : "Active scene";
}

function capitalizeSentence(text: string) {
  if (!text) {
    return text;
  }

  return text.charAt(0).toUpperCase() + text.slice(1);
}

function buildResolvedSceneHeading(sceneSummary: SceneSummary) {
  const location = sceneSummary.location.trim();
  const title = sceneSummary.sceneTitle.trim();
  const maxHeadingLength = 62;

  if (
    !location ||
    location === DEFAULT_SCENE_SUMMARY.location ||
    location === "Current Location"
  ) {
    return shortenSceneHeading(title, maxHeadingLength);
  }

  if (!title || title === DEFAULT_SCENE_SUMMARY.sceneTitle) {
    return shortenSceneHeading(location, maxHeadingLength);
  }

  if (
    title.toLowerCase().includes(location.toLowerCase()) ||
    title.toLowerCase() === location.toLowerCase()
  ) {
    return shortenSceneHeading(title, maxHeadingLength);
  }

  return shortenSceneHeading(`${title} - ${location}`, maxHeadingLength);
}

export function buildSceneHeading(sceneSummary: SceneSummary) {
  const location = sceneSummary.location.trim();
  const title = sceneSummary.sceneTitle.trim();

  if (!location || location === "Current Location") {
    return shortenSceneHeading(title, 42);
  }

  if (
    title.toLowerCase().includes(location.toLowerCase()) ||
    title.toLowerCase() === location.toLowerCase()
  ) {
    return shortenSceneHeading(title, 42);
  }

  return shortenSceneHeading(`${location} — ${title}`, 42);
}

function stripVisibleSceneMetadata(text: string) {
  const withoutSceneBlock = stripSceneBlock(text);

  return withoutSceneBlock
    .replace(
      /^\s*SCENE:\s*\n(?:\s*(?:Title|Place|Mood|Threat|Goal|Clock|Context):[^\n]*\n?)+(?:\s*ENDSCENE\s*\n?)?/i,
      "",
    )
    .trim();
}

function shortenSceneHeading(text: string, maxLength: number) {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 3).trim()}...`;
}

function getMoodBadgeClass(mood: string) {
  const normalized = mood.toLowerCase();

  if (/(grim|dark|ominous)/.test(normalized)) {
    return "bg-violet-500/15 text-violet-200 ring-1 ring-violet-400/20";
  }

  if (/(quiet|calm|still)/.test(normalized)) {
    return "bg-sky-500/15 text-sky-200 ring-1 ring-sky-400/20";
  }

  return "bg-amber-500/15 text-amber-200 ring-1 ring-amber-400/20";
}

function getThreatBadgeClass(threat: string) {
  const normalized = threat.toLowerCase();

  if (normalized.includes("high")) {
    return "bg-red-500/15 text-red-200 ring-1 ring-red-400/20";
  }

  if (normalized.includes("medium")) {
    return "bg-yellow-500/15 text-yellow-200 ring-1 ring-yellow-400/20";
  }

  return "bg-lime-500/15 text-lime-200 ring-1 ring-lime-400/20";
}

function getClockBadgeClass(clock: string) {
  const normalized = clock.toLowerCase();

  if (/(10 min|minute|minutes|urgent|rising|countdown|soon|before|within)/.test(normalized)) {
    return "bg-orange-500/15 text-orange-200 ring-1 ring-orange-400/20";
  }

  if (/(hour|hours)/.test(normalized)) {
    return "bg-rose-500/15 text-rose-200 ring-1 ring-rose-400/20";
  }

  return "bg-zinc-800 text-zinc-200 ring-1 ring-zinc-700";
}
