import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { computeShares } from "../lib/split.js";
import { round2 } from "../lib/shares.js";

export const installmentPlansRouter = Router();

installmentPlansRouter.use(requireAuth);

const userSelect = { select: { id: true, name: true, color: true } };

const shareConfigSchema = z.object({ userId: z.string(), value: z.number() });

const planSchema = z.object({
  label: z.string().min(1).max(120),
  // La 1ere mensualite peut differer des suivantes (ex: frais de dossier,
  // acompte majore). Les mensualites 2 a N reprennent toutes le meme
  // montant "restInstallmentAmount".
  firstInstallmentAmount: z.number().positive(),
  restInstallmentAmount: z.number().positive(),
  installmentCount: z.number().int().min(2).max(60),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.string().datetime()),
  categoryId: z.string(),
  splitType: z.enum(["equal", "percentage", "custom"]).default("equal"),
  participantIds: z.array(z.string()).min(1),
  splitConfig: z.array(shareConfigSchema).optional().default([]),
});

// Convertit n'importe quel type de repartition en pourcentages, calcules
// sur la mensualite nominale (total / nombre d'echeances). Applique ensuite
// a chaque mensualite reelle via le mode "percentage" de computeShares, qui
// n'a pas les contraintes de validation exacte du mode "custom" : les
// ecarts d'arrondi entre mensualites (au plus 1 centime) ne posent donc
// jamais de probleme.
function toPercentageConfig(splitType, participantIds, splitConfig, nominalAmount) {
  if (splitType === "percentage") return splitConfig;
  if (splitType === "custom") {
    return splitConfig.map((c) => ({
      userId: c.userId,
      value: nominalAmount > 0 ? (c.value / nominalAmount) * 100 : 0,
    }));
  }
  const pct = 100 / participantIds.length;
  return participantIds.map((userId) => ({ userId, value: pct }));
}

const planInclude = {
  category: true,
  expenses: {
    include: {
      shares: {
        include: {
          user: userSelect,
          payments: { orderBy: { date: "desc" }, include: { paidBy: userSelect } },
        },
      },
    },
    orderBy: { installmentIndex: "asc" },
  },
};

installmentPlansRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const plans = await prisma.installmentPlan.findMany({
      include: planInclude,
      orderBy: { createdAt: "desc" },
    });
    res.json({ plans: plans.map(serializePlan) });
  })
);

installmentPlansRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const payload = planSchema.parse(req.body);

    if (payload.splitType === "percentage") {
      const totalPct = payload.splitConfig.reduce((s, c) => s + c.value, 0);
      if (Math.abs(totalPct - 100) > 0.01) {
        return res.status(400).json({ error: "Les pourcentages doivent totaliser 100%." });
      }
    }
    if (payload.splitType === "custom") {
      const totalCustom = payload.splitConfig.reduce((s, c) => s + c.value, 0);
      if (Math.abs(totalCustom - payload.restInstallmentAmount) > 0.01) {
        return res.status(400).json({
          error: `La somme des montants personnalises doit correspondre a la mensualite standard (${payload.restInstallmentAmount.toFixed(2)} €).`,
        });
      }
    }

    const installmentAmounts = [
      round2(payload.firstInstallmentAmount),
      ...Array(payload.installmentCount - 1).fill(round2(payload.restInstallmentAmount)),
    ];
    const totalAmount = round2(installmentAmounts.reduce((s, a) => s + a, 0));
    const percentageConfig = toPercentageConfig(
      payload.splitType,
      payload.participantIds,
      payload.splitConfig,
      payload.restInstallmentAmount
    );
    const participants = payload.participantIds.map((userId) => ({ userId }));

    const start = new Date(payload.startDate);
    const startDay = Math.min(start.getDate(), 28);

    const plan = await prisma.$transaction(async (tx) => {
      const created = await tx.installmentPlan.create({
        data: {
          label: payload.label,
          totalAmount,
          installmentCount: payload.installmentCount,
          categoryId: payload.categoryId,
          splitType: payload.splitType,
          splitConfig: JSON.stringify(
            payload.splitType === "equal"
              ? payload.participantIds.map((userId) => ({ userId, value: 0 }))
              : payload.splitConfig
          ),
          createdById: req.user.id,
        },
      });

      for (let i = 0; i < payload.installmentCount; i++) {
        const shares = computeShares(installmentAmounts[i], "percentage", participants, percentageConfig);
        const date = new Date(start.getFullYear(), start.getMonth() + i, startDay);
        await tx.expense.create({
          data: {
            label: `${payload.label} (${i + 1}/${payload.installmentCount})`,
            amount: installmentAmounts[i],
            date,
            kind: "fixed",
            categoryId: payload.categoryId,
            createdById: req.user.id,
            installmentPlanId: created.id,
            installmentIndex: i + 1,
            shares: { create: shares.map((s) => ({ userId: s.userId, amount: s.amount })) },
          },
        });
      }

      return tx.installmentPlan.findUnique({ where: { id: created.id }, include: planInclude });
    });

    res.status(201).json({ plan: serializePlan(plan) });
  })
);

