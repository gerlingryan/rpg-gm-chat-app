import {
  type CampaignBootstrap,
  type CampaignBootstrapClue,
  type CampaignBootstrapClock,
  type CampaignBootstrapExpansionEvent,
  type CampaignBootstrapExpansionEventKind,
  type CampaignBootstrapQuest,
  type CampaignQuestStatus,
  type CampaignVisibility,
} from "@/lib/campaign-bootstrap";

type ClockAdvanceInstruction = {
  id?: string;
  name?: string;
  delta?: number;
  current?: number;
};

type QuestUpdateInstruction = {
  id?: string;
  title?: string;
  status?: CampaignQuestStatus;
  visibility?: CampaignVisibility;
  objective?: string;
  addStep?: string;
  addLead?: string;
};

export type CampaignBootstrapTurnUpdate = {
  scene_title?: string;
  objective?: string;
  clocks_advanced?: ClockAdvanceInstruction[];
  quest_updates?: QuestUpdateInstruction[];
  clues_revealed?: string[];
  new_clue?: {
    id?: string;
    text?: string;
    visibility?: CampaignVisibility;
  };
  loop_breaker_reason?: string;
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asOptionalNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed);
    }
  }
  return undefined;
}

function normalizeVisibility(value: unknown): CampaignVisibility | undefined {
  const text = asString(value).toLowerCase();
  if (
    text === "player" ||
    text === "teased" ||
    text === "gm_hidden" ||
    text === "debug_only"
  ) {
    return text;
  }
  return undefined;
}

function normalizeQuestStatus(value: unknown): CampaignQuestStatus | undefined {
  const text = asString(value).toLowerCase();
  if (text === "dormant" || text === "active" || text === "completed" || text === "failed") {
    return text;
  }
  return undefined;
}

