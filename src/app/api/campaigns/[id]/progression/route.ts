import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  buildProgressionInsights,
  buildProgressionStateFromEvents,
  getDefaultProgressionCurrencyForRuleset,
  normalizeProgressionEvents,
  normalizeProgressionState,
  type ProgressionCurrency,
  type ProgressionEvent,
} from "@/lib/progression";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function normalizeEventCurrency(value: unknown): ProgressionCurrency {
  return value === "bounty" ? "bounty" : "xp";
}

function parseEventAmount(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed);
    }
  }

  return 0;
}

export async function GET(_req: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: {
      characters: {
        select: {
          id: true,
          sheetJson: true,
        },
      },
    },
  });

  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const events = normalizeProgressionEvents(
    (campaign as { progressionEventsJson?: unknown }).progressionEventsJson,
  );
  const normalizedBaseState = normalizeProgressionState(
    (campaign as { progressionStateJson?: unknown }).progressionStateJson,
  );
  const state = buildProgressionStateFromEvents({
    events,
    characterIds: campaign.characters.map((character) => character.id),
    baseState: {
      ...normalizedBaseState,
      currency:
        (campaign as { progressionStateJson?: unknown }).progressionStateJson == null
          ? getDefaultProgressionCurrencyForRuleset(campaign.ruleset)
          : normalizedBaseState.currency,
    },
  });

  return NextResponse.json({
    progressionStateJson: state,
    progressionEventsJson: events,
    progressionInsights: buildProgressionInsights({
      ruleset: campaign.ruleset,
      state,
      characters: campaign.characters.map((character) => ({
        id: character.id,
        sheetJson:
          character.sheetJson &&
          typeof character.sheetJson === "object" &&
          !Array.isArray(character.sheetJson)
            ? (character.sheetJson as Record<string, unknown>)
            : null,
      })),
    }),
  });
}

