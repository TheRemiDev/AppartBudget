import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import {
  generateExpenseFromTemplate,
  generateForecastForTemplate,
  removeUpcomingOccurrences,
  syncUpcomingOccurrences,
} from "../lib/recurringGenerator.js";

export const recurringTemplatesRouter = Router();

recurringTemplatesRouter.use(requireAuth);

const shareConfigSchema = z.object({ userId: z.string(), value: z.number() });

const templateSchema = z.object({
  label: z.string().min(1).max(120),
  amount: z.number().positive(),
  categoryId: z.string(),
  dayOfMonth: z.number().int().min(1).max(28).default(1),
  splitType: z.enum(["equal", "percentage", "custom"]).default("equal"),
  participantIds: z.array(z.string()).min(1),
  splitConfig: z.array(shareConfigSchema).optional().default([]),
  active: z.boolean().optional().default(true),
});

function serialize(template) {
  return { ...template, splitConfig: JSON.parse(template.splitConfig) };
}

recurringTemplatesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const templates = await prisma.recurringTemplate.findMany({
      include: { category: true },
      orderBy: { label: "asc" },
    });
    res.json({ templates: templates.map(serialize) });
  })
);

recurringTemplatesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const payload = templateSchema.parse(req.body);
    const template = await prisma.recurringTemplate.create({
      data: {
        label: payload.label,
        amount: payload.amount,
        categoryId: payload.categoryId,
        dayOfMonth: payload.dayOfMonth,
        splitType: payload.splitType,
        splitConfig: JSON.stringify(
          payload.splitType === "equal"
            ? payload.participantIds.map((userId) => ({ userId, value: 0 }))
            : payload.splitConfig
        ),
        active: payload.active,
        createdById: req.user.id,
      },
      include: { category: true },
    });
    if (template.active) await generateForecastForTemplate(template);
    res.status(201).json({ template: serialize(template) });
  })
);

recurringTemplatesRouter.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const payload = templateSchema.parse(req.body);
    const template = await prisma.recurringTemplate.update({
      where: { id: req.params.id },
      data: {
        label: payload.label,
        amount: payload.amount,
        categoryId: payload.categoryId,
        dayOfMonth: payload.dayOfMonth,
        splitType: payload.splitType,
        splitConfig: JSON.stringify(
          payload.splitType === "equal"
            ? payload.participantIds.map((userId) => ({ userId, value: 0 }))
            : payload.splitConfig
        ),
        active: payload.active,
      },
      include: { category: true },
    });
    let occurrences;
    if (template.active) {
      occurrences = await syncUpcomingOccurrences(template);
      await generateForecastForTemplate(template);
    } else {
      occurrences = await removeUpcomingOccurrences(template);
    }
    res.json({ template: serialize(template), occurrences });
  })
);

recurringTemplatesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const template = await prisma.recurringTemplate.findUnique({ where: { id: req.params.id } });
    if (!template) return res.json({ ok: true });
    // Les mois passes restent (historique reel) ; les mois a venir encore
    // vierges de tout versement disparaissent avec la charge.
    const occurrences = await removeUpcomingOccurrences(template);
    await prisma.recurringTemplate.delete({ where: { id: req.params.id } });
    res.json({ ok: true, occurrences });
  })
);

// Recree l'occurrence du mois courant si elle a ete supprimee (la
// generation automatique respecte volontairement une suppression manuelle,
// voir recurringLedger.js). Ne cree jamais de doublon.
recurringTemplatesRouter.post(
  "/:id/generate-now",
  asyncHandler(async (req, res) => {
    const template = await prisma.recurringTemplate.findUnique({ where: { id: req.params.id } });
    if (!template) return res.status(404).json({ error: "Charge récurrente introuvable." });
    const now = new Date();
    const alreadyThere = await prisma.expense.count({
      where: {
        templateId: template.id,
        date: { gte: new Date(now.getFullYear(), now.getMonth(), 1), lt: new Date(now.getFullYear(), now.getMonth() + 1, 1) },
      },
    });
    const expense = await generateExpenseFromTemplate(template, now, { force: true });
    res.json({ expense, created: alreadyThere === 0 });
  })
);
