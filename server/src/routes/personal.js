import { Router } from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { round2 } from "../lib/shares.js";

export const personalRouter = Router();

personalRouter.use(requireAuth);

const rangeSchema = z.object({ from: z.string(), to: z.string(), userId: z.string().optional() });

// Liste + totaux du budget personnel d'un membre sur une periode. userId
// optionnel : permet de consulter le budget de son/sa partenaire
// (transparence dans le foyer), en lecture seule cote client.
personalRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { from, to, userId } = rangeSchema.parse(req.query);
    const targetUserId = userId || req.user.id;

    const transactions = await prisma.personalTransaction.findMany({
      where: { userId: targetUserId, date: { gte: new Date(from), lte: new Date(to) } },
      orderBy: { date: "desc" },
    });

    const totalIncome = transactions.filter((t) => t.kind === "income").reduce((s, t) => s + t.amount, 0);
    const totalExpense = transactions.filter((t) => t.kind === "expense").reduce((s, t) => s + t.amount, 0);

    res.json({
      transactions,
      totalIncome: round2(totalIncome),
      totalExpense: round2(totalExpense),
      remaining: round2(totalIncome - totalExpense),
    });
  })
);

// Achats/revenus etales sur plusieurs mois (groupId non nul), regroupes
// pour affichage synthetique (ex: page "Achats echelonnes").
personalRouter.get(
  "/groups",
  asyncHandler(async (req, res) => {
    const { userId } = z.object({ userId: z.string().optional() }).parse(req.query);
    const targetUserId = userId || req.user.id;

    const rows = await prisma.personalTransaction.findMany({
      where: { userId: targetUserId, groupId: { not: null } },
      orderBy: { date: "asc" },
    });

    const map = new Map();
    for (const r of rows) {
      if (!map.has(r.groupId)) {
        map.set(r.groupId, {
          groupId: r.groupId,
          label: r.label.replace(/\s\(\d+\/\d+\)$/, ""),
          kind: r.kind,
          note: r.note,
          installmentCount: r.installmentCount,
          items: [],
        });
      }
      map.get(r.groupId).items.push(r);
    }

    const groups = [...map.values()].map((g) => ({
      groupId: g.groupId,
      label: g.label,
      kind: g.kind,
      note: g.note,
      installmentCount: g.installmentCount,
      totalAmount: round2(g.items.reduce((s, i) => s + i.amount, 0)),
      firstDate: g.items[0].date,
      lastDate: g.items[g.items.length - 1].date,
    }));

    res.json({ groups });
  })
);

function splitEvenly(total, count) {
  const totalCents = Math.round(total * 100);
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

const txSchema = z.object({
  label: z.string().min(1).max(120),
  amount: z.number().positive(),
  kind: z.enum(["income", "expense"]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.string().datetime()),
  note: z.string().max(500).optional().nullable(),
  months: z.number().int().min(1).max(36).default(1),
});

personalRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const payload = txSchema.parse(req.body);
    const start = new Date(payload.date);
    const startDay = Math.min(start.getDate(), 28);
    const groupId = payload.months > 1 ? crypto.randomUUID() : null;

    // Une depense en plusieurs fois repartit le montant TOTAL saisi sur les
    // mensualites (achat finance) ; un revenu (ou une depense simple)
    // repete le MEME montant chaque mois (salaire, abonnement...).
    const amounts =
      payload.kind === "expense" && payload.months > 1
        ? splitEvenly(payload.amount, payload.months)
        : Array(payload.months).fill(round2(payload.amount));

    const rows = await prisma.$transaction(
      amounts.map((amount, i) =>
        prisma.personalTransaction.create({
          data: {
            userId: req.user.id,
            label: payload.months > 1 ? `${payload.label} (${i + 1}/${payload.months})` : payload.label,
            amount,
            kind: payload.kind,
            date: new Date(start.getFullYear(), start.getMonth() + i, startDay),
            note: payload.note || null,
            groupId,
            installmentIndex: payload.months > 1 ? i + 1 : null,
            installmentCount: payload.months > 1 ? payload.months : null,
          },
        })
      )
    );

    res.status(201).json({ transactions: rows });
  })
);

const updateSchema = txSchema.omit({ months: true }).partial();

personalRouter.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const existing = await prisma.personalTransaction.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.userId !== req.user.id) {
      return res.status(404).json({ error: "Transaction introuvable." });
    }
    const payload = updateSchema.parse(req.body);
    const transaction = await prisma.personalTransaction.update({
      where: { id: req.params.id },
      data: {
        ...(payload.label !== undefined ? { label: payload.label } : {}),
        ...(payload.amount !== undefined ? { amount: payload.amount } : {}),
        ...(payload.kind !== undefined ? { kind: payload.kind } : {}),
        ...(payload.date !== undefined ? { date: new Date(payload.date) } : {}),
        ...(payload.note !== undefined ? { note: payload.note || null } : {}),
      },
    });
    res.json({ transaction });
  })
);

personalRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const existing = await prisma.personalTransaction.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.userId !== req.user.id) {
      return res.status(404).json({ error: "Transaction introuvable." });
    }
    await prisma.personalTransaction.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  })
);

// Supprime toutes les lignes d'un groupe (achat/revenu en plusieurs fois).
personalRouter.delete(
  "/groups/:groupId",
  asyncHandler(async (req, res) => {
    await prisma.personalTransaction.deleteMany({
      where: { groupId: req.params.groupId, userId: req.user.id },
    });
    res.json({ ok: true });
  })
);
