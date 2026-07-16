-- 221 — Let a scheduling slot span more than one court, so the VM push can
-- express a combo booking (KWI A+B → VM gym 4144).
--
-- The gap this closes. `game_scheduling_slots.hall` is a single FK, so a slot —
-- and therefore a booking, and therefore the push — could only ever name ONE
-- court. `games` has expressed a multi-court booking since basketball
-- (`games.additional_halls`, json, interface `tags`), but the scheduling side had
-- no equivalent, and nothing links a booking to its game to borrow it from:
--
--     game_scheduling_bookings.game  → games   : 0 of 78 confirmed populated
--     game_scheduling_slots.game     → games   : 0 of 2017 populated
--     game_scheduling_slots.booking            : 0 of 2017 populated
--
-- (measured on prod 2026-07-16 — the FKs exist in directus_relations but nothing
-- writes them; slots and games are matched implicitly by date/time/hall/team.)
--
-- So `vm-push-game.mjs`, which resolves its hall from `booking.slot.hall`, would
-- push a derby's A+B booking to VM as gym 3231 (A alone) — silently, reporting
-- success, overwriting a correct 4144. That is the same class of bug as 209 (KWI
-- C pinned to the 3-court 914), mirrored: 209 booked too MANY courts, this books
-- too FEW.
--
-- Mirrors `games.additional_halls` exactly — same `json` type, same `cast-json`
-- special, same `tags` interface — so the two sides of the model agree and
-- `hallIdsOf()` (vm-halls.mjs) can flatten either shape identically.
--
-- Null or empty = an ordinary single-court slot. Nothing populates it yet: the
-- Spielplanung UI still needs a picker before a coordinator can create an A+B
-- slot. Until then this column is inert and every existing slot keeps behaving
-- exactly as before — see resolveVmHall's 'single' path.

ALTER TABLE public.game_scheduling_slots
  ADD COLUMN IF NOT EXISTS additional_halls json;

-- Register the field so the items API and the Directus admin can read/write it.
-- directus_fields has no unique key on (collection, field), so ON CONFLICT is not
-- available — guard with NOT EXISTS to stay idempotent.
INSERT INTO directus_fields (collection, field, special, interface, note, width)
SELECT 'game_scheduling_slots',
       'additional_halls',
       'cast-json',
       'tags',
       'Extra hall IDs this slot also occupies (e.g. the KWI A+B derby combo). Null or empty = single-hall. Pushed to VolleyManager as one combo gym — see vm-halls.mjs.',
       'full'
 WHERE NOT EXISTS (
   SELECT 1 FROM directus_fields
    WHERE collection = 'game_scheduling_slots' AND field = 'additional_halls'
 );
