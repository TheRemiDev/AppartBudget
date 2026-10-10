import { prisma } from "./prisma.js";
import { yearMonthKey, wasAlreadyGenerated, recordGeneration } from "./recurringLedger.js";

// Meme fenetre de prevision que les charges recurrentes du foyer (voir
// recurringGenerator.js), pour que les abonnements/revenus personnels
// apparaissent eux aussi en avance sur le tableau "Budget personnel".
export const FORECAST_MONTHS_AHEAD = 2;

/**
 * Cree l'occurrence du mois pour un abonnement/revenu recurrent personnel,
 * sauf si elle a deja ete generee. Idempotent. Sans `force`, respecte une
 * suppression manuelle anterieure de la ligne (voir recurringLedger.js) :
 * elle ne reapparait pas toute seule au prochain redemarrage/cron.
 */
export async function generatePersonalTransactionFromTemplate(template, forDate, { force = false } = {}) {
  const yearMonth = yearMonthKey(forDate);

  if (!force && (await wasAlreadyGenerated(template.id, yearMonth))) {
    return null;
  }

  const monthStart = new Date(forDate.getFullYear(), forDate.getMonth(), 1);
  const monthEnd = new Date(forDate.getFullYear(), forDate.getMonth() + 1, 1);

  const existing = await prisma.personalTransaction.findFirst({
    where: { recurringTemplateId: template.id, date: { gte: monthStart, lt: monthEnd } },
  });
  if (existing) {
    // Retro-compatibilite : ligne generee avant l'ajout du ledger.
    await recordGeneration(template.id, "personal", yearMonth);
    return existing;
  }

  const day = Math.min(template.dayOfMonth, 28);
  const date = new Date(forDate.getFullYear(), forDate.getMonth(), day);

  const transaction = await prisma.personalTransaction.create({
    data: {
      userId: template.userId,
      label: template.label,
      amount: template.amount,
      kind: template.kind,
      date,
      recurringTemplateId: template.id,
    },
  });
  await recordGeneration(template.id, "personal", yearMonth);
  return transaction;
}

/**
 * Genere le mois courant et les FORECAST_MONTHS_AHEAD mois suivants pour
 * tous les abonnements/revenus recurrents actifs (tous foyers confondus).
 */
export async function generateDuePersonalTemplates(now = new Date()) {
  const templates = await prisma.personalRecurringTemplate.findMany({ where: { active: true } });
  const results = [];
  for (const template of templates) {
    for (let i = 0; i <= FORECAST_MONTHS_AHEAD; i++) {
      const forDate = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const transaction = await generatePersonalTransactionFromTemplate(template, forDate);
      if (transaction) results.push(transaction);
    }
  }
  return results;
}

function upcomingWhere(templateId, now) {
  return { recurringTemplateId: templateId, date: { gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()) } };
}

/**
 * Applique la nouvelle version d'un abonnement/revenu (libelle, montant,
 * type, jour) aux lignes deja pre-generees pour les mois a venir.
 */
export async function syncUpcomingPersonalOccurrences(template, now = new Date()) {
  const rows = await prisma.personalTransaction.findMany({ where: upcomingWhere(template.id, now) });
  for (const r of rows) {
    const d = new Date(r.date);
    await prisma.personalTransaction.update({
      where: { id: r.id },
      data: {
        label: template.label,
        amount: template.amount,
        kind: template.kind,
        date: new Date(d.getFullYear(), d.getMonth(), Math.min(template.dayOfMonth, 28)),
      },
    });
  }
  return { updated: rows.length };
}

/**
 * Retire les lignes a venir d'un abonnement mis en pause ou supprime, et
 * leur trace dans le ledger (une reactivation les regenere normalement).
 */
export async function removeUpcomingPersonalOccurrences(template, now = new Date()) {
  const rows = await prisma.personalTransaction.findMany({ where: upcomingWhere(template.id, now) });
  for (const r of rows) {
    await prisma.personalTransaction.delete({ where: { id: r.id } });
    await prisma.recurringGeneration.deleteMany({
      where: { templateId: template.id, yearMonth: yearMonthKey(new Date(r.date)) },
    });
  }
  return { removed: rows.length };
}

/**
 * Genere immediatement la fenetre de prevision pour UN SEUL abonnement : a
 * appeler a sa creation/reactivation, pour ne pas attendre le cron nocturne.
 */
export async function generateForecastForPersonalTemplate(template, now = new Date()) {
  const results = [];
  for (let i = 0; i <= FORECAST_MONTHS_AHEAD; i++) {
    const forDate = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const transaction = await generatePersonalTransactionFromTemplate(template, forDate);
    if (transaction) results.push(transaction);
  }
  return results;
}
