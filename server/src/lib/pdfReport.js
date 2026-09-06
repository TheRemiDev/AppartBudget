import PDFDocument from "pdfkit";
import { prisma } from "./prisma.js";
import { round2 } from "./shares.js";

const KIND_LABELS = { fixed: "Fixe", occasional: "Ponctuel", exceptional: "Exceptionnel" };

const COLOR_TEXT = "#111827";
const COLOR_MUTED = "#6b7280";
const COLOR_RULE = "#e5e7eb";
const COLOR_PRIMARY = "#4f46e5";

const MARGIN = 40;

// toLocaleString("fr-FR") separe les milliers avec une espace fine
// insecable (U+202F), absente de l'encodage WinAnsi des polices standard
// de pdfkit : le caractere ne s'affichait pas correctement dans le PDF.
// On formate donc les montants a la main avec une espace normale.
function formatAmount(n) {
  const amount = round2(n ?? 0);
  const negative = amount < 0;
  const [intPart, decPart] = Math.abs(amount).toFixed(2).split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${negative ? "-" : ""}${grouped},${decPart} €`;
}

function formatDate(d) {
  return new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

const CONTENT_WIDTH = 595.28 - 2 * MARGIN; // A4 width - margins (pdfkit default A4)

function ensureSpace(doc, needed) {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + needed > bottom) {
    doc.addPage();
  }
}

// Toujours appele avec x + width explicites : ne jamais laisser pdfkit
// "deviner" la position/largeur a partir d'un appel precedent (source d'un
// bug reel observe : un texte hors table heritait de la largeur etroite
// d'une colonne de tableau et se retrouvait rendu une lettre par ligne).
function fullWidthText(doc, text, options = {}) {
  doc.text(text, MARGIN, doc.y, { width: CONTENT_WIDTH, ...options });
}

function sectionTitle(doc, text) {
  ensureSpace(doc, 40);
  doc.moveDown(0.6);
  doc.font("Helvetica-Bold").fontSize(13).fillColor(COLOR_TEXT);
  fullWidthText(doc, text);
  doc
    .moveTo(MARGIN, doc.y + 2)
    .lineTo(doc.page.width - MARGIN, doc.y + 2)
    .strokeColor(COLOR_RULE)
    .lineWidth(1)
    .stroke();
  doc.y += 8;
}

function drawTableHeader(doc, columns) {
  // Reserve aussi la place d'au moins une ligne, pour eviter un entete de
  // tableau seul en bas de page sans aucune ligne visible en dessous.
  ensureSpace(doc, 20 + 26);
  const y = doc.y;
  doc.font("Helvetica-Bold").fontSize(9).fillColor(COLOR_MUTED);
  for (const col of columns) {
    doc.text(col.label.toUpperCase(), col.x, y, { width: col.width, align: col.align || "left" });
  }
  doc.y = y + 14;
  doc
    .moveTo(MARGIN, doc.y)
    .lineTo(doc.page.width - MARGIN, doc.y)
    .strokeColor(COLOR_RULE)
    .lineWidth(1)
    .stroke();
  doc.y += 6;
}

// Hauteur de ligne calculee a partir du contenu le plus haut (une cellule
// peut faire plusieurs lignes, ex: repartition entre plusieurs personnes) :
// une hauteur fixe provoquait un chevauchement avec la ligne suivante des
// qu'une cellule depassait une ligne.
function rowHeight(doc, columns, row) {
  doc.font("Helvetica").fontSize(9);
  let maxHeight = 14;
  for (const col of columns) {
    const h = doc.heightOfString(String(row[col.key] ?? ""), { width: col.width });
    if (h > maxHeight) maxHeight = h;
  }
  return maxHeight + 6;
}

function drawTableRow(doc, columns, row) {
  const height = rowHeight(doc, columns, row);
  const pageBefore = doc.bufferedPageRange().count;
  ensureSpace(doc, height + 20);
  // Repete l'entete de tableau en haut de la nouvelle page, sinon un
  // rapport avec beaucoup de depenses devient illisible des la 2e page.
  if (doc.bufferedPageRange().count > pageBefore) {
    drawTableHeader(doc, columns);
  }
  const y = doc.y;
  doc.font("Helvetica").fontSize(9).fillColor(COLOR_TEXT);
  for (const col of columns) {
    doc.text(String(row[col.key] ?? ""), col.x, y, { width: col.width, align: col.align || "left" });
  }
  doc.y = y + height;
  doc
    .moveTo(MARGIN, doc.y - 3)
    .lineTo(doc.page.width - MARGIN, doc.y - 3)
    .strokeColor(COLOR_RULE)
    .lineWidth(0.5)
    .stroke();
}

/**
 * Genere le PDF du rapport mensuel du foyer (toutes les depenses, leur
 * repartition, l'historique des versements, la repartition par categorie)
 * pour la periode [from, to], et l'ecrit directement dans `res` (stream).
 */
export async function streamMonthlyReportPdf(res, { from, to, periodLabel }) {
  const dateRange = { gte: new Date(from), lte: new Date(to) };

  const [expenses, payments, users] = await Promise.all([
    prisma.expense.findMany({
      where: { date: dateRange },
      include: {
        category: true,
        shares: { include: { user: true, payments: true } },
      },
      orderBy: { date: "asc" },
    }),
    prisma.sharePayment.findMany({
      where: { date: dateRange },
      include: {
        paidBy: true,
        share: { include: { user: true, expense: { include: { category: true } } } },
      },
      orderBy: { date: "asc" },
    }),
    prisma.user.findMany({ orderBy: { createdAt: "asc" } }),
  ]);

  const totalAmount = round2(expenses.reduce((s, e) => s + e.amount, 0));
  const totalByKind = { fixed: 0, occasional: 0, exceptional: 0 };
  for (const e of expenses) totalByKind[e.kind] = round2((totalByKind[e.kind] || 0) + e.amount);

  const byCategoryMap = new Map();
  for (const e of expenses) {
    const entry = byCategoryMap.get(e.categoryId) || {
      name: e.category.name,
      color: e.category.color,
      total: 0,
    };
    entry.total = round2(entry.total + e.amount);
    byCategoryMap.set(e.categoryId, entry);
  }
  const byCategory = [...byCategoryMap.values()].sort((a, b) => b.total - a.total);

  const byUser = users.map((u) => {
    let assigned = 0;
    let paid = 0;
    let disbursed = 0;
    for (const e of expenses) {
      for (const s of e.shares) {
        if (s.userId === u.id) {
          assigned += s.amount;
          paid += Math.min(round2(s.payments.reduce((sum, p) => sum + p.amount, 0)), s.amount);
        }
        for (const p of s.payments) {
          if (p.paidByUserId === u.id) disbursed += p.amount;
        }
      }
    }
    return { name: u.name, assigned: round2(assigned), paid: round2(paid), disbursed: round2(disbursed) };
  });

  const doc = new PDFDocument({ margin: MARGIN, size: "A4", bufferPages: true });
  doc.pipe(res);

  // En-tete
  doc.font("Helvetica-Bold").fontSize(20).fillColor(COLOR_PRIMARY);
  fullWidthText(doc, "AppartBudget");
  doc.font("Helvetica").fontSize(14).fillColor(COLOR_TEXT);
  fullWidthText(doc, `Rapport mensuel — ${periodLabel}`);
  doc.font("Helvetica").fontSize(9).fillColor(COLOR_MUTED);
  fullWidthText(doc, `Genere le ${formatDate(new Date())}`);
  doc.y += 6;

  // Resume
  sectionTitle(doc, "Resume");
  doc.font("Helvetica").fontSize(11).fillColor(COLOR_TEXT);
  fullWidthText(doc, `Total des depenses : ${formatAmount(totalAmount)}  (${expenses.length} depense(s))`);
  doc.font("Helvetica").fontSize(10).fillColor(COLOR_MUTED);
  fullWidthText(
    doc,
    `Frais fixes : ${formatAmount(totalByKind.fixed)}    Frais ponctuels : ${formatAmount(
      totalByKind.occasional
    )}    Frais exceptionnels : ${formatAmount(totalByKind.exceptional)}`
  );
  doc.y += 4;
  doc.font("Helvetica").fontSize(10).fillColor(COLOR_TEXT);
  for (const u of byUser) {
    fullWidthText(
      doc,
      `${u.name} — part assignee : ${formatAmount(u.assigned)}, reglee : ${formatAmount(
        u.paid
      )}, versee pour le foyer : ${formatAmount(u.disbursed)}`
    );
  }

  // Repartition par categorie (barres horizontales)
  sectionTitle(doc, "Repartition par categorie");
  const barLabelWidth = 150;
  const barAmountWidth = 90;
  const barMaxWidth = CONTENT_WIDTH - barLabelWidth - barAmountWidth - 10;
  if (byCategory.length === 0) {
    doc.font("Helvetica").fontSize(10).fillColor(COLOR_MUTED);
    fullWidthText(doc, "Aucune depense sur cette periode.");
  }
  const maxCategoryTotal = byCategory[0]?.total || 1;
  for (const c of byCategory) {
    ensureSpace(doc, 18);
    const y = doc.y;
    doc.font("Helvetica").fontSize(9).fillColor(COLOR_TEXT).text(c.name, MARGIN, y, { width: barLabelWidth - 10 });
    const barWidth = Math.max(2, (c.total / maxCategoryTotal) * barMaxWidth);
    doc.rect(MARGIN + barLabelWidth, y + 1, barWidth, 9).fill(c.color);
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor(COLOR_MUTED)
      .text(formatAmount(c.total), MARGIN + barLabelWidth + barMaxWidth + 10, y, {
        width: barAmountWidth,
        align: "right",
      });
    doc.y = y + 16;
  }

  // Detail des depenses
  sectionTitle(doc, "Detail des depenses");
  if (expenses.length === 0) {
    doc.font("Helvetica").fontSize(10).fillColor(COLOR_MUTED);
    fullWidthText(doc, "Aucune depense sur cette periode.");
  } else {
    const cols = [
      { key: "date", label: "Date", x: MARGIN, width: 65 },
      { key: "label", label: "Depense", x: MARGIN + 70, width: 120 },
      { key: "category", label: "Categorie", x: MARGIN + 195, width: 85 },
      { key: "kind", label: "Type", x: MARGIN + 285, width: 55 },
      { key: "amount", label: "Montant", x: MARGIN + 345, width: 65, align: "right" },
      { key: "split", label: "Repartition", x: MARGIN + 415, width: CONTENT_WIDTH - 415 },
    ];
    drawTableHeader(doc, cols);
    for (const e of expenses) {
      const split = e.shares
        .map((s) => `${s.user.name}: ${formatAmount(s.amount)}${s.paid ? " (regle)" : ""}`)
        .join("  /  ");
      drawTableRow(doc, cols, {
        date: formatDate(e.date),
        label: e.label,
        category: e.category.name,
        kind: KIND_LABELS[e.kind] || e.kind,
        amount: formatAmount(e.amount),
        split,
      });
    }
  }

  // Historique des versements
  sectionTitle(doc, "Historique des versements");
  if (payments.length === 0) {
    doc.font("Helvetica").fontSize(10).fillColor(COLOR_MUTED);
    fullWidthText(doc, "Aucun versement enregistre sur cette periode.");
  } else {
    const cols = [
      { key: "date", label: "Date", x: MARGIN, width: 65 },
      { key: "payer", label: "Paye par", x: MARGIN + 70, width: 100 },
      { key: "for", label: "Pour la part de", x: MARGIN + 175, width: 100 },
      { key: "expense", label: "Depense", x: MARGIN + 280, width: 120 },
      { key: "amount", label: "Montant", x: MARGIN + 405, width: CONTENT_WIDTH - 405, align: "right" },
    ];
    drawTableHeader(doc, cols);
    for (const p of payments) {
      drawTableRow(doc, cols, {
        date: formatDate(p.date),
        payer: p.paidBy.name,
        for: p.share.userId === p.paidByUserId ? "Lui-meme" : p.share.user.name,
        expense: p.share.expense.label,
        amount: formatAmount(p.amount),
      });
    }
  }

  // Pied de page (numeros de page). Reste strictement dans la zone de
  // marge : au-dela, pdfkit considere que le texte "ne rentre pas" et cree
  // silencieusement une page supplementaire (vide) pour l'y placer.
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.font("Helvetica").fontSize(8).fillColor(COLOR_MUTED);
    doc.text(`Page ${i + 1} / ${range.count}`, MARGIN, doc.page.height - doc.page.margins.bottom - 15, {
      width: CONTENT_WIDTH,
      align: "center",
      lineBreak: false,
    });
  }

  doc.end();
}
