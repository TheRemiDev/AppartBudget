// Cree un jeu de categories de depenses courantes si la table est vide.
// Sans danger a relancer: n'ajoute rien si des categories existent deja.
import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";

const DEFAULTS = [
  { name: "Loyer", icon: "🏠", color: "#6366f1", kind: "fixed" },
  { name: "Électricité", icon: "⚡", color: "#f59e0b", kind: "fixed" },
  { name: "Gaz", icon: "🔥", color: "#ef4444", kind: "fixed" },
  { name: "Internet", icon: "📶", color: "#0ea5e9", kind: "fixed" },
  { name: "Assurance habitation", icon: "🛡️", color: "#14b8a6", kind: "fixed" },
  { name: "Eau", icon: "💧", color: "#3b82f6", kind: "fixed" },
  { name: "Courses", icon: "🛒", color: "#22c55e", kind: "occasional" },
  { name: "Sorties & loisirs", icon: "🎉", color: "#ec4899", kind: "occasional" },
  { name: "Entretien & réparations", icon: "🔧", color: "#a855f7", kind: "exceptional" },
  { name: "Autres", icon: "📦", color: "#64748b", kind: "occasional" },
];

async function main() {
  const count = await prisma.category.count();
  if (count > 0) {
    console.log(`Des categories existent deja (${count}), aucune modification.`);
    await prisma.$disconnect();
    return;
  }
  await prisma.category.createMany({ data: DEFAULTS });
  console.log(`${DEFAULTS.length} categories creees.`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
