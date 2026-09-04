import { prisma } from "./prisma.js";
import { computeShares } from "./split.js";

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Cree l'occurrence du mois pour un modele recurrent, sauf si elle existe deja.
 * Idempotent: peut etre appele plusieurs fois sans creer de doublons.
 */
export async function generateExpenseFromTemplate(template, forDate) {
  const targetMonth = monthKey(forDate);

  const existing = await prisma.expense.findFirst({
    where: {
      templateId: template.id,
      date: {
        gte: new Date(`${targetMonth}-01T00:00:00.000Z`),
        lt: new Date(new Date(`${targetMonth}-01T00:00:00.000Z`).setMonth(forDate.getMonth() + 1)),
      },
    },
  });
  if (existing) return existing;

  const splitConfig = JSON.parse(template.splitConfig);
  const participants = splitConfig.map((c) => ({ userId: c.userId }));
  const shares = computeShares(template.amount, template.splitType, participants, splitConfig);

  const day = Math.min(template.dayOfMonth, 28);
  const date = new Date(forDate.getFullYear(), forDate.getMonth(), day);

  const expense = await prisma.expense.create({
    data: {
      label: template.label,
      amount: template.amount,
      date,
      kind: "fixed",
      categoryId: template.categoryId,
      createdById: template.createdById,
      templateId: template.id,
      shares: { create: shares },
    },
  });
  return expense;
}

export async function generateDueTemplates(now = new Date()) {
  const templates = await prisma.recurringTemplate.findMany({ where: { active: true } });
  const results = [];
  for (const template of templates) {
    if (now.getDate() >= Math.min(template.dayOfMonth, 28)) {
      results.push(await generateExpenseFromTemplate(template, now));
    }
  }
  return results;
}
