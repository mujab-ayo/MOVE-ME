import { Router, Request, Response } from "express";
import { z } from "zod";
import { AppDataSource } from "../data-source";
import { User } from "../entities/user.entity";
import { requireAuth, requireRole } from "../middleware/auth.middleware";
import { validateBody } from "../middleware/validate.middleware";

const router = Router();
const userRepository = AppDataSource.getRepository(User);

const enableDriverSchema = z.object({
  enabled: z.boolean(),
});

// GET /admin/drivers - list drivers (e.g. status=pending)
router.get(
  "/drivers",
  requireAuth,
  requireRole("ADMIN"),
  async (req: Request, res: Response): Promise<void> => {
    const { status } = req.query;

    try {
      const whereCondition: any = { role: "DRIVER" };

      if (status === "pending") {
        whereCondition.driver_enabled = false;
      }

      const drivers = await userRepository.find({
        where: whereCondition,
        select: {
          id: true,
          email: true,
          role: true,
          driver_enabled: true,
          created_at: true,
        },
        order: { created_at: "DESC" },
      });

      res.status(200).json(drivers);
    } catch (_err) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// PATCH /admin/drivers/:id/enable - enable/disable a driver account
router.patch(
  "/drivers/:id/enable",
  requireAuth,
  requireRole("ADMIN"),
  validateBody(enableDriverSchema),
  async (req: Request, res: Response): Promise<void> => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { enabled } = req.body;

    try {
      const user = await userRepository.findOneBy({ id });

      // Return 404 if user not found or not a driver
      if (!user || user.role !== "DRIVER") {
        res.status(404).json({ error: "Driver not found" });
        return;
      }

      user.driver_enabled = enabled;
      await userRepository.save(user);

      res.status(200).json({
        driverId: user.id,
        enabled: user.driver_enabled,
      });
    } catch (_err) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;
