import { prisma } from "./prisma.js";
import { computeShares } from "./split.js";

// Nombre de mois a l'avance a toujours tenir generes, pour qu'une charge
// recurrente apparaisse deja sur le tableau de bord quand on navigue dans
// les mois a venir (comme un achat echelonne, qui est genere en totalite
// des sa creation).
export const FORECAST_MONTHS_AHEAD = 2;

/**
 * Cree l'occurrence du mois pour un modele recurrent, sauf si elle existe deja.
 * Idempotent: peut etre appele plusieurs fois sans creer de doublons.
 */
export async function generateExpenseFromTemplate(template, forDate) {
  const monthStart = new Date(forDate.getFullYear(), forDate.getMonth(), 1);
  const monthEnd = new Date(forDate.getFullYear(), forDate.getMonth() + 1, 1);

  const existing = await prisma.expense.findFirst({
    where: { templateId: template.id, date: { gte: monthStart, lt: monthEnd } },
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

/**
 * Genere le mois courant ainsi que les FORECAST_MONTHS_AHEAD mois suivants
 * pour chaque modele recurrent actif (idempotent, sans doublons). Contrairement
 * a avant, ne se limite plus au jour d'echeance du mois courant : les mois a
 * venir sont toujours generes a l'avance pour alimenter le tableau de bord
 * quand on navigue dans le futur.
 */
export async function generateDueTemplates(now = new Date()) {
  const templates = await prisma.recurringTemplate.findMany({ where: { active: true } });
  const results = [];
  for (const template of templates) {
    for (let i = 0; i <= FORECAST_MONTHS_AHEAD; i++) {
      const forDate = new Date(now.getFullYear(), now.getMonth() + i, 1);
      results.push(await generateExpenseFromTemplate(template, forDate));
    }
  }
  return results;
}

/**
 * Genere immediatement la fenetre de prevision pour UN SEUL modele : a
 * appeler a la creation ou reactivation d'une charge recurrente, pour ne
 * pas attendre le prochain passage du cron avant de voir les mois a venir.
 */
export async function generateForecastForTemplate(template, now = new Date()) {
  const results = [];
  for (let i = 0; i <= FORECAST_MONTHS_AHEAD; i++) {
    const forDate = new Date(now.getFullYear(), now.getMonth() + i, 1);
    results.push(await generateExpenseFromTemplate(template, forDate));
  }
  return results;
}
