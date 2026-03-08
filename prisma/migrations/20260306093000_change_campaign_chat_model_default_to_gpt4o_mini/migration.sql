-- Switch default campaign chat model for future campaign inserts.
ALTER TABLE "Campaign"
ALTER COLUMN "chatModel" SET DEFAULT 'gpt-4o-mini';
