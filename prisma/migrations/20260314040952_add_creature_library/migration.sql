-- AlterTable
ALTER TABLE "BattleMapTemplate" ALTER COLUMN "playerSpawnTilesJson" DROP DEFAULT,
ALTER COLUMN "enemySpawnTilesJson" DROP DEFAULT;

-- CreateTable
CREATE TABLE "CreatureLibraryEntry" (
    "id" TEXT NOT NULL,
    "ruleset" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'open5e',
    "sourceId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aliasesJson" JSONB,
    "size" TEXT,
    "creatureType" TEXT,
    "subtype" TEXT,
    "alignment" TEXT,
    "acJson" JSONB,
    "hpFormula" TEXT,
    "hpAvg" INTEGER,
    "speedJson" JSONB,
    "abilityModsJson" JSONB,
    "attackProfilesJson" JSONB,
    "cr" TEXT,
    "xpDerived" INTEGER,
    "tagsJson" JSONB,
    "rawJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatureLibraryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CreatureLibraryEntry_ruleset_creatureType_cr_idx" ON "CreatureLibraryEntry"("ruleset", "creatureType", "cr");

-- CreateIndex
CREATE INDEX "CreatureLibraryEntry_name_idx" ON "CreatureLibraryEntry"("name");

-- CreateIndex
CREATE UNIQUE INDEX "CreatureLibraryEntry_ruleset_source_sourceId_key" ON "CreatureLibraryEntry"("ruleset", "source", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "CreatureLibraryEntry_ruleset_slug_key" ON "CreatureLibraryEntry"("ruleset", "slug");
