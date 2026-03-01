import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { openai } from "@/lib/openai";
import { extractSceneBlock, formatSceneBlock, stripSceneBlock } from "@/lib/scene";

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

type CharacterUpdateInstruction = {
  name: string;
  sheet?: Record<string, unknown>;
  memorySummary?: string;
};

function extractStateBlock(text: string) {
  const normalized = text.replace(/\r\n/g, "\n");
  const inlineMatch = normalized.match(/STATE:\s*([\s\S]*?)\s*ENDSTATE/i);

  if (!inlineMatch) {
    return {
      updates: [] as CharacterUpdateInstruction[],
      content: normalized.trim(),
    };
  }

  const blockText = inlineMatch[1].trim();
  let updates: CharacterUpdateInstruction[] = [];

  try {
    const parsed = JSON.parse(blockText);
    if (Array.isArray(parsed)) {
      updates = parsed
        .filter(
          (entry) =>
            entry &&
            typeof entry === "object" &&
            !Array.isArray(entry) &&
            typeof (entry as { name?: unknown }).name === "string",
        )
        .map((entry) => {
          const typedEntry = entry as {
            name: string;
            sheet?: unknown;
            memorySummary?: unknown;
          };

          return {
            name: typedEntry.name.trim(),
            sheet:
              typedEntry.sheet &&
              typeof typedEntry.sheet === "object" &&
              !Array.isArray(typedEntry.sheet)
                ? (typedEntry.sheet as Record<string, unknown>)
                : undefined,
            memorySummary:
              typeof typedEntry.memorySummary === "string"
                ? typedEntry.memorySummary.trim()
                : undefined,
          };
        })
        .filter((entry) => entry.name);
    }
  } catch {
    updates = [];
  }

  return {
    updates,
    content: normalized
      .replace(inlineMatch[0], "")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  };
}

function mergeSheetData(currentValue: unknown, patchValue: unknown): unknown {
  if (
    !currentValue ||
    typeof currentValue !== "object" ||
    Array.isArray(currentValue) ||
    !patchValue ||
    typeof patchValue !== "object" ||
    Array.isArray(patchValue)
  ) {
    return patchValue;
  }

  const mergedEntries = new Map<string, unknown>(
    Object.entries(currentValue as Record<string, unknown>),
  );

  for (const [key, value] of Object.entries(patchValue as Record<string, unknown>)) {
    const existingValue = mergedEntries.get(key);
    mergedEntries.set(key, mergeSheetData(existingValue, value));
  }

  return Object.fromEntries(mergedEntries);
}

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
    .map((character) => {
        const lines = [
          `${character.isMainCharacter ? "Main Character" : "Party Character"}: ${character.name}`,
          `Role: ${character.role}`,
          `Memory: ${
            character.memorySummary
              ? truncatePromptText(character.memorySummary, 180)
              : "None"
          }`,
          "Sheet:",
          formatCharacterSheet(character.sheetJson),
        ];

      return lines.join("\n");
    })
    .join("\n\n");
}

function buildRecentTranscript(campaign: {
  messages: Array<{
    speakerName: string;
    role: string;
    content: string;
  }>;
}) {
  if (campaign.messages.length === 0) {
    return "No prior messages.";
  }

  return campaign.messages
    .slice(-10)
    .map(
      (message) =>
        `${message.speakerName} (${message.role}): ${
          extractStateBlock(stripSceneBlock(message.content)).content
        }`,
    )
    .join("\n");
}

type ParsedResponseMessage = {
  speakerName: string;
  role: "gm" | "companion";
  content: string;
};

function inferStateUpdatesFromNarration(
  messages: ParsedResponseMessage[],
  campaign: {
    characters: Array<{
      name: string;
      isMainCharacter: boolean;
    }>;
  },
) {
  const combinedText = messages.map((message) => message.content).join("\n");
  const updates: CharacterUpdateInstruction[] = [];

  const pushHpUpdate = (name: string, nextHp: number) => {
    if (!Number.isFinite(nextHp)) {
      return;
    }

    const existingUpdate = updates.find(
      (update) => update.name.toLowerCase() === name.toLowerCase(),
    );

    if (existingUpdate) {
      existingUpdate.sheet = mergeSheetData(existingUpdate.sheet, {
        hp: { current: nextHp },
      }) as Record<string, unknown>;
      return;
    }

    updates.push({
      name,
      sheet: {
        hp: { current: nextHp },
      },
    });
  };

  for (const character of campaign.characters) {
    const escapedName = character.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const namedHpMatch = combinedText.match(
      new RegExp(
        `${escapedName}(?:'s)?[^\\n.]*?\\bhp\\s+(?:goes\\s+from\\s+\\d+\\s+to|is\\s+now|now)\\s+(\\d+)`,
        "i",
      ),
    );

    if (namedHpMatch?.[1]) {
      pushHpUpdate(character.name, Number(namedHpMatch[1]));
    }
  }

  if (updates.length === 0) {
    const genericHpMatch = combinedText.match(
      /\bhp\s+(?:goes\s+from\s+\d+\s+to|is\s+now|now)\s+(\d+)/i,
    );
    const mainCharacter = campaign.characters.find(
      (character) => character.isMainCharacter,
    );

    if (genericHpMatch?.[1] && mainCharacter) {
      pushHpUpdate(mainCharacter.name, Number(genericHpMatch[1]));
    }
  }

  return updates;
}

