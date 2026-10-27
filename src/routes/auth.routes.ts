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
 *     summary: Register a new passenger account (Public).
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
 *                 example: ada.passenger@example.com
 *               password:
 *                 type: string
 *                 format: password
 *                 minLength: 6
 *                 example: SecurePassword123!
 *               fullName:
 *                 type: string
 *                 example: Ada Lovelace
 *               phone:
 *                 type: string
 *                 example: "+2348012345678"
 *           example:
 *             email: ada.passenger@example.com
 *             password: SecurePassword123!
 *             fullName: Ada Lovelace
 *             phone: "+2348012345678"
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
 *                   example: 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d
 *             example:
 *               userId: 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d
 *       400:
 *         description: Validation failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       409:
 *         description: Email is already registered
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
      throw err;
    }
  }
);

/**
 * @openapi
 * /auth/register/driver:
 *   post:
 *     summary: Register a new driver account pending admin verification (Public).
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
 *                 example: kofi.driver@example.com
 *               password:
 *                 type: string
 *                 format: password
 *                 minLength: 6
 *                 example: DriverPassword123!
 *               fullName:
 *                 type: string
 *                 example: Kofi Mensah
 *               phone:
 *                 type: string
 *                 example: "+2348087654321"
 *           example:
 *             email: kofi.driver@example.com
 *             password: DriverPassword123!
 *             fullName: Kofi Mensah
 *             phone: "+2348087654321"
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
 *                   example: 1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed
 *                 driverEnabled:
 *                   type: boolean
 *                   example: false
 *             example:
 *               userId: 1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed
 *               driverEnabled: false
 *       400:
 *         description: Validation failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       409:
 *         description: Email is already registered
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
      throw err;
    }
  }
);

/**
 * @openapi
 * /auth/login:
 *   post:
 *     summary: Authenticate with email and password to receive a JWT access token (Public).
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
 *                 example: ada.passenger@example.com
 *               password:
 *                 type: string
 *                 format: password
 *                 example: SecurePassword123!
 *           example:
 *             email: ada.passenger@example.com
 *             password: SecurePassword123!
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
 *             example:
 *               accessToken: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *               role: PASSENGER
 *       400:
 *         description: Validation failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Invalid email or password
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
// POST /auth/login
router.post(
  "/login",
  validateBody(loginSchema),
  async (req: Request, res: Response): Promise<void> => {
    const { email, password } = req.body;

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
  }
);

export default router;
