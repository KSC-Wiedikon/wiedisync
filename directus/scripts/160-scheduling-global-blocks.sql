-- Migration 160: club-wide scheduling blackout dates (superadmin-only).
--
-- Counterpart of the per-team scheduling_blocks (migration 085). A row here blocks
-- HOME games for EVERY team on the covered date range — club holidays, AGM,
-- tournaments, hall-wide events. Per-team blocks (coach/TR-set) still layer on top;
-- this is the global layer, editable only by the superadmin via the custom
-- /terminplanung/admin/club-blocked-dates endpoints (raw knex — no items-API
-- access, so no directus_fields/permission rows needed).
--
-- Schema-only + idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS scheduling_global_blocks (
  id           serial PRIMARY KEY,
  start_date   date NOT NULL,
  end_date     date NOT NULL,
  reason       text,
  created_by   integer REFERENCES members(id) ON DELETE SET NULL,
  date_created timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scheduling_global_blocks_dates_check CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS scheduling_global_blocks_range_idx
  ON scheduling_global_blocks (start_date, end_date);

COMMIT;
