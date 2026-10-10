import { prisma } from "./prisma.js";
import { round2 } from "./shares.js";

// Solde net entre chaque paire de membres, sur tout l'historique : ce que
// l'un a avance pour la part de l'autre, moins les remboursements directs
// deja enregistres. Renvoie uniquement les paires non soldees, sous la
// forme "fromUserId doit amount a toUserId".
export async function computeBalances() {
  const [users, shares, settlements] = await Promise.all([
    prisma.user.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, name: true, color: true } }),
    prisma.expenseShare.findMany({
      select: {
        userId: true,
        amount: true,
        payments: { orderBy: { date: "asc" }, select: { amount: true, paidByUserId: true } },
      },
    }),
    prisma.settlement.findMany({ select: { fromUserId: true, toUserId: true, amount: true } }),
  ]);

  // owed[x][y] = montant que x doit a y.
  const owed = new Map(users.map((u) => [u.id, new Map()]));
  function add(debtorId, creditorId, amount) {
    const row = owed.get(debtorId);
    if (!row || !owed.has(creditorId)) return;
    row.set(creditorId, round2((row.get(creditorId) || 0) + amount));
  }

  for (const s of shares) {
    // Credit plafonne au montant de la part, dans l'ordre chronologique
    // (meme regle que le tableau de bord, pour une donnee historique
    // incoherente ou la part aurait ete reduite apres coup).
    let remaining = s.amount;
    for (const p of s.payments) {
      const credited = Math.max(0, Math.min(p.amount, remaining));
      remaining = round2(remaining - credited);
      if (credited > 0 && p.paidByUserId !== s.userId) add(s.userId, p.paidByUserId, credited);
    }
  }

  for (const st of settlements) add(st.fromUserId, st.toUserId, -st.amount);

  const balances = [];
  for (let i = 0; i < users.length; i++) {
    for (let j = i + 1; j < users.length; j++) {
      const a = users[i];
      const b = users[j];
      const net = round2((owed.get(a.id).get(b.id) || 0) - (owed.get(b.id).get(a.id) || 0));
      if (net > 0.005) balances.push({ fromUserId: a.id, toUserId: b.id, amount: net });
      else if (net < -0.005) balances.push({ fromUserId: b.id, toUserId: a.id, amount: round2(-net) });
    }
  }

  return { users, balances };
}
