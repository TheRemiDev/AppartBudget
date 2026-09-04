function startOfWeek(date) {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7; // lundi = 0
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function getPeriodRange(period, anchorDate) {
  const anchor = new Date(anchorDate);

  if (period === "week") {
    const from = startOfWeek(anchor);
    const to = new Date(from);
    to.setDate(to.getDate() + 6);
    to.setHours(23, 59, 59, 999);
    return { from, to };
  }

  if (period === "month") {
    const from = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const to = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0, 23, 59, 59, 999);
    return { from, to };
  }

  if (period === "year") {
    const from = new Date(anchor.getFullYear(), 0, 1);
    const to = new Date(anchor.getFullYear(), 11, 31, 23, 59, 59, 999);
    return { from, to };
  }

  throw new Error(`Periode inconnue: ${period}`);
}

export function shiftAnchor(period, anchorDate, direction) {
  const anchor = new Date(anchorDate);
  if (period === "week") anchor.setDate(anchor.getDate() + direction * 7);
  else if (period === "month") anchor.setMonth(anchor.getMonth() + direction);
  else if (period === "year") anchor.setFullYear(anchor.getFullYear() + direction);
  return anchor;
}

export function formatPeriodLabel(period, anchorDate) {
  const anchor = new Date(anchorDate);
  const { from, to } = getPeriodRange(period, anchorDate);

  if (period === "week") {
    const fmt = (d) => d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
    return `${fmt(from)} – ${fmt(to)}`;
  }
  if (period === "month") {
    return anchor.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  }
  if (period === "year") {
    return `${anchor.getFullYear()}`;
  }
  return "";
}
