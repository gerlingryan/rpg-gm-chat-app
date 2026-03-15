-- CreateTable
CREATE TABLE "BattleMapTemplate" (
    "id" TEXT NOT NULL,
    "ruleset" TEXT NOT NULL,
    "locationKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "imageDataUrl" TEXT,
    "referenceUrl" TEXT,
    "gridCols" INTEGER NOT NULL,
    "gridRows" INTEGER NOT NULL,
    "tileSizePx" INTEGER NOT NULL DEFAULT 64,
    "blockedTilesJson" JSONB NOT NULL,
    "tagsJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BattleMapTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BattleMapTemplate_ruleset_locationKey_idx" ON "BattleMapTemplate"("ruleset", "locationKey");

-- CreateIndex
CREATE INDEX "BattleMapTemplate_createdAt_idx" ON "BattleMapTemplate"("createdAt");
