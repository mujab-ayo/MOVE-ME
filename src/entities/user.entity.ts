import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToMany,
} from "typeorm";
import { Vehicle } from "./vehicle.entity";

export type UserRole = "PASSENGER" | "DRIVER" | "ADMIN";

@Entity("users")
export class User {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "citext", unique: true })
  email!: string;

  @Column({ name: "password_hash", type: "text" })
  password_hash!: string;

  @Column({
    type: "text",
  })
  role!: UserRole;

  @Column({ name: "driver_enabled", type: "boolean", default: false })
  driver_enabled!: boolean;

  @CreateDateColumn({
    name: "created_at",
    type: "timestamptz",
    default: () => "now()",
  })
  created_at!: Date;

  @OneToMany(() => Vehicle, (vehicle) => vehicle.driver)
  vehicles!: Vehicle[];
}
