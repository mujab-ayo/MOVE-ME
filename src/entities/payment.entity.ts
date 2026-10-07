import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from "typeorm";
import { Reservation } from "./reservation.entity";

export type PaymentStatus =
  | "PENDING"
  | "SUCCEEDED"
  | "FAILED"
  | "EXPIRED"
  | "REFUNDED";

@Entity("payments")
@Index("one_successful_payment_per_reservation", ["reservation_id"], {
  unique: true,
  where: "status = 'SUCCEEDED'",
})
export class Payment {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "reservation_id", type: "uuid" })
  reservation_id!: string;

  @ManyToOne(() => Reservation, (reservation) => reservation.payments)
  @JoinColumn({ name: "reservation_id" })
  reservation!: Reservation;

  @Column({ type: "numeric", precision: 10, scale: 2 })
  amount!: string;

  @Column({
    type: "text",
    default: "PENDING",
  })
  status!: PaymentStatus;

  @Column({ name: "idempotency_key", type: "text", unique: true })
  idempotency_key!: string;

  @CreateDateColumn({
    name: "created_at",
    type: "timestamptz",
    default: () => "now()",
  })
  created_at!: Date;

  @Column({ name: "completed_at", type: "timestamptz", nullable: true })
  completed_at!: Date | null;
}