// Supprime le plan et TOUTES ses echeances (y compris deja payees et leur
// historique de versements) : a n'utiliser que pour annuler entierement un
// financement. Pour retirer uniquement les echeances futures, il suffit de
// supprimer les depenses correspondantes une a une depuis la page Depenses.
installmentPlansRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await prisma.installmentPlan.delete({ where: { id: req.params.id } }).catch(() => null);
    res.json({ ok: true });
  })
);

// Recree les mensualites manquantes d'un achat echelonne (ex: depense
// supprimee par erreur depuis la page Depenses) a partir des mensualites
// encore presentes : le jour du mois, la repartition et le montant (1ere
// mensualite vs suivantes) sont deduits du plan et des echeances restantes.
installmentPlansRouter.post(
  "/:id/regenerate",
  asyncHandler(async (req, res) => {
    const plan = await prisma.installmentPlan.findUnique({
      where: { id: req.params.id },
      include: { expenses: { orderBy: { installmentIndex: "asc" } } },
    });
    if (!plan) return res.status(404).json({ error: "Achat échelonné introuvable." });
    if (plan.expenses.length === 0) {
      return res.status(400).json({
        error: "Plus aucune mensualité ne subsiste sur ce plan : impossible de reconstituer les dates.",
      });
    }

    const present = new Set(plan.expenses.map((e) => e.installmentIndex));
    const missing = [];
    for (let i = 1; i <= plan.installmentCount; i++) {
      if (!present.has(i)) missing.push(i);
    }
    if (missing.length === 0) {
      return res.json({ created: [] });
    }

    const anchor = plan.expenses[0];
    const anchorDate = new Date(anchor.date);
    const day = anchorDate.getDate();
    const baseYear = anchorDate.getFullYear();
    const baseMonth = anchorDate.getMonth() - (anchor.installmentIndex - 1);

    const splitConfig = JSON.parse(plan.splitConfig);
    const participantIds = splitConfig.map((c) => c.userId);
    const participants = participantIds.map((userId) => ({ userId }));

    const firstRow = plan.expenses.find((e) => e.installmentIndex === 1);
    const laterRow = plan.expenses.find((e) => e.installmentIndex > 1) || plan.expenses[0];
    const percentageConfig = toPercentageConfig(plan.splitType, participantIds, splitConfig, laterRow.amount);

    const created = await prisma.$transaction(
      missing.map((index) => {
        const amount = index === 1 ? firstRow?.amount ?? laterRow.amount : laterRow.amount;
        const shares = computeShares(amount, "percentage", participants, percentageConfig);
        const date = new Date(baseYear, baseMonth + (index - 1), Math.min(day, 28));
        return prisma.expense.create({
          data: {
            label: `${plan.label} (${index}/${plan.installmentCount})`,
            amount,
            date,
            kind: "fixed",
            categoryId: plan.categoryId,
            createdById: req.user.id,
            installmentPlanId: plan.id,
            installmentIndex: index,
            shares: { create: shares.map((s) => ({ userId: s.userId, amount: s.amount })) },
          },
        });
      })
    );

    res.json({ created });
  })
);

function serializePlan(plan) {
  const paidAmount = plan.expenses.reduce((sum, e) => {
    const expensePaid = e.shares.reduce((s, share) => {
      const sharePaid = share.payments.reduce((sp, p) => sp + p.amount, 0);
      return s + Math.min(sharePaid, share.amount);
    }, 0);
    return sum + expensePaid;
  }, 0);
  const paidInstallments = plan.expenses.filter((e) => e.shares.every((s) => s.paid)).length;
  const firstInstallmentAmount = plan.expenses[0]?.amount ?? 0;
  const restInstallmentAmount = plan.expenses[1]?.amount ?? firstInstallmentAmount;

  return {
    id: plan.id,
    label: plan.label,
    totalAmount: plan.totalAmount,
    installmentCount: plan.installmentCount,
    firstInstallmentAmount,
    restInstallmentAmount,
    splitType: plan.splitType,
    splitConfig: JSON.parse(plan.splitConfig),
    category: plan.category,
    createdAt: plan.createdAt,
    paidAmount: round2(paidAmount),
    remainingAmount: round2(plan.totalAmount - paidAmount),
    paidInstallments,
    expenses: plan.expenses,
  };
}
