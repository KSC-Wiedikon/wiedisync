-- 220 — Keep `halls` rows one-court-only, now that VM has a second combo gym.
--
-- Background. VolleyManager's Wiedikon registry holds individually homologated
-- courts AND multi-court *combo* entries:
--   3231 Kantonsschule Wiedikon A    9427f854-6ec8-4bf3-8c60-360cfcf2d4b1  (1 court, homol. H)
--   3232 Kantonsschule Wiedikon B    600f0efa-82ac-46cf-8c33-7eae7b05ca82  (1 court, homol. H)
--   3989 Kantonsschule Wiedikon C    a3265f9d-f7ad-49d3-ab27-07da709ad7fc  (1 court, homol. H)
--    153 Schulhaus Döltschi          5a80a35c-a054-4e1f-9c43-88c765d1707f  (homol. G)
--    914 Kantonsschule Wiedikon A-C  122655f3-806e-4415-8305-5f7f9d19dab0  (3 courts, homol. C)
--   4144 Kantonsschule Wiedikon A+B  5261363c-da18-40e4-ab87-9d6bbdb6240b  (2 courts, homol. G)
-- (4144 read live from the game API 2026-07-16; it postdates migration 209.)
--
-- 4144 is a REAL, in-use gym, not a mistake to guard against: we open the divider
-- and play across A+B for the H1/H3 derbies (VM #406192, #406237 — already placed
-- there), and basketball spans A+B as a matter of course. Expect Spielplanung to
-- push double-hall games to it directly in a future season.
--
-- What this migration protects is narrower: a **hall row** must stay ONE physical
-- court. `hall_slots`, the Hallenplan and the conflict checker all assume one row
-- = one court, so a combo can never be a `halls.vm_hall_id`. Point a hall row at
-- 4144 and every ordinary single-court game pushed through it books BOTH courts in
-- VM — silently, because the push reports success. That is the 209 lesson (KWI C
-- pinned to the 3-court 914) restated for a combo that now has a legitimate use.
--
-- The combo is therefore a property of a GAME's hall set, not of a hall:
--   hall = KWI A + additional_halls = [KWI B]   →   VM gym 4144
-- `allGameHallIds()` (src/utils/gameHalls.ts) already computes that set today and
-- already spans A+B for basketball. When the push learns to send combos, the
-- set→gym lookup goes THERE — not into this table.
--
-- Why a trigger and not another one-shot check. 209 asserted the 914 rule with a
-- DO block, but the runner applies each migration exactly once (filename + sha in
-- kscw_migrations), so it fired once on 2026-07-14 and can never fire again. It
-- does not cover the realistic path: a hall remapped by hand in the Directus admin
-- months later. The rule only earns its keep enforced on every write.
--
-- Scope: enforcement only. Moves no game, changes no mapping — all 14 hall rows
-- already satisfy it (verified 2026-07-16, when all 80 2026/27 VB home fixtures
-- matched VM hall-for-hall).

CREATE OR REPLACE FUNCTION public.trg_halls_reject_vm_combo()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE combo_label text;
BEGIN
  SELECT c.label INTO combo_label
    FROM (VALUES
      ('914',  '122655f3-806e-4415-8305-5f7f9d19dab0', 'VM gym 914 — Kantonsschule Wiedikon A-C (3 courts)'),
      ('4144', '5261363c-da18-40e4-ab87-9d6bbdb6240b', 'VM gym 4144 — Kantonsschule Wiedikon A+B (2 courts)')
    ) AS c(sv, vm, label)
   WHERE COALESCE(NEW.sv_hall_id, '') = c.sv
      OR COALESCE(NEW.vm_hall_id, '') = c.vm
   LIMIT 1;

  IF combo_label IS NOT NULL THEN
    RAISE EXCEPTION
      'Hall "%" may not map to a multi-court VM combo gym (%). A hall row is one physical court — every single-court game pushed through it would book the whole combo. Map it to a single-court gym instead (3231 = KWI A, 3232 = KWI B, 3989 = KWI C). A combo is a property of a game, not of a hall: to play across A+B, set the game''s hall to KWI A and add KWI B via games.additional_halls (see allGameHallIds).',
      NEW.name, combo_label;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_halls_reject_vm_combo ON halls;
CREATE TRIGGER trg_halls_reject_vm_combo
  BEFORE INSERT OR UPDATE ON halls FOR EACH ROW
  EXECUTE FUNCTION trg_halls_reject_vm_combo();

-- Validate the rows already in the table. The trigger only sees future writes, so
-- fail loudly here if today's data already violates it (it does not, but a fresh
-- install from SCHEMA.sql must not silently import a bad mapping).
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(name, ', ') INTO bad
    FROM public.halls
   WHERE sv_hall_id IN ('914', '4144')
      OR vm_hall_id IN ('122655f3-806e-4415-8305-5f7f9d19dab0',
                        '5261363c-da18-40e4-ab87-9d6bbdb6240b');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Hall(s) [%] point at a multi-court VM combo gym. Re-map to a single-court gym (3231 A / 3232 B / 3989 C) before this migration can apply.', bad;
  END IF;
END $$;
