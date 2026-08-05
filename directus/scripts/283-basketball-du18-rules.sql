-- 283-basketball-du18-rules.sql
--
-- Seeds the two basketball_team_rules rows migration 278 deliberately left out:
-- "DU18 Spark (1x)" and "DU18 Fire (2x)" from the club's constraint sheet
-- ("Constrains BB Spielplanung Autumn 2026").
--
-- WHY 278 SKIPPED THEM, AND WHY THAT WAS OVER-CAUTIOUS
-- ----------------------------------------------------
-- 278 refused to guess because the nicknames "Spark" and "Fire" appear in
-- NEITHER the DB nor the ProBasket register — three naming systems with no
-- overlap (DB `1xDU18`/`2xDU18`, ProBasket `DU18 A`/`DU18 B`, sheet
-- Spark/Fire). But the nicknames are decoration: the sheet's own
-- parentheticals are the key, and they map exactly onto the team names.
--     "DU18 Spark (1x)" -> teams.id 73, name '1xDU18', bb_source_id 5697
--     "DU18 Fire  (2x)" -> teams.id 72, name '2xDU18', bb_source_id 7182
-- Both verified on prod 2026-08-05 (season 2026/27, active).
--
-- ⚠ Team 72 is a MISNOMER, kept deliberately. Its `full_name` is
-- 'KSC Wiedikon DU16' and its `league` is 'DU16B', and Basketplan fixtures for
-- bb_source_id 7182 show it playing "KSC Wiedikon DU16" against
-- "BC Brunnen DU16" / "BC Zürich 93 DU16". The local name '2xDU18' is wrong;
-- the user confirmed 7182 IS the DU16 squad. The constraint sheet still calls
-- it "DU18 Fire", so the sheet's row applies to team 72 whatever it is named.
-- Hence category 'youth' for 72 (not 'u18'): it is the younger squad.
-- In practice the distinction is inert for these two rows — 'u18' is only
-- called out for the Friday 20:00 pitch, and both teams are weekend-only.
--
-- ⚠ PARTNER RELATIONSHIPS ARE **NOT** IN THIS TABLE. The sheet's "cannot play
-- the same time as" (hard) and "adjacent games" (soft) columns live in
-- `team_links`, which the generator reads separately. Prod currently pairs
-- these two teams the OPPOSITE way from the sheet (link 2: 72<->Rhinos,
-- link 3: 73<->Lions, where the sheet says 73<->Rhinos and 72<->Lions).
-- That disagreement is NOT resolved here — it needs a human decision, because
-- flipping live links changes which teams the generator keeps apart.
--
-- Values taken verbatim from the sheet; both rows read identically except for
-- the partner column, which this migration does not touch:
--     slots wanted        "weekends"                 -> allowed_dows [6,0] (Sat,Sun)
--     back-to-back        "yes"                      -> own_back_to_back = true
--     blocked dates       "holidays and weekend before"
--                                                    -> school_holidays ZH,
--                                                       include_weekend_before
--     gym requirements    "A+B (soft) otherwise A or B"
--                                                    -> tiers, hard = false
-- Shape mirrors the HU18 row seeded by 278 (same "weekends / b2b yes / A+B
-- soft" profile) so the nine existing rows and these two stay consistent.
--
-- Idempotent: ON CONFLICT on the (season, team) unique. Safe to re-run.

BEGIN;

INSERT INTO basketball_team_rules (
  season, team, enabled, category, league, ferien_hard,
  allowed_dows, preferred_dows, start_min, start_max, start_hard,
  halls, own_back_to_back, blocked, note
)
SELECT
  s.id,
  v.team,
  true,
  v.category,
  'JUN_REG',            -- both sit in a junior REGIONAL group (Rookie), not interregional
  false,                -- 'ferien' is soft for regional juniors; hard only for
                        -- interregional + 1./2. Seniorenliga (Sperrdaten PDF)
  '[6, 0]'::jsonb,      -- "weekends" — Sat, Sun. No Friday.
  '[]'::jsonb,
  NULL,                 -- "weekends" carries no time-of-day constraint
  NULL,
  true,
  '{"hard": false, "tiers": [{"rank": 1, "options": ["KWI A+B"]}, {"rank": 2, "options": ["KWI A", "KWI B"]}]}'::jsonb,
  true,                 -- "Back-to-back allowed? yes"
  '[{"kind": "school_holidays", "canton": "ZH", "include_weekend_before": true}]'::jsonb,
  v.note
FROM (VALUES
  (73, 'u18'::varchar,   'DU18 Spark (1x) — constraint sheet 2026/27. Sheet partner: Rhinos (hard same-time + adjacent) — see team_links.'),
  (72, 'youth'::varchar, 'DU18 Fire (2x) — constraint sheet 2026/27. ⚠ bb_source_id 7182 is really the DU16 squad; ''2xDU18'' is a local misnomer. Sheet partner: Lions D1 (hard same-time + adjacent) — see team_links.')
) AS v(team, category, note)
CROSS JOIN (SELECT id FROM game_scheduling_seasons WHERE season = '2026/27') s
WHERE EXISTS (SELECT 1 FROM teams t WHERE t.id = v.team AND t.sport = 'basketball' AND t.active)
ON CONFLICT (season, team) DO NOTHING;

-- Fail loudly rather than silently seeding nothing. The 9 rows from 278 plus
-- these 2 must give 11 — one per team in the constraint sheet. A join miss
-- (renamed team, archived row, absent season) would otherwise insert 0 and
-- look like success.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n
  FROM basketball_team_rules r
  JOIN game_scheduling_seasons s ON s.id = r.season
  WHERE s.season = '2026/27';
  IF n <> 11 THEN
    RAISE EXCEPTION 'migration 283: expected 11 basketball_team_rules rows for 2026/27, found %. Teams 72 (2xDU18) and 73 (1xDU18) must both exist, be sport=basketball and active.', n;
  END IF;
  RAISE NOTICE 'migration 283: basketball_team_rules now complete for 2026/27 (% rows)', n;
END $$;

COMMIT;
