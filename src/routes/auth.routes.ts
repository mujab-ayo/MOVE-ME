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
