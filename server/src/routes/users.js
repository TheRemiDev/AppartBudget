import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, publicUser } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { hashPassword } from "../lib/auth.js";

export const usersRouter = Router();

usersRouter.use(requireAuth);

// Liste des membres du foyer (utile pour les selecteurs de repartition).
usersRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });
    res.json({ users: users.map(publicUser) });
  })
);

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(60),
  password: z.string().min(8, "Le mot de passe doit contenir au moins 8 caracteres."),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#4f46e5"),
});

// Ajoute un nouveau membre du foyer. Pas de systeme d'inscription publique :
// seul un membre deja connecte peut en ajouter un autre.
usersRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const { email, name, password, color } = createUserSchema.parse(req.body);
    const normalizedEmail = email.toLowerCase();

    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      return res.status(409).json({ error: "Cet email est déjà utilisé par un membre du foyer." });
    }

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: { email: normalizedEmail, name, color, passwordHash },
    });
    res.status(201).json({ user: publicUser(user) });
  })
);

const updateUserSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});

// Modifie le nom/la couleur d'un membre (le sien ou celui d'un autre : app
// privee a usage strictement familial, sans systeme de roles distinct).
usersRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = updateUserSchema.parse(req.body);
    const user = await prisma.user
      .update({ where: { id: req.params.id }, data })
      .catch(() => null);
    if (!user) return res.status(404).json({ error: "Membre introuvable." });
    res.json({ user: publicUser(user) });
  })
);

const resetPasswordSchema = z.object({
  password: z.string().min(8, "Le mot de passe doit contenir au moins 8 caracteres."),
});

// Reinitialise directement le mot de passe d'un membre du foyer (par
// exemple soi-meme ou son/sa partenaire), sans exiger l'ancien mot de
// passe : usage prevu depuis un compte deja authentifie et de confiance.
usersRouter.post(
  "/:id/reset-password",
  asyncHandler(async (req, res) => {
    const { password } = resetPasswordSchema.parse(req.body);
    const passwordHash = await hashPassword(password);
    const user = await prisma.user
      .update({ where: { id: req.params.id }, data: { passwordHash } })
      .catch(() => null);
    if (!user) return res.status(404).json({ error: "Membre introuvable." });
    res.json({ ok: true });
  })
);

// Supprime un membre du foyer, avec des garde-fous : impossible de se
// supprimer soi-meme, de supprimer le dernier compte restant, ou un membre
// qui a deja des depenses/versements/charges recurrentes a son nom (il faut
// d'abord reassigner ou supprimer cet historique).
usersRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: "Vous ne pouvez pas supprimer votre propre compte." });
    }

    const totalUsers = await prisma.user.count();
    if (totalUsers <= 1) {
      return res.status(400).json({ error: "Impossible de supprimer le dernier compte du foyer." });
    }

    const [expenseCount, shareCount, templateCount, paymentCount] = await Promise.all([
      prisma.expense.count({ where: { createdById: req.params.id } }),
      prisma.expenseShare.count({ where: { userId: req.params.id } }),
      prisma.recurringTemplate.count({ where: { createdById: req.params.id } }),
      prisma.sharePayment.count({ where: { paidByUserId: req.params.id } }),
    ]);
    if (expenseCount || shareCount || templateCount || paymentCount) {
      return res.status(400).json({
        error:
          "Ce membre a des dépenses, parts ou versements associés : impossible de le supprimer sans perdre cet historique.",
      });
    }

    await prisma.user.delete({ where: { id: req.params.id } }).catch(() => null);
    res.json({ ok: true });
  })
);
