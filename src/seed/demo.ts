import dotenv from "dotenv";
dotenv.config({ path: process.env.NODE_ENV === "test" ? ".env.test" : ".env" });

import argon2 from "argon2";
import { AppDataSource } from "../data-source";
import { User, UserRole } from "../entities/user.entity";
import { Vehicle } from "../entities/vehicle.entity";
import { Route } from "../entities/route.entity";
import { Departure } from "../entities/departure.entity";
import { seedRoutes } from "./routes";

interface TableCounts {
  users: number;
  routes: number;
  vehicles: number;
  departures: number;
}

interface DemoUserConfig {
  email: string;
  plaintextPassword: string;
  role: UserRole;
  driver_enabled: boolean;
}

const DEMO_USERS: DemoUserConfig[] = [
  {
    email: "admin@example.com",
    plaintextPassword: "AdminPassword123!",
    role: "ADMIN",
    driver_enabled: false,
  },
  {
    email: "driver1@example.com",
    plaintextPassword: "DriverPassword123!",
    role: "DRIVER",
    driver_enabled: true,
  },
  {
    email: "passenger1@example.com",
    plaintextPassword: "PassengerPassword123!",
    role: "PASSENGER",
    driver_enabled: false,
  },
];

const DEMO_VEHICLE = {
  description: "Toyota Corolla, silver",
  registration_identifier: "LND-123-AB",
  seat_capacity: 4,
};

function extractHost(url?: string): string {
  if (!url) return "unknown";
  const match = url.match(/@([^/?:]+)/);
  return match ? match[1] : "unknown";
}

async function getRowCounts(): Promise<TableCounts> {
  const userRepo = AppDataSource.getRepository(User);
  const routeRepo = AppDataSource.getRepository(Route);
  const vehicleRepo = AppDataSource.getRepository(Vehicle);
  const departureRepo = AppDataSource.getRepository(Departure);

  const [users, routes, vehicles, departures] = await Promise.all([
    userRepo.count(),
    routeRepo.count(),
    vehicleRepo.count(),
    departureRepo.count(),
  ]);

  return { users, routes, vehicles, departures };
}

function printRowCounts(label: string, counts: TableCounts): void {
  console.log(`${label}:`);
  console.log(`  Users:      ${counts.users}`);
  console.log(`  Routes:     ${counts.routes}`);
  console.log(`  Vehicles:   ${counts.vehicles}`);
  console.log(`  Departures: ${counts.departures}`);
}

export async function seedDemo(): Promise<void> {
  // 1. Refuse to run if NODE_ENV === 'test'
  if (process.env.NODE_ENV === "test") {
    console.error("Refusing to run demo seed when NODE_ENV === 'test'. Demo seed must not run against the test database.");
    process.exit(1);
  }

  // 2. Initialize database connection and print host and initial row counts
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }

  const host = extractHost(process.env.DATABASE_URL);
  console.log(`Database host: ${host}`);

  const countsBefore = await getRowCounts();
  printRowCounts("Row counts before seed", countsBefore);

  const userRepo = AppDataSource.getRepository(User);
  const vehicleRepo = AppDataSource.getRepository(Vehicle);

  // 3 & 4. Idempotently upsert demo users using argon2 hashing (matching auth register endpoint)
  console.log("\nSeeding demo users...");
  for (const userConfig of DEMO_USERS) {
    const password_hash = await argon2.hash(userConfig.plaintextPassword);

    let user = await userRepo.findOneBy({ email: userConfig.email });
    if (user) {
      user.password_hash = password_hash;
      user.role = userConfig.role;
      user.driver_enabled = userConfig.driver_enabled;
      await userRepo.save(user);
      console.log(`  Updated user: ${user.email} (role: ${user.role}, driver_enabled: ${user.driver_enabled})`);
    } else {
      user = userRepo.create({
        email: userConfig.email,
        password_hash,
        role: userConfig.role,
        driver_enabled: userConfig.driver_enabled,
      });
      await userRepo.save(user);
      console.log(`  Created user: ${user.email} (role: ${user.role}, driver_enabled: ${user.driver_enabled})`);
    }
  }

  // Idempotently upsert vehicle for driver1
  console.log("\nSeeding driver vehicle...");
  const driverUser = await userRepo.findOneBy({ email: "driver1@example.com" });
  if (!driverUser) {
    throw new Error("Could not find driver user driver1@example.com for vehicle assignment.");
  }

  let vehicle = await vehicleRepo.findOneBy({
    registration_identifier: DEMO_VEHICLE.registration_identifier,
  });

  if (vehicle) {
    vehicle.driver_id = driverUser.id;
    vehicle.driver = driverUser;
    vehicle.description = DEMO_VEHICLE.description;
    vehicle.seat_capacity = DEMO_VEHICLE.seat_capacity;
    vehicle.active = true;
    await vehicleRepo.save(vehicle);
    console.log(
      `  Updated vehicle: ${vehicle.registration_identifier} - ${vehicle.description} (capacity: ${vehicle.seat_capacity})`
    );
  } else {
    vehicle = vehicleRepo.create({
      driver_id: driverUser.id,
      driver: driverUser,
      description: DEMO_VEHICLE.description,
      registration_identifier: DEMO_VEHICLE.registration_identifier,
      seat_capacity: DEMO_VEHICLE.seat_capacity,
      active: true,
    });
    await vehicleRepo.save(vehicle);
    console.log(
      `  Created vehicle: ${vehicle.registration_identifier} - ${vehicle.description} (capacity: ${vehicle.seat_capacity})`
    );
  }

  // 5. Seed fixed routes reusing existing routes seed logic
  console.log("\nSeeding routes...");
  await seedRoutes();

  // 6. Read back each user's stored password_hash and verify with argon2.verify
  console.log("\nVerifying user credentials with argon2.verify...");
  let allPasswordsValid = true;

  for (const userConfig of DEMO_USERS) {
    const storedUser = await userRepo.findOneBy({ email: userConfig.email });
    if (!storedUser || !storedUser.password_hash) {
      console.error(`  ${userConfig.email}: FAILED (user or password_hash missing)`);
      allPasswordsValid = false;
      continue;
    }

    let isValid = false;
    try {
      isValid = await argon2.verify(storedUser.password_hash, userConfig.plaintextPassword);
    } catch (_err) {
      isValid = false;
    }

    if (isValid) {
      console.log(`  ${userConfig.email}: OK`);
    } else {
      console.error(`  ${userConfig.email}: FAILED`);
      allPasswordsValid = false;
    }
  }

  if (!allPasswordsValid) {
    console.error("Password verification failed for one or more demo users.");
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
    process.exit(1);
  }

  // Row counts after seed
  const countsAfter = await getRowCounts();
  console.log("");
  printRowCounts("Row counts after seed", countsAfter);
}

if (require.main === module) {
  // Top-level guard against test environment
  if (process.env.NODE_ENV === "test") {
    console.error("Refusing to run demo seed when NODE_ENV === 'test'. Demo seed must not run against the test database.");
    process.exit(1);
  }

  seedDemo()
    .then(async () => {
      if (AppDataSource.isInitialized) {
        await AppDataSource.destroy();
      }
      process.exit(0);
    })
    .catch(async (error) => {
      console.error("Error during demo seed execution:", error);
      if (AppDataSource.isInitialized) {
        await AppDataSource.destroy();
      }
      process.exit(1);
    });
}
