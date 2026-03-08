-- Add campaign progression storage for phase 1 (state + event log).
ALTER TABLE "Campaign"
ADD COLUMN "progressionStateJson" JSONB,
ADD COLUMN "progressionEventsJson" JSONB;
