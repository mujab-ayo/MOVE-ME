import { Router, Request, Response } from "express";
import { z } from "zod";
import argon2 from "argon2";
import jwt from "jsonwebtoken";
import { AppDataSource } from "../data-source";
import { User } from "../entities/user.entity";
import { validateBody } from "../middleware/validate.middleware";

const router = Router();
const userRepository = AppDataSource.getRepository(User);

const registerSchema = z.object({
  email: z.string().email("Valid email required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  fullName: z.string().optional(),
  phone: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email("Valid email required"),
  password: z.string().min(1, "Password is required"),
});

/**
 * @openapi
 * /auth/register/passenger:
 *   post:
 *     summary: Register a new passenger
 *     description: Creates a new user account with PASSENGER role.
 *     tags:
 *       - Auth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: passenger@example.com
 *               password:
 *                 type: string
 *                 format: password
 *                 minLength: 6
 *                 example: Password123!
 *               fullName:
 *                 type: string
 *                 example: Jane Doe
 *               phone:
 *                 type: string
 *                 example: "+2348012345678"
 *     responses:
 *       201:
 *         description: Passenger registered successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 userId:
 *                   type: string
 *                   format: uuid
 *                   example: 123e4567-e89b-12d3-a456-426614174000
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Validation failed
 *                 details:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       field:
 *                         type: string
 *                       message:
 *                         type: string
 *       409:
 *         description: Email is already registered
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Email is already registered
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
// POST /auth/register/passenger
router.post(
  "/register/passenger",
  validateBody(registerSchema),
  async (req: Request, res: Response): Promise<void> => {
    const { email, password } = req.body;

    try {
      const existingUser = await userRepository.findOneBy({ email });
      if (existingUser) {
        res.status(409).json({ error: "Email is already registered" });
        return;
      }

      const password_hash = await argon2.hash(password);

      const user = userRepository.create({
        email,
        password_hash,
        role: "PASSENGER",
        driver_enabled: false,
      });

      await userRepository.save(user);

      res.status(201).json({ userId: user.id });
    } catch (err: any) {
      if (err.code === "23505") {
        res.status(409).json({ error: "Email is already registered" });
        return;
      }
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

/**
 * @openapi
 * /auth/register/driver:
 *   post:
 *     summary: Register a new driver
 *     description: Creates a new user account with DRIVER role. The driver account initially has driver_enabled set to false until verified and enabled by an admin.
 *     tags:
 *       - Auth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: driver@example.com
 *               password:
 *                 type: string
 *                 format: password
 *                 minLength: 6
 *                 example: Password123!
 *               fullName:
 *                 type: string
 *                 example: John Driver
 *               phone:
 *                 type: string
 *                 example: "+2348087654321"
 *     responses:
 *       201:
 *         description: Driver registered successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 userId:
 *                   type: string
 *                   format: uuid
 *                   example: 123e4567-e89b-12d3-a456-426614174000
 *                 driverEnabled:
 *                   type: boolean
 *                   example: false
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Validation failed
 *                 details:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       field:
 *                         type: string
 *                       message:
 *                         type: string
 *       409:
 *         description: Email is already registered
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Email is already registered
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
// POST /auth/register/driver
router.post(
  "/register/driver",
  validateBody(registerSchema),
  async (req: Request, res: Response): Promise<void> => {
    const { email, password } = req.body;

    try {
      const existingUser = await userRepository.findOneBy({ email });
      if (existingUser) {
        res.status(409).json({ error: "Email is already registered" });
        return;
      }

      const password_hash = await argon2.hash(password);

      const user = userRepository.create({
        email,
        password_hash,
        role: "DRIVER",
        driver_enabled: false,
      });

      await userRepository.save(user);

      res.status(201).json({
        userId: user.id,
        driverEnabled: false,
      });
    } catch (err: any) {
      if (err.code === "23505") {
        res.status(409).json({ error: "Email is already registered" });
        return;
      }
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

/**
 * @openapi
 * /auth/login:
 *   post:
 *     summary: Login user
 *     description: Authenticates a user by email and password, returning a JWT token with sub and role claims.
 *     tags:
 *       - Auth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: user@example.com
 *               password:
 *                 type: string
 *                 format: password
 *                 example: Password123!
 *     responses:
 *       200:
 *         description: Successful login
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 accessToken:
 *                   type: string
 *                   description: JWT access token
 *                   example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *                 role:
 *                   type: string
 *                   enum:
 *                     - PASSENGER
 *                     - DRIVER
 *                     - ADMIN
 *                   example: PASSENGER
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Validation failed
 *                 details:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       field:
 *                         type: string
 *                       message:
 *                         type: string
 *       401:
 *         description: Invalid email or password
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Invalid email or password
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
// POST /auth/login
router.post(
  "/login",
  validateBody(loginSchema),
  async (req: Request, res: Response): Promise<void> => {
    const { email, password } = req.body;

    try {
      const user = await userRepository.findOneBy({ email });
      if (!user) {
        res.status(401).json({ error: "Invalid email or password" });
        return;
      }

      let passwordValid = false;
      try {
        passwordValid = await argon2.verify(user.password_hash, password);
      } catch (_verifyErr) {
        passwordValid = false;
      }

      if (!passwordValid) {
        res.status(401).json({ error: "Invalid email or password" });
        return;
      }

      const secret = process.env.JWT_SECRET;
      if (!secret) {
        res.status(500).json({ error: "JWT_SECRET is not configured on server" });
        return;
      }

      // Payload includes sub and role ONLY — per design decision
      const accessToken = jwt.sign(
        {
          sub: user.id,
          role: user.role,
        },
        secret,
        { expiresIn: "1d" }
      );

      res.status(200).json({
        accessToken,
        role: user.role,
      });
    } catch (_err) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;
