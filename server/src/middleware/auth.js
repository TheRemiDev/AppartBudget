import { prisma } from "../lib/prisma.js";
import { COOKIE_NAME, verifySession } from "../lib/auth.js";

export async function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ error: "Non authentifie." });
  }
  const payload = verifySession(token);
  if (!payload?.sub) {
    return res.status(401).json({ error: "Session invalide ou expiree." });
  }
  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user) {
    return res.status(401).json({ error: "Utilisateur introuvable." });
  }
  req.user = user;
  next();
}

export function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    color: user.color,
    createdAt: user.createdAt,
  };
}
