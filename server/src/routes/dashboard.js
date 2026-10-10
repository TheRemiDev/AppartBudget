import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { streamMonthlyReportPdf } from "../lib/pdfReport.js";
import { computeBalances } from "../lib/balance.js";

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);

const rangeSchema = z.object({
  from: z.string(),
  to: z.string(),
});

dashboardRouter.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const { from, to } = rangeSchema.parse(req.query);
    const where = { date: { gte: new Date(from), lte: new Date(to) } };

    const [expenses, users] = await Promise.all([
      prisma.expense.findMany({
        where,
        include: { category: true, shares: { include: { payments: { orderBy: { date: "asc" } } } } },
      }),
      prisma.user.findMany({ orderBy: { createdAt: "asc" } }),
    ]);

    function paidAmountOf(share) {
      const paid = share.payments.reduce((s, p) => s + p.amount, 0);
      return Math.min(round2(paid), share.amount);
    }

    const totalAmount = expenses.reduce((s, e) => s + e.amount, 0);
    const totalFixed = expenses.filter((e) => e.kind === "fixed").reduce((s, e) => s + e.amount, 0);
    const totalOccasional = expenses
      .filter((e) => e.kind === "occasional")
      .reduce((s, e) => s + e.amount, 0);
    const totalExceptional = expenses
      .filter((e) => e.kind === "exceptional")
      .reduce((s, e) => s + e.amount, 0);

    const byCategoryMap = new Map();
    for (const e of expenses) {
      const key = e.categoryId;
      const entry = byCategoryMap.get(key) || {
        categoryId: key,
        name: e.category.name,
        color: e.category.color,
        icon: e.category.icon,
        total: 0,
        count: 0,
      };
      entry.total += e.amount;
      entry.count += 1;
      byCategoryMap.set(key, entry);
    }

    const byUser = users.map((u) => {
      let assigned = 0;
      let paid = 0;
      let disbursed = 0;
      let advancedForOthers = 0;
      for (const e of expenses) {
        for (const s of e.shares) {
          if (s.userId === u.id) {
            assigned += s.amount;
            paid += paidAmountOf(s);
          }
          // Un versement ne devrait jamais depasser le montant de la part
          // (verifie a la creation), sauf donnee historique incoherente
          // (ex: part reduite via modification de la depense apres coup) :
          // on plafonne donc le credit au montant reellement du, dans
          // l'ordre chronologique des versements.
          let remaining = s.amount;
          for (const p of s.payments) {
            const credited = Math.max(0, Math.min(p.amount, remaining));
            remaining = round2(remaining - credited);
            if (p.paidByUserId === u.id) {
              disbursed += credited;
              if (s.userId !== u.id) advancedForOthers += credited;
            }
          }
        }
      }
      return {
        userId: u.id,
        name: u.name,
        color: u.color,
        assigned: round2(assigned),
        paid: round2(paid),
        pending: round2(assigned - paid),
        disbursed: round2(disbursed),
        advancedForOthers: round2(advancedForOthers),
      };
    });

    res.json({
      totalAmount: round2(totalAmount),
      totalFixed: round2(totalFixed),
      totalOccasional: round2(totalOccasional),
      totalExceptional: round2(totalExceptional),
      expenseCount: expenses.length,
      byCategory: [...byCategoryMap.values()]
        .map((c) => ({ ...c, total: round2(c.total) }))
        .sort((a, b) => b.total - a.total),
      byUser,
    });
  })
);

// Parts que l'utilisateur connecte doit encore payer, INDEPENDAMMENT de la
// periode affichee : tout ce qui est en retard (mois precedents) plus le
// mois en cours. Avant, une part oubliee le mois dernier disparaissait de
// la liste des qu'on changeait de mois. Les mois futurs (pre-generes par
// les charges recurrentes / achats echelonnes) n'y figurent pas encore.
dashboardRouter.get(
  "/to-pay",
  asyncHandler(async (req, res) => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const shares = await prisma.expenseShare.findMany({
      where: { userId: req.user.id, paid: false, amount: { gt: 0.005 }, expense: { date: { lt: monthEnd } } },
      include: { payments: { select: { amount: true } }, expense: { include: { category: true } } },
    });

    const items = shares
      .map((s) => {
        const paidAmount = round2(Math.min(s.payments.reduce((sum, p) => sum + p.amount, 0), s.amount));
        return {
          expenseId: s.expense.id,
          shareId: s.id,
          label: s.expense.label,
          date: s.expense.date,
          overdue: new Date(s.expense.date) < monthStart,
          remaining: round2(s.amount - paidAmount),
          shareAmount: s.amount,
          paidAmount,
          categoryName: s.expense.category.name,
          categoryIcon: s.expense.category.icon,
          categoryColor: s.expense.category.color,
        };
      })
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    res.json({
      items,
      total: round2(items.reduce((s, i) => s + i.remaining, 0)),
      overdueCount: items.filter((i) => i.overdue).length,
    });
  })
);

