import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";

export const backupRouter = Router();

backupRouter.use(requireAuth);

const EXPORT_VERSION = 1;

// Ordre d'export sans importance (pas de contrainte a la lecture), mais on
// reutilise le meme ordre de champs pour l'import : voir plus bas pour
// l'ordre de creation/suppression, qui lui doit respecter les cles etrangeres.
backupRouter.get(
  "/export",
  asyncHandler(async (req, res) => {
    const [
      users,
      categories,
      recurringTemplates,
      installmentPlans,
      personalRecurringTemplates,
      expenses,
      expenseShares,
      sharePayments,
      personalTransactions,
      recurringGenerations,
    ] = await Promise.all([
      prisma.user.findMany(),
      prisma.category.findMany(),
      prisma.recurringTemplate.findMany(),
      prisma.installmentPlan.findMany(),
      prisma.personalRecurringTemplate.findMany(),
      prisma.expense.findMany(),
      prisma.expenseShare.findMany(),
      prisma.sharePayment.findMany(),
      prisma.personalTransaction.findMany(),
      prisma.recurringGeneration.findMany(),
    ]);

    const filename = `appartbudget-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    res.json({
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      data: {
        users,
        categories,
        recurringTemplates,
        installmentPlans,
        personalRecurringTemplates,
        expenses,
        expenseShares,
        sharePayments,
        personalTransactions,
        recurringGenerations,
      },
    });
  })
);

const arr = () => z.array(z.record(z.any())).optional().default([]);

const importSchema = z.object({
  version: z.number().optional(),
  data: z.object({
    users: arr(),
    categories: arr(),
    recurringTemplates: arr(),
    installmentPlans: arr(),
    personalRecurringTemplates: arr(),
    expenses: arr(),
    expenseShares: arr(),
    sharePayments: arr(),
    personalTransactions: arr(),
    recurringGenerations: arr(),
  }),
});

// Remplace INTEGRALEMENT toutes les donnees de l'application par celles du
// fichier fourni (export precedent). Operation destructive et irreversible :
// a n'utiliser que pour migrer l'application vers une nouvelle installation
// (le client affiche une confirmation forte avant d'appeler cette route).
backupRouter.post(
  "/import",
  asyncHandler(async (req, res) => {
    const { data } = importSchema.parse(req.body);

    // Les dates arrivent en chaines JSON : Prisma attend des objets Date.
    function withDates(rows, dateFields) {
      return rows.map((row) => {
        const copy = { ...row };
        for (const field of dateFields) {
          if (copy[field] != null) copy[field] = new Date(copy[field]);
        }
        return copy;
      });
    }

    await prisma.$transaction(async (tx) => {
      // Suppression dans l'ordre inverse des dependances (enfants d'abord).
      await tx.recurringGeneration.deleteMany();
      await tx.personalTransaction.deleteMany();
      await tx.sharePayment.deleteMany();
      await tx.expenseShare.deleteMany();
      await tx.expense.deleteMany();
      await tx.personalRecurringTemplate.deleteMany();
      await tx.installmentPlan.deleteMany();
      await tx.recurringTemplate.deleteMany();
      await tx.category.deleteMany();
      await tx.user.deleteMany();

      // Recreation dans l'ordre des dependances (parents d'abord).
      if (data.users.length) {
        await tx.user.createMany({ data: withDates(data.users, ["createdAt", "updatedAt"]) });
      }
      if (data.categories.length) {
        await tx.category.createMany({ data: withDates(data.categories, ["createdAt", "updatedAt"]) });
      }
      if (data.recurringTemplates.length) {
        await tx.recurringTemplate.createMany({
          data: withDates(data.recurringTemplates, ["createdAt", "updatedAt"]),
        });
      }
      if (data.installmentPlans.length) {
        await tx.installmentPlan.createMany({ data: withDates(data.installmentPlans, ["createdAt"]) });
      }
      if (data.personalRecurringTemplates.length) {
        await tx.personalRecurringTemplate.createMany({
          data: withDates(data.personalRecurringTemplates, ["createdAt", "updatedAt"]),
        });
      }
      if (data.expenses.length) {
        await tx.expense.createMany({ data: withDates(data.expenses, ["date", "createdAt", "updatedAt"]) });
      }
      if (data.expenseShares.length) {
        await tx.expenseShare.createMany({ data: withDates(data.expenseShares, ["paidAt"]) });
      }
      if (data.sharePayments.length) {
        await tx.sharePayment.createMany({ data: withDates(data.sharePayments, ["date", "createdAt"]) });
      }
      if (data.personalTransactions.length) {
        await tx.personalTransaction.createMany({
          data: withDates(data.personalTransactions, ["date", "createdAt"]),
        });
      }
      if (data.recurringGenerations.length) {
        await tx.recurringGeneration.createMany({ data: withDates(data.recurringGenerations, ["createdAt"]) });
      }
    });

    res.json({ ok: true });
  })
);
