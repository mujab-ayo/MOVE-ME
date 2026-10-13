import { Router, Request, Response } from "express";
import { AppDataSource } from "../data-source";
import { Route } from "../entities/route.entity";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

/**
 * @openapi
 * /routes:
 *   get:
 *     summary: List active routes
 *     description: Returns all active routes ordered by pickup point. Accessible by any authenticated user regardless of role.
 *     tags:
 *       - Departures
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of active routes ordered by pickup point
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                     format: uuid
 *                     example: 123e4567-e89b-12d3-a456-426614174000
 *                   pickup_point:
 *                     type: string
 *                     example: Ikeja City Mall, Alausa, Ikeja
 *                   dropoff_point:
 *                     type: string
 *                     example: Victoria Island Financial District, Lagos
 *                   base_duration_minutes:
 *                     type: integer
 *                     example: 45
 *                   base_fare_solo:
 *                     type: string
 *                     example: "7500.00"
 *                   base_fare_per_seat:
 *                     type: string
 *                     example: "2500.00"
 *       401:
 *         description: Authentication token missing or invalid
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Authentication token missing or invalid
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Internal server error
 */
router.get(
  "/",
  requireAuth,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const routeRepository = AppDataSource.getRepository(Route);
      const routes = await routeRepository.find({
        where: { active: true },
        order: { pickup_point: "ASC" },
      });

      const response = routes.map((route) => ({
        id: route.id,
        pickup_point: route.pickup_point,
        dropoff_point: route.dropoff_point,
        base_duration_minutes: route.base_duration_minutes,
        base_fare_solo: route.base_fare_solo,
        base_fare_per_seat: route.base_fare_per_seat,
      }));

      res.status(200).json(response);
    } catch (_err) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;
