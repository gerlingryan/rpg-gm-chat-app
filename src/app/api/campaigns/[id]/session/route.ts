import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { openai } from "@/lib/openai";
import { deriveBehaviorSummary } from "@/lib/campaigns";
import { extractSceneBlock, formatSceneBlock } from "@/lib/scene";
import {
  appendSceneImageHistory,
  generateSceneMap,
  normalizeSceneImageHistory,
  normalizeSceneMapState,
} from "@/lib/map";
import {
  applyPartyUpdate,
  extractPartyBlock,
  formatPartyBlock,
  formatPartyStateForPrompt,
  getNarrationLevelPromptInstruction,
  normalizePartyState,
} from "@/lib/party";
import { DEFAULT_COMBAT_STATE } from "@/lib/combat";
import { generateCampaignRecap } from "@/lib/recap";

const PROMPT_HIDDEN_SHEET_KEYS = new Set([
  "source",
  "portraitDataUrl",
  "background",
  "physicalDescription",
  "personality",
]);

function truncatePromptText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3).trim()}...`;
}

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function formatValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((entry) => formatValue(entry)).join(", ");
  }

  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, nestedValue]) => `${key}: ${formatValue(nestedValue)}`)
      .join("; ");
  }

  return String(value);
}

function formatCharacterSheet(sheetJson: unknown) {
  if (!sheetJson || typeof sheetJson !== "object" || Array.isArray(sheetJson)) {
    return "No saved sheet data.";
  }

  const typedSheet = sheetJson as Record<string, unknown>;
  const promptSheet = {
    ...typedSheet,
    behaviorSummary:
      typeof typedSheet.behaviorSummary === "string" && typedSheet.behaviorSummary.trim()
        ? typedSheet.behaviorSummary.trim()
        : deriveBehaviorSummary(typedSheet),
  };
  const visibleEntries = Object.entries(promptSheet).filter(
    ([key]) => !PROMPT_HIDDEN_SHEET_KEYS.has(key),
  );

  if (visibleEntries.length === 0) {
    return "No saved sheet data.";
  }

  return visibleEntries
    .map(([key, value]) => `${key}: ${formatValue(value)}`)
    .join("\n");
}

function buildCharacterSummary(campaign: {
  characters: Array<{
    name: string;
    role: string;
    isMainCharacter: boolean;
    memorySummary: string | null;
    sheetJson: unknown;
  }>;
}) {
  if (campaign.characters.length === 0) {
    return "No characters are defined.";
  }

  return campaign.characters
    .map((character) =>
      [
        `${character.isMainCharacter ? "Main Character" : "Party Character"}: ${character.name}`,
        `Role: ${character.role}`,
        `Memory: ${
          character.memorySummary
            ? truncatePromptText(character.memorySummary, 180)
            : "None"
        }`,
        "Sheet:",
        formatCharacterSheet(character.sheetJson),
      ].join("\n"),
    )
    .join("\n\n");
}

function clearTransientEffects(sheetJson: unknown) {
  const currentSheet =
    sheetJson && typeof sheetJson === "object" && !Array.isArray(sheetJson)
      ? (sheetJson as Record<string, unknown>)
      : {};

  return {
    ...currentSheet,
    statusEffects: [],
    temporaryBuffs: [],
    temporaryDebuffs: [],
  };
}

function clearResettablePartyState(partyStateJson: unknown) {
  const currentPartyState = normalizePartyState(partyStateJson);

  return {
    ...currentPartyState,
    recap: "",
    activeQuests: [],
    completedQuests: [],
    journal: [],
  };
}

export async function POST(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const body = await req.json();
  const action = body.action === "reset" ? "reset" : "start";

  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: {
      characters: true,
      messages: {
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const scenarioMessage = campaign.messages[0];
  const narrationLevel = normalizePartyState(
    (campaign as { partyStateJson?: unknown }).partyStateJson,
  ).narrationLevel;

  if (!scenarioMessage) {
    return NextResponse.json({ error: "Scenario message not found" }, { status: 400 });
  }

  if (action === "reset") {
    const resetPartyState = clearResettablePartyState(
      (campaign as { partyStateJson?: unknown }).partyStateJson,
    );
    const resetCharacters = await prisma.$transaction([
      prisma.campaign.update({
        where: { id },
        data: {
          partyStateJson: resetPartyState,
          combatStateJson: DEFAULT_COMBAT_STATE,
          mapStateJson: null,
          sceneImageHistoryJson: null,
        } as never,
      }),
      prisma.message.deleteMany({
        where: {
          campaignId: id,
          id: {
            not: scenarioMessage.id,
          },
        },
      }),
      ...campaign.characters.map((character) =>
        prisma.character.update({
          where: { id: character.id },
          data: {
            sheetJson: clearTransientEffects(character.sheetJson),
          },
        }),
      ),
    ]);
    const updatedCharacters = resetCharacters.slice(2);

    return NextResponse.json({
      messages: [scenarioMessage],
      characters: updatedCharacters,
      partyStateJson: resetPartyState,
      combatStateJson: DEFAULT_COMBAT_STATE,
      mapStateJson: null,
      sceneImageHistoryJson: [],
      started: false,
    });
  }

  if (campaign.messages.length > 1) {
    return NextResponse.json({
      messages: campaign.messages,
      started: true,
    });
  }

  const response = await openai.responses.create({
    model: "gpt-5.1",
    input: [
      {
        role: "system",
        content: [
          "You are the GM for a tabletop RPG session.",
          "Expand the supplied starting scenario into a vivid opening scene.",
          "Use the campaign ruleset and saved character sheets as the basis for the setup.",
          "Begin with a structured scene block using this exact format:",
          "SCENE:",
          "Title: <short action-oriented scene title>",
          "Place: <short place name>",
          "Mood: <brief mood>",
          "Threat: <brief threat>",
          "Goal: <current objective>",
          "Clock: <current urgency or timer>",
          "Context: <key NPCs, factions, or tags>",
          "ENDSCENE",
          "After the scene block, include a hidden party-state block using this exact format:",
          "PARTY:",
          '{"activeQuests":["<active quest>"],"completedQuestsAdd":["<newly completed quest>"],"journalAdd":["<new journal entry>"],"reputation":[{"name":"<faction>","score":0,"status":"Neutral","notes":["<reputation note>"]}]}',
          "ENDPARTY",
          "This PARTY block is required on every response, even if no party values changed.",
          "If no party state changed, return PARTY: {} ENDPARTY.",
          "Allowed PARTY keys are partyName, summary, recap, activeQuests, completedQuests, completedQuestsAdd, journalAdd, reputation, and sharedInventory.",
          "Reputation entries must be objects with name, score, status, and notes.",
          getNarrationLevelPromptInstruction(narrationLevel),
          "Narration level changes descriptive density only; it must not slow scene progression.",
          "Write one concise but flavorful opening narration that establishes immediate stakes.",
          "End with exactly four numbered options on separate lines using the format `1. ...`, `2. ...`, and so on.",
          "Those options should be concrete actions, questions, or responses the player could plausibly choose next.",
          "Even when you provide numbered options, the player may still choose something else, so do not frame them as mandatory.",
        ].join(" "),
      },
      {
        role: "user",
        content: [
          `Campaign title: ${campaign.title}`,
          `Campaign ruleset: ${campaign.ruleset}`,
          "",
          "Party state:",
          formatPartyStateForPrompt(
            (campaign as { partyStateJson?: unknown }).partyStateJson,
          ),
          "",
          "Starting scenario:",
          scenarioMessage.content,
          "",
          "Characters:",
          buildCharacterSummary(campaign),
        ].join("\n"),
      },
    ],
  });

  const text =
    response.output_text ??
    `${formatSceneBlock({
      sceneTitle: campaign.title || "Opening Scene",
      location: "Current Area",
      mood: "Tense",
      threat: "Low Threat",
      goal: "Assess the situation",
      clock: "No visible timer",
      context: "Active scene",
    })}\n\n${formatPartyBlock({})}\n\nGM:\n${scenarioMessage.content} The situation sharpens around the party.\n1. Press the issue\n2. Ask a question\n3. Take cover\n4. Read the room`;
  const extractedScene = extractSceneBlock(text);
  const extractedParty = extractPartyBlock(extractedScene.content);
  const sceneBlock = formatSceneBlock(extractedScene.scene ?? {
    sceneTitle: campaign.title || "Opening Scene",
    location: "Current Area",
    mood: "Tense",
    threat: "Low Threat",
    goal: "Assess the situation",
    clock: "No visible timer",
      context: "Active scene",
  });
  const persistedPartyBlock = formatPartyBlock(extractedParty.update);
  const visibleContent = extractedParty.content.replace(/^GM:\s*/i, "").trim();
  const updatedPartyState = applyPartyUpdate(
    (campaign as { partyStateJson?: unknown }).partyStateJson,
    extractedParty.update,
  );
  const recappedPartyState = {
    ...updatedPartyState,
    recap: await generateCampaignRecap({
      campaignTitle: campaign.title,
      ruleset: campaign.ruleset,
      partyState: updatedPartyState,
      recentMessages: [
        ...campaign.messages.map((message) => ({
          speakerName: message.speakerName,
          role: message.role,
          content: message.content,
        })),
        {
          speakerName: "GM",
          role: "gm",
          content: visibleContent,
        },
      ],
    }),
  };

  const [, gmMessage] = await prisma.$transaction([
    prisma.campaign.update({
      where: { id },
      data: {
        partyStateJson: recappedPartyState,
      } as never,
    }),
    prisma.message.create({
      data: {
        campaignId: id,
        speakerName: "GM",
        role: "gm",
        content: `${sceneBlock}\n\n${persistedPartyBlock}\n\n${visibleContent}`,
      },
    }),
  ]);

  const generatedMap = await generateSceneMap({
    ruleset: campaign.ruleset,
    campaignTitle: campaign.title,
    latestGmContent: gmMessage.content,
  });
  const sceneImageHistory = appendSceneImageHistory(
    (campaign as { sceneImageHistoryJson?: unknown }).sceneImageHistoryJson,
    generatedMap,
  );

  await prisma.campaign.update({
    where: { id },
    data: {
      mapStateJson: generatedMap,
      sceneImageHistoryJson: sceneImageHistory,
    } as never,
  });

  return NextResponse.json({
    messages: [...campaign.messages, gmMessage],
    partyStateJson: recappedPartyState,
    mapStateJson: normalizeSceneMapState(generatedMap),
    sceneImageHistoryJson: normalizeSceneImageHistory(sceneImageHistory),
    started: true,
  });
}
