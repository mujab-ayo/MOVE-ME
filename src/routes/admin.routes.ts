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

/**
 * @openapi
 * /admin/drivers:
 *   get:
 *     summary: List prospective drivers pending administrative approval (Admin only).
 *     description: Lists drivers with optional status filtering. When status is set to pending, only drivers awaiting enablement (driver_enabled=false) are returned. Requires ADMIN role.
 *     tags:
 *       - Admin
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum:
 *             - pending
 *         required: false
 *         description: Filter drivers by status (e.g. pending for unapproved drivers)
 *     responses:
 *       200:
 *         description: List of drivers matching the filter
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
 *                     example: 1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed
 *                   email:
 *                     type: string
 *                     format: email
 *                     example: kofi.driver@example.com
 *                   role:
 *                     type: string
 *                     example: DRIVER
 *                   driver_enabled:
 *                     type: boolean
 *                     example: false
 *                   created_at:
 *                     type: string
 *                     format: date-time
 *                     example: "2026-10-02T08:00:00.000Z"
 *             example:
 *               - id: "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed"
 *                 email: "kofi.driver@example.com"
 *                 role: "DRIVER"
 *                 driver_enabled: false
 *                 created_at: "2026-10-02T08:00:00.000Z"
 *       401:
 *         description: Authentication token missing or invalid
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       403:
 *         description: Forbidden - admin role required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// GET /admin/drivers - list drivers (e.g. status=pending)
router.get(
  "/drivers",
  requireAuth,
  requireRole("ADMIN"),
  async (req: Request, res: Response): Promise<void> => {
    const { status } = req.query;

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
  }
);

/**
 * @openapi
 * /admin/drivers/{id}/enable:
 *   patch:
 *     summary: Enable or disable driver publishing privileges (Admin only).
 *     description: Enables or disables a driver account. Enabling a driver is required before they can publish departures. Requires ADMIN role.
 *     tags:
 *       - Admin
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: User UUID of the driver to enable or disable
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - enabled
 *             properties:
 *               enabled:
 *                 type: boolean
 *                 example: true
 *           example:
 *             enabled: true
 *     responses:
 *       200:
 *         description: Driver enablement status updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 driverId:
 *                   type: string
 *                   format: uuid
 *                   example: 1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed
 *                 enabled:
 *                   type: boolean
 *                   example: true
 *             example:
 *               driverId: 1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed
 *               enabled: true
 *       400:
 *         description: Validation failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Authentication token missing or invalid
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       403:
 *         description: Forbidden - admin role required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Driver not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// PATCH /admin/drivers/:id/enable - enable/disable a driver account
router.patch(
  "/drivers/:id/enable",
  requireAuth,
  requireRole("ADMIN"),
  validateBody(enableDriverSchema),
  async (req: Request, res: Response): Promise<void> => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { enabled } = req.body;

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
  }
);

export default router;
