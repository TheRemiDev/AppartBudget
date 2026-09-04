import { ZodError } from "zod";

export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

export function notFoundHandler(req, res) {
  res.status(404).json({ error: "Ressource introuvable." });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: "Donnees invalides.",
      details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  const status = err.status || 400;
  const message = err.message || "Une erreur est survenue.";
  if (!err.status) {
    console.error(err);
  }
  res.status(status).json({ error: message });
}
