import PDFDocument from "pdfkit";
import { prisma } from "./prisma.js";
import { round2 } from "./shares.js";

// Palette identique a celle de l'application (client/src/styles/global.css,
// mode clair) pour que le PDF ait le meme "look" que le produit.
const COLOR_TEXT = "#13151a";
const COLOR_MUTED = "#666b76";
const COLOR_FAINT = "#9a9fa8";
const COLOR_BORDER = "#e5e7eb";
const COLOR_SURFACE_2 = "#f0f1f4";
const COLOR_SURFACE_3 = "#e7e9ee";
const COLOR_PRIMARY = "#4f46e5";
const COLOR_PRIMARY_SOFT = "#eef2ff";
const COLOR_SUCCESS = "#16a34a";
const COLOR_SUCCESS_SOFT = "#ecfdf5";
const COLOR_DANGER = "#dc2626";
const COLOR_DANGER_SOFT = "#fef2f2";
const COLOR_WARNING = "#b45309";
const COLOR_WARNING_SOFT = "#fffbeb";
const COLOR_INFO = "#0e7490";
const COLOR_INFO_SOFT = "#ecfeff";

const KIND_LABELS = { fixed: "Fixe", occasional: "Ponctuel", exceptional: "Exceptionnel" };
const KIND_PILL = {
  fixed: { bg: COLOR_PRIMARY_SOFT, color: COLOR_PRIMARY },
  occasional: { bg: COLOR_INFO_SOFT, color: COLOR_INFO },
  exceptional: { bg: COLOR_WARNING_SOFT, color: COLOR_WARNING },
};

const MARGIN = 40;
const CONTENT_WIDTH = 595.28 - 2 * MARGIN; // A4 width - margins
const HEADER_SPACE = 34; // reserve en haut des pages 2+ pour l'entete courante

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
  ensureSpace(doc, 46);
  doc.moveDown(0.9);
  doc.font("Helvetica-Bold").fontSize(12.5).fillColor(COLOR_TEXT);
  fullWidthText(doc, text);
  doc.y += 3;
  doc
    .moveTo(MARGIN, doc.y)
    .lineTo(doc.page.width - MARGIN, doc.y)
    .strokeColor(COLOR_PRIMARY)
    .lineWidth(1.6)
    .stroke();
  doc.y += 10;
}

function pillWidth(doc, text, fontSize) {
  doc.font("Helvetica-Bold").fontSize(fontSize);
  return doc.widthOfString(text.toUpperCase()) + 14;
}

function drawPill(doc, text, x, y, { bg, color, fontSize = 7.5 }) {
  const w = pillWidth(doc, text, fontSize);
  const h = fontSize + 8;
  doc.roundedRect(x, y, w, h, h / 2).fill(bg);
  doc
    .font("Helvetica-Bold")
    .fontSize(fontSize)
    .fillColor(color)
    .text(text.toUpperCase(), x, y + h / 2 - fontSize / 2 - 1, { width: w, align: "center", lineBreak: false });
  return w;
}

function drawAvatar(doc, cx, cy, radius, { initial, color }) {
  doc.circle(cx, cy, radius).fill(color);
  doc
    .font("Helvetica-Bold")
    .fontSize(radius * 1.05)
    .fillColor("#ffffff")
    .text(initial, cx - radius, cy - radius * 0.62, { width: radius * 2, align: "center", lineBreak: false });
}

// Grille de cartes generique (utilisee pour le resume et les cartes membres) :
// calcule le nombre de colonnes qui tiennent dans CONTENT_WIDTH a partir
// d'une largeur minimale, comme un `auto-fit, minmax()` CSS.
function drawCardGrid(doc, items, cardHeight, minCardWidth, drawItem) {
  const gap = 10;
  const columns = Math.max(1, Math.floor((CONTENT_WIDTH + gap) / (minCardWidth + gap)));
  const cardWidth = (CONTENT_WIDTH - (columns - 1) * gap) / columns;

  for (let i = 0; i < items.length; i += columns) {
    ensureSpace(doc, cardHeight + gap);
    const rowItems = items.slice(i, i + columns);
    const y = doc.y;
    rowItems.forEach((item, idx) => {
      const x = MARGIN + idx * (cardWidth + gap);
      doc.roundedRect(x, y, cardWidth, cardHeight, 8).fillAndStroke(COLOR_SURFACE_2, COLOR_BORDER);
      drawItem(item, x, y, cardWidth, cardHeight);
    });
    doc.y = y + cardHeight + gap;
  }
}

