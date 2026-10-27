# Regression Test Report

- **Date & Time:** 2026-10-25T19:20:02.429Z
- **Test Database Host:** `ep-proud-moon-b5mz6q7v-pooler.c-7.us-east-2.aws.neon.tech`
- **Total Run Time:** 920.10 seconds

## Suite & Test Totals

| Category | Passed | Failed | Skipped | Total |
| :--- | :---: | :---: | :---: | :---: |
| **Test Suites** | 20 | 0 | 0 | 20 |
| **Tests** | 228 | 0 | 0 | 228 |

## Failing Tests

None (all tests passed).

## Requirement & Focus Area Traceability

| Requirement / Focus Area | Mapped Tests | Passed | Failed | Missing | Status |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **MM-01** | 14 | 14 | 0 | 0 | PASS |
| **MM-02** | 11 | 11 | 0 | 0 | PASS |
| **MM-03** | 6 | 6 | 0 | 0 | PASS |
| **MM-04** | 3 | 3 | 0 | 0 | PASS |
| **MM-05** | 5 | 5 | 0 | 0 | PASS |
| **MM-06** | 9 | 9 | 0 | 0 | PASS |
| **MM-07** | 8 | 8 | 0 | 0 | PASS |
| **MM-08** | 8 | 8 | 0 | 0 | PASS |
| **LAST-SEAT** | 6 | 6 | 0 | 0 | PASS |
| **DRIVER-OVERLAP** | 11 | 11 | 0 | 0 | PASS |
| **LATE-PAYMENT** | 8 | 8 | 0 | 0 | PASS |
| **ACCESS-CONTROL** | 71 | 71 | 0 | 0 | PASS |

## Live Database Constraints & Indexes

Live catalog definitions extracted from PostgreSQL host `ep-proud-moon-b5mz6q7v-pooler.c-7.us-east-2.aws.neon.tech` for tables `departures`, `reservations`, and `payments`.

### Constraints (`pg_get_constraintdef`)

| Table | Constraint Name | Type | Definition |
| :--- | :--- | :---: | :--- |
| `departures` | `departures_capacity_check` | CHECK | `CHECK (capacity > 0)` |
| `departures` | `departures_capacity_not_null` | NOT NULL | `NOT NULL capacity` |
| `departures` | `departures_created_at_not_null` | NOT NULL | `NOT NULL created_at` |
| `departures` | `departures_departure_time_not_null` | NOT NULL | `NOT NULL departure_time` |
| `departures` | `departures_driver_id_fkey` | FOREIGN KEY | `FOREIGN KEY (driver_id) REFERENCES users(id)` |
| `departures` | `departures_driver_id_not_null` | NOT NULL | `NOT NULL driver_id` |
| `departures` | `departures_driver_id_tstzrange_excl` | EXCLUSION | `EXCLUDE USING gist (driver_id WITH =, tstzrange(departure_time, departure_end_time(departure_time, duration_minutes), '[)'::text) WITH &&) WHERE (status <> 'CANCELLED'::text)` |
| `departures` | `departures_duration_minutes_check` | CHECK | `CHECK (duration_minutes > 0)` |
| `departures` | `departures_duration_minutes_not_null` | NOT NULL | `NOT NULL duration_minutes` |
| `departures` | `departures_fare_amount_check` | CHECK | `CHECK (fare_amount >= 0::numeric)` |
| `departures` | `departures_fare_amount_not_null` | NOT NULL | `NOT NULL fare_amount` |
| `departures` | `departures_id_not_null` | NOT NULL | `NOT NULL id` |
| `departures` | `departures_mode_check` | CHECK | `CHECK (mode = ANY (ARRAY['SOLO'::text, 'POOLED'::text]))` |
| `departures` | `departures_mode_not_null` | NOT NULL | `NOT NULL mode` |
| `departures` | `departures_pkey` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `departures` | `departures_route_id_fkey` | FOREIGN KEY | `FOREIGN KEY (route_id) REFERENCES routes(id)` |
| `departures` | `departures_route_id_not_null` | NOT NULL | `NOT NULL route_id` |
| `departures` | `departures_status_check` | CHECK | `CHECK (status = ANY (ARRAY['SCHEDULED'::text, 'ARRIVED'::text, 'IN_PROGRESS'::text, 'COMPLETED'::text, 'CANCELLED'::text]))` |
| `departures` | `departures_status_not_null` | NOT NULL | `NOT NULL status` |
| `departures` | `departures_vehicle_id_fkey` | FOREIGN KEY | `FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)` |
| `departures` | `departures_vehicle_id_not_null` | NOT NULL | `NOT NULL vehicle_id` |
| `departures` | `departures_vehicle_id_tstzrange_excl` | EXCLUSION | `EXCLUDE USING gist (vehicle_id WITH =, tstzrange(departure_time, departure_end_time(departure_time, duration_minutes), '[)'::text) WITH &&) WHERE (status <> 'CANCELLED'::text)` |
| `payments` | `payments_amount_not_null` | NOT NULL | `NOT NULL amount` |
| `payments` | `payments_created_at_not_null` | NOT NULL | `NOT NULL created_at` |
| `payments` | `payments_id_not_null` | NOT NULL | `NOT NULL id` |
| `payments` | `payments_idempotency_key_key` | UNIQUE | `UNIQUE (idempotency_key)` |
| `payments` | `payments_idempotency_key_not_null` | NOT NULL | `NOT NULL idempotency_key` |
| `payments` | `payments_pkey` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `payments` | `payments_reservation_id_fkey` | FOREIGN KEY | `FOREIGN KEY (reservation_id) REFERENCES reservations(id)` |
| `payments` | `payments_reservation_id_not_null` | NOT NULL | `NOT NULL reservation_id` |
| `payments` | `payments_status_check` | CHECK | `CHECK (status = ANY (ARRAY['PENDING'::text, 'SUCCEEDED'::text, 'FAILED'::text, 'EXPIRED'::text, 'REFUNDED'::text]))` |
| `payments` | `payments_status_not_null` | NOT NULL | `NOT NULL status` |
| `reservations` | `reservations_created_at_not_null` | NOT NULL | `NOT NULL created_at` |
| `reservations` | `reservations_departure_id_fkey` | FOREIGN KEY | `FOREIGN KEY (departure_id) REFERENCES departures(id)` |
| `reservations` | `reservations_departure_id_not_null` | NOT NULL | `NOT NULL departure_id` |
| `reservations` | `reservations_fare_amount_not_null` | NOT NULL | `NOT NULL fare_amount` |
| `reservations` | `reservations_hold_expires_at_not_null` | NOT NULL | `NOT NULL hold_expires_at` |
| `reservations` | `reservations_id_not_null` | NOT NULL | `NOT NULL id` |
| `reservations` | `reservations_passenger_id_fkey` | FOREIGN KEY | `FOREIGN KEY (passenger_id) REFERENCES users(id)` |
| `reservations` | `reservations_passenger_id_not_null` | NOT NULL | `NOT NULL passenger_id` |
| `reservations` | `reservations_pkey` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `reservations` | `reservations_status_check` | CHECK | `CHECK (status = ANY (ARRAY['PENDING_PAYMENT'::text, 'CONFIRMED'::text, 'FAILED'::text, 'EXPIRED'::text, 'CANCELLED'::text, 'COMPLETED'::text]))` |
| `reservations` | `reservations_status_not_null` | NOT NULL | `NOT NULL status` |

