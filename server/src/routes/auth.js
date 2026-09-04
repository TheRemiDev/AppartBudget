import { Router } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { prisma } from "../lib/prisma.js";
import { COOKIE_NAME, cookieOptions, signSession, verifyPassword, hashPassword } from "../lib/auth.js";
import { requireAuth, publicUser } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de tentatives de connexion. Reessayez dans quelques minutes." },
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post(
  "/login",
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) {
      return res.status(401).json({ error: "Identifiants incorrects." });
    }
    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: "Identifiants incorrects." });
    }
    const token = signSession(user);
    res.cookie(COOKIE_NAME, token, cookieOptions());
    res.json({ user: publicUser(user) });
  })
);

authRouter.post("/logout", (req, res) => {
  res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: 0 });
  res.json({ ok: true });
});

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: publicUser(req.user) });
  })
);

const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "Le mot de passe doit contenir au moins 8 caracteres."),
});

authRouter.post(
  "/change-password",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = passwordSchema.parse(req.body);
    const valid = await verifyPassword(currentPassword, req.user.passwordHash);
    if (!valid) {
      return res.status(400).json({ error: "Mot de passe actuel incorrect." });
    }
    const passwordHash = await hashPassword(newPassword);
    await prisma.user.update({ where: { id: req.user.id }, data: { passwordHash } });
    res.json({ ok: true });
  })
);

const profileSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});

authRouter.patch(
  "/profile",
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = profileSchema.parse(req.body);
    const user = await prisma.user.update({ where: { id: req.user.id }, data });
    res.json({ user: publicUser(user) });
  })
);
