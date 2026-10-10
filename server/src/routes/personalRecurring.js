import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import {
  generatePersonalTransactionFromTemplate,
  generateForecastForPersonalTemplate,
  removeUpcomingPersonalOccurrences,
  syncUpcomingPersonalOccurrences,
} from "../lib/personalRecurringGenerator.js";

export const personalRecurringRouter = Router();

personalRecurringRouter.use(requireAuth);

const templateSchema = z.object({
  label: z.string().min(1).max(120),
  amount: z.number().positive(),
  kind: z.enum(["income", "expense"]),
  dayOfMonth: z.number().int().min(1).max(28).default(1),
  active: z.boolean().optional().default(true),
});

// Liste des abonnements/revenus recurrents personnels. userId optionnel :
// permet de consulter ceux de son/sa partenaire (transparence), en lecture
// seule cote client.
personalRecurringRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { userId } = z.object({ userId: z.string().optional() }).parse(req.query);
    const targetUserId = userId || req.user.id;
    const templates = await prisma.personalRecurringTemplate.findMany({
      where: { userId: targetUserId },
      orderBy: { label: "asc" },
    });
    res.json({ templates });
  })
);

personalRecurringRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const payload = templateSchema.parse(req.body);
    const template = await prisma.personalRecurringTemplate.create({
      data: { ...payload, userId: req.user.id },
    });
    if (template.active) await generateForecastForPersonalTemplate(template);
    res.status(201).json({ template });
  })
);

personalRecurringRouter.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const existing = await prisma.personalRecurringTemplate.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.userId !== req.user.id) {
      return res.status(404).json({ error: "Abonnement introuvable." });
    }
    const payload = templateSchema.parse(req.body);
    const template = await prisma.personalRecurringTemplate.update({
      where: { id: req.params.id },
      data: payload,
    });
    let occurrences;
    if (template.active) {
      occurrences = await syncUpcomingPersonalOccurrences(template);
      await generateForecastForPersonalTemplate(template);
    } else {
      occurrences = await removeUpcomingPersonalOccurrences(template);
    }
    res.json({ template, occurrences });
  })
);

personalRecurringRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const existing = await prisma.personalRecurringTemplate.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.userId !== req.user.id) {
      return res.status(404).json({ error: "Abonnement introuvable." });
    }
    const occurrences = await removeUpcomingPersonalOccurrences(existing);
    await prisma.personalRecurringTemplate.delete({ where: { id: req.params.id } });
    res.json({ ok: true, occurrences });
  })
);

// Genere manuellement l'occurrence du mois courant.
personalRecurringRouter.post(
  "/:id/generate-now",
  asyncHandler(async (req, res) => {
    const template = await prisma.personalRecurringTemplate.findUnique({ where: { id: req.params.id } });
    if (!template || template.userId !== req.user.id) {
      return res.status(404).json({ error: "Abonnement introuvable." });
    }
    const now = new Date();
    const alreadyThere = await prisma.personalTransaction.count({
      where: {
        recurringTemplateId: template.id,
        date: { gte: new Date(now.getFullYear(), now.getMonth(), 1), lt: new Date(now.getFullYear(), now.getMonth() + 1, 1) },
      },
    });
    const transaction = await generatePersonalTransactionFromTemplate(template, now, { force: true });
    res.json({ transaction, created: alreadyThere === 0 });
  })
);