function drawTableHeader(doc, columns) {
  // Reserve aussi la place d'au moins une ligne, pour eviter un entete de
  // tableau seul en bas de page sans aucune ligne visible en dessous.
  ensureSpace(doc, 24 + 28);
  const y = doc.y;
  const headerHeight = 22;
  doc.rect(MARGIN, y, CONTENT_WIDTH, headerHeight).fill(COLOR_SURFACE_2);
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(COLOR_MUTED);
  for (const col of columns) {
    doc.text(col.label.toUpperCase(), col.x, y + 7, { width: col.width, align: col.align || "left" });
  }
  doc.y = y + headerHeight;
}

function rowBackground(doc, y, height, index) {
  if (index % 2 === 1) {
    doc.rect(MARGIN, y, CONTENT_WIDTH, height).fill("#f8f9fb");
  }
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
  return maxHeight + 12;
}

function drawTableRow(doc, columns, row, index) {
  const height = rowHeight(doc, columns, row);
  const pageBefore = doc.bufferedPageRange().count;
  ensureSpace(doc, height + 24);
  // Repete l'entete de tableau en haut de la nouvelle page, sinon un
  // rapport avec beaucoup de depenses devient illisible des la 2e page.
  if (doc.bufferedPageRange().count > pageBefore) {
    drawTableHeader(doc, columns);
    index = 0;
  }
  const y = doc.y;
  rowBackground(doc, y, height, index);
  doc.font("Helvetica").fontSize(9).fillColor(COLOR_TEXT);
  for (const col of columns) {
    if (col.pill) {
      const pill = col.pill(row);
      if (pill) drawPill(doc, pill.text, col.x, y + (height - 15.5) / 2, pill);
      continue;
    }
    doc.fillColor(col.color ? col.color(row) : COLOR_TEXT);
    doc.text(String(row[col.key] ?? ""), col.x, y + 6, { width: col.width, align: col.align || "left" });
  }
  doc.y = y + height;
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
    return {
      name: u.name,
      color: u.color,
      assigned: round2(assigned),
      paid: round2(paid),
      pending: round2(assigned - paid),
      disbursed: round2(disbursed),
    };
  });

  const doc = new PDFDocument({ margin: MARGIN, size: "A4", bufferPages: true });

  // Entete courante repetee en haut des pages 2+ (la page 1 a son propre
  // gros en-tete de marque, dessine plus bas). La toute premiere page est
  // creee par le constructeur de PDFDocument, avant qu'on puisse s'abonner
  // a cet evenement : il ne se declenche donc naturellement que pour les
  // pages 2 et suivantes, sans qu'il soit necessaire de s'en proteger.
  doc.on("pageAdded", () => {
    doc.font("Helvetica-Bold").fontSize(9).fillColor(COLOR_PRIMARY);
    doc.text("AppartBudget", MARGIN, MARGIN - 4, { width: 200, lineBreak: false });
    doc.font("Helvetica").fontSize(9).fillColor(COLOR_MUTED);
    doc.text(periodLabel, MARGIN, MARGIN - 4, { width: CONTENT_WIDTH, align: "right", lineBreak: false });
    doc
      .moveTo(MARGIN, MARGIN + HEADER_SPACE - 12)
      .lineTo(doc.page.width - MARGIN, MARGIN + HEADER_SPACE - 12)
      .strokeColor(COLOR_BORDER)
      .lineWidth(1)
      .stroke();
    doc.y = MARGIN + HEADER_SPACE;
  });

  doc.pipe(res);

  // ---- En-tete de marque (page 1) ----
  // Position de depart capturee UNE FOIS : ne jamais relire doc.y entre deux
  // appels .text() de ce bloc, pdfkit le mute a chaque appel (source d'un
  // bug deja rencontre plus haut dans ce fichier).
  const badgeSize = 30;
  const headerTop = doc.y;
  doc.roundedRect(MARGIN, headerTop, badgeSize, badgeSize, 9).fill(COLOR_PRIMARY);
  doc
    .font("Helvetica-Bold")
    .fontSize(13)
    .fillColor("#ffffff")
    .text("AB", MARGIN, headerTop + 9, { width: badgeSize, align: "center", lineBreak: false });
  doc
    .font("Helvetica-Bold")
    .fontSize(17)
    .fillColor(COLOR_TEXT)
    .text("AppartBudget", MARGIN + badgeSize + 12, headerTop + 3, {
      width: CONTENT_WIDTH - badgeSize - 12,
      lineBreak: false,
    });
  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor(COLOR_MUTED)
    .text(`Généré le ${formatDate(new Date())}`, MARGIN + badgeSize + 12, headerTop + 23, {
      width: CONTENT_WIDTH - badgeSize - 12,
      lineBreak: false,
    });
  doc.y = headerTop + badgeSize + 14;

  doc.font("Helvetica-Bold").fontSize(19).fillColor(COLOR_TEXT);
  fullWidthText(doc, `Rapport mensuel — ${periodLabel}`);
  doc.y += 4;
  doc
    .moveTo(MARGIN, doc.y)
    .lineTo(doc.page.width - MARGIN, doc.y)
    .strokeColor(COLOR_PRIMARY)
    .lineWidth(2)
    .stroke();
  doc.y += 16;

  // ---- Resume (cartes de statistiques, comme le tableau de bord) ----
  sectionTitle(doc, "Résumé");
  const statCards = [
    { label: "Total", value: formatAmount(totalAmount), accent: COLOR_PRIMARY },
    { label: "Frais fixes", value: formatAmount(totalByKind.fixed), accent: COLOR_PRIMARY },
    { label: "Frais ponctuels", value: formatAmount(totalByKind.occasional), accent: COLOR_INFO },
    { label: "Frais exceptionnels", value: formatAmount(totalByKind.exceptional), accent: COLOR_WARNING },
  ];
  drawCardGrid(doc, statCards, 56, 118, (item, x, y, w) => {
    doc.font("Helvetica-Bold").fontSize(8).fillColor(COLOR_MUTED);
    doc.text(item.label.toUpperCase(), x + 12, y + 11, { width: w - 24, lineBreak: false });
    doc.font("Helvetica-Bold").fontSize(15).fillColor(COLOR_TEXT);
    doc.text(item.value, x + 12, y + 27, { width: w - 24, lineBreak: false });
  });
  doc.font("Helvetica").fontSize(8.5).fillColor(COLOR_FAINT);
  fullWidthText(doc, `${expenses.length} dépense(s) sur la période`);
  doc.y += 10;

  if (byUser.length > 0) {
    drawCardGrid(doc, byUser, 70, 200, (u, x, y, w) => {
      const pad = 14;
      drawAvatar(doc, x + pad + 9, y + pad + 7, 9, { initial: u.name.charAt(0).toUpperCase(), color: u.color });
      doc.font("Helvetica-Bold").fontSize(10.5).fillColor(COLOR_TEXT);
      doc.text(u.name, x + pad + 24, y + pad + 1, { width: w - pad * 2 - 24, lineBreak: false });

      const barY = y + pad + 24;
      const barW = w - pad * 2;
      const ratio = u.assigned > 0 ? Math.min(1, u.paid / u.assigned) : 0;
      doc.roundedRect(x + pad, barY, barW, 5, 2.5).fill(COLOR_SURFACE_3);
      if (ratio > 0) {
        doc.roundedRect(x + pad, barY, Math.max(6, barW * ratio), 5, 2.5).fill(COLOR_PRIMARY);
      }

      const statusY = barY + 12;
      if (u.pending > 0.005) {
        doc.font("Helvetica-Bold").fontSize(8.5).fillColor(COLOR_DANGER);
        doc.text(`${formatAmount(u.pending)} restant à confirmer`, x + pad, statusY, { width: barW, lineBreak: false });
      } else {
        doc.font("Helvetica-Bold").fontSize(8.5).fillColor(COLOR_SUCCESS);
        doc.text("Tout est réglé", x + pad, statusY, { width: barW, lineBreak: false });
      }
    });
  }

  // ---- Repartition par categorie (barres horizontales) ----
  sectionTitle(doc, "Répartition par catégorie");
  const barLabelWidth = 150;
  const barAmountWidth = 100;
  const barMaxWidth = CONTENT_WIDTH - barLabelWidth - barAmountWidth - 10;
  if (byCategory.length === 0) {
    doc.font("Helvetica").fontSize(10).fillColor(COLOR_MUTED);
    fullWidthText(doc, "Aucune dépense sur cette période.");
  }
  const categoryTotalSum = byCategory.reduce((s, c) => s + c.total, 0) || 1;
  const maxCategoryTotal = byCategory[0]?.total || 1;
  for (const c of byCategory) {
    ensureSpace(doc, 20);
    const y = doc.y;
    doc.roundedRect(MARGIN, y + 2, 8, 8, 2).fill(c.color);
    doc
      .font("Helvetica")
      .fontSize(9.5)
      .fillColor(COLOR_TEXT)
      .text(c.name, MARGIN + 14, y + 1, { width: barLabelWidth - 14 });
    const barWidth = Math.max(4, (c.total / maxCategoryTotal) * barMaxWidth);
    doc.roundedRect(MARGIN + barLabelWidth, y, barMaxWidth, 10, 5).fill(COLOR_SURFACE_3);
    doc.roundedRect(MARGIN + barLabelWidth, y, barWidth, 10, 5).fill(c.color);
    const pct = Math.round((c.total / categoryTotalSum) * 100);
    doc
      .font("Helvetica-Bold")
      .fontSize(9.5)
      .fillColor(COLOR_TEXT)
      .text(formatAmount(c.total), MARGIN + barLabelWidth + barMaxWidth + 10, y, {
        width: barAmountWidth,
        align: "right",
        lineBreak: false,
      });
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor(COLOR_FAINT)
      .text(`${pct} %`, MARGIN + barLabelWidth + barMaxWidth + 10, y + 12, {
        width: barAmountWidth,
        align: "right",
        lineBreak: false,
      });
    doc.y = y + 22;
  }

  // ---- Detail des depenses ----
  sectionTitle(doc, "Détail des dépenses");
  if (expenses.length === 0) {
    doc.font("Helvetica").fontSize(10).fillColor(COLOR_MUTED);
    fullWidthText(doc, "Aucune dépense sur cette période.");
  } else {
    const cols = [
      { key: "date", label: "Date", x: MARGIN, width: 62, color: () => COLOR_MUTED },
      { key: "label", label: "Dépense", x: MARGIN + 66, width: 118 },
      { key: "category", label: "Catégorie", x: MARGIN + 190, width: 80, color: () => COLOR_MUTED },
      {
        key: "kind",
        label: "Type",
        x: MARGIN + 275,
        width: 62,
        pill: (row) => ({ text: KIND_LABELS[row.kindRaw] || row.kindRaw, ...(KIND_PILL[row.kindRaw] || {}) }),
      },
      { key: "amount", label: "Montant", x: MARGIN + 342, width: 65, align: "right" },
      { key: "split", label: "Répartition", x: MARGIN + 412, width: CONTENT_WIDTH - 412 },
    ];
    drawTableHeader(doc, cols);
    expenses.forEach((e, i) => {
      const split = e.shares
        .map((s) => `${s.user.name} : ${formatAmount(s.amount)}${s.paid ? "  (réglé)" : ""}`)
        .join("\n");
      drawTableRow(
        doc,
        cols,
        {
          date: formatDate(e.date),
          label: e.label,
          category: e.category.name,
          kindRaw: e.kind,
          amount: formatAmount(e.amount),
          split,
        },
        i
      );
    });
  }

  // ---- Historique des versements ----
  sectionTitle(doc, "Historique des versements");
  if (payments.length === 0) {
    doc.font("Helvetica").fontSize(10).fillColor(COLOR_MUTED);
    fullWidthText(doc, "Aucun versement enregistré sur cette période.");
  } else {
    const cols = [
      { key: "date", label: "Date", x: MARGIN, width: 62, color: () => COLOR_MUTED },
      { key: "payer", label: "Payé par", x: MARGIN + 66, width: 100 },
      { key: "for", label: "Pour la part de", x: MARGIN + 170, width: 100 },
      { key: "expense", label: "Dépense", x: MARGIN + 274, width: 130, color: () => COLOR_MUTED },
      {
        key: "amount",
        label: "Montant",
        x: MARGIN + 408,
        width: CONTENT_WIDTH - 408,
        align: "right",
        color: () => COLOR_SUCCESS,
      },
    ];
    drawTableHeader(doc, cols);
    payments.forEach((p, i) => {
      drawTableRow(
        doc,
        cols,
        {
          date: formatDate(p.date),
          payer: p.paidBy.name,
          for: p.share.userId === p.paidByUserId ? "Lui-même" : p.share.user.name,
          expense: p.share.expense.label,
          amount: formatAmount(p.amount),
        },
        i
      );
    });
  }

  // ---- Pied de page (numeros de page) ----
  // Reste strictement dans la zone de marge : au-dela, pdfkit considere
  // que le texte "ne rentre pas" et cree silencieusement une page
  // supplementaire (vide) pour l'y placer.
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc
      .moveTo(MARGIN, doc.page.height - doc.page.margins.bottom - 20)
      .lineTo(doc.page.width - MARGIN, doc.page.height - doc.page.margins.bottom - 20)
      .strokeColor(COLOR_BORDER)
      .lineWidth(1)
      .stroke();
    doc.font("Helvetica").fontSize(8).fillColor(COLOR_FAINT);
    doc.text("AppartBudget", MARGIN, doc.page.height - doc.page.margins.bottom - 13, {
      width: 200,
      lineBreak: false,
    });
    doc.text(`Page ${i + 1} / ${range.count}`, MARGIN, doc.page.height - doc.page.margins.bottom - 13, {
      width: CONTENT_WIDTH,
      align: "right",
      lineBreak: false,
    });
  }

  doc.end();
}
