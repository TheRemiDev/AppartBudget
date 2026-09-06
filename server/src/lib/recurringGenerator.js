import { prisma } from "./prisma.js";
import { computeShares } from "./split.js";
import { yearMonthKey, wasAlreadyGenerated, recordGeneration } from "./recurringLedger.js";

// Nombre de mois a l'avance a toujours tenir generes, pour qu'une charge
// recurrente apparaisse deja sur le tableau de bord quand on navigue dans
// les mois a venir (comme un achat echelonne, qui est genere en totalite
// des sa creation).
export const FORECAST_MONTHS_AHEAD = 2;

/**
 * Cree l'occurrence du mois pour un modele recurrent, sauf si elle a deja
 * ete generee. Idempotent: peut etre appele plusieurs fois sans creer de
 * doublons. Sans `force`, respecte une suppression manuelle anterieure de
 * l'occurrence (voir recurringLedger.js) : la depense ne reapparait pas
 * toute seule au prochain redemarrage/cron. `force: true` (bouton "Generer
 * ce mois") l'ignore et (re)genere quoi qu'il arrive.
 */
export async function generateExpenseFromTemplate(template, forDate, { force = false } = {}) {
  const yearMonth = yearMonthKey(forDate);

  if (!force && (await wasAlreadyGenerated(template.id, yearMonth))) {
    return null;
  }

  const monthStart = new Date(forDate.getFullYear(), forDate.getMonth(), 1);
  const monthEnd = new Date(forDate.getFullYear(), forDate.getMonth() + 1, 1);

  const existing = await prisma.expense.findFirst({
    where: { templateId: template.id, date: { gte: monthStart, lt: monthEnd } },
  });
  if (existing) {
    // Retro-compatibilite : depense generee avant l'ajout du ledger.
    await recordGeneration(template.id, "shared", yearMonth);
    return existing;
  }

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
  await recordGeneration(template.id, "shared", yearMonth);
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
      const expense = await generateExpenseFromTemplate(template, forDate);
      if (expense) results.push(expense);
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
    const expense = await generateExpenseFromTemplate(template, forDate);
    if (expense) results.push(expense);
  }
  return results;
}
