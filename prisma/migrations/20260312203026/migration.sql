DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'BattleMapTemplate'
      AND column_name = 'playerSpawnTilesJson'
  ) THEN
    ALTER TABLE "BattleMapTemplate"
      ALTER COLUMN "playerSpawnTilesJson" DROP DEFAULT;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'BattleMapTemplate'
      AND column_name = 'enemySpawnTilesJson'
  ) THEN
    ALTER TABLE "BattleMapTemplate"
      ALTER COLUMN "enemySpawnTilesJson" DROP DEFAULT;
  END IF;
END $$;
