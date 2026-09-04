-- CreateTable
CREATE TABLE "SharePayment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shareId" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "paidByUserId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SharePayment_shareId_fkey" FOREIGN KEY ("shareId") REFERENCES "ExpenseShare" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SharePayment_paidByUserId_fkey" FOREIGN KEY ("paidByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "SharePayment_shareId_idx" ON "SharePayment"("shareId");

-- CreateIndex
CREATE INDEX "SharePayment_paidByUserId_idx" ON "SharePayment"("paidByUserId");
