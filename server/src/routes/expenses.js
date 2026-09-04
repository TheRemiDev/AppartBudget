import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { computeShares } from "../lib/split.js";

export const expensesRouter = Router();

expensesRouter.use(requireAuth);

const shareConfigSchema = z.object({ userId: z.string(), value: z.number() });

const expenseSchema = z.object({
  label: z.string().min(1).max(120),
  amount: z.number().positive(),
  date: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  kind: z.enum(["fixed", "exceptional"]),
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
  return shares.map((s) => ({ userId: s.userId, amount: s.amount }));
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
      include: {
        category: true,
        createdBy: { select: { id: true, name: true, color: true } },
        shares: { include: { user: { select: { id: true, name: true, color: true } } } },
      },
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
      include: {
        category: true,
        createdBy: { select: { id: true, name: true, color: true } },
        shares: { include: { user: { select: { id: true, name: true, color: true } } } },
      },
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
      include: {
        category: true,
        createdBy: { select: { id: true, name: true, color: true } },
        shares: { include: { user: { select: { id: true, name: true, color: true } } } },
      },
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
      await tx.expenseShare.deleteMany({ where: { expenseId: req.params.id } });
      return tx.expense.update({
        where: { id: req.params.id },
        data: {
          label: payload.label,
          amount: payload.amount,
          date: new Date(payload.date),
          kind: payload.kind,
          notes: payload.notes || null,
          categoryId: payload.categoryId,
          shares: { create: shareData },
        },
        include: {
          category: true,
          createdBy: { select: { id: true, name: true, color: true } },
          shares: { include: { user: { select: { id: true, name: true, color: true } } } },
        },
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

// Chaque membre ne peut confirmer/annuler QUE sa propre part.
expensesRouter.patch(
  "/:id/shares/mine",
  asyncHandler(async (req, res) => {
    const { paid } = z.object({ paid: z.boolean() }).parse(req.body);
    const share = await prisma.expenseShare.findUnique({
      where: { expenseId_userId: { expenseId: req.params.id, userId: req.user.id } },
    });
    if (!share) {
      return res.status(404).json({ error: "Vous n'etes pas concerne par cette depense." });
    }
    const updated = await prisma.expenseShare.update({
      where: { id: share.id },
      data: { paid, paidAt: paid ? new Date() : null },
      include: { user: { select: { id: true, name: true, color: true } } },
    });
    res.json({ share: updated });
  })
);
