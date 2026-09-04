import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, publicUser } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";

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
