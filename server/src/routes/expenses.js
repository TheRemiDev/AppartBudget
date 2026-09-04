import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { computeShares } from "../lib/split.js";
import { recomputeShareStatus, round2 } from "../lib/shares.js";

export const expensesRouter = Router();

expensesRouter.use(requireAuth);

const userSelect = { select: { id: true, name: true, color: true } };

const expenseInclude = {
  category: true,
  createdBy: userSelect,
  shares: {
    include: {
      user: userSelect,
      payments: { orderBy: { date: "desc" }, include: { paidBy: userSelect } },
    },
  },
};

const shareConfigSchema = z.object({ userId: z.string(), value: z.number() });

const expenseSchema = z.object({
  label: z.string().min(1).max(120),
  amount: z.number().positive(),
  date: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  kind: z.enum(["fixed", "occasional", "exceptional"]),
  notes: z.string().max(2000).optional().nullable(),
  categoryId: z.string(),
  splitType: z.enum(["equal", "percentage", "custom"]).default("equal"),
  participantIds: z.array(z.string()).min(1),
  splitConfig: z.array(shareConfigSchema).optional().default([]),
});

async function buildShareData(payload) {
  const shares = computeShares(
    payload.amount,
    payload.splitType,
    payload.participantIds.map((userId) => ({ userId })),
    payload.splitConfig
  );
  // Une part de 0 € n'a rien a regler : elle est consideree soldee des sa
  // creation, pour ne jamais demander une confirmation inutile.
  return shares.map((s) => {
    const settled = s.amount <= 0.005;
    return { userId: s.userId, amount: s.amount, paid: settled, paidAt: settled ? new Date() : null };
  });
}

async function findShareInExpense(expenseId, shareId) {
  const share = await prisma.expenseShare.findUnique({ where: { id: shareId } });
  if (!share || share.expenseId !== expenseId) return null;
  return share;
}

async function userPublic(id) {
  return prisma.user.findUnique({ where: { id }, select: { id: true, name: true, color: true } });
}

expensesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { from, to, categoryId, kind } = req.query;
    const where = {};
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(from);
      if (to) where.date.lte = new Date(to);
    }
    if (categoryId) where.categoryId = categoryId;
    if (kind) where.kind = kind;

    const expenses = await prisma.expense.findMany({
      where,
      include: expenseInclude,
      orderBy: { date: "desc" },
    });
    res.json({ expenses });
  })
);

expensesRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const expense = await prisma.expense.findUnique({
      where: { id: req.params.id },
      include: expenseInclude,
    });
    if (!expense) return res.status(404).json({ error: "Depense introuvable." });
    res.json({ expense });
  })
);

expensesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const payload = expenseSchema.parse(req.body);
    const shareData = await buildShareData(payload);

    const expense = await prisma.expense.create({
      data: {
        label: payload.label,
        amount: payload.amount,
        date: new Date(payload.date),
        kind: payload.kind,
        notes: payload.notes || null,
        categoryId: payload.categoryId,
        createdById: req.user.id,
        shares: { create: shareData },
      },
      include: expenseInclude,
    });
    res.status(201).json({ expense });
  })
);

expensesRouter.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const payload = expenseSchema.parse(req.body);
    const shareData = await buildShareData(payload);

    const expense = await prisma.$transaction(async (tx) => {
      const existingShares = await tx.expenseShare.findMany({ where: { expenseId: req.params.id } });
      const existingByUser = new Map(existingShares.map((s) => [s.userId, s]));
      const nextUserIds = new Set(shareData.map((s) => s.userId));

      // Retire les participants qui ne font plus partie de la depense
      // (supprime aussi leurs versements en cascade).
      for (const old of existingShares) {
        if (!nextUserIds.has(old.userId)) {
          await tx.expenseShare.delete({ where: { id: old.id } });
        }
      }

      // Met a jour le montant des parts existantes (en conservant leur
      // historique de versements) et cree les nouvelles.
      for (const s of shareData) {
        const existing = existingByUser.get(s.userId);
        if (existing) {
          await tx.expenseShare.update({ where: { id: existing.id }, data: { amount: s.amount } });
          await recomputeShareStatus(tx, existing.id);
        } else {
          await tx.expenseShare.create({
            data: {
              expenseId: req.params.id,
              userId: s.userId,
              amount: s.amount,
              paid: s.paid,
              paidAt: s.paidAt,
            },
          });
        }
      }

      return tx.expense.update({
        where: { id: req.params.id },
        data: {
          label: payload.label,
          amount: payload.amount,
          date: new Date(payload.date),
          kind: payload.kind,
          notes: payload.notes || null,
          categoryId: payload.categoryId,
        },
        include: expenseInclude,
      });
    });
    res.json({ expense });
  })
);

expensesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await prisma.expense.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  })
);

// Chaque membre du foyer peut regler N'IMPORTE QUELLE part (la sienne ou
// celle de l'autre, par exemple pour la couvrir un mois difficile). Le
// versement garde toujours la trace de qui l'a reellement effectue
// (paidByUserId), independamment de la personne a qui appartient la part.
//
// paid:true solde en un versement le reste a payer ; paid:false annule et
// supprime tous les versements enregistres sur cette part.
expensesRouter.patch(
  "/:id/shares/:shareId",
  asyncHandler(async (req, res) => {
    const { paid } = z.object({ paid: z.boolean() }).parse(req.body);
    const share = await findShareInExpense(req.params.id, req.params.shareId);
    if (!share) {
      return res.status(404).json({ error: "Part introuvable pour cette dépense." });
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (paid) {
        const payments = await tx.sharePayment.findMany({ where: { shareId: share.id } });
        const remaining = round2(share.amount - payments.reduce((s, p) => s + p.amount, 0));
        if (remaining > 0.005) {
          await tx.sharePayment.create({
            data: { shareId: share.id, amount: remaining, paidByUserId: req.user.id },
          });
        }
      } else {
        await tx.sharePayment.deleteMany({ where: { shareId: share.id } });
      }
      return recomputeShareStatus(tx, share.id);
    });

    res.json({ share: { ...updated, user: await userPublic(share.userId) } });
  })
);

const paymentSchema = z.object({
  amount: z.number().positive(),
  note: z.string().max(300).optional().nullable(),
  date: z
    .string()
    .datetime()
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
    .optional(),
});

// Enregistre un versement partiel (ou total) sur une part, effectue par
// l'utilisateur connecte (qui peut donc payer pour l'autre membre du foyer).
expensesRouter.post(
  "/:id/shares/:shareId/payments",
  asyncHandler(async (req, res) => {
    const { amount, note, date } = paymentSchema.parse(req.body);
    const share = await findShareInExpense(req.params.id, req.params.shareId);
    if (!share) {
      return res.status(404).json({ error: "Part introuvable pour cette dépense." });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.sharePayment.findMany({ where: { shareId: share.id } });
      const alreadyPaid = existing.reduce((s, p) => s + p.amount, 0);
      const remaining = round2(share.amount - alreadyPaid);
      if (round2(amount) - remaining > 0.005) {
        const err = new Error(
          `Ce montant dépasse le reste à payer (${remaining.toFixed(2)} €).`
        );
        err.status = 400;
        throw err;
      }
      await tx.sharePayment.create({
        data: {
          shareId: share.id,
          amount: round2(amount),
          note: note || null,
          paidByUserId: req.user.id,
          ...(date ? { date: new Date(date) } : {}),
        },
      });
      return recomputeShareStatus(tx, share.id);
    });

    res.status(201).json({ share: { ...updated, user: await userPublic(share.userId) } });
  })
);

// Annule (supprime) un versement precedemment enregistre sur une part.
expensesRouter.delete(
  "/:id/shares/:shareId/payments/:paymentId",
  asyncHandler(async (req, res) => {
    const share = await findShareInExpense(req.params.id, req.params.shareId);
    if (!share) {
      return res.status(404).json({ error: "Part introuvable pour cette dépense." });
    }
    const payment = await prisma.sharePayment.findUnique({ where: { id: req.params.paymentId } });
    if (!payment || payment.shareId !== share.id) {
      return res.status(404).json({ error: "Versement introuvable." });
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.sharePayment.delete({ where: { id: payment.id } });
      return recomputeShareStatus(tx, share.id);
    });

    res.json({ share: { ...updated, user: await userPublic(share.userId) } });
  })
);
