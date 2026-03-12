"use client";

import {
  ChangeEvent,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent,
  WheelEvent as ReactWheelEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import Image from "next/image";
import { useParams } from "next/navigation";
import { LibraryCharacterBuilder } from "@/components/LibraryCharacterBuilder";
import { DebugInspectorModal } from "@/components/DebugInspectorModal";
import {
  DEFAULT_SCENE_SUMMARY,
  extractSceneBlock,
  stripSceneBlock,
  type SceneSummary,
} from "@/lib/scene";
import {
  buildSceneImageCustomDescriptionFromGmContent,
  buildSceneImagePromptFromSections,
  getSceneImageInstructionTemplate,
  getSceneImageStyleTemplate,
} from "@/lib/map-prompt";
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
import { getCatalogSpellPreview } from "@/lib/spell-ability-catalog";
import {
  type WorldMapHistoryEntry,
  type WorldMapPin,
  type SceneImageHistoryEntry,
  type SceneMapState,
  type WorldMapState,
} from "@/lib/map";
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
import { upsertMainCharacter } from "@/lib/campaign-characters";
import { type CampaignBootstrapPlayerView } from "@/lib/campaign-bootstrap";
import { extractCampaignBootstrapBlock } from "@/lib/campaign-bootstrap-reducer";
import {
  decodeEscapedNewlines,
  normalizeChoiceTextForDisplay,
} from "@/lib/chat-display";
import { useBootstrapDebugTools } from "@/hooks/useBootstrapDebugTools";

type ChatMessage = {
  id?: string;
  speakerName: string;
  role: string;
  content: string;
  isEnemyNarration?: boolean;
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
  bootstrapPublicJson: CampaignBootstrapPlayerView | null;
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

function normalizeBootstrapPublicView(value: unknown): CampaignBootstrapPlayerView | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const typedValue = value as Record<string, unknown>;
  if (!typedValue.campaign || typeof typedValue.campaign !== "object") {
    return null;
  }

  return value as CampaignBootstrapPlayerView;
}

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
const WORLD_MAP_VIEWER_ZOOM_MIN = 0.5;
const WORLD_MAP_VIEWER_ZOOM_MAX = 3;
const WORLD_MAP_VIEWER_ZOOM_STEP = 0.25;

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

type InitiativeRollLogEntry = {
  combatantId: string;
  combatantName: string;
  mode?: "d20" | "deadlands-cards";
  roll: number;
  modifier: number;
  total: number;
  drawnCards?: string[];
  chosenCard?: string;
};

function formatDeadlandsCardWithSuitIcon(card: string) {
  const trimmed = card.trim().toUpperCase();
  if (!trimmed) {
    return card;
  }
  if (trimmed === "JR") {
    return "🃏 Red Joker";
  }
  if (trimmed === "JB") {
    return "🃏 Black Joker";
  }

  const match = trimmed.match(/^(10|[2-9JQKA])([CDHS])$/);
  if (!match) {
    return card;
  }

  const rank = match[1];
  const suit = match[2];
  const suitIconMap: Record<string, string> = {
    C: "♣",
    D: "♦",
    H: "♥",
    S: "♠",
  };

  return `${rank}${suitIconMap[suit] ?? suit}`;
}

function formatInitiativeLogEntry(entry: InitiativeRollLogEntry) {
  if (entry.mode === "deadlands-cards") {
    const draws =
      Array.isArray(entry.drawnCards) && entry.drawnCards.length > 0
        ? entry.drawnCards.map((card) => formatDeadlandsCardWithSuitIcon(card)).join(", ")
        : "card(s) drawn";
    const chosen = entry.chosenCard
      ? formatDeadlandsCardWithSuitIcon(entry.chosenCard)
      : "unknown card";

    return `${entry.combatantName}: ${draws} -> ${chosen}`;
  }

  return `${entry.combatantName}: d20(${entry.roll}) + ${entry.modifier} = ${entry.total}`;
}

type CombatEngineLogEntry = {
  id: string;
  text: string;
};

type CombatTraceEntry = {
  id: string;
  timestamp: string;
  phase: string;
  payload: unknown;
};

type PendingReactionState = {
  actorRef: string;
  targetRef: string;
  kind: CombatActionKind;
  seedInput: string;
  targetName: string;
  selectedAttackPresetId: string;
  spellSlot?: string;
  spellName?: string;
  detail?: string;
};

type CombatActionKind =
  | "attack"
  | "cast-spell"
  | "help"
  | "disengage"
  | "dash"
  | "defend"
  | "take-cover"
  | "aim"
  | "surrender"
  | "attempt-escape"
  | "pass";

type SceneImagePromptType = "scene" | "portrait" | "character" | "action" | "character-token";
type SceneImageAspectRatio = "landscape" | "portrait" | "square";
type SceneImageTypeFilter = "all" | SceneImagePromptType;
type SceneImageStylePreset =
  | "cinematic-realism"
  | "fantasy-illustration"
  | "stone-base"
  | "comic-book"
  | "manga"
  | "stylized-3d"
  | "noir"
  | "pulp-poster"
  | "parchment-map"
  | "tactical-map";

type AttackActionPreset = {
  id: string;
  label: string;
  spellName?: string;
  attackBonus: number;
  damageDie: number;
  damageBonus: number;
  category: "weapon" | "spell";
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
  const [collapsedCards, setCollapsedCards] = useState<Record<string, boolean>>({});
  const [detailCardId, setDetailCardId] = useState("");
  const [isTogglingScenario, setIsTogglingScenario] = useState(false);
  const [isResyncingState, setIsResyncingState] = useState(false);
  const [isUndoingTurn, setIsUndoingTurn] = useState(false);
  const [debugStateLoggingEnabled, setDebugStateLoggingEnabled] = useState(false);
  const [isUtilityMenuOpen, setIsUtilityMenuOpen] = useState(false);
  const [isDebugInspectorOpen, setIsDebugInspectorOpen] = useState(false);
  const [engineCombatModeEnabled, setEngineCombatModeEnabled] = useState(true);
  const [autoCompanionCombatEnabled, setAutoCompanionCombatEnabled] = useState(false);
  const [deadlandsJokerEffectsEnabled, setDeadlandsJokerEffectsEnabled] = useState(false);
  const [isSubmittingCombatAction, setIsSubmittingCombatAction] = useState(false);
  const [isAutoResolvingCombat, setIsAutoResolvingCombat] = useState(false);
  const [isEndingEngineCombat, setIsEndingEngineCombat] = useState(false);
  const [pendingReaction, setPendingReaction] = useState<PendingReactionState | null>(null);
  const [combatActionKind, setCombatActionKind] = useState<CombatActionKind>("attack");
  const [combatActionTargetRef, setCombatActionTargetRef] = useState("");
  const [combatAttackPresetId, setCombatAttackPresetId] = useState("basic");
  const [combatSpellSlotLevel, setCombatSpellSlotLevel] = useState("");
  const [combatEngineLogEntries, setCombatEngineLogEntries] = useState<CombatEngineLogEntry[]>([]);
  const [combatTraceEntries, setCombatTraceEntries] = useState<CombatTraceEntry[]>([]);
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
  const [sceneImagePromptType, setSceneImagePromptType] = useState<SceneImagePromptType>("scene");
  const [sceneImageStylePreset, setSceneImageStylePreset] =
    useState<SceneImageStylePreset>("fantasy-illustration");
  const [sceneImageInstructions, setSceneImageInstructions] = useState("");
  const [sceneImageCharacterId, setSceneImageCharacterId] = useState("");
  const [sceneImageCustomDescription, setSceneImageCustomDescription] = useState("");
  const [sceneImageStyleDescription, setSceneImageStyleDescription] = useState("");
  const [sceneImageAspectRatio, setSceneImageAspectRatio] =
    useState<SceneImageAspectRatio>("landscape");
  const [sceneImageSeedInput, setSceneImageSeedInput] = useState("");
  const [isCombinedPromptHidden, setIsCombinedPromptHidden] = useState(true);
  const [isGeneratingWorldMap, setIsGeneratingWorldMap] = useState(false);
  const [isSavingWorldMap, setIsSavingWorldMap] = useState(false);
  const [isSavingWorldMapTitle, setIsSavingWorldMapTitle] = useState(false);
  const [isDeletingWorldMap, setIsDeletingWorldMap] = useState(false);
  const [isWorldMapMenuOpen, setIsWorldMapMenuOpen] = useState(false);
  const [isEditingWorldMapTitle, setIsEditingWorldMapTitle] = useState(false);
  const [isWorldMapViewerOpen, setIsWorldMapViewerOpen] = useState(false);
  const [worldMapViewerZoom, setWorldMapViewerZoom] = useState(1);
  const [worldMapViewerZoomBoxMode, setWorldMapViewerZoomBoxMode] = useState(false);
  const [worldMapViewerPinPlacementMode, setWorldMapViewerPinPlacementMode] = useState(false);
  const [worldMapViewerZoomBoxRect, setWorldMapViewerZoomBoxRect] = useState<{
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>(null);
  const [isWorldMapViewerDragging, setIsWorldMapViewerDragging] = useState(false);
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
  const [activeSceneImageTab, setActiveSceneImageTab] = useState<"saved" | "add">("saved");
  const [sceneImageSavedTypeFilter, setSceneImageSavedTypeFilter] =
    useState<SceneImageTypeFilter>("all");
  const [isSceneImageMenuOpen, setIsSceneImageMenuOpen] = useState(false);
  const [isEditingSceneImageMeta, setIsEditingSceneImageMeta] = useState(false);
  const [hasAutoCollapsedForCombat, setHasAutoCollapsedForCombat] = useState(false);
  const chatScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [followChatLive, setFollowChatLive] = useState(true);
  const [chatAutoScrollPaused, setChatAutoScrollPaused] = useState(false);
  const [showLastResolutionDetails, setShowLastResolutionDetails] = useState(false);
  const [lastCombatResolution, setLastCombatResolution] = useState<{
    narration: string;
    resolution: Record<string, unknown>;
    phase: "player" | "auto" | "reaction";
    createdAt: string;
  } | null>(null);
  const [pendingReactionSince, setPendingReactionSince] = useState<string | null>(null);
  const [reactionTicker, setReactionTicker] = useState(0);
  const [sceneImageDraft, setSceneImageDraft] = useState({
    sceneTitle: "",
    place: "",
  });
  const [confirmationState, setConfirmationState] = useState<ConfirmationState | null>(null);
  const [debugSnapshot, setDebugSnapshot] = useState<DebugSnapshot>(null);
  const worldMapViewerScrollRef = useRef<HTMLDivElement | null>(null);
  const worldMapViewerDragStateRef = useRef<{
    startX: number;
    startY: number;
    startScrollLeft: number;
    startScrollTop: number;
    moved: boolean;
  } | null>(null);
  const worldMapViewerSuppressClickRef = useRef(false);
  const worldMapViewerZoomBoxContentStartRef = useRef<{
    x: number;
    y: number;
  } | null>(null);

  const {
    debugBootstrapState,
    isLoadingDebugBootstrapState,
    isApplyingDebugBootstrapAction,
    loadDebugBootstrapState,
    applyDebugBootstrapAction,
  } = useBootstrapDebugTools({
    campaignId,
    onPublicBootstrapUpdate: (publicView) => {
      setCampaign((currentCampaign) =>
        currentCampaign
          ? {
              ...currentCampaign,
              bootstrapPublicJson: normalizeBootstrapPublicView(publicView),
            }
          : currentCampaign,
      );
    },
    onError: (message) => setError(message),
  });

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
    const container = chatScrollContainerRef.current;
    if (!container) {
      return;
    }
    if (!followChatLive || chatAutoScrollPaused) {
      return;
    }
    container.scrollTop = container.scrollHeight;
  }, [messages, loading, followChatLive, chatAutoScrollPaused]);

  useEffect(() => {
    if (!campaignId) {
      return;
    }

    try {
      const storedPreference = window.localStorage.getItem(
        `engine-combat-mode:${campaignId}`,
      );
      setEngineCombatModeEnabled(
        storedPreference === null ? true : storedPreference === "true",
      );
    } catch {
      setEngineCombatModeEnabled(true);
    }
  }, [campaignId]);

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
            bootstrapPublicJson: normalizeBootstrapPublicView(
              campaignData.campaign.bootstrapPublicJson,
            ),
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
        }

        if (messagesRes.ok) {
          const messagesData = await messagesRes.json();

          if (
            Array.isArray(messagesData.messages) &&
            messagesData.messages.length > 0
          ) {
            setMessages(messagesData.messages);
          }
        }
      } catch {
        setCampaignError("Unable to load campaign data.");
      }
    }

    loadCampaign();
  }, [campaignId]);

  useEffect(() => {
    if (!isDebugInspectorOpen || !debugStateLoggingEnabled || !campaignId) {
      return;
    }
    void loadDebugBootstrapState();
  }, [campaignId, debugStateLoggingEnabled, isDebugInspectorOpen, loadDebugBootstrapState]);

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
    setActiveSceneImageIndex((current) => Math.min(current, imageCount - 1));
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
    const history = campaign?.sceneImageHistoryJson ?? [];
    const filteredHistory = history.filter((image) => {
      if (sceneImageSavedTypeFilter === "all") {
        return true;
      }
      const imageType = (image.imageType ?? "scene").trim().toLowerCase();
      return imageType === sceneImageSavedTypeFilter;
    });
    if (filteredHistory.length <= 0) {
      setActiveSceneImageIndex(0);
      return;
    }
    const selectedImage =
      history[activeSceneImageIndex] ??
      history[history.length - 1] ??
      null;
    const selectedFilteredIndex = selectedImage ? filteredHistory.indexOf(selectedImage) : -1;
    if (selectedFilteredIndex >= 0) {
      return;
    }
    const fallbackImage = filteredHistory[filteredHistory.length - 1];
    const fallbackIndex = history.indexOf(fallbackImage);
    setActiveSceneImageIndex(fallbackIndex >= 0 ? fallbackIndex : 0);
  }, [campaign?.sceneImageHistoryJson, activeSceneImageIndex, sceneImageSavedTypeFilter]);

  useEffect(() => {
    const count = campaign?.worldMapHistoryJson?.length ?? 0;

    if (count <= 0) {
      setActiveWorldMapIndex(0);
      return;
    }

    setActiveWorldMapIndex((current) => Math.min(current, count - 1));
  }, [campaign?.worldMapHistoryJson?.length]);

  useEffect(() => {
    const characters = campaign?.characters ?? [];
    if (characters.length <= 0) {
      setSceneImageCharacterId("");
      return;
    }
    const exists = characters.some((character) => character.id === sceneImageCharacterId);
    if (exists) {
      return;
    }
    const defaultCharacter =
      characters.find((character) => character.isMainCharacter) ?? characters[0];
    setSceneImageCharacterId(defaultCharacter.id);
  }, [campaign?.characters, sceneImageCharacterId]);

  useEffect(() => {
    setSceneImageInstructions(
      getSceneImageInstructionTemplate(sceneImagePromptType, campaign?.ruleset ?? "D&D 5e"),
    );
  }, [sceneImagePromptType, campaign?.ruleset]);

  useEffect(() => {
    if (sceneImagePromptType === "character-token") {
      setSceneImageAspectRatio("square");
      setSceneImageStylePreset("stone-base");
    }
  }, [sceneImagePromptType]);

  useEffect(() => {
    setSceneImageStyleDescription(
      getSceneImageStyleTemplate(sceneImageStylePreset),
    );
  }, [sceneImageStylePreset]);

  useEffect(() => {
    const sanitizedMessages = messages
      .map((message) => getImageNarrativeTextFromMessage(message))
      .filter((entry) => entry.length > 0);
    const lastThreeNarratives = sanitizedMessages.slice(-3).join("\n\n");

    if (sceneImagePromptType === "scene") {
      const latestGmMessage = [...messages]
        .reverse()
        .find((message) => message.role === "gm");
      setSceneImageCustomDescription(
        buildSceneImageCustomDescriptionFromGmContent(latestGmMessage?.content ?? ""),
      );
      return;
    }

    if (sceneImagePromptType === "action") {
      setSceneImageCustomDescription(lastThreeNarratives.trim());
      return;
    }

    const selectedCharacter =
      (campaign?.characters ?? []).find((character) => character.id === sceneImageCharacterId) ??
      null;
    setSceneImageCustomDescription(getCharacterPhysicalDescription(selectedCharacter).trim());
  }, [
    campaign,
    messages,
    sceneImageCharacterId,
    sceneImagePromptType,
  ]);

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
    if (!isWorldMapViewerOpen) {
      setWorldMapViewerZoom(1);
      setWorldMapViewerZoomBoxMode(false);
      setWorldMapViewerPinPlacementMode(false);
      setWorldMapViewerZoomBoxRect(null);
      worldMapViewerDragStateRef.current = null;
      worldMapViewerZoomBoxContentStartRef.current = null;
      setIsWorldMapViewerDragging(false);
      return;
    }
    setWorldMapViewerZoom(1);
  }, [
    isWorldMapViewerOpen,
    activeWorldMapIndex,
    campaign?.worldMapJson,
    campaign?.worldMapHistoryJson,
  ]);

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
  const engineCombatUiLocked = engineCombatModeEnabled && combatActive;
  const initiativeOrderedCombatRoster = getInitiativeOrderedRoster(combatState);
  const companionColorMap = buildCompanionColorMap(companionCharacters);
  const needsCharacterGeneration = !mainCharacter;
  const isDevBuild = process.env.NODE_ENV !== "production";
  const isChatLocked = needsCharacterGeneration;
  const canUndoLastTurn = messages.some((message) => message.role === "user");
  const campaignRuleset = campaign?.ruleset ?? "";
  const bootstrapPublic = campaign?.bootstrapPublicJson ?? null;
  const bootstrapObjective =
    bootstrapPublic?.campaign.party_goal_public?.trim() ?? "";
  const bootstrapKnownQuests = (bootstrapPublic?.quests ?? []).filter(
    (quest) => quest.visibility === "player",
  );
  const bootstrapRumorQuests = (bootstrapPublic?.quests ?? []).filter(
    (quest) => quest.visibility === "teased",
  );
  const bootstrapVisibleClocks = bootstrapPublic?.clocks ?? [];
  const bootstrapRevealedClues = bootstrapPublic?.clues ?? [];
  const bootstrapExpansionEvents = bootstrapPublic?.expansion_events ?? [];
  const sceneSummary = buildSceneSummary(campaign, messages);
  const sceneImageHistory = campaign?.sceneImageHistoryJson ?? [];
  const filteredSceneImageHistory = sceneImageHistory.filter((image) => {
    if (sceneImageSavedTypeFilter === "all") {
      return true;
    }
    const imageType = (image.imageType ?? "scene").trim().toLowerCase();
    return imageType === sceneImageSavedTypeFilter;
  });
  const selectedSceneImageFromIndex =
    sceneImageHistory[activeSceneImageIndex] ??
    sceneImageHistory[sceneImageHistory.length - 1] ??
    null;
  const selectedSceneImage =
    selectedSceneImageFromIndex &&
    filteredSceneImageHistory.includes(selectedSceneImageFromIndex)
      ? selectedSceneImageFromIndex
      : filteredSceneImageHistory[filteredSceneImageHistory.length - 1] ?? null;
  const selectedSceneImageFullIndex = selectedSceneImage
    ? sceneImageHistory.indexOf(selectedSceneImage)
    : -1;
  const selectedSceneImageFilteredIndex = selectedSceneImage
    ? filteredSceneImageHistory.indexOf(selectedSceneImage)
    : -1;
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
  const combatActiveEntry =
    combatState.roster.find((entry) => entry.active) ??
    combatState.roster[combatState.turnIndex] ??
    null;
  const activeCombatCharacter =
    combatActiveEntry &&
    combatActiveEntry.type === "character"
      ? (combatActiveEntry.id
          ? characterMapById.get(combatActiveEntry.id)
          : undefined) ??
        characterMapByName.get(normalizeCharacterLookupName(combatActiveEntry.name)) ??
        null
      : null;
  const combatActionPresets = useMemo<AttackActionPreset[]>(() => {
    if (!activeCombatCharacter) {
      return [
        {
          id: "basic",
          label: "Basic Attack",
          attackBonus: 2,
          damageDie: 8,
          damageBonus: 1,
          category: "weapon",
        },
      ];
    }
    return extractAttackActionPresets(activeCombatCharacter.sheetJson);
  }, [activeCombatCharacter]);
  const combatActionOptions = useMemo(
    () => getCombatActionOptionsForRuleset(campaign?.ruleset ?? ""),
    [campaign?.ruleset],
  );
  const selectedCombatAttackPreset =
    combatActionPresets.find((preset) => preset.id === combatAttackPresetId) ??
    combatActionPresets[0] ??
    null;
  const selectedCombatSpellPreview =
    selectedCombatAttackPreset?.category === "spell" && selectedCombatAttackPreset.spellName
      ? getCatalogSpellPreview({
          profile: "dnd",
          spellName: selectedCombatAttackPreset.spellName,
        })
      : null;
  const selectedCombatSpellConsumesSlot =
    selectedCombatSpellPreview?.cost?.consumesSpellSlot ?? true;
  const availableSpellSlotLevels = useMemo(
    () => getAvailableSpellSlotLevels(activeCombatCharacter?.sheetJson ?? null),
    [activeCombatCharacter?.sheetJson],
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
  const combatLegalTargets = useMemo(() => {
    if (!combatActiveEntry) {
      return [] as CombatRosterEntry[];
    }

    const targetType = combatActiveEntry.type === "enemy" ? "character" : "enemy";
    return combatState.roster.filter(
      (entry) =>
        entry.type === targetType &&
        !isCombatHpDepleted(entry.hp) &&
        (entry.id || entry.name) !== (combatActiveEntry.id || combatActiveEntry.name),
    );
  }, [combatActiveEntry, combatState.roster]);
  const isDeadlandsRuleset = campaignRuleset.trim().toLowerCase().includes("deadlands");
  const nextCombatEntry = useMemo(() => {
    if (!combatActive || combatState.roster.length === 0) {
      return null;
    }
    const currentIndex = combatState.roster.findIndex((entry) => entry.active);
    const normalizedCurrentIndex = currentIndex >= 0 ? currentIndex : combatState.turnIndex;
    if (normalizedCurrentIndex < 0) {
      return null;
    }
    const nextIndex = (normalizedCurrentIndex + 1) % combatState.roster.length;
    return combatState.roster[nextIndex] ?? null;
  }, [combatActive, combatState.roster, combatState.turnIndex]);
  const selectedCombatTarget =
    combatLegalTargets.find((entry) => (entry.id ?? entry.name) === combatActionTargetRef) ?? null;
  const selectedActionRulePreview = useMemo(() => {
    if (combatActionKind === "cast-spell" && selectedCombatAttackPreset?.category === "spell") {
      const spellName = selectedCombatAttackPreset.spellName ?? selectedCombatAttackPreset.label;
      const targetLabel = isDeadlandsRuleset ? "TN" : "AC";
      const targetValue = isDeadlandsRuleset ? 5 : 12;
      if (selectedCombatSpellPreview?.delivery === "save" && selectedCombatSpellPreview.save) {
        return `${spellName}: ${String(selectedCombatSpellPreview.save.ability).toUpperCase()} save vs DC ${selectedCombatSpellPreview.save.dc}. ${
          selectedCombatSpellPreview.save.onSuccess === "half" ? "Half damage on success." : "No damage on success."
        }`;
      }
      if (selectedCombatSpellPreview?.delivery === "auto-hit") {
        return `${spellName}: auto-hit, no attack roll.`;
      }
      return `${spellName}: d20 + ${selectedCombatAttackPreset.attackBonus} vs ${targetLabel} ${selectedCombatTarget?.initiative ?? targetValue}. Damage ${selectedCombatAttackPreset.damageDie >= 4 ? `d${selectedCombatAttackPreset.damageDie}` : "flat"} ${formatSignedBonus(selectedCombatAttackPreset.damageBonus)}.`;
    }

    if (combatActionKind === "attack" && selectedCombatAttackPreset) {
      const targetLabel = isDeadlandsRuleset ? "TN" : "AC";
      const targetValue = isDeadlandsRuleset ? 5 : 12;
      return `${selectedCombatAttackPreset.label}: d20 + ${selectedCombatAttackPreset.attackBonus} vs ${targetLabel} ${selectedCombatTarget?.initiative ?? targetValue}. Damage d${selectedCombatAttackPreset.damageDie} ${formatSignedBonus(selectedCombatAttackPreset.damageBonus)}.`;
    }

    const actionHints: Partial<Record<CombatActionKind, string>> = {
      defend: "Defend: gain temporary defensive benefit this turn.",
      help: "Help: boost an ally's next relevant check/attack.",
      disengage: "Disengage: move without triggering opportunity attacks.",
      dash: "Dash: trade action for movement.",
      "take-cover": "Take Cover: improve survivability against incoming attacks.",
      aim: "Aim: gain attack quality on your next shot.",
      "attempt-escape": "Run Away: contested escape check; success ends encounter contact.",
      surrender: "Surrender: immediately ends combat with party-side surrender outcome.",
      pass: "Pass: skip your action and advance initiative.",
    };
    return actionHints[combatActionKind] ?? null;
  }, [
    combatActionKind,
    isDeadlandsRuleset,
    selectedCombatAttackPreset,
    selectedCombatSpellPreview,
    selectedCombatTarget?.initiative,
  ]);
  const combatSubmitDisabledReason = useMemo(() => {
    if (isSubmittingCombatAction || isAutoResolvingCombat || loading) {
      return "Combat is resolving. Wait for the current step to finish.";
    }
    if (pendingReaction) {
      return "Resolve the pending reaction first.";
    }
    if (!combatActiveEntry) {
      return "No active combatant turn found.";
    }
    if ((combatActionKind === "attack" || combatActionKind === "cast-spell") && combatLegalTargets.length === 0) {
      return "No valid targets remain.";
    }
    if ((combatActionKind === "attack" || combatActionKind === "cast-spell") && !combatActionTargetRef) {
      return "Select a target first.";
    }
    if (combatActionKind === "cast-spell" && (!selectedCombatAttackPreset || selectedCombatAttackPreset.category !== "spell")) {
      return "Select a spell.";
    }
    if (combatActionKind === "cast-spell" && selectedCombatSpellConsumesSlot && (!combatSpellSlotLevel || availableSpellSlotLevels.length === 0)) {
      return "No valid spell slot is selected.";
    }
    return "";
  }, [
    availableSpellSlotLevels.length,
    combatActionKind,
    combatActionTargetRef,
    combatActiveEntry,
    combatLegalTargets.length,
    combatSpellSlotLevel,
    isAutoResolvingCombat,
    isSubmittingCombatAction,
    loading,
    pendingReaction,
    selectedCombatAttackPreset,
    selectedCombatSpellConsumesSlot,
  ]);
  const reactionElapsedSeconds = (() => {
    void reactionTicker;
    return pendingReactionSince
      ? Math.max(0, Math.floor((Date.now() - new Date(pendingReactionSince).getTime()) / 1000))
      : 0;
  })();

  useEffect(() => {
    if (!combatActive) {
      if (hasAutoCollapsedForCombat) {
        setHasAutoCollapsedForCombat(false);
      }
      setPendingReaction(null);
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
    setCombatEngineLogEntries([]);
    setCombatTraceEntries([]);
    setCombatActionTargetRef("");
    setPendingReaction(null);
  }, [campaignId]);

  useEffect(() => {
    if (pendingReaction) {
      setPendingReactionSince((current) => current ?? new Date().toISOString());
      return;
    }
    setPendingReactionSince(null);
  }, [pendingReaction]);

  useEffect(() => {
    if (!pendingReactionSince) {
      return;
    }
    const timer = window.setInterval(() => {
      setReactionTicker((current) => current + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [pendingReactionSince]);

  useEffect(() => {
    if (!campaignId) {
      return;
    }

    try {
      setAutoCompanionCombatEnabled(
        window.localStorage.getItem(`auto-companion-combat:${campaignId}`) === "true",
      );
    } catch {
      setAutoCompanionCombatEnabled(false);
    }
  }, [campaignId]);

  useEffect(() => {
    if (!campaignId) {
      return;
    }

    try {
      setDeadlandsJokerEffectsEnabled(
        window.localStorage.getItem(`deadlands-joker-effects:${campaignId}`) === "true",
      );
    } catch {
      setDeadlandsJokerEffectsEnabled(false);
    }
  }, [campaignId]);

  useEffect(() => {
    if (!engineCombatUiLocked || combatLegalTargets.length === 0) {
      setCombatActionTargetRef("");
      return;
    }

    const currentTargetStillValid = combatLegalTargets.some(
      (entry) => (entry.id ?? entry.name) === combatActionTargetRef,
    );
    if (currentTargetStillValid) {
      return;
    }

    setCombatActionTargetRef(combatLegalTargets[0].id ?? combatLegalTargets[0].name);
  }, [combatActionTargetRef, combatLegalTargets, engineCombatUiLocked]);

  useEffect(() => {
    const hasKind = combatActionOptions.some((option) => option.kind === combatActionKind);
    if (hasKind) {
      return;
    }
    setCombatActionKind(combatActionOptions[0]?.kind ?? "attack");
  }, [combatActionKind, combatActionOptions]);

  useEffect(() => {
    if (!engineCombatUiLocked) {
      return;
    }
    if (combatActionKind !== "attack" && combatActionKind !== "cast-spell") {
      return;
    }
    if (combatActionTargetRef) {
      return;
    }
    if (combatLegalTargets.length === 0) {
      return;
    }
    setCombatActionTargetRef(combatLegalTargets[0].id ?? combatLegalTargets[0].name);
  }, [combatActionKind, combatActionTargetRef, combatLegalTargets, engineCombatUiLocked]);

  useEffect(() => {
    if (combatActionKind !== "attack" && combatActionKind !== "cast-spell") {
      return;
    }

    const hasSelectedPreset = combatActionPresets.some(
      (preset) => preset.id === combatAttackPresetId,
    );
    if (hasSelectedPreset) {
      return;
    }

    setCombatAttackPresetId(combatActionPresets[0]?.id ?? "basic");
  }, [combatActionKind, combatActionPresets, combatAttackPresetId]);

  useEffect(() => {
    if (combatActionKind !== "cast-spell") {
      return;
    }
    if (!selectedCombatAttackPreset || selectedCombatAttackPreset.category !== "spell") {
      const firstSpellPreset = combatActionPresets.find((preset) => preset.category === "spell");
      if (firstSpellPreset) {
        setCombatAttackPresetId(firstSpellPreset.id);
      }
    }
  }, [combatActionKind, combatActionPresets, selectedCombatAttackPreset]);

  useEffect(() => {
    if (combatActionKind !== "cast-spell") {
      return;
    }
    if (!selectedCombatSpellConsumesSlot) {
      setCombatSpellSlotLevel("");
      return;
    }
    if (availableSpellSlotLevels.length === 0) {
      setCombatSpellSlotLevel("");
      return;
    }
    if (availableSpellSlotLevels.includes(combatSpellSlotLevel)) {
      return;
    }
    setCombatSpellSlotLevel(availableSpellSlotLevels[0]);
  }, [
    availableSpellSlotLevels,
    combatActionKind,
    combatSpellSlotLevel,
    selectedCombatSpellConsumesSlot,
  ]);

  useEffect(() => {
    if (progressionState.mode === "milestone") {
      setProgressionAmountInput("1");
    }
  }, [progressionState.mode]);

  function isMainCharacterCombatTurn(state: CombatState) {
    if (!mainCharacter || !state.combatActive || state.roster.length === 0) {
      return false;
    }

    const activeEntry = state.roster.find((entry) => entry.active) ?? state.roster[state.turnIndex];
    if (!activeEntry) {
      return false;
    }

    if (activeEntry.id && activeEntry.id === mainCharacter.id) {
      return true;
    }

    return normalizeCombatLookup(activeEntry.name) === normalizeCombatLookup(mainCharacter.name);
  }

  function isMainCharacterCombatEntry(entry: CombatRosterEntry) {
    if (!mainCharacter) {
      return false;
    }

    if (entry.id && entry.id === mainCharacter.id) {
      return true;
    }

    return normalizeCombatLookup(entry.name) === normalizeCombatLookup(mainCharacter.name);
  }

  function getCombatLegalTargetsForActor(state: CombatState, actor: CombatRosterEntry) {
    const targetType = actor.type === "enemy" ? "character" : "enemy";
    return state.roster.filter(
      (entry) =>
        entry.type === targetType &&
        !isCombatHpDepleted(entry.hp) &&
        (entry.id ?? entry.name) !== (actor.id ?? actor.name),
    );
  }

  function chooseAutoCombatTarget(state: CombatState, actor: CombatRosterEntry) {
    const legalTargets = getCombatLegalTargetsForActor(state, actor);
    if (legalTargets.length === 0) {
      return null;
    }

    if (actor.type === "enemy" && mainCharacter) {
      const preferred =
        legalTargets.find((entry) => entry.id && entry.id === mainCharacter.id) ??
        legalTargets.find(
          (entry) =>
            normalizeCombatLookup(entry.name) === normalizeCombatLookup(mainCharacter.name),
        );
      if (preferred) {
        return preferred;
      }
    }

    return legalTargets[0];
  }

  function getCombatRosterEntryByRef(
    state: CombatState,
    ref: string | undefined,
    fallbackName: string | undefined,
  ) {
    const normalizedRef = normalizeCombatLookup(ref ?? "");
    const normalizedName = normalizeCombatLookup(fallbackName ?? "");
    return (
      state.roster.find((entry) =>
        normalizedRef ? normalizeCombatLookup(entry.id ?? "") === normalizedRef : false,
      ) ??
      state.roster.find((entry) =>
        normalizedName ? normalizeCombatLookup(entry.name) === normalizedName : false,
      ) ??
      null
    );
  }

  function hasCombatStatusEffect(entry: CombatRosterEntry | null, effectName: string) {
    if (!entry || !Array.isArray(entry.statusEffects)) {
      return false;
    }
    const normalized = effectName.trim().toLowerCase();
    return entry.statusEffects.some(
      (effect) =>
        typeof effect === "string" && effect.trim().toLowerCase() === normalized,
    );
  }

  function getReactionRefreshLogLine(previousState: CombatState, nextState: CombatState) {
    if (!nextState.combatActive || nextState.roster.length === 0) {
      return null;
    }
    const nextActive =
      nextState.roster.find((entry) => entry.active) ??
      nextState.roster[nextState.turnIndex] ??
      null;
    if (!nextActive || nextActive.type !== "character") {
      return null;
    }
    const previousEntry = getCombatRosterEntryByRef(
      previousState,
      nextActive.id,
      nextActive.name,
    );
    if (!hasCombatStatusEffect(previousEntry, "Reaction Used")) {
      return null;
    }
    if (hasCombatStatusEffect(nextActive, "Reaction Used")) {
      return null;
    }
    return `Reaction refreshed: ${nextActive.name}.`;
  }

  function appendCombatTrace(phase: string, payload: unknown) {
    if (!payload || (typeof payload === "object" && payload !== null && Object.keys(payload as Record<string, unknown>).length === 0)) {
      return;
    }
    setCombatTraceEntries((current) => {
      const next = [
        ...current,
        {
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          phase,
          payload,
        },
      ];
      return next.length > 60 ? next.slice(next.length - 60) : next;
    });
  }

  function resolveEngineActionSpeaker(
    actorRef: string | undefined,
    fallbackName?: string,
  ): Pick<ChatMessage, "speakerName" | "role" | "isEnemyNarration"> {
    const byId = actorRef ? characterMapById.get(actorRef) : null;
    const byName = actorRef
      ? characterMapByName.get(normalizeCharacterLookupName(actorRef))
      : null;
    const actorCharacter = byId ?? byName ?? null;

    if (actorCharacter) {
      return {
        speakerName: actorCharacter.name,
        role: actorCharacter.isMainCharacter ? "user" : "companion",
        isEnemyNarration: false,
      };
    }

    const speakerName = (fallbackName ?? actorRef ?? "GM").trim() || "GM";
    return {
      speakerName,
      role: "gm",
      isEnemyNarration: true,
    };
  }

  async function runEngineAutoTurns(startState: CombatState) {
    if (!campaignId || !engineCombatModeEnabled || !startState.combatActive) {
      return startState;
    }

    if (!mainCharacter) {
      return startState;
    }

    setIsAutoResolvingCombat(true);

    let workingState = startState;
    let safetyCounter = 0;

    try {
      while (
        workingState.combatActive &&
        workingState.roster.length > 0 &&
        !isMainCharacterCombatTurn(workingState) &&
        safetyCounter < 24
      ) {
        const activeEntry =
          workingState.roster.find((entry) => entry.active) ??
          workingState.roster[workingState.turnIndex] ??
          null;
        if (!activeEntry) {
          break;
        }
        if (
          activeEntry.type === "character" &&
          !isMainCharacterCombatEntry(activeEntry) &&
          !autoCompanionCombatEnabled
        ) {
          break;
        }

        const targetEntry = chooseAutoCombatTarget(workingState, activeEntry);
        const autoAction = chooseAutoEngineActionForCombatant({
          actorEntry: activeEntry,
          actorCharacter:
            (activeEntry.id ? characterMapById.get(activeEntry.id) : null) ??
            characterMapByName.get(normalizeCharacterLookupName(activeEntry.name)) ??
            null,
          targetEntry,
          ruleset: campaign?.ruleset ?? "",
        });
        if (!autoAction) {
          break;
        }

        const actionSeedInput = crypto.randomUUID();
        const basePayload = {
          action: "submit",
          kind: autoAction.kind,
          actor: activeEntry.id ?? activeEntry.name,
          target:
            autoAction.kind === "attack" || autoAction.kind === "cast-spell"
              ? targetEntry?.id ?? targetEntry?.name
              : undefined,
          attackBonus: autoAction.attackBonus,
          damageDie: autoAction.damageDie,
          damageBonus: autoAction.damageBonus,
          spellName: autoAction.spellName,
          spellSlot: autoAction.spellSlot,
          seedInput: actionSeedInput,
        };
        const response = await fetch(`/api/campaigns/${campaignId}/combat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Debug-State-Logging": debugStateLoggingEnabled ? "true" : "false",
          },
          body: JSON.stringify(basePayload),
        });
        let data = await response.json();
        if (response.ok && data?.requiresReaction && data?.reactionPrompt) {
          const prompt = data.reactionPrompt as {
            targetRef?: string;
            targetName?: string;
            detail?: string;
          };
          const isMainReactionTarget =
            Boolean(mainCharacter) &&
            (String(prompt.targetRef ?? "").trim() === mainCharacter?.id ||
              normalizeCombatLookup(String(prompt.targetName ?? "")) ===
                normalizeCombatLookup(mainCharacter?.name ?? ""));
          if (isMainReactionTarget) {
            appendCombatTrace("auto-reaction-required", {
              adapterDebug: "adapterDebug" in data ? data.adapterDebug : null,
              reactionPrompt: data.reactionPrompt,
              previewResolution: data.previewResolution ?? null,
            });
            setPendingReaction({
              actorRef: String(basePayload.actor ?? ""),
              targetRef: String(prompt.targetRef ?? basePayload.target ?? ""),
              kind: basePayload.kind as CombatActionKind,
              seedInput: actionSeedInput,
              targetName: String(prompt.targetName ?? "Target"),
              selectedAttackPresetId: autoAction.attackPresetId ?? "basic",
              spellSlot: autoAction.spellSlot,
              spellName: autoAction.spellName,
              detail: typeof prompt.detail === "string" ? prompt.detail : undefined,
            });
            setCombatEngineLogEntries((current) => [
              ...current,
              {
                id: crypto.randomUUID(),
                text: `Reaction available: ${String(prompt.targetName ?? "Target")} can use Shield.`,
              },
            ]);
            break;
          }

          const reactionResponse = await fetch(`/api/campaigns/${campaignId}/combat`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Debug-State-Logging": debugStateLoggingEnabled ? "true" : "false",
            },
            body: JSON.stringify({
              ...basePayload,
              reactionDecision: "decline",
            }),
          });
          data = await reactionResponse.json();
          if (reactionResponse.ok) {
            appendCombatTrace("auto-reaction-decline", {
              adapterDebug: "adapterDebug" in data ? data.adapterDebug : null,
              resolution: data.resolution ?? null,
            });
          }
          if (!reactionResponse.ok || !data.combatStateJson || !data.resolution) {
            throw new Error(data.error ?? "Unable to auto-resolve reaction turn.");
          }
        }

        if (!response.ok || !data.combatStateJson || !data.resolution) {
          throw new Error(data.error ?? "Unable to auto-resolve combat turn.");
        }

        const nextState = data.combatStateJson as CombatState;
        const typedResolution = data.resolution as Record<string, unknown>;
        appendCombatTrace("auto-submit", {
          adapterDebug: "adapterDebug" in data ? data.adapterDebug : null,
          resolution: typedResolution,
        });
        const reactionRefreshLine = getReactionRefreshLogLine(workingState, nextState);

        setCampaign((currentCampaign) =>
          currentCampaign
            ? {
                ...currentCampaign,
                combatStateJson: nextState,
                characters: mergeCampaignCharacters(
                  currentCampaign.characters,
                  data.characters,
                ),
              }
            : currentCampaign,
        );
        const speaker = resolveEngineActionSpeaker(
          typeof typedResolution.actor === "string" ? typedResolution.actor : undefined,
          activeEntry.name,
        );
        setMessages((prev) => [
          ...prev,
          {
            speakerName: speaker.speakerName,
            role: speaker.role,
            content: buildCombatEngineResolutionNarration(typedResolution),
            isEnemyNarration: speaker.isEnemyNarration,
          },
        ]);
        setCombatEngineLogEntries((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            text: `[Auto] ${buildCombatEngineResolutionNarration(typedResolution)}`,
          },
          ...(reactionRefreshLine
            ? [
                {
                  id: crypto.randomUUID(),
                  text: `[Auto] ${reactionRefreshLine}`,
                },
              ]
            : []),
          ...("adapterDebug" in data && data.adapterDebug
            ? [
                {
                  id: crypto.randomUUID(),
                  text: `[Adapter] ${String((data.adapterDebug as { profile?: string }).profile ?? "unknown")} (${String((data.adapterDebug as { ruleset?: string }).ruleset ?? "unknown ruleset")})`,
                },
              ]
            : []),
        ]);
        setLastCombatResolution({
          narration: buildCombatEngineResolutionNarration(typedResolution),
          resolution: typedResolution,
          phase: "auto",
          createdAt: new Date().toISOString(),
        });

        workingState = nextState;
        safetyCounter += 1;
      }

      if (safetyCounter >= 24) {
        setCombatEngineLogEntries((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            text: "Auto-turn safety stop reached.",
          },
        ]);
      }
    } finally {
      setIsAutoResolvingCombat(false);
    }

    return workingState;
  }

  function handleCombatControlsKeyDown(event: ReactKeyboardEvent<HTMLFormElement>) {
    if (!engineCombatUiLocked) {
      return;
    }
    const targetElement = event.target as HTMLElement | null;
    const tagName = targetElement?.tagName?.toLowerCase();
    if (tagName === "input" || tagName === "textarea" || tagName === "select") {
      return;
    }

    if (pendingReaction) {
      if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        void handleResolvePendingReaction("use-shield");
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        void handleResolvePendingReaction("decline");
        return;
      }
    }

    if (event.key >= "1" && event.key <= "9") {
      const index = Number(event.key) - 1;
      const option = combatActionOptions[index];
      if (option) {
        event.preventDefault();
        setCombatActionKind(option.kind);
      }
      return;
    }

    if (event.key === "Enter" && !event.shiftKey && !combatSubmitDisabledReason) {
      event.preventDefault();
      void handleCombatEngineSubmit({
        kind: combatActionKind,
        targetRef: combatActionTargetRef,
      });
    }
  }

  async function handleCombatEngineSubmit(params: {
    kind: CombatActionKind;
    targetRef?: string;
    userMessageContent?: string;
  }) {
    if (!campaignId || !campaign || isSubmittingCombatAction) {
      return false;
    }

    const combatState = campaign.combatStateJson ?? DEFAULT_COMBAT_STATE;
    if (!combatState.combatActive || combatState.roster.length === 0) {
      return false;
    }

    const activeEntry =
      combatState.roster.find((entry) => entry.active) ??
      combatState.roster[combatState.turnIndex] ??
      null;
    if (!activeEntry) {
      setError("Combat turn could not be determined.");
      return true;
    }

    const targetEntry =
      params.kind === "attack" || params.kind === "cast-spell"
        ? findCombatTargetFromRef(params.targetRef ?? "", combatState)
        : null;
    const selectedAttackPreset =
      params.kind === "attack" || params.kind === "cast-spell"
        ? combatActionPresets.find((preset) => preset.id === combatAttackPresetId) ??
          combatActionPresets[0]
        : null;
    const isFireballAoeCast =
      params.kind === "cast-spell" &&
      selectedAttackPreset?.category === "spell" &&
      (selectedAttackPreset.spellName ?? "").trim().toLowerCase() === "fireball";
    const fireballTargetRefs = isFireballAoeCast
      ? combatLegalTargets.map((entry) => entry.id ?? entry.name).filter(Boolean)
      : [];
    if ((params.kind === "attack" || params.kind === "cast-spell") && !targetEntry) {
      setError("No valid target found for combat action.");
      return true;
    }
    if (params.kind === "cast-spell" && !selectedAttackPreset) {
      setError("No spell attack profile available.");
      return true;
    }
    if (
      params.kind === "cast-spell" &&
      selectedCombatSpellConsumesSlot &&
      availableSpellSlotLevels.length === 0
    ) {
      setError("No spell slots remaining.");
      return true;
    }

    setError("");
    setIsSubmittingCombatAction(true);
    setLoading(true);
    setPendingReaction(null);

    const defaultUserMessage =
      params.kind === "attack"
        ? `Attack ${targetEntry?.name ?? "target"} with ${selectedAttackPreset?.label ?? "attack"}.`
        : params.kind === "cast-spell"
          ? isFireballAoeCast
            ? `Cast ${selectedAttackPreset?.label ?? "Fireball"} on ${Math.max(1, fireballTargetRefs.length)} targets.`
            : `Cast ${selectedAttackPreset?.label ?? "spell"} at ${targetEntry?.name ?? "target"}.`
        : params.kind === "defend"
          ? "Take a defensive stance."
          : params.kind === "help"
            ? "Help an ally."
            : params.kind === "disengage"
              ? "Disengage and reposition."
              : params.kind === "dash"
                ? "Dash to a better position."
                : params.kind === "take-cover"
                  ? "Take cover."
                  : params.kind === "aim"
                    ? "Take aim."
                    : params.kind === "attempt-escape"
                      ? "Attempt to run away and disengage from combat."
                      : params.kind === "surrender"
                        ? "Surrender and end hostilities."
          : "Hold position and pass.";
    const actorCharacter =
      (activeEntry.id ? characterMapById.get(activeEntry.id) : null) ??
      characterMapByName.get(normalizeCharacterLookupName(activeEntry.name)) ??
      null;
    const actorIsMainCharacter = Boolean(actorCharacter?.isMainCharacter);
    const actorMessageRole: ChatMessage["role"] =
      activeEntry.type === "character"
        ? actorIsMainCharacter
          ? "user"
          : "companion"
        : "gm";
    const userMessage: ChatMessage = {
      speakerName: activeEntry.name || actorCharacter?.name || mainCharacter?.name || "Player",
      role: actorMessageRole,
      content: params.userMessageContent ?? defaultUserMessage,
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");

    try {
      const actionSeedInput = crypto.randomUUID();
      const requestPayload = {
        action: "submit",
        kind: params.kind,
        actor: activeEntry.id ?? activeEntry.name,
        target: targetEntry ? targetEntry.id ?? targetEntry.name : undefined,
        targetRefs:
          params.kind === "cast-spell" && isFireballAoeCast
            ? fireballTargetRefs
            : undefined,
        attackBonus:
          params.kind === "attack" || params.kind === "cast-spell"
            ? selectedAttackPreset?.attackBonus
            : undefined,
        damageDie:
          params.kind === "attack" || params.kind === "cast-spell"
            ? selectedAttackPreset?.damageDie
            : undefined,
        damageBonus:
          params.kind === "attack" || params.kind === "cast-spell"
            ? selectedAttackPreset?.damageBonus
            : undefined,
        spellName: params.kind === "cast-spell" ? selectedAttackPreset?.spellName : undefined,
        spellSlot:
          params.kind === "cast-spell" && selectedCombatSpellConsumesSlot
            ? combatSpellSlotLevel
            : undefined,
        seedInput: actionSeedInput,
      };
      const response = await fetch(`/api/campaigns/${campaignId}/combat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Debug-State-Logging": debugStateLoggingEnabled ? "true" : "false",
          },
        body: JSON.stringify(requestPayload),
      });
      const data = await response.json();

      if (response.ok && data?.requiresReaction && data?.reactionPrompt) {
        appendCombatTrace("player-reaction-required", {
          adapterDebug: "adapterDebug" in data ? data.adapterDebug : null,
          reactionPrompt: data.reactionPrompt,
          previewResolution: data.previewResolution ?? null,
        });
        const prompt = data.reactionPrompt as {
          targetRef?: string;
          targetName?: string;
          detail?: string;
        };
        setPendingReaction({
          actorRef: String(requestPayload.actor ?? ""),
          targetRef: String(prompt.targetRef ?? requestPayload.target ?? ""),
          kind: requestPayload.kind as CombatActionKind,
          seedInput: actionSeedInput,
          targetName: String(prompt.targetName ?? targetEntry?.name ?? "Target"),
          selectedAttackPresetId: selectedAttackPreset?.id ?? combatAttackPresetId,
          spellSlot:
            typeof requestPayload.spellSlot === "string" ? requestPayload.spellSlot : undefined,
          spellName:
            typeof requestPayload.spellName === "string" ? requestPayload.spellName : undefined,
          detail: typeof prompt.detail === "string" ? prompt.detail : undefined,
        });
        setCombatEngineLogEntries((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            text: `Reaction available: ${String(prompt.targetName ?? "Target")} can use Shield.`,
          },
        ]);
        return true;
      }

      if (!response.ok || !data.combatStateJson || !data.resolution) {
        throw new Error(data.error ?? "Unable to resolve combat action.");
      }

      const nextCombatState = data.combatStateJson as CombatState;
      const typedResolution = data.resolution as Record<string, unknown>;
      appendCombatTrace("player-submit", {
        adapterDebug: "adapterDebug" in data ? data.adapterDebug : null,
        resolution: typedResolution,
      });
      const resolutionNarration = buildCombatEngineResolutionNarration(typedResolution);
      const reactionRefreshLine = getReactionRefreshLogLine(combatState, nextCombatState);
      setCampaign((currentCampaign) =>
        currentCampaign
          ? {
              ...currentCampaign,
              combatStateJson: nextCombatState,
              characters: mergeCampaignCharacters(
                currentCampaign.characters,
                data.characters,
              ),
            }
          : currentCampaign,
      );

      const speaker = resolveEngineActionSpeaker(
        typeof typedResolution.actor === "string" ? typedResolution.actor : undefined,
        activeEntry.name,
      );
      setMessages((prev) => [
        ...prev,
        {
          speakerName: speaker.speakerName,
          role: speaker.role,
          content: resolutionNarration,
          isEnemyNarration: speaker.isEnemyNarration,
        },
      ]);
      setCombatEngineLogEntries((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          text: resolutionNarration,
        },
        ...(reactionRefreshLine
          ? [
              {
                id: crypto.randomUUID(),
                text: reactionRefreshLine,
              },
            ]
          : []),
        ...("adapterDebug" in data && data.adapterDebug
          ? [
              {
                id: crypto.randomUUID(),
                text: `[Adapter] ${String((data.adapterDebug as { profile?: string }).profile ?? "unknown")} (${String((data.adapterDebug as { ruleset?: string }).ruleset ?? "unknown ruleset")})`,
              },
            ]
          : []),
      ]);
      setLastCombatResolution({
        narration: resolutionNarration,
        resolution: typedResolution,
        phase: "player",
        createdAt: new Date().toISOString(),
      });

      const outcomeHandoffMessage = getCombatOutcomeHandoffMessage(typedResolution);
      if (outcomeHandoffMessage) {
        await endEngineCombatAndHandoff({
          handoffMessage: outcomeHandoffMessage,
          requireActiveEngineCombat: false,
          appendPlayerMessage: false,
        });
        return true;
      }

      const finalCombatState = await runEngineAutoTurns(nextCombatState);
      await maybeAutoEndEngineCombatFromState(finalCombatState);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to resolve combat action.");
    } finally {
      setLoading(false);
      setIsSubmittingCombatAction(false);
    }

    return true;
  }

  async function handleResolvePendingReaction(decision: "use-shield" | "decline") {
    if (!campaignId || !pendingReaction || isSubmittingCombatAction) {
      return;
    }

    setError("");
    setIsSubmittingCombatAction(true);
    setLoading(true);

    try {
      const response = await fetch(`/api/campaigns/${campaignId}/combat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Debug-State-Logging": debugStateLoggingEnabled ? "true" : "false",
        },
        body: JSON.stringify({
          action: "submit",
          kind: pendingReaction.kind,
          actor: pendingReaction.actorRef,
          target: pendingReaction.targetRef,
          spellName: pendingReaction.spellName,
          spellSlot: pendingReaction.spellSlot,
          reactionDecision: decision,
          seedInput: pendingReaction.seedInput,
        }),
      });
      const data = await response.json();

      if (!response.ok || !data.combatStateJson || !data.resolution) {
        throw new Error(data.error ?? "Unable to resolve reaction.");
      }

      const nextCombatState = data.combatStateJson as CombatState;
      const typedResolution = data.resolution as Record<string, unknown>;
      appendCombatTrace("player-reaction-resolve", {
        decision,
        adapterDebug: "adapterDebug" in data ? data.adapterDebug : null,
        resolution: typedResolution,
      });
      const resolutionNarration = buildCombatEngineResolutionNarration(typedResolution);
      const previousCombatState = campaign.combatStateJson ?? DEFAULT_COMBAT_STATE;
      const reactionRefreshLine = getReactionRefreshLogLine(
        previousCombatState,
        nextCombatState,
      );

      setCampaign((currentCampaign) =>
        currentCampaign
          ? {
              ...currentCampaign,
              combatStateJson: nextCombatState,
              characters: mergeCampaignCharacters(
                currentCampaign.characters,
                data.characters,
              ),
            }
          : currentCampaign,
      );

      const speaker = resolveEngineActionSpeaker(
        typeof typedResolution.actor === "string" ? typedResolution.actor : undefined,
      );
      setMessages((prev) => [
        ...prev,
        {
          speakerName: speaker.speakerName,
          role: speaker.role,
          content: resolutionNarration,
          isEnemyNarration: speaker.isEnemyNarration,
        },
      ]);
      setCombatEngineLogEntries((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          text: `Reaction decision: ${decision === "use-shield" ? "Use Shield" : "Decline"}.`,
        },
        {
          id: crypto.randomUUID(),
          text: resolutionNarration,
        },
        ...(reactionRefreshLine
          ? [
              {
                id: crypto.randomUUID(),
                text: reactionRefreshLine,
              },
            ]
          : []),
      ]);
      setLastCombatResolution({
        narration: resolutionNarration,
        resolution: typedResolution,
        phase: "reaction",
        createdAt: new Date().toISOString(),
      });
      setPendingReaction(null);
      const finalCombatState = await runEngineAutoTurns(nextCombatState);
      await maybeAutoEndEngineCombatFromState(finalCombatState);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to resolve reaction.");
      return false;
    } finally {
      setIsSubmittingCombatAction(false);
      setLoading(false);
    }
  }

  function inferAutoCombatEndHandoffMessage(state: CombatState) {
    if (!state.combatActive || state.roster.length === 0) {
      return null;
    }

    const characters = state.roster.filter((entry) => entry.type === "character");
    const enemies = state.roster.filter((entry) => entry.type === "enemy");
    if (characters.length === 0 || enemies.length === 0) {
      return null;
    }

    const hasLivingCharacters = characters.some((entry) => !isCombatantDefeated(entry));
    const hasLivingEnemies = enemies.some((entry) => !isCombatantDefeated(entry));
    if (!hasLivingEnemies) {
      return "Combat has ended because all enemies are down. Narrate the immediate aftermath and next choices.";
    }
    if (!hasLivingCharacters) {
      return "Combat has ended because the party has been defeated. Narrate consequences and immediate next options.";
    }

    return null;
  }

  function buildCombatHandoffFallback(handoffMessage: string) {
    const normalized = handoffMessage.toLowerCase();
    if (normalized.includes("player side surrendered") || normalized.includes("party surrendered")) {
      return [
        "Your party surrenders and the enemies seize control of the scene.",
        "Weapons are taken, positions are dictated, and your next move must be negotiated from disadvantage.",
        "",
        "1. Negotiate terms and buy time.",
        "2. Comply for now and look for an escape opportunity.",
        "3. Signal allies quietly and plan a coordinated reversal.",
        "4. Demand proof your surrender terms will be honored.",
      ].join("\n");
    }
    if (normalized.includes("player side escaped") || normalized.includes("party escaped")) {
      return [
        "Your party breaks contact and escapes the immediate fight.",
        "Breathing hard, you reach temporary safety while the enemy regroups behind you.",
        "",
        "1. Regroup and treat injuries before they track you.",
        "2. Set an ambush in terrain favorable to your party.",
        "3. Change route and continue the mission under pressure.",
        "4. Scout the enemy position and decide whether to re-engage.",
      ].join("\n");
    }
    if (normalized.includes("party has been defeated")) {
      return [
        "The smoke clears and the fight turns against your party.",
        "Survivors drag the wounded to cover while enemies seize control of the street.",
        "",
        "1. Regroup in a safer location and treat injuries.",
        "2. Attempt negotiation or surrender to avoid further bloodshed.",
        "3. Plan a rescue or counter-move after gathering allies.",
        "4. Track where the enemies took control and decide your next risk.",
      ].join("\n");
    }
    if (normalized.includes("all enemies are down")) {
      return [
        "The last enemy falls and the gunfire finally stops.",
        "Your party catches a breath amid wreckage, wounded allies, and stunned bystanders.",
        "",
        "1. Secure the area and check for hidden threats.",
        "2. Tend to injuries and stabilize the party.",
        "3. Interrogate survivors or witnesses for leads.",
        "4. Decide where to move next before reinforcements arrive.",
      ].join("\n");
    }
    return [
      "Combat has ended. The scene shifts to immediate consequences and hard choices.",
      "",
      "1. Stabilize the party and assess damage.",
      "2. Search the area for clues and valuables.",
      "3. Speak with allies and decide on a next objective.",
      "4. Leave the area before new threats arrive.",
    ].join("\n");
  }

  function normalizeCombatHandoffMessageContent(content: string, handoffMessage: string) {
    const fallback = buildCombatHandoffFallback(handoffMessage);
    const stripped = content
      .replace(/^\s*SCENE\s*:?\s*/i, "")
      .replace(
        /^\s*(?:Title|Place|Mood|Threat|Goal|Clock|Context):[\s\S]*?(?=\n\s*\n|(?:\n\s*\d+\.\s)|$)/i,
        "",
      )
      .replace(/(?:^|\n)\s*ENDS?CEN?E?\s*(?=\n|$)/gi, "\n")
      .trim();
    const base = stripped || fallback;
    const hasNumberedOptions = /^\s*\d+\.\s+/m.test(base);
    if (hasNumberedOptions) {
      return base;
    }

    const fallbackOptions = fallback
      .split("\n")
      .filter((line) => /^\d+\.\s+/.test(line.trim()));
    if (fallbackOptions.length === 0) {
      return base;
    }

    return `${base}\n\n${fallbackOptions.join("\n")}`;
  }

  async function endEngineCombatAndHandoff(params: {
    handoffMessage: string;
    requireActiveEngineCombat: boolean;
    appendPlayerMessage: boolean;
  }) {
    if (!campaignId || isEndingEngineCombat) {
      return false;
    }
    if (params.requireActiveEngineCombat && !engineCombatUiLocked) {
      return false;
    }

    setError("");
    setIsEndingEngineCombat(true);
    setLoading(true);

    try {
      const endResponse = await fetch(`/api/campaigns/${campaignId}/combat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Debug-State-Logging": debugStateLoggingEnabled ? "true" : "false",
        },
        body: JSON.stringify({
          action: "end",
        }),
      });
      const endData = await endResponse.json();
      if (!endResponse.ok || !endData.combatStateJson) {
        throw new Error(endData.error ?? "Unable to end combat.");
      }
      const endedCombatState = (endData.combatStateJson as CombatState) ?? DEFAULT_COMBAT_STATE;

      if (params.appendPlayerMessage) {
        const userMessage: ChatMessage = {
          speakerName: mainCharacter?.name ?? "Player",
          role: "user",
          content: params.handoffMessage,
        };
        setMessages((prev) => [...prev, userMessage]);
      }

      const chatResponse = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Debug-State-Logging": debugStateLoggingEnabled ? "true" : "false",
        },
        body: JSON.stringify({
          campaignId,
          message: params.handoffMessage,
          selectedOptionNumbers: [],
          engineCombatModeEnabled: false,
        }),
      });
      if (!chatResponse.ok) {
        throw new Error("Unable to hand off combat aftermath to GM.");
      }

      const chatData = await chatResponse.json();
      if (chatData.debug) {
        setDebugSnapshot(chatData.debug as DebugSnapshot);
      }
      const fallbackReply = buildCombatHandoffFallback(params.handoffMessage);
      const isPauseReply = (value: string | undefined) => {
        if (typeof value !== "string") {
          return false;
        }
        const normalized = value
          .trim()
          .toLowerCase()
          .replace(/[`*_]/g, "")
          .replace(/\s+/g, " ");
        if (!normalized) {
          return true;
        }
        return (
          normalized === "the gm pauses, uncertain how to respond." ||
          normalized.includes("the gm pauses, uncertain how to respond")
        );
      };
      if (Array.isArray(chatData.messages) && chatData.messages.length > 0) {
        const normalizedMessages = (chatData.messages as ChatMessage[]).map((message) =>
          message.role === "gm" &&
          (isPauseReply(message.content) || !message.content?.trim())
            ? {
                ...message,
                content: fallbackReply,
              }
            : message.role === "gm"
              ? {
                  ...message,
                  content: normalizeCombatHandoffMessageContent(
                    message.content ?? "",
                    params.handoffMessage,
                  ),
                }
              : message,
        );
        setMessages((prev) => [...prev, ...normalizedMessages]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            speakerName: "GM",
            role: "gm",
            content: isPauseReply(chatData.reply as string | undefined)
              ? fallbackReply
              : normalizeCombatHandoffMessageContent(
                  (chatData.reply as string | undefined) ?? "Combat has ended.",
                  params.handoffMessage,
                ),
          },
        ]);
      }

      setCampaign((currentCampaign) =>
        currentCampaign
          ? {
              ...currentCampaign,
              combatStateJson: endedCombatState.combatActive
                ? endedCombatState
                : DEFAULT_COMBAT_STATE,
              partyStateJson: chatData.partyStateJson
                ? normalizePartyState(chatData.partyStateJson)
                : currentCampaign.partyStateJson,
              mapStateJson:
                "mapStateJson" in chatData
                  ? (chatData.mapStateJson as SceneMapState | null)
                  : currentCampaign.mapStateJson,
              sceneImageHistoryJson:
                "sceneImageHistoryJson" in chatData &&
                Array.isArray(chatData.sceneImageHistoryJson)
                  ? (chatData.sceneImageHistoryJson as SceneImageHistoryEntry[])
                  : currentCampaign.sceneImageHistoryJson,
              bootstrapPublicJson:
                "bootstrapPublicJson" in chatData
                  ? normalizeBootstrapPublicView(chatData.bootstrapPublicJson)
                  : currentCampaign.bootstrapPublicJson,
              characters: Array.isArray(chatData.characters)
                ? (chatData.characters as CampaignCharacter[])
                : currentCampaign.characters,
            }
          : currentCampaign,
      );
      setCombatEngineLogEntries((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          text: "Combat ended and narrative handoff sent to GM.",
        },
      ]);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to end combat.");
      return false;
    } finally {
      setLoading(false);
      setIsEndingEngineCombat(false);
    }
  }

  async function maybeAutoEndEngineCombatFromState(state: CombatState) {
    const handoffMessage = inferAutoCombatEndHandoffMessage(state);
    if (!handoffMessage) {
      return false;
    }

    return endEngineCombatAndHandoff({
      handoffMessage,
      requireActiveEngineCombat: false,
      appendPlayerMessage: false,
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    const trimmed = input.trim();
    if (!trimmed || loading || !campaignId || isChatLocked) return;
    const hadCombatActiveAtSubmit = combatActive;
    if (engineCombatModeEnabled && combatActive) {
      setError("");
      return;
    }
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
          engineCombatModeEnabled,
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
                  bootstrapPublicJson:
                    "bootstrapPublicJson" in data
                      ? normalizeBootstrapPublicView(data.bootstrapPublicJson)
                      : currentCampaign.bootstrapPublicJson,
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
                  bootstrapPublicJson:
                    "bootstrapPublicJson" in data
                      ? normalizeBootstrapPublicView(data.bootstrapPublicJson)
                      : currentCampaign.bootstrapPublicJson,
                }
              : currentCampaign,
          );
        }

        const returnedCombatState =
          "combatStateJson" in data
            ? (data.combatStateJson as CombatState | null)
            : null;
        if (
          engineCombatModeEnabled &&
          !hadCombatActiveAtSubmit &&
          returnedCombatState?.combatActive &&
          Array.isArray(returnedCombatState.roster) &&
          returnedCombatState.roster.length > 1
        ) {
          const returnedCharacterNames = new Set(
            returnedCombatState.roster
              .filter((entry) => entry.type === "character")
              .map((entry) => normalizeCombatLookup(entry.name)),
          );
          const missingCharacterCombatants = (campaign?.characters ?? [])
            .filter(
              (character) =>
                !returnedCharacterNames.has(normalizeCombatLookup(character.name)),
            )
            .map((character) => ({
              id: character.id,
              name: character.name,
              type: "character" as const,
              summary: character.role || undefined,
            }));
          const startCombatants = [
            ...returnedCombatState.roster.map((entry) => ({
              id:
                entry.type === "character"
                  ? (campaign?.characters.find(
                      (character) =>
                        normalizeCombatLookup(character.name) ===
                        normalizeCombatLookup(entry.name),
                    )?.id ?? undefined)
                  : undefined,
              name: entry.name,
              type: entry.type,
              summary: entry.summary,
              hp: entry.hp,
              statusEffects: entry.statusEffects,
            })),
            ...missingCharacterCombatants,
          ];
          const expandedStartCombatants = expandGroupedEnemyCombatants(startCombatants);
          const startResponse = await fetch(`/api/campaigns/${campaignId}/combat`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Debug-State-Logging": debugStateLoggingEnabled ? "true" : "false",
            },
            body: JSON.stringify({
              action: "start",
              combatants: expandedStartCombatants,
              seedInput: `${campaignId}|engine-start|${Date.now()}`,
              deadlandsJokerEffectsEnabled,
            }),
          });
          const startData = await startResponse.json();

          if (startResponse.ok && startData.combatStateJson) {
            const startedCombatState = startData.combatStateJson as CombatState;
            appendCombatTrace("engine-start", {
              rollLog: Array.isArray(startData.rollLog) ? startData.rollLog : [],
              adapterDebug: "adapterDebug" in startData ? startData.adapterDebug : null,
            });
            setCampaign((currentCampaign) =>
              currentCampaign
                ? {
                    ...currentCampaign,
                    combatStateJson: startedCombatState,
                  }
                : currentCampaign,
            );
            if (Array.isArray(startData.rollLog) && startData.rollLog.length > 0) {
              const orderedInitiativeEntries = [...(startData.rollLog as InitiativeRollLogEntry[])].sort(
                (left, right) => {
                  if (right.total !== left.total) {
                    return right.total - left.total;
                  }
                  return left.combatantName.localeCompare(right.combatantName, undefined, {
                    sensitivity: "base",
                  });
                },
              );
              const formattedInitiativeLines = orderedInitiativeEntries.map((entry) =>
                formatInitiativeLogEntry(entry),
              );
              setCombatEngineLogEntries(
                [
                  ...orderedInitiativeEntries.map((entry) => ({
                    id: crypto.randomUUID(),
                    text: formatInitiativeLogEntry(entry),
                  })),
                  ...("adapterDebug" in startData && startData.adapterDebug
                    ? [
                        {
                          id: crypto.randomUUID(),
                          text: `[Adapter] ${String((startData.adapterDebug as { profile?: string }).profile ?? "unknown")} (${String((startData.adapterDebug as { ruleset?: string }).ruleset ?? "unknown ruleset")})`,
                        },
                      ]
                    : []),
                ],
              );
              setMessages((prev) => [
                ...prev,
                {
                  speakerName: "GM",
                  role: "gm",
                  content: `INITIATIVE\n${formattedInitiativeLines
                    .map((line) => `- ${line}`)
                    .join("\n")}`,
                },
              ]);
            }

            const finalCombatState = await runEngineAutoTurns(startedCombatState);
            await maybeAutoEndEngineCombatFromState(finalCombatState);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      } finally {
        setLoading(false);
    }
  }

  function handleMainCharacterCreated(params: {
    character: Record<string, unknown>;
  }) {
    const createdCharacter = params.character as CampaignCharacter;
    setCampaign((currentCampaign) => {
      if (!currentCampaign) {
        return currentCampaign;
      }

      return {
        ...currentCampaign,
        characters: upsertMainCharacter(currentCampaign.characters, createdCharacter),
      };
    });
  }

  async function handleScenarioAction() {
    if (!campaignId || needsCharacterGeneration || isTogglingScenario) {
      return;
    }

    setIsUtilityMenuOpen(false);

    setConfirmationState({
      kind: "reset",
      title: "Confirmation",
      message: "Reset the scenario and clear chat history after the opening scene?",
      confirmLabel: "Reset",
    });
    return;
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
          action: "reset",
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
      const selectedCharacter =
        (campaign?.characters ?? []).find((character) => character.id === sceneImageCharacterId) ??
        null;
      const imageMeta = buildSceneImageGenerationMeta({
        promptType: sceneImagePromptType,
        ruleset: campaign?.ruleset ?? "D&D 5e",
        campaignTitle: campaign?.title ?? "Campaign",
        sceneSummary: buildSceneSummary(campaign, messages),
        selectedCharacter,
      });
      const combinedScenePrompt = buildSceneImagePromptFromSections({
        instructions: sceneImageInstructions,
        customDescription: sceneImageCustomDescription,
        styleDescription: sceneImageStyleDescription,
      });
      const parsedImageSeed = sceneImageSeedInput.trim()
        ? Number(sceneImageSeedInput.trim())
        : null;
      const imageSeed =
        parsedImageSeed !== null && Number.isFinite(parsedImageSeed)
          ? Math.trunc(parsedImageSeed)
          : undefined;
      const res = await fetch(`/api/campaigns/${campaignId}/map`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          scenePrompt: combinedScenePrompt,
          imageType: sceneImagePromptType,
          imageStyle: formatSceneImageStylePresetLabel(sceneImageStylePreset),
          imageTitle: imageMeta.title,
          imageSubtitle: imageMeta.subtitle,
          imageAspectRatio: sceneImageAspectRatio,
          imageSeed,
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
      setActiveSceneImageTab("saved");
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
    if (worldMapViewerSuppressClickRef.current) {
      worldMapViewerSuppressClickRef.current = false;
      return;
    }
    if (
      !worldMapViewerPinPlacementMode ||
      worldMapViewerZoomBoxMode ||
      worldMapViewerZoomBoxRect
    ) {
      return;
    }
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

  function handleWorldMapViewerWheel(event: ReactWheelEvent<HTMLDivElement>) {
    if (!event.ctrlKey) {
      return;
    }
    event.preventDefault();
    const container = worldMapViewerScrollRef.current;
    if (!container) {
      return;
    }

    const zoomDelta =
      event.deltaY < 0 ? WORLD_MAP_VIEWER_ZOOM_STEP : -WORLD_MAP_VIEWER_ZOOM_STEP;
    const currentZoom = worldMapViewerZoom;
    const nextZoom = Math.min(
      WORLD_MAP_VIEWER_ZOOM_MAX,
      Math.max(
        WORLD_MAP_VIEWER_ZOOM_MIN,
        Math.round((currentZoom + zoomDelta) * 100) / 100,
      ),
    );
    if (nextZoom === currentZoom) {
      return;
    }

    const rect = container.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    const contentX = (container.scrollLeft + offsetX) / currentZoom;
    const contentY = (container.scrollTop + offsetY) / currentZoom;

    setWorldMapViewerZoom(nextZoom);
    requestAnimationFrame(() => {
      container.scrollLeft = contentX * nextZoom - offsetX;
      container.scrollTop = contentY * nextZoom - offsetY;
    });
  }

  function handleWorldMapViewerMouseDown(event: MouseEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }
    const target = event.target as HTMLElement | null;
    const interactive = target?.closest(
      "button,input,select,textarea,a,label",
    );
    if (interactive) {
      return;
    }
    const container = worldMapViewerScrollRef.current;
    if (!container) {
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const offsetX = Math.max(0, Math.min(container.clientWidth, event.clientX - containerRect.left));
    const offsetY = Math.max(0, Math.min(container.clientHeight, event.clientY - containerRect.top));
    if (worldMapViewerZoomBoxMode) {
      worldMapViewerZoomBoxContentStartRef.current = {
        x: (container.scrollLeft + offsetX) / worldMapViewerZoom,
        y: (container.scrollTop + offsetY) / worldMapViewerZoom,
      };
      setWorldMapViewerZoomBoxRect({
        startX: offsetX,
        startY: offsetY,
        currentX: offsetX,
        currentY: offsetY,
      });
      return;
    }

    worldMapViewerDragStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startScrollLeft: container.scrollLeft,
      startScrollTop: container.scrollTop,
      moved: false,
    };
    setIsWorldMapViewerDragging(true);
  }

  function handleWorldMapViewerMouseMove(event: MouseEvent<HTMLDivElement>) {
    if (worldMapViewerZoomBoxMode && worldMapViewerZoomBoxRect) {
      const container = worldMapViewerScrollRef.current;
      if (!container) {
        return;
      }
      const containerRect = container.getBoundingClientRect();
      const offsetX = Math.max(0, Math.min(container.clientWidth, event.clientX - containerRect.left));
      const offsetY = Math.max(0, Math.min(container.clientHeight, event.clientY - containerRect.top));
      setWorldMapViewerZoomBoxRect((current) =>
        current
          ? {
              ...current,
              currentX: offsetX,
              currentY: offsetY,
            }
          : current,
      );
      return;
    }

    const dragState = worldMapViewerDragStateRef.current;
    const container = worldMapViewerScrollRef.current;
    if (!dragState || !container) {
      return;
    }
    const deltaX = event.clientX - dragState.startX;
    const deltaY = event.clientY - dragState.startY;
    if (!dragState.moved && (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3)) {
      dragState.moved = true;
      worldMapViewerSuppressClickRef.current = true;
    }

    container.scrollLeft = dragState.startScrollLeft - deltaX;
    container.scrollTop = dragState.startScrollTop - deltaY;
  }

  function handleWorldMapViewerMouseUp() {
    if (worldMapViewerZoomBoxMode && worldMapViewerZoomBoxRect) {
      const container = worldMapViewerScrollRef.current;
      const contentStart = worldMapViewerZoomBoxContentStartRef.current;
      if (container && contentStart) {
        const minX = Math.min(worldMapViewerZoomBoxRect.startX, worldMapViewerZoomBoxRect.currentX);
        const maxX = Math.max(worldMapViewerZoomBoxRect.startX, worldMapViewerZoomBoxRect.currentX);
        const minY = Math.min(worldMapViewerZoomBoxRect.startY, worldMapViewerZoomBoxRect.currentY);
        const maxY = Math.max(worldMapViewerZoomBoxRect.startY, worldMapViewerZoomBoxRect.currentY);
        const widthPx = Math.max(1, maxX - minX);
        const heightPx = Math.max(1, maxY - minY);
        const endContentX = (container.scrollLeft + maxX) / worldMapViewerZoom;
        const endContentY = (container.scrollTop + maxY) / worldMapViewerZoom;
        const widthContent = Math.max(1, Math.abs(endContentX - contentStart.x));
        const heightContent = Math.max(1, Math.abs(endContentY - contentStart.y));

        if (widthPx >= 12 && heightPx >= 12) {
          const targetZoomX = container.clientWidth / widthContent;
          const targetZoomY = container.clientHeight / heightContent;
          const nextZoom = Math.min(
            WORLD_MAP_VIEWER_ZOOM_MAX,
            Math.max(
              WORLD_MAP_VIEWER_ZOOM_MIN,
              Math.round(Math.min(targetZoomX, targetZoomY) * 100) / 100,
            ),
          );
          const centerX = Math.min(contentStart.x, endContentX) + widthContent / 2;
          const centerY = Math.min(contentStart.y, endContentY) + heightContent / 2;
          setWorldMapViewerZoom(nextZoom);
          requestAnimationFrame(() => {
            container.scrollLeft = centerX * nextZoom - container.clientWidth / 2;
            container.scrollTop = centerY * nextZoom - container.clientHeight / 2;
          });
        }
      }
      setWorldMapViewerZoomBoxRect(null);
      worldMapViewerZoomBoxContentStartRef.current = null;
      setWorldMapViewerZoomBoxMode(false);
      return;
    }

    worldMapViewerDragStateRef.current = null;
    setIsWorldMapViewerDragging(false);
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
  function handleToggleEngineCombatMode() {
    if (!campaignId) {
      return;
    }

    setEngineCombatModeEnabled((current) => {
      const nextValue = !current;

      try {
        window.localStorage.setItem(`engine-combat-mode:${campaignId}`, String(nextValue));
      } catch {
        // Ignore local storage failures and still update in-memory state.
      }

      return nextValue;
    });
  }

  function handleToggleDeadlandsJokerEffects() {
    if (!campaignId) {
      return;
    }

    setDeadlandsJokerEffectsEnabled((current) => {
      const nextValue = !current;
      try {
        window.localStorage.setItem(
          `deadlands-joker-effects:${campaignId}`,
          String(nextValue),
        );
      } catch {
        // Ignore local storage failures and still update in-memory state.
      }
      return nextValue;
    });
  }

  function handleToggleAutoCompanionCombat() {
    if (!campaignId) {
      return;
    }

    setAutoCompanionCombatEnabled((current) => {
      const nextValue = !current;
      try {
        window.localStorage.setItem(
          `auto-companion-combat:${campaignId}`,
          String(nextValue),
        );
      } catch {
        // Ignore local storage failures and still update in-memory state.
      }
      return nextValue;
    });
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

    if (selectedSceneImageFullIndex < 0) {
      setError("Unable to find the selected scene image.");
      return;
    }

    const nextHistory = sceneImageHistory.map((image, index) =>
      index === selectedSceneImageFullIndex
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
    if (!selectedSceneImage || selectedSceneImageFullIndex < 0) {
      return;
    }

    setIsSceneImageMenuOpen(false);
    setConfirmationState({
      kind: "delete-scene-image",
      title: "Warning",
      message: `Remove the scene image "${selectedSceneImage.sceneTitle}"?`,
      confirmLabel: "Remove",
      imageIndex: selectedSceneImageFullIndex,
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
            <div className="absolute left-2 top-2 z-10 flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900/90 px-1.5 py-1">
              <button
                type="button"
                onClick={() =>
                  setWorldMapViewerZoom((current) =>
                    Math.max(
                      WORLD_MAP_VIEWER_ZOOM_MIN,
                      Math.round((current - WORLD_MAP_VIEWER_ZOOM_STEP) * 100) / 100,
                    ),
                  )
                }
                className="rounded border border-zinc-600 px-1.5 py-0.5 text-[11px] text-zinc-200 transition hover:border-zinc-400 hover:text-white"
                aria-label="Zoom out map"
              >
                -
              </button>
              <span className="min-w-[3.5rem] text-center text-[11px] text-zinc-200">
                {Math.round(worldMapViewerZoom * 100)}%
              </span>
              <button
                type="button"
                onClick={() =>
                  setWorldMapViewerZoom((current) =>
                    Math.min(
                      WORLD_MAP_VIEWER_ZOOM_MAX,
                      Math.round((current + WORLD_MAP_VIEWER_ZOOM_STEP) * 100) / 100,
                    ),
                  )
                }
                className="rounded border border-zinc-600 px-1.5 py-0.5 text-[11px] text-zinc-200 transition hover:border-zinc-400 hover:text-white"
                aria-label="Zoom in map"
              >
                +
              </button>
              <button
                type="button"
                onClick={() => setWorldMapViewerZoom(1)}
                className="rounded border border-zinc-600 px-1.5 py-0.5 text-[11px] text-zinc-200 transition hover:border-zinc-400 hover:text-white"
                aria-label="Reset map zoom"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={() => {
                  setWorldMapViewerZoomBoxMode((current) => {
                    const nextValue = !current;
                    if (nextValue) {
                      setWorldMapViewerPinPlacementMode(false);
                    }
                    return nextValue;
                  });
                  setWorldMapViewerZoomBoxRect(null);
                  worldMapViewerZoomBoxContentStartRef.current = null;
                }}
                className={`rounded border px-1.5 py-0.5 text-[11px] transition ${
                  worldMapViewerZoomBoxMode
                    ? "border-cyan-300 text-cyan-100"
                    : "border-zinc-600 text-zinc-200 hover:border-zinc-400 hover:text-white"
                }`}
                aria-label="Toggle box zoom mode"
              >
                Box Zoom
              </button>
            </div>
            <div className="flex h-full w-full flex-col gap-2 pt-8">
              <div
                ref={worldMapViewerScrollRef}
                onWheel={handleWorldMapViewerWheel}
                onMouseDown={handleWorldMapViewerMouseDown}
                onMouseMove={handleWorldMapViewerMouseMove}
                onMouseUp={handleWorldMapViewerMouseUp}
                onMouseLeave={handleWorldMapViewerMouseUp}
                className={`relative flex h-full w-full items-center justify-center overflow-auto rounded-lg border border-zinc-800 bg-zinc-900 ${
                  worldMapViewerZoomBoxMode
                    ? "cursor-crosshair"
                    : isWorldMapViewerDragging
                      ? "cursor-grabbing"
                      : "cursor-grab"
                }`}
              >
                <div
                  className="relative origin-top-left"
                  style={{ transform: `scale(${worldMapViewerZoom})` }}
                >
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
                {worldMapViewerZoomBoxRect ? (
                  <div
                    className="pointer-events-none absolute border border-cyan-300 bg-cyan-300/10"
                    style={{
                      left: `${Math.min(
                        worldMapViewerZoomBoxRect.startX,
                        worldMapViewerZoomBoxRect.currentX,
                      )}px`,
                      top: `${Math.min(
                        worldMapViewerZoomBoxRect.startY,
                        worldMapViewerZoomBoxRect.currentY,
                      )}px`,
                      width: `${Math.abs(
                        worldMapViewerZoomBoxRect.currentX - worldMapViewerZoomBoxRect.startX,
                      )}px`,
                      height: `${Math.abs(
                        worldMapViewerZoomBoxRect.currentY - worldMapViewerZoomBoxRect.startY,
                      )}px`,
                    }}
                  />
                ) : null}
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <div className="w-full text-right text-[11px] text-zinc-400">
                  Enable pin placement, then click on the map to choose a pin location.
                </div>
                <div className="w-full text-right text-[10px] text-zinc-500">
                  Ctrl + Mouse Wheel to zoom. Drag to pan. Use Box Zoom to drag a zoom rectangle.
                </div>
                <label className="inline-flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-200">
                  <input
                    type="checkbox"
                    checked={worldMapViewerPinPlacementMode}
                    onChange={(event) => {
                      const nextValue = event.target.checked;
                      setWorldMapViewerPinPlacementMode(nextValue);
                      if (nextValue) {
                        setWorldMapViewerZoomBoxMode(false);
                        setWorldMapViewerZoomBoxRect(null);
                        worldMapViewerZoomBoxContentStartRef.current = null;
                      }
                    }}
                  />
                  Enable pin placement
                </label>
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

      <DebugInspectorModal
        isOpen={isDebugInspectorOpen}
        debugEnabled={debugStateLoggingEnabled}
        onClose={() => setIsDebugInspectorOpen(false)}
        debugSnapshot={debugSnapshot}
        combatEngineLogEntries={combatEngineLogEntries}
        combatTraceEntries={combatTraceEntries}
        debugBootstrapState={debugBootstrapState}
        isLoadingDebugBootstrapState={isLoadingDebugBootstrapState}
        isApplyingDebugBootstrapAction={isApplyingDebugBootstrapAction}
        onRefreshBootstrap={() => void loadDebugBootstrapState()}
        onAdvanceClock={(clockId) =>
          void applyDebugBootstrapAction(
            { action: "advance-clock", clockId, delta: 1 },
            "Unable to advance clock.",
          )
        }
        onRevealQuest={(questId) =>
          void applyDebugBootstrapAction(
            { action: "reveal-quest", questId },
            "Unable to reveal quest.",
          )
        }
        onRevealClue={(clueId) =>
          void applyDebugBootstrapAction(
            { action: "reveal-clue", clueId },
            "Unable to reveal clue.",
          )
        }
        onSetCombatGeneration={(params) =>
          void applyDebugBootstrapAction(
            {
              action: "set-combat-generation",
              ...(params.difficultyMode
                ? { difficultyMode: params.difficultyMode }
                : {}),
              ...(params.encounterVariance
                ? { encounterVariance: params.encounterVariance }
                : {}),
            },
            "Unable to update combat generation presets.",
          )
        }
      />

      <div className="mx-auto grid max-w-[98.75rem] gap-4 overflow-x-hidden xl:grid-cols-[minmax(0,1fr)_minmax(260px,350px)] 2xl:grid-cols-[minmax(0,1fr)_minmax(340px,440px)]">
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

              <LibraryCharacterBuilder
                mode="create"
                initialRuleset={campaign.ruleset}
                rulesetOptions={[campaign.ruleset]}
                rulesetLocked
                submitUrl={`/api/campaigns/${campaign.id}/character`}
                submitMethod="POST"
                submitBodyBuilder={({ characterName, answers }) => ({
                  name: characterName,
                  slot: "main",
                  answers,
                })}
                onSubmitSuccess={({ character }) =>
                  handleMainCharacterCreated({
                    character,
                  })
                }
                redirectOnSuccess={false}
                returnTo={`/campaign/${campaign.id}`}
                backHref={`/campaign/${campaign.id}`}
                backLabel="Back"
                showBackLink={false}
                headingKicker="Main Character"
                headingTitle="Create Your Main Character"
                headingDescription="Use coach-assisted guided steps to create your campaign protagonist."
                submitLabelCreate="Generate and Save Character"
                submitLabelSavingCreate="Generating character..."
                embedded
                showHeading={false}
              />
            </div>
          ) : null}

          <section className="mb-3 rounded-xl border border-zinc-800 bg-zinc-950/80 p-3.5">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                Scene
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
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
              </div>
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
              </div>
            <div className="mt-2 text-sm font-semibold text-zinc-100">
              {buildResolvedSceneHeading(sceneSummary)}
            </div>
            <div className="mt-2 text-sm text-emerald-100">
              <span className="font-medium text-emerald-300/80">Goal:</span>{" "}
              {sceneSummary.goal}
            </div>
          </section>

            <div
              ref={chatScrollContainerRef}
              onScroll={(event) => {
                if (!followChatLive) {
                  return;
                }
                const node = event.currentTarget;
                const distanceFromBottom =
                  node.scrollHeight - node.scrollTop - node.clientHeight;
                setChatAutoScrollPaused(distanceFromBottom > 72);
              }}
              className={`overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950 p-3 space-y-3 ${
                engineCombatUiLocked ? "h-[60vh]" : "h-[50vh]"
              }`}
            >
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
                <MessageBody
                  role={msg.role}
                  content={msg.content}
                  suppressChoiceList={
                    msg.role === "gm" &&
                    (engineCombatUiLocked ||
                      (engineCombatModeEnabled &&
                        /\b(?:combat\s+begins?|combat\s+is\s+now\s+active|combat\s+active|initiative)\b/i.test(
                          msg.content,
                        )))
                  }
                />
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
          <div className="mt-2 flex h-5 items-center justify-between gap-2 text-[11px] text-zinc-400">
            <label className="inline-flex items-center gap-2 whitespace-nowrap">
              <input
                type="checkbox"
                checked={followChatLive}
                onChange={(event) => {
                  setFollowChatLive(event.target.checked);
                  if (event.target.checked) {
                    setChatAutoScrollPaused(false);
                    const node = chatScrollContainerRef.current;
                    if (node) {
                      node.scrollTop = node.scrollHeight;
                    }
                  }
                }}
              />
              Follow latest chat
            </label>
            {followChatLive && chatAutoScrollPaused ? (
              <button
                type="button"
                onClick={() => {
                  setChatAutoScrollPaused(false);
                  const node = chatScrollContainerRef.current;
                  if (node) {
                    node.scrollTop = node.scrollHeight;
                  }
                }}
                className="h-5 shrink-0 whitespace-nowrap rounded-md border border-zinc-700 bg-zinc-900 px-2 text-[11px] text-zinc-200 transition hover:border-zinc-500"
              >
                Jump to latest
              </button>
            ) : null}
          </div>

          <form onSubmit={handleSubmit} onKeyDown={handleCombatControlsKeyDown} className="mt-2 space-y-2">
            {false && engineCombatUiLocked ? (
              <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-2.5">
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-1.5">
                  <div className="flex items-center gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-cyan-100">
                      Engine Combat Controls
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        handleCombatEngineSubmit({
                          kind: combatActionKind,
                          targetRef: combatActionTargetRef,
                        })
                      }
                      disabled={Boolean(combatSubmitDisabledReason)}
                      className="rounded-xl border border-emerald-300/60 bg-emerald-300/25 px-2.5 py-1 text-[11px] font-semibold text-emerald-50 transition hover:border-emerald-200 hover:bg-emerald-300/35 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isSubmittingCombatAction ? "Resolving..." : "Confirm"}
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-1 text-[10px] text-cyan-100/90">
                    <span className="rounded-md border border-cyan-400/30 bg-cyan-400/10 px-1.5 py-0.5">
                      Round {combatState.round}
                    </span>
                    <span className="rounded-md border border-cyan-400/30 bg-cyan-400/10 px-1.5 py-0.5">
                      Active: {combatActiveEntry?.name ?? "Unknown"}
                    </span>
                    <span className="rounded-md border border-cyan-400/30 bg-cyan-400/10 px-1.5 py-0.5">
                      Next: {nextCombatEntry?.name ?? "Unknown"}
                    </span>
                  </div>
                </div>
                <div className="mb-1.5 flex flex-wrap gap-1">
                  {(
                    combatActiveEntry?.statusDurations?.map((duration) => ({
                      key: `${duration.effect}-${duration.source ?? "self"}`,
                      label: `${duration.effect}${duration.source ? `:${duration.source}` : ""} (${duration.remainingRounds}r)`,
                    })) ??
                    combatActiveEntry?.statusEffects?.map((effect) => ({
                      key: effect,
                      label: effect,
                    })) ??
                    []
                  ).slice(0, 6).map((entry) => (
                    <span
                      key={entry.key}
                      title={entry.label}
                      className="rounded-full border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-200"
                    >
                      {entry.label}
                    </span>
                  ))}
                </div>

                {pendingReaction ? (
                  <div className="sticky top-0 z-10 mb-1.5 rounded-lg border border-amber-400/30 bg-amber-400/10 p-1.5">
                    <p className="text-[11px] font-medium text-amber-100">
                      Reaction Pending ({reactionElapsedSeconds}s): {pendingReaction.targetName} can use Shield.
                    </p>
                    {pendingReaction.detail ? (
                      <p className="mt-1 text-[11px] text-amber-100/90">{pendingReaction.detail}</p>
                    ) : null}
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => void handleResolvePendingReaction("use-shield")}
                        disabled={isSubmittingCombatAction || isAutoResolvingCombat || loading}
                        className="rounded-lg border border-cyan-300/40 bg-cyan-300/10 px-2.5 py-1.5 text-[11px] font-medium text-cyan-100 transition hover:border-cyan-300/70 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Use Shield (R)
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleResolvePendingReaction("decline")}
                        disabled={isSubmittingCombatAction || isAutoResolvingCombat || loading}
                        className="rounded-lg border border-zinc-500/40 bg-zinc-500/10 px-2.5 py-1.5 text-[11px] font-medium text-zinc-100 transition hover:border-zinc-300/70 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Decline (Esc)
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="grid gap-1.5 md:grid-cols-2">
                  <div className="rounded-lg border border-zinc-700 bg-zinc-950/70 p-1.5">
                    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                      Action
                    </label>
                    <select
                      value={combatActionKind}
                      onChange={(event) =>
                        setCombatActionKind(event.target.value as CombatActionKind)
                      }
                      disabled={isSubmittingCombatAction || isAutoResolvingCombat || loading}
                      className="w-full min-w-0 rounded-xl border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-[11px] text-zinc-200 outline-none focus:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {combatActionOptions.map((option, index) => (
                        <option key={option.kind} value={option.kind}>
                          {index + 1}. {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="rounded-lg border border-zinc-700 bg-zinc-950/70 p-1.5">
                    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                      Target
                    </label>
                    <select
                      value={combatActionTargetRef}
                      onChange={(event) => setCombatActionTargetRef(event.target.value)}
                      disabled={
                        (combatActionKind !== "attack" && combatActionKind !== "cast-spell") ||
                        isSubmittingCombatAction ||
                        combatLegalTargets.length === 0
                      }
                      className="w-full min-w-0 rounded-xl border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-[11px] text-zinc-200 outline-none focus:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {combatActionKind !== "attack" && combatActionKind !== "cast-spell" ? (
                        <option value="">No target required</option>
                      ) : combatLegalTargets.length === 0 ? (
                        <option value="">No valid targets</option>
                      ) : (
                        combatLegalTargets.map((entry) => (
                          <option key={entry.id ?? entry.name} value={entry.id ?? entry.name}>
                            {entry.name} {entry.hp ? `(${entry.hp})` : ""}
                          </option>
                        ))
                      )}
                    </select>
                  </div>
                  <div className="rounded-lg border border-zinc-700 bg-zinc-950/70 p-1.5">
                    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                      Attack / Spell
                    </label>
                    <select
                      value={combatAttackPresetId}
                      onChange={(event) => setCombatAttackPresetId(event.target.value)}
                      disabled={
                        (combatActionKind !== "attack" && combatActionKind !== "cast-spell") ||
                        isSubmittingCombatAction ||
                        isAutoResolvingCombat ||
                        loading
                      }
                      className="w-full min-w-0 rounded-xl border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-[11px] text-zinc-200 outline-none focus:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {combatActionPresets
                        .filter((preset) =>
                          combatActionKind === "cast-spell"
                            ? preset.category === "spell"
                            : combatActionKind === "attack"
                              ? preset.category === "weapon"
                              : false,
                        )
                        .map((preset) => (
                          <option key={preset.id} value={preset.id}>
                            {preset.label}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="rounded-lg border border-zinc-700 bg-zinc-950/70 p-1.5">
                    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                      Modifiers
                    </label>
                    <select
                      value={combatSpellSlotLevel}
                      onChange={(event) => setCombatSpellSlotLevel(event.target.value)}
                      disabled={
                        combatActionKind !== "cast-spell" ||
                        !selectedCombatSpellConsumesSlot ||
                        isSubmittingCombatAction ||
                        isAutoResolvingCombat ||
                        loading
                      }
                      className="w-full min-w-0 rounded-xl border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-[11px] text-zinc-200 outline-none focus:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {combatActionKind !== "cast-spell" ? (
                        <option value="">No slot needed</option>
                      ) : !selectedCombatSpellConsumesSlot ? (
                        <option value="">Cantrip (no slot)</option>
                      ) : availableSpellSlotLevels.length === 0 ? (
                        <option value="">No spell slots</option>
                      ) : (
                        availableSpellSlotLevels.map((slotLevel) => (
                          <option key={slotLevel} value={slotLevel}>
                            {slotLevel}
                          </option>
                        ))
                      )}
                    </select>
                  </div>
                </div>

                <div className="mt-1.5 rounded-lg border border-zinc-700 bg-zinc-950/70 p-1.5 text-[11px] text-zinc-200">
                  <div className="font-semibold uppercase tracking-[0.12em] text-zinc-400">
                    Rule Preview
                  </div>
                  <p className="mt-1">{selectedActionRulePreview ?? "No preview available."}</p>
                </div>

                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {combatSubmitDisabledReason ? (
                    <span className="self-center text-[11px] text-amber-100/85">
                      {combatSubmitDisabledReason}
                    </span>
                  ) : null}
                </div>

                {isAutoResolvingCombat ? (
                  <p className="mt-1.5 text-[11px] text-cyan-100/90">
                    Resolving companion/enemy turns...
                  </p>
                ) : null}

                {lastCombatResolution ? (
                  <div className="mt-2 rounded-lg border border-zinc-700 bg-zinc-950/70 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                        Last Resolution
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setShowLastResolutionDetails((current) => !current)}
                          className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[10px] text-zinc-200"
                        >
                          {showLastResolutionDetails ? "Hide" : "Details"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setIsDebugInspectorOpen(true);
                            setDebugStateLoggingEnabled(true);
                          }}
                          className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[10px] text-zinc-200"
                        >
                          Open Trace
                        </button>
                      </div>
                    </div>
                    <p className="mt-1 text-[11px] text-zinc-200">{lastCombatResolution.narration}</p>
                    {showLastResolutionDetails ? (
                      <pre className="mt-2 max-h-48 overflow-auto rounded-md border border-zinc-800 bg-zinc-950 p-2 text-[10px] leading-4 text-zinc-300">
                        {JSON.stringify(lastCombatResolution.resolution, null, 2)}
                      </pre>
                    ) : null}
                  </div>
                ) : null}

              </div>
            ) : null}
            {!engineCombatUiLocked &&
            lastCombatResolution &&
            lastCombatResolution.resolution.combatEnded === true ? (
              <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-100">
                  Combat Outcome
                </div>
                <p className="mt-1 text-sm text-emerald-50">{lastCombatResolution.narration}</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {[
                    "Stabilize the party and assess injuries.",
                    "Search the area for clues and valuables.",
                    "Question survivors or witnesses for leads.",
                    "Choose the party's next objective.",
                  ].map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => setInput(suggestion)}
                      className="rounded-lg border border-emerald-300/30 bg-emerald-300/10 px-2.5 py-1.5 text-left text-[11px] text-emerald-100 transition hover:border-emerald-300/60"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {!engineCombatUiLocked ? (
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={isChatLocked}
                placeholder={
                  needsCharacterGeneration
                    ? "Generate your main character to begin."
                    : "Type your action..."
                }
                className="min-h-[84px] w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2.5 outline-none focus:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-60"
              />
            ) : null}

            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={
                    loading || !input.trim() || isChatLocked || engineCombatUiLocked
                  }
                  className="rounded-xl bg-zinc-100 px-4 py-2 font-medium text-zinc-900 disabled:opacity-50"
                >
                  {engineCombatUiLocked ? "Combat Mode" : "Send"}
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
                              needsCharacterGeneration ||
                              isTogglingScenario ||
                              loading
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
                          <button
                            type="button"
                            onClick={handleToggleEngineCombatMode}
                            className={`block w-full rounded-lg px-3 py-2 text-left text-sm transition hover:bg-zinc-900 ${
                              engineCombatModeEnabled
                                ? "text-cyan-100"
                                : "text-zinc-200"
                            }`}
                          >
                            Engine Combat {engineCombatModeEnabled ? "On" : "Off"}
                          </button>
                          <button
                            type="button"
                            onClick={handleToggleAutoCompanionCombat}
                            className={`block w-full rounded-lg px-3 py-2 text-left text-sm transition hover:bg-zinc-900 ${
                              autoCompanionCombatEnabled
                                ? "text-cyan-100"
                                : "text-zinc-200"
                            }`}
                          >
                            Auto Companion Combat {autoCompanionCombatEnabled ? "On" : "Off"}
                          </button>
                          {campaign.ruleset.trim().toLowerCase().includes("deadlands") ? (
                            <button
                              type="button"
                              onClick={handleToggleDeadlandsJokerEffects}
                              className={`block w-full rounded-lg px-3 py-2 text-left text-sm transition hover:bg-zinc-900 ${
                                deadlandsJokerEffectsEnabled
                                  ? "text-emerald-100"
                                  : "text-zinc-200"
                              }`}
                            >
                              Joker Effects {deadlandsJokerEffectsEnabled ? "On" : "Off"}
                            </button>
                          ) : null}
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
                          {isDevBuild && mainCharacter ? (
                            <button
                              type="button"
                              onClick={() => {
                                setIsUtilityMenuOpen(false);
                                void handleDeleteCharacter(mainCharacter);
                              }}
                              disabled={Boolean(deletingCharacterId)}
                              className="block w-full rounded-lg px-3 py-2 text-left text-sm text-amber-200 transition hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              DEV: Clear Main Character
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
            <div className="flex min-h-0 flex-col gap-2">
              {engineCombatUiLocked && !detailCardId ? (
                <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-2.5">
                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-1.5">
                    <div className="flex items-center gap-2">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-cyan-100">
                        Engine Combat Controls
                      </p>
                      <button
                        type="button"
                        onClick={() =>
                          handleCombatEngineSubmit({
                            kind: combatActionKind,
                            targetRef: combatActionTargetRef,
                          })
                        }
                        disabled={Boolean(combatSubmitDisabledReason)}
                        className="rounded-xl border border-emerald-300/60 bg-emerald-300/25 px-2.5 py-1 text-[11px] font-semibold text-emerald-50 transition hover:border-emerald-200 hover:bg-emerald-300/35 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isSubmittingCombatAction ? "Resolving..." : "Confirm"}
                      </button>
                    </div>
                    <div className="rounded-md border border-cyan-400/30 bg-cyan-400/10 px-1.5 py-0.5 text-[10px] text-cyan-100/90">
                      Round {combatState.round}
                    </div>
                  </div>
                  {pendingReaction ? (
                    <div className="mb-1.5 rounded-lg border border-amber-400/30 bg-amber-400/10 p-1.5">
                      <p className="text-[11px] font-medium text-amber-100">
                        Reaction Pending ({reactionElapsedSeconds}s): {pendingReaction.targetName} can use Shield.
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => void handleResolvePendingReaction("use-shield")}
                          disabled={isSubmittingCombatAction || isAutoResolvingCombat || loading}
                          className="rounded-lg border border-cyan-300/40 bg-cyan-300/10 px-2.5 py-1.5 text-[11px] font-medium text-cyan-100 transition hover:border-cyan-300/70 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Use Shield (R)
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleResolvePendingReaction("decline")}
                          disabled={isSubmittingCombatAction || isAutoResolvingCombat || loading}
                          className="rounded-lg border border-zinc-500/40 bg-zinc-500/10 px-2.5 py-1.5 text-[11px] font-medium text-zinc-100 transition hover:border-zinc-300/70 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Decline (Esc)
                        </button>
                      </div>
                    </div>
                  ) : null}
                  <div className="grid gap-1.5">
                    <select
                      value={combatActionKind}
                      onChange={(event) => setCombatActionKind(event.target.value as CombatActionKind)}
                      disabled={isSubmittingCombatAction || isAutoResolvingCombat || loading}
                      className="w-full min-w-0 rounded-xl border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-[11px] text-zinc-200 outline-none focus:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {combatActionOptions.map((option, index) => (
                        <option key={option.kind} value={option.kind}>
                          {index + 1}. {option.label}
                        </option>
                      ))}
                    </select>
                    <select
                      value={combatActionTargetRef}
                      onChange={(event) => setCombatActionTargetRef(event.target.value)}
                      disabled={
                        (combatActionKind !== "attack" && combatActionKind !== "cast-spell") ||
                        isSubmittingCombatAction ||
                        combatLegalTargets.length === 0
                      }
                      className="w-full min-w-0 rounded-xl border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-[11px] text-zinc-200 outline-none focus:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {combatActionKind !== "attack" && combatActionKind !== "cast-spell" ? (
                        <option value="">No target required</option>
                      ) : combatLegalTargets.length === 0 ? (
                        <option value="">No valid targets</option>
                      ) : (
                        combatLegalTargets.map((entry) => (
                          <option key={entry.id ?? entry.name} value={entry.id ?? entry.name}>
                            {entry.name} {entry.hp ? `(${entry.hp})` : ""}
                          </option>
                        ))
                      )}
                    </select>
                    <select
                      value={combatAttackPresetId}
                      onChange={(event) => setCombatAttackPresetId(event.target.value)}
                      disabled={
                        (combatActionKind !== "attack" && combatActionKind !== "cast-spell") ||
                        isSubmittingCombatAction ||
                        isAutoResolvingCombat ||
                        loading
                      }
                      className="w-full min-w-0 rounded-xl border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-[11px] text-zinc-200 outline-none focus:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {combatActionPresets
                        .filter((preset) =>
                          combatActionKind === "cast-spell"
                            ? preset.category === "spell"
                            : combatActionKind === "attack"
                              ? preset.category === "weapon"
                              : false,
                        )
                        .map((preset) => (
                          <option key={preset.id} value={preset.id}>
                            {preset.label}
                          </option>
                        ))}
                    </select>
                    <select
                      value={combatSpellSlotLevel}
                      onChange={(event) => setCombatSpellSlotLevel(event.target.value)}
                      disabled={
                        combatActionKind !== "cast-spell" ||
                        !selectedCombatSpellConsumesSlot ||
                        isSubmittingCombatAction ||
                        isAutoResolvingCombat ||
                        loading
                      }
                      className="w-full min-w-0 rounded-xl border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-[11px] text-zinc-200 outline-none focus:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {combatActionKind !== "cast-spell" ? (
                        <option value="">No slot needed</option>
                      ) : !selectedCombatSpellConsumesSlot ? (
                        <option value="">Cantrip (no slot)</option>
                      ) : availableSpellSlotLevels.length === 0 ? (
                        <option value="">No spell slots</option>
                      ) : (
                        availableSpellSlotLevels.map((slotLevel) => (
                          <option key={slotLevel} value={slotLevel}>
                            {slotLevel}
                          </option>
                        ))
                      )}
                    </select>
                  </div>
                  <p className="mt-1 text-[11px] text-zinc-300">
                    {selectedActionRulePreview ?? "No preview available."}
                  </p>
                </div>
              ) : null}
              <div
                className={`min-h-0 flex-1 overflow-y-auto pr-1 ${
                  detailCardId
                    ? "max-h-[calc(100vh-10.5rem)]"
                    : engineCombatUiLocked
                    ? "max-h-[calc(100vh-16rem-8vh)]"
                    : "max-h-[calc(100vh-10.5rem)]"
                }`}
              >
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
                          preferCollapsedDetailOpen={combatActive}
                          initiativeOrder={index + 1}
                          isActiveTurn={entry.active}
                          reactionStatus={getCombatReactionStatus(combatState, linkedCharacter)}
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
                        campaignRuleset={campaign?.ruleset ?? ""}
                      />
                    );
                  })}
                </div>
              ) : (
                <div
                  className={`grid gap-2 text-xs text-zinc-300 ${
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
                      preferCollapsedDetailOpen={combatActive}
                      initiativeOrder={getCharacterInitiativeOrder(combatState, mainCharacter)}
                      isActiveTurn={isCombatantActive(combatState, mainCharacter)}
                      reactionStatus={getCombatReactionStatus(combatState, mainCharacter)}
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
                        const isClosingDetail = detailCardId === mainCharacter.id;
                        setCollapsedCards((current) => ({
                          ...current,
                          [mainCharacter.id]: isClosingDetail ? combatActive : false,
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
                        preferCollapsedDetailOpen={combatActive}
                        initiativeOrder={getCharacterInitiativeOrder(combatState, character)}
                        isActiveTurn={isCombatantActive(combatState, character)}
                        reactionStatus={getCombatReactionStatus(combatState, character)}
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
                          const isClosingDetail = detailCardId === character.id;
                          setCollapsedCards((current) => ({
                            ...current,
                            [character.id]: isClosingDetail ? combatActive : false,
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
                        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                            Campaign
                          </div>
                          <div className="mt-2 space-y-2 text-xs text-zinc-300">
                            <div>
                              <span className="text-zinc-400">Objective:</span>{" "}
                              {bootstrapObjective || "No objective set."}
                            </div>
                            <div>
                              <div className="text-zinc-400">Known Quests:</div>
                              {bootstrapKnownQuests.length > 0 ? (
                                <ul className="mt-1 space-y-1 text-zinc-300">
                                  {bootstrapKnownQuests.map((quest) => (
                                    <li key={quest.id} className="rounded border border-zinc-800 px-2 py-1">
                                      <div className="font-medium">
                                        {quest.title}
                                        {quest.status ? ` (${quest.status})` : ""}
                                      </div>
                                      {quest.objective ? (
                                        <div className="text-[11px] text-zinc-400">
                                          {quest.objective}
                                        </div>
                                      ) : null}
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <div className="mt-1 text-zinc-500">No known quests yet.</div>
                              )}
                            </div>
                            <div>
                              <div className="text-zinc-400">Rumors (Teased Hooks):</div>
                              {bootstrapRumorQuests.length > 0 ? (
                                <ul className="mt-1 list-disc pl-4 text-zinc-300">
                                  {bootstrapRumorQuests.map((quest) => (
                                    <li key={quest.id}>{quest.title}</li>
                                  ))}
                                </ul>
                              ) : (
                                <div className="mt-1 text-zinc-500">No teased hooks right now.</div>
                              )}
                            </div>
                            <div>
                              <div className="text-zinc-400">Visible Clocks:</div>
                              {bootstrapVisibleClocks.length > 0 ? (
                                <ul className="mt-1 list-disc pl-4 text-zinc-300">
                                  {bootstrapVisibleClocks.map((clock) => (
                                    <li key={clock.id}>
                                      {clock.name}: {clock.current}/{clock.max}
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <div className="mt-1 text-zinc-500">No visible clocks yet.</div>
                              )}
                            </div>
                            <div>
                              <div className="text-zinc-400">Revealed Clues:</div>
                              {bootstrapRevealedClues.length > 0 ? (
                                <ul className="mt-1 list-disc pl-4 text-zinc-300">
                                  {bootstrapRevealedClues.map((clue) => (
                                    <li key={clue.id}>{clue.text}</li>
                                  ))}
                                </ul>
                              ) : (
                                <div className="mt-1 text-zinc-500">No revealed clues yet.</div>
                              )}
                            </div>
                            <div>
                              <div className="text-zinc-400">Expansion Events:</div>
                              {bootstrapExpansionEvents.length > 0 ? (
                                <>
                                <div className="mt-1 text-[11px] text-zinc-500">
                                  Showing latest 8 events.
                                </div>
                                <ul className="mt-1 space-y-1 text-zinc-300">
                                  {bootstrapExpansionEvents
                                    .slice()
                                    .reverse()
                                    .slice(0, 8)
                                    .map((event) => (
                                      <li key={event.id} className="rounded border border-zinc-800 px-2 py-1">
                                        <div className="flex items-center justify-between gap-2 text-[11px] uppercase tracking-wide text-zinc-500">
                                          <span>{event.kind.replace(/_/g, " ")}</span>
                                          <span className="normal-case tracking-normal text-zinc-400">
                                            {new Date(event.createdAt).toLocaleString()}
                                          </span>
                                        </div>
                                        <div>{event.text}</div>
                                      </li>
                                    ))}
                                </ul>
                                </>
                              ) : (
                                <div className="mt-1 text-zinc-500">No expansion events yet.</div>
                              )}
                            </div>
                          </div>
                        </div>
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
                <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-900 p-1">
                  <button
                    type="button"
                    onClick={() => setActiveSceneImageTab("saved")}
                    className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                      activeSceneImageTab === "saved"
                        ? "bg-zinc-800 text-white"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    Saved
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveSceneImageTab("add")}
                    className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                      activeSceneImageTab === "add"
                        ? "bg-zinc-800 text-white"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    Add
                  </button>
                </div>
                {activeSceneImageTab === "saved" ? (
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                        FILTER TYPE
                      </label>
                      <select
                        value={sceneImageSavedTypeFilter}
                        onChange={(event) =>
                          setSceneImageSavedTypeFilter(event.target.value as SceneImageTypeFilter)
                        }
                        className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-600"
                      >
                        <option value="all">All</option>
                        <option value="scene">Scene</option>
                        <option value="portrait">Portrait</option>
                        <option value="character">Character</option>
                        <option value="action">Action</option>
                        <option value="character-token">Character Token</option>
                      </select>
                    </div>
                    {selectedSceneImage ? (
                      <>
                        <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 px-3 py-2.5">
                      <div className="flex items-start justify-between gap-3">
                        <button
                          type="button"
                          onClick={() =>
                            setActiveSceneImageIndex(() => {
                              if (selectedSceneImageFilteredIndex <= 0) {
                                return selectedSceneImageFullIndex;
                              }
                              const prevFiltered =
                                filteredSceneImageHistory[selectedSceneImageFilteredIndex - 1];
                              const prevIndex = sceneImageHistory.indexOf(prevFiltered);
                              return prevIndex >= 0 ? prevIndex : selectedSceneImageFullIndex;
                            })
                          }
                          disabled={selectedSceneImageFilteredIndex <= 0}
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
                              <div className="mt-1 flex flex-wrap items-center justify-center gap-1">
                                <span className="rounded-full border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-300">
                                  {formatSceneImagePromptTypeLabel(
                                    selectedSceneImage.imageType ?? "scene",
                                  )}
                                </span>
                                <span className="rounded-full border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-300">
                                  {selectedSceneImage.imageStyle || "Fantasy Illustration"}
                                </span>
                              </div>
                            </>
                          )}
                          <div className="mt-1 text-[10px] text-zinc-600">
                            {selectedSceneImageFilteredIndex + 1} / {filteredSceneImageHistory.length}
                          </div>
                        </div>
                        <div className="relative flex items-start gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setActiveSceneImageIndex(() => {
                                const maxIndex = filteredSceneImageHistory.length - 1;
                                if (selectedSceneImageFilteredIndex >= maxIndex) {
                                  return selectedSceneImageFullIndex;
                                }
                                const nextFiltered =
                                  filteredSceneImageHistory[selectedSceneImageFilteredIndex + 1];
                                const nextIndex = sceneImageHistory.indexOf(nextFiltered);
                                return nextIndex >= 0 ? nextIndex : selectedSceneImageFullIndex;
                              })
                            }
                            disabled={
                              selectedSceneImageFilteredIndex >= filteredSceneImageHistory.length - 1
                            }
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
                      </>
                    ) : (
                      <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-4 text-sm text-zinc-400">
                        {sceneImageSavedTypeFilter === "all"
                          ? "No saved scene images yet. Use the Add tab to generate one."
                          : "No saved scene images match this filter. Try All or generate this image type."}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="mt-3 space-y-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                      Image Generation
                    </div>
                    <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-[11px] text-zinc-400">
                      Generate an image by combining Instructions + Custom Description + Style Description.
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div className="space-y-1">
                        <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                          TYPE
                        </label>
                        <select
                          value={sceneImagePromptType}
                          onChange={(event) =>
                            setSceneImagePromptType(event.target.value as SceneImagePromptType)
                          }
                          className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 outline-none focus:border-zinc-600"
                        >
                          <option value="scene">Scene</option>
                          <option value="portrait">Portrait</option>
                          <option value="character">Character</option>
                          <option value="action">Action</option>
                          <option value="character-token">Character Token</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                          STYLE
                        </label>
                        <select
                          value={sceneImageStylePreset}
                          onChange={(event) =>
                            setSceneImageStylePreset(event.target.value as SceneImageStylePreset)
                          }
                          disabled={sceneImagePromptType === "character-token"}
                          className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 outline-none focus:border-zinc-600"
                        >
                          <option value="cinematic-realism">Cinematic Realism</option>
                          <option value="fantasy-illustration">Fantasy Illustration</option>
                          <option value="stone-base">Stone Base</option>
                          <option value="comic-book">Comic Book</option>
                          <option value="manga">Manga</option>
                          <option value="stylized-3d">Stylized 3D</option>
                          <option value="noir">Noir</option>
                          <option value="pulp-poster">Pulp Poster</option>
                          <option value="parchment-map">Parchment Map</option>
                          <option value="tactical-map">Tactical Map</option>
                        </select>
                      </div>
                    </div>
                    {sceneImagePromptType === "portrait" ||
                    sceneImagePromptType === "character" ||
                    sceneImagePromptType === "character-token" ? (
                      <div className="space-y-1">
                        <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                          CHARACTER
                        </label>
                        <select
                          value={sceneImageCharacterId}
                          onChange={(event) => setSceneImageCharacterId(event.target.value)}
                          className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-600"
                        >
                          {(campaign?.characters ?? []).map((character) => (
                            <option key={character.id} value={character.id}>
                              {character.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : null}
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                        INSTRUCTIONS
                      </label>
                      <textarea
                        value={sceneImageInstructions}
                        onChange={(event) => setSceneImageInstructions(event.target.value)}
                        placeholder="Primary generation instructions."
                        className="min-h-[72px] w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-600"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                        CUSTOM DESCRIPTION
                      </label>
                      <textarea
                        value={sceneImageCustomDescription}
                        onChange={(event) => setSceneImageCustomDescription(event.target.value)}
                        placeholder="Scene- or subject-specific details."
                        className="min-h-[88px] w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-600"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                        STYLE DESCRIPTION
                      </label>
                      <textarea
                        value={sceneImageStyleDescription}
                        onChange={(event) => setSceneImageStyleDescription(event.target.value)}
                        placeholder="Art style, lighting, palette, medium, and rendering tone."
                        className="min-h-[72px] w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-600"
                      />
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div className="space-y-1">
                        <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                          ASPECT RATIO
                        </label>
                        <select
                          value={sceneImageAspectRatio}
                          onChange={(event) =>
                            setSceneImageAspectRatio(event.target.value as SceneImageAspectRatio)
                          }
                          disabled={sceneImagePromptType === "character-token"}
                          className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-600"
                        >
                          <option value="landscape">Landscape (3:2)</option>
                          <option value="portrait">Portrait (2:3)</option>
                          <option value="square">Square (1:1)</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                          SEED (OPTIONAL)
                        </label>
                        <input
                          value={sceneImageSeedInput}
                          onChange={(event) =>
                            setSceneImageSeedInput(event.target.value.replace(/[^\d-]/g, ""))
                          }
                          placeholder="e.g. 12345"
                          className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-600"
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                          COMBINED PROMPT
                        </label>
                        <button
                          type="button"
                          onClick={() => setIsCombinedPromptHidden((current) => !current)}
                          className="rounded border border-zinc-700 px-2 py-0.5 text-[11px] font-medium text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100"
                        >
                          {isCombinedPromptHidden ? "Show" : "Hide"}
                        </button>
                      </div>
                      {!isCombinedPromptHidden ? (
                        <textarea
                          value={buildSceneImagePromptFromSections({
                            instructions: sceneImageInstructions,
                            customDescription: sceneImageCustomDescription,
                            styleDescription: sceneImageStyleDescription,
                          })}
                          readOnly
                          className="min-h-[110px] w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-300 outline-none"
                        />
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={handleRefreshMap}
                      disabled={
                        isRefreshingMap ||
                        !campaign ||
                        ![
                          sceneImageInstructions.trim(),
                          sceneImageCustomDescription.trim(),
                          sceneImageStyleDescription.trim(),
                        ].some(Boolean)
                      }
                      className="w-full rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-sm font-medium text-cyan-100 transition hover:border-cyan-300/60 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isRefreshingMap ? "Generating..." : "Generate"}
                    </button>
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
  preferCollapsedDetailOpen = false,
  initiativeOrder,
  isActiveTurn,
  reactionStatus,
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
  preferCollapsedDetailOpen?: boolean;
  initiativeOrder?: number;
  isActiveTurn?: boolean;
  reactionStatus?: "ready" | "used";
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
  const [expandedCharacterImage, setExpandedCharacterImage] = useState<{
    src: string;
    alt: string;
  } | null>(null);
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
    ([key]) =>
      key !== "source" &&
      key !== "concept" &&
      key !== "portraitDataUrl" &&
      key !== "tokenDataUrl",
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
  const tokenDataUrl =
    typeof character.sheetJson?.tokenDataUrl === "string"
      ? character.sheetJson.tokenDataUrl
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
        {expandedCharacterImage ? (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-2 md:p-3">
            <div className="relative h-full max-h-[96vh] w-full max-w-[96vw] rounded-lg border border-zinc-700 bg-zinc-950 p-2 md:p-3">
              <div className="mb-2 flex items-center justify-between gap-2 text-xs text-zinc-300">
                <div className="truncate">{expandedCharacterImage.alt}</div>
                <button
                  type="button"
                  onClick={() => setExpandedCharacterImage(null)}
                  className="rounded-md border border-zinc-600 px-2 py-1 text-[11px] text-zinc-200 transition hover:border-zinc-400 hover:text-white"
                >
                  Close
                </button>
              </div>
              <div className="flex h-[calc(100%-2rem)] items-center justify-center overflow-auto rounded-md border border-zinc-800 bg-black/40">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={expandedCharacterImage.src}
                  alt={expandedCharacterImage.alt}
                  className="max-h-full max-w-full object-contain"
                />
              </div>
            </div>
          </div>
        ) : null}
        <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className={`flex min-w-0 items-center gap-1.5 text-base font-medium ${cardStyles.nameClass}`}>
                <span className="truncate">{character.name}</span>
                {reactionStatus ? (
                  <span
                    className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] ${
                      reactionStatus === "used"
                        ? "border-rose-300/30 bg-rose-500/10 text-rose-200"
                        : "border-emerald-300/30 bg-emerald-500/10 text-emerald-200"
                    }`}
                    title={
                      reactionStatus === "used"
                        ? "Reaction already used this round."
                        : "Reaction available."
                    }
                  >
                    {reactionStatus === "used" ? "Rxn Used" : "Rxn Ready"}
                  </span>
                ) : null}
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

        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="relative overflow-hidden rounded-lg border border-zinc-800/70 bg-zinc-950/60">
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
            <button
              type="button"
              onClick={() =>
                setExpandedCharacterImage({
                  src: portraitDataUrl || DEFAULT_PORTRAIT_DATA_URL,
                  alt: portraitDataUrl
                    ? `${character.name} portrait`
                    : `${character.name} placeholder portrait`,
                })
              }
              className="absolute bottom-1.5 right-1.5 rounded-md border border-zinc-600 bg-zinc-900/90 p-1.5 text-zinc-100 transition hover:border-zinc-400 hover:text-white"
              aria-label="Expand portrait image"
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
          <div className="relative overflow-hidden rounded-lg border border-zinc-800/70 bg-zinc-950/60">
            <Image
              src={tokenDataUrl || DEFAULT_PORTRAIT_DATA_URL}
              alt={
                tokenDataUrl
                  ? `${character.name} token`
                  : `${character.name} placeholder token`
              }
              width={768}
              height={768}
              unoptimized
              className="h-56 w-full object-contain"
            />
            <button
              type="button"
              onClick={() =>
                setExpandedCharacterImage({
                  src: tokenDataUrl || DEFAULT_PORTRAIT_DATA_URL,
                  alt: tokenDataUrl
                    ? `${character.name} token`
                    : `${character.name} placeholder token`,
                })
              }
              className="absolute bottom-1.5 right-1.5 rounded-md border border-zinc-600 bg-zinc-900/90 p-1.5 text-zinc-100 transition hover:border-zinc-400 hover:text-white"
              aria-label="Expand token image"
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
                      key !== "portraitDataUrl" &&
                      key !== "tokenDataUrl",
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
                      key !== "portraitDataUrl" &&
                      key !== "tokenDataUrl",
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
                      key !== "portraitDataUrl" &&
                      key !== "tokenDataUrl",
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
                      key !== "portraitDataUrl" &&
                      key !== "tokenDataUrl",
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
        collapsed ? "p-2" : fullDetail ? "p-3" : "p-2"
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
                  onClick={preferCollapsedDetailOpen ? onToggleDetail : onToggle}
                  className={`rounded-md border px-1.5 py-1 text-[10px] transition ${cardStyles.toggleClass}`}
                  aria-label={
                    preferCollapsedDetailOpen
                      ? "Show full detail view"
                      : "Expand character card"
                  }
                  title={
                    preferCollapsedDetailOpen
                      ? "Show full detail view"
                      : "Expand character card"
                  }
                >
                  {preferCollapsedDetailOpen ? (
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
                  ) : (
                    "+"
                  )}
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
              <div className={`${fullDetail ? "mt-2 space-y-2" : "mt-1 space-y-1"} text-[11px]`}>
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

function getImageNarrativeTextFromMessage(message: ChatMessage) {
  const raw =
    message.role === "gm"
      ? stripVisibleSceneMetadata(message.content)
      : message.content;
  return stripNumberedOptionsFromText(raw)
    .replace(/^\s*\*{2,}\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripNumberedOptionsFromText(value: string) {
  return value
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return true;
      }
      if (/^\d+\.\s+/.test(trimmed)) {
        return false;
      }
      if (/^\*\*?\s*\d+\.\s+/.test(trimmed)) {
        return false;
      }
      if (/^numbered options\s*:?$/i.test(trimmed.replace(/\*+/g, ""))) {
        return false;
      }
      return true;
    })
    .join("\n");
}

function getCharacterPhysicalDescription(character: CampaignCharacter | null) {
  if (!character || !character.sheetJson || typeof character.sheetJson !== "object") {
    return "";
  }
  const physicalDescription = (character.sheetJson as Record<string, unknown>).physicalDescription;
  if (typeof physicalDescription === "string" && physicalDescription.trim()) {
    return physicalDescription.trim();
  }
  return "";
}

function formatSceneImageStylePresetLabel(stylePreset: SceneImageStylePreset) {
  if (stylePreset === "stone-base") {
    return "Stone Base";
  }
  if (stylePreset === "cinematic-realism") {
    return "Cinematic Realism";
  }
  if (stylePreset === "comic-book") {
    return "Comic Book";
  }
  if (stylePreset === "manga") {
    return "Manga";
  }
  if (stylePreset === "stylized-3d") {
    return "Stylized 3D";
  }
  if (stylePreset === "noir") {
    return "Noir";
  }
  if (stylePreset === "pulp-poster") {
    return "Pulp Poster";
  }
  if (stylePreset === "parchment-map") {
    return "Parchment Map";
  }
  if (stylePreset === "tactical-map") {
    return "Tactical Map";
  }
  return "Fantasy Illustration";
}

function formatSceneImagePromptTypeLabel(promptType: string) {
  const normalized = promptType.trim().toLowerCase();
  if (normalized === "portrait") {
    return "Portrait";
  }
  if (normalized === "character") {
    return "Character";
  }
  if (normalized === "action") {
    return "Action";
  }
  if (normalized === "character-token") {
    return "Character Token";
  }
  return "Scene";
}

function buildSceneImageGenerationMeta(params: {
  promptType: SceneImagePromptType;
  ruleset: string;
  campaignTitle: string;
  sceneSummary: SceneSummary;
  selectedCharacter: CampaignCharacter | null;
}) {
  const ruleset = params.ruleset.trim() || "Tabletop RPG";
  if (params.promptType === "portrait") {
    const characterName = params.selectedCharacter?.name?.trim() || "Character";
    return {
      title: `${characterName} Portrait`,
      subtitle: ruleset,
    };
  }
  if (params.promptType === "character") {
    const characterName = params.selectedCharacter?.name?.trim() || "Character";
    return {
      title: `${characterName} Full Body`,
      subtitle: ruleset,
    };
  }
  if (params.promptType === "action") {
    return {
      title: "Action Sequence",
      subtitle: params.sceneSummary.location.trim() || params.campaignTitle.trim() || ruleset,
    };
  }
  if (params.promptType === "character-token") {
    const characterName = params.selectedCharacter?.name?.trim() || "Character";
    return {
      title: `${characterName} Token`,
      subtitle: ruleset,
    };
  }
  return {
    title: params.sceneSummary.sceneTitle.trim() || "Scene",
    subtitle: params.sceneSummary.location.trim() || params.campaignTitle.trim() || ruleset,
  };
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
  suppressChoiceList = false,
}: {
  role: string;
  content: string;
  suppressChoiceList?: boolean;
}) {
  const baseContent = role === "gm" ? stripVisibleSceneMetadata(content) : content;
  const normalizedContent =
    role === "gm"
      ? normalizeChoiceTextForDisplay(formatInitiativeTextForDisplay(baseContent))
      : baseContent;
  const effectiveContent =
    role === "gm" && suppressChoiceList
      ? stripChoiceTextForDisplay(normalizedContent)
      : normalizedContent;
  const typographyClass =
    role === "gm"
      ? "text-[15px] leading-7 text-zinc-100"
      : role === "companion"
        ? "text-[14px] leading-6 text-emerald-100"
        : "text-[14px] leading-6 text-blue-50";
  const contentLines = effectiveContent
    .split("\n")
    .map((line) => line.trimEnd());

  return (
    <div className={typographyClass}>
      {contentLines.length > 0 ? (
        renderMessageLines(contentLines, role, suppressChoiceList)
      ) : (
        <p>{renderStyledText(effectiveContent)}</p>
      )}
    </div>
  );
}

function formatInitiativeTextForDisplay(text: string) {
  const initiativeMatch = text.match(/\bINITIATIVE\b/i);
  if (!initiativeMatch || initiativeMatch.index === undefined) {
    return text;
  }
  const blockStart = initiativeMatch.index;
  const prefix = text.slice(0, blockStart).trimEnd();
  const initiativeBlock = text.slice(blockStart);
  const body = initiativeBlock.replace(/^\s*INITIATIVE\s*/i, "").trim();
  if (!body) {
    return prefix ? `${prefix}\n\nINITIATIVE` : "INITIATIVE";
  }

  const entries: string[] = [];
  const rollPatterns = [
    /([^:\n]+?):\s*(?:🎲\s*)?Roll:?\s*d\d+\([^)]*\)(?:\s*\+\s*[-+]?\d+)?\s*=\s*[-+]?\d+/gi,
    /([^:\n]+?):\s*d\d+\([^)]*\)(?:\s*\+\s*[-+]?\d+)?\s*=\s*[-+]?\d+/gi,
  ];

  for (const pattern of rollPatterns) {
    let match: RegExpExecArray | null = pattern.exec(body);
    while (match) {
      entries.push(match[0].trim());
      match = pattern.exec(body);
    }
    if (entries.length >= 2) {
      break;
    }
  }

  if (entries.length < 2) {
    return text;
  }

  const formatted = `INITIATIVE\n${entries.map((entry) => `- ${entry}`).join("\n")}`;
  return prefix ? `${prefix}\n\n${formatted}` : formatted;
}

function stripChoiceTextForDisplay(text: string) {
  return text
    .split("\n")
    .map((line) => {
      const withoutHeader = line.replace(/^\s*numbered options\s*:?\s*/i, "").trimEnd();
      if (!withoutHeader.trim()) {
        return "";
      }

      if (/^\s*[1-9]\.\s+/.test(withoutHeader)) {
        return "";
      }

      const inlineChoiceStart = withoutHeader.search(/\b1\.\s+\S/);
      const hasSecondInlineChoice = /\b2\.\s+\S/.test(withoutHeader);
      if (inlineChoiceStart >= 0 && hasSecondInlineChoice) {
        return withoutHeader.slice(0, inlineChoiceStart).trimEnd();
      }

      return withoutHeader;
    })
    .filter((line) => line.trim().length > 0)
    .join("\n");
}

function renderMessageLines(lines: string[], role: string, suppressChoiceList = false) {
  const elements: React.ReactNode[] = [];
  let bufferedParagraph: string[] = [];
  let bufferedChoices: Array<{ id: string; text: string }> = [];
  let bufferedBullets: string[] = [];
  const allowChoiceList = role === "gm" && !suppressChoiceList;

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

  function flushBullets() {
    if (bufferedBullets.length === 0) {
      return;
    }

    elements.push(
      <ul key={`bullets-${elements.length}`} className="mt-3 list-disc space-y-1 pl-6">
        {bufferedBullets.map((bullet, index) => (
          <li key={`bullet-${index}`} className="pl-1 marker:text-cyan-200">
            {renderStyledText(bullet)}
          </li>
        ))}
      </ul>,
    );
    bufferedBullets = [];
  }

  lines.forEach((line) => {
    const trimmedLine = line.trim();
    const normalizedLine = trimmedLine.replace(/^\*+|\*+$/g, "").trim();
    const choiceMatch = normalizedLine.match(/^([1-9]\.)\s+(.+)$/);
    const inlineChoices = allowChoiceList
      ? Array.from(
          normalizedLine.matchAll(/([1-9]\.)\s+([\s\S]*?)(?=\s+[1-9]\.\s+|$)/g),
        ).map((match) => ({
          id: match[1],
          text: match[2].replace(/^\*+|\*+$/g, "").trim(),
        }))
      : [];
    const bulletMatch = normalizedLine.match(/^[-*]\s+(.+)$/);

    if (!trimmedLine) {
      flushParagraph();
      flushBullets();
      flushChoices();
      return;
    }

    if (allowChoiceList && inlineChoices.length >= 2) {
      flushParagraph();
      flushBullets();
      const firstNumber = Number.parseInt(inlineChoices[0].id.replace(".", ""), 10);
      const firstMarkerIndex = normalizedLine.search(/\d+\.\s+/);
      const leadingCandidate =
        firstMarkerIndex > 0
          ? normalizedLine
              .slice(0, firstMarkerIndex)
              .replace(/^\*+|\*+$/g, "")
              .trim()
          : "";
      if (
        leadingCandidate &&
        Number.isFinite(firstNumber) &&
        firstNumber > 1
      ) {
        bufferedChoices.push({
          id: `${firstNumber - 1}.`,
          text: leadingCandidate,
        });
      }
      inlineChoices.forEach((choice) => {
        if (!choice.text) {
          return;
        }
        bufferedChoices.push(choice);
      });
      return;
    }

    if (choiceMatch && allowChoiceList) {
      flushParagraph();
      flushBullets();
      bufferedChoices.push({
        id: choiceMatch[1],
        text: choiceMatch[2],
      });
      return;
    }

    if (bulletMatch) {
      flushParagraph();
      flushChoices();
      bufferedBullets.push(bulletMatch[1]);
      return;
    }

    if (/^roll:/i.test(trimmedLine)) {
      flushParagraph();
      flushBullets();
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

    flushBullets();
    flushChoices();
    bufferedParagraph.push(trimmedLine);
  });

  flushParagraph();
  flushBullets();
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

function normalizeCombatLookup(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ");
}

function mergeCampaignCharacters(
  currentCharacters: CampaignCharacter[],
  incomingCharacters: unknown,
) {
  if (!Array.isArray(incomingCharacters)) {
    return currentCharacters;
  }

  const incomingById = new Map<
    string,
    Partial<Pick<CampaignCharacter, "sheetJson" | "memorySummary" | "name">>
  >();

  for (const entry of incomingCharacters) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const typedEntry = entry as Record<string, unknown>;
    const id = typeof typedEntry.id === "string" ? typedEntry.id : "";
    if (!id) {
      continue;
    }

    incomingById.set(id, {
      sheetJson:
        "sheetJson" in typedEntry
          ? (typedEntry.sheetJson as Record<string, unknown> | null)
          : undefined,
      memorySummary:
        typeof typedEntry.memorySummary === "string"
          ? typedEntry.memorySummary
          : undefined,
      name: typeof typedEntry.name === "string" ? typedEntry.name : undefined,
    });
  }

  return currentCharacters.map((character) => {
    const patch = incomingById.get(character.id);
    if (!patch) {
      return character;
    }

    return {
      ...character,
      name: patch.name ?? character.name,
      sheetJson: patch.sheetJson ?? character.sheetJson,
      memorySummary: patch.memorySummary ?? character.memorySummary,
    };
  });
}

function extractAttackActionPresets(sheetJson: Record<string, unknown> | null): AttackActionPreset[] {
  const presets: AttackActionPreset[] = [
    {
      id: "basic",
      label: "Basic Attack",
      attackBonus: 2,
      damageDie: 8,
      damageBonus: 1,
      category: "weapon",
    },
  ];

  if (!sheetJson || typeof sheetJson !== "object" || Array.isArray(sheetJson)) {
    return presets;
  }

  const typedSheet = sheetJson as Record<string, unknown>;
  const parseNumericLike = (value: unknown) => {
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.trunc(value);
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value.trim());
      if (Number.isFinite(parsed)) {
        return Math.trunc(parsed);
      }
    }
    return null;
  };
  const collectSpellNamesFromNested = (value: unknown, names: Set<string>, depth = 0) => {
    if (depth > 6 || value == null) {
      return;
    }
    if (typeof value === "string") {
      if (value.trim()) {
        names.add(value.trim());
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        collectSpellNamesFromNested(entry, names, depth + 1);
      }
      return;
    }
    if (typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (typeof record.name === "string" && record.name.trim()) {
        names.add(record.name.trim());
      }
      for (const nestedValue of Object.values(record)) {
        collectSpellNamesFromNested(nestedValue, names, depth + 1);
      }
    }
  };
  const collectKnownSpellNames = () => {
    const names = new Set<string>();
    const push = (value: unknown) => {
      if (typeof value === "string" && value.trim()) {
        names.add(value.trim());
      }
    };
    const pushMany = (value: unknown) => {
      if (Array.isArray(value)) {
        for (const entry of value) {
          push(entry);
        }
      }
    };

    pushMany(typedSheet.spells);
    pushMany(typedSheet.spellbook);
    if (typedSheet.arcane && typeof typedSheet.arcane === "object" && !Array.isArray(typedSheet.arcane)) {
      const arcane = typedSheet.arcane as Record<string, unknown>;
      pushMany(arcane.powers);
    }
    push(typedSheet.signatureSpell);
    collectSpellNamesFromNested(typedSheet.spells, names);
    collectSpellNamesFromNested(typedSheet.knownSpells, names);
    collectSpellNamesFromNested(typedSheet.spellLevels, names);
    collectSpellNamesFromNested(typedSheet.spellcasting, names);
    collectSpellNamesFromNested(typedSheet.spellbookByLevel, names);
    collectSpellNamesFromNested(typedSheet.spellbookLevels, names);
    collectSpellNamesFromNested(typedSheet.preparedSpells, names);

    return [...names].sort((left, right) =>
      left.localeCompare(right, undefined, { sensitivity: "base" }),
    );
  };
  let hasNonBasicWeaponPreset = false;
  const formatDamageLabel = (damageDie: number, damageBonus: number) =>
    damageBonus === 0
      ? `d${damageDie}`
      : damageBonus > 0
        ? `d${damageDie}+${damageBonus}`
        : `d${damageDie}${damageBonus}`;
  const buildWeaponPresetLabel = (
    weapon: string,
    attackBonus: number,
    damageDie: number,
    damageBonus: number,
  ) =>
    `${weapon} (${formatSignedBonus(attackBonus)} to hit, ${formatDamageLabel(damageDie, damageBonus)} dmg)`;
  const inferWeaponDamage = (weaponName: string) => {
    const normalized = weaponName.trim().toLowerCase();
    if (!normalized || normalized === "none") {
      return { damageDie: 8, damageBonus: 1 };
    }
    if (/(revolver|peacemaker|schofield|pistol)/.test(normalized)) {
      return { damageDie: 6, damageBonus: 1 };
    }
    if (/(rifle|repeater|longarm|carbine)/.test(normalized)) {
      return { damageDie: 8, damageBonus: 1 };
    }
    if (/(shotgun)/.test(normalized)) {
      return { damageDie: 10, damageBonus: 0 };
    }
    if (/(knife|dagger)/.test(normalized)) {
      return { damageDie: 4, damageBonus: 1 };
    }
    if (/(saber|sword|axe|club|tomahawk)/.test(normalized)) {
      return { damageDie: 8, damageBonus: 1 };
    }
    if (/(fist|brawl|unarmed)/.test(normalized)) {
      return { damageDie: 4, damageBonus: 0 };
    }
    return { damageDie: 8, damageBonus: 1 };
  };
  const attackProfiles =
    typedSheet.attackProfiles &&
    typeof typedSheet.attackProfiles === "object" &&
    !Array.isArray(typedSheet.attackProfiles)
      ? (typedSheet.attackProfiles as Record<string, unknown>)
      : null;
  if (attackProfiles) {
    for (const [profileKey, profileValue] of Object.entries(attackProfiles)) {
      if (!profileValue || typeof profileValue !== "object" || Array.isArray(profileValue)) {
        continue;
      }
      const typedProfile = profileValue as Record<string, unknown>;
      const weapon =
        typeof typedProfile.weapon === "string" && typedProfile.weapon.trim()
          ? typedProfile.weapon.trim()
          : profileKey;
      const attackBonus =
        typeof typedProfile.attackBonus === "number" && Number.isFinite(typedProfile.attackBonus)
          ? Math.trunc(typedProfile.attackBonus)
          : 2;
      const parsedDamage = parseDamageProfileText(
        typeof typedProfile.damage === "string" ? typedProfile.damage : "",
      );

      presets.push({
        id: `profile-${profileKey}`,
        label: buildWeaponPresetLabel(
          weapon,
          attackBonus,
          parsedDamage.damageDie,
          parsedDamage.damageBonus,
        ),
        attackBonus,
        damageDie: parsedDamage.damageDie,
        damageBonus: parsedDamage.damageBonus,
        category: "weapon",
      });
      hasNonBasicWeaponPreset = true;
    }
  }

  if (!hasNonBasicWeaponPreset) {
    const fallbackAttackBonus =
      typeof typedSheet.attackBonus === "number" && Number.isFinite(typedSheet.attackBonus)
        ? Math.trunc(typedSheet.attackBonus)
        : 2;
    const fallbackWeaponNames = [
      typeof typedSheet.mainHand === "string" ? typedSheet.mainHand : "",
      typeof typedSheet.offHand === "string" ? typedSheet.offHand : "",
      typeof typedSheet.longarm === "string" ? typedSheet.longarm : "",
      typeof typedSheet.weapon === "string" ? typedSheet.weapon : "",
      ...(Array.isArray(typedSheet.weapons)
        ? typedSheet.weapons.filter(
            (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
          )
        : []),
    ]
      .map((weapon) => weapon.trim())
      .filter((weapon) => weapon && weapon.toLowerCase() !== "none");
    const uniqueWeaponNames = [...new Set(fallbackWeaponNames)];
    for (const [index, weaponName] of uniqueWeaponNames.entries()) {
      const inferredDamage = inferWeaponDamage(weaponName);
      presets.push({
        id: `profile-fallback-${index}`,
        label: buildWeaponPresetLabel(
          weaponName,
          fallbackAttackBonus,
          inferredDamage.damageDie,
          inferredDamage.damageBonus,
        ),
        attackBonus: fallbackAttackBonus,
        damageDie: inferredDamage.damageDie,
        damageBonus: inferredDamage.damageBonus,
        category: "weapon",
      });
      hasNonBasicWeaponPreset = true;
    }
  }

  if (hasNonBasicWeaponPreset) {
    const basicIndex = presets.findIndex((preset) => preset.id === "basic");
    if (basicIndex >= 0) {
      presets.splice(basicIndex, 1);
    }
  }

  const spellAttackBonus =
    parseNumericLike(typedSheet.spellAttackBonus) ??
    parseNumericLike(typedSheet.spellAttack) ??
    parseNumericLike(typedSheet.spell_attack_bonus) ??
    parseNumericLike(
      typedSheet.spellcasting &&
        typeof typedSheet.spellcasting === "object" &&
        !Array.isArray(typedSheet.spellcasting)
        ? (typedSheet.spellcasting as Record<string, unknown>).attackBonus
        : null,
    ) ??
    parseNumericLike(
      typedSheet.spellcasting &&
        typeof typedSheet.spellcasting === "object" &&
        !Array.isArray(typedSheet.spellcasting)
        ? (typedSheet.spellcasting as Record<string, unknown>).attack
        : null,
    );
  const spellSaveDc =
    parseNumericLike(typedSheet.spellSaveDc) ??
    parseNumericLike(typedSheet.spellSaveDC) ??
    parseNumericLike(typedSheet.spellDC) ??
    parseNumericLike(typedSheet.saveDc) ??
    parseNumericLike(typedSheet.spell_save_dc) ??
    parseNumericLike(
      typedSheet.spellcasting &&
        typeof typedSheet.spellcasting === "object" &&
        !Array.isArray(typedSheet.spellcasting)
        ? (typedSheet.spellcasting as Record<string, unknown>).saveDc
        : null,
    ) ??
    parseNumericLike(
      typedSheet.spellcasting &&
        typeof typedSheet.spellcasting === "object" &&
        !Array.isArray(typedSheet.spellcasting)
        ? (typedSheet.spellcasting as Record<string, unknown>).dc
        : null,
    );
  if (spellAttackBonus !== null || spellSaveDc !== null) {
    const spellNames = collectKnownSpellNames();
    if (spellNames.length === 0 && spellAttackBonus !== null) {
      presets.push({
        id: "profile-spell",
        label: `Spell Attack (${formatSignedBonus(spellAttackBonus)} to hit)`,
        spellName: "Spell Attack",
        attackBonus: spellAttackBonus,
        damageDie: 8,
        damageBonus: 0,
        category: "spell",
      });
    } else {
      for (const spellName of spellNames) {
        const preview = getCatalogSpellPreview({
          profile: "dnd",
          spellName,
        });
        const isSaveSpell = preview?.delivery === "save" && preview.save;
        const isAutoHitSpell = preview?.delivery === "auto-hit";
        const label = isAutoHitSpell
          ? `${spellName} (auto-hit)`
          : isSaveSpell
          ? `${spellName} (${preview.save.ability.toUpperCase()} save DC ${
              spellSaveDc ?? preview.save.dc ?? 13
            })`
          : `${spellName} (${formatSignedBonus(spellAttackBonus ?? 0)} to hit)`;
        presets.push({
          id: `profile-spell-${spellName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
          label,
          spellName,
          attackBonus: spellAttackBonus ?? 0,
          damageDie: preview?.damageDieOverride ?? 8,
          damageBonus: preview?.damageBonusModifier ?? 0,
          category: "spell",
        });
      }
    }
  }

  return presets;
}

function parseDamageProfileText(value: string) {
  const trimmed = value.trim().toLowerCase();
  const diceMatch = trimmed.match(/(\d+)d(\d+)/);
  const bonusMatch = trimmed.match(/([+-])\s*(\d+)/);
  const diceCount = diceMatch ? Math.max(1, Math.trunc(Number(diceMatch[1]))) : 1;
  const diceSides = diceMatch ? Math.max(4, Math.trunc(Number(diceMatch[2]))) : 8;
  const bonus = bonusMatch
    ? (bonusMatch[1] === "-" ? -1 : 1) * Math.trunc(Number(bonusMatch[2]))
    : 0;

  const approximateExtraDiceBonus =
    diceCount > 1 ? (diceCount - 1) * Math.round((diceSides + 1) / 2) : 0;

  return {
    damageDie: diceSides,
    damageBonus: bonus + approximateExtraDiceBonus,
  };
}

function formatSignedBonus(value: number) {
  return value >= 0 ? `+${value}` : String(value);
}

function getCombatActionOptionsForRuleset(ruleset: string) {
  const normalized = ruleset.trim().toLowerCase();
  if (normalized.includes("deadlands")) {
    return [
      { kind: "attack" as const, label: "Attack" },
      { kind: "aim" as const, label: "Aim" },
      { kind: "take-cover" as const, label: "Take Cover" },
      { kind: "attempt-escape" as const, label: "Run Away" },
      { kind: "surrender" as const, label: "Surrender" },
      { kind: "defend" as const, label: "Defend" },
      { kind: "pass" as const, label: "Pass" },
    ];
  }

  if (normalized.includes("dnd") || normalized.includes("d&d")) {
    return [
      { kind: "attack" as const, label: "Attack" },
      { kind: "cast-spell" as const, label: "Cast Spell" },
      { kind: "help" as const, label: "Help" },
      { kind: "disengage" as const, label: "Disengage" },
      { kind: "dash" as const, label: "Dash" },
      { kind: "attempt-escape" as const, label: "Run Away" },
      { kind: "surrender" as const, label: "Surrender" },
      { kind: "defend" as const, label: "Defend" },
      { kind: "pass" as const, label: "Pass" },
    ];
  }

  return [
    { kind: "attack" as const, label: "Attack" },
    { kind: "attempt-escape" as const, label: "Run Away" },
    { kind: "surrender" as const, label: "Surrender" },
    { kind: "defend" as const, label: "Defend" },
    { kind: "pass" as const, label: "Pass" },
  ];
}

function getAvailableSpellSlotLevels(sheetJson: Record<string, unknown> | null) {
  if (!sheetJson || typeof sheetJson !== "object" || Array.isArray(sheetJson)) {
    return [] as string[];
  }

  const spellSlots =
    "spellSlots" in sheetJson &&
    sheetJson.spellSlots &&
    typeof sheetJson.spellSlots === "object" &&
    !Array.isArray(sheetJson.spellSlots)
      ? (sheetJson.spellSlots as Record<string, unknown>)
      : null;
  if (!spellSlots) {
    return [] as string[];
  }

  return Object.entries(spellSlots)
    .filter(
      ([, value]) => typeof value === "number" && Number.isFinite(value) && value > 0,
    )
    .map(([slot]) => slot);
}

  function chooseAutoEngineActionForCombatant(params: {
  actorEntry: CombatRosterEntry;
  actorCharacter: CampaignCharacter | null;
  targetEntry: CombatRosterEntry | null;
  ruleset: string;
}) {
  if (params.actorEntry.type === "enemy" || params.actorEntry.type === "npc") {
    if (!params.targetEntry) {
      return null;
    }
    return {
      kind: "attack" as CombatActionKind,
      attackPresetId: "basic",
      attackBonus: undefined as number | undefined,
      damageDie: undefined as number | undefined,
      damageBonus: undefined as number | undefined,
      spellName: undefined as string | undefined,
      spellSlot: undefined as string | undefined,
    };
  }

  const presets = extractAttackActionPresets(params.actorCharacter?.sheetJson ?? null);
  const spellPreset = presets.find((preset) => preset.category === "spell");
  const weaponPreset =
    presets.find((preset) => preset.category === "weapon" && preset.id !== "basic") ??
    presets.find((preset) => preset.category === "weapon") ??
    presets[0];
  if (!params.targetEntry) {
    return {
      kind: "pass" as CombatActionKind,
      attackPresetId: "basic",
      attackBonus: undefined as number | undefined,
      damageDie: undefined as number | undefined,
      damageBonus: undefined as number | undefined,
      spellName: undefined as string | undefined,
      spellSlot: undefined as string | undefined,
    };
  }

  const availableSlots = getAvailableSpellSlotLevels(params.actorCharacter?.sheetJson ?? null);
  const normalizedRuleset = params.ruleset.trim().toLowerCase();
  const shouldCastSpell =
    (normalizedRuleset.includes("dnd") || normalizedRuleset.includes("d&d")) &&
    spellPreset &&
    availableSlots.length > 0 &&
    Math.random() < 0.25;

  if (shouldCastSpell && spellPreset) {
    return {
      kind: "cast-spell" as CombatActionKind,
      attackPresetId: spellPreset.id,
      attackBonus: spellPreset.attackBonus,
      damageDie: spellPreset.damageDie,
      damageBonus: spellPreset.damageBonus,
      spellName: spellPreset.spellName,
      spellSlot: availableSlots[0],
    };
  }

  return {
    kind: "attack" as CombatActionKind,
    attackPresetId: weaponPreset?.id ?? "basic",
    attackBonus: weaponPreset?.attackBonus,
    damageDie: weaponPreset?.damageDie,
    damageBonus: weaponPreset?.damageBonus,
    spellName: undefined as string | undefined,
    spellSlot: undefined as string | undefined,
  };
}

function expandGroupedEnemyCombatants(
  combatants: Array<{
    id?: string;
    name: string;
    type: CombatRosterEntry["type"];
    summary?: string;
    hp?: string;
    statusEffects?: string[];
  }>,
) {
  const wordCounts: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
  };

  const parseCountToken = (token: string) => {
    const normalizedToken = token.trim().toLowerCase();
    const numeric = Number(normalizedToken);
    if (Number.isFinite(numeric)) {
      return Math.max(0, Math.trunc(numeric));
    }
    return wordCounts[normalizedToken] ?? 0;
  };

  const expanded: Array<{
    id?: string;
    name: string;
    type: CombatRosterEntry["type"];
    summary?: string;
    hp?: string;
    statusEffects?: string[];
  }> = [];

  for (const combatant of combatants) {
    if (combatant.type !== "enemy" || combatant.id) {
      expanded.push(combatant);
      continue;
    }

    const normalizedName = combatant.name.trim();
    const looksAlreadyIndexed = /\b\d+\b/.test(normalizedName);
    const looksPluralGroup =
      /\b(horde|pack|group|squad|mob|swarm)\b/i.test(normalizedName) ||
      /s$/i.test(normalizedName);
    if (looksAlreadyIndexed || !looksPluralGroup) {
      expanded.push(combatant);
      continue;
    }

    const summaryText = combatant.summary ?? "";
    const countMatches = Array.from(
      summaryText.matchAll(
        /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+([a-z][a-z' -]{1,30})\b/gi,
      ),
    );
    if (countMatches.length === 0) {
      expanded.push(combatant);
      continue;
    }

    const normalizedBaseName = normalizedName;
    let createdCount = 0;
    const maxExpanded = 12;
    const blockedLabelWords = new Set([
      "hp",
      "remaining",
      "current",
      "currently",
      "unharmed",
      "injured",
      "wounded",
      "healthy",
      "ready",
      "attacking",
      "holding",
      "stunned",
      "disoriented",
      "alive",
      "dead",
    ]);

    for (const match of countMatches) {
      const amount = parseCountToken(match[1]);
      const label = match[2].trim();
      if (!Number.isFinite(amount) || amount <= 0 || !label) {
        continue;
      }

      const labelWords = label
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
      if (
        labelWords.length === 0 ||
        labelWords.some((word) => blockedLabelWords.has(word))
      ) {
        continue;
      }

      const singularLabel = label.replace(/(?:es|s)$/i, "").trim() || label;
      const safeCount = Math.min(Math.trunc(amount), maxExpanded - createdCount);
      if (safeCount <= 0) {
        break;
      }

      for (let index = 0; index < safeCount; index += 1) {
        createdCount += 1;
        expanded.push({
          ...combatant,
          name: `${toTitleCase(singularLabel)} ${createdCount}`,
          summary: normalizedBaseName,
          hp: undefined,
        });
      }

      if (createdCount >= maxExpanded) {
        break;
      }
    }

    if (createdCount === 0) {
      expanded.push(combatant);
    }
  }

  return expanded;
}

function toTitleCase(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token[0]?.toUpperCase() + token.slice(1).toLowerCase())
    .join(" ");
}

function findCombatTargetFromRef(targetRef: string, combatState: CombatState) {
  const normalizedTargetRef = normalizeCombatLookup(targetRef);
  const roster = combatState.roster;
  const activeEntry = roster.find((entry) => entry.active) ?? roster[combatState.turnIndex];
  const actorType = activeEntry?.type ?? "character";
  const preferredTargetType = actorType === "enemy" ? "character" : "enemy";
  const preferredTargets = roster.filter(
    (entry) => entry.type === preferredTargetType && !isCombatHpDepleted(entry.hp),
  );

  const exactMatch =
    preferredTargets.find((entry) =>
      normalizeCombatLookup(entry.name) === normalizedTargetRef,
    ) ??
    preferredTargets.find((entry) =>
      entry.id ? normalizeCombatLookup(entry.id) === normalizedTargetRef : false,
    );

  if (exactMatch) {
    return exactMatch;
  }

  return preferredTargets[0] ?? null;
}

function isCombatHpDepleted(value: string | undefined) {
  if (!value) {
    return false;
  }

  const trimmed = value.trim();
  const fractionMatch = trimmed.match(/^(-?\d+)\s*\/\s*(-?\d+)$/);
  if (fractionMatch) {
    const currentHp = Number(fractionMatch[1]);
    return Number.isFinite(currentHp) && currentHp <= 0;
  }

  const numericHp = Number(trimmed);
  return Number.isFinite(numericHp) && numericHp <= 0;
}

function isCombatantDefeated(entry: CombatRosterEntry) {
  if (isCombatHpDepleted(entry.hp)) {
    return true;
  }

  const statusEffects = Array.isArray(entry.statusEffects)
    ? entry.statusEffects.map((effect) => effect.toLowerCase())
    : [];
  if (statusEffects.some((effect) => /^(incapacitated|unconscious|dead|defeated)$/.test(effect))) {
    return true;
  }
  if (statusEffects.some((effect) => /^wounds\s+4$/.test(effect))) {
    return true;
  }

  const summary = (entry.summary ?? "").toLowerCase();
  if (!summary) {
    return false;
  }

  return (
    /\bwounds?\s+4\s*\/\s*4\b/.test(summary) ||
    /\b0\s*hp\b/.test(summary) ||
    /\b(defeated|dead|down|unconscious|slain|killed|collapsed)\b/.test(summary)
  );
}

function buildCombatResolutionNarration(resolution: {
  profile?: "dnd" | "deadlands" | "generic";
  delivery?: "attack" | "save";
  actor: string;
  target: string;
  attackDie?: number;
  attackRoll: number;
  attackRollSecondary?: number;
  attackRollMode?: "normal" | "advantage" | "disadvantage";
  attackBonus: number;
  attackTotal: number;
  targetLabel?: "AC" | "TN";
  targetAc: number;
  saveAbility?: "str" | "dex" | "con" | "int" | "wis" | "cha";
  saveRoll?: number;
  saveBonus?: number;
  saveTotal?: number;
  saveDc?: number;
  saveSucceeded?: boolean;
  saveOnSuccess?: "none" | "half";
  damageDiceCount?: number;
  damageRollTotal?: number;
  raises?: number;
  hit: boolean;
  damageRoll: number;
  raiseBonusRoll?: number;
  damageBonus: number;
  damageTotal: number;
  resourceLabel?: "HP" | "Wind";
  targetHpBefore?: string;
  targetHpAfter?: string;
  targetWoundsBefore?: number;
  targetWoundsAfter?: number;
  targetWoundLocation?: "head" | "guts" | "leftArm" | "rightArm" | "leftLeg" | "rightLeg";
  targetWoundLocationBefore?: number;
  targetWoundLocationAfter?: number;
  targetIncapacitated?: boolean;
  effectsApplied?: string[];
  actorEffectsApplied?: string[];
  catalogEffectName?: string | null;
  catalogConcentration?: { required: true; durationRounds: number } | null;
  catalogReactionHooks?: Array<{ trigger: string; note: string }> | null;
  reactionWindows?: Array<{
    targetRef: string;
    targetName: string;
    triggers: string[];
    availableReactions: string[];
  }> | null;
}) {
  if (resolution.delivery === "save") {
    const resourceLabel =
      resolution.resourceLabel ?? (resolution.profile === "deadlands" ? "Wind" : "HP");
    const ability = (resolution.saveAbility ?? "dex").toUpperCase();
    const saveLine = `${resolution.actor} forces ${resolution.target} to make a ${ability} save: d20(${
      resolution.saveRoll ?? 0
    }) + ${resolution.saveBonus ?? 0} = ${resolution.saveTotal ?? 0} vs DC ${
      resolution.saveDc ?? 10
    }.`;
    const outcomeLine = resolution.saveSucceeded
      ? `Save succeeded (${resolution.saveOnSuccess === "half" ? "half damage" : "no damage"}).`
      : "Save failed.";
    const damageLine = `Damage ${
      typeof resolution.damageDiceCount === "number" && resolution.damageDiceCount > 1
        ? `${resolution.damageDiceCount}d${resolution.damageDie ?? 8}`
        : `d${resolution.damageDie ?? 8}`
    }${resolution.damageBonus ? ` + ${resolution.damageBonus}` : ""} = ${
      resolution.damageRollTotal ?? resolution.damageTotal
    } -> ${resolution.damageTotal}${resolution.targetHpAfter ? ` (${resourceLabel} ${resolution.targetHpBefore ?? "?"} -> ${resolution.targetHpAfter})` : ""}.`;
    const effectsAppliedPart =
      Array.isArray(resolution.effectsApplied) && resolution.effectsApplied.length > 0
        ? ` Effects: ${resolution.effectsApplied.join(", ")}.`
        : "";
    const concentrationPart =
      resolution.catalogConcentration?.required
        ? ` Concentration (${resolution.catalogConcentration.durationRounds} rounds).`
        : "";
    const reactionPart =
      Array.isArray(resolution.catalogReactionHooks) && resolution.catalogReactionHooks.length > 0
        ? ` Reaction hooks: ${resolution.catalogReactionHooks
            .map((hook) => `${hook.trigger} - ${hook.note}`)
            .join("; ")}.`
        : "";
    return `${saveLine} ${outcomeLine} ${damageLine}${effectsAppliedPart}${concentrationPart}${reactionPart}`;
  }

  const attackDie = resolution.attackDie ?? (resolution.profile === "deadlands" ? 10 : 20);
  const targetLabel = resolution.targetLabel ?? (resolution.profile === "deadlands" ? "TN" : "AC");
  const resourceLabel =
    resolution.resourceLabel ?? (resolution.profile === "deadlands" ? "Wind" : "HP");
  const rollPart =
    typeof resolution.attackRollSecondary === "number" &&
    resolution.attackRollMode &&
    resolution.attackRollMode !== "normal"
      ? `d${attackDie}(${resolution.attackRoll})/${
          resolution.attackRollSecondary
        } [${resolution.attackRollMode}]`
      : `d${attackDie}(${resolution.attackRoll})`;
  const attackPart = `${resolution.actor} attacks ${resolution.target}: ${rollPart} + ${resolution.attackBonus} = ${resolution.attackTotal} vs ${targetLabel} ${resolution.targetAc}.`;
  const raisePart =
    typeof resolution.raises === "number" && resolution.raises > 0
      ? ` Raises: ${resolution.raises}.`
      : "";
  const attackDamageRolls =
    Array.isArray(resolution.damageRolls) && resolution.damageRolls.length > 0
      ? resolution.damageRolls.filter((value): value is number => typeof value === "number")
      : [];
  const attackDamageDiceCount =
    typeof resolution.damageDiceCount === "number" && Number.isFinite(resolution.damageDiceCount)
      ? Math.max(1, Math.trunc(resolution.damageDiceCount))
      : attackDamageRolls.length > 0
        ? attackDamageRolls.length
        : 1;
  const damageRollPart =
    typeof resolution.raiseBonusRoll === "number" && resolution.raiseBonusRoll > 0
      ? `${resolution.damageRoll} + ${resolution.raiseBonusRoll} + ${resolution.damageBonus}`
      : attackDamageRolls.length > 1
        ? `${attackDamageDiceCount}d${resolution.damageDie ?? 8}(${attackDamageRolls.join(", ")}) + ${resolution.damageBonus}`
        : attackDamageRolls.length === 1
          ? `d${resolution.damageDie ?? 8}(${attackDamageRolls[0]}) + ${resolution.damageBonus}`
          : `${resolution.damageRoll} + ${resolution.damageBonus}`;
  const woundPart =
    typeof resolution.targetWoundsAfter === "number"
      ? ` (Wounds ${typeof resolution.targetWoundsBefore === "number" ? resolution.targetWoundsBefore : "?"} -> ${resolution.targetWoundsAfter})`
      : "";
  const locationLabelMap: Record<string, string> = {
    head: "Head",
    guts: "Guts",
    leftArm: "Left Arm",
    rightArm: "Right Arm",
    leftLeg: "Left Leg",
    rightLeg: "Right Leg",
  };
  const locationPart =
    resolution.targetWoundLocation && typeof resolution.targetWoundLocationAfter === "number"
      ? ` (Location ${locationLabelMap[resolution.targetWoundLocation] ?? resolution.targetWoundLocation}: ${
          typeof resolution.targetWoundLocationBefore === "number"
            ? resolution.targetWoundLocationBefore
            : "?"
        } -> ${resolution.targetWoundLocationAfter})`
      : "";
  const incapacitatedPart = resolution.targetIncapacitated
    ? " Target is incapacitated and will be skipped."
    : "";
  const effectsAppliedPart =
    Array.isArray(resolution.effectsApplied) && resolution.effectsApplied.length > 0
      ? ` Effects: ${resolution.effectsApplied.join(", ")}.`
      : "";
  const actorEffectsPart =
    Array.isArray(resolution.actorEffectsApplied) && resolution.actorEffectsApplied.length > 0
      ? ` Actor effects: ${resolution.actorEffectsApplied.join(", ")}.`
      : "";
  const reactionWindowsPart =
    Array.isArray(resolution.reactionWindows) && resolution.reactionWindows.length > 0
      ? ` Reaction window: ${resolution.reactionWindows
          .map((window) => `${window.targetName} can react (${window.availableReactions.join(", ")})`)
          .join("; ")}.`
      : "";
  const concentrationPart =
    resolution.catalogConcentration?.required
      ? ` Concentration (${resolution.catalogConcentration.durationRounds} rounds).`
      : "";
  const reactionPart =
    Array.isArray(resolution.catalogReactionHooks) && resolution.catalogReactionHooks.length > 0
      ? ` Reaction hooks: ${resolution.catalogReactionHooks
          .map((hook) => `${hook.trigger} - ${hook.note}`)
          .join("; ")}.`
      : "";
  const damagePart = resolution.hit
    ? `Hit for damage roll ${damageRollPart} = ${resolution.damageTotal}${resolution.targetHpAfter ? ` (${resourceLabel} ${resolution.targetHpBefore ?? "?"} -> ${resolution.targetHpAfter})` : ""}.`
    : "Miss.";

  return `${attackPart}${raisePart} ${damagePart}${woundPart}${locationPart}${incapacitatedPart}${effectsAppliedPart}${actorEffectsPart}${reactionWindowsPart}${concentrationPart}${reactionPart}`;
}

function buildCombatEngineResolutionNarration(resolution: Record<string, unknown>) {
  const aoeTargets = Array.isArray(resolution.targets)
    ? resolution.targets.filter(
        (entry): entry is Record<string, unknown> =>
          Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
      )
    : [];
  if (aoeTargets.length > 0) {
    const spellName =
      typeof resolution.spellName === "string" && resolution.spellName.trim()
        ? resolution.spellName.trim()
        : "AoE Spell";
    const actor =
      typeof resolution.actor === "string" && resolution.actor.trim()
        ? resolution.actor.trim()
        : "Caster";
    const perTarget = aoeTargets.map((entry) =>
      buildCombatResolutionNarration({
        profile:
          typeof entry.profile === "string"
            ? (entry.profile as "dnd" | "deadlands" | "generic")
            : "dnd",
        delivery:
          typeof entry.delivery === "string"
            ? (entry.delivery as "attack" | "save")
            : "save",
        actor,
        target: typeof entry.target === "string" ? entry.target : "target",
        attackRoll: typeof entry.attackRoll === "number" ? entry.attackRoll : 0,
        attackBonus: typeof entry.attackBonus === "number" ? entry.attackBonus : 0,
        attackTotal: typeof entry.attackTotal === "number" ? entry.attackTotal : 0,
        targetAc: typeof entry.targetAc === "number" ? entry.targetAc : 0,
        hit: typeof entry.hit === "boolean" ? entry.hit : true,
        damageRoll: typeof entry.damageRoll === "number" ? entry.damageRoll : 0,
        damageTotal: typeof entry.damageTotal === "number" ? entry.damageTotal : 0,
        damageBonus: typeof entry.damageBonus === "number" ? entry.damageBonus : 0,
        saveAbility:
          typeof entry.saveAbility === "string"
            ? (entry.saveAbility as "str" | "dex" | "con" | "int" | "wis" | "cha")
            : undefined,
        saveRoll: typeof entry.saveRoll === "number" ? entry.saveRoll : undefined,
        saveBonus: typeof entry.saveBonus === "number" ? entry.saveBonus : undefined,
        saveTotal: typeof entry.saveTotal === "number" ? entry.saveTotal : undefined,
        saveDc: typeof entry.saveDc === "number" ? entry.saveDc : undefined,
        saveSucceeded:
          typeof entry.saveSucceeded === "boolean" ? entry.saveSucceeded : undefined,
        saveOnSuccess:
          entry.saveOnSuccess === "none" || entry.saveOnSuccess === "half"
            ? entry.saveOnSuccess
            : undefined,
        damageDiceCount:
          typeof entry.damageDiceCount === "number" ? entry.damageDiceCount : undefined,
        damageRollTotal:
          typeof entry.damageRollTotal === "number" ? entry.damageRollTotal : undefined,
        resourceLabel:
          entry.resourceLabel === "HP" || entry.resourceLabel === "Wind"
            ? entry.resourceLabel
            : undefined,
        targetHpBefore:
          typeof entry.targetHpBefore === "string" ? entry.targetHpBefore : undefined,
        targetHpAfter:
          typeof entry.targetHpAfter === "string" ? entry.targetHpAfter : undefined,
        effectsApplied: Array.isArray(entry.effectsApplied)
          ? entry.effectsApplied.filter((value): value is string => typeof value === "string")
          : [],
      } as Parameters<typeof buildCombatResolutionNarration>[0]),
    );
    return `${actor} casts ${spellName} (AoE): ${perTarget.join(" | ")}`;
  }

  if (resolution.delivery === "auto-hit") {
    const actor =
      typeof resolution.actor === "string" && resolution.actor.trim()
        ? resolution.actor.trim()
        : "Caster";
    const target =
      typeof resolution.target === "string" && resolution.target.trim()
        ? resolution.target.trim()
        : "target";
    const spellName =
      typeof resolution.spellName === "string" && resolution.spellName.trim()
        ? resolution.spellName.trim()
        : "Spell";
    const damageDie =
      typeof resolution.damageDie === "number" && Number.isFinite(resolution.damageDie)
        ? Math.trunc(resolution.damageDie)
        : 4;
    const damageDiceCount =
      typeof resolution.damageDiceCount === "number" && Number.isFinite(resolution.damageDiceCount)
        ? Math.trunc(resolution.damageDiceCount)
        : 1;
    const damageBonus =
      typeof resolution.damageBonus === "number" && Number.isFinite(resolution.damageBonus)
        ? Math.trunc(resolution.damageBonus)
        : 0;
    const damageRolls = Array.isArray(resolution.damageRolls)
      ? resolution.damageRolls.filter((value): value is number => typeof value === "number")
      : [];
    const resourceLabel =
      resolution.resourceLabel === "HP" || resolution.resourceLabel === "Wind"
        ? resolution.resourceLabel
        : "HP";
    const damageTotal =
      typeof resolution.damageTotal === "number" && Number.isFinite(resolution.damageTotal)
        ? Math.trunc(resolution.damageTotal)
        : 0;
    return `${actor} casts ${spellName} on ${target}: auto-hit. Damage ${damageDiceCount}d${damageDie}${
      damageBonus ? ` + ${damageBonus}` : ""
    }${damageRolls.length > 0 ? ` [${damageRolls.join(", ")}]` : ""} = ${damageTotal}${
      typeof resolution.targetHpAfter === "string"
        ? ` (${resourceLabel} ${
            typeof resolution.targetHpBefore === "string" ? resolution.targetHpBefore : "?"
          } -> ${resolution.targetHpAfter})`
        : ""
    }.`;
  }

  const kind = typeof resolution.kind === "string" ? resolution.kind.toLowerCase() : "attack";
  if (
    kind === "defend" ||
    kind === "pass" ||
    kind === "surrender" ||
    kind === "attempt-escape"
  ) {
    const actor =
      typeof resolution.actor === "string" && resolution.actor.trim()
        ? resolution.actor.trim()
        : "Combatant";
    const detail =
      typeof resolution.detail === "string" && resolution.detail.trim()
        ? resolution.detail.trim()
        : kind === "defend"
          ? `${actor} takes a defensive stance.`
          : kind === "surrender"
            ? `${actor} surrenders.`
            : kind === "attempt-escape"
              ? `${actor} attempts to escape.`
              : `${actor} passes the turn.`;
    return detail;
  }

  return buildCombatResolutionNarration(resolution as {
    profile?: "dnd" | "deadlands" | "generic";
    delivery?: "attack" | "save";
    actor: string;
    target: string;
    attackDie?: number;
    attackRoll: number;
    attackRollSecondary?: number;
    attackRollMode?: "normal" | "advantage" | "disadvantage";
    attackBonus: number;
    attackTotal: number;
    targetLabel?: "AC" | "TN";
    targetAc: number;
    saveAbility?: "str" | "dex" | "con" | "int" | "wis" | "cha";
    saveRoll?: number;
    saveBonus?: number;
    saveTotal?: number;
    saveDc?: number;
    saveSucceeded?: boolean;
    saveOnSuccess?: "none" | "half";
    damageDiceCount?: number;
    damageRollTotal?: number;
    raises?: number;
    hit: boolean;
    damageRoll: number;
    raiseBonusRoll?: number;
    damageBonus: number;
    damageTotal: number;
    resourceLabel?: "HP" | "Wind";
    targetHpBefore?: string;
    targetHpAfter?: string;
    targetWoundsBefore?: number;
    targetWoundsAfter?: number;
    targetWoundLocation?: "head" | "guts" | "leftArm" | "rightArm" | "leftLeg" | "rightLeg";
    targetWoundLocationBefore?: number;
    targetWoundLocationAfter?: number;
    targetIncapacitated?: boolean;
    effectsApplied?: string[];
    actorEffectsApplied?: string[];
    catalogEffectName?: string | null;
    catalogConcentration?: { required: true; durationRounds: number } | null;
    catalogReactionHooks?: Array<{ trigger: string; note: string }> | null;
    reactionWindows?: Array<{
      targetRef: string;
      targetName: string;
      triggers: string[];
      availableReactions: string[];
    }> | null;
  });
}

function getCombatOutcomeHandoffMessage(resolution: Record<string, unknown>) {
  const combatOutcome =
    typeof resolution.combatOutcome === "string"
      ? resolution.combatOutcome.trim().toLowerCase()
      : "";
  const actor =
    typeof resolution.actor === "string" && resolution.actor.trim()
      ? resolution.actor.trim()
      : "Unknown actor";
  if (combatOutcome === "surrendered") {
    return [
      "Authoritative engine outcome: PLAYER SIDE surrendered.",
      "This is a PARTY-WIDE surrender outcome.",
      `${actor} initiated the surrender action, but all allied player-side combatants are considered surrendered for this encounter resolution.`,
      "Narrate terms imposed on the party, immediate consequences, and next choices.",
      "Do not invert sides. Enemies did NOT surrender.",
      "Do not narrate this as only one character surrendering while others remain actively fighting.",
    ].join(" ");
  }
  if (combatOutcome === "escaped") {
    return [
      "Authoritative engine outcome: PLAYER SIDE escaped combat.",
      "This is a PARTY-WIDE escape outcome.",
      `${actor} initiated the escape action, but the player side as a whole successfully broke contact.`,
      "Narrate escape route, immediate aftermath, and next choices.",
      "Do not invert sides. Enemies did NOT flee unless already established.",
      "Do not narrate this as only one character escaping while others remain in active combat.",
    ].join(" ");
  }
  return null;
}

function getLatestChoiceMap(messages: ChatMessage[]) {
  const reversedGmMessages = [...messages]
    .reverse()
    .filter((message) => message.role === "gm");

  for (const gmMessage of reversedGmMessages) {
    const visibleContent = normalizeChoiceTextForDisplay(
      stripVisibleSceneMetadata(gmMessage.content),
    );
    const choiceMap = new Map<number, string>();

    const inlineMatches = Array.from(
      visibleContent.matchAll(/([1-9])\.\s+([\s\S]*?)(?=\s+[1-9]\.\s+|\n|$)/g),
    );
    inlineMatches.forEach((match) => {
      const numericId = Number(match[1]);
      const text = match[2].trim();
      if (!Number.isFinite(numericId) || !text) {
        return;
      }
      choiceMap.set(numericId, text);
    });

    if (choiceMap.size === 0) {
      visibleContent.split("\n").forEach((line) => {
        const normalizedLine = line.trim().replace(/^\*+|\*+$/g, "").trim();
        const match = normalizedLine.match(/^([1-9])\.\s+(.+)$/);

        if (!match) {
          return;
        }

        choiceMap.set(Number(match[1]), match[2].trim());
      });
    }

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

  if (message.isEnemyNarration) {
    return {
      containerClass: "border-rose-800/70 bg-rose-950/30",
      labelClass: "text-rose-200",
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

function getCombatReactionStatus(
  combatState: CombatState,
  character: CampaignCharacter,
): "ready" | "used" | undefined {
  if (!combatState.combatActive || combatState.roster.length === 0) {
    return undefined;
  }

  const normalizedName = normalizeCharacterLookupName(character.name);
  const combatEntry = combatState.roster.find(
    (entry) =>
      (entry.id && entry.id === character.id) ||
      normalizeCharacterLookupName(entry.name) === normalizedName,
  );
  if (!combatEntry) {
    return undefined;
  }

  const statusEffects = Array.isArray(combatEntry.statusEffects)
    ? combatEntry.statusEffects
        .filter((effect): effect is string => typeof effect === "string")
        .map((effect) => effect.trim().toLowerCase())
    : [];
  return statusEffects.includes("reaction used") ? "used" : "ready";
}

function CombatRosterCard({
  entry,
  order,
  campaignRuleset,
}: {
  entry: CombatRosterEntry;
  order: number;
  campaignRuleset: string;
}) {
  const normalizedRuleset = campaignRuleset.trim().toLowerCase();
  const isDeadlandsRuleset = normalizedRuleset.includes("deadlands");
  const resourceLabel = isDeadlandsRuleset ? "Wind" : "HP";
  const statusEffects = Array.isArray(entry.statusEffects)
    ? entry.statusEffects.filter((effect) => effect.trim().length > 0)
    : [];
  const durationByEffect = new Map<string, number>();
  if (Array.isArray(entry.statusDurations)) {
    for (const duration of entry.statusDurations) {
      if (!duration || typeof duration !== "object") {
        continue;
      }
      const effectName =
        typeof duration.effect === "string" ? duration.effect.trim() : "";
      const remaining =
        typeof duration.remainingRounds === "number" &&
        Number.isFinite(duration.remainingRounds)
          ? Math.max(0, Math.trunc(duration.remainingRounds))
          : 0;
      if (!effectName || remaining <= 0) {
        continue;
      }
      const key = effectName.toLowerCase();
      const current = durationByEffect.get(key);
      durationByEffect.set(key, current ? Math.max(current, remaining) : remaining);
    }
  }
  const prioritizedStatusEffects = [...statusEffects].sort((left, right) => {
    const leftShielded = left.trim().toLowerCase() === "shielded";
    const rightShielded = right.trim().toLowerCase() === "shielded";
    if (leftShielded === rightShielded) {
      return 0;
    }
    return leftShielded ? -1 : 1;
  });
  const deadlandsWoundsFromStatus =
    statusEffects.find((effect) => /^wounds\s+\d+$/i.test(effect)) ?? null;
  const deadlandsWoundsFromSummary = entry.summary?.match(/wounds?\s+\d+\s*\/\s*4/i)?.[0] ?? null;
  const deadlandsWoundsLabel = deadlandsWoundsFromSummary ?? deadlandsWoundsFromStatus;
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
                <span>{resourceLabel} {entry.hp}</span>
              </>
            ) : null}
            {isDeadlandsRuleset && deadlandsWoundsLabel ? (
              <>
                <span className="px-1 text-zinc-600">|</span>
                <span>{deadlandsWoundsLabel}</span>
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

          {prioritizedStatusEffects.length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {prioritizedStatusEffects.slice(0, 2).map((effect) => {
                const remaining = durationByEffect.get(effect.toLowerCase());
                const label = remaining ? `${effect} (${remaining}r)` : effect;
                return (
                <span
                  key={`${entry.name}-${label}`}
                  className="rounded-full border border-red-400/20 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-200"
                >
                  {label}
                </span>
              )})}
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
  const decodedText = decodeEscapedNewlines(text);
  const withoutSceneBlock = stripSceneBlock(decodedText);
  const withoutPartyBlock = extractPartyBlock(withoutSceneBlock).content;
  const withoutCombatBlock = extractCombatBlock(withoutPartyBlock).content;
  const withoutBootstrapBlock = extractCampaignBootstrapBlock(withoutCombatBlock).content;
  const withoutLooseSceneHeader = withoutBootstrapBlock.replace(
    /^\s*(?:Title|Place|Mood|Threat|Goal|Clock|Context):[\s\S]*?(?=\n\s*\n|(?:\n\s*(?:\d+\.\s|[-*]\s))|$)/i,
    "",
  );

  return withoutLooseSceneHeader
    .replace(/\s*STATE:\s*[\s\S]*?\s*ENDSTATE\s*/gi, "\n")
    .replace(
      /^\s*SCENE:\s*\n(?:\s*(?:Title|Place|Mood|Threat|Goal|Clock|Context):[^\n]*\n?)+(?:\s*ENDS?CEN?E?\s*\n?)?/i,
      "",
    )
    .replace(/(?:^|\n)\s*END[ A-Z]*SCEN[ A-Z]*\s*(?=\n|$)/gi, "\n")
    .replace(/(?:^|\n)\s*ENDS?CEN?E?\s*(?=\n|$)/gi, "\n")
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


