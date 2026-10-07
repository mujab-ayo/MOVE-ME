import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  OneToMany,
} from "typeorm";
import { User } from "./user.entity";
import { Departure } from "./departure.entity";
import { Payment } from "./payment.entity";

export type ReservationStatus =
  | "PENDING_PAYMENT"
  | "CONFIRMED"
  | "FAILED"
  | "EXPIRED"
  | "CANCELLED"
  | "COMPLETED";

@Entity("reservations")
@Index("one_active_reservation_per_passenger_per_departure", ["departure_id", "passenger_id"], {
  unique: true,
  where: "status IN ('PENDING_PAYMENT','CONFIRMED')",
})
@Index("reservations_departure_status_idx", ["departure_id", "status", "hold_expires_at"])
export class Reservation {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "departure_id", type: "uuid" })
  departure_id!: string;

  @ManyToOne(() => Departure)
  @JoinColumn({ name: "departure_id" })
  departure!: Departure;

  @Column({ name: "passenger_id", type: "uuid" })
  passenger_id!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: "passenger_id" })
  passenger!: User;

  @Column({
    type: "text",
    default: "PENDING_PAYMENT",
  })
  status!: ReservationStatus;

  @Column({ name: "fare_amount", type: "numeric", precision: 10, scale: 2 })
  fare_amount!: string;

  @Column({ name: "hold_expires_at", type: "timestamptz" })
  hold_expires_at!: Date;

  @CreateDateColumn({
    name: "created_at",
    type: "timestamptz",
    default: () => "now()",
  })
  created_at!: Date;

  @Column({ name: "cancelled_at", type: "timestamptz", nullable: true })
  cancelled_at!: Date | null;

  @Column({ name: "cancellation_reason", type: "text", nullable: true })
  cancellation_reason!: string | null;

  @OneToMany(() => Payment, (payment) => payment.reservation)
  payments!: Payment[];
}