export async function POST(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const rawBody = await req.json();
  const body =
    rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
      ? (rawBody as Record<string, unknown>)
      : {};

  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: {
      characters: {
        select: {
          id: true,
          sheetJson: true,
        },
      },
    },
  });

  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) {
    return NextResponse.json({ error: "Reason is required." }, { status: 400 });
  }

  const amount = parseEventAmount(body.amount);
  if (amount === 0) {
    return NextResponse.json(
      { error: "Amount must be a non-zero number." },
      { status: 400 },
    );
  }

  const recipientType = body.recipientType === "character" ? "character" : "party";
  const campaignCharacterIds = new Set(campaign.characters.map((character) => character.id));
  const characterIds = Array.isArray(body.characterIds)
    ? body.characterIds
        .filter(
          (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
        )
        .map((entry) => entry.trim())
        .filter((entry) => campaignCharacterIds.has(entry))
    : [];

  if (recipientType === "character" && characterIds.length === 0) {
    return NextResponse.json(
      { error: "At least one valid campaign character is required for character awards." },
      { status: 400 },
    );
  }

  const events = normalizeProgressionEvents(
    (campaign as { progressionEventsJson?: unknown }).progressionEventsJson,
  );
  const nextEvent: ProgressionEvent = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    amount,
    reason,
    note: typeof body.note === "string" ? body.note.trim() : "",
    recipientType,
    characterIds: recipientType === "character" ? [...new Set(characterIds)] : [],
    currency: normalizeEventCurrency(body.currency),
  };
  const nextEvents = [...events, nextEvent];
  const nextState = buildProgressionStateFromEvents({
    events: nextEvents,
    characterIds: campaign.characters.map((character) => character.id),
    baseState: {
      ...normalizeProgressionState(
        (campaign as { progressionStateJson?: unknown }).progressionStateJson,
      ),
      currency:
        (campaign as { progressionStateJson?: unknown }).progressionStateJson == null
          ? getDefaultProgressionCurrencyForRuleset(campaign.ruleset)
          : normalizeProgressionState(
              (campaign as { progressionStateJson?: unknown }).progressionStateJson,
            ).currency,
    },
  });

  await prisma.campaign.update({
    where: { id },
    data: {
      progressionStateJson: nextState,
      progressionEventsJson: nextEvents,
    } as never,
  });

  const nextInsights = buildProgressionInsights({
    ruleset: campaign.ruleset,
    state: nextState,
    characters: campaign.characters.map((character) => ({
      id: character.id,
      sheetJson:
        character.sheetJson &&
        typeof character.sheetJson === "object" &&
        !Array.isArray(character.sheetJson)
          ? (character.sheetJson as Record<string, unknown>)
          : null,
    })),
  });
  const autoUpdates =
    nextState.autoApplyLevels
      ? campaign.characters
          .map((character) => {
            const insight = nextInsights.characters.find(
              (entry) => entry.characterId === character.id,
            );
            if (!insight || !insight.readyToLevel) {
              return null;
            }

            const sheetJson =
              character.sheetJson &&
              typeof character.sheetJson === "object" &&
              !Array.isArray(character.sheetJson)
                ? ({ ...(character.sheetJson as Record<string, unknown>) } as Record<string, unknown>)
                : {};
            sheetJson.level = insight.suggestedLevel;

            return {
              id: character.id,
              sheetJson,
            };
          })
          .filter(
            (update): update is { id: string; sheetJson: Record<string, unknown> } =>
              update !== null,
          )
      : [];

  if (autoUpdates.length > 0) {
    await Promise.all(
      autoUpdates.map((update) =>
        prisma.character.update({
          where: { id: update.id },
          data: {
            sheetJson: update.sheetJson,
          } as never,
        }),
      ),
    );
  }

  const refreshedCharacters =
    autoUpdates.length > 0
      ? await prisma.character.findMany({
          where: { campaignId: id },
          orderBy: [
            { isMainCharacter: "desc" },
            { id: "asc" },
          ],
        })
      : undefined;

  return NextResponse.json({
    progressionStateJson: nextState,
    progressionEventsJson: nextEvents,
    event: nextEvent,
    autoAppliedCount: autoUpdates.length,
    characters: refreshedCharacters,
    progressionInsights: buildProgressionInsights({
      ruleset: campaign.ruleset,
      state: nextState,
      characters: campaign.characters.map((character) => ({
        id: character.id,
        sheetJson:
          character.sheetJson &&
          typeof character.sheetJson === "object" &&
          !Array.isArray(character.sheetJson)
            ? (character.sheetJson as Record<string, unknown>)
            : null,
      })),
    }),
  });
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const rawBody = await req.json();
  const body =
    rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
      ? (rawBody as Record<string, unknown>)
      : {};
  const action = typeof body.action === "string" ? body.action.trim() : "";
  const validActions = new Set([
    "apply-levels",
    "undo-last-event",
    "award-milestone",
    "recalculate-state",
    "reset-all",
  ]);

  if (!validActions.has(action)) {
    return NextResponse.json({ error: "Unsupported progression action." }, { status: 400 });
  }

  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: {
      characters: {
        orderBy: [
          { isMainCharacter: "desc" },
          { id: "asc" },
        ],
      },
    },
  });

  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const progressionEvents = normalizeProgressionEvents(
    (campaign as { progressionEventsJson?: unknown }).progressionEventsJson,
  );
  const progressionState = buildProgressionStateFromEvents({
    events: progressionEvents,
    characterIds: campaign.characters.map((character) => character.id),
    baseState: {
      ...normalizeProgressionState(
        (campaign as { progressionStateJson?: unknown }).progressionStateJson,
      ),
      currency:
        (campaign as { progressionStateJson?: unknown }).progressionStateJson == null
          ? getDefaultProgressionCurrencyForRuleset(campaign.ruleset)
          : normalizeProgressionState(
              (campaign as { progressionStateJson?: unknown }).progressionStateJson,
            ).currency,
    },
  });
  let workingEvents = progressionEvents;
  let workingState = progressionState;

  if (action === "undo-last-event") {
    if (workingEvents.length <= 0) {
      return NextResponse.json({ error: "No progression event to undo." }, { status: 400 });
    }

    workingEvents = workingEvents.slice(0, -1);
    workingState = buildProgressionStateFromEvents({
      events: workingEvents,
      characterIds: campaign.characters.map((character) => character.id),
      baseState: {
        ...normalizeProgressionState(
          (campaign as { progressionStateJson?: unknown }).progressionStateJson,
        ),
        currency:
          (campaign as { progressionStateJson?: unknown }).progressionStateJson == null
            ? getDefaultProgressionCurrencyForRuleset(campaign.ruleset)
            : normalizeProgressionState(
                (campaign as { progressionStateJson?: unknown }).progressionStateJson,
              ).currency,
      },
    });

    await prisma.campaign.update({
      where: { id },
      data: {
        progressionStateJson: workingState,
        progressionEventsJson: workingEvents,
      } as never,
    });
  }

  if (action === "award-milestone") {
    const reason =
      typeof body.reason === "string" && body.reason.trim().length > 0
        ? body.reason.trim()
        : "Milestone reached";
    const recipientType = body.recipientType === "character" ? "character" : "party";
    const campaignCharacterIds = new Set(campaign.characters.map((character) => character.id));
    const characterIds = Array.isArray(body.characterIds)
      ? body.characterIds
          .filter(
            (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
          )
          .map((entry) => entry.trim())
          .filter((entry) => campaignCharacterIds.has(entry))
      : [];

    if (recipientType === "character" && characterIds.length === 0) {
      return NextResponse.json(
        { error: "At least one valid campaign character is required for character milestones." },
        { status: 400 },
      );
    }

    const nextEvent: ProgressionEvent = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      amount: 1,
      reason,
      note: typeof body.note === "string" ? body.note.trim() : "",
      recipientType,
      characterIds: recipientType === "character" ? [...new Set(characterIds)] : [],
      currency: progressionState.currency,
    };
    workingEvents = [...workingEvents, nextEvent];
    workingState = buildProgressionStateFromEvents({
      events: workingEvents,
      characterIds: campaign.characters.map((character) => character.id),
      baseState: {
        ...normalizeProgressionState(
          (campaign as { progressionStateJson?: unknown }).progressionStateJson,
        ),
        mode: "milestone",
        currency: progressionState.currency,
      },
    });

    await prisma.campaign.update({
      where: { id },
      data: {
        progressionStateJson: workingState,
        progressionEventsJson: workingEvents,
      } as never,
    });
  }

  if (action === "recalculate-state") {
    workingState = buildProgressionStateFromEvents({
      events: workingEvents,
      characterIds: campaign.characters.map((character) => character.id),
      baseState: {
        ...normalizeProgressionState(
          (campaign as { progressionStateJson?: unknown }).progressionStateJson,
        ),
        currency:
          (campaign as { progressionStateJson?: unknown }).progressionStateJson == null
            ? getDefaultProgressionCurrencyForRuleset(campaign.ruleset)
            : normalizeProgressionState(
                (campaign as { progressionStateJson?: unknown }).progressionStateJson,
              ).currency,
      },
    });

    await prisma.campaign.update({
      where: { id },
      data: {
        progressionStateJson: workingState,
      } as never,
    });
  }

  if (action === "reset-all") {
    workingEvents = [];
    const baseState = normalizeProgressionState(
      (campaign as { progressionStateJson?: unknown }).progressionStateJson,
    );
    workingState = buildProgressionStateFromEvents({
      events: workingEvents,
      characterIds: campaign.characters.map((character) => character.id),
      baseState: {
        ...baseState,
        currency:
          (campaign as { progressionStateJson?: unknown }).progressionStateJson == null
            ? getDefaultProgressionCurrencyForRuleset(campaign.ruleset)
            : baseState.currency,
      },
    });

    await prisma.campaign.update({
      where: { id },
      data: {
        progressionStateJson: workingState,
        progressionEventsJson: workingEvents,
      } as never,
    });
  }

  const progressionInsights = buildProgressionInsights({
    ruleset: campaign.ruleset,
    state: workingState,
    characters: campaign.characters.map((character) => ({
      id: character.id,
      sheetJson:
        character.sheetJson &&
        typeof character.sheetJson === "object" &&
        !Array.isArray(character.sheetJson)
          ? (character.sheetJson as Record<string, unknown>)
          : null,
    })),
  });

  const byCharacterId = new Map(
    progressionInsights.characters.map((entry) => [entry.characterId, entry]),
  );
  const updates =
    action === "apply-levels" || (action === "award-milestone" && workingState.autoApplyLevels)
      ? campaign.characters
    .map((character) => {
      const insight = byCharacterId.get(character.id);
      if (!insight || !insight.readyToLevel) {
        return null;
      }

      const sheetJson =
        character.sheetJson &&
        typeof character.sheetJson === "object" &&
        !Array.isArray(character.sheetJson)
          ? ({ ...(character.sheetJson as Record<string, unknown>) } as Record<string, unknown>)
          : {};
      sheetJson.level = insight.suggestedLevel;

      return {
        id: character.id,
        sheetJson,
      };
    })
    .filter((update): update is { id: string; sheetJson: Record<string, unknown> } => update !== null)
      : [];

  if (updates.length > 0) {
    await Promise.all(
      updates.map((update) =>
        prisma.character.update({
          where: { id: update.id },
          data: {
            sheetJson: update.sheetJson,
          } as never,
        }),
      ),
    );
  }

  const refreshedCampaign = await prisma.campaign.findUnique({
    where: { id },
    include: {
      characters: {
        orderBy: [
          { isMainCharacter: "desc" },
          { id: "asc" },
        ],
      },
    },
  });

  if (!refreshedCampaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const refreshedEvents = normalizeProgressionEvents(
    (refreshedCampaign as { progressionEventsJson?: unknown }).progressionEventsJson,
  );
  const refreshedState = buildProgressionStateFromEvents({
    events: refreshedEvents,
    characterIds: refreshedCampaign.characters.map((character) => character.id),
    baseState: {
      ...normalizeProgressionState(
        (refreshedCampaign as { progressionStateJson?: unknown }).progressionStateJson,
      ),
      currency:
        (refreshedCampaign as { progressionStateJson?: unknown }).progressionStateJson == null
          ? getDefaultProgressionCurrencyForRuleset(refreshedCampaign.ruleset)
          : normalizeProgressionState(
              (refreshedCampaign as { progressionStateJson?: unknown }).progressionStateJson,
            ).currency,
    },
  });

  return NextResponse.json({
    updatedCount: updates.length,
    characters: refreshedCampaign.characters,
    progressionStateJson: refreshedState,
    progressionEventsJson: refreshedEvents,
    progressionInsights: buildProgressionInsights({
      ruleset: refreshedCampaign.ruleset,
      state: refreshedState,
      characters: refreshedCampaign.characters.map((character) => ({
        id: character.id,
        sheetJson:
          character.sheetJson &&
          typeof character.sheetJson === "object" &&
          !Array.isArray(character.sheetJson)
            ? (character.sheetJson as Record<string, unknown>)
            : null,
      })),
    }),
  });
}
