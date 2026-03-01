import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { openai } from "@/lib/openai";
import { extractSceneBlock, formatSceneBlock } from "@/lib/scene";

const PROMPT_HIDDEN_SHEET_KEYS = new Set([
  "source",
  "portraitDataUrl",
]);

const PROMPT_TRUNCATED_SHEET_KEYS = new Set([
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

  const visibleEntries = Object.entries(sheetJson as Record<string, unknown>).filter(
    ([key]) => !PROMPT_HIDDEN_SHEET_KEYS.has(key),
  );

  if (visibleEntries.length === 0) {
    return "No saved sheet data.";
  }

  return visibleEntries
    .map(([key, value]) => {
      if (PROMPT_TRUNCATED_SHEET_KEYS.has(key) && typeof value === "string") {
        return `${key}: ${truncatePromptText(value, 160)}`;
      }

      return `${key}: ${formatValue(value)}`;
    })
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

  if (!scenarioMessage) {
    return NextResponse.json({ error: "Scenario message not found" }, { status: 400 });
  }

  if (action === "reset") {
    await prisma.message.deleteMany({
      where: {
        campaignId: id,
        id: {
          not: scenarioMessage.id,
        },
      },
    });

    return NextResponse.json({
      messages: [scenarioMessage],
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
          "Write one concise but flavorful opening narration that establishes immediate stakes.",
          "End with four or five numbered options on separate lines using the format `1. ...`, `2. ...`, and so on.",
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
    })}\n\nGM:\n${scenarioMessage.content} The situation sharpens around the party.\n1. Press the issue\n2. Ask a question\n3. Take cover\n4. Read the room`;
  const extractedScene = extractSceneBlock(text);
  const sceneBlock = formatSceneBlock(extractedScene.scene ?? {
    sceneTitle: campaign.title || "Opening Scene",
    location: "Current Area",
    mood: "Tense",
    threat: "Low Threat",
    goal: "Assess the situation",
    clock: "No visible timer",
    context: "Active scene",
  });
  const visibleContent = extractedScene.content.replace(/^GM:\s*/i, "").trim();

  const gmMessage = await prisma.message.create({
    data: {
      campaignId: id,
      speakerName: "GM",
      role: "gm",
      content: `${sceneBlock}\n\n${visibleContent}`,
    },
  });

  return NextResponse.json({
    messages: [...campaign.messages, gmMessage],
    started: true,
  });
}
