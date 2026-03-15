-- AlterTable
ALTER TABLE "BattleMapTemplate"
ADD COLUMN "playerSpawnTilesJson" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN "enemySpawnTilesJson" JSONB NOT NULL DEFAULT '[]';
