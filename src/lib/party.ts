export type NarrationLevel = "light" | "medium" | "high";

export type PartyReputationEntry = {
  name: string;
  score: number;
  status: string;
  notes: string[];
};

export type PartyState = {
  narrationLevel: NarrationLevel;
  partyName: string;
  summary: string;
  recap: string;
  activeQuests: string[];
  completedQuests: string[];
  journal: string[];
  reputation: PartyReputationEntry[];
  sharedInventory: string[];
};

export type PartyUpdateInstruction = {
  narrationLevel?: NarrationLevel;
  partyName?: string;
  summary?: string;
  recap?: string;
  activeQuests?: string[];
  completedQuests?: string[];
  completedQuestsAdd?: string[];
  journalAdd?: string[];
  reputation?: PartyReputationEntry[];
  sharedInventory?: string[];
};

export const DEFAULT_PARTY_STATE: PartyState = {
  narrationLevel: "high",
  partyName: "",
  summary: "",
  recap: "",
  activeQuests: [],
  completedQuests: [],
  journal: [],
  reputation: [],
  sharedInventory: [],
};

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNarrationLevel(value: unknown): NarrationLevel {
  if (typeof value !== "string") {
    return "high";
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "light" || normalized === "medium") {
    return normalized;
  }

  return "high";
}

function normalizeStringList(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function dedupeStringList(values: string[]) {
  return [...new Set(values.map((entry) => entry.trim()).filter(Boolean))];
}

function normalizeQuestKey(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeReputationScore(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(-3, Math.min(3, Math.trunc(value)));
  }

  if (typeof value === "string") {
    const parsedValue = Number.parseInt(value.trim(), 10);

    if (Number.isFinite(parsedValue)) {
      return Math.max(-3, Math.min(3, parsedValue));
    }
  }

  return 0;
}

function defaultReputationStatus(score: number) {
  if (score <= -3) {
    return "Hostile";
  }

  if (score === -2) {
    return "Distrusted";
  }

  if (score === -1) {
    return "Wary";
  }

  if (score === 1) {
    return "Favorable";
  }

  if (score === 2) {
    return "Trusted";
  }

  if (score >= 3) {
    return "Allied";
  }

  return "Neutral";
}

function normalizeReputationEntry(value: unknown): PartyReputationEntry | null {
  if (typeof value === "string") {
    const name = value.trim();

    if (!name) {
      return null;
    }

    return {
      name,
      score: 0,
      status: "Neutral",
      notes: [],
    };
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const typedValue = value as Record<string, unknown>;
  const name = normalizeString(typedValue.name);

  if (!name) {
    return null;
  }

  const score = normalizeReputationScore(typedValue.score);
  const status = normalizeString(typedValue.status) || defaultReputationStatus(score);

  return {
    name,
    score,
    status,
    notes: normalizeStringList(typedValue.notes),
  };
}

function normalizeReputationList(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => normalizeReputationEntry(entry))
    .filter((entry): entry is PartyReputationEntry => Boolean(entry));
}

export function normalizePartyState(value: unknown): PartyState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_PARTY_STATE };
  }

  const typedValue = value as Record<string, unknown>;

  return {
    narrationLevel: normalizeNarrationLevel(typedValue.narrationLevel),
    partyName: normalizeString(typedValue.partyName),
    summary: normalizeString(typedValue.summary),
    recap: normalizeString(typedValue.recap),
    activeQuests: normalizeStringList(typedValue.activeQuests),
    completedQuests: normalizeStringList(typedValue.completedQuests),
    journal: normalizeStringList(typedValue.journal),
    reputation: normalizeReputationList(typedValue.reputation),
    sharedInventory: normalizeStringList(typedValue.sharedInventory),
  };
}

export function buildInitialPartyState(campaignTitle: string) {
  return {
    ...DEFAULT_PARTY_STATE,
    narrationLevel: "medium",
    partyName: campaignTitle.trim() ? `${campaignTitle.trim()} Party` : "",
  };
}

export function formatPartyStateForPrompt(value: unknown) {
  const partyState = normalizePartyState(value);
  const formattedReputation =
    partyState.reputation.length > 0
      ? partyState.reputation
          .map((entry) => {
            const noteText = entry.notes.length > 0 ? `; notes: ${entry.notes.join(" / ")}` : "";
            return `${entry.name} (score ${entry.score}, status ${entry.status})${noteText}`;
          })
          .join("; ")
      : "None";

  const sections = [
    `Narration level: ${partyState.narrationLevel}`,
    `Party name: ${partyState.partyName || "Unassigned"}`,
    `Summary: ${partyState.summary || "None"}`,
    `Recap: ${partyState.recap || "None"}`,
    `Active quests: ${partyState.activeQuests.length > 0 ? partyState.activeQuests.join("; ") : "None"}`,
    `Completed quests: ${partyState.completedQuests.length > 0 ? partyState.completedQuests.join("; ") : "None"}`,
    `Journal: ${partyState.journal.length > 0 ? partyState.journal.join("; ") : "None"}`,
    `Reputation: ${formattedReputation}`,
    `Shared inventory: ${partyState.sharedInventory.length > 0 ? partyState.sharedInventory.join("; ") : "None"}`,
  ];

  return sections.join("\n");
}

