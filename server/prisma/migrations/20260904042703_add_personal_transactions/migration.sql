-- CreateTable
CREATE TABLE "PersonalTransaction" (
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PersonalTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PersonalTransaction_userId_idx" ON "PersonalTransaction"("userId");

-- CreateIndex
CREATE INDEX "PersonalTransaction_date_idx" ON "PersonalTransaction"("date");

-- CreateIndex
CREATE INDEX "PersonalTransaction_groupId_idx" ON "PersonalTransaction"("groupId");
