import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
} from "typeorm";

@Entity("routes")
export class Route {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "pickup_point", type: "text" })
  pickup_point!: string;

  @Column({ name: "dropoff_point", type: "text" })
  dropoff_point!: string;

  @Column({ name: "base_duration_minutes", type: "int" })
  base_duration_minutes!: number;

  @Column({ name: "base_fare_solo", type: "numeric", precision: 10, scale: 2 })
  base_fare_solo!: string;

  @Column({ name: "base_fare_per_seat", type: "numeric", precision: 10, scale: 2 })
  base_fare_per_seat!: string;

  @Column({ type: "boolean", default: true })
  active!: boolean;
}
