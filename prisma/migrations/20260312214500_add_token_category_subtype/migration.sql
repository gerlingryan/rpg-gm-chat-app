-- AlterTable
ALTER TABLE "TokenLibraryEntry"
ADD COLUMN "category" TEXT NOT NULL DEFAULT 'general',
ADD COLUMN "subtype" TEXT;

-- CreateIndex
CREATE INDEX "TokenLibraryEntry_ruleset_category_subtype_idx" ON "TokenLibraryEntry"("ruleset", "category", "subtype");
