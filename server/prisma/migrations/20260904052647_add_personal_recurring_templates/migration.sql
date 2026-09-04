-- CreateTable
CREATE TABLE "PersonalRecurringTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "kind" TEXT NOT NULL,
    "dayOfMonth" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PersonalRecurringTemplate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PersonalTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "kind" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "note" TEXT,
    "groupId" TEXT,
    "installmentIndex" INTEGER,
    "installmentCount" INTEGER,
    "recurringTemplateId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PersonalTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PersonalTransaction_recurringTemplateId_fkey" FOREIGN KEY ("recurringTemplateId") REFERENCES "PersonalRecurringTemplate" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_PersonalTransaction" ("amount", "createdAt", "date", "groupId", "id", "installmentCount", "installmentIndex", "kind", "label", "note", "userId") SELECT "amount", "createdAt", "date", "groupId", "id", "installmentCount", "installmentIndex", "kind", "label", "note", "userId" FROM "PersonalTransaction";
DROP TABLE "PersonalTransaction";
ALTER TABLE "new_PersonalTransaction" RENAME TO "PersonalTransaction";
CREATE INDEX "PersonalTransaction_userId_idx" ON "PersonalTransaction"("userId");
CREATE INDEX "PersonalTransaction_date_idx" ON "PersonalTransaction"("date");
CREATE INDEX "PersonalTransaction_groupId_idx" ON "PersonalTransaction"("groupId");
CREATE INDEX "PersonalTransaction_recurringTemplateId_idx" ON "PersonalTransaction"("recurringTemplateId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "PersonalRecurringTemplate_userId_idx" ON "PersonalRecurringTemplate"("userId");