function parseResponseMessages(
  text: string,
  companionNames: string[],
): ParsedResponseMessage[] {
  const trimmed = text.trim();

  if (!trimmed) {
    return [
      {
        speakerName: "GM",
        role: "gm",
        content: "The GM pauses, uncertain how to respond.",
      },
    ];
  }

  const normalized = trimmed.replace(/\r\n/g, "\n");
  const blockPattern = /^(GM|COMPANION:([^\n]+)):\s*/gm;
  const matches = Array.from(normalized.matchAll(blockPattern));

  if (matches.length === 0) {
    return [
      {
        speakerName: "GM",
        role: "gm",
        content: trimmed,
      },
    ];
  }

  const parsedMessages: ParsedResponseMessage[] = [];

  for (let index = 0; index < matches.length; index += 1) {
    const currentMatch = matches[index];
    const nextMatch = matches[index + 1];
    const start = currentMatch.index ?? 0;
    const contentStart = start + currentMatch[0].length;
    const contentEnd = nextMatch?.index ?? normalized.length;
    const content = normalized.slice(contentStart, contentEnd).trim();

    if (!content) {
      continue;
    }

    if (currentMatch[1] === "GM") {
      parsedMessages.push({
        speakerName: "GM",
        role: "gm",
        content,
      });
      continue;
    }

    const requestedName = (currentMatch[2] ?? "").trim();
    const matchedCompanionName =
      companionNames.find(
        (name) => name.toLowerCase() === requestedName.toLowerCase(),
      ) ?? requestedName;

    parsedMessages.push({
      speakerName: matchedCompanionName || "Companion",
      role: "companion",
      content,
    });
  }

  return parsedMessages.length > 0
    ? parsedMessages
    : [
        {
          speakerName: "GM",
          role: "gm",
          content: trimmed,
        },
      ];
}

function buildFallbackSceneSummary(campaign: {
  title: string;
  messages: Array<{ content: string }>;
}) {
  const priorGmContent = [...campaign.messages]
    .reverse()
    .map((message) => extractSceneBlock(message.content).scene)
    .find(Boolean);

  if (priorGmContent) {
    return priorGmContent;
  }

  return {
    sceneTitle: campaign.title || "Current Scene",
    location: "Current Area",
    mood: "Tense",
    threat: "Low Threat",
    goal: "Decide the next move",
    clock: "No visible timer",
    context: "Active scene",
  };
}

