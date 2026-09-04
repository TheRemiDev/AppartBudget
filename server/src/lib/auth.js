import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "30d";

if (!JWT_SECRET || JWT_SECRET.length < 16) {
  throw new Error(
    "JWT_SECRET manquant ou trop court. Definissez une valeur robuste dans le fichier .env (voir .env.example)."
  );
}

export const COOKIE_NAME = "appartbudget_session";

export function hashPassword(plain) {
  return bcrypt.hash(plain, 12);
}

export function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

export function signSession(user) {
  return jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function verifySession(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

export function cookieOptions() {
  const secure = process.env.TRUST_PROXY_HTTPS === "true";
  return {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 1000 * 60 * 60 * 24 * 30, // 30 jours
  };
}
