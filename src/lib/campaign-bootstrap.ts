export const CAMPAIGN_BOOTSTRAP_SCHEMA_VERSION = 2;

import {
  buildInitialEncounterBootstrap,
  normalizeEncounterBootstrap,
  type EncounterCombatGenerationConfig,
  type WorldRosterPack,
} from "@/lib/encounter-bootstrap";

export type CampaignVisibility = "player" | "teased" | "gm_hidden" | "debug_only";
export type CampaignQuestType = "main" | "side" | "personal";
export type CampaignQuestStatus = "dormant" | "active" | "completed" | "failed";

export type CampaignBootstrapClock = {
  id: string;
  name: string;
  current: number;
  max: number;
  trigger: string;
  visibility: CampaignVisibility;
};

export type CampaignBootstrapQuest = {
  id: string;
  title: string;
  type: CampaignQuestType;
  status: CampaignQuestStatus;
  visibility: CampaignVisibility;
  objective: string;
  steps: string[];
  leads: string[];
  stakes: string;
  rewards: string;
};

export type CampaignBootstrapNpc = {
  id: string;
  name: string;
  role: string;
  want: string;
  fear: string;
  secret: string;
  visibility: CampaignVisibility;
};

export type CampaignBootstrapLocation = {
  id: string;
  name: string;
  tagline: string;
  secret: string;
  visibility: CampaignVisibility;
};

export type CampaignBootstrapClue = {
  id: string;
  text: string;
  revealed: boolean;
  visibility: CampaignVisibility;
};

export type CampaignBootstrapTwist = {
  id: string;
  text: string;
  visibility: CampaignVisibility;
};

export type CampaignBootstrapExpansionEventKind =
  | "quest_step"
  | "quest_lead"
  | "clock"
  | "clue"
  | "quest_created";

export type CampaignBootstrapExpansionEvent = {
  id: string;
  text: string;
  kind: CampaignBootstrapExpansionEventKind;
  createdAt: string;
  visibility: CampaignVisibility;
};

export type CampaignBootstrap = {
  schemaVersion: number;
  seed: string;
  campaign: {
    pitch_public: string;
    starting_scene: string;
    party_goal_public: string;
    tone: string;
    theme: string;
    party_type: string;
    starting_hook: string;
    scope: string;
    ruleset: string;
  };
  arc_hidden: {
    arc_title: string;
    true_antagonist: string;
    antagonist_goal: string;
    milestones: string[];
    finale_trigger: string;
  };
  quests: CampaignBootstrapQuest[];
  clocks: CampaignBootstrapClock[];
  npcs: CampaignBootstrapNpc[];
  locations: CampaignBootstrapLocation[];
  clues: CampaignBootstrapClue[];
  twists: CampaignBootstrapTwist[];
  expansion_events: CampaignBootstrapExpansionEvent[];
  combat_generation: EncounterCombatGenerationConfig;
  world_roster: WorldRosterPack;
  gm_notes: {
    current_objective: string;
    unresolved_clues: string[];
    offscreen_pressure: string[];
    hidden_secrets_remaining: string[];
  };
};

export type CampaignBootstrapPlayerView = {
  schemaVersion: number;
  campaign: CampaignBootstrap["campaign"];
  quests: CampaignBootstrapQuest[];
  clocks: CampaignBootstrapClock[];
  npcs: Array<Pick<CampaignBootstrapNpc, "id" | "name" | "role" | "visibility">>;
  locations: Array<Pick<CampaignBootstrapLocation, "id" | "name" | "tagline" | "visibility">>;
  clues: CampaignBootstrapClue[];
  expansion_events: CampaignBootstrapExpansionEvent[];
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asStringList(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function asInt(value: unknown, fallback: number, min = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(min, Math.trunc(value));
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed)) {
      return Math.max(min, parsed);
    }
  }
  return Math.max(min, Math.trunc(fallback));
}

function normalizeVisibility(value: unknown, fallback: CampaignVisibility): CampaignVisibility {
  const text = asString(value).toLowerCase();
  if (
    text === "player" ||
    text === "teased" ||
    text === "gm_hidden" ||
    text === "debug_only"
  ) {
    return text;
  }
  return fallback;
}

function sanitizeId(value: unknown, fallback: string) {
  const text = asString(value);
  return text || fallback;
}