export async function POST(req: NextRequest) {
  const { campaignId, message } = await req.json();

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: {
      characters: true,
      messages: { orderBy: { createdAt: "asc" }, take: 20 },
    },
  });

  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const characterSummary = buildCharacterSummary(campaign);
  const recentTranscript = buildRecentTranscript(campaign);
  const mainCharacterName =
    campaign.characters.find((character) => character.isMainCharacter)?.name ??
    "Player";
  const companionNames = campaign.characters
    .filter((character) => !character.isMainCharacter)
    .map((character) => character.name);

  const response = await openai.responses.create({
    model: "gpt-5.1",
    input: [
      {
        role: "system",
        content: [
          "You are the GM for a tabletop RPG session.",
          "You must stay consistent with the campaign ruleset and the saved character sheets.",
          "Treat the main character's stored class, stats, traits, and resources as canonical.",
          "Treat each character's saved background and personality as canonical guidance for how they behave, what choices they prefer, and how they respond under stress.",
          "When companions act or speak, make those choices fit their saved background and personality instead of treating them as generic helpers.",
          "When the player attempts something, consider what their sheet supports before narrating outcomes.",
          "You make every roll on behalf of the player and the world; never ask the player to roll dice.",
          "When a roll matters, state it explicitly using the word Roll and include the exact numeric result.",
          "Always show the dice expression and the total, such as `Roll: Athletics check d20(14) + 5 = 19`.",
          "For contested checks, opposed checks, attacks, saves, or damage, show both sides' exact numbers when relevant.",
          "Do not say a roll was good, bad, enough, or not enough without also giving the actual rolled values and totals.",
          "When immediate risk appears, use the word Danger.",
          "When recovery, healing, or a clear positive gain occurs, use the word Heals or Success.",
          "When the character notices, understands, or learns something important, use the word Realizes.",
          "Prefer a compact structure: narration first, then short mechanical lines when needed.",
          "Begin every response with a structured scene block using this exact format:",
          "SCENE:",
          "Title: <short action-oriented scene title>",
          "Place: <short place name>",
          "Mood: <brief mood>",
          "Threat: <brief threat>",
          "Goal: <current objective>",
          "Clock: <current urgency or timer>",
          "Context: <key NPCs, factions, or tags>",
          "ENDSCENE",
          "After the scene block, include a hidden state block using this exact format:",
          "STATE:",
          '[{"name":"Exact Character Name","sheet":{"hp":{"current":9}},"memorySummary":"optional short update"}]',
          "ENDSTATE",
          "This STATE block is required on every response, even if no values changed.",
          "Use exact existing character names only.",
          "Inside the state block, include only characters whose stored sheet or memory should change this turn.",
          "Use canonical absolute values in sheet updates, not damage deltas. Example: set current hp to the new total, not minus 3.",
          "If narration says hp changed, wounds changed, sanity changed, hunger changed, or another tracked resource changed, you must include that exact updated value in the STATE block.",
          "Do not describe a stat or resource change only in prose without also updating it in STATE.",
          "The STATE block is hidden bookkeeping for the app and should always be valid JSON.",
          "If no character sheet changes this turn, return an empty array inside the state block.",
          "Format your reply as one or more tagged blocks.",
          "Use `GM:` for narration and rulings.",
          "Whenever a named companion speaks, reacts, comments, or takes an action independently, put that in a separate block using `COMPANION:Name:`.",
          "Do not bury companion dialogue or companion actions inside a GM block if a companion is involved.",
          "If a companion contributes, split that contribution into its own tagged block.",
          "Only use companion blocks for companions that exist in the campaign.",
          "When it is the main character's turn to act or speak, end the GM block with four or five numbered options on separate lines using the format `1. ...`, `2. ...`, and so on.",
          "Those options should be concrete actions, questions, or responses the player could plausibly choose next.",
          "Even when you provide numbered options, the player may still choose something else, so do not frame them as mandatory.",
          "Return concise in-world narration plus any immediate mechanical consequence that matters.",
        ].join(" "),
      },
      {
        role: "user",
        content: [
          `Campaign title: ${campaign.title}`,
          `Campaign ruleset: ${campaign.ruleset}`,
          "",
          "Characters:",
          characterSummary,
          "",
          "Recent transcript:",
          recentTranscript,
          "",
          `New player action: ${message}`,
        ].join("\n"),
      },
    ],
  });

  const text =
    response.output_text ?? "The GM pauses, uncertain how to respond.";
  const extractedScene = extractSceneBlock(text);
  const extractedState = extractStateBlock(extractedScene.content);
  const parsedMessages = parseResponseMessages(extractedState.content, companionNames);
  const stateUpdates =
    extractedState.updates.length > 0
      ? extractedState.updates
      : inferStateUpdatesFromNarration(parsedMessages, campaign);
  const sceneBlock = formatSceneBlock(
    extractedScene.scene ?? buildFallbackSceneSummary(campaign),
  );

  await prisma.message.create({
    data: {
      campaignId,
      speakerName: mainCharacterName,
      role: "user",
      content: message,
    },
  });

  const updatedCharacters = [...campaign.characters];

  const characterUpdateOperations = stateUpdates
    .map((updateInstruction) => {
      const matchingCharacter = updatedCharacters.find(
        (character) =>
          character.name.toLowerCase() === updateInstruction.name.toLowerCase(),
      );

      if (!matchingCharacter) {
        return null;
      }

      const nextSheetJson = updateInstruction.sheet
        ? mergeSheetData(matchingCharacter.sheetJson, updateInstruction.sheet)
        : matchingCharacter.sheetJson;
      const nextMemorySummary =
        typeof updateInstruction.memorySummary === "string" &&
        updateInstruction.memorySummary
          ? updateInstruction.memorySummary
          : matchingCharacter.memorySummary;

      return prisma.character.update({
        where: { id: matchingCharacter.id },
        data: {
          sheetJson: nextSheetJson,
          memorySummary: nextMemorySummary,
        },
      });
    })
    .filter(Boolean);

  const persistedCharacterUpdates = characterUpdateOperations.length
    ? await prisma.$transaction(characterUpdateOperations)
    : [];

  for (const updatedCharacter of persistedCharacterUpdates) {
    const index = updatedCharacters.findIndex(
      (character) => character.id === updatedCharacter.id,
    );

    if (index >= 0) {
      updatedCharacters[index] = updatedCharacter;
    }
  }

  const createdMessages = await prisma.$transaction(
    parsedMessages.map((parsedMessage, index) => {
      const content =
        parsedMessage.role === "gm" && index === 0
          ? `${sceneBlock}\n\n${parsedMessage.content}`
          : parsedMessage.content;

      return prisma.message.create({
        data: {
          campaignId,
          speakerName: parsedMessage.speakerName,
          role: parsedMessage.role,
          content,
        },
      });
    }),
  );

  return NextResponse.json({
    reply: createdMessages[0]?.content ?? text,
    messages: createdMessages,
    characters: updatedCharacters,
  });
}
