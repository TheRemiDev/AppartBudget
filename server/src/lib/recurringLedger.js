import { prisma } from "./prisma.js";

// Historique des occurrences deja generees pour un modele recurrent, garde
// meme si la depense/ligne generee est supprimee ensuite : sans cette
// trace, la seule verification possible ("une depense existe-t-elle pour
// ce mois ?") redevenait vraie a chaque redemarrage/cron des qu'on
// supprimait l'occurrence, la faisant reapparaitre malgre la suppression.

export function yearMonthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export async function wasAlreadyGenerated(templateId, yearMonth) {
  const entry = await prisma.recurringGeneration.findUnique({
    where: { templateId_yearMonth: { templateId, yearMonth } },
  });
  return Boolean(entry);
}

export async function recordGeneration(templateId, templateKind, yearMonth) {
  await prisma.recurringGeneration.upsert({
    where: { templateId_yearMonth: { templateId, yearMonth } },
    update: {},
    create: { templateId, templateKind, yearMonth },
  });
}