function buildSeed(title: string, ruleset: string, startingScenario: string) {
  const base = `${title}|${ruleset}|${startingScenario}`.toLowerCase();
  let hash = 2166136261;
  for (let index = 0; index < base.length; index += 1) {
    hash ^= base.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `seed-${(hash >>> 0).toString(16)}`;
}

export function buildInitialCampaignBootstrap(params: {
  title: string;
  ruleset: string;
  startingScenario: string;
  tone?: string;
  scope?: string;
  theme?: string;
  partyType?: string;
  startingHook?: string;
  linesLimits?: string;
}) {
  const title = params.title.trim() || "Untitled Campaign";
  const ruleset = params.ruleset.trim() || "Unknown Ruleset";
  const startingScene = params.startingScenario.trim() || "A fresh beginning.";
  const tone = params.tone?.trim() || "adventure";
  const scope = params.scope?.trim() || "local";
  const theme = params.theme?.trim() || "mystery";
  const partyType = params.partyType?.trim() || "adventurers";
  const startingHook = params.startingHook?.trim() || "job offer";
  const linesLimits = params.linesLimits?.trim() || "";
  const seed = buildSeed(title, ruleset, startingScene);
  const mainQuestId = "Q1";
  const encounterBootstrap = buildInitialEncounterBootstrap({
    ruleset,
    theme,
    tone,
    scope,
    startingHook,
  });

  const bootstrap: CampaignBootstrap = {
    schemaVersion: CAMPAIGN_BOOTSTRAP_SCHEMA_VERSION,
    seed,
    campaign: {
      pitch_public: `${title} opens with immediate pressure and a clear first lead.`,
      starting_scene: startingScene,
      party_goal_public: "Stabilize the situation and secure your first meaningful lead.",
      tone,
      theme,
      party_type: partyType,
      starting_hook: startingHook,
      scope,
      ruleset,
    },
    arc_hidden: {
      arc_title: `${title} - Hidden Arc`,
      true_antagonist: "Unknown patron",
      antagonist_goal: `Exploit the unfolding ${theme} crisis for power.`,
      milestones: [
        "Identify the first credible lead",
        "Expose the controlling faction",
        "Disrupt the antagonist's immediate plan",
      ],
      finale_trigger: "Two arc milestones completed and primary clock pressure resolved.",
    },
    quests: [
      {
        id: mainQuestId,
        title: "First Lead",
        type: "main",
        status: "active",
        visibility: "player",
        objective: "Follow the strongest lead from the opening scene.",
        steps: ["Investigate the immediate scene", "Choose the next destination"],
        leads: ["Opening witness", "Suspicious location"],
        stakes: "Losing initiative gives antagonists time to entrench.",
        rewards: "Trusted contacts and clearer arc direction.",
      },
      {
        id: "Q2",
        title: "Whispers in the Margins",
        type: "side",
        status: "dormant",
        visibility: "teased",
        objective: "Track down a rumor that intersects the main lead.",
        steps: [],
        leads: ["Rumor board", "Street source"],
        stakes: "Missed leverage and poorer negotiating position.",
        rewards: "Bonus intel and optional ally unlock.",
      },
    ],
    clocks: [
      {
        id: "CLK1",
        name: "Opposition Preparedness",
        current: 0,
        max: 6,
        trigger: "Enemy network hardens and options narrow.",
        visibility: "gm_hidden",
      },
      {
        id: "CLK2",
        name: "Public Pressure",
        current: 0,
        max: 4,
        trigger: "Local conditions worsen and stakes become visible.",
        visibility: "teased",
      },
    ],
    npcs: [
      {
        id: "NPC1",
        name: "Local Fixer",
        role: "broker",
        want: "Leverage over both sides.",
        fear: "Being publicly linked to the antagonist.",
        secret: "Already accepted payment from a rival faction.",
        visibility: "teased",
      },
    ],
    locations: [
      {
        id: "LOC1",
        name: "Starting District",
        tagline: "Crowded, tense, and full of conflicting stories.",
        secret: "Contains hidden evidence tied to the first milestone.",
        visibility: "player",
      },
    ],
    clues: [
      {
        id: "CL1",
        text: "A symbol appears repeatedly near key incidents.",
        revealed: false,
        visibility: "gm_hidden",
      },
    ],
    twists: [
      {
        id: "TW1",
        text: "An apparent ally is feeding sanitized intel to stall the party.",
        visibility: "gm_hidden",
      },
    ],
    expansion_events: [],
    combat_generation: encounterBootstrap.combatGeneration,
    world_roster: encounterBootstrap.worldRoster,
    gm_notes: {
      current_objective: "Escalate the opening lead without exposing the true antagonist.",
      unresolved_clues: ["CL1"],
      offscreen_pressure: [
        "Opposition Preparedness clock advances every 2-3 turns.",
        `Party profile: ${partyType}.`,
        `Opening hook pattern: ${startingHook}.`,
        `Encounter pool generated with ${encounterBootstrap.worldRoster.enemyTemplates.length} enemy templates.`,
        ...(linesLimits ? [`Safety limits: ${linesLimits}`] : []),
      ],
      hidden_secrets_remaining: ["TW1"],
    },
  };

  return bootstrap;
}

function normalizeQuest(value: unknown, index: number): CampaignBootstrapQuest | null {
  const typed = asObject(value);
  if (!typed) {
    return null;
  }

  const id = sanitizeId(typed.id, `Q${index + 1}`);
  const title = asString(typed.title);
  if (!title) {
    return null;
  }

  const typeRaw = asString(typed.type).toLowerCase();
  const type: CampaignQuestType =
    typeRaw === "side" || typeRaw === "personal" ? typeRaw : "main";
  const statusRaw = asString(typed.status).toLowerCase();
  const status: CampaignQuestStatus =
    statusRaw === "dormant" ||
    statusRaw === "completed" ||
    statusRaw === "failed"
      ? statusRaw
      : "active";

  return {
    id,
    title,
    type,
    status,
    visibility: normalizeVisibility(typed.visibility, "teased"),
    objective: asString(typed.objective),
    steps: asStringList(typed.steps),
    leads: asStringList(typed.leads),
    stakes: asString(typed.stakes),
    rewards: asString(typed.rewards),
  };
}

function normalizeClock(value: unknown, index: number): CampaignBootstrapClock | null {
  const typed = asObject(value);
  if (!typed) {
    return null;
  }
  const name = asString(typed.name);
  if (!name) {
    return null;
  }
  const max = Math.max(1, asInt(typed.max, 4, 1));
  const current = Math.min(max, asInt(typed.current, 0, 0));
  return {
    id: sanitizeId(typed.id, `CLK${index + 1}`),
    name,
    current,
    max,
    trigger: asString(typed.trigger),
    visibility: normalizeVisibility(typed.visibility, "gm_hidden"),
  };
}

function normalizeNpc(value: unknown, index: number): CampaignBootstrapNpc | null {
  const typed = asObject(value);
  if (!typed) {
    return null;
  }
  const name = asString(typed.name);
  if (!name) {
    return null;
  }
  return {
    id: sanitizeId(typed.id, `NPC${index + 1}`),
    name,
    role: asString(typed.role),
    want: asString(typed.want),
    fear: asString(typed.fear),
    secret: asString(typed.secret),
    visibility: normalizeVisibility(typed.visibility, "gm_hidden"),
  };
}

function normalizeLocation(value: unknown, index: number): CampaignBootstrapLocation | null {
  const typed = asObject(value);
  if (!typed) {
    return null;
  }
  const name = asString(typed.name);
  if (!name) {
    return null;
  }
  return {
    id: sanitizeId(typed.id, `LOC${index + 1}`),
    name,
    tagline: asString(typed.tagline),
    secret: asString(typed.secret),
    visibility: normalizeVisibility(typed.visibility, "gm_hidden"),
  };
}

function normalizeClue(value: unknown, index: number): CampaignBootstrapClue | null {
  const typed = asObject(value);
  if (!typed) {
    return null;
  }
  const text = asString(typed.text);
  if (!text) {
    return null;
  }
  return {
    id: sanitizeId(typed.id, `CL${index + 1}`),
    text,
    revealed: Boolean(typed.revealed),
    visibility: normalizeVisibility(typed.visibility, "gm_hidden"),
  };
}

function normalizeTwist(value: unknown, index: number): CampaignBootstrapTwist | null {
  const typed = asObject(value);
  if (!typed) {
    return null;
  }
  const text = asString(typed.text);
  if (!text) {
    return null;
  }
  return {
    id: sanitizeId(typed.id, `TW${index + 1}`),
    text,
    visibility: normalizeVisibility(typed.visibility, "gm_hidden"),
  };
}

function normalizeExpansionEvent(
  value: unknown,
  index: number,
): CampaignBootstrapExpansionEvent | null {
  const typed = asObject(value);
  if (!typed) {
    return null;
  }
  const text = asString(typed.text);
  if (!text) {
    return null;
  }
  const kindRaw = asString(typed.kind).toLowerCase();
  const kind: CampaignBootstrapExpansionEventKind =
    kindRaw === "quest_lead" ||
    kindRaw === "clock" ||
    kindRaw === "clue" ||
    kindRaw === "quest_created"
      ? kindRaw
      : "quest_step";
  const createdAt = asString(typed.createdAt) || new Date(0).toISOString();
  return {
    id: sanitizeId(typed.id, `EV${index + 1}`),
    text,
    kind,
    createdAt,
    visibility: normalizeVisibility(typed.visibility, "player"),
  };
}

export function normalizeCampaignBootstrap(
  value: unknown,
  fallback: CampaignBootstrap,
): CampaignBootstrap {
  const typed = asObject(value);
  if (!typed) {
    return fallback;
  }

  const campaignValue = asObject(typed.campaign);
  const arcHiddenValue = asObject(typed.arc_hidden);
  const normalizedEncounterBootstrap = normalizeEncounterBootstrap(
    {
      combatGeneration: asObject(typed.combat_generation) ?? undefined,
      worldRoster: asObject(typed.world_roster) ?? undefined,
    },
    {
      combatGeneration: fallback.combat_generation,
      worldRoster: fallback.world_roster,
    },
  );
  const gmNotesValue = asObject(typed.gm_notes);

  return {
    schemaVersion: asInt(typed.schemaVersion, CAMPAIGN_BOOTSTRAP_SCHEMA_VERSION, 1),
    seed: asString(typed.seed) || fallback.seed,
    campaign: {
      pitch_public:
        asString(campaignValue?.pitch_public) || fallback.campaign.pitch_public,
      starting_scene:
        asString(campaignValue?.starting_scene) || fallback.campaign.starting_scene,
      party_goal_public:
        asString(campaignValue?.party_goal_public) || fallback.campaign.party_goal_public,
      tone: asString(campaignValue?.tone) || fallback.campaign.tone,
      theme: asString(campaignValue?.theme) || fallback.campaign.theme,
      party_type: asString(campaignValue?.party_type) || fallback.campaign.party_type,
      starting_hook:
        asString(campaignValue?.starting_hook) || fallback.campaign.starting_hook,
      scope: asString(campaignValue?.scope) || fallback.campaign.scope,
      ruleset: asString(campaignValue?.ruleset) || fallback.campaign.ruleset,
    },
    arc_hidden: {
      arc_title: asString(arcHiddenValue?.arc_title) || fallback.arc_hidden.arc_title,
      true_antagonist:
        asString(arcHiddenValue?.true_antagonist) || fallback.arc_hidden.true_antagonist,
      antagonist_goal:
        asString(arcHiddenValue?.antagonist_goal) || fallback.arc_hidden.antagonist_goal,
      milestones: asStringList(arcHiddenValue?.milestones),
      finale_trigger:
        asString(arcHiddenValue?.finale_trigger) || fallback.arc_hidden.finale_trigger,
    },
    quests: Array.isArray(typed.quests)
      ? typed.quests
          .map((entry, index) => normalizeQuest(entry, index))
          .filter((entry): entry is CampaignBootstrapQuest => Boolean(entry))
      : fallback.quests,
    clocks: Array.isArray(typed.clocks)
      ? typed.clocks
          .map((entry, index) => normalizeClock(entry, index))
          .filter((entry): entry is CampaignBootstrapClock => Boolean(entry))
      : fallback.clocks,
    npcs: Array.isArray(typed.npcs)
      ? typed.npcs
          .map((entry, index) => normalizeNpc(entry, index))
          .filter((entry): entry is CampaignBootstrapNpc => Boolean(entry))
      : fallback.npcs,
    locations: Array.isArray(typed.locations)
      ? typed.locations
          .map((entry, index) => normalizeLocation(entry, index))
          .filter((entry): entry is CampaignBootstrapLocation => Boolean(entry))
      : fallback.locations,
    clues: Array.isArray(typed.clues)
      ? typed.clues
          .map((entry, index) => normalizeClue(entry, index))
          .filter((entry): entry is CampaignBootstrapClue => Boolean(entry))
      : fallback.clues,
    twists: Array.isArray(typed.twists)
      ? typed.twists
          .map((entry, index) => normalizeTwist(entry, index))
          .filter((entry): entry is CampaignBootstrapTwist => Boolean(entry))
      : fallback.twists,
    expansion_events: Array.isArray(typed.expansion_events)
      ? typed.expansion_events
          .map((entry, index) => normalizeExpansionEvent(entry, index))
          .filter((entry): entry is CampaignBootstrapExpansionEvent => Boolean(entry))
      : fallback.expansion_events,
    combat_generation: normalizedEncounterBootstrap.combatGeneration,
    world_roster: normalizedEncounterBootstrap.worldRoster,
    gm_notes: {
      current_objective:
        asString(gmNotesValue?.current_objective) || fallback.gm_notes.current_objective,
      unresolved_clues: asStringList(gmNotesValue?.unresolved_clues),
      offscreen_pressure: asStringList(gmNotesValue?.offscreen_pressure),
      hidden_secrets_remaining: asStringList(gmNotesValue?.hidden_secrets_remaining),
    },
  };
}

function isVisibleToPlayer(visibility: CampaignVisibility) {
  return visibility === "player" || visibility === "teased";
}

export function projectCampaignBootstrapForPlayer(
  bootstrap: CampaignBootstrap,
): CampaignBootstrapPlayerView {
  return {
    schemaVersion: bootstrap.schemaVersion,
    campaign: {
      ...bootstrap.campaign,
    },
    quests: bootstrap.quests.filter((entry) => isVisibleToPlayer(entry.visibility)),
    clocks: bootstrap.clocks.filter((entry) => isVisibleToPlayer(entry.visibility)),
    npcs: bootstrap.npcs
      .filter((entry) => isVisibleToPlayer(entry.visibility))
      .map((entry) => ({
        id: entry.id,
        name: entry.name,
        role: entry.role,
        visibility: entry.visibility,
      })),
    locations: bootstrap.locations
      .filter((entry) => isVisibleToPlayer(entry.visibility))
      .map((entry) => ({
        id: entry.id,
        name: entry.name,
        tagline: entry.tagline,
        visibility: entry.visibility,
      })),
    clues: bootstrap.clues.filter(
      (entry) => entry.revealed && isVisibleToPlayer(entry.visibility),
    ),
    expansion_events: bootstrap.expansion_events
      .filter((entry) => isVisibleToPlayer(entry.visibility))
      .slice(-12),
  };
}

export function formatCampaignBootstrapForPrompt(bootstrap: CampaignBootstrap) {
  const activeQuests = bootstrap.quests
    .filter((entry) => entry.status === "active")
    .map((entry) => `${entry.id}: ${entry.title} (${entry.visibility})`);
  const visibleClocks = bootstrap.clocks
    .filter((entry) => entry.visibility === "player" || entry.visibility === "teased")
    .map((entry) => `${entry.name} ${entry.current}/${entry.max}`);
  const hiddenClocks = bootstrap.clocks
    .filter((entry) => entry.visibility === "gm_hidden" || entry.visibility === "debug_only")
    .map((entry) => `${entry.name} ${entry.current}/${entry.max}`);

  return [
    `Seed: ${bootstrap.seed}`,
    `Encounter mode: ${bootstrap.combat_generation.difficultyMode}/${bootstrap.combat_generation.encounterVariance}`,
    `World roster templates: ${bootstrap.world_roster.enemyTemplates.length}`,
    `Public goal: ${bootstrap.campaign.party_goal_public || "None"}`,
    `Hidden objective: ${bootstrap.gm_notes.current_objective || "None"}`,
    `Active quests: ${activeQuests.length > 0 ? activeQuests.join("; ") : "None"}`,
    `Visible clocks: ${visibleClocks.length > 0 ? visibleClocks.join("; ") : "None"}`,
    `Hidden clocks: ${hiddenClocks.length > 0 ? hiddenClocks.join("; ") : "None"}`,
    `Unresolved clues: ${
      bootstrap.gm_notes.unresolved_clues.length > 0
        ? bootstrap.gm_notes.unresolved_clues.join("; ")
        : "None"
    }`,
  ].join("\n");
}
