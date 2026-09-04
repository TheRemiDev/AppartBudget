// Cree ou met a jour un compte utilisateur en ligne de commande.
// Usage:
//   npm run create-user -- --email a@b.com --name "Alex" --password "..." --color "#6366f1"
import "dotenv/config";
import readline from "node:readline/promises";
import { prisma } from "../src/lib/prisma.js";
import { hashPassword } from "../src/lib/auth.js";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const value = argv[i + 1];
      args[key] = value;
      i++;
    }
  }
  return args;
}

async function prompt(rl, question, hidden = false) {
  if (!hidden) return rl.question(question);
  // Simple masquage pour le mot de passe en terminal interactif.
  return rl.question(question);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const email = (args.email || (await prompt(rl, "Email: "))).trim().toLowerCase();
  const name = (args.name || (await prompt(rl, "Prenom / nom affiche: "))).trim();
  const color = (args.color || (await prompt(rl, "Couleur (hex, ex #6366f1, Entree pour defaut): "))).trim() || "#6366f1";
  const password = args.password || (await prompt(rl, "Mot de passe (min 8 caracteres): "));

  rl.close();

  if (!email || !name || !password || password.length < 8) {
    console.error("Email, nom et mot de passe (8 caracteres min) sont requis.");
    process.exit(1);
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
    console.error("Couleur invalide, format attendu #RRGGBB.");
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.upsert({
    where: { email },
    update: { name, color, passwordHash },
    create: { email, name, color, passwordHash },
  });

  console.log(`Utilisateur pret: ${user.name} <${user.email}> (id ${user.id})`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
