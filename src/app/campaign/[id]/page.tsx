"use client";

import {
  ChangeEvent,
  FormEvent,
  MouseEvent,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import Image from "next/image";
import { useParams } from "next/navigation";
import {
  getCharacterQuestionnaire,
  getVisibleCharacterQuestions,
  validateCharacterAnswersDetailed,
  type CharacterQuestion,
} from "@/lib/campaigns";
import {
  DEFAULT_SCENE_SUMMARY,
  extractSceneBlock,
  stripSceneBlock,
  type SceneSummary,
} from "@/lib/scene";
import {
  DEFAULT_PARTY_STATE,
  type NarrationLevel,
  type PartyReputationEntry,
  extractPartyBlock,
  normalizePartyState,
  type PartyState,
} from "@/lib/party";
import {
  DEFAULT_COMBAT_STATE,
  extractCombatBlock,
  type CombatRosterEntry,
  type CombatState,
} from "@/lib/combat";
import {
  type WorldMapHistoryEntry,
  type WorldMapPin,
  type SceneImageHistoryEntry,
  type SceneMapState,
  type WorldMapState,
} from "@/lib/map";
import { buildSceneMapImagePrompt } from "@/lib/map-prompt";
import {
  CAMPAIGN_CHAT_MODELS,
  DEFAULT_CAMPAIGN_CHAT_MODEL,
  type CampaignChatModel,
} from "@/lib/chat-model";
import {
  buildProgressionInsights,
  DEFAULT_PROGRESSION_STATE,
  type ProgressionEvent,
  type ProgressionInsights,
  type ProgressionMode,
  type ProgressionState,
} from "@/lib/progression";

type ChatMessage = {
  id?: string;
  speakerName: string;
  role: string;
  content: string;
};

type CampaignCharacter = {
  id: string;
  originLibraryCharacterId?: string | null;
  name: string;
  role: string;
  isMainCharacter: boolean;
  sheetJson: Record<string, unknown> | null;
  memorySummary: string | null;
};

type EditableSheetValue =
  | string
  | number
  | boolean
  | null
  | EditableSheetObject
  | EditableSheetValue[];

type EditableSheetObject = {
  [key: string]: EditableSheetValue;
};

type CampaignDetails = {
  id: string;
  title: string;
  ruleset: string;
  chatModel: CampaignChatModel;
  progressionStateJson: ProgressionState;
  progressionEventsJson: ProgressionEvent[];
  partyStateJson: PartyState;
  combatStateJson: CombatState;
  mapStateJson: SceneMapState | null;
  worldMapJson: WorldMapState | null;
  worldMapHistoryJson: WorldMapHistoryEntry[];
  sceneImageHistoryJson: SceneImageHistoryEntry[];
  characters: CampaignCharacter[];
};

type PartyStateDraft = {
  narrationLevel: NarrationLevel;
  partyName: string;
  summary: string;
  recap: string;
  activeQuests: string;
  completedQuests: string;
  journal: string;
  reputation: PartyReputationEntry[];
  sharedInventory: string;
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

const WORLD_MAP_PIN_COLORS = [
  "#fbbf24",
  "#ef4444",
  "#22c55e",
  "#38bdf8",
  "#a855f7",
  "#f97316",
  "#e879f9",
  "#ffffff",
] as const;

type ConfirmationState =
  | {
      kind: "reset";
      title: string;
      message: string;
      confirmLabel: string;
    }
  | {
      kind: "undo-last-turn";
      title: string;
      message: string;
      confirmLabel: string;
    }
  | {
      kind: "reset-progression";
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
    }
  | {
      kind: "update-master";
      title: string;
      message: string;
      confirmLabel: string;
      character: CampaignCharacter;
    }
  | {
      kind: "delete-scene-image";
      title: string;
      message: string;
      confirmLabel: string;
      imageIndex: number;
    }
  | {
      kind: "delete-world-map";
      title: string;
      message: string;
      confirmLabel: string;
      mapIndex: number;
    };

type DebugSnapshot = {
  scene: SceneSummary;
  stateUpdates: unknown;
  partyUpdate: unknown;
  combatUpdate: unknown;
} | null;

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
  const [isAutofillingCharacter, setIsAutofillingCharacter] = useState(false);
  const [collapsedCards, setCollapsedCards] = useState<Record<string, boolean>>({});
  const [detailCardId, setDetailCardId] = useState("");
  const [scenarioDraft, setScenarioDraft] = useState("");
  const [isScenarioActive, setIsScenarioActive] = useState(false);
  const [isTogglingScenario, setIsTogglingScenario] = useState(false);
  const [isSavingScenario, setIsSavingScenario] = useState(false);
  const [isResyncingState, setIsResyncingState] = useState(false);
  const [isUndoingTurn, setIsUndoingTurn] = useState(false);
  const [debugStateLoggingEnabled, setDebugStateLoggingEnabled] = useState(false);
  const [isUtilityMenuOpen, setIsUtilityMenuOpen] = useState(false);
  const [isDebugInspectorOpen, setIsDebugInspectorOpen] = useState(false);
  const [deletingCharacterId, setDeletingCharacterId] = useState("");
  const [exportingCharacterId, setExportingCharacterId] = useState("");
  const [generatingPortraitId, setGeneratingPortraitId] = useState("");
  const [activeSidebarView, setActiveSidebarView] = useState<
    "characters" | "party" | "map" | "images"
  >("characters");
  const [partyStateDraft, setPartyStateDraft] = useState<PartyStateDraft>(
    buildPartyStateDraft(DEFAULT_PARTY_STATE),
  );
  const [activePartyTab, setActivePartyTab] = useState<
    "info" | "reputation" | "quests" | "journal" | "recap" | "progression"
  >("info");
  const [isEditingPartyState, setIsEditingPartyState] = useState(false);
  const [isSavingPartyState, setIsSavingPartyState] = useState(false);
  const [isSavingChatModel, setIsSavingChatModel] = useState(false);
  const [isSavingProgressionMode, setIsSavingProgressionMode] = useState(false);
  const [isSavingProgressionAutomation, setIsSavingProgressionAutomation] = useState(false);
  const [isSavingProgressionEvent, setIsSavingProgressionEvent] = useState(false);
  const [isApplyingProgressionLevels, setIsApplyingProgressionLevels] = useState(false);
  const [isManagingProgressionEvents, setIsManagingProgressionEvents] = useState(false);
  const [progressionAmountInput, setProgressionAmountInput] = useState("100");
  const [progressionReasonInput, setProgressionReasonInput] = useState("");
  const [progressionNoteInput, setProgressionNoteInput] = useState("");
  const [progressionRecipientType, setProgressionRecipientType] = useState<
    "party" | "character"
  >("party");
  const [progressionRecipientCharacterIds, setProgressionRecipientCharacterIds] = useState<
    string[]
  >([]);
  const [isRefreshingRecap, setIsRefreshingRecap] = useState(false);
  const [isRefreshingMap, setIsRefreshingMap] = useState(false);
  const [sceneImagePrompt, setSceneImagePrompt] = useState("");
  const [isGeneratingWorldMap, setIsGeneratingWorldMap] = useState(false);
  const [isSavingWorldMap, setIsSavingWorldMap] = useState(false);
  const [isSavingWorldMapTitle, setIsSavingWorldMapTitle] = useState(false);
  const [isDeletingWorldMap, setIsDeletingWorldMap] = useState(false);
  const [isWorldMapMenuOpen, setIsWorldMapMenuOpen] = useState(false);
  const [isEditingWorldMapTitle, setIsEditingWorldMapTitle] = useState(false);
  const [isWorldMapViewerOpen, setIsWorldMapViewerOpen] = useState(false);
  const [isSavingWorldMapPins, setIsSavingWorldMapPins] = useState(false);
  const [newWorldMapPinLabel, setNewWorldMapPinLabel] = useState("");
  const [newWorldMapPinColor, setNewWorldMapPinColor] = useState<string>(
    WORLD_MAP_PIN_COLORS[0],
  );
  const [selectedWorldMapPinId, setSelectedWorldMapPinId] = useState("");
  const [pendingWorldMapPinPosition, setPendingWorldMapPinPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [worldMapPrompt, setWorldMapPrompt] = useState("");
  const [worldMapTitleInput, setWorldMapTitleInput] = useState("");
  const [activeWorldMapTab, setActiveWorldMapTab] = useState<"saved" | "generate">(
    "saved",
  );
  const [activeWorldMapIndex, setActiveWorldMapIndex] = useState(0);
  const [worldMapReferenceUrl, setWorldMapReferenceUrl] = useState("");
  const [activeSceneImageIndex, setActiveSceneImageIndex] = useState(0);
  const [isSceneImageMenuOpen, setIsSceneImageMenuOpen] = useState(false);
  const [isEditingSceneImageMeta, setIsEditingSceneImageMeta] = useState(false);
  const [hasAutoCollapsedForCombat, setHasAutoCollapsedForCombat] = useState(false);
  const [sceneImageDraft, setSceneImageDraft] = useState({
    sceneTitle: "",
    place: "",
  });
  const [confirmationState, setConfirmationState] = useState<ConfirmationState | null>(null);
  const [debugSnapshot, setDebugSnapshot] = useState<DebugSnapshot>(null);

  useEffect(() => {
    try {
      setDebugStateLoggingEnabled(
        window.localStorage.getItem("debug-state-logging") === "true",
      );
    } catch {
      setDebugStateLoggingEnabled(false);
    }
  }, []);

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
          setCampaign({
            ...campaignData.campaign,
            chatModel:
              campaignData.campaign.chatModel ?? DEFAULT_CAMPAIGN_CHAT_MODEL,
            progressionStateJson:
              campaignData.campaign.progressionStateJson ?? DEFAULT_PROGRESSION_STATE,
            progressionEventsJson: Array.isArray(
              campaignData.campaign.progressionEventsJson,
            )
              ? (campaignData.campaign.progressionEventsJson as ProgressionEvent[])
              : [],
            combatStateJson: campaignData.campaign.combatStateJson ?? DEFAULT_COMBAT_STATE,
            worldMapJson: campaignData.campaign.worldMapJson ?? null,
            worldMapHistoryJson: Array.isArray(campaignData.campaign.worldMapHistoryJson)
              ? (campaignData.campaign.worldMapHistoryJson as WorldMapHistoryEntry[])
              : campaignData.campaign.worldMapJson
                ? [campaignData.campaign.worldMapJson as WorldMapHistoryEntry]
                : [],
            sceneImageHistoryJson: Array.isArray(
              campaignData.campaign.sceneImageHistoryJson,
            )
              ? (campaignData.campaign.sceneImageHistoryJson as SceneImageHistoryEntry[])
              : [],
          });
          setPartyStateDraft(
            buildPartyStateDraft(
              normalizePartyState(campaignData.campaign.partyStateJson),
            ),
          );
          setCharacterAnswers(
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
            const firstMessage = messagesData.messages[0];
            if (
              firstMessage &&
              firstMessage.role === "gm" &&
              typeof firstMessage.content === "string"
            ) {
              setScenarioDraft(firstMessage.content);
            }
            setIsScenarioActive(messagesData.messages.length > 1);
          }
        }
      } catch {
        setCampaignError("Unable to load campaign data.");
      }
    }

    loadCampaign();
  }, [campaignId]);

  useEffect(() => {
    if (!campaign?.partyStateJson) {
      return;
    }

    setPartyStateDraft(buildPartyStateDraft(campaign.partyStateJson));
  }, [campaign?.partyStateJson]);

  useEffect(() => {
    const imageCount = campaign?.sceneImageHistoryJson?.length ?? 0;

    if (imageCount <= 0) {
      setActiveSceneImageIndex(0);
      return;
    }

    setActiveSceneImageIndex(imageCount - 1);
  }, [campaign?.sceneImageHistoryJson?.length]);

  useEffect(() => {
    const history = campaign?.sceneImageHistoryJson ?? [];
    const activeImage =
      history[activeSceneImageIndex] ??
      history[history.length - 1] ??
      null;

    if (!activeImage) {
      setSceneImageDraft({
        sceneTitle: "",
        place: "",
      });
      setIsEditingSceneImageMeta(false);
      setIsSceneImageMenuOpen(false);
      return;
    }

    setSceneImageDraft({
      sceneTitle: activeImage.sceneTitle,
      place: activeImage.place,
    });
    setIsEditingSceneImageMeta(false);
    setIsSceneImageMenuOpen(false);
  }, [campaign?.sceneImageHistoryJson, activeSceneImageIndex]);

  useEffect(() => {
    const count = campaign?.worldMapHistoryJson?.length ?? 0;

    if (count <= 0) {
      setActiveWorldMapIndex(0);
      return;
    }

    setActiveWorldMapIndex((current) => Math.min(current, count - 1));
  }, [campaign?.worldMapHistoryJson?.length]);

  useEffect(() => {
    if (isScenarioActive) {
      return;
    }

    const firstMessage = messages[0];

    if (firstMessage && firstMessage.role === "gm") {
      setScenarioDraft(firstMessage.content);
    }
  }, [isScenarioActive, messages]);

  useEffect(() => {
    const latestGmMessage =
      [...messages]
        .reverse()
        .find((message) => message.role === "gm" && typeof message.content === "string") ?? null;

    if (!latestGmMessage) {
      setSceneImagePrompt("");
      return;
    }

    setSceneImagePrompt(
      buildSceneMapImagePrompt({
        ruleset: campaign?.ruleset ?? "D&D 5e",
        campaignTitle: campaign?.title ?? "Campaign",
        latestGmContent: latestGmMessage.content,
      }),
    );
  }, [messages, campaign?.ruleset, campaign?.title]);

  useEffect(() => {
    const campaignIdValue = campaign?.id;
    const campaignTitle = campaign?.title ?? "";
    const campaignRuleset = campaign?.ruleset ?? "";
    const worldMapHistory = campaign?.worldMapHistoryJson ?? [];
    const selectedMap =
      worldMapHistory[activeWorldMapIndex] ??
      worldMapHistory[worldMapHistory.length - 1] ??
      campaign?.worldMapJson ??
      null;
    const worldDescription = selectedMap?.worldDescription ?? "";
    const referenceUrl = selectedMap?.referenceUrl ?? "";
    const worldMapTitle = selectedMap?.title ?? `${campaignTitle} World Map`;

    if (!campaignIdValue) {
      return;
    }

    setWorldMapReferenceUrl(referenceUrl);
    setWorldMapTitleInput(worldMapTitle);

    if (worldDescription) {
      setWorldMapPrompt(worldDescription);
      return;
    }

    setWorldMapPrompt((current) =>
      current.trim()
        ? current
        : `${campaignTitle} is a ${campaignRuleset} setting with distinct regions, factions, travel routes, and major landmarks.`,
    );
  }, [
    campaign?.id,
    campaign?.title,
    campaign?.ruleset,
    campaign?.worldMapJson,
    campaign?.worldMapHistoryJson,
    activeWorldMapIndex,
  ]);

  useEffect(() => {
    setPendingWorldMapPinPosition(null);
    setNewWorldMapPinLabel("");
  }, [activeWorldMapIndex, isWorldMapViewerOpen]);

  useEffect(() => {
    setIsWorldMapMenuOpen(false);
    setIsEditingWorldMapTitle(false);
  }, [activeWorldMapIndex, activeWorldMapTab]);

  useEffect(() => {
    if (activeWorldMapTab !== "generate") {
      return;
    }

    setWorldMapTitleInput("");
    setWorldMapPrompt("");
    setWorldMapReferenceUrl("");
  }, [activeWorldMapTab]);

  useEffect(() => {
    if (!selectedWorldMapPinId) {
      return;
    }

    const history = campaign?.worldMapHistoryJson ?? [];
    const mapAtIndex =
      history[activeWorldMapIndex] ?? history[history.length - 1] ?? campaign?.worldMapJson ?? null;
    const pins = mapAtIndex?.pins ?? [];
    const stillExists = pins.some((pin) => pin.id === selectedWorldMapPinId);
    if (!stillExists) {
      setSelectedWorldMapPinId("");
    }
  }, [campaign?.worldMapHistoryJson, campaign?.worldMapJson, activeWorldMapIndex, selectedWorldMapPinId]);

  const mainCharacter =
    campaign?.characters.find((character) => character.isMainCharacter) ?? null;
  const companionCharacters =
    campaign?.characters.filter((character) => !character.isMainCharacter) ?? [];
  const combatState = campaign?.combatStateJson ?? DEFAULT_COMBAT_STATE;
  const combatActive = combatState.combatActive && combatState.roster.length > 0;
  const initiativeOrderedCombatRoster = getInitiativeOrderedRoster(combatState);
  const companionColorMap = buildCompanionColorMap(companionCharacters);
  const needsCharacterGeneration = !mainCharacter;
  const isChatLocked = needsCharacterGeneration || !isScenarioActive;
  const canUndoLastTurn = messages.some((message) => message.role === "user");
  const visibleCharacterQuestions = campaign
    ? getVisibleCharacterQuestions(campaign.ruleset, characterAnswers)
    : [];
  const campaignRuleset = campaign?.ruleset ?? "";
  const characterValidation = useMemo(
    () =>
      campaignRuleset
        ? validateCharacterAnswersDetailed(campaignRuleset, characterAnswers)
        : { formError: "", fieldErrors: {} },
    [campaignRuleset, characterAnswers],
  );
  const characterValidationError = characterValidation.formError;
  const characterFieldErrors = characterValidation.fieldErrors;
  const sceneSummary = buildSceneSummary(campaign, messages);
  const sceneImageHistory = campaign?.sceneImageHistoryJson ?? [];
  const selectedSceneImage =
    sceneImageHistory[activeSceneImageIndex] ??
    sceneImageHistory[sceneImageHistory.length - 1] ??
    null;
  const worldMapHistory = campaign?.worldMapHistoryJson ?? [];
  const selectedWorldMap =
    worldMapHistory[activeWorldMapIndex] ??
    worldMapHistory[worldMapHistory.length - 1] ??
    campaign?.worldMapJson ??
    null;
  const selectedWorldMapImageSrc =
    (selectedWorldMap?.imageDataUrl ?? selectedWorldMap?.referenceUrl) ||
    DEFAULT_PORTRAIT_DATA_URL;
  const selectedWorldMapPins = selectedWorldMap?.pins ?? [];
  const selectedWorldMapPin =
    selectedWorldMapPins.find((pin) => pin.id === selectedWorldMapPinId) ?? null;
  const characterMapById = new Map(
    (campaign?.characters ?? []).map((character) => [character.id, character]),
  );
  const characterMapByName = new Map(
    (campaign?.characters ?? []).map((character) => [
      normalizeCharacterLookupName(character.name),
      character,
    ]),
  );
  const progressionState = campaign?.progressionStateJson ?? DEFAULT_PROGRESSION_STATE;
  const progressionEvents = campaign?.progressionEventsJson ?? [];
  const progressionTotalsByCharacterId = useMemo(
    () =>
      new Map(
        progressionState.characterTotals.map((entry) => [entry.characterId, entry.total]),
      ),
    [progressionState.characterTotals],
  );
  const progressionInsights = useMemo<ProgressionInsights>(
    () =>
      buildProgressionInsights({
        ruleset: campaign?.ruleset ?? "",
        state: progressionState,
        characters: (campaign?.characters ?? []).map((character) => ({
          id: character.id,
          sheetJson: character.sheetJson,
        })),
      }),
    [campaign?.characters, campaign?.ruleset, progressionState],
  );

  useEffect(() => {
    if (!combatActive) {
      if (hasAutoCollapsedForCombat) {
        setHasAutoCollapsedForCombat(false);
      }
      return;
    }

    if (hasAutoCollapsedForCombat || !campaign?.characters.length) {
      return;
    }

    setCollapsedCards((current) => {
      const nextState = { ...current };

      for (const character of campaign.characters) {
        nextState[character.id] = true;
      }

      return nextState;
    });
    setDetailCardId("");
    setHasAutoCollapsedForCombat(true);
  }, [combatActive, campaign?.characters, hasAutoCollapsedForCombat]);

  useEffect(() => {
    if (!campaign?.characters?.length) {
      setProgressionRecipientCharacterIds([]);
      return;
    }

    const validCharacterIds = new Set(campaign.characters.map((character) => character.id));
    setProgressionRecipientCharacterIds((current) =>
      current.filter((characterId) => validCharacterIds.has(characterId)),
    );
  }, [campaign?.characters]);

  useEffect(() => {
    if (progressionState.mode === "milestone") {
      setProgressionAmountInput("1");
    }
  }, [progressionState.mode]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    const trimmed = input.trim();
    if (!trimmed || loading || !campaignId || isChatLocked) return;
    const selectedOptionNumbers = parseSelectedOptionNumbers(trimmed) ?? [];
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
          "X-Debug-State-Logging": debugStateLoggingEnabled ? "true" : "false",
        },
        body: JSON.stringify({
          campaignId,
          message: resolvedInput,
          selectedOptionNumbers,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to send message.");
      }

        const data = await res.json();
        if (data.debug) {
          setDebugSnapshot(data.debug as DebugSnapshot);
        }

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
                  partyStateJson: data.partyStateJson
                    ? normalizePartyState(data.partyStateJson)
                    : currentCampaign.partyStateJson,
                  combatStateJson:
                    "combatStateJson" in data
                      ? (data.combatStateJson as CombatState)
                      : currentCampaign.combatStateJson,
                  mapStateJson:
                    "mapStateJson" in data
                      ? (data.mapStateJson as SceneMapState | null)
                      : currentCampaign.mapStateJson,
                  sceneImageHistoryJson:
                    "sceneImageHistoryJson" in data &&
                    Array.isArray(data.sceneImageHistoryJson)
                      ? (data.sceneImageHistoryJson as SceneImageHistoryEntry[])
                      : currentCampaign.sceneImageHistoryJson,
                }
              : currentCampaign,
          );
        } else if (
          data.partyStateJson ||
          "combatStateJson" in data ||
          "mapStateJson" in data ||
          ("sceneImageHistoryJson" in data && Array.isArray(data.sceneImageHistoryJson))
        ) {
          setCampaign((currentCampaign) =>
            currentCampaign
              ? {
                  ...currentCampaign,
                  partyStateJson: data.partyStateJson
                    ? normalizePartyState(data.partyStateJson)
                    : currentCampaign.partyStateJson,
                  combatStateJson:
                    "combatStateJson" in data
                      ? (data.combatStateJson as CombatState)
                      : currentCampaign.combatStateJson,
                  mapStateJson:
                    "mapStateJson" in data
                      ? (data.mapStateJson as SceneMapState | null)
                      : currentCampaign.mapStateJson,
                  sceneImageHistoryJson:
                    "sceneImageHistoryJson" in data &&
                    Array.isArray(data.sceneImageHistoryJson)
                      ? (data.sceneImageHistoryJson as SceneImageHistoryEntry[])
                      : currentCampaign.sceneImageHistoryJson,
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

    if (characterValidationError) {
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

  async function handleScenarioAction() {
    if (!campaignId || needsCharacterGeneration || isTogglingScenario || isSavingScenario) {
      return;
    }

    setIsUtilityMenuOpen(false);

    if (isScenarioActive) {
      setConfirmationState({
        kind: "reset",
        title: "Confirmation",
        message: "Reset the scenario and clear chat history after the opening scene?",
        confirmLabel: "Reset",
      });
      return;
    }

    if (!scenarioDraft.trim()) {
      setError("The starting scenario cannot be blank.");
      return;
    }

    const saved = await saveScenarioDraft();

    if (!saved) {
      return;
    }

    await performScenarioAction();
  }

  async function saveScenarioDraft() {
    const trimmedScenario = scenarioDraft.trim();

    if (!campaignId) {
      return false;
    }

    if (!trimmedScenario) {
      setError("The starting scenario cannot be blank.");
      return false;
    }

    const firstMessage = messages[0];

    if (
      firstMessage &&
      firstMessage.role === "gm" &&
      firstMessage.content.trim() === trimmedScenario
    ) {
      return true;
    }

    setError("");
    setIsSavingScenario(true);

    try {
      const res = await fetch(`/api/campaigns/${campaignId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          startingScenario: trimmedScenario,
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.message) {
        throw new Error(data.error ?? "Unable to update the starting scenario.");
      }

      setMessages((currentMessages) =>
        currentMessages.length === 0
          ? currentMessages
          : [data.message, ...currentMessages.slice(1)],
      );
      setScenarioDraft(data.message.content);
      return true;
    } catch (scenarioError) {
      setError(
        scenarioError instanceof Error
          ? scenarioError.message
          : "Unable to update the starting scenario.",
      );
      return false;
    } finally {
      setIsSavingScenario(false);
    }
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
        if (Array.isArray(data.characters)) {
          setCampaign((currentCampaign) =>
            currentCampaign
              ? {
                  ...currentCampaign,
                  characters: data.characters,
                  partyStateJson: data.partyStateJson
                    ? normalizePartyState(data.partyStateJson)
                    : currentCampaign.partyStateJson,
                  combatStateJson:
                    "combatStateJson" in data
                      ? (data.combatStateJson as CombatState)
                      : currentCampaign.combatStateJson,
                  mapStateJson:
                    "mapStateJson" in data
                      ? (data.mapStateJson as SceneMapState | null)
                      : currentCampaign.mapStateJson,
                  sceneImageHistoryJson:
                    "sceneImageHistoryJson" in data &&
                    Array.isArray(data.sceneImageHistoryJson)
                      ? (data.sceneImageHistoryJson as SceneImageHistoryEntry[])
                      : currentCampaign.sceneImageHistoryJson,
                }
              : currentCampaign,
          );
        } else if (data.partyStateJson) {
          setCampaign((currentCampaign) =>
            currentCampaign
              ? {
                  ...currentCampaign,
                  partyStateJson: normalizePartyState(data.partyStateJson),
                  combatStateJson:
                    "combatStateJson" in data
                      ? (data.combatStateJson as CombatState)
                      : currentCampaign.combatStateJson,
                  mapStateJson:
                    "mapStateJson" in data
                      ? (data.mapStateJson as SceneMapState | null)
                      : currentCampaign.mapStateJson,
                  sceneImageHistoryJson:
                    "sceneImageHistoryJson" in data &&
                    Array.isArray(data.sceneImageHistoryJson)
                      ? (data.sceneImageHistoryJson as SceneImageHistoryEntry[])
                      : currentCampaign.sceneImageHistoryJson,
                }
              : currentCampaign,
          );
        } else if ("mapStateJson" in data) {
          setCampaign((currentCampaign) =>
            currentCampaign
              ? {
                  ...currentCampaign,
                  combatStateJson:
                    "combatStateJson" in data
                      ? (data.combatStateJson as CombatState)
                      : currentCampaign.combatStateJson,
                  mapStateJson: data.mapStateJson as SceneMapState | null,
                  sceneImageHistoryJson:
                    "sceneImageHistoryJson" in data &&
                    Array.isArray(data.sceneImageHistoryJson)
                      ? (data.sceneImageHistoryJson as SceneImageHistoryEntry[])
                      : currentCampaign.sceneImageHistoryJson,
                }
              : currentCampaign,
          );
        }
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

  async function handleResyncState() {
    if (!campaignId || isResyncingState) {
      return;
    }

    setIsUtilityMenuOpen(false);
    setError("");
    setIsResyncingState(true);

    try {
      const res = await fetch(`/api/campaigns/${campaignId}/resync`, {
        method: "POST",
      });
      const data = await res.json();

      if (!res.ok || !Array.isArray(data.characters)) {
        throw new Error(data.error ?? "Unable to resync character state.");
      }

      setCampaign((currentCampaign) =>
        currentCampaign
          ? {
              ...currentCampaign,
              characters: data.characters,
            }
          : currentCampaign,
      );
    } catch (resyncError) {
      setError(
        resyncError instanceof Error
          ? resyncError.message
          : "Unable to resync character state.",
      );
    } finally {
      setIsResyncingState(false);
    }
  }

  function handleUndoLastTurn() {
    if (!campaignId || isUndoingTurn || !canUndoLastTurn) {
      return;
    }

    setConfirmationState({
      kind: "undo-last-turn",
      title: "Confirmation",
      message:
        "Undo the last turn? This removes the last player response and everything that happened after it.",
      confirmLabel: "Undo Last Turn",
    });
  }

  async function performUndoLastTurn() {
    if (!campaignId || isUndoingTurn || !canUndoLastTurn) {
      return;
    }

    setError("");
    setIsUndoingTurn(true);

    try {
      const res = await fetch(`/api/campaigns/${campaignId}/undo`, {
        method: "POST",
      });
      const data = await res.json();

      if (!res.ok || !Array.isArray(data.messages) || !Array.isArray(data.characters)) {
        throw new Error(data.error ?? "Unable to undo the last turn.");
      }

      const nextMessages = data.messages as ChatMessage[];
      const nextCharacters = data.characters as CampaignCharacter[];

      setMessages(nextMessages);
      setCampaign((currentCampaign) =>
        currentCampaign
          ? {
              ...currentCampaign,
              characters: nextCharacters,
              partyStateJson:
                "partyStateJson" in data
                  ? (data.partyStateJson as PartyState)
                  : currentCampaign.partyStateJson,
              combatStateJson:
                "combatStateJson" in data
                  ? (data.combatStateJson as CombatState)
                  : currentCampaign.combatStateJson,
            }
          : currentCampaign,
      );
      setIsScenarioActive(nextMessages.length > 1);
      setDetailCardId((currentDetailCardId) =>
        nextCharacters.some((character) => character.id === currentDetailCardId)
          ? currentDetailCardId
          : "",
      );
    } catch (undoError) {
      setError(
        undoError instanceof Error
          ? undoError.message
          : "Unable to undo the last turn.",
      );
    } finally {
      setIsUndoingTurn(false);
    }
  }

  async function handleRefreshMap() {
    if (!campaignId || isRefreshingMap) {
      return;
    }

    setError("");
    setIsRefreshingMap(true);

    try {
      const res = await fetch(`/api/campaigns/${campaignId}/map`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          scenePrompt: sceneImagePrompt.trim(),
        }),
      });
      const data = await res.json();

      if (!res.ok || !("mapStateJson" in data)) {
        throw new Error(data.error ?? "Unable to refresh scene image.");
      }

      setCampaign((currentCampaign) =>
        currentCampaign
          ? {
              ...currentCampaign,
              mapStateJson: data.mapStateJson as SceneMapState | null,
              sceneImageHistoryJson:
                Array.isArray(data.sceneImageHistoryJson)
                  ? (data.sceneImageHistoryJson as SceneImageHistoryEntry[])
                  : currentCampaign.sceneImageHistoryJson,
            }
          : currentCampaign,
      );
    } catch (mapError) {
      setError(
        mapError instanceof Error
          ? mapError.message
          : "Unable to refresh scene image.",
      );
    } finally {
      setIsRefreshingMap(false);
    }
  }

  async function handleCreateWorldMap(
    mode: "generated" | "reference",
    referenceImageDataUrl?: string,
  ) {
    if (!campaignId || !campaign || isGeneratingWorldMap || isSavingWorldMap) {
      return;
    }

    const prompt = worldMapPrompt.trim();
    const title = worldMapTitleInput.trim() || `${campaign.title} World Map`;
    const isReference = mode === "reference";
    const trimmedReferenceUrl = worldMapReferenceUrl.trim();
    const hasImageDataUrl =
      typeof referenceImageDataUrl === "string" &&
      referenceImageDataUrl.startsWith("data:image/");

    if (!isReference && !prompt) {
      setError("World map details are required.");
      return;
    }

    if (isReference && !trimmedReferenceUrl && !hasImageDataUrl) {
      setError("Enter a reference URL or upload an image.");
      return;
    }

    setError("");
    if (isReference) {
      setIsSavingWorldMap(true);
    } else {
      setIsGeneratingWorldMap(true);
    }

    try {
      const response = await fetch(`/api/campaigns/${campaignId}/world-map`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mode,
          title,
          worldDescription: prompt,
          referenceUrl: trimmedReferenceUrl,
          referenceImageDataUrl: hasImageDataUrl ? referenceImageDataUrl : null,
        }),
      });
      const data = await response.json();

      if (
        !response.ok ||
        !("worldMapJson" in data) ||
        !Array.isArray(data.worldMapHistoryJson)
      ) {
        throw new Error(
          data.error ??
            (isReference
              ? "Unable to save world map reference."
              : "Unable to generate world map."),
        );
      }

      setCampaign((currentCampaign) =>
        currentCampaign
          ? {
              ...currentCampaign,
              worldMapJson: data.worldMapJson as WorldMapState | null,
              worldMapHistoryJson: data.worldMapHistoryJson as WorldMapHistoryEntry[],
            }
          : currentCampaign,
      );
      setActiveWorldMapTab("saved");
      setActiveWorldMapIndex(
        Math.max(0, (data.worldMapHistoryJson as WorldMapHistoryEntry[]).length - 1),
      );
    } catch (worldMapError) {
      setError(
        worldMapError instanceof Error
          ? worldMapError.message
          : isReference
            ? "Unable to save world map reference."
            : "Unable to generate world map.",
      );
    } finally {
      setIsGeneratingWorldMap(false);
      setIsSavingWorldMap(false);
    }
  }

  async function handleUploadWorldMapReference(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      await handleCreateWorldMap("reference", dataUrl);
    } catch {
      setError("Unable to load uploaded reference image.");
    }
  }

  async function handleSaveWorldMapTitle() {
    if (!campaignId || !campaign || isSavingWorldMapTitle || !selectedWorldMap) {
      return;
    }

    const title = worldMapTitleInput.trim();
    if (!title) {
      setError("Map title is required.");
      return;
    }

    setError("");
    setIsSavingWorldMapTitle(true);

    try {
      const response = await fetch(`/api/campaigns/${campaignId}/world-map`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "update-title",
          index: activeWorldMapIndex,
          title,
        }),
      });
      const data = await response.json();

      if (
        !response.ok ||
        !("worldMapJson" in data) ||
        !Array.isArray(data.worldMapHistoryJson)
      ) {
        throw new Error(data.error ?? "Unable to update map title.");
      }

      setCampaign((currentCampaign) =>
        currentCampaign
          ? {
              ...currentCampaign,
              worldMapJson: data.worldMapJson as WorldMapState | null,
              worldMapHistoryJson: data.worldMapHistoryJson as WorldMapHistoryEntry[],
            }
          : currentCampaign,
      );
      setIsEditingWorldMapTitle(false);
      setIsWorldMapMenuOpen(false);
    } catch (mapTitleError) {
      setError(
        mapTitleError instanceof Error
          ? mapTitleError.message
          : "Unable to update map title.",
      );
    } finally {
      setIsSavingWorldMapTitle(false);
    }
  }

  async function handleSaveWorldMapPins(nextPins: WorldMapPin[]) {
    if (!campaignId || !campaign || !selectedWorldMap || isSavingWorldMapPins) {
      return;
    }

    setError("");
    setIsSavingWorldMapPins(true);

    try {
      const response = await fetch(`/api/campaigns/${campaignId}/world-map`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "update-pins",
          index: activeWorldMapIndex,
          pins: nextPins,
        }),
      });
      const data = await response.json();

      if (
        !response.ok ||
        !("worldMapJson" in data) ||
        !Array.isArray(data.worldMapHistoryJson)
      ) {
        throw new Error(data.error ?? "Unable to save map pins.");
      }

      setCampaign((currentCampaign) =>
        currentCampaign
          ? {
              ...currentCampaign,
              worldMapJson: data.worldMapJson as WorldMapState | null,
              worldMapHistoryJson: data.worldMapHistoryJson as WorldMapHistoryEntry[],
            }
          : currentCampaign,
      );
    } catch (pinError) {
      setError(pinError instanceof Error ? pinError.message : "Unable to save map pins.");
    } finally {
      setIsSavingWorldMapPins(false);
    }
  }

  function handleWorldMapViewerClick(event: MouseEvent<HTMLImageElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }

    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    setPendingWorldMapPinPosition({
      x: Math.max(0, Math.min(100, x)),
      y: Math.max(0, Math.min(100, y)),
    });
    setSelectedWorldMapPinId("");
  }

  async function handleAddWorldMapPin() {
    if (!pendingWorldMapPinPosition || !selectedWorldMap) {
      return;
    }

    const label = newWorldMapPinLabel.trim();
    if (!label) {
      setError("Pin label is required.");
      return;
    }

    const newPin: WorldMapPin = {
      id: `pin-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      label: label.slice(0, 80),
      x: pendingWorldMapPinPosition.x,
      y: pendingWorldMapPinPosition.y,
      color: newWorldMapPinColor,
    };

    await handleSaveWorldMapPins([...selectedWorldMapPins, newPin]);
    setPendingWorldMapPinPosition(null);
    setNewWorldMapPinLabel("");
    setSelectedWorldMapPinId(newPin.id);
  }

  async function handleDeleteSelectedWorldMapPin() {
    if (!selectedWorldMap || !selectedWorldMapPinId) {
      return;
    }

    const nextPins = selectedWorldMapPins.filter((pin) => pin.id !== selectedWorldMapPinId);
    await handleSaveWorldMapPins(nextPins);
    setSelectedWorldMapPinId("");
  }

  function handleDeleteWorldMap() {
    if (!selectedWorldMap || isDeletingWorldMap || isSavingWorldMapTitle) {
      return;
    }

    setIsWorldMapMenuOpen(false);
    setIsEditingWorldMapTitle(false);
    setConfirmationState({
      kind: "delete-world-map",
      title: "Warning",
      message: `Remove saved map "${selectedWorldMap.title}"?`,
      confirmLabel: "Remove",
      mapIndex: activeWorldMapIndex,
    });
  }

  async function performDeleteWorldMap(mapIndex: number) {
    if (!campaignId || !campaign || isDeletingWorldMap) {
      return;
    }

    setError("");
    setIsDeletingWorldMap(true);

    try {
      const response = await fetch(`/api/campaigns/${campaignId}/world-map`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "delete",
          index: mapIndex,
        }),
      });
      const data = await response.json();

      if (
        !response.ok ||
        !("worldMapJson" in data) ||
        !Array.isArray(data.worldMapHistoryJson)
      ) {
        throw new Error(data.error ?? "Unable to delete world map.");
      }

      const nextHistory = data.worldMapHistoryJson as WorldMapHistoryEntry[];
      setCampaign((currentCampaign) =>
        currentCampaign
          ? {
              ...currentCampaign,
              worldMapJson: data.worldMapJson as WorldMapState | null,
              worldMapHistoryJson: nextHistory,
            }
          : currentCampaign,
      );
      setActiveWorldMapIndex((current) =>
        nextHistory.length === 0 ? 0 : Math.min(current, nextHistory.length - 1),
      );
    } catch (deleteWorldMapError) {
      setError(
        deleteWorldMapError instanceof Error
          ? deleteWorldMapError.message
          : "Unable to delete world map.",
      );
    } finally {
      setIsDeletingWorldMap(false);
    }
  }

  function handleToggleDebugStateLogging() {
    setIsUtilityMenuOpen(false);
    setDebugStateLoggingEnabled((current) => {
      const nextValue = !current;

      try {
        window.localStorage.setItem(
          "debug-state-logging",
          String(nextValue),
        );
      } catch {
        // Ignore local storage failures and still update in-memory state.
      }

      return nextValue;
    });
    if (debugStateLoggingEnabled) {
      setIsDebugInspectorOpen(false);
    }
  }

  async function handleDeleteCharacter(character: CampaignCharacter) {
    if (deletingCharacterId) {
      return;
    }

      setConfirmationState({
        kind: "delete-character",
        title: "Warning",
        message: `Remove ${character.name}? This removes the character from the campaign.`,
        confirmLabel: "Remove",
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

    if (pendingConfirmation.kind === "undo-last-turn") {
      await performUndoLastTurn();
      return;
    }

    if (pendingConfirmation.kind === "reset-progression") {
      await handleProgressionAction("reset-all");
      return;
    }

    if (pendingConfirmation.kind === "delete-scene-image") {
      await performDeleteSceneImage(pendingConfirmation.imageIndex);
      return;
    }

    if (pendingConfirmation.kind === "delete-world-map") {
      await performDeleteWorldMap(pendingConfirmation.mapIndex);
      return;
    }

    if (pendingConfirmation.kind === "update-master") {
      await performExportCharacter(pendingConfirmation.character, "update-master");
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

  async function performExportCharacter(
    character: CampaignCharacter,
    mode: "update-master" | "create-version",
  ) {
    if (exportingCharacterId) {
      return;
    }

    setError("");
    setExportingCharacterId(character.id);

    try {
      const res = await fetch(`/api/characters/${character.id}/export`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mode,
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.character) {
        throw new Error(
          data.error ??
            (mode === "update-master"
              ? "Unable to update the master character."
              : "Unable to create a new character version."),
        );
      }
    } catch (exportError) {
      setError(
        exportError instanceof Error
          ? exportError.message
          : mode === "update-master"
            ? "Unable to update the master character."
            : "Unable to create a new character version.",
      );
    } finally {
      setExportingCharacterId("");
    }
  }

  async function handleExportCharacter(
    character: CampaignCharacter,
    mode: "update-master" | "create-version",
  ) {
    if (mode === "update-master") {
      setConfirmationState({
        kind: "update-master",
        title: "Confirmation",
        message: `Update the linked master record for ${character.name}? This will overwrite the reusable library version with the campaign's permanent character changes.`,
        confirmLabel: "Update Master",
        character,
      });
      return;
    }

    await performExportCharacter(character, mode);
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

  async function handleSavePartyState() {
    if (!campaign || isSavingPartyState) {
      return;
    }

    setError("");
    setIsSavingPartyState(true);

    try {
      const response = await fetch(`/api/campaigns/${campaignId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          partyState: parsePartyStateDraft(partyStateDraft),
        }),
      });
      const data = await response.json();

      if (!response.ok || !data.campaign) {
        throw new Error(data.error ?? "Unable to save party details.");
      }

      setCampaign(data.campaign);
      setIsEditingPartyState(false);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to save party details.",
      );
    } finally {
      setIsSavingPartyState(false);
    }
  }

  async function handleRefreshRecap() {
    if (!campaignId || isRefreshingRecap) {
      return;
    }

    setError("");
    setIsRefreshingRecap(true);

    try {
      const response = await fetch(`/api/campaigns/${campaignId}/recap`, {
        method: "POST",
      });
      const data = await response.json();

      if (!response.ok || !data.partyStateJson) {
        throw new Error(data.error ?? "Unable to refresh recap.");
      }

      setCampaign((currentCampaign) =>
        currentCampaign
          ? {
              ...currentCampaign,
              partyStateJson: normalizePartyState(data.partyStateJson),
            }
          : currentCampaign,
      );
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : "Unable to refresh recap.",
      );
    } finally {
      setIsRefreshingRecap(false);
    }
  }

  async function handleSetNarrationLevel(nextLevel: NarrationLevel) {
    if (!campaign || isSavingPartyState) {
      return;
    }

    if (campaign.partyStateJson.narrationLevel === nextLevel) {
      setIsUtilityMenuOpen(false);
      return;
    }

    setIsUtilityMenuOpen(false);
    setError("");
    setIsSavingPartyState(true);

    try {
      const response = await fetch(`/api/campaigns/${campaignId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          partyState: {
            ...campaign.partyStateJson,
            narrationLevel: nextLevel,
          },
        }),
      });
      const data = await response.json();

      if (!response.ok || !data.campaign) {
        throw new Error(data.error ?? "Unable to update narration level.");
      }

      setCampaign(data.campaign);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to update narration level.",
      );
    } finally {
      setIsSavingPartyState(false);
    }
  }

  async function handleSetChatModel(nextModel: CampaignChatModel) {
    if (!campaign || isSavingChatModel) {
      return;
    }

    if (campaign.chatModel === nextModel) {
      setIsUtilityMenuOpen(false);
      return;
    }

    setIsUtilityMenuOpen(false);
    setError("");
    setIsSavingChatModel(true);

    try {
      const response = await fetch(`/api/campaigns/${campaignId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chatModel: nextModel,
        }),
      });
      const data = await response.json();

      if (!response.ok || !data.campaign) {
        throw new Error(data.error ?? "Unable to update chat model.");
      }

      setCampaign(data.campaign);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to update chat model.",
      );
    } finally {
      setIsSavingChatModel(false);
    }
  }

  async function handleSetProgressionMode(nextMode: ProgressionMode) {
    if (!campaign || isSavingProgressionMode) {
      return;
    }

    if (progressionState.mode === nextMode) {
      return;
    }

    setError("");
    setIsSavingProgressionMode(true);

    try {
      const response = await fetch(`/api/campaigns/${campaignId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          progressionState: {
            ...progressionState,
            mode: nextMode,
          },
        }),
      });
      const data = await response.json();

      if (!response.ok || !data.campaign) {
        throw new Error(data.error ?? "Unable to update progression mode.");
      }

      setCampaign(data.campaign as CampaignDetails);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to update progression mode.",
      );
    } finally {
      setIsSavingProgressionMode(false);
    }
  }

  async function handleSetProgressionAutoApply(nextValue: boolean) {
    if (!campaign || isSavingProgressionAutomation) {
      return;
    }

    if (progressionState.autoApplyLevels === nextValue) {
      return;
    }

    setError("");
    setIsSavingProgressionAutomation(true);

    try {
      const response = await fetch(`/api/campaigns/${campaignId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          progressionState: {
            ...progressionState,
            autoApplyLevels: nextValue,
          },
        }),
      });
      const data = await response.json();

      if (!response.ok || !data.campaign) {
        throw new Error(data.error ?? "Unable to update progression settings.");
      }

      setCampaign(data.campaign as CampaignDetails);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to update progression settings.",
      );
    } finally {
      setIsSavingProgressionAutomation(false);
    }
  }

  async function handleAwardProgression() {
    if (!campaignId || isSavingProgressionEvent || !campaign) {
      return;
    }

    const amount = Number.parseInt(progressionAmountInput.trim(), 10);
    if (!Number.isFinite(amount) || amount === 0) {
      setError("Progression amount must be a non-zero number.");
      return;
    }

    const reason = progressionReasonInput.trim();
    if (!reason) {
      setError("Progression reason is required.");
      return;
    }

    if (
      progressionRecipientType === "character" &&
      progressionRecipientCharacterIds.length === 0
    ) {
      setError("Select at least one character for character awards.");
      return;
    }

    setError("");
    setIsSavingProgressionEvent(true);

    try {
      const response = await fetch(`/api/campaigns/${campaignId}/progression`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount,
          reason,
          note: progressionNoteInput.trim(),
          recipientType: progressionRecipientType,
          characterIds:
            progressionRecipientType === "character"
              ? progressionRecipientCharacterIds
              : [],
          currency: progressionState.currency,
        }),
      });
      const data = await response.json();

      if (
        !response.ok ||
        !data.progressionStateJson ||
        !Array.isArray(data.progressionEventsJson)
      ) {
        throw new Error(data.error ?? "Unable to add progression award.");
      }

      setCampaign((currentCampaign) =>
        currentCampaign
          ? {
              ...currentCampaign,
              characters:
                (Array.isArray(data.characters)
                  ? (data.characters as CampaignCharacter[])
                  : currentCampaign.characters),
              progressionStateJson: data.progressionStateJson as ProgressionState,
              progressionEventsJson: data.progressionEventsJson as ProgressionEvent[],
            }
          : currentCampaign,
      );
      setProgressionReasonInput("");
      setProgressionNoteInput("");
    } catch (awardError) {
      setError(
        awardError instanceof Error
          ? awardError.message
          : "Unable to add progression award.",
      );
    } finally {
      setIsSavingProgressionEvent(false);
    }
  }

  async function handleApplySuggestedLevels() {
    if (!campaignId || !campaign || isApplyingProgressionLevels) {
      return;
    }

    const readyCount = progressionInsights.characters.filter((entry) => entry.readyToLevel).length;
    if (readyCount <= 0) {
      return;
    }

    setError("");
    setIsApplyingProgressionLevels(true);

    try {
      const response = await fetch(`/api/campaigns/${campaignId}/progression`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "apply-levels",
        }),
      });
      const data = await response.json();

      if (!response.ok || !Array.isArray(data.characters)) {
        throw new Error(data.error ?? "Unable to apply suggested levels.");
      }

      setCampaign((currentCampaign) =>
        currentCampaign
          ? {
              ...currentCampaign,
              characters: data.characters as CampaignCharacter[],
              progressionStateJson:
                (data.progressionStateJson as ProgressionState | undefined) ??
                currentCampaign.progressionStateJson,
              progressionEventsJson:
                (data.progressionEventsJson as ProgressionEvent[] | undefined) ??
                currentCampaign.progressionEventsJson,
            }
          : currentCampaign,
      );
    } catch (applyError) {
      setError(
        applyError instanceof Error
          ? applyError.message
          : "Unable to apply suggested levels.",
      );
    } finally {
      setIsApplyingProgressionLevels(false);
    }
  }

  async function handleProgressionAction(
    action:
      | "undo-last-event"
      | "award-milestone"
      | "recalculate-state"
      | "reset-all",
  ) {
    if (!campaignId || !campaign || isManagingProgressionEvents) {
      return;
    }

    setError("");
    setIsManagingProgressionEvents(true);

    try {
      const response = await fetch(`/api/campaigns/${campaignId}/progression`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action,
          reason: progressionReasonInput.trim() || "Milestone reached",
          note: progressionNoteInput.trim(),
          recipientType: progressionRecipientType,
          characterIds:
            progressionRecipientType === "character"
              ? progressionRecipientCharacterIds
              : [],
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Unable to update progression.");
      }

      setCampaign((currentCampaign) =>
        currentCampaign
          ? {
              ...currentCampaign,
              characters:
                (data.characters as CampaignCharacter[] | undefined) ??
                currentCampaign.characters,
              progressionStateJson:
                (data.progressionStateJson as ProgressionState | undefined) ??
                currentCampaign.progressionStateJson,
              progressionEventsJson:
                (data.progressionEventsJson as ProgressionEvent[] | undefined) ??
                currentCampaign.progressionEventsJson,
            }
          : currentCampaign,
      );
    } catch (progressionActionError) {
      setError(
        progressionActionError instanceof Error
          ? progressionActionError.message
          : "Unable to update progression.",
      );
    } finally {
      setIsManagingProgressionEvents(false);
    }
  }

  function handleResetProgression() {
    if (!campaignId || !campaign || isManagingProgressionEvents) {
      return;
    }

    setConfirmationState({
      kind: "reset-progression",
      title: "Confirmation",
      message: "Reset all progression totals and clear progression event history?",
      confirmLabel: "Reset",
    });
  }

  async function saveSceneImageState(
    nextHistory: SceneImageHistoryEntry[],
    nextMapState: SceneMapState | null,
  ) {
    if (!campaign) {
      return;
    }

    setError("");

    try {
      const response = await fetch(`/api/campaigns/${campaignId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sceneImageHistory: nextHistory,
          mapState: nextMapState,
        }),
      });
      const data = await response.json();

      if (!response.ok || !data.campaign) {
        throw new Error(data.error ?? "Unable to update scene image.");
      }

      setCampaign(data.campaign as CampaignDetails);
      setIsEditingSceneImageMeta(false);
      setIsSceneImageMenuOpen(false);
    } catch (sceneImageError) {
      setError(
        sceneImageError instanceof Error
          ? sceneImageError.message
          : "Unable to update scene image.",
      );
    }
  }

  async function handleSaveSceneImageMeta() {
    if (!campaign || !selectedSceneImage) {
      return;
    }

    const nextSceneTitle = sceneImageDraft.sceneTitle.trim();
    const nextPlace = sceneImageDraft.place.trim();

    if (!nextSceneTitle || !nextPlace) {
      setError("Scene image title and subtitle are required.");
      return;
    }

    const nextHistory = sceneImageHistory.map((image, index) =>
      index === activeSceneImageIndex
        ? {
            ...image,
            title: buildSceneImageTitle(nextSceneTitle, nextPlace),
            sceneTitle: nextSceneTitle,
            place: nextPlace,
          }
        : image,
    );
    const isEditingCurrentImage =
      campaign.mapStateJson &&
      campaign.mapStateJson.generatedAt === selectedSceneImage.generatedAt &&
      campaign.mapStateJson.imageDataUrl === selectedSceneImage.imageDataUrl;
    const nextMapState =
      isEditingCurrentImage && campaign.mapStateJson
        ? {
            ...campaign.mapStateJson,
            title: buildSceneImageTitle(nextSceneTitle, nextPlace),
            sceneTitle: nextSceneTitle,
            place: nextPlace,
          }
        : campaign.mapStateJson;

    await saveSceneImageState(nextHistory, nextMapState);
  }

  function handleDeleteSceneImage() {
    if (!selectedSceneImage) {
      return;
    }

    setIsSceneImageMenuOpen(false);
    setConfirmationState({
      kind: "delete-scene-image",
      title: "Warning",
      message: `Remove the scene image "${selectedSceneImage.sceneTitle}"?`,
      confirmLabel: "Remove",
      imageIndex: activeSceneImageIndex,
    });
  }

  async function performDeleteSceneImage(imageIndex: number) {
    if (!campaign) {
      return;
    }

    const imageToDelete = sceneImageHistory[imageIndex];
    const nextHistory = sceneImageHistory.filter((_, index) => index !== imageIndex);
    const isDeletingCurrentImage =
      imageToDelete &&
      campaign.mapStateJson &&
      campaign.mapStateJson.generatedAt === imageToDelete.generatedAt &&
      campaign.mapStateJson.imageDataUrl === imageToDelete.imageDataUrl;
    const nextMapState = isDeletingCurrentImage
      ? nextHistory[nextHistory.length - 1] ?? null
      : campaign.mapStateJson;

    await saveSceneImageState(nextHistory, nextMapState);
    setActiveSceneImageIndex((current) =>
      nextHistory.length === 0 ? 0 : Math.min(current, nextHistory.length - 1),
    );
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
      {isWorldMapViewerOpen && selectedWorldMap ? (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-2 md:p-3"
          onClick={() => setIsWorldMapViewerOpen(false)}
        >
          <div
            className="relative flex h-full w-full max-h-[98vh] max-w-[99vw] items-center justify-center rounded-xl border border-zinc-700 bg-zinc-950 p-1"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setIsWorldMapViewerOpen(false)}
              className="absolute right-2 top-2 rounded-md border border-zinc-600 bg-zinc-900/90 px-2 py-1 text-xs text-zinc-200 transition hover:border-zinc-400 hover:text-white"
            >
              Close
            </button>
            <div className="flex h-full w-full flex-col gap-2 pt-8">
              <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={selectedWorldMapImageSrc}
                    alt={selectedWorldMap.title}
                    onClick={handleWorldMapViewerClick}
                    className="block h-[calc(98vh-7.5rem)] w-auto max-w-[98vw] object-contain"
                  />
                  {selectedWorldMapPins.map((pin) => (
                    <div
                      key={pin.id}
                      className="absolute -translate-x-1/2 -translate-y-full"
                      style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
                    >
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedWorldMapPinId(pin.id);
                          setPendingWorldMapPinPosition(null);
                        }}
                        className={`rounded-md border bg-zinc-900/95 px-1.5 py-0.5 text-[10px] shadow transition ${
                          selectedWorldMapPinId === pin.id
                            ? "border-cyan-300 text-cyan-100"
                            : "border-zinc-600 text-zinc-100 hover:border-zinc-400"
                        }`}
                        title={`Select ${pin.label}`}
                        aria-label={`Select ${pin.label} pin`}
                      >
                        <span>{pin.label}</span>
                      </button>
                      <div
                        className={`mx-auto mt-0.5 h-2 w-2 rounded-full border ${
                          selectedWorldMapPinId === pin.id
                            ? "border-cyan-200"
                            : "border-zinc-950"
                        }`}
                        style={{ backgroundColor: pin.color }}
                      />
                    </div>
                  ))}
                  {pendingWorldMapPinPosition ? (
                    <div
                      className="pointer-events-none absolute -translate-x-1/2 -translate-y-full"
                      style={{
                        left: `${pendingWorldMapPinPosition.x}%`,
                        top: `${pendingWorldMapPinPosition.y}%`,
                      }}
                    >
                      <div className="rounded-md border border-cyan-300/50 bg-zinc-900/95 px-1.5 py-0.5 text-[10px] text-cyan-100">
                        New pin
                      </div>
                      <div
                        className="mx-auto mt-0.5 h-2 w-2 rounded-full border border-zinc-950"
                        style={{ backgroundColor: newWorldMapPinColor }}
                      />
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <div className="w-full text-right text-[11px] text-zinc-400">
                  Click on the map to choose a pin location, then add a label.
                </div>
                <input
                  value={newWorldMapPinLabel}
                  onChange={(event) => setNewWorldMapPinLabel(event.target.value)}
                  placeholder="Pin label"
                  className="w-full max-w-[12rem] rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-zinc-500"
                />
                <div className="flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 px-1.5 py-1">
                  {WORLD_MAP_PIN_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setNewWorldMapPinColor(color)}
                      className={`h-4 w-4 rounded-full border transition ${
                        newWorldMapPinColor === color
                          ? "border-cyan-200 ring-1 ring-cyan-300"
                          : "border-zinc-600"
                      }`}
                      style={{ backgroundColor: color }}
                      aria-label={`Choose pin color ${color}`}
                      title={color}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => void handleAddWorldMapPin()}
                  disabled={!pendingWorldMapPinPosition || !newWorldMapPinLabel.trim() || isSavingWorldMapPins}
                  className="rounded-md border border-cyan-300/30 bg-cyan-300/10 px-2.5 py-1.5 text-xs font-medium text-cyan-100 transition hover:border-cyan-300/60 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSavingWorldMapPins ? "Saving..." : "Add Pin"}
                </button>
                <button
                  type="button"
                  onClick={() => void handleDeleteSelectedWorldMapPin()}
                  disabled={!selectedWorldMapPin || isSavingWorldMapPins}
                  className="rounded-md border border-red-300/30 bg-red-300/10 px-2.5 py-1.5 text-xs font-medium text-red-100 transition hover:border-red-300/60 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Delete Pin
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {isDebugInspectorOpen && debugStateLoggingEnabled ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-3xl rounded-2xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-200">
                  Debug Inspector
                </div>
                <p className="mt-1 text-xs text-zinc-400">
                  Session-only view of the last parsed structured GM blocks.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsDebugInspectorOpen(false)}
                className="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm font-medium text-zinc-200"
              >
                Close
              </button>
            </div>

            {debugSnapshot ? (
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <DebugPanel
                  title="SCENE"
                  content={JSON.stringify(debugSnapshot.scene, null, 2)}
                />
                <DebugPanel
                  title="COMBAT"
                  content={JSON.stringify(debugSnapshot.combatUpdate, null, 2)}
                />
                <DebugPanel
                  title="STATE"
                  content={JSON.stringify(debugSnapshot.stateUpdates, null, 2)}
                />
                <DebugPanel
                  title="PARTY"
                  content={JSON.stringify(debugSnapshot.partyUpdate, null, 2)}
                />
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-400">
                No debug snapshot yet. Send a GM turn while Debug On is enabled.
              </div>
            )}
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
                      errorMessage={characterFieldErrors[question.id]}
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
                  disabled={
                    !characterName.trim() ||
                    isGeneratingCharacter ||
                    Boolean(characterValidationError)
                  }
                  className="rounded-xl bg-emerald-300 px-4 py-2 font-medium text-zinc-950 disabled:opacity-60"
                >
                  {isGeneratingCharacter
                    ? "Generating character..."
                    : "Generate and save character"}
                </button>
              </form>
            </div>
          ) : null}

          <section className="mb-3 rounded-xl border border-zinc-800 bg-zinc-950/80 p-3.5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
              Scene
            </div>
            <div className="mt-2 hidden text-sm text-zinc-100">
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
              <div className="mt-3 hidden flex flex-wrap gap-x-3 gap-y-2 text-sm">
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
            <div className="mt-2 text-sm font-semibold text-zinc-100">
              {buildResolvedSceneHeading(sceneSummary)}
            </div>
            <div className="mt-2 text-sm text-emerald-100">
              <span className="font-medium text-emerald-300/80">Goal:</span>{" "}
              {sceneSummary.goal}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span
                className={`rounded-full px-2 py-0.5 font-medium ${getMoodBadgeClass(
                  sceneSummary.mood,
                )}`}
              >
                Mood: {sceneSummary.mood}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 font-medium ${getThreatBadgeClass(
                  sceneSummary.threat,
                )}`}
              >
                Threat: {sceneSummary.threat}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 font-medium ${getClockBadgeClass(
                  sceneSummary.clock,
                )}`}
              >
                Clock: {sceneSummary.clock}
              </span>
            </div>
          </section>

            <div className="h-[51vh] overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950 p-3 space-y-3">
            {messages.map((msg, index) => (
              (() => {
                const bubbleStyles = getMessageBubbleStyles(msg, companionColorMap);
                const isEditableScenarioBubble =
                  !isScenarioActive && index === 0 && msg.role === "gm";

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
                {isEditableScenarioBubble ? (
                  <div className="space-y-2">
                    <textarea
                      value={scenarioDraft}
                      onChange={(event) => {
                        setScenarioDraft(event.target.value);
                        if (error === "The starting scenario cannot be blank.") {
                          setError("");
                        }
                      }}
                      placeholder="Enter the opening scenario..."
                      className="min-h-[96px] w-full rounded-xl border border-zinc-700 bg-zinc-950/80 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-zinc-500"
                    />
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs text-zinc-400">
                        This opening scenario can be edited until you press Start.
                      </p>
                      <button
                        type="button"
                        onClick={saveScenarioDraft}
                        disabled={isSavingScenario || !scenarioDraft.trim()}
                        className="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:border-zinc-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isSavingScenario ? "Saving..." : "Update scenario"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <MessageBody role={msg.role} content={msg.content} />
                )}
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
                  type={!isScenarioActive && !needsCharacterGeneration ? "button" : "submit"}
                  onClick={
                    !isScenarioActive && !needsCharacterGeneration
                      ? handleScenarioAction
                      : undefined
                  }
                  disabled={
                    !isScenarioActive && !needsCharacterGeneration
                      ? isTogglingScenario || isSavingScenario
                      : loading || !input.trim() || isChatLocked
                  }
                  className="rounded-xl bg-zinc-100 px-4 py-2 font-medium text-zinc-900 disabled:opacity-50"
                >
                  {!isScenarioActive && !needsCharacterGeneration
                    ? isTogglingScenario
                      ? "Starting..."
                      : "Start"
                    : "Send"}
                </button>
                <button
                  type="button"
                  onClick={handleUndoLastTurn}
                  disabled={loading || isUndoingTurn || !canUndoLastTurn}
                  className="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm font-medium text-zinc-200 transition hover:border-zinc-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isUndoingTurn ? "Undoing..." : "Undo"}
                </button>
                {error ? <p className="text-sm text-red-400">{error}</p> : null}
              </div>

              <div className="relative flex items-center gap-2">
                <span className="text-xs text-zinc-500">ID: {campaignId}</span>
                {campaign ? (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        setIsUtilityMenuOpen((current) => !current)
                      }
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-950 text-sm text-zinc-300 transition hover:border-zinc-500 hover:text-white"
                      aria-label="Open campaign tools"
                    >
                      ⚙
                    </button>

                    {isUtilityMenuOpen ? (
                      <div className="absolute bottom-10 right-0 z-10 min-w-[12rem] rounded-xl border border-zinc-700 bg-zinc-950 p-2 shadow-2xl">
                        <div className="space-y-1">
                          <button
                            type="button"
                            onClick={handleScenarioAction}
                            disabled={
                              !isScenarioActive ||
                              needsCharacterGeneration ||
                              isTogglingScenario ||
                              isSavingScenario
                            }
                            className="block w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-200 transition hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isTogglingScenario ? "Resetting..." : "Reset"}
                          </button>
                          <button
                            type="button"
                            onClick={handleResyncState}
                            disabled={isResyncingState}
                            className="block w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-200 transition hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isResyncingState ? "Resyncing..." : "Resync"}
                          </button>
                          <button
                            type="button"
                            onClick={handleToggleDebugStateLogging}
                            className={`block w-full rounded-lg px-3 py-2 text-left text-sm transition hover:bg-zinc-900 ${
                              debugStateLoggingEnabled
                                ? "text-amber-100"
                                : "text-zinc-200"
                            }`}
                          >
                            Debug {debugStateLoggingEnabled ? "On" : "Off"}
                          </button>
                          <div className="px-3 py-2">
                            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                              Narration
                            </label>
                            <select
                              value={campaign.partyStateJson.narrationLevel}
                              onChange={(event) =>
                                handleSetNarrationLevel(
                                  event.target.value as NarrationLevel,
                                )
                              }
                              disabled={isSavingPartyState}
                              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-2 text-sm text-zinc-200 outline-none transition focus:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <option value="light">Light</option>
                              <option value="medium">Medium</option>
                              <option value="high">High</option>
                            </select>
                          </div>
                          <div className="px-3 py-2">
                            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                              Chat Model
                            </label>
                            <select
                              value={campaign.chatModel}
                              onChange={(event) =>
                                handleSetChatModel(
                                  event.target.value as CampaignChatModel,
                                )
                              }
                              disabled={isSavingChatModel}
                              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-2 text-sm text-zinc-200 outline-none transition focus:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {CAMPAIGN_CHAT_MODELS.map((model) => (
                                <option key={model} value={model}>
                                  {model === "gpt-5-mini"
                                    ? "GPT-5 Mini"
                                    : model === "gpt-5.1"
                                      ? "GPT-5.1"
                                      : "GPT-4o Mini"}
                                </option>
                              ))}
                            </select>
                          </div>
                          {debugStateLoggingEnabled ? (
                            <button
                              type="button"
                              onClick={() => {
                                setIsUtilityMenuOpen(false);
                                setIsDebugInspectorOpen(true);
                              }}
                              className="block w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-200 transition hover:bg-zinc-900"
                            >
                              Open Debug
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>
            </div>
          </form>
        </section>

        <aside className="rounded-2xl border border-zinc-800 bg-zinc-900 p-3 shadow">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-950 p-1">
              <button
                type="button"
                onClick={() => setActiveSidebarView("characters")}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                  activeSidebarView === "characters"
                    ? "bg-zinc-800 text-white"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                Characters
              </button>
              <button
                type="button"
                onClick={() => setActiveSidebarView("party")}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                  activeSidebarView === "party"
                    ? "bg-zinc-800 text-white"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                Party
              </button>
              <button
                type="button"
                onClick={() => setActiveSidebarView("map")}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                  activeSidebarView === "map"
                    ? "bg-zinc-800 text-white"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                Map
              </button>
              <button
                type="button"
                onClick={() => setActiveSidebarView("images")}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                  activeSidebarView === "images"
                    ? "bg-zinc-800 text-white"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                Images
              </button>
            </div>
            {activeSidebarView === "characters" && campaign && !needsCharacterGeneration ? (
              <Link
                href={`/campaign/${campaignId}/companions`}
                className="rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-2.5 py-1.5 text-xs font-medium text-cyan-100 transition hover:border-cyan-300/60"
              >
                Add character
              </Link>
              ) : null}
            </div>
          {activeSidebarView === "characters" ? (
            <div className="max-h-[calc(100vh-6rem)] overflow-y-auto pr-1">
              {combatActive && !detailCardId ? (
                <div className="space-y-2 text-xs text-zinc-300">
                  <div className="rounded-xl border border-red-400/20 bg-red-400/5 px-3 py-2 text-[11px] uppercase tracking-[0.14em] text-red-200/90">
                    Combat Round {combatState.round}
                  </div>
                  {initiativeOrderedCombatRoster.map(({ entry }, index) => {
                    const linkedCharacter =
                      (entry.id ? characterMapById.get(entry.id) : null) ??
                      characterMapByName.get(normalizeCharacterLookupName(entry.name)) ??
                      null;

                    if (linkedCharacter) {
                      return (
                        <CharacterCard
                          key={`combat-${linkedCharacter.id}-${index}`}
                          character={linkedCharacter}
                          campaignRuleset={campaign?.ruleset ?? ""}
                          companionColorMap={companionColorMap}
                          isDeleting={deletingCharacterId === linkedCharacter.id}
                          isExporting={exportingCharacterId === linkedCharacter.id}
                          isGeneratingPortrait={generatingPortraitId === linkedCharacter.id}
                          collapsed={Boolean(collapsedCards[linkedCharacter.id])}
                          fullDetail={false}
                          initiativeOrder={index + 1}
                          isActiveTurn={entry.active}
                          onDelete={() => handleDeleteCharacter(linkedCharacter)}
                          onExport={(mode) => handleExportCharacter(linkedCharacter, mode)}
                          onGeneratePortrait={() => handleGeneratePortrait(linkedCharacter)}
                          onUploadPortrait={(event) => handleUploadPortrait(linkedCharacter, event)}
                          onCharacterUpdated={(updatedCharacter) =>
                            setCampaign((currentCampaign) =>
                              currentCampaign
                                ? {
                                    ...currentCampaign,
                                    characters: currentCampaign.characters.map((currentCharacter) =>
                                      currentCharacter.id === updatedCharacter.id
                                        ? updatedCharacter
                                        : currentCharacter,
                                    ),
                                  }
                                : currentCampaign,
                            )
                          }
                          onToggle={() => {
                            setCollapsedCards((current) => ({
                              ...current,
                              [linkedCharacter.id]: !current[linkedCharacter.id],
                            }));
                          }}
                          onToggleDetail={() => {
                            setCollapsedCards((current) => ({
                              ...current,
                              [linkedCharacter.id]: false,
                            }));
                            setDetailCardId(linkedCharacter.id);
                          }}
                        />
                      );
                    }

                    return (
                      <CombatRosterCard
                        key={`combat-entry-${entry.name}-${index}`}
                        entry={entry}
                        order={index + 1}
                      />
                    );
                  })}
                </div>
              ) : (
                <div
                  className={`grid gap-3 text-xs text-zinc-300 ${
                    "grid-cols-1"
                    }`}
                >
                {mainCharacter && (!detailCardId || detailCardId === mainCharacter.id) ? (
                    <CharacterCard
                      character={mainCharacter}
                      campaignRuleset={campaign?.ruleset ?? ""}
                      companionColorMap={companionColorMap}
                      isDeleting={deletingCharacterId === mainCharacter.id}
                      isExporting={exportingCharacterId === mainCharacter.id}
                      isGeneratingPortrait={generatingPortraitId === mainCharacter.id}
                      collapsed={Boolean(collapsedCards[mainCharacter.id])}
                      fullDetail={detailCardId === mainCharacter.id}
                      initiativeOrder={getCharacterInitiativeOrder(combatState, mainCharacter)}
                      isActiveTurn={isCombatantActive(combatState, mainCharacter)}
                      onDelete={() => handleDeleteCharacter(mainCharacter)}
                      onExport={(mode) => handleExportCharacter(mainCharacter, mode)}
                      onGeneratePortrait={() => handleGeneratePortrait(mainCharacter)}
                      onUploadPortrait={(event) => handleUploadPortrait(mainCharacter, event)}
                      onCharacterUpdated={(updatedCharacter) =>
                        setCampaign((currentCampaign) =>
                          currentCampaign
                            ? {
                                ...currentCampaign,
                                characters: currentCampaign.characters.map((currentCharacter) =>
                                  currentCharacter.id === updatedCharacter.id
                                    ? updatedCharacter
                                    : currentCharacter,
                                ),
                              }
                            : currentCampaign,
                        )
                      }
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
                        campaignRuleset={campaign?.ruleset ?? ""}
                        companionColorMap={companionColorMap}
                        isDeleting={deletingCharacterId === character.id}
                        isExporting={exportingCharacterId === character.id}
                        isGeneratingPortrait={generatingPortraitId === character.id}
                        collapsed={Boolean(collapsedCards[character.id])}
                        fullDetail={detailCardId === character.id}
                        initiativeOrder={getCharacterInitiativeOrder(combatState, character)}
                        isActiveTurn={isCombatantActive(combatState, character)}
                        onDelete={() => handleDeleteCharacter(character)}
                        onExport={(mode) => handleExportCharacter(character, mode)}
                        onGeneratePortrait={() => handleGeneratePortrait(character)}
                        onUploadPortrait={(event) => handleUploadPortrait(character, event)}
                        onCharacterUpdated={(updatedCharacter) =>
                          setCampaign((currentCampaign) =>
                            currentCampaign
                              ? {
                                  ...currentCampaign,
                                  characters: currentCampaign.characters.map((currentCharacter) =>
                                    currentCharacter.id === updatedCharacter.id
                                      ? updatedCharacter
                                      : currentCharacter,
                                  ),
                                }
                              : currentCampaign,
                          )
                        }
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
              )}
              </div>
          ) : activeSidebarView === "party" ? (
            <div className="max-h-[calc(100vh-6rem)] overflow-y-auto pr-1">
              <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-300">
                <div className="mb-3 inline-flex rounded-lg border border-zinc-800 bg-zinc-900 p-1">
                  {([
                    ["info", "Info"],
                    ["reputation", "Reputation"],
                    ["quests", "Quests"],
                    ["journal", "Journal"],
                    ["recap", "Recap"],
                    ["progression", "Progression"],
                  ] as const).map(([tabId, label]) => (
                    <button
                      key={tabId}
                      type="button"
                      onClick={() => {
                        setActivePartyTab(tabId);
                        if (tabId === "progression") {
                          setIsEditingPartyState(false);
                        }
                      }}
                      className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                        activePartyTab === tabId
                          ? "bg-zinc-800 text-white"
                          : "text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {activePartyTab === "progression" ? (
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                        Progression Mode
                      </div>
                      <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-900 p-1">
                        {([
                          ["character", "Character"],
                          ["party", "Party"],
                          ["milestone", "Milestone"],
                        ] as const).map(([modeId, label]) => (
                          <button
                            key={modeId}
                            type="button"
                            onClick={() => handleSetProgressionMode(modeId)}
                            disabled={isSavingProgressionMode}
                            className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                              progressionState.mode === modeId
                                ? "bg-zinc-800 text-white"
                                : "text-zinc-400 hover:text-zinc-200"
                            } disabled:cursor-not-allowed disabled:opacity-50`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <label className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/70 px-2.5 py-2 text-[11px] text-zinc-300">
                        <span>Auto-apply suggested {progressionInsights.levelLabel.toLowerCase()}s</span>
                        <input
                          type="checkbox"
                          checked={progressionState.autoApplyLevels}
                          disabled={isSavingProgressionAutomation}
                          onChange={(event) =>
                            handleSetProgressionAutoApply(event.target.checked)
                          }
                        />
                      </label>
                    </div>

                    <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                        Totals
                      </div>
                      <div className="mt-2 space-y-1 text-sm text-zinc-200">
                        <div>
                          Party Total:{" "}
                          <span className="font-semibold">
                            {progressionState.partyTotal} {progressionState.currency.toUpperCase()}
                          </span>
                        </div>
                        {(campaign?.characters ?? []).map((character) => (
                          <div key={character.id} className="flex items-center justify-between gap-2">
                            <span className="truncate">{character.name}</span>
                            <span className="font-semibold text-zinc-100">
                              {progressionTotalsByCharacterId.get(character.id) ?? 0}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900/70 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                          {progressionInsights.levelLabel} Readiness
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleProgressionAction("undo-last-event")}
                            disabled={isManagingProgressionEvents || progressionEvents.length === 0}
                            className="rounded-lg border border-amber-300/30 bg-amber-300/10 px-2.5 py-1 text-[11px] font-medium text-amber-100 transition hover:border-amber-300/60 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isManagingProgressionEvents ? "Working..." : "Undo Last Award"}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleProgressionAction("award-milestone")}
                            disabled={
                              isManagingProgressionEvents || progressionState.mode !== "milestone"
                            }
                            className="rounded-lg border border-violet-300/30 bg-violet-300/10 px-2.5 py-1 text-[11px] font-medium text-violet-100 transition hover:border-violet-300/60 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isManagingProgressionEvents
                              ? "Working..."
                              : "Award Milestone"}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleProgressionAction("recalculate-state")}
                            disabled={isManagingProgressionEvents}
                            className="rounded-lg border border-zinc-300/30 bg-zinc-300/10 px-2.5 py-1 text-[11px] font-medium text-zinc-100 transition hover:border-zinc-300/60 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isManagingProgressionEvents ? "Working..." : "Recalc"}
                          </button>
                          <button
                            type="button"
                            onClick={handleResetProgression}
                            disabled={isManagingProgressionEvents}
                            className="rounded-lg border border-red-300/30 bg-red-300/10 px-2.5 py-1 text-[11px] font-medium text-red-100 transition hover:border-red-300/60 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isManagingProgressionEvents ? "Working..." : "Reset"}
                          </button>
                          <button
                            type="button"
                            onClick={handleApplySuggestedLevels}
                            disabled={
                              isApplyingProgressionLevels ||
                              progressionInsights.characters.every(
                                (entry) => !entry.readyToLevel,
                              )
                            }
                            className="rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-2.5 py-1 text-[11px] font-medium text-cyan-100 transition hover:border-cyan-300/60 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isApplyingProgressionLevels
                              ? "Applying..."
                              : "Apply Suggested Levels"}
                          </button>
                        </div>
                      </div>
                      <div className="rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-2 text-[11px] text-zinc-300">
                        Party Suggestion: {progressionInsights.levelLabel}{" "}
                        {progressionInsights.party.suggestedLevel}
                        {progressionInsights.party.nextLevel &&
                        progressionInsights.party.remainingToNext !== null
                          ? ` (${progressionInsights.party.remainingToNext} to ${progressionInsights.party.nextLevel})`
                          : ""}
                      </div>
                      <div className="space-y-1">
                        {progressionInsights.characters.map((entry) => {
                          const characterName =
                            characterMapById.get(entry.characterId)?.name ?? "Unknown character";

                          return (
                            <div
                              key={`progression-insight-${entry.characterId}`}
                              className="rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-2 text-[11px]"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="truncate text-zinc-100">{characterName}</span>
                                <span
                                  className={
                                    entry.readyToLevel
                                      ? "font-semibold text-emerald-300"
                                      : "text-zinc-300"
                                  }
                                >
                                  {progressionInsights.levelLabel} {entry.currentLevel} {"->"}{" "}
                                  {entry.suggestedLevel}
                                </span>
                              </div>
                              <div className="mt-1 text-zinc-500">
                                {entry.nextLevel && entry.remainingToNext !== null
                                  ? `${entry.remainingToNext} ${progressionState.currency.toUpperCase()} to ${progressionInsights.levelLabel} ${entry.nextLevel}`
                                  : `${progressionInsights.levelLabel} cap reached`}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900/70 p-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                        Add Award
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="space-y-1">
                          <span className="text-[11px] uppercase tracking-[0.12em] text-zinc-500">
                            Amount
                          </span>
                          <input
                            value={progressionAmountInput}
                            onChange={(event) => setProgressionAmountInput(event.target.value)}
                            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-600"
                            inputMode="numeric"
                            placeholder="100"
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="text-[11px] uppercase tracking-[0.12em] text-zinc-500">
                            Reason
                          </span>
                          <input
                            value={progressionReasonInput}
                            onChange={(event) => setProgressionReasonInput(event.target.value)}
                            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-600"
                            placeholder="Major objective completed"
                          />
                        </label>
                      </div>

                      <label className="space-y-1">
                        <span className="text-[11px] uppercase tracking-[0.12em] text-zinc-500">
                          Note
                        </span>
                        <textarea
                          value={progressionNoteInput}
                          onChange={(event) => setProgressionNoteInput(event.target.value)}
                          className="min-h-[64px] w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-600"
                          placeholder="Optional details for this award"
                        />
                      </label>

                      <div className="space-y-2">
                        <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-900 p-1">
                          {([
                            ["party", "Party Award"],
                            ["character", "Character Award"],
                          ] as const).map(([recipientType, label]) => (
                            <button
                              key={recipientType}
                              type="button"
                              onClick={() => setProgressionRecipientType(recipientType)}
                              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                                progressionRecipientType === recipientType
                                  ? "bg-zinc-800 text-white"
                                  : "text-zinc-400 hover:text-zinc-200"
                              }`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>

                        {progressionRecipientType === "character" ? (
                          <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950 p-2">
                            {(campaign?.characters ?? []).map((character) => {
                              const checked = progressionRecipientCharacterIds.includes(
                                character.id,
                              );

                              return (
                                <label
                                  key={character.id}
                                  className="flex items-center gap-2 text-xs text-zinc-300"
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(event) =>
                                      setProgressionRecipientCharacterIds((current) => {
                                        if (event.target.checked) {
                                          return [...new Set([...current, character.id])];
                                        }

                                        return current.filter(
                                          (characterId) => characterId !== character.id,
                                        );
                                      })
                                    }
                                  />
                                  <span>{character.name}</span>
                                </label>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>

                      <div className="flex items-center justify-between gap-3">
                        <div className="text-[11px] text-zinc-500">
                          Currency: {progressionState.currency.toUpperCase()}
                        </div>
                        <button
                          type="button"
                          onClick={handleAwardProgression}
                          disabled={isSavingProgressionEvent}
                          className="rounded-lg border border-emerald-300/30 bg-emerald-300/10 px-3 py-1.5 text-xs font-medium text-emerald-100 transition hover:border-emerald-300/60 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isSavingProgressionEvent ? "Saving..." : "Add Award"}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900/70 p-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                        Recent Events
                      </div>
                      {progressionEvents.length > 0 ? (
                        <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                          {[...progressionEvents]
                            .reverse()
                            .map((event) => (
                              <div
                                key={event.id}
                                className="rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-2 text-xs text-zinc-300"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-semibold text-zinc-100">
                                    {event.amount} {event.currency.toUpperCase()} - {event.reason}
                                  </span>
                                  <span className="text-[10px] text-zinc-500">
                                    {formatProgressionTimestamp(event.createdAt)}
                                  </span>
                                </div>
                                <div className="mt-1 text-[11px] text-zinc-400">
                                  {event.recipientType === "party"
                                    ? "Recipients: Entire party"
                                    : `Recipients: ${
                                        event.characterIds
                                          .map(
                                            (characterId) =>
                                              characterMapById.get(characterId)?.name ??
                                              "Unknown character",
                                          )
                                          .join(", ") || "Unknown character"
                                      }`}
                                </div>
                                {event.note ? (
                                  <div className="mt-1 text-[11px] text-zinc-400">
                                    Note: {event.note}
                                  </div>
                                ) : null}
                              </div>
                            ))}
                        </div>
                      ) : (
                        <div className="text-[11px] text-zinc-500">
                          No progression events yet.
                        </div>
                      )}
                    </div>
                  </div>
                ) : isEditingPartyState ? (
                  <div className="space-y-3">
                    {activePartyTab === "info" ? (
                      <>
                        <div>
                          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                            Party Name
                          </label>
                          <input
                            value={partyStateDraft.partyName}
                            onChange={(event) =>
                              setPartyStateDraft((current) => ({
                                ...current,
                                partyName: event.target.value,
                              }))
                            }
                            placeholder="Name the party"
                            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-600"
                          />
                        </div>

                        <div>
                          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                            Party Summary
                          </label>
                          <textarea
                            value={partyStateDraft.summary}
                            onChange={(event) =>
                              setPartyStateDraft((current) => ({
                                ...current,
                                summary: event.target.value,
                              }))
                            }
                            placeholder="Describe the group, current priorities, and overall vibe."
                            className="min-h-[88px] w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-600"
                          />
                        </div>

                        <PartyStateTextarea
                          label="Shared Inventory"
                          value={partyStateDraft.sharedInventory}
                          placeholder="One shared item, currency note, or resource per line"
                          onChange={(value) =>
                            setPartyStateDraft((current) => ({
                              ...current,
                              sharedInventory: value,
                            }))
                          }
                        />
                      </>
                    ) : null}

                    {activePartyTab === "reputation" ? (
                      <PartyReputationEditor
                        entries={partyStateDraft.reputation}
                        onChange={(nextEntries) =>
                          setPartyStateDraft((current) => ({
                            ...current,
                            reputation: nextEntries,
                          }))
                        }
                      />
                    ) : null}

                    {activePartyTab === "quests" ? (
                      <>
                        <PartyStateTextarea
                          label="Active Quests"
                          value={partyStateDraft.activeQuests}
                          placeholder="One active quest per line"
                          onChange={(value) =>
                            setPartyStateDraft((current) => ({
                              ...current,
                              activeQuests: value,
                            }))
                          }
                        />

                        <PartyStateTextarea
                          label="Completed Quests"
                          value={partyStateDraft.completedQuests}
                          placeholder="One completed quest per line"
                          onChange={(value) =>
                            setPartyStateDraft((current) => ({
                              ...current,
                              completedQuests: value,
                            }))
                          }
                        />
                      </>
                    ) : null}

                    {activePartyTab === "journal" ? (
                      <PartyStateTextarea
                        label="Journal"
                        value={partyStateDraft.journal}
                        placeholder="One important party event or recap entry per line"
                        onChange={(value) =>
                          setPartyStateDraft((current) => ({
                            ...current,
                            journal: value,
                          }))
                        }
                      />
                    ) : null}

                    {activePartyTab === "recap" ? (
                      <div className="space-y-2">
                        <PartyStateTextarea
                          label="Recap"
                          value={partyStateDraft.recap}
                          placeholder="Short rolling summary of what currently matters."
                          onChange={(value) =>
                            setPartyStateDraft((current) => ({
                              ...current,
                              recap: value,
                            }))
                          }
                        />
                        <div className="text-[11px] text-zinc-500">
                          Keep this concise. It is used as compressed campaign memory for the GM.
                        </div>
                      </div>
                    ) : null}

                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[11px] text-zinc-500">
                        These notes persist with the campaign and are included in GM context.
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setPartyStateDraft(
                              buildPartyStateDraft(
                                campaign?.partyStateJson ?? DEFAULT_PARTY_STATE,
                              ),
                            );
                            setIsEditingPartyState(false);
                          }}
                          disabled={isSavingPartyState}
                          className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:border-zinc-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={handleSavePartyState}
                          disabled={isSavingPartyState}
                          className="rounded-lg border border-emerald-300/30 bg-emerald-300/10 px-3 py-1.5 text-xs font-medium text-emerald-100 transition hover:border-emerald-300/60 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isSavingPartyState ? "Saving..." : "Save Party"}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-[11px] text-zinc-500">
                        Party details persist with the campaign and are included in GM context.
                      </div>
                      <button
                        type="button"
                        onClick={() => setIsEditingPartyState(true)}
                        className="rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-3 py-1.5 text-xs font-medium text-cyan-100 transition hover:border-cyan-300/60"
                      >
                        Edit
                      </button>
                    </div>

                    {activePartyTab === "info" ? (
                      <>
                        <PartyStateDisplay
                          label="Party Name"
                          value={campaign?.partyStateJson.partyName}
                          emptyLabel="No party name yet."
                        />
                        <PartyStateDisplay
                          label="Party Summary"
                          value={campaign?.partyStateJson.summary}
                          emptyLabel="No party summary yet."
                          multiline
                        />
                        <PartyStateDisplay
                          label="Shared Inventory"
                          value={campaign?.partyStateJson.sharedInventory}
                          emptyLabel="No shared inventory yet."
                          multiline
                        />
                      </>
                    ) : null}

                    {activePartyTab === "reputation" ? (
                      <PartyStateDisplay
                        label="Reputation"
                        value={campaign?.partyStateJson.reputation}
                        emptyLabel="No reputation tracked yet."
                        reputation
                      />
                    ) : null}

                    {activePartyTab === "quests" ? (
                      <>
                        <PartyStateDisplay
                          label="Active Quests"
                          value={campaign?.partyStateJson.activeQuests}
                          emptyLabel="No active quests yet."
                          multiline
                        />
                        <PartyStateDisplay
                          label="Completed Quests"
                          value={campaign?.partyStateJson.completedQuests}
                          emptyLabel="No completed quests yet."
                          multiline
                        />
                      </>
                    ) : null}

                    {activePartyTab === "journal" ? (
                      <PartyStateDisplay
                        label="Journal"
                        value={campaign?.partyStateJson.journal}
                        emptyLabel="No journal entries yet."
                        multiline
                      />
                    ) : null}

                    {activePartyTab === "recap" ? (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-[11px] text-zinc-500">
                            Rolling memory used to keep the GM anchored on what still matters.
                          </div>
                          <button
                            type="button"
                            onClick={handleRefreshRecap}
                            disabled={isRefreshingRecap}
                            className="rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-3 py-1.5 text-xs font-medium text-cyan-100 transition hover:border-cyan-300/60 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isRefreshingRecap ? "Refreshing..." : "Refresh Recap"}
                          </button>
                        </div>
                        <PartyStateDisplay
                          label="Recap"
                          value={campaign?.partyStateJson.recap}
                          emptyLabel="No recap yet."
                          multiline
                        />
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          ) : activeSidebarView === "map" ? (
            <div className="max-h-[calc(100vh-6rem)] overflow-y-auto pr-1">
              <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-300">
                <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-900 p-1">
                  <button
                    type="button"
                    onClick={() => setActiveWorldMapTab("saved")}
                    className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                      activeWorldMapTab === "saved"
                        ? "bg-zinc-800 text-white"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    Saved
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveWorldMapTab("generate")}
                    className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                      activeWorldMapTab === "generate"
                        ? "bg-zinc-800 text-white"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    Add
                  </button>
                </div>

                {activeWorldMapTab === "saved" ? (
                  selectedWorldMap ? (
                    <div className="space-y-3">
                      <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 px-3 py-2.5">
                        <div className="flex items-start justify-between gap-3">
                          <button
                            type="button"
                            onClick={() =>
                              setActiveWorldMapIndex((current) => Math.max(0, current - 1))
                            }
                            disabled={activeWorldMapIndex <= 0}
                            className="shrink-0 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs font-medium text-zinc-200 transition hover:border-zinc-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                            aria-label="Previous world map"
                          >
                            {"\u2190"}
                          </button>
                          <div className="min-w-0 flex-1 text-center">
                            {isEditingWorldMapTitle ? (
                              <input
                                value={worldMapTitleInput}
                                onChange={(event) => setWorldMapTitleInput(event.target.value)}
                                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-center text-sm text-zinc-100 outline-none focus:border-zinc-500"
                                placeholder="Map title"
                              />
                            ) : (
                              <div className="truncate px-2 text-sm font-medium text-white">
                                {selectedWorldMap.title}
                              </div>
                            )}
                            <div className="mt-1 text-[10px] text-zinc-600">
                              {activeWorldMapIndex + 1} / {worldMapHistory.length}
                            </div>
                          </div>
                          <div className="relative flex items-start gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                setActiveWorldMapIndex((current) =>
                                  Math.min(worldMapHistory.length - 1, current + 1),
                                )
                              }
                              disabled={activeWorldMapIndex >= worldMapHistory.length - 1}
                              className="shrink-0 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs font-medium text-zinc-200 transition hover:border-zinc-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                              aria-label="Next world map"
                            >
                              {"\u2192"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setIsWorldMapMenuOpen((current) => !current)}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-950 text-xs text-zinc-300 transition hover:border-zinc-500 hover:text-white"
                              aria-label="Open world map actions"
                            >
                              {"\u2699"}
                            </button>
                            {isWorldMapMenuOpen ? (
                              <div className="absolute right-0 top-8 z-10 min-w-[11rem] rounded-xl border border-zinc-700 bg-zinc-950 p-2 shadow-2xl">
                                <div className="space-y-1">
                                  {isEditingWorldMapTitle ? (
                                    <>
                                      <button
                                        type="button"
                                        onClick={handleSaveWorldMapTitle}
                                        disabled={isSavingWorldMapTitle || !worldMapTitleInput.trim()}
                                        className="block w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-200 transition hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-50"
                                      >
                                        {isSavingWorldMapTitle ? "Saving..." : "Save Label"}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setWorldMapTitleInput(selectedWorldMap.title);
                                          setIsEditingWorldMapTitle(false);
                                          setIsWorldMapMenuOpen(false);
                                        }}
                                        className="block w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-200 transition hover:bg-zinc-900"
                                      >
                                        Cancel Edit
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setIsEditingWorldMapTitle(true);
                                        setIsWorldMapMenuOpen(false);
                                      }}
                                      className="block w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-200 transition hover:bg-zinc-900"
                                    >
                                      Edit Label
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={handleDeleteWorldMap}
                                    disabled={isDeletingWorldMap}
                                    className="block w-full rounded-lg px-3 py-2 text-left text-sm text-red-200 transition hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    {isDeletingWorldMap ? "Removing..." : "Remove Map"}
                                  </button>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                      <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
                        <div className="relative w-full">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={selectedWorldMapImageSrc}
                            alt={selectedWorldMap.title}
                            className="block h-auto w-full object-contain"
                          />
                          {selectedWorldMapPins.map((pin) => (
                            <div
                              key={pin.id}
                              className="pointer-events-none absolute -translate-x-1/2 -translate-y-full"
                              style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
                            >
                              <div className="rounded-sm border border-zinc-500 bg-zinc-900/90 px-1 py-0.5 text-[9px] text-zinc-100">
                                {pin.label}
                              </div>
                              <div
                                className="mx-auto mt-0.5 h-1.5 w-1.5 rounded-full border border-zinc-950"
                                style={{ backgroundColor: pin.color }}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[11px] text-zinc-400">{selectedWorldMap.summary}</div>
                        <button
                          type="button"
                          onClick={() => setIsWorldMapViewerOpen(true)}
                          className="shrink-0 rounded-md border border-zinc-600 bg-zinc-900/90 p-1.5 text-zinc-100 transition hover:border-zinc-400 hover:text-white"
                          aria-label="Expand map image"
                          title="Expand"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            className="h-3.5 w-3.5"
                            aria-hidden="true"
                          >
                            <path d="M9 3H3v6" />
                            <path d="M15 3h6v6" />
                            <path d="M9 21H3v-6" />
                            <path d="M15 21h6v-6" />
                            <path d="M3 3l7 7" />
                            <path d="M21 3l-7 7" />
                            <path d="M3 21l7-7" />
                            <path d="M21 21l-7-7" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-4 text-sm text-zinc-400">
                      No saved maps yet. Use the Generate tab to create or save one.
                    </div>
                  )
                ) : (
                  <div className="space-y-3">
                    <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-[11px] text-zinc-400">
                      Use one of three options:
                      Generate creates a new map from your world details.
                      Save Link stores an external map URL as a saved entry.
                      Upload saves an image file directly to your campaign history.
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                        Title
                      </label>
                      <input
                        value={worldMapTitleInput}
                        onChange={(event) => setWorldMapTitleInput(event.target.value)}
                        placeholder={`${campaign?.title ?? "Campaign"} World Map`}
                        className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-600"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                        Realm / World Details
                      </label>
                      <textarea
                        value={worldMapPrompt}
                        onChange={(event) => setWorldMapPrompt(event.target.value)}
                        placeholder="Describe continents, kingdoms, climate bands, major cities, landmarks, and travel routes."
                        className="min-h-[120px] w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-600"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                        IMAGE LINK URL
                      </label>
                      <input
                        value={worldMapReferenceUrl}
                        onChange={(event) => setWorldMapReferenceUrl(event.target.value)}
                        placeholder="https://... map image URL"
                        className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-600"
                      />
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                        <button
                          type="button"
                          onClick={() => void handleCreateWorldMap("generated")}
                          disabled={isGeneratingWorldMap || !worldMapPrompt.trim()}
                          className="rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-sm font-medium text-cyan-100 transition hover:border-cyan-300/60 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isGeneratingWorldMap ? "Generating..." : "Generate"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleCreateWorldMap("reference")}
                          disabled={isSavingWorldMap || !worldMapReferenceUrl.trim()}
                          className="rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-sm font-medium text-cyan-100 transition hover:border-cyan-300/60 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isSavingWorldMap ? "Saving..." : "Save Link"}
                        </button>
                        <label className="cursor-pointer rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-center text-sm font-medium text-zinc-200 transition hover:border-zinc-500 hover:text-white">
                          Upload
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={handleUploadWorldMapReference}
                          />
                        </label>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="max-h-[calc(100vh-6rem)] overflow-y-auto pr-1">
              <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-300">
                {selectedSceneImage ? (
                  <div className="space-y-3">
                    <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 px-3 py-2.5">
                      <div className="flex items-start justify-between gap-3">
                        <button
                          type="button"
                          onClick={() =>
                            setActiveSceneImageIndex((current) =>
                              Math.max(0, current - 1),
                            )
                          }
                          disabled={activeSceneImageIndex <= 0}
                          className="shrink-0 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs font-medium text-zinc-200 transition hover:border-zinc-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                          aria-label="Previous scene image"
                        >
                          ←
                        </button>
                        <div className="min-w-0 flex-1 text-center">
                          {isEditingSceneImageMeta ? (
                            <div className="space-y-2">
                              <input
                                value={sceneImageDraft.sceneTitle}
                                onChange={(event) =>
                                  setSceneImageDraft((current) => ({
                                    ...current,
                                    sceneTitle: event.target.value,
                                  }))
                                }
                                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-center text-sm text-zinc-100 outline-none focus:border-zinc-500"
                                placeholder="Scene title"
                              />
                              <input
                                value={sceneImageDraft.place}
                                onChange={(event) =>
                                  setSceneImageDraft((current) => ({
                                    ...current,
                                    place: event.target.value,
                                  }))
                                }
                                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-center text-[11px] text-zinc-300 outline-none focus:border-zinc-500"
                                placeholder="Scene subtitle"
                              />
                            </div>
                          ) : (
                            <>
                              <div className="truncate text-sm font-medium text-white">
                                {selectedSceneImage.sceneTitle}
                              </div>
                              <div className="mt-1 text-[11px] text-zinc-500">
                                {selectedSceneImage.place}
                              </div>
                            </>
                          )}
                          <div className="mt-1 text-[10px] text-zinc-600">
                            {activeSceneImageIndex + 1} / {sceneImageHistory.length}
                          </div>
                        </div>
                        <div className="relative flex items-start gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setActiveSceneImageIndex((current) =>
                                Math.min(sceneImageHistory.length - 1, current + 1),
                              )
                            }
                            disabled={activeSceneImageIndex >= sceneImageHistory.length - 1}
                            className="shrink-0 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs font-medium text-zinc-200 transition hover:border-zinc-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                            aria-label="Next scene image"
                          >
                            →
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setIsSceneImageMenuOpen((current) => !current)
                            }
                            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-950 text-xs text-zinc-300 transition hover:border-zinc-500 hover:text-white"
                            aria-label="Open scene image actions"
                          >
                            ⚙
                          </button>
                          {isSceneImageMenuOpen ? (
                            <div className="absolute right-0 top-8 z-10 min-w-[11rem] rounded-xl border border-zinc-700 bg-zinc-950 p-2 shadow-2xl">
                              <div className="space-y-1">
                                {isEditingSceneImageMeta ? (
                                  <>
                                    <button
                                      type="button"
                                      onClick={handleSaveSceneImageMeta}
                                      className="block w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-200 transition hover:bg-zinc-900"
                                    >
                                      Save Labels
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setSceneImageDraft({
                                          sceneTitle: selectedSceneImage.sceneTitle,
                                          place: selectedSceneImage.place,
                                        });
                                        setIsEditingSceneImageMeta(false);
                                        setIsSceneImageMenuOpen(false);
                                      }}
                                      className="block w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-200 transition hover:bg-zinc-900"
                                    >
                                      Cancel Edit
                                    </button>
                                  </>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setIsEditingSceneImageMeta(true);
                                      setIsSceneImageMenuOpen(false);
                                    }}
                                    className="block w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-200 transition hover:bg-zinc-900"
                                  >
                                    Edit Labels
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={handleDeleteSceneImage}
                                  className="block w-full rounded-lg px-3 py-2 text-left text-sm text-red-200 transition hover:bg-zinc-900"
                                >
                                  Remove Image
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60">
                      <div className="relative aspect-[4/3] w-full bg-zinc-950">
                        <Image
                          src={selectedSceneImage.imageDataUrl ?? DEFAULT_PORTRAIT_DATA_URL}
                          alt={selectedSceneImage.title}
                          fill
                          sizes="(max-width: 1024px) 100vw, 32vw"
                          className="object-cover"
                          unoptimized
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                        IMAGE PROMPT
                      </label>
                      <textarea
                        value={sceneImagePrompt}
                        onChange={(event) => setSceneImagePrompt(event.target.value)}
                        placeholder="Describe the scene map prompt sent to image generation."
                        className="min-h-[110px] w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-600"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleRefreshMap}
                      disabled={isRefreshingMap || !campaign}
                      className="w-full rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-sm font-medium text-cyan-100 transition hover:border-cyan-300/60 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isRefreshingMap ? "Generating..." : "Generate Scene"}
                    </button>
                  </div>
                ) : (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-4 text-sm text-zinc-400">
                    <div className="space-y-3">
                      <div>
                        No scene image yet. Start the scenario to auto-generate the first image, or generate one from the latest GM scene.
                      </div>
                      <div className="space-y-1">
                        <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                          IMAGE PROMPT
                        </label>
                        <textarea
                          value={sceneImagePrompt}
                          onChange={(event) => setSceneImagePrompt(event.target.value)}
                          placeholder="Describe the scene map prompt sent to image generation."
                          className="min-h-[110px] w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-600"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={handleRefreshMap}
                        disabled={isRefreshingMap || !campaign}
                        className="w-full rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-sm font-medium text-cyan-100 transition hover:border-cyan-300/60 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isRefreshingMap ? "Generating..." : "Generate Scene"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}

function CharacterCard({
  character,
  campaignRuleset,
  companionColorMap,
  isDeleting,
  isExporting,
  isGeneratingPortrait,
  collapsed,
  fullDetail,
  initiativeOrder,
  isActiveTurn,
  onDelete,
  onExport,
  onGeneratePortrait,
  onUploadPortrait,
  onCharacterUpdated,
  onToggle,
  onToggleDetail,
}: {
  character: CampaignCharacter;
  campaignRuleset: string;
  companionColorMap: Record<string, CompanionPalette>;
  isDeleting: boolean;
  isExporting: boolean;
  isGeneratingPortrait: boolean;
  collapsed: boolean;
  fullDetail: boolean;
  initiativeOrder?: number;
  isActiveTurn?: boolean;
  onDelete: () => void;
  onExport: (mode: "update-master" | "create-version") => void;
  onGeneratePortrait: () => void;
  onUploadPortrait: (event: ChangeEvent<HTMLInputElement>) => void;
  onCharacterUpdated: (character: CampaignCharacter) => void;
  onToggle: () => void;
  onToggleDetail: () => void;
}) {
  const [detailTab, setDetailTab] = useState<
    "stats" | "skills" | "equipment" | "spells" | "notes"
  >("stats");
  const [isDetailMenuOpen, setIsDetailMenuOpen] = useState(false);
  const [isEditingSheet, setIsEditingSheet] = useState(false);
  const [isSavingSheet, setIsSavingSheet] = useState(false);
  const [editError, setEditError] = useState("");
  const [editName, setEditName] = useState(character.name);
  const [editSheetJson, setEditSheetJson] = useState<EditableSheetObject>(
    cloneEditableSheet(character.sheetJson),
  );
  const longTextKeys = new Set([
    "background",
    "physicalDescription",
    "personality",
    "behaviorSummary",
  ]);
  const allStatEntries = Object.entries(character.sheetJson ?? {}).filter(
    ([key]) => key !== "source" && key !== "concept" && key !== "portraitDataUrl",
  );
  const detailEntries = allStatEntries.filter(([key]) => longTextKeys.has(key));
  const orderedDetailEntries = [...detailEntries].sort(([leftKey], [rightKey]) => {
    const order = [
      "physicalDescription",
      "background",
      "personality",
      "behaviorSummary",
    ];
    return order.indexOf(leftKey) - order.indexOf(rightKey);
  });
  const editDetailEntries = Object.entries(editSheetJson).filter(([key]) =>
    longTextKeys.has(key),
  );
  const orderedEditDetailEntries = [...editDetailEntries].sort(([leftKey], [rightKey]) => {
    const order = [
      "physicalDescription",
      "background",
      "personality",
      "behaviorSummary",
    ];
    return order.indexOf(leftKey) - order.indexOf(rightKey);
  });
  const compactEntries = allStatEntries.filter(([key]) => !longTextKeys.has(key));
  const fullDetailEntries = compactEntries.filter(([key]) => key !== "stats");
  const equipmentKeys = new Set([
    "equipment",
    "inventory",
    "gear",
    "weapon",
    "mainHand",
    "offHand",
    "longarm",
    "rangedWeapon",
    "shieldEquipped",
    "weapons",
    "armor",
    "ammo",
    "resources",
    "equippedItems",
    "attackProfiles",
  ]);
  const spellKeys = new Set([
    "spellcastingAbility",
    "arcanePool",
    "arcane",
    "blessedMiracleOne",
    "blessedMiracleTwo",
    "hucksterHexOne",
    "hucksterHexTwo",
    "shamanFavorOne",
    "shamanFavorTwo",
    "madScienceInventionOne",
    "madScienceInventionTwo",
    "spells",
    "cantrips",
    "knownSpells",
    "preparedSpells",
    "spellbook",
    "spellSlots",
    "pactMagic",
  ]);
  const skillsKeys = new Set([
    "skills",
    "edges",
    "hinderances",
    "hindrances",
    "racialTraits",
    "classFeatures",
    "proficiencies",
  ]);
  const effectKeys = new Set([
    "statusEffects",
    "temporaryBuffs",
    "temporaryDebuffs",
  ]);
  const deadlandsSkillKeys = new Set([
    "edgeOne",
    "edgeTwo",
    "primarySkill",
    "secondarySkill",
  ]);
  const normalizedCampaignRuleset = campaignRuleset.trim().toLowerCase();
  const isDeadlandsCharacter = normalizedCampaignRuleset === "deadlands classic";
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
    .map((item) => item.entry);
  const expandedAttributeEntries = rankedAttributeEntries.slice(0, 6);
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
    ? fullDetailEntries
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
  const compactAncestry = getCompactAncestry(character.sheetJson ?? null);
  const compactRole = getCompactRole(character.sheetJson ?? null);
  const compactLevel =
    typeof character.sheetJson?.level === "number"
      ? `Lvl ${character.sheetJson.level}`
      : typeof character.sheetJson?.level === "string" &&
          character.sheetJson.level.trim()
        ? `Lvl ${character.sheetJson.level.trim()}`
        : "";
  const compactResource = getCompactResource(character.sheetJson ?? null, {
    preferWind: isDeadlandsCharacter,
  });
  const compactResourceLabel = isDeadlandsCharacter ? "Wind" : "HP";
  const deadlandsArchetypeLabel =
    typeof character.sheetJson?.archetype === "string" &&
    character.sheetJson.archetype.trim()
      ? character.sheetJson.archetype.trim()
      : compactRole || "Archetype";
  const deadlandsWoundShorthand = getDeadlandsWoundShorthand(
    character.sheetJson ?? null,
  );
  const deadlandsFateChipShorthand = getDeadlandsFateChipShorthand(
    character.sheetJson ?? null,
  );
  const deadlandsArcanePoints = getDeadlandsCompactNumber(character.sheetJson?.arcanePool, "0");
  const deadlandsGrit = getDeadlandsCompactNumber(
    character.sheetJson?.grit ?? character.sheetJson?.guts,
    "0",
  );
  const deadlandsMainHand = getDeadlandsCompactText(character.sheetJson?.mainHand, "None");
  const deadlandsLongArm = getDeadlandsCompactText(character.sheetJson?.longarm, "None");
  const deadlandsLineTwo = `${deadlandsArchetypeLabel} | Wounds: ${deadlandsWoundShorthand} | Wind: ${compactResource}`;
  const deadlandsLineThree = `Fate Chips: ${deadlandsFateChipShorthand} | Arcane Points: ${deadlandsArcanePoints} | Grit: ${deadlandsGrit}`;
  const deadlandsLineFour = `Main: ${deadlandsMainHand} | Long: ${deadlandsLongArm}`;
  const headerClassParts = [
    typeof character.sheetJson?.class === "string" && character.sheetJson.class.trim()
      ? character.sheetJson.class.trim()
      : "",
    typeof character.sheetJson?.subclass === "string" &&
    character.sheetJson.subclass.trim().length > 0 &&
    !/^none yet$/i.test(character.sheetJson.subclass.trim())
      ? character.sheetJson.subclass.trim()
      : "",
    typeof character.sheetJson?.level === "number"
      ? `Lvl ${character.sheetJson.level}`
      : typeof character.sheetJson?.level === "string" &&
          character.sheetJson.level.trim()
        ? `Lvl ${character.sheetJson.level.trim()}`
        : "",
  ].filter(Boolean);
  const armorClass =
    typeof character.sheetJson?.ac === "number"
      ? String(character.sheetJson.ac)
      : typeof character.sheetJson?.ac === "string" && character.sheetJson.ac.trim()
        ? character.sheetJson.ac
        : "";
  const collectEffectLabels = (value: unknown) =>
    Array.isArray(value)
      ? value
          .filter(
            (entry): entry is string =>
              typeof entry === "string" && entry.trim().length > 0,
          )
          .map((entry) => entry.trim())
      : typeof value === "string" && value.trim()
        ? [value.trim()]
        : [];
  const uniqueEffects = new Map<
    string,
    {
      label: string;
      kind: "status" | "buff" | "debuff";
    }
  >();
  for (const effect of collectEffectLabels(character.sheetJson?.statusEffects)) {
    const key = effect.toLowerCase();
    if (!uniqueEffects.has(key)) {
      uniqueEffects.set(key, { label: effect, kind: "status" });
    }
  }
  for (const effect of collectEffectLabels(character.sheetJson?.temporaryBuffs)) {
    const key = effect.toLowerCase();
    if (!uniqueEffects.has(key)) {
      uniqueEffects.set(key, { label: effect, kind: "buff" });
    }
  }
  for (const effect of collectEffectLabels(character.sheetJson?.temporaryDebuffs)) {
    const key = effect.toLowerCase();
    uniqueEffects.set(key, { label: effect, kind: "debuff" });
  }
  const visibleEffects = Array.from(uniqueEffects.values());
  const collapsedEffects = visibleEffects.slice(0, 2);
  const expandedEffects = visibleEffects.slice(0, 4);
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
  const cardStyles = getCharacterCardStyles(character, companionColorMap);
  const fullDetailWideKeys = new Set([
    "proficiencies",
    "classFeatures",
    "equipment",
    "spells",
    "cantrips",
    "knownSpells",
    "preparedSpells",
    "spellbook",
    "racialTraits",
    "resources",
    "senses",
    "languages",
    "statusEffects",
    "temporaryBuffs",
    "temporaryDebuffs",
  ]);
  const statsTabEntries = fullDetailEntries.filter(
    ([key]) =>
      !skillsKeys.has(key) &&
      !(isDeadlandsCharacter && deadlandsSkillKeys.has(key)) &&
      !equipmentKeys.has(key) &&
      !spellKeys.has(key) &&
      !effectKeys.has(key) &&
      key !== "class" &&
      key !== "subclass" &&
      key !== "level" &&
      key !== "hp" &&
      key !== "ac",
  );
  const proficiencyEntry =
    statsTabEntries.find(
      ([key]) =>
        key === "proficiencyBonus" || key.toLowerCase().includes("proficiency"),
    ) ?? null;
  const speedEntry =
    statsTabEntries.find(
      ([key]) => key === "speed" || key.toLowerCase().includes("speed"),
    ) ?? null;
  const woundsEntry =
    statsTabEntries.find(([key]) => key === "wounds") ?? null;
  const woundsByLocationEntry =
    statsTabEntries.find(([key]) => key === "woundsByLocation") ?? null;
  const woundShorthandEntry =
    statsTabEntries.find(([key]) => key === "woundShorthand") ?? null;
  const orderedStatsTabEntries = [...statsTabEntries].sort(([leftKey], [rightKey]) => {
    const leftIsProficiency =
      leftKey === "proficiencyBonus" || leftKey.toLowerCase().includes("proficiency");
    const rightIsProficiency =
      rightKey === "proficiencyBonus" || rightKey.toLowerCase().includes("proficiency");
    const leftIsSpeed = leftKey === "speed" || leftKey.toLowerCase().includes("speed");
    const rightIsSpeed = rightKey === "speed" || rightKey.toLowerCase().includes("speed");

    if (leftKey === rightKey) {
      return 0;
    }

    if (leftIsProficiency && rightIsSpeed) {
      return -1;
    }

    if (leftIsSpeed && rightIsProficiency) {
      return 1;
    }

    return 0;
  }).filter(
    ([key]) =>
      key !== proficiencyEntry?.[0] &&
      key !== speedEntry?.[0] &&
      key !== "woundLevels" &&
      key !== "woundsByLocation" &&
      key !== "woundShorthand" &&
      key !== "fateChips" &&
      key !== "fateChipShorthand" &&
      key !== woundsEntry?.[0],
  );
  const visibleStatsTabEntries = isDeadlandsCharacter
    ? orderedStatsTabEntries.filter(
        ([key]) =>
          key !== "wind" &&
          key !== "wounds" &&
          key !== "woundsByLocation" &&
          key !== "woundShorthand" &&
          key !== "grit",
      )
    : orderedStatsTabEntries;
  const equipmentEntries = fullDetailEntries.filter(([key]) => equipmentKeys.has(key));
  const equipmentEntryMap = new Map(equipmentEntries);
  const skillsEntries = fullDetailEntries.filter(([key]) => {
    if (!(skillsKeys.has(key) || (isDeadlandsCharacter && deadlandsSkillKeys.has(key)))) {
      return false;
    }

    if (isDeadlandsCharacter && (key === "edges" || key === "skills")) {
      return false;
    }

    return true;
  });
  const spellEntries = fullDetailEntries.filter(([key]) => spellKeys.has(key));
  const deadlandsArchetype =
    typeof character.sheetJson?.archetype === "string"
      ? character.sheetJson.archetype.trim()
      : "";
  const isVisibleDeadlandsHexField = (fieldKey: string) => {
    if (!isDeadlandsCharacter) {
      return true;
    }

    const byArchetype: Record<string, string[]> = {
      Blessed: ["blessedMiracleOne", "blessedMiracleTwo"],
      Huckster: ["hucksterHexOne", "hucksterHexTwo"],
      Shaman: ["shamanFavorOne", "shamanFavorTwo"],
      "Mad Scientist": ["madScienceInventionOne", "madScienceInventionTwo"],
    };

    if (["arcanePool", "arcane"].includes(fieldKey)) {
      return ["Blessed", "Huckster", "Shaman", "Mad Scientist"].includes(deadlandsArchetype);
    }

    const allowedArchetypeFields = byArchetype[deadlandsArchetype] ?? [];
    if (
      [
        "blessedMiracleOne",
        "blessedMiracleTwo",
        "hucksterHexOne",
        "hucksterHexTwo",
        "shamanFavorOne",
        "shamanFavorTwo",
        "madScienceInventionOne",
        "madScienceInventionTwo",
      ].includes(fieldKey)
    ) {
      return allowedArchetypeFields.includes(fieldKey);
    }

    return true;
  };

  useEffect(() => {
    setEditName(character.name);
    setEditSheetJson(cloneEditableSheet(character.sheetJson));
    setIsEditingSheet(false);
    setIsSavingSheet(false);
    setEditError("");
  }, [character.id, character.name, character.sheetJson]);

  useEffect(() => {
    if (!fullDetail) {
      setIsDetailMenuOpen(false);
      setIsEditingSheet(false);
      setEditError("");
    }
  }, [fullDetail]);

  function updateEditPath(path: string[], nextValue: EditableSheetValue) {
    setEditSheetJson((currentSheetJson) =>
      updateEditableSheetAtPath(currentSheetJson, path, nextValue),
    );
  }

  async function handleSaveSheet() {
    if (isSavingSheet) {
      return;
    }

    const trimmedName = editName.trim();

    if (!trimmedName) {
      setEditError("Character name is required.");
      return;
    }

    setEditError("");
    setIsSavingSheet(true);

    try {
      const normalizedSheetJson =
        isDeadlandsCharacter ? normalizeDeadlandsSheetWounds(editSheetJson) : editSheetJson;
      const response = await fetch(`/api/characters/${character.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: trimmedName,
          sheetJson: normalizedSheetJson,
        }),
      });
      const data = await response.json();

      if (!response.ok || !data.character) {
        throw new Error(data.error ?? "Unable to save character sheet.");
      }

      onCharacterUpdated(data.character);
      setIsEditingSheet(false);
      setIsDetailMenuOpen(false);
    } catch (saveError) {
      setEditError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to save character sheet.",
      );
    } finally {
      setIsSavingSheet(false);
    }
  }

  function renderEditableNode(
    key: string,
    value: EditableSheetValue,
    path: string[],
    depth = 0,
  ): ReactNode {
    const label = formatLabel(key).trim() || key;
    const isLongText = longTextKeys.has(key);

    if (Array.isArray(value)) {
      return (
        <div key={path.join(".")} className="space-y-1.5">
          <label className={`block text-[10px] uppercase tracking-[0.08em] ${cardStyles.mutedClass}`}>
            {label}
          </label>
          <textarea
            value={value.map((entry) => String(entry)).join(", ")}
            onChange={(event) =>
              updateEditPath(
                path,
                event.target.value
                  .split(/[\n,]/)
                  .map((entry) => entry.trim())
                  .filter(Boolean),
              )
            }
            className="min-h-[68px] w-full rounded-md border border-zinc-700 bg-zinc-950/70 px-2.5 py-2 text-xs text-zinc-100 outline-none transition focus:border-zinc-500"
          />
        </div>
      );
    }

    if (value && typeof value === "object") {
      return (
        <div
          key={path.join(".")}
          className={`space-y-2 rounded-md bg-zinc-950/20 px-2.5 py-2 ${
            depth === 0 ? "sm:col-span-2" : ""
          }`}
        >
          <div className={`text-[10px] uppercase tracking-[0.08em] ${cardStyles.mutedClass}`}>
            {label}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {Object.entries(value).map(([nestedKey, nestedValue]) =>
              renderEditableNode(
                nestedKey,
                nestedValue as EditableSheetValue,
                [...path, nestedKey],
                depth + 1,
              ),
            )}
          </div>
        </div>
      );
    }

    if (typeof value === "number") {
      return (
        <div key={path.join(".")} className="space-y-1.5">
          <label className={`block text-[10px] uppercase tracking-[0.08em] ${cardStyles.mutedClass}`}>
            {label}
          </label>
          <input
            type="number"
            value={String(value)}
            onChange={(event) => {
              const nextValue = event.target.value.trim();
              updateEditPath(path, nextValue === "" ? 0 : Number(nextValue));
            }}
            className="w-full rounded-md border border-zinc-700 bg-zinc-950/70 px-2.5 py-2 text-xs text-zinc-100 outline-none transition focus:border-zinc-500"
          />
        </div>
      );
    }

    return (
      <div key={path.join(".")} className="space-y-1.5">
        <label className={`block text-[10px] uppercase tracking-[0.08em] ${cardStyles.mutedClass}`}>
          {label}
        </label>
        {isLongText ? (
          <textarea
            value={value == null ? "" : String(value)}
            onChange={(event) => updateEditPath(path, event.target.value)}
            className="min-h-[88px] w-full rounded-md border border-zinc-700 bg-zinc-950/70 px-2.5 py-2 text-xs text-zinc-100 outline-none transition focus:border-zinc-500"
          />
        ) : (
          <input
            type="text"
            value={value == null ? "" : String(value)}
            onChange={(event) => updateEditPath(path, event.target.value)}
            className="w-full rounded-md border border-zinc-700 bg-zinc-950/70 px-2.5 py-2 text-xs text-zinc-100 outline-none transition focus:border-zinc-500"
          />
        )}
      </div>
    );
  }

  if (fullDetail) {
    const renderDetailTiles = (entries: Array<[string, unknown]>, emptyLabel: string) =>
      entries.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {entries.map(([key, value]) => {
            const formattedValue =
              key === "woundLevels" ? formatWoundLevelsValue(value) : formatSheetValue(value);
            const shouldSpanWide =
              fullDetailWideKeys.has(key) || formattedValue.length > 42;

            return (
              <div
                key={key}
                className={`min-w-0 rounded-md bg-zinc-950/20 px-2.5 py-2 ${
                  shouldSpanWide ? "sm:col-span-2" : ""
                }`}
              >
                <div
                  className={`text-[10px] uppercase tracking-[0.08em] ${cardStyles.mutedClass}`}
                >
                  {formatLabel(key)}
                </div>
                <div
                  className={`mt-1 break-words whitespace-pre-wrap leading-5 ${cardStyles.valueClass}`}
                >
                  {formattedValue}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className={cardStyles.mutedClass}>{emptyLabel}</div>
      );

    const renderSpellTab = () => {
      const spellTiles: Array<{ label: string; value: string; wide?: boolean }> = [];
      const filteredSpellEntries = spellEntries.filter(([key]) =>
        isVisibleDeadlandsHexField(key),
      );
      const filteredSpellEntryMap = new Map(filteredSpellEntries);
      const spellcastingAbility = filteredSpellEntryMap.get("spellcastingAbility");
      const spellSlots = filteredSpellEntryMap.get("spellSlots");
      const structuredSpells = filteredSpellEntryMap.get("spells");
      let spellSlotEntries: Array<[string, unknown]> = [];
      const knownSpellList: string[] = [];

      const appendKnownSpells = (value: unknown) => {
        if (Array.isArray(value)) {
          for (const spell of value) {
            if (typeof spell === "string" && spell.trim()) {
              knownSpellList.push(spell.trim());
            }
          }
          return;
        }

        if (typeof value === "string" && value.trim()) {
          knownSpellList.push(value.trim());
        }
      };

      const addSpellTile = (label: string, value: unknown, wide = true) => {
        const formattedValue = formatSheetValue(value);

        if (!formattedValue || formattedValue === "undefined" || formattedValue === "null") {
          return;
        }

        spellTiles.push({
          label,
          value: formattedValue,
          wide,
        });
      };

      if (spellcastingAbility !== undefined) {
        addSpellTile("Spellcasting Ability", spellcastingAbility, false);
      }

      appendKnownSpells(filteredSpellEntryMap.get("knownSpells"));
      appendKnownSpells(filteredSpellEntryMap.get("preparedSpells"));
      appendKnownSpells(filteredSpellEntryMap.get("spellbook"));

      if (isDeadlandsCharacter) {
        addSpellTile("Arcane Pool", filteredSpellEntryMap.get("arcanePool"), false);

        if (deadlandsArchetype === "Blessed") {
          addSpellTile("Miracle 1", filteredSpellEntryMap.get("blessedMiracleOne"), false);
          addSpellTile("Miracle 2", filteredSpellEntryMap.get("blessedMiracleTwo"), false);
        } else if (deadlandsArchetype === "Huckster") {
          addSpellTile("Hex 1", filteredSpellEntryMap.get("hucksterHexOne"), false);
          addSpellTile("Hex 2", filteredSpellEntryMap.get("hucksterHexTwo"), false);
        } else if (deadlandsArchetype === "Shaman") {
          addSpellTile("Favor 1", filteredSpellEntryMap.get("shamanFavorOne"), false);
          addSpellTile("Favor 2", filteredSpellEntryMap.get("shamanFavorTwo"), false);
        } else if (deadlandsArchetype === "Mad Scientist") {
          addSpellTile(
            "Invention 1",
            filteredSpellEntryMap.get("madScienceInventionOne"),
            false,
          );
          addSpellTile(
            "Invention 2",
            filteredSpellEntryMap.get("madScienceInventionTwo"),
            false,
          );
        }

        const arcaneEntry = filteredSpellEntryMap.get("arcane");
        if (arcaneEntry && typeof arcaneEntry === "object" && !Array.isArray(arcaneEntry)) {
          const typedArcane = arcaneEntry as Record<string, unknown>;
          addSpellTile("Arcane Background", typedArcane.background, false);
          addSpellTile("Casting Skill", typedArcane.castingSkill, false);
          addSpellTile("Powers", typedArcane.powers);
        }

        return spellTiles.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {spellTiles.map((tile) => (
              <div
                key={`${tile.label}-${tile.value}`}
                className={`min-w-0 rounded-md bg-zinc-950/20 px-2.5 py-2 ${
                  tile.wide ? "sm:col-span-2" : ""
                }`}
              >
                <div
                  className={`text-[10px] uppercase tracking-[0.08em] ${cardStyles.mutedClass}`}
                >
                  {tile.label}
                </div>
                <div
                  className={`mt-1 break-words whitespace-pre-wrap leading-5 ${cardStyles.valueClass}`}
                >
                  {tile.value}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className={cardStyles.mutedClass}>No saved hexes yet.</div>
        );
      }

      if (
        spellSlots &&
        typeof spellSlots === "object" &&
        !Array.isArray(spellSlots)
      ) {
        spellSlotEntries = Object.entries(spellSlots as Record<string, unknown>).filter(
          ([, value]) =>
            value !== undefined &&
            value !== null &&
            String(value).trim().length > 0,
        );
      } else if (spellSlots !== undefined) {
        addSpellTile("Spell Slots", spellSlots);
      }

      if (
        structuredSpells &&
        typeof structuredSpells === "object" &&
        !Array.isArray(structuredSpells)
      ) {
        const typedSpells = structuredSpells as Record<string, unknown>;
        const flattenedByLevel: string[] = [];

        if (Array.isArray(typedSpells.cantrips) && typedSpells.cantrips.length > 0) {
          spellTiles.push({
            label: "Cantrips",
            value: typedSpells.cantrips.join(", "),
            wide: true,
          });
        }

        if (
          typedSpells.byLevel &&
          typeof typedSpells.byLevel === "object" &&
          !Array.isArray(typedSpells.byLevel)
        ) {
          for (const [levelKey, levelValue] of Object.entries(
            typedSpells.byLevel as Record<string, unknown>,
          )) {
            if (Array.isArray(levelValue) && levelValue.length > 0) {
              flattenedByLevel.push(
                ...levelValue.filter(
                  (spell): spell is string =>
                    typeof spell === "string" && spell.trim().length > 0,
                ),
              );
              const levelNumber = levelKey.replace(/^level/i, "");
              spellTiles.push({
                label: `${levelNumber}${getOrdinalSuffix(levelNumber)}-Level Spells`,
                value: levelValue.join(", "),
                wide: true,
              });
            }
          }
        }

        appendKnownSpells(typedSpells.knownSpells);
        appendKnownSpells(typedSpells.spellbook);
        appendKnownSpells(typedSpells.preparedSpells);
        appendKnownSpells(flattenedByLevel);
        addSpellTile("Prepared Spells", typedSpells.preparedSpells);
        addSpellTile("Spellbook", typedSpells.spellbook);
        addSpellTile("Signature Spell", typedSpells.signatureSpell, false);
      }

      const uniqueKnownSpells = [...new Set(knownSpellList)];
      if (uniqueKnownSpells.length > 0) {
        addSpellTile("Known Spells", uniqueKnownSpells);
      }

      for (const [key, value] of filteredSpellEntries) {
        if (
          key === "spellcastingAbility" ||
          key === "spellSlots" ||
          key === "spells" ||
          key === "knownSpells"
        ) {
          continue;
        }

        addSpellTile(formatLabel(key), value);
      }

      return spellTiles.length > 0 || spellSlotEntries.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {spellSlotEntries.length > 0 ? (
            <div className="min-w-0 rounded-md bg-zinc-950/20 px-2.5 py-2 sm:col-span-2">
              <div
                className={`text-[10px] uppercase tracking-[0.08em] ${cardStyles.mutedClass}`}
              >
                Spell Slots
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 leading-5">
                {spellSlotEntries.map(([key, value], index) => (
                  <div
                    key={`slot-${key}`}
                    className={`flex items-center text-xs ${cardStyles.valueClass}`}
                  >
                    <span>{`${formatSpellSlotLabel(key)}:`}</span>
                    <span className="px-1" />
                    <span className="rounded-sm bg-white/8 px-1.5 py-0.5 font-semibold text-white">
                      {String(value)}
                    </span>
                    {index < spellSlotEntries.length - 1 ? (
                      <span className={`px-2 ${cardStyles.dividerClass}`}>|</span>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {spellTiles.map((tile) => (
            <div
              key={`${tile.label}-${tile.value}`}
              className={`min-w-0 rounded-md bg-zinc-950/20 px-2.5 py-2 ${
                tile.wide ? "sm:col-span-2" : ""
              }`}
            >
              <div
                className={`text-[10px] uppercase tracking-[0.08em] ${cardStyles.mutedClass}`}
              >
                {tile.label}
              </div>
              <div
                className={`mt-1 break-words whitespace-pre-wrap leading-5 ${cardStyles.valueClass}`}
              >
                {tile.value}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className={cardStyles.mutedClass}>No saved spells yet.</div>
      );
    };

    const renderEquipmentTab = () => {
      const equipmentTiles: Array<{ label: string; value: string; wide?: boolean }> = [];
      const renderedEquipmentKeys = new Set<string>();

      const addEquipmentTile = (label: string, value: unknown, wide = true) => {
        const formattedValue = formatSheetValue(value);

        if (!formattedValue || formattedValue === "undefined" || formattedValue === "null") {
          return;
        }

        equipmentTiles.push({
          label,
          value: formattedValue,
          wide,
        });
      };

      const addEquipmentKeyTile = (
        key: string,
        label: string,
        options?: { wide?: boolean; transform?: (value: unknown) => unknown },
      ) => {
        const rawValue = equipmentEntryMap.get(key);
        if (rawValue === undefined) {
          return;
        }

        const transformedValue = options?.transform ? options.transform(rawValue) : rawValue;
        addEquipmentTile(label, transformedValue, options?.wide ?? true);
        renderedEquipmentKeys.add(key);
      };

      const normalizedRuleset =
        typeof character.ruleset === "string" ? character.ruleset.trim().toLowerCase() : "";
      const isDndRuleset =
        normalizedRuleset.includes("d&d") ||
        normalizedRuleset.includes("dnd") ||
        normalizedRuleset.includes("5e");

      const orderedEquipmentFields = isDndRuleset
        ? [
            { key: "mainHand", label: "Main Hand", wide: false },
            { key: "offHand", label: "Off Hand", wide: false },
            { key: "rangedWeapon", label: "Ranged Weapon", wide: false },
            {
              key: "shieldEquipped",
              label: "Shield",
              wide: false,
              transform: (value: unknown) =>
                value === true || value === "Yes" ? "Equipped" : "Not Equipped",
            },
            { key: "armor", label: "Armor", wide: false },
            { key: "equippedItems", label: "Equipped Items" },
            { key: "gear", label: "Gear" },
            { key: "equipment", label: "Equipment" },
            { key: "inventory", label: "Inventory" },
            { key: "ammo", label: "Ammo" },
            { key: "resources", label: "Resources" },
          ]
        : normalizedRuleset.includes("deadlands classic")
          ? [
              { key: "mainHand", label: "Main Hand", wide: false },
              { key: "offHand", label: "Off Hand", wide: false },
              { key: "longarm", label: "Longarm", wide: false },
              { key: "equippedItems", label: "Equipped Items" },
              { key: "gear", label: "Gear" },
              { key: "equipment", label: "Equipment" },
              { key: "inventory", label: "Inventory" },
              { key: "ammo", label: "Ammo", wide: false },
              { key: "resources", label: "Resources" },
            ]
        : normalizedRuleset.includes("call of cthulhu")
          ? [
              { key: "weapons", label: "Weapons" },
              { key: "weapon", label: "Primary Weapon", wide: false },
              { key: "ammo", label: "Ammo", wide: false },
              { key: "armor", label: "Protection", wide: false },
              { key: "equipment", label: "Equipment" },
              { key: "inventory", label: "Inventory" },
              { key: "resources", label: "Resources" },
            ]
          : normalizedRuleset.includes("vampire")
            ? [
                { key: "equipment", label: "Equipment" },
                { key: "inventory", label: "Inventory" },
                { key: "resources", label: "Resources" },
                { key: "weapons", label: "Weapons" },
                { key: "weapon", label: "Primary Weapon", wide: false },
              ]
            : normalizedRuleset.includes("legend of 5 rings") ||
                normalizedRuleset.includes("l5r")
              ? [
                  { key: "weapons", label: "Weapons" },
                  { key: "weapon", label: "Primary Weapon", wide: false },
                  { key: "armor", label: "Armor", wide: false },
                  { key: "equipment", label: "Equipment" },
                  { key: "inventory", label: "Inventory" },
                  { key: "resources", label: "Resources" },
                ]
              : [
                  { key: "weapons", label: "Weapons" },
                  { key: "weapon", label: "Primary Weapon", wide: false },
                  { key: "armor", label: "Armor", wide: false },
                  { key: "equipment", label: "Equipment" },
                  { key: "inventory", label: "Inventory" },
                  { key: "gear", label: "Gear" },
                  { key: "ammo", label: "Ammo", wide: false },
                  { key: "resources", label: "Resources" },
                ];

      for (const field of orderedEquipmentFields) {
        addEquipmentKeyTile(field.key, field.label, {
          wide: field.wide,
          transform: field.transform,
        });
      }

      const attackProfiles = equipmentEntryMap.get("attackProfiles");
      if (
        attackProfiles &&
        typeof attackProfiles === "object" &&
        !Array.isArray(attackProfiles)
      ) {
        const profileLabels: Record<string, string> = {
          mainHand: "Main Hand",
          offHand: "Off Hand",
          ranged: "Ranged",
        };
        const profileLines: string[] = [];

        for (const [profileKey, profileValue] of Object.entries(
          attackProfiles as Record<string, unknown>,
        )) {
          if (!profileValue || typeof profileValue !== "object" || Array.isArray(profileValue)) {
            continue;
          }

          const typedProfile = profileValue as Record<string, unknown>;
          const weapon = typeof typedProfile.weapon === "string" ? typedProfile.weapon : "Attack";
          const attackBonus =
            typeof typedProfile.attackBonus === "number"
              ? `${typedProfile.attackBonus >= 0 ? "+" : ""}${typedProfile.attackBonus}`
              : null;
          const damage =
            typeof typedProfile.damage === "string" && typedProfile.damage.trim()
              ? typedProfile.damage.trim()
              : null;
          const profileLabel = profileLabels[profileKey] ?? formatLabel(profileKey).trim();
          const segments = [
            attackBonus ? `${weapon} ${attackBonus} to hit` : weapon,
            damage ? `${damage} damage` : "",
          ].filter(Boolean);

          if (segments.length > 0) {
            profileLines.push(`${profileLabel}: ${segments.join(", ")}`);
          }
        }

        if (profileLines.length > 0) {
          equipmentTiles.push({
            label: "Attacks",
            value: profileLines.join("\n"),
            wide: true,
          });
          renderedEquipmentKeys.add("attackProfiles");
        }
      }

      for (const [key, value] of equipmentEntries) {
        if (renderedEquipmentKeys.has(key)) {
          continue;
        }

        addEquipmentTile(formatLabel(key).trim(), value);
      }

      return equipmentTiles.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {equipmentTiles.map((tile) => (
            <div
              key={`${tile.label}-${tile.value}`}
              className={`min-w-0 rounded-md bg-zinc-950/20 px-2.5 py-2 ${
                tile.wide ? "sm:col-span-2" : ""
              }`}
            >
              <div
                className={`text-[10px] uppercase tracking-[0.08em] ${cardStyles.mutedClass}`}
              >
                {tile.label}
              </div>
              <div
                className={`mt-1 break-words whitespace-pre-wrap leading-5 ${cardStyles.valueClass}`}
              >
                {tile.value}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className={cardStyles.mutedClass}>No saved equipment yet.</div>
      );
    };

    const renderEditableEntries = (
      entries: Array<[string, unknown]>,
      emptyLabel: string,
    ) =>
      entries.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {entries.map(([key, value]) =>
            renderEditableNode(key, value as EditableSheetValue, [key]),
          )}
        </div>
      ) : (
        <div className={cardStyles.mutedClass}>{emptyLabel}</div>
      );

    return (
      <div
        className={`relative rounded-xl border p-4 transition-colors ${cardStyles.hoverContainerClass} ${cardStyles.containerClass} ${
          isActiveTurn ? "ring-2 ring-amber-300/60" : ""
        }`}
      >
        <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className={`flex min-w-0 items-center gap-1.5 text-base font-medium ${cardStyles.nameClass}`}>
                <span className="truncate">{character.name}</span>
                {character.isMainCharacter ? (
                  <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-amber-300/50 bg-amber-300/14 text-[10px] text-amber-100">
                    ★
                  </span>
                ) : null}
              </div>
              <div className={`mt-1 text-xs ${cardStyles.summaryClass}`}>
                {isDeadlandsCharacter ? (
                  <span className={`block truncate ${cardStyles.valueClass}`}>
                    {deadlandsLineTwo}
                  </span>
                ) : (
                  <>
                    {headerClassParts.length > 0 ? (
                      <>
                        <span className={cardStyles.valueClass}>
                          {headerClassParts.join(" | ")}
                        </span>
                        <span className={`px-2 ${cardStyles.dividerClass}`}>|</span>
                      </>
                    ) : null}
                    <span className={cardStyles.mutedClass}>{compactResourceLabel}</span>
                    <span className="px-1" />
                    <span className={cardStyles.valueClass}>{compactResource}</span>
                    {armorClass ? (
                      <>
                        <span className={`px-2 ${cardStyles.dividerClass}`}>|</span>
                        <span className={cardStyles.mutedClass}>AC</span>
                        <span className="px-1" />
                        <span className={cardStyles.valueClass}>{armorClass}</span>
                      </>
                    ) : null}
                  </>
                )}
              </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onToggleDetail}
              className={`rounded-md border px-1.5 py-1 text-[10px] transition ${cardStyles.toggleClass}`}
              aria-label="Exit full detail view"
              title="Exit full detail view"
            >
              -
            </button>
          </div>
        </div>

        <div className="mt-3 overflow-hidden rounded-lg border border-zinc-800/70 bg-zinc-950/60">
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
            className="h-56 w-full object-contain"
          />
        </div>

        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {(["stats", "skills", "equipment", "spells", "notes"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => {
                  setDetailTab(tab);
                  setIsDetailMenuOpen(false);
                }}
                className={`rounded-md border px-2 py-1 text-[10px] font-medium uppercase transition ${
                  detailTab === tab
                    ? cardStyles.toggleClass
                    : "border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white"
                }`}
              >
                {tab === "spells" && isDeadlandsCharacter ? "hexes" : tab}
              </button>
            ))}
          </div>

          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setIsDetailMenuOpen((current) => !current)}
              className="rounded-md border border-zinc-700 px-2 py-1 text-[10px] text-zinc-200 transition hover:border-zinc-500 hover:text-white"
              aria-label="Character actions"
              title="Character actions"
            >
              ⚙
            </button>

            {isDetailMenuOpen ? (
              <div className="absolute right-0 top-[calc(100%+0.5rem)] z-20 min-w-[10rem] rounded-lg border border-zinc-800 bg-zinc-950/95 p-1.5 shadow-2xl shadow-black/50 backdrop-blur">
                {character.originLibraryCharacterId ? (
                  <button
                    type="button"
                    onClick={() => {
                      setIsDetailMenuOpen(false);
                      onExport("update-master");
                    }}
                    disabled={isExporting}
                    className="flex w-full items-center rounded-md px-2.5 py-2 text-left text-[11px] text-cyan-200 transition hover:bg-cyan-300/10 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
                    title="Update the linked master character using permanent campaign changes"
                  >
                    {isExporting ? "Exporting..." : "Update Master"}
                  </button>
                ) : null}

                <button
                  type="button"
                  onClick={() => {
                    setIsDetailMenuOpen(false);
                    onExport("create-version");
                  }}
                  disabled={isExporting}
                  className="flex w-full items-center rounded-md px-2.5 py-2 text-left text-[11px] text-emerald-200 transition hover:bg-emerald-300/10 hover:text-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                  title="Create a new library version using permanent campaign changes"
                >
                  {isExporting ? "Exporting..." : "Create New Version"}
                </button>

                {isEditingSheet ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setEditName(character.name);
                        setEditSheetJson(cloneEditableSheet(character.sheetJson));
                        setEditError("");
                        setIsEditingSheet(false);
                        setIsDetailMenuOpen(false);
                      }}
                      disabled={isSavingSheet}
                      className="flex w-full items-center rounded-md px-2.5 py-2 text-left text-[11px] text-zinc-200 transition hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Cancel Edit
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveSheet}
                      disabled={isSavingSheet}
                      className="flex w-full items-center rounded-md px-2.5 py-2 text-left text-[11px] text-amber-200 transition hover:bg-amber-300/10 hover:text-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isSavingSheet ? "Saving..." : "Save Changes"}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setEditError("");
                      setIsEditingSheet(true);
                      setIsDetailMenuOpen(false);
                    }}
                    className="flex w-full items-center rounded-md px-2.5 py-2 text-left text-[11px] text-zinc-200 transition hover:bg-white/5 hover:text-white"
                  >
                    Edit Character
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setIsDetailMenuOpen(false);
                    onDelete();
                  }}
                  disabled={isDeleting}
                  className="flex w-full items-center rounded-md px-2.5 py-2 text-left text-[11px] text-red-300 transition hover:bg-red-400/10 hover:text-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label={`Remove ${character.name}`}
                  title={`Remove ${character.name}`}
                >
                  {isDeleting ? "Removing..." : "Remove"}
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {isEditingSheet ? (
          <div className="mt-3 space-y-1.5">
            <label className={`block text-[10px] uppercase tracking-[0.08em] ${cardStyles.mutedClass}`}>
              Character Name
            </label>
            <input
              type="text"
              value={editName}
              onChange={(event) => setEditName(event.target.value)}
              className="w-full rounded-md border border-zinc-700 bg-zinc-950/70 px-2.5 py-2 text-sm text-zinc-100 outline-none transition focus:border-zinc-500"
            />
          </div>
        ) : null}

        {editError ? (
          <div className="mt-3 rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2 text-[11px] text-red-200">
            {editError}
          </div>
        ) : null}

        <div className="mt-3 space-y-3 text-xs">
        {detailTab === "stats" ? (
            isEditingSheet ? (
              <>
                {"stats" in editSheetJson &&
                editSheetJson.stats &&
                typeof editSheetJson.stats === "object" &&
                !Array.isArray(editSheetJson.stats) ? (
                  <div className="space-y-2">
                    <div className={`text-[10px] uppercase tracking-[0.08em] ${cardStyles.mutedClass}`}>
                      Attributes
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {Object.entries(editSheetJson.stats).map(([key, value]) =>
                        renderEditableNode(key, value as EditableSheetValue, ["stats", key]),
                      )}
                    </div>
                  </div>
                ) : null}
                {isDeadlandsCharacter ? (
                  <div className="space-y-2">
                    <div className={`text-[10px] uppercase tracking-[0.08em] ${cardStyles.mutedClass}`}>
                      Wounds
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {(
                        [
                          ["head", "Head"],
                          ["guts", "Guts"],
                          ["leftArm", "L Arm"],
                          ["rightArm", "R Arm"],
                          ["leftLeg", "L Leg"],
                          ["rightLeg", "R Leg"],
                        ] as const
                      ).map(([fieldKey, label]) => (
                        <div key={fieldKey} className="space-y-1.5">
                          <label
                            className={`block text-[10px] uppercase tracking-[0.08em] ${cardStyles.mutedClass}`}
                          >
                            {label}
                          </label>
                          <input
                            type="number"
                            min={0}
                            max={4}
                            value={String(
                              readDeadlandsWoundValue(
                                (
                                  editSheetJson.woundsByLocation &&
                                  typeof editSheetJson.woundsByLocation === "object" &&
                                  !Array.isArray(editSheetJson.woundsByLocation)
                                    ? (editSheetJson.woundsByLocation as Record<string, unknown>)
                                    : {}
                                )[fieldKey],
                                0,
                              ),
                            )}
                            onChange={(event) => {
                              const nextValue = event.target.value.trim();
                              updateEditPath(
                                ["woundsByLocation", fieldKey],
                                nextValue === ""
                                  ? 0
                                  : readDeadlandsWoundValue(Number(nextValue), 0),
                              );
                            }}
                            className="w-full rounded-md border border-zinc-700 bg-zinc-950/70 px-2.5 py-2 text-xs text-zinc-100 outline-none transition focus:border-zinc-500"
                          />
                        </div>
                      ))}
                    </div>
                    <div className={`text-[11px] ${cardStyles.mutedClass}`}>
                      Saved as location wounds:{" "}
                      {buildDeadlandsWoundShorthand(
                        getDeadlandsWoundsByLocationFromSheet(editSheetJson),
                      )}
                    </div>
                  </div>
                ) : null}
                {isDeadlandsCharacter ? (
                  <div className="space-y-2">
                    <div className={`text-[10px] uppercase tracking-[0.08em] ${cardStyles.mutedClass}`}>
                      Fate Chips
                    </div>
                    <div className="grid gap-2 sm:grid-cols-4">
                      {(
                        [
                          ["white", "White"],
                          ["red", "Red"],
                          ["blue", "Blue"],
                          ["legend", "Legend"],
                        ] as const
                      ).map(([fieldKey, label]) => (
                        <div key={fieldKey} className="space-y-1.5">
                          <label
                            className={`block text-[10px] uppercase tracking-[0.08em] ${cardStyles.mutedClass}`}
                          >
                            {label}
                          </label>
                          <input
                            type="number"
                            min={0}
                            max={10}
                            value={String(
                              readDeadlandsFateChipValue(
                                (
                                  editSheetJson.fateChips &&
                                  typeof editSheetJson.fateChips === "object" &&
                                  !Array.isArray(editSheetJson.fateChips)
                                    ? (editSheetJson.fateChips as Record<string, unknown>)
                                    : {}
                                )[fieldKey],
                                fieldKey === "white" ? 2 : fieldKey === "red" ? 1 : 0,
                              ),
                            )}
                            onChange={(event) => {
                              const nextValue = event.target.value.trim();
                              updateEditPath(
                                ["fateChips", fieldKey],
                                nextValue === ""
                                  ? 0
                                  : readDeadlandsFateChipValue(Number(nextValue), 0),
                              );
                            }}
                            className="w-full rounded-md border border-zinc-700 bg-zinc-950/70 px-2.5 py-2 text-xs text-zinc-100 outline-none transition focus:border-zinc-500"
                          />
                        </div>
                      ))}
                    </div>
                    <div className={`text-[11px] ${cardStyles.mutedClass}`}>
                      Saved as:{" "}
                      {buildDeadlandsFateChipShorthand(
                        getDeadlandsFateChipsFromSheet(editSheetJson),
                      )}
                    </div>
                  </div>
                ) : null}
                {renderEditableEntries(
                  Object.entries(editSheetJson).filter(
                    ([key]) =>
                      key !== "stats" &&
                      key !== "woundLevels" &&
                      key !== "wounds" &&
                      key !== "woundsByLocation" &&
                      key !== "woundShorthand" &&
                      key !== "fateChips" &&
                      key !== "fateChipShorthand" &&
                      !equipmentKeys.has(key) &&
                      !spellKeys.has(key) &&
                      key !== "source" &&
                      key !== "portraitDataUrl",
                  ),
                  "No saved stats yet.",
                )}
              </>
            ) : (
              <>
                {statBlockEntries.length > 0 ? (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {statBlockEntries.map(([key, value]) => (
                      <div
                        key={key}
                        className="rounded-md bg-zinc-950/20 px-2 py-1.5"
                      >
                        <div className={`text-[10px] uppercase ${cardStyles.mutedClass}`}>
                          {key}
                        </div>
                        <div className={`mt-0.5 text-sm ${cardStyles.valueClass}`}>
                          {formatSheetValue(value)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}

                {visibleEffects.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {visibleEffects.map((effect) => (
                      <span
                        key={`${effect.kind}-${effect.label}`}
                        className={`rounded-full px-2 py-1 text-[10px] font-medium ring-1 ${
                          effect.kind === "debuff"
                            ? "bg-red-500/15 text-red-200 ring-red-400/20"
                            : effect.kind === "buff"
                              ? "bg-emerald-500/15 text-emerald-200 ring-emerald-400/20"
                              : "bg-amber-500/15 text-amber-200 ring-amber-400/20"
                        }`}
                      >
                        {effect.label}
                      </span>
                    ))}
                  </div>
                ) : null}

                {proficiencyEntry || speedEntry ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {proficiencyEntry ? (
                      <div className="min-w-0 rounded-md bg-zinc-950/20 px-2.5 py-2">
                        <div
                          className={`text-[10px] uppercase tracking-[0.08em] ${cardStyles.mutedClass}`}
                        >
                          {formatLabel(proficiencyEntry[0])}
                        </div>
                        <div
                          className={`mt-1 break-words whitespace-pre-wrap leading-5 ${cardStyles.valueClass}`}
                        >
                          {formatSheetValue(proficiencyEntry[1])}
                        </div>
                      </div>
                    ) : (
                      <div />
                    )}

                    {speedEntry ? (
                      <div className="min-w-0 rounded-md bg-zinc-950/20 px-2.5 py-2">
                        <div
                          className={`text-[10px] uppercase tracking-[0.08em] ${cardStyles.mutedClass}`}
                        >
                          {formatLabel(speedEntry[0])}
                        </div>
                        <div
                          className={`mt-1 break-words whitespace-pre-wrap leading-5 ${cardStyles.valueClass}`}
                        >
                          {formatSheetValue(speedEntry[1])}
                        </div>
                      </div>
                    ) : (
                      <div />
                    )}
                  </div>
                ) : null}

                {!isDeadlandsCharacter && (woundsByLocationEntry || woundsEntry || woundShorthandEntry) ? (
                  <div className="rounded-md bg-zinc-950/20 px-2.5 py-2">
                    <div
                      className={`text-[10px] uppercase tracking-[0.08em] ${cardStyles.mutedClass}`}
                    >
                      Wounds
                    </div>
                    {(() => {
                      const woundsByLocation =
                        woundsByLocationEntry &&
                        woundsByLocationEntry[1] &&
                        typeof woundsByLocationEntry[1] === "object" &&
                        !Array.isArray(woundsByLocationEntry[1])
                          ? (woundsByLocationEntry[1] as Record<string, unknown>)
                          : null;
                      const wounds =
                        woundsEntry && woundsEntry[1] && typeof woundsEntry[1] === "object"
                          ? (woundsEntry[1] as Record<string, unknown>)
                          : null;
                      const storedShorthand =
                        woundShorthandEntry && typeof woundShorthandEntry[1] === "string"
                          ? woundShorthandEntry[1].trim()
                          : "";

                      if (woundsByLocation) {
                        const readLocation = (key: string) => {
                          const value = woundsByLocation[key];
                          if (typeof value === "number") return value;
                          if (typeof value === "string") {
                            const parsed = Number(value);
                            return Number.isFinite(parsed) ? parsed : 0;
                          }
                          return 0;
                        };

                        const head = readLocation("head");
                        const guts = readLocation("guts");
                        const leftArm = readLocation("leftArm");
                        const rightArm = readLocation("rightArm");
                        const leftLeg = readLocation("leftLeg");
                        const rightLeg = readLocation("rightLeg");
                        const shorthand =
                          storedShorthand ||
                          `H${head} G${guts} LA${leftArm} RA${rightArm} LL${leftLeg} RL${rightLeg}`;

                        if (isDeadlandsCharacter) {
                          return (
                            <div
                              className={`mt-1 break-words whitespace-pre-wrap leading-5 ${cardStyles.valueClass}`}
                            >
                              {`Wounds: ${shorthand}`}
                            </div>
                          );
                        }

                        return (
                          <div
                            className={`mt-1 break-words whitespace-pre-wrap leading-5 ${cardStyles.valueClass}`}
                          >
                            {`Head: ${head}\nGuts: ${guts}\nL Arm: ${leftArm}\nR Arm: ${rightArm}\nL Leg: ${leftLeg}\nR Leg: ${rightLeg}\nWounds: ${shorthand}`}
                          </div>
                        );
                      }

                      const current =
                        wounds && typeof wounds.current === "number"
                          ? wounds.current
                          : wounds && typeof wounds.current === "string"
                            ? Number(wounds.current)
                            : 0;
                      const max =
                        wounds && typeof wounds.max === "number"
                          ? wounds.max
                          : wounds && typeof wounds.threshold === "number"
                            ? wounds.threshold
                            : wounds && typeof wounds.max === "string"
                              ? Number(wounds.max)
                              : wounds && typeof wounds.threshold === "string"
                                ? Number(wounds.threshold)
                                : 4;
                      const level =
                        wounds && typeof wounds.level === "string" && wounds.level.trim()
                          ? wounds.level.trim()
                          : "Unharmed";
                      const penaltyValue =
                        wounds && typeof wounds.penalty === "number"
                          ? wounds.penalty
                          : wounds && typeof wounds.penalty === "string"
                            ? Number(wounds.penalty)
                            : 0;
                      const penalty =
                        Number.isFinite(penaltyValue) && penaltyValue > 0
                          ? `+${penaltyValue}`
                          : String(Number.isFinite(penaltyValue) ? penaltyValue : 0);

                      return (
                        <div
                          className={`mt-1 break-words whitespace-pre-wrap leading-5 ${cardStyles.valueClass}`}
                        >
                          {`Current Wounds: ${current}/${max}\nCondition: ${level}\nPenalty: ${penalty}`}
                        </div>
                      );
                    })()}
                  </div>
                ) : null}
                {isDeadlandsCharacter ? (
                  <div className="rounded-md bg-zinc-950/20 px-2.5 py-2">
                    <div
                      className={`text-[10px] uppercase tracking-[0.08em] ${cardStyles.mutedClass}`}
                    >
                      Fate Chips
                    </div>
                    <div
                      className={`mt-1 break-words whitespace-pre-wrap leading-5 ${cardStyles.valueClass}`}
                    >
                      {`Fate Chips: ${getDeadlandsFateChipShorthand(character.sheetJson ?? null)}`}
                    </div>
                  </div>
                ) : null}

                {renderDetailTiles(visibleStatsTabEntries, "No saved stats yet.")}
              </>
            )
          ) : detailTab === "skills" ? (
            isEditingSheet
              ? renderEditableEntries(
                  Object.entries(editSheetJson).filter(
                    ([key]) =>
                      (skillsKeys.has(key) ||
                        (isDeadlandsCharacter && deadlandsSkillKeys.has(key))) &&
                      !(isDeadlandsCharacter && (key === "edges" || key === "skills")) &&
                      key !== "source" &&
                      key !== "portraitDataUrl",
                  ),
                  "No saved skills yet.",
                )
              : renderDetailTiles(skillsEntries, "No saved skills yet.")
          ) : detailTab === "equipment" ? (
            isEditingSheet
              ? renderEditableEntries(
                  Object.entries(editSheetJson).filter(
                    ([key]) =>
                      equipmentKeys.has(key) &&
                      key !== "source" &&
                      key !== "portraitDataUrl",
                  ),
                  "No saved equipment yet.",
                )
              : renderEquipmentTab()
          ) : detailTab === "spells" ? (
            isEditingSheet
              ? renderEditableEntries(
                  Object.entries(editSheetJson).filter(
                    ([key]) =>
                      spellKeys.has(key) &&
                      isVisibleDeadlandsHexField(key) &&
                      key !== "source" &&
                      key !== "portraitDataUrl",
                  ),
                  isDeadlandsCharacter ? "No saved hexes yet." : "No saved spells yet.",
                )
              : renderSpellTab()
          ) : (isEditingSheet ? orderedEditDetailEntries.length > 0 : orderedDetailEntries.length > 0) ? (
            isEditingSheet ? (
              renderEditableEntries(orderedEditDetailEntries, "No saved notes yet.")
            ) : (
              <div className="space-y-3">
                {orderedDetailEntries.map(([key, value]) => (
                  <div key={key} className="rounded-md bg-zinc-950/20 px-2.5 py-2">
                    <div
                      className={`text-[10px] uppercase tracking-[0.08em] ${cardStyles.mutedClass}`}
                    >
                      {formatLabel(key)}
                    </div>
                    <p
                      className={`mt-1 break-words whitespace-pre-wrap leading-5 ${cardStyles.valueClass}`}
                    >
                      {formatSheetValue(value)}
                    </p>
                  </div>
                ))}
              </div>
            )
          ) : (
            <div className={cardStyles.mutedClass}>No saved notes yet.</div>
          )}
        </div>

        <div className="mt-4 flex items-center gap-3">
          <div className="flex flex-1 flex-wrap items-center gap-2">
            {detailTab === "notes" ? (
              <>
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
              </>
            ) : null}
          </div>
        </div>

        {typeof initiativeOrder === "number" ? (
          <span className="absolute bottom-3 right-3 rounded-md border border-amber-300/30 bg-amber-300/10 px-1.5 py-1 text-[10px] font-semibold text-amber-100">
            #{initiativeOrder}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={`relative rounded-xl border transition-colors ${cardStyles.hoverContainerClass} ${cardStyles.containerClass} ${
        isActiveTurn ? "ring-2 ring-amber-300/60" : ""
      } ${
        collapsed ? "p-2" : "p-3"
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
              <div
                className={`flex min-w-0 items-center gap-1.5 font-medium ${fullDetail ? "text-base" : "text-sm"} ${cardStyles.nameClass}`}
              >
                <span className="truncate">{character.name}</span>
                {character.isMainCharacter ? (
                  <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border border-amber-300/50 bg-amber-300/14 text-[9px] text-amber-100">
                    ★
                  </span>
                ) : null}
              </div>
            </div>

            <div className="flex items-center gap-1">
              {collapsed ? (
                <button
                  type="button"
                  onClick={onToggle}
                  className={`rounded-md border px-1.5 py-1 text-[10px] transition ${cardStyles.toggleClass}`}
                  aria-label="Expand character card"
                  title="Expand character card"
                >
                  +
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={onToggle}
                    className={`rounded-md border px-1.5 py-1 text-[10px] transition ${cardStyles.toggleClass}`}
                    aria-label="Collapse character card"
                    title="Collapse character card"
                  >
                    -
                  </button>
                  <button
                    type="button"
                    onClick={onToggleDetail}
                    className={`rounded-md border px-1.5 py-1 text-[10px] transition ${cardStyles.toggleClass}`}
                    aria-label="Show full detail view"
                    title="Show full detail view"
                  >
                    +
                  </button>
                </>
              )}
            </div>
          </div>

          {collapsed ? (
              <div className="mt-1 space-y-1">
                <div className={`truncate text-[10px] ${cardStyles.summaryClass}`}>
                  {isDeadlandsCharacter ? (
                    <span className={cardStyles.valueClass}>{deadlandsLineTwo}</span>
                  ) : (
                    <>
                      {compactAncestry ? (
                        <>
                          <span className={cardStyles.mutedClass}>{compactAncestry}</span>
                          <span className={`px-1 ${cardStyles.dividerClass}`}>|</span>
                        </>
                      ) : null}
                      <span className={cardStyles.mutedClass}>{compactRole}</span>
                      {compactLevel ? (
                        <>
                        <span className={`px-1 ${cardStyles.dividerClass}`}>|</span>
                        <span className={cardStyles.valueClass}>{compactLevel}</span>
                      </>
                    ) : null}
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
                    </>
                  )}
                </div>
              {collapsedEffects.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {collapsedEffects.map((effect) => (
                    <span
                      key={`${effect.kind}-${effect.label}`}
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ${
                        effect.kind === "debuff"
                          ? "bg-red-500/15 text-red-200 ring-red-400/20"
                          : effect.kind === "buff"
                            ? "bg-emerald-500/15 text-emerald-200 ring-emerald-400/20"
                            : "bg-amber-500/15 text-amber-200 ring-amber-400/20"
                      }`}
                    >
                      {effect.label}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
              <div className="mt-2 space-y-2 text-[11px]">
                <div className={`rounded-md bg-zinc-950/20 px-2 py-1 ${cardStyles.summaryClass}`}>
                  {isDeadlandsCharacter ? (
                    <span className={`block truncate ${cardStyles.valueClass}`}>
                      {deadlandsLineTwo}
                    </span>
                  ) : (
                    <>
                      {compactAncestry ? (
                        <>
                          <span className={cardStyles.mutedClass}>{compactAncestry}</span>
                          <span className={`px-1 ${cardStyles.dividerClass}`}>|</span>
                        </>
                      ) : null}
                      <span className={cardStyles.mutedClass}>{compactRole}</span>
                      {compactLevel ? (
                        <>
                        <span className={`px-1 ${cardStyles.dividerClass}`}>|</span>
                        <span className={cardStyles.valueClass}>{compactLevel}</span>
                      </>
                    ) : null}
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
                    </>
                  )}
                </div>

              {isDeadlandsCharacter ? (
                <div className="space-y-1">
                  <div className={`rounded-md bg-zinc-950/20 px-2 py-1 text-[10px] ${cardStyles.summaryClass}`}>
                    <span className={`block truncate ${cardStyles.valueClass}`}>
                      {deadlandsLineThree}
                    </span>
                  </div>
                  <div className={`rounded-md bg-zinc-950/20 px-2 py-1 text-[10px] ${cardStyles.summaryClass}`}>
                    <span className={`block truncate ${cardStyles.valueClass}`}>
                      {deadlandsLineFour}
                    </span>
                  </div>
                </div>
              ) : expandedAttributeEntries.length > 0 ? (
                <div className="grid grid-cols-6 gap-1">
                  {expandedAttributeEntries.map(([key, value]) => (
                    <div
                      key={key}
                      className="flex min-w-0 items-center justify-center gap-1 rounded-md bg-zinc-950/20 px-1.5 py-1"
                    >
                      <span className={`shrink-0 uppercase text-[10px] ${cardStyles.mutedClass}`}>
                        {key}
                      </span>
                      <span className={`truncate text-[10px] ${cardStyles.valueClass}`}>
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

              {expandedEffects.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {expandedEffects.map((effect) => (
                    <span
                      key={`${effect.kind}-${effect.label}`}
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ${
                        effect.kind === "debuff"
                          ? "bg-red-500/15 text-red-200 ring-red-400/20"
                          : effect.kind === "buff"
                            ? "bg-emerald-500/15 text-emerald-200 ring-emerald-400/20"
                            : "bg-amber-500/15 text-amber-200 ring-amber-400/20"
                      }`}
                    >
                      {effect.label}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          )}

        </div>
      </div>

      {typeof initiativeOrder === "number" ? (
        <span className="absolute bottom-2 right-2 rounded-md border border-amber-300/30 bg-amber-300/10 px-1.5 py-1 text-[10px] font-semibold text-amber-100">
          #{initiativeOrder}
        </span>
      ) : null}
    </div>
  );
}

function PartyStateTextarea({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
        {label}
      </label>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="min-h-[84px] w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-600"
      />
    </div>
  );
}

function DebugPanel({
  title,
  content,
}: {
  title: string;
  content: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
        {title}
      </div>
      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-zinc-200">
        {content}
      </pre>
    </div>
  );
}

function PartyReputationEditor({
  entries,
  onChange,
}: {
  entries: PartyReputationEntry[];
  onChange: (value: PartyReputationEntry[]) => void;
}) {
  function updateEntry(
    index: number,
    patch: Partial<PartyReputationEntry>,
  ) {
    onChange(
      entries.map((entry, entryIndex) =>
        entryIndex === index
          ? {
              ...entry,
              ...patch,
            }
          : entry,
      ),
    );
  }

  function removeEntry(index: number) {
    onChange(entries.filter((_, entryIndex) => entryIndex !== index));
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <label className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
          Reputation
        </label>
        <button
          type="button"
          onClick={() =>
            onChange([
              ...entries,
              {
                name: "",
                score: 0,
                status: "Neutral",
                notes: [],
              },
            ])
          }
          className="rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-2.5 py-1 text-[11px] font-medium text-cyan-100 transition hover:border-cyan-300/60"
        >
          Add Faction
        </button>
      </div>

      {entries.length > 0 ? (
        <div className="space-y-2">
          {entries.map((entry, index) => (
            <div
              key={`reputation-${index}`}
              className="rounded-lg border border-zinc-800 bg-zinc-900 p-3"
            >
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_76px_140px_auto]">
                <input
                  value={entry.name}
                  onChange={(event) =>
                    updateEntry(index, { name: event.target.value })
                  }
                  placeholder="Faction or NPC"
                  className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-600"
                />
                <input
                  type="number"
                  min={-3}
                  max={3}
                  value={entry.score}
                  onChange={(event) =>
                    updateEntry(index, {
                      score: clampReputationScore(
                        Number.parseInt(event.target.value, 10),
                      ),
                    })
                  }
                  className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-600"
                />
                <input
                  value={entry.status}
                  onChange={(event) =>
                    updateEntry(index, { status: event.target.value })
                  }
                  placeholder="Status"
                  className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-600"
                />
                <button
                  type="button"
                  onClick={() => removeEntry(index)}
                  className="rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs font-medium text-red-200 transition hover:border-red-400/60"
                >
                  Remove
                </button>
              </div>

              <textarea
                value={entry.notes.join("\n")}
                onChange={(event) =>
                  updateEntry(index, {
                    notes: parsePartyList(event.target.value),
                  })
                }
                placeholder="One short reputation note per line"
                className="mt-2 min-h-[72px] w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-600"
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-500">
          No reputation tracked yet.
        </div>
      )}
    </div>
  );
}

function PartyStateDisplay({
  label,
  value,
  emptyLabel,
  multiline = false,
  reputation = false,
}: {
  label: string;
  value: string | string[] | PartyReputationEntry[] | undefined;
  emptyLabel: string;
  multiline?: boolean;
  reputation?: boolean;
}) {
  if (reputation) {
    const reputationEntries = Array.isArray(value)
      ? value.filter(
          (entry): entry is PartyReputationEntry =>
            Boolean(entry) &&
            typeof entry === "object" &&
            !Array.isArray(entry) &&
            typeof (entry as { name?: unknown }).name === "string",
        )
      : [];

    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
          {label}
        </div>
        {reputationEntries.length > 0 ? (
          <div className="space-y-2">
            {reputationEntries.map((entry) => (
              <div
                key={`${entry.name}-${entry.score}-${entry.status}`}
                className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-zinc-100">{entry.name}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${getReputationBadgeClass(
                      entry.score,
                    )}`}
                  >
                    {entry.status} ({entry.score >= 0 ? `+${entry.score}` : entry.score})
                  </span>
                </div>
                {entry.notes.length > 0 ? (
                  <div className="mt-2 space-y-1 text-sm text-zinc-300">
                    {entry.notes.map((note) => (
                      <div key={`${entry.name}-${note}`} className="break-words">
                        {note}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-zinc-500">{emptyLabel}</div>
        )}
      </div>
    );
  }

  const values = Array.isArray(value)
    ? value.filter((entry) => typeof entry === "string" && entry.trim().length > 0)
    : typeof value === "string" && value.trim()
      ? [value.trim()]
      : [];

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
        {label}
      </div>
      {values.length > 0 ? (
        multiline || values.length > 1 ? (
          <div className="space-y-1.5 text-sm text-zinc-200">
            {values.map((entry) => (
              <div key={`${label}-${entry}`} className="break-words">
                {entry}
              </div>
            ))}
          </div>
        ) : (
          <div className="break-words text-sm text-zinc-200">{values[0]}</div>
        )
      ) : (
        <div className="text-sm text-zinc-500">{emptyLabel}</div>
      )}
    </div>
  );
}

function buildPartyStateDraft(partyState: PartyState): PartyStateDraft {
  return {
    narrationLevel: partyState.narrationLevel,
    partyName: partyState.partyName,
    summary: partyState.summary,
    recap: partyState.recap,
    activeQuests: partyState.activeQuests.join("\n"),
    completedQuests: partyState.completedQuests.join("\n"),
    journal: partyState.journal.join("\n"),
    reputation: partyState.reputation,
    sharedInventory: partyState.sharedInventory.join("\n"),
  };
}

function buildSceneImageTitle(sceneTitle: string, place: string) {
  const trimmedSceneTitle = sceneTitle.trim();
  const trimmedPlace = place.trim();

  if (!trimmedSceneTitle) {
    return trimmedPlace || "Scene Image";
  }

  return trimmedPlace
    ? `${trimmedSceneTitle} - ${trimmedPlace}`
    : trimmedSceneTitle;
}

function parsePartyStateDraft(draft: PartyStateDraft): PartyState {
  return {
    narrationLevel: draft.narrationLevel,
    partyName: draft.partyName.trim(),
    summary: draft.summary.trim(),
    recap: draft.recap.trim(),
    activeQuests: parsePartyList(draft.activeQuests),
    completedQuests: parsePartyList(draft.completedQuests),
    journal: parsePartyList(draft.journal),
    reputation: draft.reputation
      .map((entry) => ({
        name: entry.name.trim(),
        score: clampReputationScore(entry.score),
        status: entry.status.trim(),
        notes: entry.notes.map((note) => note.trim()).filter(Boolean),
      }))
      .filter((entry) => entry.name),
    sharedInventory: parsePartyList(draft.sharedInventory),
  };
}

function parsePartyList(value: string) {
  return value
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function formatProgressionTimestamp(value: string) {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return "Unknown time";
  }

  return parsed.toLocaleString();
}

function clampReputationScore(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(-3, Math.min(3, Math.trunc(value)));
}

function getReputationBadgeClass(score: number) {
  if (score >= 2) {
    return "bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-400/20";
  }

  if (score === 1) {
    return "bg-lime-500/15 text-lime-200 ring-1 ring-lime-400/20";
  }

  if (score <= -2) {
    return "bg-red-500/15 text-red-200 ring-1 ring-red-400/20";
  }

  if (score === -1) {
    return "bg-amber-500/15 text-amber-200 ring-1 ring-amber-400/20";
  }

  return "bg-zinc-500/15 text-zinc-200 ring-1 ring-zinc-400/20";
}

function formatLabel(value: string) {
  return value.replace(/([A-Z])/g, " $1");
}

function formatSpellSlotLabel(value: string) {
  return formatLabel(value).replace(/Level(\d+)/i, "Level $1");
}

function getDeadlandsWoundShorthand(sheetJson: Record<string, unknown> | null) {
  if (!sheetJson) {
    return "H0 G0 LA0 RA0 LL0 RL0";
  }

  const explicitShorthand = sheetJson.woundShorthand;
  if (typeof explicitShorthand === "string" && explicitShorthand.trim()) {
    return explicitShorthand.trim();
  }

  const byLocation =
    sheetJson.woundsByLocation &&
    typeof sheetJson.woundsByLocation === "object" &&
    !Array.isArray(sheetJson.woundsByLocation)
      ? (sheetJson.woundsByLocation as Record<string, unknown>)
      : null;
  if (!byLocation) {
    return "H0 G0 LA0 RA0 LL0 RL0";
  }

  const readValue = (key: string) => {
    const value = byLocation[key];
    if (typeof value === "number") {
      return Math.max(0, Math.min(4, Math.trunc(value)));
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return Math.max(0, Math.min(4, Math.trunc(parsed)));
      }
    }
    return 0;
  };

  return `H${readValue("head")} G${readValue("guts")} LA${readValue("leftArm")} RA${readValue("rightArm")} LL${readValue("leftLeg")} RL${readValue("rightLeg")}`;
}

function getDeadlandsFateChipShorthand(sheetJson: Record<string, unknown> | null) {
  if (!sheetJson) {
    return "W2 R1 B0 L0";
  }

  const explicitShorthand = sheetJson.fateChipShorthand;
  if (typeof explicitShorthand === "string" && explicitShorthand.trim()) {
    return explicitShorthand.trim();
  }

  const fateChips =
    sheetJson.fateChips &&
    typeof sheetJson.fateChips === "object" &&
    !Array.isArray(sheetJson.fateChips)
      ? (sheetJson.fateChips as Record<string, unknown>)
      : null;
  if (!fateChips) {
    return "W2 R1 B0 L0";
  }

  const readValue = (key: string, fallback: number) => {
    const value = fateChips[key];
    if (typeof value === "number") {
      return Math.max(0, Math.min(10, Math.trunc(value)));
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return Math.max(0, Math.min(10, Math.trunc(parsed)));
      }
    }
    return fallback;
  };

  return `W${readValue("white", 2)} R${readValue("red", 1)} B${readValue("blue", 0)} L${readValue("legend", 0)}`;
}

function getDeadlandsCompactNumber(value: unknown, fallback: string) {
  if (typeof value === "number") {
    return String(Math.trunc(value));
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return String(Math.trunc(parsed));
    }
  }
  return fallback;
}

function getDeadlandsCompactText(value: unknown, fallback: string) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return fallback;
}

type DeadlandsWoundsByLocation = {
  head: number;
  guts: number;
  leftArm: number;
  rightArm: number;
  leftLeg: number;
  rightLeg: number;
};

type DeadlandsFateChips = {
  white: number;
  red: number;
  blue: number;
  legend: number;
};

function readDeadlandsWoundValue(value: unknown, fallback: number) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : fallback;

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(0, Math.min(4, Math.trunc(parsed)));
}

function buildDeadlandsWoundShorthand(locations: DeadlandsWoundsByLocation) {
  return `H${locations.head} G${locations.guts} LA${locations.leftArm} RA${locations.rightArm} LL${locations.leftLeg} RL${locations.rightLeg}`;
}

function readDeadlandsFateChipValue(value: unknown, fallback: number) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : fallback;

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(0, Math.min(10, Math.trunc(parsed)));
}

function buildDeadlandsFateChipShorthand(fateChips: DeadlandsFateChips) {
  return `W${fateChips.white} R${fateChips.red} B${fateChips.blue} L${fateChips.legend}`;
}

function getDeadlandsWoundsByLocationFromSheet(
  sheetJson: EditableSheetObject,
): DeadlandsWoundsByLocation {
  const locationSource =
    sheetJson.woundsByLocation &&
    typeof sheetJson.woundsByLocation === "object" &&
    !Array.isArray(sheetJson.woundsByLocation)
      ? (sheetJson.woundsByLocation as Record<string, unknown>)
      : null;
  const woundsSource =
    sheetJson.wounds && typeof sheetJson.wounds === "object" && !Array.isArray(sheetJson.wounds)
      ? (sheetJson.wounds as Record<string, unknown>)
      : null;
  const legacyCurrent = readDeadlandsWoundValue(woundsSource?.current, 0);

  return {
    head: readDeadlandsWoundValue(locationSource?.head, 0),
    guts: readDeadlandsWoundValue(locationSource?.guts, legacyCurrent),
    leftArm: readDeadlandsWoundValue(locationSource?.leftArm, 0),
    rightArm: readDeadlandsWoundValue(locationSource?.rightArm, 0),
    leftLeg: readDeadlandsWoundValue(locationSource?.leftLeg, 0),
    rightLeg: readDeadlandsWoundValue(locationSource?.rightLeg, 0),
  };
}

function getDeadlandsFateChipsFromSheet(
  sheetJson: EditableSheetObject,
): DeadlandsFateChips {
  const source =
    sheetJson.fateChips &&
    typeof sheetJson.fateChips === "object" &&
    !Array.isArray(sheetJson.fateChips)
      ? (sheetJson.fateChips as Record<string, unknown>)
      : {};

  return {
    white: readDeadlandsFateChipValue(source.white, 2),
    red: readDeadlandsFateChipValue(source.red, 1),
    blue: readDeadlandsFateChipValue(source.blue, 0),
    legend: readDeadlandsFateChipValue(source.legend, 0),
  };
}

function normalizeDeadlandsSheetWounds(sheetJson: EditableSheetObject): EditableSheetObject {
  const woundsByLocation = getDeadlandsWoundsByLocationFromSheet(sheetJson);
  const fateChips = getDeadlandsFateChipsFromSheet(sheetJson);
  const highestWound = Math.max(...Object.values(woundsByLocation));
  const totalWounds = Object.values(woundsByLocation).reduce(
    (runningTotal, value) => runningTotal + value,
    0,
  );
  const woundIgnore =
    typeof sheetJson.woundIgnore === "string" ? sheetJson.woundIgnore.trim() : "None";
  const ignoreReduction =
    woundIgnore === "Nerves o' Steel" || woundIgnore === "Veteran Resolve" ? 1 : 0;
  const woundLevelByValue = ["Unharmed", "Light", "Heavy", "Serious", "Critical"] as const;

  return {
    ...sheetJson,
    woundsByLocation,
    woundShorthand: buildDeadlandsWoundShorthand(woundsByLocation),
    fateChips,
    fateChipShorthand: buildDeadlandsFateChipShorthand(fateChips),
    wounds: {
      current: highestWound,
      max: 4,
      threshold: 4,
      level: woundLevelByValue[highestWound] ?? "Critical",
      penalty: Math.min(0, ignoreReduction - highestWound),
      total: totalWounds,
    },
  };
}

function cloneEditableSheet(
  sheetJson: Record<string, unknown> | null,
): EditableSheetObject {
  if (!sheetJson) {
    return {};
  }

  return JSON.parse(JSON.stringify(sheetJson)) as EditableSheetObject;
}

function updateEditableSheetAtPath(
  currentSheet: EditableSheetObject,
  path: string[],
  nextValue: EditableSheetValue,
): EditableSheetObject {
  if (path.length === 0) {
    return currentSheet;
  }

  const [currentKey, ...remainingPath] = path;
  const nextSheet: EditableSheetObject = { ...currentSheet };

  if (remainingPath.length === 0) {
    nextSheet[currentKey] = nextValue;
    return nextSheet;
  }

  const currentChild =
    nextSheet[currentKey] &&
    typeof nextSheet[currentKey] === "object" &&
    !Array.isArray(nextSheet[currentKey])
      ? ({ ...(nextSheet[currentKey] as EditableSheetObject) } as EditableSheetObject)
      : {};

  nextSheet[currentKey] = updateEditableSheetAtPath(
    currentChild,
    remainingPath,
    nextValue,
  );

  return nextSheet;
}

function getOrdinalSuffix(value: string) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return "";
  }

  const remainder100 = numericValue % 100;
  if (remainder100 >= 11 && remainder100 <= 13) {
    return "th";
  }

  switch (numericValue % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

function formatSheetValue(value: unknown): string {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "";
    }

    if (value.every((entry) => typeof entry === "string" || typeof entry === "number")) {
      return value.join(", ");
    }

    return value
      .map((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          return String(entry);
        }

        const typedEntry = entry as Record<string, unknown>;

        if (
          typeof typedEntry.level === "string" &&
          typeof typedEntry.value === "number" &&
          typeof typedEntry.penalty === "number"
        ) {
          const penalty =
            typedEntry.penalty > 0
              ? `+${typedEntry.penalty}`
              : String(typedEntry.penalty);
          return `${typedEntry.level} (${typedEntry.value}, ${penalty})`;
        }

        return Object.entries(typedEntry)
          .map(([key, nestedValue]) => `${formatLabel(key).trim()}: ${String(nestedValue)}`)
          .join(", ");
      })
      .join(" | ");
  }

  if (value && typeof value === "object") {
    if ("current" in value && "max" in value) {
      return `${String(value.current)}/${String(value.max)}`;
    }

    if ("current" in value && "threshold" in value) {
      return `${String(value.current)}/${String(value.threshold)}`;
    }

    return Object.entries(value as Record<string, unknown>)
      .map(([key, nestedValue]) => `${formatLabel(key).trim()}: ${String(nestedValue)}`)
      .join(", ");
  }

  return String(value);
}

function formatWoundLevelsValue(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) {
    return formatSheetValue(value);
  }

  const parsedRows = value
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return null;
      }

      const typedEntry = entry as Record<string, unknown>;
      if (
        typeof typedEntry.level !== "string" ||
        typeof typedEntry.value !== "number" ||
        typeof typedEntry.penalty !== "number"
      ) {
        return null;
      }

      const penaltyText =
        typedEntry.penalty > 0
          ? `+${typedEntry.penalty}`
          : String(typedEntry.penalty);
      return `${typedEntry.level} (${typedEntry.value}, ${penaltyText})`;
    })
    .filter((entry): entry is string => Boolean(entry));

  if (parsedRows.length > 0) {
    return parsedRows.join(" | ");
  }

  const stringRows = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (
    stringRows.length > 0 &&
    stringRows.every((entry) => entry === "[object Object]")
  ) {
    return "Unharmed (0, 0) | Light (1, -1) | Heavy (2, -2) | Serious (3, -3) | Critical (4, -4)";
  }

  return formatSheetValue(value);
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
        renderMessageLines(contentLines, role)
      ) : (
        <p>{renderStyledText(displayContent)}</p>
      )}
    </div>
  );
}

function renderMessageLines(lines: string[], role: string) {
  const elements: React.ReactNode[] = [];
  let bufferedParagraph: string[] = [];
  let bufferedChoices: Array<{ id: string; text: string }> = [];
  const allowChoiceList = role === "gm";

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

    if (choiceMatch && allowChoiceList) {
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
  const reversedGmMessages = [...messages]
    .reverse()
    .filter((message) => message.role === "gm");

  for (const gmMessage of reversedGmMessages) {
    const visibleContent = stripVisibleSceneMetadata(gmMessage.content);
    const choiceMap = new Map<number, string>();

    visibleContent.split("\n").forEach((line) => {
      const match = line.trim().match(/^(\d+)\.\s+(.+)$/);

      if (!match) {
        return;
      }

      choiceMap.set(Number(match[1]), match[2].trim());
    });

    if (choiceMap.size > 0) {
      return choiceMap;
    }
  }

  return new Map<number, string>();
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

function normalizeCharacterLookupName(value: string) {
  return value
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getCharacterInitiativeOrder(
  combatState: CombatState,
  character: CampaignCharacter,
) {
  if (!combatState.combatActive || combatState.roster.length === 0) {
    return undefined;
  }

  const normalizedName = normalizeCharacterLookupName(character.name);
  const orderedRoster = getInitiativeOrderedRoster(combatState);
  const rosterIndex = orderedRoster.findIndex(
    ({ entry }) =>
      (entry.id && entry.id === character.id) ||
      normalizeCharacterLookupName(entry.name) === normalizedName,
  );

  return rosterIndex >= 0 ? rosterIndex + 1 : undefined;
}

function getInitiativeOrderedRoster(combatState: CombatState) {
  return combatState.roster
    .map((entry, index) => ({ entry, index }))
    .sort(
      (left, right) =>
        right.entry.initiative - left.entry.initiative || left.index - right.index,
    );
}

function isCombatantActive(
  combatState: CombatState,
  character: CampaignCharacter,
) {
  if (!combatState.combatActive || combatState.roster.length === 0) {
    return false;
  }

  const normalizedName = normalizeCharacterLookupName(character.name);
  const combatEntry = combatState.roster.find(
    (entry) =>
      (entry.id && entry.id === character.id) ||
      normalizeCharacterLookupName(entry.name) === normalizedName,
  );

  return combatEntry?.active === true;
}

function CombatRosterCard({
  entry,
  order,
}: {
  entry: CombatRosterEntry;
  order: number;
}) {
  const statusEffects = Array.isArray(entry.statusEffects)
    ? entry.statusEffects.filter((effect) => effect.trim().length > 0)
    : [];
  const typeBadgeClass =
    entry.type === "enemy"
      ? "border-red-400/30 bg-red-500/10 text-red-200"
      : "border-amber-400/30 bg-amber-500/10 text-amber-200";
  const containerClass =
    entry.type === "enemy"
      ? "border-red-500/30 bg-red-950/15"
      : "border-amber-500/25 bg-amber-950/10";

  return (
    <div
      className={`relative rounded-xl border p-2 text-xs transition-colors ${containerClass} ${
        entry.active ? "ring-2 ring-amber-300/60" : ""
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-zinc-800/70 bg-zinc-950/60">
          <Image
            src={DEFAULT_PORTRAIT_DATA_URL}
            alt={`${entry.name} placeholder portrait`}
            width={160}
            height={160}
            unoptimized
            className="h-full w-full object-cover"
          />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-zinc-100">
                  {entry.name}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-1 truncate text-[10px] text-zinc-300">
            <span
              className={`rounded-full border px-1.5 py-0.5 font-medium uppercase tracking-[0.08em] ${typeBadgeClass}`}
            >
              {entry.type}
            </span>
            {entry.hp ? (
              <>
                <span className="px-1 text-zinc-600">|</span>
                <span>HP {entry.hp}</span>
              </>
            ) : null}
            {entry.active ? (
              <>
                <span className="px-1 text-zinc-600">|</span>
                <span className="text-amber-100">Active</span>
              </>
            ) : null}
          </div>

          {entry.summary ? (
            <div className="mt-1 truncate text-[10px] text-zinc-400">
              {entry.summary}
            </div>
          ) : null}

          {statusEffects.length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {statusEffects.slice(0, 2).map((effect) => (
                <span
                  key={`${entry.name}-${effect}`}
                  className="rounded-full border border-red-400/20 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-200"
                >
                  {effect}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <span className="absolute bottom-2 right-2 rounded-md border border-amber-300/30 bg-amber-300/10 px-1.5 py-1 text-[10px] font-semibold text-amber-100">
        #{order}
      </span>
    </div>
  );
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

function getCompactAncestry(sheetJson: Record<string, unknown> | null) {
  if (!sheetJson) {
    return "";
  }

  const keys = [
    "ancestry",
    "race",
    "heritage",
    "species",
    "kin",
    "lineage",
    "tribe",
  ] as const;

  for (const key of keys) {
    const value = sheetJson[key];
    if (typeof value === "string" && value.trim() && value.trim() !== "Not specified.") {
      return value.trim();
    }
  }

  return "";
}

function getCompactResource(
  sheetJson: Record<string, unknown> | null,
  options?: { preferWind?: boolean },
) {
  if (!sheetJson) {
    return "N/A";
  }

  if (options?.preferWind) {
    const wind = sheetJson.wind;
    if (wind && typeof wind === "object" && !Array.isArray(wind)) {
      if ("current" in wind && "max" in wind) {
        return `${String(wind.current)}/${String(wind.max)}`;
      }
    }

    const numericWind =
      typeof wind === "number"
        ? wind
        : typeof wind === "string" && wind.trim()
          ? Number(wind)
          : null;
    if (numericWind !== null && Number.isFinite(numericWind)) {
      const hp = sheetJson.hp;
      const hpCurrent =
        hp && typeof hp === "object" && !Array.isArray(hp)
          ? "current" in hp
            ? Number((hp as Record<string, unknown>).current)
            : null
          : null;
      const current =
        hpCurrent !== null && Number.isFinite(hpCurrent) ? Math.trunc(hpCurrent) : numericWind;
      return `${current}/${Math.trunc(numericWind)}`;
    }
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
  errorMessage,
  onChange,
}: {
  question: CharacterQuestion;
  value: string | number | undefined;
  errorMessage?: string;
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
          className={`w-full rounded-xl border bg-zinc-950 px-3 py-2 outline-none ${
            errorMessage
              ? "border-red-400/60 focus:border-red-300/80"
              : "border-emerald-200/15 focus:border-emerald-300/50"
          }`}
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
        {errorMessage ? <p className="text-xs text-red-300">{errorMessage}</p> : null}
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
          className={`w-full rounded-xl border bg-zinc-950 px-3 py-2 outline-none ${
            errorMessage
              ? "border-red-400/60 focus:border-red-300/80"
              : "border-emerald-200/15 focus:border-emerald-300/50"
          }`}
        />
        {question.helpText ? (
          <p className="text-xs text-emerald-50/70">{question.helpText}</p>
        ) : null}
        {errorMessage ? <p className="text-xs text-red-300">{errorMessage}</p> : null}
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
        maxLength={question.maxLength}
        className={`min-h-[90px] w-full rounded-xl border bg-zinc-950 px-3 py-2 outline-none ${
          errorMessage
            ? "border-red-400/60 focus:border-red-300/80"
            : "border-emerald-200/15 focus:border-emerald-300/50"
        }`}
      />
      {question.helpText ? (
        <p className="text-xs text-emerald-50/70">{question.helpText}</p>
      ) : null}
      {errorMessage ? <p className="text-xs text-red-300">{errorMessage}</p> : null}
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
  const withoutPartyBlock = extractPartyBlock(withoutSceneBlock).content;
  const withoutCombatBlock = extractCombatBlock(withoutPartyBlock).content;

  return withoutCombatBlock
      .replace(/\s*STATE:\s*[\s\S]*?\s*ENDSTATE\s*/gi, "\n")
      .replace(
        /^\s*SCENE:\s*\n(?:\s*(?:Title|Place|Mood|Threat|Goal|Clock|Context):[^\n]*\n?)+(?:\s*ENDSCENE\s*\n?)?/i,
      "",
    )
    .replace(/\n{3,}/g, "\n\n")
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
