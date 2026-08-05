-- 285-bb-spielsamstage-cap.sql
--
-- Club-wide weekend cap for basketball, plus two date corrections.
-- User rule 2026-08-05: "maximum number of weekends: 10. In crisis: 11."
--
-- WHAT THIS CHANGES
-- -----------------
-- KWI only opens for basketball on the Spielsamstage the section agreed, so a date
-- outside that set is not a candidate for ANY team. Until now the list only fed the
-- SOFT score, so the five senior teams sprawled across 22–26 weekends (their leagues
-- run to April/May) while the six junior teams happened to sit at exactly 10 purely
-- because their window is that short. `spielsamstage_hard` makes it a hard filter
-- (see REJECT_CODES.NOT_A_SPIELSAMSTAG in basketball-slots.js).
--
-- ⚠ The flag is OPT-IN by season. A season that has not fixed its Spielsamstage yet
-- must keep the old open behaviour — turning the filter on with an empty list would
-- generate zero slots and look like a broken generator.
--
-- ⚠ Dates are stored as the SATURDAY only. basketball plays Fri/Sat/Sun, so
-- `weekendKey()` maps a Friday (+1) and a Sunday (−1) onto their Saturday before
-- the lookup. Do not add Sunday rows — they would be a second weekend.
--
-- TWO DATE CORRECTIONS, confirmed with the user 2026-08-05
-- -------------------------------------------------------
-- The source sheet ("Constrains BB Spielplanung Autumn 2026") lists two "weekends"
-- that are not weekends at all:
--   · "13/14.4"  → 13.04.2027 is a TUESDAY.  Meant: 13/14.03.2027 (Sat/Sun) —
--     the same day numbers one month earlier. This is the 10th and last of the
--     agreed ten; without it the club would have had nine.
--   · "10/11.5"  → 10.05.2027 is a MONDAY.   Meant: 10/11.04.2027 (Sat/Sun).
--     This is the "Bei Bedarf" crisis weekend, not one of the ten.
-- Neither was in the config before, so both are inserts, not edits.
--
-- Resulting set — 10 hard + 2 crisis candidates for the 11th:
--   given   (5): 26.09* 07.11  14.11  12.12  30.01  13.02     (*26.09 is 'desired')
--   desired (5): 26.09.26  28.11.26  23.01.27  13.03.27  03.04.27
--   crisis  (2): 05.12.26 'fraglich'  ·  10.04.27 'bei_bedarf'
-- ⚠ Only ONE crisis weekend may be taken (cap 11, not 12). The generator does not
-- enforce that — it offers both and the section picks; `max_weekends` records the
-- intent so the UI and any future check can compare.
--
-- ⚠ KNOWN INTERACTION, deliberately left alone: the 'given' weekend 12.12.2026
-- covers Sat 12.12 + Sun 13.12, but 13.12 is a club-wide blackout in
-- `scheduling_global_blocks`, so that weekend yields Saturday only. 13.12 is also
-- the day junior results must be on the ProBasket web — worth a human decision,
-- not a silent override here.
--
-- Data-only, idempotent: rebuilt from a literal, so re-running converges.

BEGIN;

UPDATE game_scheduling_seasons
SET bb_slot_config = coalesce(bb_slot_config, '{}'::jsonb)
  || jsonb_build_object(
       'spielsamstage_hard', true,
       'max_weekends', 10,
       'max_weekends_crisis', 11,
       'spielsamstage', '[
         {"date": "2026-09-26", "status": "desired"},
         {"date": "2026-11-07", "status": "given",  "note": "Volleyball has booked KWI that weekend"},
         {"date": "2026-11-14", "status": "given",  "note": "Volleyball has booked KWI that weekend"},
         {"date": "2026-11-28", "status": "desired"},
         {"date": "2026-12-05", "status": "fraglich"},
         {"date": "2026-12-12", "status": "given",  "note": "Volleyball has booked KWI that weekend. Sunday 13.12 is a club-wide blackout, so Saturday only."},
         {"date": "2027-01-23", "status": "desired"},
         {"date": "2027-01-30", "status": "given",  "note": "Volleyball has booked KWI that weekend"},
         {"date": "2027-02-13", "status": "given",  "note": "Volleyball has booked KWI that weekend"},
         {"date": "2027-03-13", "status": "desired", "note": "Sheet said 13/14.4, which is a Tuesday; corrected to 13/14.03.2027 (user, 05.08.2026)."},
         {"date": "2027-04-03", "status": "desired"},
         {"date": "2027-04-10", "status": "bei_bedarf", "note": "Sheet said 10/11.5, which is a Monday; corrected to 10/11.04.2027 (user, 05.08.2026)."}
       ]'::jsonb)
WHERE season = '2026/27';

-- Assert the shape rather than trusting the update: a season rename or a bad merge
-- would otherwise leave the cap silently off, which reads as "the generator ignored
-- my rule".
DO $$
DECLARE n integer; hard boolean; given_n integer; desired_n integer;
BEGIN
  SELECT jsonb_array_length(bb_slot_config->'spielsamstage'),
         (bb_slot_config->>'spielsamstage_hard')::boolean
    INTO n, hard
  FROM game_scheduling_seasons WHERE season = '2026/27';
  IF n IS DISTINCT FROM 12 OR hard IS NOT TRUE THEN
    RAISE EXCEPTION 'migration 285: expected 12 Spielsamstage with the hard cap on, got n=% hard=%', n, hard;
  END IF;
  SELECT count(*) FILTER (WHERE e->>'status' = 'given'),
         count(*) FILTER (WHERE e->>'status' = 'desired')
    INTO given_n, desired_n
  FROM game_scheduling_seasons s,
       jsonb_array_elements(s.bb_slot_config->'spielsamstage') e
  WHERE s.season = '2026/27';
  IF given_n <> 5 OR desired_n <> 5 THEN
    RAISE EXCEPTION 'migration 285: expected 5 given + 5 desired (the ten), got given=% desired=%', given_n, desired_n;
  END IF;
  RAISE NOTICE 'migration 285: 10 Spielsamstage (5 given + 5 desired) + 2 crisis candidates, hard cap ON';
END $$;

COMMIT;
