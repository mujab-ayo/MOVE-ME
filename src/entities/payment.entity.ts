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
  | "REFUNDED"
  | "REFUND_PENDING"
  | "REFUND_FAILED";

export type PaymentProvider = "SIMULATED" | "PAYSTACK";

@Entity("payments")
@Index("one_successful_payment_per_reservation", ["reservation_id"], {
  unique: true,
  where: "status = 'SUCCEEDED'",
})
@Index("idx_payments_provider_reference", ["provider_reference"], {
  unique: true,
  where: "provider_reference IS NOT NULL",
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

  @Column({
    type: "text",
    default: "SIMULATED",
  })
  provider!: PaymentProvider;

  @Column({ name: "provider_reference", type: "text", nullable: true })
  provider_reference!: string | null;

  @Column({ name: "provider_refund_id", type: "text", nullable: true })
  provider_refund_id!: string | null;

  @Column({ name: "refund_requested_at", type: "timestamptz", nullable: true })
  refund_requested_at!: Date | null;

  @Column({ name: "refund_claimed_at", type: "timestamptz", nullable: true })
  refund_claimed_at!: Date | null;

  @Column({ name: "refund_attempts", type: "int", default: 0 })
  refund_attempts!: number;

  @Column({ name: "refund_error", type: "text", nullable: true })
  refund_error!: string | null;

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

  @Column({ name: "refunded_at", type: "timestamptz", nullable: true })
  refunded_at!: Date | null;
}