export function extractCampaignBootstrapBlock(text: string) {
  const normalized = text.replace(/\r\n/g, "\n");
  const inlineMatch = normalized.match(
    /[*_`>\-\s]*BOOTSTRAP:\s*([\s\S]*?)\s*[*_`>\-\s]*ENDBOOTSTRAP/i,
  );

  if (!inlineMatch) {
    return {
      found: false,
      update: {} as CampaignBootstrapTurnUpdate,
      content: normalized.trim(),
    };
  }

  const jsonText = inlineMatch[1].trim();
  let update: CampaignBootstrapTurnUpdate = {};
  try {
    const parsed = JSON.parse(jsonText);
    update = normalizeCampaignBootstrapTurnUpdate(parsed);
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

export function formatCampaignBootstrapBlock(update: CampaignBootstrapTurnUpdate) {
  return `BOOTSTRAP: ${JSON.stringify(update)} ENDBOOTSTRAP`;
}

export function normalizeCampaignBootstrapTurnUpdate(
  value: unknown,
): CampaignBootstrapTurnUpdate {
  const typed = asObject(value);
  if (!typed) {
    return {};
  }

  const clocks_advanced = Array.isArray(typed.clocks_advanced)
    ? typed.clocks_advanced
        .map((entry) => {
          const typedEntry = asObject(entry);
          if (!typedEntry) {
            return null;
          }
          const id = asString(typedEntry.id);
          const name = asString(typedEntry.name);
          const delta = asOptionalNumber(typedEntry.delta);
          const current = asOptionalNumber(typedEntry.current);
          if (!id && !name) {
            return null;
          }
          if (delta === undefined && current === undefined) {
            return null;
          }
          return {
            ...(id ? { id } : {}),
            ...(name ? { name } : {}),
            ...(delta !== undefined ? { delta } : {}),
            ...(current !== undefined ? { current } : {}),
          } satisfies ClockAdvanceInstruction;
        })
        .filter((entry): entry is ClockAdvanceInstruction => Boolean(entry))
    : undefined;

  const quest_updates = Array.isArray(typed.quest_updates)
    ? typed.quest_updates
        .map((entry) => {
          const typedEntry = asObject(entry);
          if (!typedEntry) {
            return null;
          }
          const id = asString(typedEntry.id);
          const title = asString(typedEntry.title);
          if (!id && !title) {
            return null;
          }
          const status = normalizeQuestStatus(typedEntry.status);
          const visibility = normalizeVisibility(typedEntry.visibility);
          const objective = asString(typedEntry.objective);
          const addStep = asString(typedEntry.addStep);
          const addLead = asString(typedEntry.addLead);

          return {
            ...(id ? { id } : {}),
            ...(title ? { title } : {}),
            ...(status ? { status } : {}),
            ...(visibility ? { visibility } : {}),
            ...(objective ? { objective } : {}),
            ...(addStep ? { addStep } : {}),
            ...(addLead ? { addLead } : {}),
          } satisfies QuestUpdateInstruction;
        })
        .filter((entry): entry is QuestUpdateInstruction => Boolean(entry))
    : undefined;

  const clues_revealed = Array.isArray(typed.clues_revealed)
    ? typed.clues_revealed
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : undefined;

  const newClueValue = asObject(typed.new_clue);
  const new_clue = newClueValue
    ? {
        id: asString(newClueValue.id) || undefined,
        text: asString(newClueValue.text) || undefined,
        visibility: normalizeVisibility(newClueValue.visibility) ?? undefined,
      }
    : undefined;

  return {
    scene_title: asString(typed.scene_title) || undefined,
    objective: asString(typed.objective) || undefined,
    ...(clocks_advanced && clocks_advanced.length > 0 ? { clocks_advanced } : {}),
    ...(quest_updates && quest_updates.length > 0 ? { quest_updates } : {}),
    ...(clues_revealed && clues_revealed.length > 0 ? { clues_revealed } : {}),
    ...(new_clue?.text ? { new_clue } : {}),
    loop_breaker_reason: asString(typed.loop_breaker_reason) || undefined,
  };
}

function findClockIndex(
  clocks: CampaignBootstrapClock[],
  instruction: ClockAdvanceInstruction,
) {
  const id = instruction.id?.toLowerCase();
  const name = instruction.name?.toLowerCase();
  return clocks.findIndex((clock) => {
    if (id && clock.id.toLowerCase() === id) {
      return true;
    }
    if (name && clock.name.toLowerCase() === name) {
      return true;
    }
    return false;
  });
}

function findQuestIndex(
  quests: CampaignBootstrapQuest[],
  instruction: QuestUpdateInstruction,
) {
  const id = instruction.id?.toLowerCase();
  const title = instruction.title?.toLowerCase();
  return quests.findIndex((quest) => {
    if (id && quest.id.toLowerCase() === id) {
      return true;
    }
    if (title && quest.title.toLowerCase() === title) {
      return true;
    }
    return false;
  });
}

function dedupeStringList(values: string[]) {
  return [...new Set(values.map((entry) => entry.trim()).filter(Boolean))];
}

function normalizeQuestVisibilityForProgression(
  quest: CampaignBootstrapQuest,
): CampaignBootstrapQuest {
  if (
    (quest.status === "active" ||
      quest.status === "completed" ||
      quest.status === "failed") &&
    quest.visibility === "teased"
  ) {
    return {
      ...quest,
      visibility: "player",
    };
  }
  return quest;
}

function getPrimaryQuestIndex(quests: CampaignBootstrapQuest[]) {
  const activeMainIndex = quests.findIndex(
    (quest) => quest.status === "active" && quest.type === "main",
  );
  if (activeMainIndex >= 0) {
    return activeMainIndex;
  }
  const activeAnyIndex = quests.findIndex((quest) => quest.status === "active");
  if (activeAnyIndex >= 0) {
    return activeAnyIndex;
  }
  return quests.findIndex((quest) => quest.type === "main");
}

function appendExpansionEvent(
  events: CampaignBootstrapExpansionEvent[],
  params: {
    text: string;
    kind: CampaignBootstrapExpansionEventKind;
    visibility?: CampaignVisibility;
  },
) {
  const text = params.text.trim();
  if (!text) {
    return events;
  }
  const next = [
    ...events,
    {
      id: `EV${events.length + 1}_${Date.now()}`,
      text,
      kind: params.kind,
      createdAt: new Date().toISOString(),
      visibility: params.visibility ?? "player",
    } satisfies CampaignBootstrapExpansionEvent,
  ];
  return next.slice(-24);
}

export function applyCampaignBootstrapTurnUpdate(
  bootstrap: CampaignBootstrap,
  update: CampaignBootstrapTurnUpdate,
) {
  const next: CampaignBootstrap = {
    ...bootstrap,
    campaign: { ...bootstrap.campaign },
    arc_hidden: {
      ...bootstrap.arc_hidden,
      milestones: [...bootstrap.arc_hidden.milestones],
    },
    quests: bootstrap.quests.map((entry) => ({
      ...entry,
      steps: [...entry.steps],
      leads: [...entry.leads],
    })),
    clocks: bootstrap.clocks.map((entry) => ({ ...entry })),
    npcs: bootstrap.npcs.map((entry) => ({ ...entry })),
    locations: bootstrap.locations.map((entry) => ({ ...entry })),
    clues: bootstrap.clues.map((entry) => ({ ...entry })),
    twists: bootstrap.twists.map((entry) => ({ ...entry })),
    expansion_events: bootstrap.expansion_events.map((entry) => ({ ...entry })),
    gm_notes: {
      ...bootstrap.gm_notes,
      unresolved_clues: [...bootstrap.gm_notes.unresolved_clues],
      offscreen_pressure: [...bootstrap.gm_notes.offscreen_pressure],
      hidden_secrets_remaining: [...bootstrap.gm_notes.hidden_secrets_remaining],
    },
  };

  const expandedQuestSteps: string[] = [];
  const expandedQuestLeads: string[] = [];
  const expandedSideQuests: CampaignBootstrapQuest[] = [];

  if (update.objective) {
    next.gm_notes.current_objective = update.objective;
    next.campaign.party_goal_public = update.objective;
  }

  if (Array.isArray(update.clocks_advanced)) {
    for (const instruction of update.clocks_advanced) {
      const index = findClockIndex(next.clocks, instruction);
      if (index < 0) {
        continue;
      }
      const clock = next.clocks[index];
      const max = Math.max(1, clock.max);
      const previousCurrent = clock.current;
      const computedCurrent =
        typeof instruction.current === "number"
          ? instruction.current
          : clock.current + (instruction.delta ?? 0);
      clock.current = Math.max(0, Math.min(max, Math.trunc(computedCurrent)));
      const halfThreshold = Math.ceil(max / 2);
      if (previousCurrent < halfThreshold && clock.current >= halfThreshold) {
        const pressureText = `Pressure rising: ${clock.name} is now ${clock.current}/${clock.max}.`;
        expandedQuestSteps.push(pressureText);
        next.expansion_events = appendExpansionEvent(next.expansion_events, {
          text: pressureText,
          kind: "clock",
        });
      }
      if (previousCurrent < max && clock.current >= max) {
        const urgentText = `Urgent: ${clock.name} reached trigger threshold (${clock.trigger}).`;
        expandedQuestSteps.push(urgentText);
        expandedQuestLeads.push(`${clock.name} trigger: ${clock.trigger}`);
        next.expansion_events = appendExpansionEvent(next.expansion_events, {
          text: urgentText,
          kind: "clock",
        });
        const clockQuestId = `QCLK_${clock.id}`;
        if (!next.quests.some((quest) => quest.id.toLowerCase() === clockQuestId.toLowerCase())) {
          const clockQuest = {
            id: clockQuestId,
            title: `${clock.name} Crisis`,
            type: "side",
            status: "active",
            visibility: "player",
            objective: `Address fallout from ${clock.name}.`,
            steps: [clock.trigger],
            leads: [`Clock ${clock.id}`],
            stakes: `If ignored, ${clock.trigger}`,
            rewards: "Stabilized situation and reduced pressure.",
          } satisfies CampaignBootstrapQuest;
          expandedSideQuests.push(clockQuest);
          next.expansion_events = appendExpansionEvent(next.expansion_events, {
            text: `New crisis quest unlocked: ${clockQuest.title}.`,
            kind: "quest_created",
          });
        }
      }
      next.clocks[index] = clock;
    }
  }

  if (Array.isArray(update.quest_updates)) {
    for (const instruction of update.quest_updates) {
      const index = findQuestIndex(next.quests, instruction);
      if (index < 0) {
        if (!instruction.title) {
          continue;
        }

        const inferredStatus: CampaignQuestStatus = instruction.status ?? "active";
        const inferredVisibility: CampaignVisibility =
          instruction.visibility ??
          (inferredStatus === "active" ||
          inferredStatus === "completed" ||
          inferredStatus === "failed"
            ? "player"
            : "teased");

        const createdQuest = normalizeQuestVisibilityForProgression({
          id: instruction.id?.trim() || `Q${next.quests.length + 1}`,
          title: instruction.title,
          type: "side",
          status: inferredStatus,
          visibility: inferredVisibility,
          objective: instruction.objective ?? "",
          steps: instruction.addStep ? [instruction.addStep] : [],
          leads: instruction.addLead ? [instruction.addLead] : [],
          stakes: "",
          rewards: "",
        });
        next.quests.push(createdQuest);
        next.expansion_events = appendExpansionEvent(next.expansion_events, {
          text: `New quest added: ${createdQuest.title}.`,
          kind: "quest_created",
        });
        continue;
      }
      const quest = { ...next.quests[index] };
      if (instruction.title) {
        quest.title = instruction.title;
      }
      if (instruction.status) {
        quest.status = instruction.status;
      }
      if (instruction.visibility) {
        quest.visibility = instruction.visibility;
      }
      if (instruction.objective) {
        quest.objective = instruction.objective;
      }
      if (instruction.addStep) {
        quest.steps = dedupeStringList([...quest.steps, instruction.addStep]);
        next.expansion_events = appendExpansionEvent(next.expansion_events, {
          text: `${quest.title}: ${instruction.addStep}`,
          kind: "quest_step",
        });
      }
      if (instruction.addLead) {
        quest.leads = dedupeStringList([...quest.leads, instruction.addLead]);
        next.expansion_events = appendExpansionEvent(next.expansion_events, {
          text: `${quest.title} lead: ${instruction.addLead}`,
          kind: "quest_lead",
        });
      }
      next.quests[index] = normalizeQuestVisibilityForProgression(quest);
    }
  }

  if (Array.isArray(update.clues_revealed) && update.clues_revealed.length > 0) {
    const lowered = update.clues_revealed.map((entry) => entry.toLowerCase());
    next.clues = next.clues.map((clue) => {
      if (
        lowered.includes(clue.id.toLowerCase()) ||
        lowered.includes(clue.text.toLowerCase())
      ) {
        return {
          ...clue,
          revealed: true,
          visibility:
            clue.visibility === "gm_hidden" || clue.visibility === "debug_only"
              ? "player"
              : clue.visibility,
        };
      }
      return clue;
    });
    const revealedClues = next.clues.filter(
      (clue) =>
        clue.revealed &&
        (lowered.includes(clue.id.toLowerCase()) || lowered.includes(clue.text.toLowerCase())),
    );
    for (const clue of revealedClues) {
      expandedQuestSteps.push(`Investigate clue ${clue.id}: ${clue.text}`);
      expandedQuestLeads.push(`${clue.id}: ${clue.text}`);
      next.expansion_events = appendExpansionEvent(next.expansion_events, {
        text: `New clue revealed (${clue.id}): ${clue.text}`,
        kind: "clue",
      });
    }
    next.gm_notes.unresolved_clues = dedupeStringList(
      next.gm_notes.unresolved_clues.filter(
        (entry) => !lowered.includes(entry.toLowerCase()),
      ),
    );
  }

  if (update.new_clue?.text) {
    const clueId = update.new_clue.id?.trim() || `CL${next.clues.length + 1}`;
    const newClue: CampaignBootstrapClue = {
      id: clueId,
      text: update.new_clue.text,
      revealed: false,
      visibility: update.new_clue.visibility ?? "gm_hidden",
    };
    if (!next.clues.some((clue) => clue.id.toLowerCase() === clueId.toLowerCase())) {
      next.clues.push(newClue);
      next.gm_notes.unresolved_clues = dedupeStringList([
        ...next.gm_notes.unresolved_clues,
        newClue.id,
      ]);
    }
  }

  if (update.loop_breaker_reason) {
    next.gm_notes.offscreen_pressure = dedupeStringList([
      ...next.gm_notes.offscreen_pressure,
      `Loop-break: ${update.loop_breaker_reason}`,
    ]);
  }

  if (expandedQuestSteps.length > 0 || expandedQuestLeads.length > 0) {
    const primaryQuestIndex = getPrimaryQuestIndex(next.quests);
    if (primaryQuestIndex >= 0) {
      const quest = { ...next.quests[primaryQuestIndex] };
      quest.steps = dedupeStringList([...quest.steps, ...expandedQuestSteps]);
      quest.leads = dedupeStringList([...quest.leads, ...expandedQuestLeads]);
      next.quests[primaryQuestIndex] = normalizeQuestVisibilityForProgression(quest);
    }
  }

  if (expandedSideQuests.length > 0) {
    next.quests = [...next.quests, ...expandedSideQuests];
  }

  return next;
}
