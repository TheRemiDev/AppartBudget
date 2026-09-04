// Toute la logique de repartition d'une depense entre les membres du foyer.
// On travaille en centimes (entiers) pour ne jamais perdre un centime par
// arrondi flottant, puis on reconvertit en euros a la fin.

function toCents(amount) {
  return Math.round(amount * 100);
}

function fromCents(cents) {
  return Math.round(cents) / 100;
}

/**
 * @param {number} amount - montant total de la depense
 * @param {"equal"|"percentage"|"custom"} splitType
 * @param {Array<{userId:string}>} participants - membres concernes, dans un ordre stable
 * @param {Array<{userId:string, value:number}>} [config] - requis pour percentage/custom
 * @returns {Array<{userId:string, amount:number}>}
 */
export function computeShares(amount, splitType, participants, config = []) {
  const totalCents = toCents(amount);

  if (!participants.length) {
    throw new Error("Aucun participant fourni pour la repartition.");
  }

  if (splitType === "equal") {
    const n = participants.length;
    const base = Math.floor(totalCents / n);
    let remainder = totalCents - base * n;
    return participants.map((p) => {
      const extra = remainder > 0 ? 1 : 0;
      if (remainder > 0) remainder -= 1;
      return { userId: p.userId, amount: fromCents(base + extra) };
    });
  }

  if (splitType === "percentage") {
    const byUser = new Map(config.map((c) => [c.userId, c.value]));
    const totalPct = config.reduce((s, c) => s + c.value, 0);
    if (Math.abs(totalPct - 100) > 0.01) {
      throw new Error("Les pourcentages doivent totaliser 100%.");
    }
    let assignedCents = 0;
    const shares = participants.map((p, idx) => {
      const pct = byUser.get(p.userId) || 0;
      if (idx === participants.length - 1) {
        return { userId: p.userId, cents: totalCents - assignedCents };
      }
      const cents = Math.round((totalCents * pct) / 100);
      assignedCents += cents;
      return { userId: p.userId, cents };
    });
    return shares.map((s) => ({ userId: s.userId, amount: fromCents(s.cents) }));
  }

  if (splitType === "custom") {
    const byUser = new Map(config.map((c) => [c.userId, toCents(c.value)]));
    const providedTotal = config.reduce((s, c) => s + toCents(c.value), 0);
    if (Math.abs(providedTotal - totalCents) > 1) {
      throw new Error(
        "La somme des parts personnalisees doit correspondre au montant total."
      );
    }
    return participants.map((p) => ({
      userId: p.userId,
      amount: fromCents(byUser.get(p.userId) || 0),
    }));
  }

  throw new Error(`Type de repartition inconnu: ${splitType}`);
}
