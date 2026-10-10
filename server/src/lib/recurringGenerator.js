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

function startOfDay(now) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

// Occurrences a venir (pas encore echues) d'une charge recurrente, separees
// entre celles qu'on peut encore modifier/retirer sans risque et celles sur
// lesquelles quelqu'un a deja verse quelque chose (laissees intactes).
async function upcomingOccurrences(templateId, now) {
  const rows = await prisma.expense.findMany({
    where: { templateId, date: { gte: startOfDay(now) } },
    include: { shares: { include: { payments: { select: { id: true } } } } },
  });
  const untouched = rows.filter((e) => e.shares.every((s) => s.payments.length === 0));
  return { untouched, locked: rows.length - untouched.length };
}

/**
 * Applique la nouvelle version d'une charge recurrente (montant, libelle,
 * categorie, jour, repartition) aux occurrences deja pre-generees pour les
 * mois a venir. Sans ca, modifier le loyer ne changeait que les mois au-dela
 * de la fenetre de prevision, alors que les 2-3 prochains restaient a
 * l'ancien montant.
 */
export async function syncUpcomingOccurrences(template, now = new Date()) {
  const { untouched, locked } = await upcomingOccurrences(template.id, now);
  const splitConfig = JSON.parse(template.splitConfig);
  const participants = splitConfig.map((c) => ({ userId: c.userId }));
  const shares = computeShares(template.amount, template.splitType, participants, splitConfig);

  for (const e of untouched) {
    const d = new Date(e.date);
    await prisma.$transaction([
      prisma.expenseShare.deleteMany({ where: { expenseId: e.id } }),
      prisma.expense.update({
        where: { id: e.id },
        data: {
          label: template.label,
          amount: template.amount,
          categoryId: template.categoryId,
          date: new Date(d.getFullYear(), d.getMonth(), Math.min(template.dayOfMonth, 28)),
          shares: { create: shares },
        },
      }),
    ]);
  }
  return { updated: untouched.length, locked };
}

/**
 * Retire les occurrences a venir d'une charge mise en pause ou supprimee
 * (sinon les mois deja pre-generes restaient affiches). Efface aussi leur
 * trace dans le ledger pour qu'une reactivation les regenere normalement.
 */
export async function removeUpcomingOccurrences(template, now = new Date()) {
  const { untouched, locked } = await upcomingOccurrences(template.id, now);
  for (const e of untouched) {
    await prisma.expense.delete({ where: { id: e.id } });
    await prisma.recurringGeneration.deleteMany({
      where: { templateId: template.id, yearMonth: yearMonthKey(new Date(e.date)) },
    });
  }
  return { removed: untouched.length, locked };
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
