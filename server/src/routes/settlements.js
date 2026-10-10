import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { round2 } from "../lib/shares.js";

export const settlementsRouter = Router();

settlementsRouter.use(requireAuth);

const userSelect = { select: { id: true, name: true, color: true } };
const settlementInclude = { fromUser: userSelect, toUser: userSelect, createdBy: userSelect };

settlementsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { from, to } = z.object({ from: z.string().optional(), to: z.string().optional() }).parse(req.query);
    const where = {};
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(from);
      if (to) where.date.lte = new Date(to);
    }
    const settlements = await prisma.settlement.findMany({
      where,
      include: settlementInclude,
      orderBy: { date: "desc" },
    });
    res.json({ settlements });
  })
);

const settlementSchema = z.object({
  fromUserId: z.string(),
  toUserId: z.string(),
  amount: z.number().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.string().datetime()).optional(),
  note: z.string().max(300).optional().nullable(),
});

settlementsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const payload = settlementSchema.parse(req.body);
    if (payload.fromUserId === payload.toUserId) {
      return res.status(400).json({ error: "Un remboursement se fait entre deux personnes différentes." });
    }
    const count = await prisma.user.count({ where: { id: { in: [payload.fromUserId, payload.toUserId] } } });
    if (count !== 2) return res.status(400).json({ error: "Membre du foyer introuvable." });

    const settlement = await prisma.settlement.create({
      data: {
        fromUserId: payload.fromUserId,
        toUserId: payload.toUserId,
        amount: round2(payload.amount),
        note: payload.note || null,
        createdById: req.user.id,
        ...(payload.date ? { date: new Date(payload.date) } : {}),
      },
      include: settlementInclude,
    });
    res.status(201).json({ settlement });
  })
);

settlementsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await prisma.settlement.delete({ where: { id: req.params.id } }).catch(() => null);
    res.json({ ok: true });
  })
);
