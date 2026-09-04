import { prisma } from "./prisma.js";

const EPSILON = 0.005; // tolerance d'arrondi en euros

const paidBySelect = { select: { id: true, name: true, color: true } };

/**
 * Recalcule le statut "paid"/"paidAt" d'une part a partir de la somme de
 * ses versements, et renvoie la part a jour (avec ses versements, tries du
 * plus recent au plus ancien, chacun incluant qui l'a effectue).
 */
export async function recomputeShareStatus(tx, shareId) {
  const share = await tx.expenseShare.findUnique({ where: { id: shareId } });
  if (!share) return null;

  const payments = await tx.sharePayment.findMany({
    where: { shareId },
    orderBy: { date: "desc" },
    include: { paidBy: paidBySelect },
  });
  const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
  const fullyPaid = totalPaid >= share.amount - EPSILON;

  const updated = await tx.expenseShare.update({
    where: { id: shareId },
    data: {
      paid: fullyPaid,
      paidAt: fullyPaid ? share.paidAt || new Date() : null,
    },
  });

  return { ...updated, payments, paidAmount: round2(Math.min(totalPaid, share.amount)) };
}

export function round2(n) {
  return Math.round(n * 100) / 100;
}
