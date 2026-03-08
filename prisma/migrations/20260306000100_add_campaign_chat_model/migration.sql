-- Add per-campaign chat model selection with mini as the default.
ALTER TABLE "Campaign"
ADD COLUMN "chatModel" TEXT NOT NULL DEFAULT 'gpt-5-mini';
