-- 284-basketball-team-links-from-sheet.sql
--
-- Reconciles the basketball `team_links` rows with the club's own constraint
-- sheet ("Constrains BB Spielplanung Autumn 2026"), which is the current
-- statement of intent for the 2026/27 Vorrunde. User-confirmed 2026-08-05.
--
-- WHY link_type = 'adjacent' FOR ALL FIVE
-- ---------------------------------------
-- The sheet has two partner columns: "Cannot play the same time as this team
-- (hard)" and "adjacent games (soft)". Every populated row names the SAME
-- partner in both. Read together that is not "keep them apart" — it is
-- "play them back-to-back": the pair shares a coach, so the games must not
-- overlap AND should sit in neighbouring pitches on the same day. That is
-- exactly `adjacent`, which `highlightFor` in useBasketballPlan treats as both
-- a same-time CONFLICT and a neighbouring-slot SUGGESTION. Stored as `diff`
-- the games are only held apart and never pulled together, which loses half
-- the intent.
--
-- THE FIVE PAIRS, read off the sheet (each stated from BOTH sides):
--     Lions D1 (86)  <-> "DU18 Fire (2x)"  = team 72
--     Rhinos D3 (89) <-> "DU18 Spark (1x)" = team 73
--     Rhinos D3 (89) <-> DU14 (71)
--     H1 (75)        <-> HU18 (85)
--     H2 (76)        <-> HU14 (83)
-- (The sheet writes "Rhinos (D2)"; no KSCW D2 team exists in any season and
-- ProBasket registered "KSC Wiedikon Rhinos D3" in Damen 3. Liga — it is a
-- typo for the team the DB calls Rhinos D3, id 89. Likewise the sheet's "H2"
-- and "H4" name LEAGUES, not team ordinals: they are "Herren 2 H3" (76) and
-- "Herren 3 (Unicorns) H4" (77).)
--
-- ⚠ THE DU18 PAIRS WERE STORED THE WRONG WAY ROUND. Prod held
--     link 2: 72 (2x) <-> 89 Rhinos
--     link 3: 73 (1x) <-> 86 Lions
-- while the sheet says 73 (1x) goes with Rhinos and 72 (2x) with Lions. The
-- sheet wins (user decision 2026-08-05): it is this autumn's document and the
-- links predate it. This changes which teams the generator keeps apart, so it
-- is a deliberate, reviewed correction rather than a silent fix.
--
-- H1<->HU18 and H2<->HU14 were absent from team_links entirely, so those two
-- coach-sharing constraints were not being honoured at all.
--
-- Convention preserved: team_a < team_b (matches every existing row and the
-- team_links_unique (season, sport, team_a, team_b) index).
--
-- Idempotent: the UPDATEs match only the pre-correction state, so a re-run
-- finds nothing; the INSERTs are ON CONFLICT DO NOTHING. Verified by applying
-- twice on dev.

BEGIN;

-- 1. DU14 <-> Rhinos: correct pair, wrong type.
UPDATE team_links SET link_type = 'adjacent', date_updated = now()
WHERE sport = 'basketball' AND link_type = 'diff'
  AND team_a = 71 AND team_b = 89
  AND season = (SELECT id FROM game_scheduling_seasons WHERE season = '2026/27');

-- 2. Rhinos' DU18 partner is the 1x squad (73), not the 2x (72).
UPDATE team_links SET team_a = 73, link_type = 'adjacent', date_updated = now()
WHERE sport = 'basketball'
  AND team_a = 72 AND team_b = 89
  AND season = (SELECT id FROM game_scheduling_seasons WHERE season = '2026/27');

-- 3. Lions' DU18 partner is the 2x squad (72), not the 1x (73).
UPDATE team_links SET team_a = 72, date_updated = now()
WHERE sport = 'basketball'
  AND team_a = 73 AND team_b = 86
  AND season = (SELECT id FROM game_scheduling_seasons WHERE season = '2026/27');

-- 4. The two pairs the sheet names but team_links never had.
INSERT INTO team_links (season, sport, team_a, team_b, link_type)
SELECT s.id, 'basketball', v.a, v.b, 'adjacent'
FROM (VALUES (75, 85), (76, 83)) AS v(a, b)
CROSS JOIN (SELECT id FROM game_scheduling_seasons WHERE season = '2026/27') s
WHERE EXISTS (SELECT 1 FROM teams t WHERE t.id = v.a AND t.sport = 'basketball' AND t.active)
  AND EXISTS (SELECT 1 FROM teams t WHERE t.id = v.b AND t.sport = 'basketball' AND t.active)
ON CONFLICT (season, sport, team_a, team_b) DO NOTHING;

-- Assert the exact end state rather than trusting the row counts above: a
-- changed team id or an archived row would otherwise leave this half-applied
-- and silent.
DO $$
DECLARE want text; got text;
BEGIN
  want := '71-89:adjacent,72-86:adjacent,73-89:adjacent,75-85:adjacent,76-83:adjacent';
  SELECT string_agg(team_a || '-' || team_b || ':' || link_type, ',' ORDER BY team_a, team_b)
    INTO got
  FROM team_links l
  JOIN game_scheduling_seasons s ON s.id = l.season
  WHERE l.sport = 'basketball' AND s.season = '2026/27';
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'migration 284: basketball team_links mismatch.  want [%]  got [%]', want, got;
  END IF;
  RAISE NOTICE 'migration 284: basketball team_links reconciled with the constraint sheet (5 adjacent pairs)';
END $$;

COMMIT;