// Historique de tous les versements effectues sur la periode, avec qui a
// paye, pour la part de qui, et sur quelle depense. Filtrable par payeur.
dashboardRouter.get(
  "/payments",
  asyncHandler(async (req, res) => {
    const { from, to, userId } = z
      .object({ from: z.string(), to: z.string(), userId: z.string().optional() })
      .parse(req.query);

    const payments = await prisma.sharePayment.findMany({
      where: {
        date: { gte: new Date(from), lte: new Date(to) },
        ...(userId ? { paidByUserId: userId } : {}),
      },
      include: {
        paidBy: { select: { id: true, name: true, color: true } },
        share: {
          include: {
            user: { select: { id: true, name: true, color: true } },
            expense: { include: { category: true } },
          },
        },
      },
      orderBy: { date: "desc" },
    });

    const items = payments.map((p) => ({
      id: p.id,
      amount: round2(p.amount),
      date: p.date,
      note: p.note,
      paidBy: p.paidBy,
      forUser: p.share.user,
      isForSelf: p.paidByUserId === p.share.userId,
      shareId: p.shareId,
      expense: {
        id: p.share.expense.id,
        label: p.share.expense.label,
        categoryName: p.share.expense.category.name,
        categoryIcon: p.share.expense.category.icon,
        categoryColor: p.share.expense.category.color,
      },
    }));

    const totalByPayer = {};
    for (const item of items) {
      totalByPayer[item.paidBy.id] = round2((totalByPayer[item.paidBy.id] || 0) + item.amount);
    }

    res.json({ payments: items, totalByPayer });
  })
);

// Solde reel entre les membres du foyer, sur tout l'historique (pas
// seulement la periode affichee), remboursements directs deduits.
dashboardRouter.get(
  "/balance",
  asyncHandler(async (req, res) => {
    res.json(await computeBalances());
  })
);

dashboardRouter.get(
  "/trend",
  asyncHandler(async (req, res) => {
    const months = Math.min(Number(req.query.months) || 6, 24);
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);

    const expenses = await prisma.expense.findMany({
      where: { date: { gte: start } },
      select: { date: true, amount: true, kind: true },
    });

    const buckets = [];
    for (let i = 0; i < months; i++) {
      const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
      buckets.push({
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
        label: d.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" }),
        fixed: 0,
        occasional: 0,
        exceptional: 0,
      });
    }
    const bucketByKey = new Map(buckets.map((b) => [b.key, b]));

    for (const e of expenses) {
      const d = new Date(e.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const bucket = bucketByKey.get(key);
      if (!bucket) continue;
      if (e.kind === "fixed") bucket.fixed = round2(bucket.fixed + e.amount);
      else if (e.kind === "occasional") bucket.occasional = round2(bucket.occasional + e.amount);
      else bucket.exceptional = round2(bucket.exceptional + e.amount);
    }

    res.json({ trend: buckets });
  })
);

// Rapport PDF du foyer (depenses, repartition, historique des versements)
// sur la periode donnee, telechargeable depuis le tableau de bord.
dashboardRouter.get(
  "/export-pdf",
  asyncHandler(async (req, res) => {
    const { from, to, label } = z
      .object({ from: z.string(), to: z.string(), label: z.string().optional() })
      .parse(req.query);

    const periodLabel = label || `${new Date(from).toLocaleDateString("fr-FR")} - ${new Date(to).toLocaleDateString("fr-FR")}`;
    const filename = `appartbudget-rapport-${new Date(from).toISOString().slice(0, 7)}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    await streamMonthlyReportPdf(res, { from, to, periodLabel });
  })
);

function round2(n) {
  return Math.round(n * 100) / 100;
}
