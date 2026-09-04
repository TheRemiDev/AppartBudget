import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { generateExpenseFromTemplate, generateForecastForTemplate } from "../lib/recurringGenerator.js";

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
    if (template.active) await generateForecastForTemplate(template);
    res.json({ template: serialize(template) });
  })
);

recurringTemplatesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await prisma.recurringTemplate.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  })
);

// Genere manuellement l'occurrence du mois courant (utile pour tester ou
// forcer la generation sans attendre le cron nocturne).
recurringTemplatesRouter.post(
  "/:id/generate-now",
  asyncHandler(async (req, res) => {
    const template = await prisma.recurringTemplate.findUnique({ where: { id: req.params.id } });
    if (!template) return res.status(404).json({ error: "Modele introuvable." });
    const expense = await generateExpenseFromTemplate(template, new Date());
    res.json({ expense });
  })
);
