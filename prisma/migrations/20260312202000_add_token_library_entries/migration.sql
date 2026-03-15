-- CreateTable
CREATE TABLE "TokenLibraryEntry" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "ruleset" TEXT NOT NULL,
    "normalizedKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "style" TEXT NOT NULL,
    "imageDataUrl" TEXT NOT NULL,
    "sourcePrompt" TEXT,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TokenLibraryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TokenLibraryEntry_ruleset_normalizedKey_style_key" ON "TokenLibraryEntry"("ruleset", "normalizedKey", "style");

-- CreateIndex
CREATE INDEX "TokenLibraryEntry_entityType_ruleset_idx" ON "TokenLibraryEntry"("entityType", "ruleset");

-- CreateIndex
CREATE INDEX "TokenLibraryEntry_createdAt_idx" ON "TokenLibraryEntry"("createdAt");
