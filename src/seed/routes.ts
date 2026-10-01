import dotenv from "dotenv";
dotenv.config({ path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env' });

import { AppDataSource } from "../data-source";
import { Route } from "../entities/route.entity";

export const fixedRoutes = [
  {
    pickup_point: "Ikeja City Mall, Alausa, Ikeja",
    dropoff_point: "Victoria Island Financial District, Lagos",
    base_duration_minutes: 45,
    base_fare_solo: "7500.00",
    base_fare_per_seat: "2500.00",
    active: true,
  },
  {
    pickup_point: "Lekki Phase 1 Gate, Admiralty Way",
    dropoff_point: "Murtala Muhammed International Airport (LOS)",
    base_duration_minutes: 60,
    base_fare_solo: "10000.00",
    base_fare_per_seat: "3500.00",
    active: true,
  },
  {
    pickup_point: "Yaba Tech Hub, Herbert Macaulay Way",
    dropoff_point: "Marina Bus Terminal, Lagos Island",
    base_duration_minutes: 30,
    base_fare_solo: "5000.00",
    base_fare_per_seat: "1800.00",
    active: true,
  },
];

export async function seedRoutes(): Promise<void> {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }

  const routeRepository = AppDataSource.getRepository(Route);

  const count = await routeRepository.count();
  if (count > 0) {
    console.log(`Routes table already contains ${count} route(s). Skipping seed.`);
    return;
  }

  console.log("Seeding fixed routes...");
  for (const routeData of fixedRoutes) {
    const route = routeRepository.create(routeData);
    await routeRepository.save(route);
    console.log(
      `Created route: ${route.pickup_point} -> ${route.dropoff_point} (Solo: ${route.base_fare_solo}, Pooled: ${route.base_fare_per_seat})`
    );
  }

  console.log("Routes seeded successfully.");
}

if (require.main === module) {
  seedRoutes()
    .then(async () => {
      if (AppDataSource.isInitialized) {
        await AppDataSource.destroy();
      }
      process.exit(0);
    })
    .catch(async (error) => {
      console.error("Error during routes seed:", error);
      if (AppDataSource.isInitialized) {
        await AppDataSource.destroy();
      }
      process.exit(1);
    });
}
