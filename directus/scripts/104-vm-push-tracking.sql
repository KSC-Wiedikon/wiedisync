-- 104: VolleyManager push tracking.
--
-- When a spielplaner confirms a HOME game in Terminplanung we push its
-- date/time/hall into VolleyManager (volleymanager.volleyball.ch) via the
-- writable game API. This migration adds the columns that track that push and
-- the per-hall VM hall UUID used as the write target.
--
-- Schema-only + idempotent. No permission change: `halls` and
-- `game_scheduling_bookings` are both fields:['*'] in setup-permissions, so the
-- new columns are exposed/writable without a perms edit.

-- Per-hall VolleyManager hall identity (the `hall[__identity]` sent on a game
-- update). Distinct from `sv_hall_id` (Swiss Volley NATIONAL hall id, used by
-- sv-sync) — this is the VolleyManager indoor hall UUID.
ALTER TABLE public.halls
  ADD COLUMN IF NOT EXISTS vm_hall_id character varying(64);

-- Per-home-booking push state.
--   vm_game_id      = the VM game __identity we wrote to (svrz_persistence_id)
--   vm_pushed_at    = when the successful write landed
--   vm_push_status  = queued | pushed | pushed_no_hall | needs_pick | no_fixture | failed
--   vm_push_error   = failure message, OR a JSON {"needs_pick":[{id,label,date}]} candidate list
ALTER TABLE public.game_scheduling_bookings
  ADD COLUMN IF NOT EXISTS vm_game_id     character varying(64),
  ADD COLUMN IF NOT EXISTS vm_pushed_at   timestamp with time zone,
  ADD COLUMN IF NOT EXISTS vm_push_status character varying(24),
  ADD COLUMN IF NOT EXISTS vm_push_error  text;

-- Backfill VolleyManager hall UUIDs for KSCW's home halls (captured live
-- 2026-06-10). Döltschi 1 + 2 are two courts of one VM venue, so both map to
-- the single VM "Döltschi" hall — consistent with the scheduling rule that
-- Döltschi is one game per date regardless of court.
UPDATE public.halls SET vm_hall_id = '9427f854-6ec8-4bf3-8c60-360cfcf2d4b1' WHERE name ILIKE 'KWI A'     AND COALESCE(vm_hall_id, '') = '';
UPDATE public.halls SET vm_hall_id = '600f0efa-82ac-46cf-8c33-7eae7b05ca82' WHERE name ILIKE 'KWI B'     AND COALESCE(vm_hall_id, '') = '';
UPDATE public.halls SET vm_hall_id = '122655f3-806e-4415-8305-5f7f9d19dab0' WHERE name ILIKE 'KWI C'     AND COALESCE(vm_hall_id, '') = '';
UPDATE public.halls SET vm_hall_id = '5a80a35c-a054-4e1f-9c43-88c765d1707f' WHERE name ILIKE 'Döltschi%' AND COALESCE(vm_hall_id, '') = '';
