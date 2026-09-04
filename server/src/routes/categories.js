import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";

export const categoriesRouter = Router();

categoriesRouter.use(requireAuth);

categoriesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const includeArchived = req.query.includeArchived === "true";
    const categories = await prisma.category.findMany({
      where: includeArchived ? {} : { archived: false },
      orderBy: { name: "asc" },
    });
    res.json({ categories });
  })
);

const categorySchema = z.object({
  name: z.string().min(1).max(60),
  icon: z.string().min(1).max(8).default("EUR"),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#64748b"),
  kind: z.enum(["fixed", "occasional", "exceptional"]),
  defaultAmount: z.number().positive().optional().nullable(),
});

categoriesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = categorySchema.parse(req.body);
    const category = await prisma.category.create({ data });
    res.status(201).json({ category });
  })
);

categoriesRouter.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = categorySchema.partial().parse(req.body);
    const category = await prisma.category.update({
      where: { id: req.params.id },
      data,
    });
    res.json({ category });
  })
);

categoriesRouter.patch(
  "/:id/archive",
  asyncHandler(async (req, res) => {
    const archived = z.object({ archived: z.boolean() }).parse(req.body).archived;
    const category = await prisma.category.update({
      where: { id: req.params.id },
      data: { archived },
    });
    res.json({ category });
  })
);

categoriesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const usageCount = await prisma.expense.count({ where: { categoryId: req.params.id } });
    if (usageCount > 0) {
      const category = await prisma.category.update({
        where: { id: req.params.id },
        data: { archived: true },
      });
      return res.json({ category, archived: true });
    }
    await prisma.category.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  })
);
