-- CreateTable
CREATE TABLE "RecurringGeneration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "templateId" TEXT NOT NULL,
    "templateKind" TEXT NOT NULL,
    "yearMonth" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "RecurringGeneration_templateId_idx" ON "RecurringGeneration"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringGeneration_templateId_yearMonth_key" ON "RecurringGeneration"("templateId", "yearMonth");
