import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import compression from "compression";
import morgan from "morgan";
import cron from "node-cron";

import { authRouter } from "./routes/auth.js";
import { usersRouter } from "./routes/users.js";
import { categoriesRouter } from "./routes/categories.js";
import { expensesRouter } from "./routes/expenses.js";
import { recurringTemplatesRouter } from "./routes/recurringTemplates.js";
import { installmentPlansRouter } from "./routes/installmentPlans.js";
import { personalRouter } from "./routes/personal.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { notFoundHandler, errorHandler } from "./middleware/errorHandler.js";
import { generateDueTemplates } from "./lib/recurringGenerator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4310;
const app = express();

if (process.env.TRUST_PROXY_HTTPS === "true") {
  app.set("trust proxy", 1);
}

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
      },
    },
  })
);
app.use(compression());
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

if (process.env.CORS_ORIGIN) {
  app.use(cors({ origin: process.env.CORS_ORIGIN, credentials: true }));
}

app.use("/api/auth", authRouter);
app.use("/api/users", usersRouter);
app.use("/api/categories", categoriesRouter);
app.use("/api/expenses", expensesRouter);
app.use("/api/recurring-templates", recurringTemplatesRouter);
app.use("/api/installment-plans", installmentPlansRouter);
app.use("/api/personal", personalRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api", notFoundHandler);

// Sert le frontend compile (npm run build depuis /client) en production.
const clientDist = path.resolve(__dirname, "../../client/dist");
app.use(express.static(clientDist));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  res.sendFile(path.join(clientDist, "index.html"), (err) => {
    if (err) next(err);
  });
});

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`AppartBudget demarre sur le port ${PORT}`);
});

// Genere chaque nuit a 03h05 les depenses fixes du mois pour les modeles
// recurrents dont la date d'echeance est atteinte. Idempotent.
cron.schedule("5 3 * * *", async () => {
  try {
    const created = await generateDueTemplates(new Date());
    if (created.length) {
      console.log(`${created.length} depense(s) recurrente(s) generee(s).`);
    }
  } catch (err) {
    console.error("Erreur lors de la generation des depenses recurrentes:", err);
  }
});
