import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { User } from "./user.entity";

@Entity("vehicles")
export class Vehicle {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "driver_id", type: "uuid" })
  driver_id!: string;

  @ManyToOne(() => User, (user) => user.vehicles, { onDelete: "CASCADE" })
  @JoinColumn({ name: "driver_id" })
  driver!: User;

  @Column({ type: "text" })
  description!: string;

  @Column({ name: "registration_identifier", type: "text", unique: true })
  registration_identifier!: string;

  @Column({ name: "seat_capacity", type: "int" })
  seat_capacity!: number;

  @Column({ type: "boolean", default: true })
  active!: boolean;

  @CreateDateColumn({
    name: "created_at",
    type: "timestamptz",
    default: () => "now()",
  })
  created_at!: Date;
}