### Indexes (`pg_indexes`)

| Table | Index Name | Index Definition |
| :--- | :--- | :--- |
| `departures` | `departures_driver_id_tstzrange_excl` | `CREATE INDEX departures_driver_id_tstzrange_excl ON public.departures USING gist (driver_id, tstzrange(departure_time, departure_end_time(departure_time, duration_minutes), '[)'::text)) WHERE (status <> 'CANCELLED'::text)` |
| `departures` | `departures_pkey` | `CREATE UNIQUE INDEX departures_pkey ON public.departures USING btree (id)` |
| `departures` | `departures_vehicle_id_tstzrange_excl` | `CREATE INDEX departures_vehicle_id_tstzrange_excl ON public.departures USING gist (vehicle_id, tstzrange(departure_time, departure_end_time(departure_time, duration_minutes), '[)'::text)) WHERE (status <> 'CANCELLED'::text)` |
| `departures` | `one_active_trip_per_driver` | `CREATE UNIQUE INDEX one_active_trip_per_driver ON public.departures USING btree (driver_id) WHERE (status = ANY (ARRAY['ARRIVED'::text, 'IN_PROGRESS'::text]))` |
| `payments` | `one_successful_payment_per_reservation` | `CREATE UNIQUE INDEX one_successful_payment_per_reservation ON public.payments USING btree (reservation_id) WHERE (status = 'SUCCEEDED'::text)` |
| `payments` | `payments_idempotency_key_key` | `CREATE UNIQUE INDEX payments_idempotency_key_key ON public.payments USING btree (idempotency_key)` |
| `payments` | `payments_pkey` | `CREATE UNIQUE INDEX payments_pkey ON public.payments USING btree (id)` |
| `reservations` | `one_active_reservation_per_passenger_per_departure` | `CREATE UNIQUE INDEX one_active_reservation_per_passenger_per_departure ON public.reservations USING btree (departure_id, passenger_id) WHERE (status = ANY (ARRAY['PENDING_PAYMENT'::text, 'CONFIRMED'::text]))` |
| `reservations` | `reservations_departure_status_idx` | `CREATE INDEX reservations_departure_status_idx ON public.reservations USING btree (departure_id, status, hold_expires_at)` |
| `reservations` | `reservations_pkey` | `CREATE UNIQUE INDEX reservations_pkey ON public.reservations USING btree (id)` |

