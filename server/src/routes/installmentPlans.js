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
  totalAmount: z.number().positive(),
  installmentCount: z.number().int().min(2).max(60),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.string().datetime()),
  categoryId: z.string(),
  splitType: z.enum(["equal", "percentage", "custom"]).default("equal"),
  participantIds: z.array(z.string()).min(1),
  splitConfig: z.array(shareConfigSchema).optional().default([]),
});

// Repartit un montant total en N mensualites qui different d'au plus 1
// centime entre elles et dont la somme est strictement egale au total.
function splitIntoInstallments(totalAmount, count) {
  const totalCents = Math.round(totalAmount * 100);
  const base = Math.floor(totalCents / count);
  let remainder = totalCents - base * count;
  const amounts = [];
  for (let i = 0; i < count; i++) {
    const extra = remainder > 0 ? 1 : 0;
    if (remainder > 0) remainder -= 1;
    amounts.push(Math.round(base + extra) / 100);
  }
  return amounts;
}

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
      const nominal = round2(payload.totalAmount / payload.installmentCount);
      const totalCustom = payload.splitConfig.reduce((s, c) => s + c.value, 0);
      if (Math.abs(totalCustom - nominal) > 0.01) {
        return res.status(400).json({
          error: `La somme des montants personnalises doit correspondre a la mensualite (${nominal.toFixed(2)} €).`,
        });
      }
    }

    const installmentAmounts = splitIntoInstallments(payload.totalAmount, payload.installmentCount);
    const nominalAmount = round2(payload.totalAmount / payload.installmentCount);
    const percentageConfig = toPercentageConfig(
      payload.splitType,
      payload.participantIds,
      payload.splitConfig,
      nominalAmount
    );
    const participants = payload.participantIds.map((userId) => ({ userId }));

    const start = new Date(payload.startDate);
    const startDay = Math.min(start.getDate(), 28);

    const plan = await prisma.$transaction(async (tx) => {
      const created = await tx.installmentPlan.create({
        data: {
          label: payload.label,
          totalAmount: payload.totalAmount,
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

function serializePlan(plan) {
  const paidAmount = plan.expenses.reduce((sum, e) => {
    const expensePaid = e.shares.reduce((s, share) => {
      const sharePaid = share.payments.reduce((sp, p) => sp + p.amount, 0);
      return s + Math.min(sharePaid, share.amount);
    }, 0);
    return sum + expensePaid;
  }, 0);
  const paidInstallments = plan.expenses.filter((e) => e.shares.every((s) => s.paid)).length;

  return {
    id: plan.id,
    label: plan.label,
    totalAmount: plan.totalAmount,
    installmentCount: plan.installmentCount,
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
