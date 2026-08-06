-- 287-basketball-groups.sql
--
-- ProBasket group membership in Postgres, so the endpoints can compute pairings.
--
-- WHY
-- ---
-- The basketball club portal only shows a club the games a planner has already PLACED and
-- OFFERED (`basketball_slot_plan` + migration 280's offer lifecycle). The wanted shape is
-- volleyball's: the opponent sees what is FREE and picks (`/terminplanung/slots/:token` →
-- `propose-home`).
--
-- The blocker: the endpoint cannot tell which KSCW teams a club is paired with. Volleyball
-- knows its fixtures from the Volleymanager feed; basketball has NO fixture list — ProBasket
-- builds the schedule at the Spielplansitzung (05.09.2026) — so the pairing must come from
-- shared group membership, and that data lived only in a FRONTEND TypeScript file
-- (`src/modules/gameScheduling/data/basketballGroups.ts`), unreadable from an endpoint.
--
-- ⚠ The repo files stay the source of truth for REGENERATION. This table is their projection
-- for server-side use. Re-seed with `node directus/scripts/gen-287-seed.mjs` after any
-- re-extract and fix forward with a new migration — do not hand-edit the seed below.
--
-- WHAT IT ENABLES
-- ---------------
--   club portal token → portal.bp_club
--     → groups containing that club → the KSCW teams in those groups
--     → serve those teams' `basketball_slots` (status='available') for the club to pick.
--
-- `games_total` is the ProBasket workbook's **Anzahl Spiele** (games per team, home + away).
-- ⚠⚠ Home games = games_total / 2 and NOTHING else. It does NOT follow from the number of
-- teams: D1LRA lists 8 teams but 18 Spiele (a double round would be 14), D2LRA 10 but 16,
-- DU14 Regional 11 but 6. Deriving it from group size put Lions D1 at 7 when the answer is 9
-- — on one of the two teams that file with ProBasket by 17.08.2026. See
-- src/modules/gameScheduling/utils/bbHomeGames.ts and the header of bbGroupFormat.json.
--
-- ⚠ `games_total` is INDEPENDENT of whether the final group is fixed. DU14 Regional still
-- lists the whole 11-team league (the split happens at the Spielplansitzung) yet its game
-- count is already stated. `format` explains only WHY a count is absent when it is:
--   championship = a stated Anzahl Spiele (games_total is set)
--   provisional  = no count stated yet (H4LRA, HU14/HU16 Regional)
--   tournament   = Turniere / Miniturniere, not played home-and-away at all
--
-- ⚠ Only groups containing a KSCW team are seeded (16 of the workbook's 33). This table
-- exists to drive our pairings and availability, not to mirror the whole region.
--
-- ⚠ `bp_club` is linked by EXACT club-name match against `basketplan_clubs` only. A fuzzy
-- match would mis-address an opponent's scheduling link, which is worse than a NULL: a NULL
-- club simply yields no pairing and is visible in the report at the end, a wrong one silently
-- invites the wrong opponent.
--
-- ⚠ KSCW rows are linked by `bb_source_id`, exactly as KSCW_TEAM_GROUP does — never by team
-- name. Prod team 72 is named "2xDU18" but really plays DU16 (bb_source_id 7182 sits in
-- DU14/U16 Rookie); a name join would file it under a DU18 group and mis-scope its slots.
--
-- Schema + data seed. Idempotent: re-running converges (ON CONFLICT upserts; the FK links are
-- guarded by IS DISTINCT FROM).

BEGIN;

-- ── 1. Tables ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS basketball_groups (
  id            serial PRIMARY KEY,
  season        integer NOT NULL REFERENCES game_scheduling_seasons(id) ON DELETE CASCADE,
  code          text    NOT NULL,
  label         text    NOT NULL,
  sex           varchar(6)  NOT NULL CHECK (sex IN ('m', 'f', 'mixed')),
  -- Default is the SAFE value: a group nobody has classified must never be mistaken for a
  -- settled one, because only 'championship' is allowed to yield a home-game count.
  format        varchar(16) NOT NULL DEFAULT 'provisional'
                  CHECK (format IN ('championship', 'provisional', 'tournament')),
  -- The workbook's Anzahl Spiele. NULL = ProBasket has not stated one; never invent it.
  games_total   integer CHECK (games_total IS NULL OR games_total BETWEEN 1 AND 60),
  modus         text,
  note          text,
  date_created  timestamptz DEFAULT now(),
  date_updated  timestamptz,
  CONSTRAINT basketball_groups_season_code_uniq UNIQUE (season, code),
  -- A championship group without a game count cannot answer the question it exists to answer.
  CONSTRAINT basketball_groups_championship_has_games
    CHECK (format <> 'championship' OR games_total IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS basketball_group_teams (
  id         serial PRIMARY KEY,
  group_id   integer NOT NULL REFERENCES basketball_groups(id) ON DELETE CASCADE,
  team_name  text    NOT NULL,
  club_name  text,
  -- The opponent club this row belongs to. SET NULL rather than CASCADE: losing a club
  -- registry row must not delete the group's composition.
  bp_club    integer REFERENCES basketplan_clubs(id) ON DELETE SET NULL,
  -- Non-null exactly on OUR rows.
  kscw_team  integer REFERENCES teams(id) ON DELETE SET NULL,
  CONSTRAINT basketball_group_teams_uniq UNIQUE (group_id, team_name)
);

CREATE INDEX IF NOT EXISTS basketball_group_teams_bp_club_idx   ON basketball_group_teams (bp_club)   WHERE bp_club IS NOT NULL;
CREATE INDEX IF NOT EXISTS basketball_group_teams_kscw_team_idx ON basketball_group_teams (kscw_team) WHERE kscw_team IS NOT NULL;
CREATE INDEX IF NOT EXISTS basketball_group_teams_group_idx     ON basketball_group_teams (group_id);

COMMENT ON TABLE basketball_groups IS
  'ProBasket groups we play in, projected from src/modules/gameScheduling/data/{basketballGroups.ts,bbGroupFormat.json} so endpoints can read them. games_total = the workbook Anzahl Spiele; home games = games_total/2, NEVER (team count - 1). Re-seed via directus/scripts/gen-287-seed.mjs.';
COMMENT ON TABLE basketball_group_teams IS
  'One registered team per ProBasket group. kscw_team is non-null on our own rows (linked by bb_source_id, never by name). bp_club links an opponent to the Basketplan club registry by EXACT name; NULL means unmatched, never guessed.';
COMMENT ON COLUMN basketball_groups.games_total IS
  'Anzahl Spiele per team (home + away) from the ProBasket workbook. NULL = not stated. Home games = games_total/2; an odd value cannot split evenly.';

-- ── 2. Seed ──────────────────────────────────────────────────────────────────
-- 16 groups · 334 team rows · 15 KSCW links.
-- Generated by directus/scripts/gen-287-seed.mjs — do not hand-edit; re-run it.

INSERT INTO basketball_groups (season, code, label, sex, format, games_total, modus, note)
SELECT s.id, v.code, v.label, v.sex, v.format, v.games_total, v.modus, v.note
FROM game_scheduling_seasons s, (VALUES
  ('D1LRA', 'Damen 1. Liga', 'f', 'championship', 18::int, 'Hin- und Rückrunde', NULL),
  ('D3LRA', 'Damen 3. Liga', 'f', 'championship', 14::int, 'Hin- und Rückrunde', NULL),
  ('DU12 TU', 'DU12TU', 'f', 'tournament', NULL::int, 'Girs got Games Turniere und Miniturniere', NULL),
  ('DU14 Regional', 'DU14 Regional', 'f', 'championship', 6::int, 'Hin- und Rückrunde', 'Group composition still the whole league; the game count is already fixed.'),
  ('DU14/U16 Rookie', 'DU16 Rookie', 'f', 'championship', 8::int, 'Hin- und Rückrunde', NULL),
  ('DU18/U20 Rookie', 'DU20 Rookie', 'f', 'championship', 8::int, 'Hin- und Rückrunde', 'Holds both DU18 A and DU18 B.'),
  ('H1LRA', 'Herren 1. Liga', 'm', 'championship', 18::int, 'Hin- und Rückrunde', NULL),
  ('H2LRA', 'Herren 2. Liga', 'm', 'championship', 20::int, 'Hin- und Rückrunde', NULL),
  ('H4LRA', 'Herren 4. Liga', 'm', 'provisional', NULL::int, NULL, 'Workbook states no Modus and no Anzahl Spiele for this group.'),
  ('HU14 Regional', 'HU14 Regional', 'm', 'provisional', NULL::int, NULL, 'Workbook states no Modus and no Anzahl Spiele for this group.'),
  ('HU16 Regional', 'HU16 Regional', 'm', 'provisional', NULL::int, NULL, 'Workbook states no Modus and no Anzahl Spiele for this group.'),
  ('HU18 Regional', 'HU18 Regional', 'm', 'championship', 8::int, 'Hin- und Rückrunde', NULL),
  ('MixU12', 'MixU12M', 'mixed', 'tournament', NULL::int, 'Miniturniere', NULL),
  ('MixU10', 'MixU10M', 'mixed', 'tournament', NULL::int, 'Miniturniere', NULL),
  ('DU10', 'DU10', 'f', 'tournament', NULL::int, 'Girs got Games - Turniere und Miniturniere', NULL),
  ('MixU8', 'MixU8M', 'mixed', 'tournament', NULL::int, NULL, 'Not a group in the 29.07 workbook — see the MU8/DU10 discrepancy above.')
) AS v(code, label, sex, format, games_total, modus, note)
WHERE s.season = '2026/27'
ON CONFLICT (season, code) DO UPDATE SET
  label = EXCLUDED.label, sex = EXCLUDED.sex, format = EXCLUDED.format,
  games_total = EXCLUDED.games_total, modus = EXCLUDED.modus, note = EXCLUDED.note,
  date_updated = now();

INSERT INTO basketball_group_teams (group_id, team_name, club_name)
SELECT g.id, v.team_name, v.club_name
FROM basketball_groups g
JOIN game_scheduling_seasons s ON s.id = g.season AND s.season = '2026/27'
JOIN (VALUES
  ('D1LRA', 'BC Arlesheim D1', 'BC Arlesheim'),
  ('D1LRA', 'BC Olympiakos D1', 'BC Olympiakos'),
  ('D1LRA', 'RJ Lakers D1', 'BC RJ Lakers'),
  ('D1LRA', 'Frauenfeld Damen 1', 'CVJM Frauenfeld'),
  ('D1LRA', 'Emmen Basket D1', 'Emmen Basket'),
  ('D1LRA', 'KSC Wiedikon Lions D1', 'KSC Wiedikon'),
  ('D1LRA', 'Opfikon Basket Blizzards D1', 'Opfikon Basket'),
  ('D1LRA', 'Zug Basket D1', 'Zug Basket'),
  ('D3LRA', 'Marmotas Damen D3', 'BC Marmotas'),
  ('D3LRA', 'BC Winterthur 2 D3', 'BC Winterthur'),
  ('D3LRA', 'Mörschwil Griffins D3', 'Griffins Basketball'),
  ('D3LRA', 'KSC Wiedikon Rhinos D3', 'KSC Wiedikon'),
  ('D3LRA', 'Mutschellen Damen D3', 'Mutschellen Basketball'),
  ('D3LRA', 'St. Otmar St. Gallen Basketball Damen D3', 'St. Otmar St. Gallen Basketball'),
  ('D3LRA', 'Stingerz Zürich Damen D3', 'Stingerz'),
  ('D3LRA', 'Goldcoast Wallabies D3', 'Wallabies'),
  ('DU12 TU', 'Baar Bumble Bees DU12 Team Gold', 'Baar Bumble Bees'),
  ('DU12 TU', 'Baden Basket 54 DU12', 'Baden Basket 54'),
  ('DU12 TU', 'BC Alte Kanti Aarau Lightning DU12T', 'BC AKA'),
  ('DU12 TU', 'BS Kriens Queens Du12', 'BS Kriens'),
  ('DU12 TU', 'BZO Greifensee Mariposas DU12', 'BZO'),
  ('DU12 TU', 'Frauenfeld DU12 (Turnier)', 'CVJM Frauenfeld'),
  ('DU12 TU', 'KSC Wiedikon DU12', 'KSC Wiedikon'),
  ('DU12 TU', 'Mutschellen DU12', 'Mutschellen Basketball'),
  ('DU12 TU', 'Regensdorf Penguins DU12', 'Phönix Basket'),
  ('DU12 TU', 'Rüti Centellas DU12', 'Rüti Basket'),
  ('DU12 TU', 'Goldcoast Wallabies DU12', 'Wallabies'),
  ('DU14 Regional', 'Baar Bumble Bees DU14', 'Baar Bumble Bees'),
  ('DU14 Regional', 'Baden Basket 54 DU14', 'Baden Basket 54'),
  ('DU14 Regional', 'BC Brunnen DU14', 'BC Brunnen'),
  ('DU14 Regional', 'BCBE DU14', 'BC Buchrain-Ebikon'),
  ('DU14 Regional', 'BC Olten-Zofingen DU14 A', 'BC Olten-Zofingen'),
  ('DU14 Regional', 'BC Silvercoast DU14', 'BC Silvercoast'),
  ('DU14 Regional', 'BS Kriens Queens Du14', 'BS Kriens'),
  ('DU14 Regional', 'BZO BC Effretikon Orcas DU14', 'BZO'),
  ('DU14 Regional', 'KSC Wiedikon DU14', 'KSC Wiedikon'),
  ('DU14 Regional', 'Mutschellen DU14', 'Mutschellen Basketball'),
  ('DU14 Regional', 'Goldcoast Wallabies DU14R', 'Wallabies'),
  ('DU14/U16 Rookie', 'BBZU Fever DU16', 'BBZU'),
  ('DU14/U16 Rookie', 'BC Brunnen DU16', 'BC Brunnen'),
  ('DU14/U16 Rookie', 'BC Seuzach-Stammheim DU16', 'BC Seuzach-Stammheim'),
  ('DU14/U16 Rookie', 'BC Zürich 93 DU16', 'BC Zürich 93'),
  ('DU14/U16 Rookie', 'BS Kriens Queens Du16', 'BS Kriens'),
  ('DU14/U16 Rookie', 'Frauenfeld DU16 Red Foxes', 'CVJM Frauenfeld'),
  ('DU14/U16 Rookie', 'Opfikon Basket Ants DU16', 'Opfikon Basket'),
  ('DU14/U16 Rookie', 'Emmen Basket DU16', 'Emmen Basket'),
  ('DU14/U16 Rookie', 'KSC Wiedikon DU16', 'KSC Wiedikon'),
  ('DU14/U16 Rookie', 'KTV Schaffhausen DU16', 'KTV Schaffhausen'),
  ('DU14/U16 Rookie', 'Mutschellen DU16', 'Mutschellen Basketball'),
  ('DU14/U16 Rookie', 'Oberthurgau Pirates DU16', 'Oberthurgau Pirates'),
  ('DU14/U16 Rookie', 'St. Otmar St. Gallen Basketball DU16A', 'St. Otmar St. Gallen Basketball'),
  ('DU14/U16 Rookie', 'STV Luzern Basket DU16', 'STV Luzern Basket'),
  ('DU14/U16 Rookie', 'Zug Basket DU14/DU16', 'Zug Basket'),
  ('DU18/U20 Rookie', 'BIQ DU18 (Ausser Konk.)', 'BIQ'),
  ('DU18/U20 Rookie', 'BS Kriens Queens Du18', 'BS Kriens'),
  ('DU18/U20 Rookie', 'Emmen Basket DU18', 'Emmen Basket'),
  ('DU18/U20 Rookie', 'GC Zurich DU18', 'GC Zürich Basketball'),
  ('DU18/U20 Rookie', 'KSC Wiedikon DU18 A', 'KSC Wiedikon'),
  ('DU18/U20 Rookie', 'KSC Wiedikon DU18 B', 'KSC Wiedikon'),
  ('DU18/U20 Rookie', 'Mutschellen DU18', 'Mutschellen Basketball'),
  ('DU18/U20 Rookie', 'Seeblick Bears DU18', 'Seeblick Bears Cham'),
  ('DU18/U20 Rookie', 'STV Luzern Basket DU18', 'STV Luzern Basket'),
  ('DU18/U20 Rookie', 'BC Zürich 93 DU18/DU20', 'BC Zürich 93'),
  ('DU18/U20 Rookie', 'St. Otmar St. Gallen Basketball DU20B', 'St. Otmar St. Gallen Basketball'),
  ('DU18/U20 Rookie', 'St. Otmar St. Gallen Basketball DU20A', 'St. Otmar St. Gallen Basketball'),
  ('H1LRA', 'BC Bears Wil H1', 'BC Bears Wil'),
  ('H1LRA', 'BC Oerlikon Grizzlies H1', 'BC Oerlikon Grizzlies'),
  ('H1LRA', 'BC Winterthur 2 H1', 'BC Winterthur'),
  ('H1LRA', 'Mörschwil Griffins H1', 'Griffins Basketball'),
  ('H1LRA', 'Ikaros Zürich H1', 'Ikaros Zürich BC'),
  ('H1LRA', 'KSC Wiedikon Herren 1 H1', 'KSC Wiedikon'),
  ('H1LRA', 'Opfikon Basket H1', 'Opfikon Basket'),
  ('H1LRA', 'Stingers Zürich H1', 'Stingerz'),
  ('H1LRA', 'STV Luzern Basket Herren 1', 'STV Luzern Basket'),
  ('H1LRA', 'Zug Basket H1', 'Zug Basket'),
  ('H2LRA', 'Aarau Basket H1', 'Aarau Basket'),
  ('H2LRA', 'BBC Schaan H2', 'BBC Schaan'),
  ('H2LRA', 'BZO Highlanders H2', 'BZO'),
  ('H2LRA', 'Frauenfeld Herren 1', 'CVJM Frauenfeld'),
  ('H2LRA', 'GRBB Chur Herren 1 H2', 'GRBB'),
  ('H2LRA', 'KSC Wiedikon Herren 2 H2', 'KSC Wiedikon'),
  ('H2LRA', 'Opfikon Basket Wolves H2', 'Opfikon Basket'),
  ('H2LRA', 'Opfikon Basket Rams H2', 'Opfikon Basket'),
  ('H2LRA', 'Unicorn 02 Basket H2', 'Unicorn 02 Basket'),
  ('H2LRA', 'Wohlen Basket H2', 'Wohlen Basket'),
  ('H2LRA', 'Zug Basket H2', 'Zug Basket'),
  ('H4LRA', 'Aarau Basket H4', 'Aarau Basket'),
  ('H4LRA', 'BBC Inwil Hoopers H4 Team Rhei', 'BBC Inwil Hoopers'),
  ('H4LRA', 'BBC Inwil Hoopers H4 Team Panta', 'BBC Inwil Hoopers'),
  ('H4LRA', 'BBC Lions Heat H4', 'BBC Lions Heat'),
  ('H4LRA', 'BBZU Rockets H4', 'BBZU'),
  ('H4LRA', 'BC Bears Wil H4', 'BC Bears Wil'),
  ('H4LRA', 'BC Oerlikon Grizzlies H4', 'BC Oerlikon Grizzlies'),
  ('H4LRA', 'RJ Lakers 1 H4', 'BC RJ Lakers'),
  ('H4LRA', 'BC Seetal H4', 'BC Seetal'),
  ('H4LRA', 'BC Seuzach-Stammheim H4', 'BC Seuzach-Stammheim'),
  ('H4LRA', 'BC Silvercoast H4', 'BC Silvercoast'),
  ('H4LRA', 'BC Altstetten H4 II', 'BCA'),
  ('H4LRA', 'BC Altstetten H4', 'BCA'),
  ('H4LRA', 'BCL Rivers H4', 'BCL Rivers'),
  ('H4LRA', 'BS Arth-Goldau H4', NULL),
  ('H4LRA', 'BZO Buzzers H4', 'BZO'),
  ('H4LRA', 'Frauenfeld Herren 2 H4', 'CVJM Frauenfeld'),
  ('H4LRA', 'KSC Wiedikon Herren 3 (Unicorns) H4', 'KSC Wiedikon'),
  ('H4LRA', 'KTV Schaffhausen H2', 'KTV Schaffhausen'),
  ('H4LRA', 'Megas Alexandros H4', 'Megas Alexandros'),
  ('H4LRA', 'Mutschellen Herren 2 H4', 'Mutschellen Basketball'),
  ('H4LRA', 'Oberthurgau Pirates H4', 'Oberthurgau Pirates'),
  ('H4LRA', 'Rüti Basket Herren H4', 'Rüti Basket'),
  ('H4LRA', 'St. Otmar St. Gallen Basketball H4', 'St. Otmar St. Gallen Basketball'),
  ('H4LRA', 'Stingerz FIVE4 H4', 'Stingerz'),
  ('H4LRA', 'STV Basket Kreuzlingen H4', 'STV Basket Kreuzlingen'),
  ('H4LRA', 'STV Luzern Basket Herren 2 H4', 'STV Luzern Basket'),
  ('H4LRA', 'Sursee Basket H4', 'Sursee Basket'),
  ('H4LRA', 'TV Reussbühl Rebels H4', 'TVRB'),
  ('H4LRA', 'Wohlen Basket 2 H4', 'Wohlen Basket'),
  ('HU14 Regional', 'Baden Basket 54 HU14R', 'Baden Basket 54'),
  ('HU14 Regional', 'BBC Inwil Hoopers HU14 Team Axis', 'BBC Inwil Hoopers'),
  ('HU14 Regional', 'BBZU Huskies HU14', 'BBZU'),
  ('HU14 Regional', 'BCBE Panthers HU14', 'BC Buchrain-Ebikon'),
  ('HU14 Regional', 'BC Olten-Zofingen Bulldogs HU14', 'BC Olten-Zofingen'),
  ('HU14 Regional', 'BC Silvercoast HU14', 'BC Silvercoast'),
  ('HU14 Regional', 'BC Sins HU14', 'BC Sins'),
  ('HU14 Regional', 'BC Uster HU14', 'BC Uster'),
  ('HU14 Regional', 'BC Winterthur HU14', 'BC Winterthur'),
  ('HU14 Regional', 'BC Zürich 93 HU14', 'BC Zürich 93'),
  ('HU14 Regional', 'BIQ HU14', 'BIQ'),
  ('HU14 Regional', 'BS Kriens Hu14 Sharks', 'BS Kriens'),
  ('HU14 Regional', 'BS Kriens HU14 Falcons', 'BS Kriens'),
  ('HU14 Regional', 'BV Bregenz-Romanshorn HU14', 'BV Bregenz 1983'),
  ('HU14 Regional', 'BZO BC Effretikon Rookies HU14', 'BZO'),
  ('HU14 Regional', 'BZO BC Wetzikon Sooners HU14', 'BZO'),
  ('HU14 Regional', 'BZO Greifensee Eagles HU14', 'BZO'),
  ('HU14 Regional', 'Emmen Basket HU14', 'Emmen Basket'),
  ('HU14 Regional', 'GC Zürich HU14 C', 'GC Zürich Basketball'),
  ('HU14 Regional', 'GC Zürich HU14 B', 'GC Zürich Basketball'),
  ('HU14 Regional', 'GRBB Chur HU14', 'GRBB'),
  ('HU14 Regional', 'KSC Wiedikon HU14', 'KSC Wiedikon'),
  ('HU14 Regional', 'KTV Schaffhausen HU14', 'KTV Schaffhausen'),
  ('HU14 Regional', 'Mutschellen HU14', 'Mutschellen Basketball'),
  ('HU14 Regional', 'Oberthurgau Pirates HU14', 'Oberthurgau Pirates'),
  ('HU14 Regional', 'Opfikon Basket Blaze HU14', 'Opfikon Basket'),
  ('HU14 Regional', 'Regensdorf Pirates HU14', 'Phönix Basket'),
  ('HU14 Regional', 'Rheintal Scorpions HU14', 'Rheintal Scorpions'),
  ('HU14 Regional', 'Rüti Basket HU14', 'Rüti Basket'),
  ('HU14 Regional', 'Seeblick Bears HU14', 'Seeblick Bears Cham'),
  ('HU14 Regional', 'St. Otmar St. Gallen Basketball HU14', 'St. Otmar St. Gallen Basketball'),
  ('HU14 Regional', 'STV Basket Kreuzlingen HU14', 'STV Basket Kreuzlingen'),
  ('HU14 Regional', 'STV Luzern Basket HU14', 'STV Luzern Basket'),
  ('HU14 Regional', 'Unicorn 02 Basket HU14', 'Unicorn 02 Basket'),
  ('HU14 Regional', 'Goldcoast Wallabies HU14', 'Wallabies'),
  ('HU14 Regional', 'Wohlen Basket HU14', 'Wohlen Basket'),
  ('HU14 Regional', 'Zug Basket HU14', 'Zug Basket'),
  ('HU16 Regional', 'Baden Basket 54 HU16R', 'Baden Basket 54'),
  ('HU16 Regional', 'BBC Glarus HU16', 'BBC Glarus'),
  ('HU16 Regional', 'BBC Inwil Hoopers HU16 Team Nexus', 'BBC Inwil Hoopers'),
  ('HU16 Regional', 'BBZU Tigers HU16', 'BBZU'),
  ('HU16 Regional', 'BC Brunnen HU16', 'BC Brunnen'),
  ('HU16 Regional', 'BCBE Bulls HU16', 'BC Buchrain-Ebikon'),
  ('HU16 Regional', 'BCBE Sharks HU16 PR', 'BC Buchrain-Ebikon'),
  ('HU16 Regional', 'Marmotas Herren U16', 'BC Marmotas'),
  ('HU16 Regional', 'BC Olten-Zofingen Bulldogs HU16', 'BC Olten-Zofingen'),
  ('HU16 Regional', 'BC Seetal HU16', 'BC Seetal'),
  ('HU16 Regional', 'BC Sins HU16', 'BC Sins'),
  ('HU16 Regional', 'BC Zürich 93 HU16R', 'BC Zürich 93'),
  ('HU16 Regional', 'BC Silvercoast HU16R', 'BC Silvercoast'),
  ('HU16 Regional', 'BC Weinland HU16', NULL),
  ('HU16 Regional', 'BS Kriens Hu16 Dragons', 'BS Kriens'),
  ('HU16 Regional', 'BZO BC Wetzikon Wizards HU16', 'BZO'),
  ('HU16 Regional', 'Frauenfeld HU16-A Tigers', 'CVJM Frauenfeld'),
  ('HU16 Regional', 'Frauenfeld HU16-B Lakers', 'CVJM Frauenfeld'),
  ('HU16 Regional', 'Emmen Basket HU16', 'Emmen Basket'),
  ('HU16 Regional', 'GC Zürich HU16 C', 'GC Zürich Basketball'),
  ('HU16 Regional', 'GC Zürich HU16 B', 'GC Zürich Basketball'),
  ('HU16 Regional', 'GRBB Chur HU16', 'GRBB'),
  ('HU16 Regional', 'KSC Wiedikon HU16', 'KSC Wiedikon'),
  ('HU16 Regional', 'KTV Schaffhausen HU16R', 'KTV Schaffhausen'),
  ('HU16 Regional', 'Linth Basket HU16', 'Linth Basket'),
  ('HU16 Regional', 'Mutschellen HU16', 'Mutschellen Basketball'),
  ('HU16 Regional', 'Oberthurgau Pirates HU16', 'Oberthurgau Pirates'),
  ('HU16 Regional', 'Opfikon Basket Mavericks HU16', 'Opfikon Basket'),
  ('HU16 Regional', 'Regensdorf Blizzards HU16', 'Phönix Basket'),
  ('HU16 Regional', 'Rheintal Scorpions HU16', 'Rheintal Scorpions'),
  ('HU16 Regional', 'Rüti-Basket Ballers HU16', 'Rüti Basket'),
  ('HU16 Regional', 'Seeblick Bears HU16R', 'Seeblick Bears Cham'),
  ('HU16 Regional', 'St. Otmar St. Gallen Basketball HU16B', 'St. Otmar St. Gallen Basketball'),
  ('HU16 Regional', 'STV Basket Kreuzlingen HU16B', 'STV Basket Kreuzlingen'),
  ('HU16 Regional', 'STV Basket Kreuzlingen HU16A', 'STV Basket Kreuzlingen'),
  ('HU16 Regional', 'STV Luzern Basket HU16', 'STV Luzern Basket'),
  ('HU16 Regional', 'Unicorn 02 Basket HU16', 'Unicorn 02 Basket'),
  ('HU16 Regional', 'Goldcoast Wallabies HU16R', 'Wallabies'),
  ('HU16 Regional', 'Wohlen Basket HU16', 'Wohlen Basket'),
  ('HU16 Regional', 'Zug Basket HU16', 'Zug Basket'),
  ('HU18 Regional', 'Baden Basket 54 HU18R', 'Baden Basket 54'),
  ('HU18 Regional', 'BC Bears Wil HU18', 'BC Bears Wil'),
  ('HU18 Regional', 'BC Oerlikon Grizzlies HU18', 'BC Oerlikon Grizzlies'),
  ('HU18 Regional', 'BC Olten-Zofingen Bulldogs HU18', 'BC Olten-Zofingen'),
  ('HU18 Regional', 'BC Sarnen HU18', 'BC Sarnen'),
  ('HU18 Regional', 'BC Seuzach-Stammheim HU18', 'BC Seuzach-Stammheim'),
  ('HU18 Regional', 'BC Zürich 93 HU18', 'BC Zürich 93'),
  ('HU18 Regional', 'Frauenfeld HU18 Bulls', 'CVJM Frauenfeld'),
  ('HU18 Regional', 'Baskets Feldkirch HU18', 'Feldkirch Baskets'),
  ('HU18 Regional', 'KSC Wiedikon HU18', 'KSC Wiedikon'),
  ('HU18 Regional', 'Linth Basket - Wattwil HU18', 'Linth Basket'),
  ('HU18 Regional', 'Mutschellen HU18', 'Mutschellen Basketball'),
  ('HU18 Regional', 'Opfikon Basket HU18', 'Opfikon Basket'),
  ('HU18 Regional', 'St. Otmar St. Gallen Basketball HU18', 'St. Otmar St. Gallen Basketball'),
  ('HU18 Regional', 'STV Basket Kreuzlingen HU18', 'STV Basket Kreuzlingen'),
  ('HU18 Regional', 'STV Luzern Basket HU18', 'STV Luzern Basket'),
  ('HU18 Regional', 'Goldcoast Wallabies HU18', 'Wallabies'),
  ('MixU12', 'Neuenhof Tigers MU12', 'Baden Basket 54'),
  ('MixU12', 'Baden Basket 54 HU12', 'Baden Basket 54'),
  ('MixU12', 'BBC Glarus MU12', 'BBC Glarus'),
  ('MixU12', 'Freienbach Flyers MU12', 'BBC Glarus'),
  ('MixU12', 'BBZU Road Runners MU12', 'BBZU'),
  ('MixU12', 'BC Alte Kanti Aarau HU12 Wizards (Turniere)', 'BC AKA'),
  ('MixU12', 'BC Bears Wil MU12', 'BC Bears Wil'),
  ('MixU12', 'BC Brunnen MU12', 'BC Brunnen'),
  ('MixU12', 'BCBE Eagles U12 B', 'BC Buchrain-Ebikon'),
  ('MixU12', 'BCBE Eagles U12', 'BC Buchrain-Ebikon'),
  ('MixU12', 'BC Fällanden Red Lions MU12', 'BC Fällanden Red Lions'),
  ('MixU12', 'BC Olten-Zofingen HU12', 'BC Olten-Zofingen'),
  ('MixU12', 'BC Seuzach Stammheim MU12', 'BC Seuzach-Stammheim'),
  ('MixU12', 'BC Uster MU12', 'BC Uster'),
  ('MixU12', 'BC Zürich 93 MU12 Süd', 'BC Zürich 93'),
  ('MixU12', 'BC Zürich 93 MU12 Nord', 'BC Zürich 93'),
  ('MixU12', 'BIQ U12', 'BIQ'),
  ('MixU12', 'BS Kriens Mu12 Suns', 'BS Kriens'),
  ('MixU12', 'BSC Obfelden MU12', 'BSCO'),
  ('MixU12', 'Romanshorn-Bregenz MU12', 'BV Bregenz 1983'),
  ('MixU12', 'BZO BC Wetzikon Vaders MU12', 'BZO'),
  ('MixU12', 'BZO Greifensee Crows MU12', 'BZO'),
  ('MixU12', 'Frauenfeld MU12 Pandas (Turnier)', 'CVJM Frauenfeld'),
  ('MixU12', 'Emmen Basket MixU12M', 'Emmen Basket'),
  ('MixU12', 'GRBB Chur MU12', 'GRBB'),
  ('MixU12', 'Ikaros Zürich MU12', 'Ikaros Zürich BC'),
  ('MixU12', 'KSC Wiedikon HU12', 'KSC Wiedikon'),
  ('MixU12', 'KTV Schaffhausen MU12', 'KTV Schaffhausen'),
  ('MixU12', 'Linth Basket MU12', 'Linth Basket'),
  ('MixU12', 'Mutschellen HU12', 'Mutschellen Basketball'),
  ('MixU12', 'Opfikon Basket Grizzlies MU12', 'Opfikon Basket'),
  ('MixU12', 'Regensdorf Panthers HU12', 'Phönix Basket'),
  ('MixU12', 'Rüti Basket MU12', 'Rüti Basket'),
  ('MixU12', 'Immensee Panthers MU12', 'SCB'),
  ('MixU12', 'St. Otmar St. Gallen Basketball MIXU12A', 'St. Otmar St. Gallen Basketball'),
  ('MixU12', 'STV Basket Kreuzlingen MU12', 'STV Basket Kreuzlingen'),
  ('MixU12', 'STV Luzern Basket Racoons MU12', 'STV Luzern Basket'),
  ('MixU12', 'Sursee Basket MU12', 'Sursee Basket'),
  ('MixU12', 'TV Hünenberg Rockets MU12', NULL),
  ('MixU12', 'TV Reussbühl Basket MU12', 'TVRB'),
  ('MixU12', 'Unicorn 02 Basket MU12', 'Unicorn 02 Basket'),
  ('MixU12', 'Goldcoast Wallabies HU12', 'Wallabies'),
  ('MixU12', 'Weinland BC MU12', 'Weinland BC'),
  ('MixU12', 'Wohlen Basket MixU12 B', 'Wohlen Basket'),
  ('MixU12', 'Zug Basket MU12 Promo', 'Zug Basket'),
  ('MixU10', 'Baden Basket 54 HU10', 'Baden Basket 54'),
  ('MixU10', 'Neuenhof Tigers MU10', 'Baden Basket 54'),
  ('MixU10', 'BBZU Turtles MU10', 'BBZU'),
  ('MixU10', 'BBZU Wolves MU10', 'BBZU'),
  ('MixU10', 'BC Alte Kanti Aarau Pirates 3 MU10', 'BC AKA'),
  ('MixU10', 'BC Alte Kanti Aarau Pirates 1 MU10', 'BC AKA'),
  ('MixU10', 'BC Alte Kanti Aarau Pirates 2 MU10', 'BC AKA'),
  ('MixU10', 'BC Brunnen MU10', 'BC Brunnen'),
  ('MixU10', 'BCBE Dolphins 2 U10', 'BC Buchrain-Ebikon'),
  ('MixU10', 'BCBE Dolphins 1 U10', 'BC Buchrain-Ebikon'),
  ('MixU10', 'BC Fällanden Red Lions MU10', 'BC Fällanden Red Lions'),
  ('MixU10', 'BC Olten-Zofingen HU10', 'BC Olten-Zofingen'),
  ('MixU10', 'BC Seuzach Stammheim MU10', 'BC Seuzach-Stammheim'),
  ('MixU10', 'BC Silvercoast MU10', 'BC Silvercoast'),
  ('MixU10', 'BC Uster MU10', 'BC Uster'),
  ('MixU10', 'BC Zürich 93 MU10 Nord A', 'BC Zürich 93'),
  ('MixU10', 'BC Zürich 93 MU10 Süd', 'BC Zürich 93'),
  ('MixU10', 'BIQ U10', 'BIQ'),
  ('MixU10', 'BS Kriens Mu10 Hurricanes', 'BS Kriens'),
  ('MixU10', 'BS Kriens Mu10 Flames', 'BS Kriens'),
  ('MixU10', 'BSC Obfelden MU10', 'BSCO'),
  ('MixU10', 'Romanshorn-Bregenz MU10', 'BV Bregenz 1983'),
  ('MixU10', 'BZO Greifensee U10', 'BZO'),
  ('MixU10', 'BZO BC Wetzikon Flyers MU10', 'BZO'),
  ('MixU10', 'Frauenfeld MU10 (Turnier)', 'CVJM Frauenfeld'),
  ('MixU10', 'Emmen Basket Mix U10', 'Emmen Basket'),
  ('MixU10', 'GC Zürich MU10', 'GC Zürich Basketball'),
  ('MixU10', 'GRBB Chur MU10', 'GRBB'),
  ('MixU10', 'Ikaros Zürich U10', 'Ikaros Zürich BC'),
  ('MixU10', 'KSC Wiedikon MU10', 'KSC Wiedikon'),
  ('MixU10', 'KTV Schaffhausen MU10', 'KTV Schaffhausen'),
  ('MixU10', 'Linth Basket MU10', 'Linth Basket'),
  ('MixU10', 'Mutschellen HU10', 'Mutschellen Basketball'),
  ('MixU10', 'Oberthurgau Pirates U10', 'Oberthurgau Pirates'),
  ('MixU10', 'Opfikon Basket Grizzlies MU10', 'Opfikon Basket'),
  ('MixU10', 'Regensdorf Weasels HU10', 'Phönix Basket'),
  ('MixU10', 'Regensdorf Foxes HU10', 'Phönix Basket'),
  ('MixU10', 'Rüti Basket MU10', 'Rüti Basket'),
  ('MixU10', 'St. Otmar St. Gallen Basketball MIXU10', 'St. Otmar St. Gallen Basketball'),
  ('MixU10', 'STV Basket Kreuzlingen MU10', 'STV Basket Kreuzlingen'),
  ('MixU10', 'STV Luzern Basket Squirrels MU10', 'STV Luzern Basket'),
  ('MixU10', 'Sursee Basket MU10', 'Sursee Basket'),
  ('MixU10', 'TV Reussbühl Basket MU10', 'TVRB'),
  ('MixU10', 'Unicorn 02 Basket MU10', 'Unicorn 02 Basket'),
  ('MixU10', 'Goldcoast Wallabies MU10 2', 'Wallabies'),
  ('MixU10', 'Goldcoast Wallabies MU10', 'Wallabies'),
  ('MixU10', 'Weinland BC MU10', 'Weinland BC'),
  ('MixU10', 'Wohlen Basket MixU10 A', 'Wohlen Basket'),
  ('MixU10', 'Zug Basket MU10', 'Zug Basket'),
  ('DU10', 'Regensdorf Swans DU10', 'Phönix Basket'),
  ('DU10', 'Mutschellen DU10', 'Mutschellen Basketball'),
  ('DU10', 'KSC Wiedikon DU10', 'KSC Wiedikon'),
  ('DU10', 'Baar Bumble Bees DU10', 'Baar Bumble Bees'),
  ('DU10', 'BC Uster DU10', 'BC Uster'),
  ('DU10', 'BC Olten-Zofingen DU10', 'BC Olten-Zofingen'),
  ('DU10', 'BC Alte Kanti Aarau DU10', 'BC AKA'),
  ('DU10', 'Baden Basket 54 DU10', 'Baden Basket 54'),
  ('MixU8', 'Baar Bumble Bees DU8', 'Baar Bumble Bees'),
  ('MixU8', 'Baden Basket 54 U8', 'Baden Basket 54'),
  ('MixU8', 'BBZU Avengers MU8', 'BBZU'),
  ('MixU8', 'BC Alte Kanti Aarau Kangaroos MU8', 'BC AKA'),
  ('MixU8', 'BC Fällanden Red Lions MU8', 'BC Fällanden Red Lions'),
  ('MixU8', 'BC Seuzach-Stammheim MU8', 'BC Seuzach-Stammheim'),
  ('MixU8', 'BC Uster MU8', 'BC Uster'),
  ('MixU8', 'BC Zürich 93 MU8 Süd', 'BC Zürich 93'),
  ('MixU8', 'BS Kriens Mu8 Pirates', 'BS Kriens'),
  ('MixU8', 'BZO Greifensee U8', 'BZO'),
  ('MixU8', 'Frauenfeld MU8 (Turnier)', 'CVJM Frauenfeld'),
  ('MixU8', 'Emmen Basket Mix U8', 'Emmen Basket'),
  ('MixU8', 'Ikaros Zürich U8', 'Ikaros Zürich BC'),
  ('MixU8', 'KSC Wiedikon MU8', 'KSC Wiedikon'),
  ('MixU8', 'KTV Schaffhausen MU8', 'KTV Schaffhausen'),
  ('MixU8', 'Regensdorf Racoons MU8', 'Phönix Basket'),
  ('MixU8', 'Rüti Basket MU8', 'Rüti Basket'),
  ('MixU8', 'STV Basket Kreuzlingen MU8', 'STV Basket Kreuzlingen'),
  ('MixU8', 'STV Luzern Basket Colibri MU08', 'STV Luzern Basket'),
  ('MixU8', 'Unicorn 02 Basket U8', 'Unicorn 02 Basket'),
  ('MixU8', 'Goldcoast Wallabies U8', 'Wallabies'),
  ('MixU8', 'Zug Basket MU8', 'Zug Basket')
) AS v(code, team_name, club_name) ON v.code = g.code
ON CONFLICT (group_id, team_name) DO UPDATE SET club_name = EXCLUDED.club_name;

-- Our own rows. The TEAM is identified by bb_source_id (never by name — prod team 72 is
-- called "2xDU18" but plays DU16); the ROW is identified by (group, exact workbook name),
-- because DU18/U20 Rookie holds two Wiedikon entries and a group-only match claims both.
UPDATE basketball_group_teams gt SET kscw_team = t.id
FROM basketball_groups g, game_scheduling_seasons s, teams t, (VALUES
  ('4445', 'D1LRA', 'KSC Wiedikon Lions D1'),
  ('1077', 'D3LRA', 'KSC Wiedikon Rhinos D3'),
  ('5104', 'DU12 TU', 'KSC Wiedikon DU12'),
  ('5441', 'DU14 Regional', 'KSC Wiedikon DU14'),
  ('7182', 'DU14/U16 Rookie', 'KSC Wiedikon DU16'),
  ('5697', 'DU18/U20 Rookie', 'KSC Wiedikon DU18 A'),
  ('1348', 'H1LRA', 'KSC Wiedikon Herren 1 H1'),
  ('4829', 'H2LRA', 'KSC Wiedikon Herren 2 H2'),
  ('7183', 'H4LRA', 'KSC Wiedikon Herren 3 (Unicorns) H4'),
  ('5790', 'HU14 Regional', 'KSC Wiedikon HU14'),
  ('5498', 'HU16 Regional', 'KSC Wiedikon HU16'),
  ('5789', 'HU18 Regional', 'KSC Wiedikon HU18'),
  ('5791', 'MixU12', 'KSC Wiedikon HU12'),
  ('5287', 'MixU10', 'KSC Wiedikon MU10'),
  ('6724', 'MixU8', 'KSC Wiedikon MU8')
) AS v(bb_source_id, code, team_name)
WHERE gt.group_id = g.id AND g.season = s.id AND s.season = '2026/27'
  AND g.code = v.code AND gt.team_name = v.team_name
  AND t.bb_source_id = v.bb_source_id AND t.sport = 'basketball' AND t.active
  AND gt.kscw_team IS DISTINCT FROM t.id;

-- Opponent clubs, by EXACT name only. A fuzzy match here would mis-address a
-- scheduling link; NULL is visible and harmless, a wrong club is neither.
--
-- ⚠ `is_own_club` is excluded. Two of our own rows carry no kscw_team — DU18 B (no
-- `teams` row yet) and DU10 (no active team) — so a kscw_team-only guard let them match
-- KSC Wiedikon itself and be filed as opponents, which would pair the club against
-- itself in its own portal.
UPDATE basketball_group_teams gt SET bp_club = c.id
FROM basketplan_clubs c
WHERE gt.kscw_team IS NULL AND gt.club_name IS NOT NULL
  AND c.name = gt.club_name AND c.is_own_club IS NOT TRUE
  AND gt.bp_club IS DISTINCT FROM c.id;

-- Converge the other way too: clear any own-club link a previous run may have set.
UPDATE basketball_group_teams gt SET bp_club = NULL
FROM basketplan_clubs c
WHERE gt.bp_club = c.id AND c.is_own_club IS TRUE;

-- ── 3. Directus registration ─────────────────────────────────────────────────
INSERT INTO directus_collections
  (collection, icon, color, hidden, singleton, collapse, versioning, status, archive_app_filter, note)
SELECT v.collection, 'sports_basketball', '#e8590c', false, false, 'open', false, 'active', true, v.note
FROM (VALUES
  ('basketball_groups',      'ProBasket groups we play in (season, code, format, Anzahl Spiele).'),
  ('basketball_group_teams', 'Teams registered in each ProBasket group; links opponents to clubs and our rows to teams.')
) AS v(collection, note)
WHERE NOT EXISTS (SELECT 1 FROM directus_collections c WHERE c.collection = v.collection);

INSERT INTO directus_fields (collection, field, special, interface, sort, width, note, readonly, hidden)
SELECT 'basketball_groups', v.field, v.special, v.interface, v.sort, v.width, v.note, v.readonly, false
FROM (VALUES
  ('season',      NULL,             'select-dropdown-m2o', 1, 'half', 'Scheduling season.', true),
  ('code',        NULL,             'input',               2, 'half', 'Gruppeneinteilung group header, verbatim.', false),
  ('label',       NULL,             'input',               3, 'half', 'Liga label as ProBasket writes it.', false),
  ('sex',         NULL,             'select-dropdown',     4, 'half', 'Competition sex, not the roster gender.', false),
  ('format',      NULL,             'select-dropdown',     5, 'half', 'championship = games_total is stated; provisional = no count yet; tournament = not home-and-away.', false),
  ('games_total', NULL,             'input',               6, 'half', 'Anzahl Spiele per team (home + away). Home games = this / 2.', false),
  ('modus',       NULL,             'input',               7, 'half', 'Modus column from the workbook.', false),
  ('note',        NULL,             'input-multiline',     8, 'full', 'Why this classification.', false),
  ('date_created','date-created',   'datetime',            9, 'half', NULL, true),
  ('date_updated','date-updated',   'datetime',           10, 'half', NULL, true)
) AS v(field, special, interface, sort, width, note, readonly)
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields f WHERE f.collection = 'basketball_groups' AND f.field = v.field
);

INSERT INTO directus_fields (collection, field, special, interface, sort, width, note, readonly, hidden)
SELECT 'basketball_group_teams', v.field, NULL, v.interface, v.sort, v.width, v.note, false, false
FROM (VALUES
  ('group_id',  'select-dropdown-m2o', 1, 'half', 'Owning group.'),
  ('team_name', 'input',               2, 'half', 'Team as the Gruppeneinteilung spells it.'),
  ('club_name', 'input',               3, 'half', 'Klub from the Klubübersicht sheet.'),
  ('bp_club',   'select-dropdown-m2o', 4, 'half', 'Basketplan club. NULL = no exact name match; never guessed.'),
  ('kscw_team', 'select-dropdown-m2o', 5, 'half', 'Our team, linked by bb_source_id. NULL on opponents.')
) AS v(field, interface, sort, width, note)
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields f WHERE f.collection = 'basketball_group_teams' AND f.field = v.field
);

-- ── 4. Assert the end state rather than trusting the inserts ─────────────────
DO $$
DECLARE
  n_groups int; n_teams int; n_kscw int; n_champ_no_games int; n_bp int; n_unmatched int;
BEGIN
  SELECT count(*) INTO n_groups
    FROM basketball_groups g JOIN game_scheduling_seasons s ON s.id = g.season
    WHERE s.season = '2026/27';
  SELECT count(*) INTO n_teams
    FROM basketball_group_teams gt JOIN basketball_groups g ON g.id = gt.group_id
    JOIN game_scheduling_seasons s ON s.id = g.season WHERE s.season = '2026/27';
  SELECT count(*) INTO n_kscw
    FROM basketball_group_teams gt JOIN basketball_groups g ON g.id = gt.group_id
    JOIN game_scheduling_seasons s ON s.id = g.season
    WHERE s.season = '2026/27' AND gt.kscw_team IS NOT NULL;

  IF n_groups <> 16 THEN
    RAISE EXCEPTION 'migration 287: expected 16 groups for 2026/27, got %', n_groups;
  END IF;
  IF n_teams <> 334 THEN
    RAISE EXCEPTION 'migration 287: expected 334 group-team rows, got %', n_teams;
  END IF;
  -- 15 links, not 16: the workbook lists KSC Wiedikon DU18 B but no `teams` row carries its
  -- bb_source_id yet (documented TODO in basketballGroups.ts). Bump this when it exists.
  IF n_kscw <> 15 THEN
    RAISE EXCEPTION 'migration 287: expected 15 KSCW team links, got % — check bb_source_id drift', n_kscw;
  END IF;

  -- The CHECK constraint already forbids it; assert anyway so a future seed edit that drops a
  -- games_total fails here with a readable message instead of a constraint code.
  SELECT count(*) INTO n_champ_no_games FROM basketball_groups g
    JOIN game_scheduling_seasons s ON s.id = g.season
    WHERE s.season = '2026/27' AND g.format = 'championship' AND g.games_total IS NULL;
  IF n_champ_no_games > 0 THEN
    RAISE EXCEPTION 'migration 287: % championship group(s) without games_total', n_champ_no_games;
  END IF;

  SELECT count(*) FILTER (WHERE gt.bp_club IS NOT NULL),
         count(*) FILTER (WHERE gt.bp_club IS NULL AND gt.kscw_team IS NULL)
    INTO n_bp, n_unmatched
    FROM basketball_group_teams gt JOIN basketball_groups g ON g.id = gt.group_id
    JOIN game_scheduling_seasons s ON s.id = g.season WHERE s.season = '2026/27';

  -- Our own club must never appear as an opponent: it would pair KSCW against itself in its
  -- own portal. Two of our rows have no kscw_team (DU18 B, DU10) and would otherwise match.
  IF EXISTS (
    SELECT 1 FROM basketball_group_teams gt
    JOIN basketplan_clubs c ON c.id = gt.bp_club
    WHERE c.is_own_club IS TRUE
  ) THEN
    RAISE EXCEPTION 'migration 287: our own club is linked as an opponent on some group row';
  END IF;

  RAISE NOTICE 'migration 287: % groups, % teams, % KSCW links, % opponents linked to a Basketplan club, % unlinked (exact-name misses — link by hand if a portal needs them)',
    n_groups, n_teams, n_kscw, n_bp, n_unmatched;
END $$;

COMMIT;
