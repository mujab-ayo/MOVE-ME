import { Router, Request, Response } from "express";
import { AppDataSource } from "../data-source";
import { Route } from "../entities/route.entity";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

/**
 * @openapi
 * /routes:
 *   get:
 *     summary: Retrieve all active routes in the system (PASSENGER, DRIVER, or ADMIN roles).
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
 *                   pickup_point:
 *                     type: string
 *                   dropoff_point:
 *                     type: string
 *                   base_duration_minutes:
 *                     type: integer
 *                   base_fare_solo:
 *                     type: string
 *                   base_fare_per_seat:
 *                     type: string
 *             example:
 *               - id: "123e4567-e89b-12d3-a456-426614174000"
 *                 pickup_point: "Ikeja City Mall, Alausa, Ikeja"
 *                 dropoff_point: "Victoria Island Financial District, Lagos"
 *                 base_duration_minutes: 45
 *                 base_fare_solo: "7500.00"
 *                 base_fare_per_seat: "2500.00"
 *       401:
 *         description: Authentication token missing or invalid
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Authentication token missing or invalid"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Internal server error"
 */
router.get(
  "/",
  requireAuth,
  async (_req: Request, res: Response): Promise<void> => {
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
  }
);

export default router;
