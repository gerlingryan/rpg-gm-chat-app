import { openai } from "@/lib/openai";
import { normalizePartyState, type PartyState } from "@/lib/party";

type RecapContext = {
  campaignTitle: string;
  ruleset: string;
  partyState: unknown;
  recentMessages: Array<{
    speakerName: string;
    role: string;
    content: string;
  }>;
};

function buildFallbackRecap(partyState: PartyState) {
  const parts: string[] = [];

  if (partyState.summary) {
    parts.push(partyState.summary);
  }

  if (partyState.activeQuests.length > 0) {
    parts.push(`Active focus: ${partyState.activeQuests.join("; ")}.`);
  }

  const recentJournal = partyState.journal.slice(-3);
  if (recentJournal.length > 0) {
    parts.push(`Recent developments: ${recentJournal.join(" ")}`);
  }

  return parts.join(" ").trim() || "The party is preparing for the next meaningful development.";
}

function buildRecentTranscript(
  recentMessages: RecapContext["recentMessages"],
  limit: number,
) {
  const trimmedMessages = recentMessages.slice(-limit);

  return trimmedMessages
    .map((message) => `${message.speakerName} (${message.role}): ${message.content}`)
    .join("\n");
}

export async function generateCampaignRecap({
  campaignTitle,
  ruleset,
  partyState,
  recentMessages,
}: RecapContext) {
  const normalizedPartyState = normalizePartyState(partyState);
  const fallbackRecap = buildFallbackRecap(normalizedPartyState);
  const transcript = buildRecentTranscript(recentMessages, 10);

  try {
    const response = await openai.responses.create({
      model: "gpt-5.1-mini",
      input: [
        {
          role: "system",
          content: [
            "You compress campaign memory for a tabletop RPG session.",
            "Write a short rolling recap that preserves what currently matters.",
            "Focus on unresolved leads, recent consequences, active threats, and important relationship changes.",
            "Do not include numbered lists, headings, or markdown.",
            "Keep it to 2-4 concise sentences and under 650 characters.",
            "Do not repeat every small action. Favor high-signal memory.",
          ].join(" "),
        },
        {
          role: "user",
          content: [
            `Campaign: ${campaignTitle}`,
            `Ruleset: ${ruleset}`,
            "",
            `Party summary: ${normalizedPartyState.summary || "None"}`,
            `Current recap: ${normalizedPartyState.recap || "None"}`,
            `Active quests: ${normalizedPartyState.activeQuests.join("; ") || "None"}`,
            `Completed quests: ${normalizedPartyState.completedQuests.join("; ") || "None"}`,
            `Recent journal: ${normalizedPartyState.journal.slice(-5).join("; ") || "None"}`,
            "",
            "Recent transcript:",
            transcript || "No recent transcript.",
          ].join("\n"),
        },
      ],
    });

    const recap = (response.output_text ?? "").trim();

    if (!recap) {
      return fallbackRecap;
    }

    return recap.length > 650 ? `${recap.slice(0, 647).trim()}...` : recap;
  } catch {
    return fallbackRecap;
  }
}
