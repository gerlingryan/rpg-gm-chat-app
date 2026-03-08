export const CAMPAIGN_CHAT_MODELS = [
  "gpt-5-mini",
  "gpt-5.1",
  "gpt-4o-mini",
] as const;

export type CampaignChatModel = (typeof CAMPAIGN_CHAT_MODELS)[number];

export const DEFAULT_CAMPAIGN_CHAT_MODEL: CampaignChatModel = "gpt-4o-mini";

export function normalizeCampaignChatModel(value: unknown): CampaignChatModel {
  if (typeof value !== "string") {
    return DEFAULT_CAMPAIGN_CHAT_MODEL;
  }

  const normalizedValue = value.trim().toLowerCase();

  if (normalizedValue === "gpt-5.1") {
    return "gpt-5.1";
  }
  if (normalizedValue === "gpt-4o-mini") {
    return "gpt-4o-mini";
  }

  return DEFAULT_CAMPAIGN_CHAT_MODEL;
}
