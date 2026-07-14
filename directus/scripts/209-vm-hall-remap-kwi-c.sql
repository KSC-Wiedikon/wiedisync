-- 209 — Re-point KWI C at the real single-court VM gym (3989), not the 3-court combo (914).
--
-- Background. Until the 2026-07-14 VolleyManager gym cleanup, the national hall
-- registry had ONE Wiedikon entry: gym 914, a 3-court venue. Migration 104
-- captured its uuid live (2026-06-10) and pinned it to our `KWI C` row, because
-- 914 was the only thing to point at. That ambiguity is exactly what forced the
-- `FREEZE_HALLS` guard in sv-sync.js (2026-07-09): the feed kept reporting "KWI C"
-- for games we had hand-placed in KWI A (D4's Thursday slot), and the sync
-- overwrote them.
--
-- The cleanup split the venue into individually-homologated courts:
--   914  Kantonsschule Wiedikon A-C  122655f3-806e-4415-8305-5f7f9d19dab0  (3 courts, legacy combo)
--   3231 Kantonsschule Wiedikon A    9427f854-6ec8-4bf3-8c60-360cfcf2d4b1
--   3232 Kantonsschule Wiedikon B    600f0efa-82ac-46cf-8c33-7eae7b05ca82
--   3989 Kantonsschule Wiedikon C    a3265f9d-f7ad-49d3-ab27-07da709ad7fc  ← NEW
--   153  Schulhaus Döltschi          5a80a35c-a054-4e1f-9c43-88c765d1707f
-- (read live from /api/sportmanager.indoorvolleyball/api\hall, 2026-07-14)
--
-- A/B/Döltschi were already correct. KWI C still pointed at 914, so every game we
-- called "KWI C" was, in VolleyManager's eyes, booked across ALL THREE courts —
-- and `vm-push-game.mjs` would have pushed 22 of the 80 2026/27 home fixtures into
-- the combo hall. Nothing has been pushed yet (svrz_push_status is null on all 80),
-- so this lands before any damage.
--
-- Scope: mapping columns only. It does NOT move any game — the 29 fixtures that
-- VolleyManager currently holds in 914 (22 belong in C, 7 D4 games belong in A)
-- still need a deliberate push.

-- KWI C → gym 3989. Guarded on the old value so a re-run (or a hall already
-- corrected by hand in the Directus admin) is a no-op rather than a clobber.
UPDATE public.halls
   SET sv_hall_id = '3989',
       vm_hall_id = 'a3265f9d-f7ad-49d3-ab27-07da709ad7fc'
 WHERE name ILIKE 'KWI C'
   AND COALESCE(sv_hall_id, '') = '914';

-- Guard the invariant the 2026-06-10 backfill could not express: no KSCW hall may
-- point at the 3-court combo. If a future hall row picks up 914 / the combo uuid,
-- fail loudly here rather than silently over-booking two extra courts in VM.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(name, ', ') INTO bad
    FROM public.halls
   WHERE sv_hall_id = '914'
      OR vm_hall_id = '122655f3-806e-4415-8305-5f7f9d19dab0';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Hall(s) [%] still point at the 3-court combo (VM gym 914 / Kantonsschule Wiedikon A-C). A game pushed there books courts A+B+C. Map them to the single-court gym (3231 A / 3232 B / 3989 C) instead.', bad;
  END IF;
END $$;
