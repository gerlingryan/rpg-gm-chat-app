-- AlterTable
ALTER TABLE "Character" ADD COLUMN     "originLibraryCharacterId" TEXT;

-- CreateTable
CREATE TABLE "LibraryCharacter" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ruleset" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'player',
    "sheetJson" JSONB NOT NULL,
    "memorySummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LibraryCharacter_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_originLibraryCharacterId_fkey" FOREIGN KEY ("originLibraryCharacterId") REFERENCES "LibraryCharacter"("id") ON DELETE SET NULL ON UPDATE CASCADE;