export function normalizePartyUpdate(value: unknown): PartyUpdateInstruction {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const typedValue = value as Record<string, unknown>;
  const update: PartyUpdateInstruction = {};
  const hasOwn = (key: string) => Object.prototype.hasOwnProperty.call(typedValue, key);

  if (hasOwn("partyName")) {
    const partyName = normalizeString(typedValue.partyName);
    update.partyName = partyName;
  }

  if (hasOwn("narrationLevel")) {
    update.narrationLevel = normalizeNarrationLevel(typedValue.narrationLevel);
  }

  if (hasOwn("summary")) {
    const summary = normalizeString(typedValue.summary);
    update.summary = summary;
  }

  if (hasOwn("recap")) {
    const recap = normalizeString(typedValue.recap);
    update.recap = recap;
  }

  if (hasOwn("activeQuests")) {
    const activeQuests = normalizeStringList(typedValue.activeQuests);
    update.activeQuests = activeQuests;
  }

  if (hasOwn("completedQuests")) {
    const completedQuests = normalizeStringList(typedValue.completedQuests);
    update.completedQuests = completedQuests;
  }

  if (hasOwn("completedQuestsAdd")) {
    const completedQuestsAdd = normalizeStringList(typedValue.completedQuestsAdd);
    update.completedQuestsAdd = completedQuestsAdd;
  }

  if (hasOwn("journalAdd")) {
    const journalAdd = normalizeStringList(typedValue.journalAdd);
    update.journalAdd = journalAdd;
  }

  if (hasOwn("reputation")) {
    const reputation = normalizeReputationList(typedValue.reputation);
    update.reputation = reputation;
  }

  if (hasOwn("sharedInventory")) {
    const sharedInventory = normalizeStringList(typedValue.sharedInventory);
    update.sharedInventory = sharedInventory;
  }

  return update;
}

export function applyPartyUpdate(
  currentValue: unknown,
  updateValue: PartyUpdateInstruction,
): PartyState {
  const currentState = normalizePartyState(currentValue);
  const nextState: PartyState = {
    ...currentState,
  };

  if (typeof updateValue.partyName === "string") {
    nextState.partyName = updateValue.partyName;
  }

  if (typeof updateValue.narrationLevel === "string") {
    nextState.narrationLevel = normalizeNarrationLevel(updateValue.narrationLevel);
  }

  if (typeof updateValue.summary === "string") {
    nextState.summary = updateValue.summary;
  }

  if (typeof updateValue.recap === "string") {
    nextState.recap = updateValue.recap;
  }

  if (Array.isArray(updateValue.activeQuests)) {
    nextState.activeQuests = dedupeStringList(updateValue.activeQuests);
  }

  if (Array.isArray(updateValue.completedQuests)) {
    nextState.completedQuests = dedupeStringList(updateValue.completedQuests);
  }

  if (
    Array.isArray(updateValue.completedQuestsAdd) &&
    updateValue.completedQuestsAdd.length > 0
  ) {
    nextState.completedQuests = dedupeStringList([
      ...nextState.completedQuests,
      ...updateValue.completedQuestsAdd,
    ]);
  }

  if (Array.isArray(updateValue.reputation)) {
    nextState.reputation = [...updateValue.reputation];
  }

  if (Array.isArray(updateValue.sharedInventory)) {
    nextState.sharedInventory = dedupeStringList(updateValue.sharedInventory);
  }

  if (Array.isArray(updateValue.journalAdd) && updateValue.journalAdd.length > 0) {
    nextState.journal = [...currentState.journal, ...updateValue.journalAdd];
  }

  const completedQuestKeys = new Set(
    nextState.completedQuests.map((quest) => normalizeQuestKey(quest)),
  );
  nextState.activeQuests = nextState.activeQuests.filter(
    (quest) => !completedQuestKeys.has(normalizeQuestKey(quest)),
  );

  return nextState;
}

export function extractPartyBlock(text: string) {
  const normalized = text.replace(/\r\n/g, "\n");
  const inlineMatch = normalized.match(
    /[*_`>\-\s]*PARTY:\s*([\s\S]*?)\s*[*_`>\-\s]*ENDPARTY/i,
  );

  if (!inlineMatch) {
    return {
      found: false,
      update: {} as PartyUpdateInstruction,
      content: normalized.trim(),
    };
  }

  let update: PartyUpdateInstruction = {};

  try {
    update = normalizePartyUpdate(JSON.parse(inlineMatch[1].trim()));
  } catch {
    update = {};
  }

  return {
    found: true,
    update,
    content: normalized
      .replace(inlineMatch[0], "")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  };
}

export function formatPartyBlock(update: PartyUpdateInstruction) {
  return `PARTY: ${JSON.stringify(update)} ENDPARTY`;
}

export function getNarrationLevelPromptInstruction(level: NarrationLevel) {
  switch (level) {
    case "light":
      return "Use light narration: keep responses very lean and fast. Usually use 1 short paragraph of narration, or 2 at most, plus only the essential mechanical lines. Minimize sensory detail, trim companion banter aggressively, avoid flourish, and get to the consequence immediately.";
    case "medium":
      return "Use medium narration: keep responses balanced but still concise. Usually use 1-2 moderate paragraphs with some scene detail, but avoid extended atmosphere, repeated restatement, or long companion speeches. Be clearly fuller than light, but still noticeably leaner than high.";
    default:
      return "Use high narration: provide the richest scene texture and strongest character flavor. Use fuller sensory detail, stronger companion voice, and more atmospheric description than medium, often across 2-4 paragraphs when the moment supports it, while still advancing the scene promptly.";
  }
}
