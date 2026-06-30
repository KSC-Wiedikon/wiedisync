-- Migration 162: training occurrence tombstones (skip regeneration).
--
-- The slot→trainings generator (kscw-hooks/src/slot-cascade.js) materializes a
-- training for every (hall_slot, date) the weekly recurrence lands on, deduping
-- ONLY by whether a training row already exists for that pair. It had no memory
-- of an occurrence a coach intentionally DELETED, or DETACHED from its slot by
-- editing the time — so the nightly top-up cron (02:00 UTC) and the on-edit
-- cascade fill would resurrect it the next morning. Surfaced 2026-06-30: D4's
-- Monday 20:00 training kept respawning after coach Daniela moved it to 19:30
-- (the edited 29-Jun instance lost its hall_slot link → generator saw the slot's
-- Monday "empty" → re-created the old-time duplicate, deleted ~daily).
--
-- A row here records "do NOT regenerate (hall_slot, date)". It is written by the
-- trainings delete/update hooks in index.js (raw knex — no items-API exposure,
-- so no directus_fields / permission rows needed), consulted by all three
-- generators in slot-cascade.js, and cleared when a training is (re)created for
-- that pair (so manually re-adding an occurrence works). ON DELETE CASCADE on
-- hall_slot drops a slot's skips when the slot itself is deleted.
--
-- Schema-only + idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS training_slot_skips (
  id           serial PRIMARY KEY,
  hall_slot    integer NOT NULL REFERENCES hall_slots(id) ON DELETE CASCADE,
  date         date NOT NULL,
  created_by   uuid,
  date_created timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT training_slot_skips_uniq UNIQUE (hall_slot, date)
);

CREATE INDEX IF NOT EXISTS training_slot_skips_slot_idx
  ON training_slot_skips (hall_slot);

COMMIT;
