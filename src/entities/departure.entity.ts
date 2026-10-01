import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { User } from "./user.entity";
import { Vehicle } from "./vehicle.entity";
import { Route } from "./route.entity";

export type DepartureMode = "SOLO" | "POOLED";
export type DepartureStatus =
  | "SCHEDULED"
  | "ARRIVED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED";

@Entity("departures")
export class Departure {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "driver_id", type: "uuid" })
  driver_id!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: "driver_id" })
  driver!: User;

  @Column({ name: "vehicle_id", type: "uuid" })
  vehicle_id!: string;

  @ManyToOne(() => Vehicle)
  @JoinColumn({ name: "vehicle_id" })
  vehicle!: Vehicle;

  @Column({ name: "route_id", type: "uuid" })
  route_id!: string;

  @ManyToOne(() => Route)
  @JoinColumn({ name: "route_id" })
  route!: Route;

  @Column({ type: "text" })
  mode!: DepartureMode;

  @Column({ name: "departure_time", type: "timestamptz" })
  departure_time!: Date;

  @Column({ name: "duration_minutes", type: "int" })
  duration_minutes!: number;

  @Column({ name: "fare_amount", type: "numeric", precision: 10, scale: 2 })
  fare_amount!: string;

  @Column({ type: "int" })
  capacity!: number;

  @Column({ type: "text", default: "SCHEDULED" })
  status!: DepartureStatus;

  @CreateDateColumn({
    name: "created_at",
    type: "timestamptz",
    default: () => "now()",
  })
  created_at!: Date;
}
