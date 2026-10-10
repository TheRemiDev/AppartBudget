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
      itemCount: g.items.length,
      totalAmount: round2(g.items.reduce((s, i) => s + i.amount, 0)),
      firstDate: g.items[0].date,
      lastDate: g.items[g.items.length - 1].date,
    }));

    res.json({ groups });
  })
);

const txSchema = z.object({
  label: z.string().min(1).max(120),
  amount: z.number().positive(),
  // Montant des mensualites suivantes, si different de la 1ere (ex: acompte
  // majore). Ignore si months <= 1 ou pour un revenu (montant repete tel quel).
  laterAmount: z.number().positive().optional(),
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

    // Une depense en plusieurs fois utilise le montant saisi pour la 1ere
    // mensualite, puis "laterAmount" (ou le meme montant si non precise)
    // pour les suivantes (achat finance dont le 1er paiement differe) ; un
    // revenu (ou une depense simple) repete le MEME montant chaque mois
    // (salaire, abonnement...).
    const amounts =
      payload.kind === "expense" && payload.months > 1
        ? [
            round2(payload.amount),
            ...Array(payload.months - 1).fill(round2(payload.laterAmount ?? payload.amount)),
          ]
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

// Recree les mensualites manquantes d'une serie (ex: ligne supprimee par
// erreur) a partir des lignes restantes : le jour du mois et le montant
// (1ere mensualite vs suivantes) sont deduits des mensualites encore
// presentes. Ne fait rien si la serie n'a plus aucune ligne (rien dont
// deduire la reconstruction) ou si aucune mensualite ne manque.
personalRouter.post(
  "/groups/:groupId/regenerate",
  asyncHandler(async (req, res) => {
    const rows = await prisma.personalTransaction.findMany({
      where: { groupId: req.params.groupId, userId: req.user.id },
      orderBy: { installmentIndex: "asc" },
    });
    if (rows.length === 0) {
      return res.status(404).json({ error: "Série introuvable." });
    }
    const count = rows[0].installmentCount;
    if (!count) {
      return res.status(400).json({ error: "Cette série n'a pas de mensualités définies." });
    }

    const present = new Set(rows.map((r) => r.installmentIndex));
    const missing = [];
    for (let i = 1; i <= count; i++) {
      if (!present.has(i)) missing.push(i);
    }
    if (missing.length === 0) {
      return res.json({ created: [] });
    }

    // Reconstitue le jour du mois et le point de depart a partir d'une
    // mensualite encore presente (date(index) = date(1) + (index-1) mois).
    const anchor = rows[0];
    const anchorDate = new Date(anchor.date);
    const day = anchorDate.getDate();
    const baseYear = anchorDate.getFullYear();
    const baseMonth = anchorDate.getMonth() - (anchor.installmentIndex - 1);

    // Montant : celui de la mensualite 1 si encore connue pour l'index 1,
    // sinon celui des mensualites suivantes (qui partagent toutes le meme
    // montant, sauf la 1ere qui peut differer -- voir "regler en plusieurs
    // fois").
    const firstRow = rows.find((r) => r.installmentIndex === 1);
    const laterRow = rows.find((r) => r.installmentIndex > 1) || rows[0];
    const label = rows[0].label.replace(/\s\(\d+\/\d+\)$/, "");

    const created = await prisma.$transaction(
      missing.map((index) =>
        prisma.personalTransaction.create({
          data: {
            userId: req.user.id,
            label: `${label} (${index}/${count})`,
            amount: index === 1 ? firstRow?.amount ?? laterRow.amount : laterRow.amount,
            kind: rows[0].kind,
            date: new Date(baseYear, baseMonth + (index - 1), Math.min(day, 28)),
            note: rows[0].note,
            groupId: req.params.groupId,
            installmentIndex: index,
            installmentCount: count,
          },
        })
      )
    );

    res.json({ created });
  })
);
