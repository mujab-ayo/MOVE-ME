import { Router, Request, Response } from "express";
import { z } from "zod";
import { AppDataSource } from "../data-source";
import { Notification } from "../entities/notification.entity";
import { requireAuth, requireRole } from "../middleware/auth.middleware";

const router = Router();

/**
 * @openapi
 * /notifications/{id}/read:
 *   patch:
 *     summary: Mark a passenger notification as read (PASSENGER role only).
 *     description: Marks a notification as read if it is currently unread. Idempotent. Requires PASSENGER role and ownership.
 *     tags:
 *       - Bookings
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Notification UUID
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *           example: {}
 *     responses:
 *       200:
 *         description: Notification marked as read
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                   format: uuid
 *                 readAt:
 *                   type: string
 *                   format: date-time
 *                 read_at:
 *                   type: string
 *                   format: date-time
 *             example:
 *               id: "123e4567-e89b-12d3-a456-426614174000"
 *               readAt: "2026-10-25T12:00:00.000Z"
 *               read_at: "2026-10-25T12:00:00.000Z"
 *       400:
 *         description: Invalid notification ID format
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Invalid notification ID format"
 *       401:
 *         description: Authentication token missing or invalid
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Authentication token missing or invalid"
 *       403:
 *         description: Forbidden - not your notification or insufficient permissions
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Forbidden: not your notification"
 *       404:
 *         description: Notification not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Notification not found"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Internal server error"
 */
router.patch(
  "/:id/read",
  requireAuth,
  requireRole("PASSENGER"),
  async (req: Request, res: Response): Promise<void> => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    if (!z.string().uuid().safeParse(id).success) {
      res.status(400).json({ error: "Invalid notification ID format" });
      return;
    }

    const passengerId = req.user!.id;
    const notificationRepo = AppDataSource.getRepository(Notification);

    const notification = await notificationRepo.findOne({ where: { id } });

    if (!notification) {
      res.status(404).json({ error: "Notification not found" });
      return;
    }

    if (notification.user_id !== passengerId) {
      res.status(403).json({ error: "Forbidden: not your notification" });
      return;
    }

    let readAt = notification.read_at;
    if (!readAt) {
      readAt = new Date();
      notification.read_at = readAt;
      await notificationRepo.save(notification);
    }

    res.status(200).json({
      id: notification.id,
      readAt,
      read_at: readAt,
    });
  }
);

export default router;
