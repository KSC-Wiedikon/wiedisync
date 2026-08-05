-- Migration 278 — basketball slot generation: candidate inventory + per-team rule matrix.
--
-- ONE bounded change: give basketball the two storage pieces its slot generator needs.
-- Nothing here touches volleyball's `game_scheduling_slots` pipeline.
--
--   1. `basketball_team_rules` — the club's constraint matrix, ONE ROW PER (season, team).
--   2. `basketball_slots`      — the GENERATED candidate inventory, one row per
--                                (season, KSCW team, date, time, hall) that survives every
--                                hard rule. Written only by
--                                POST /kscw/terminplanung/admin/basketball/generate-slots.
--   3. `game_scheduling_seasons.bb_slot_config` (jsonb) — the CLUB-level half of the sheet
--      that has no per-team home: the timeslot→category matrix and the Spielsamstag list.
--
-- ── Why a TABLE for the per-team rules and JSON for the club-level half ─────────────────
--
-- Volleyball stores its per-team generator config as one jsonb map on the season row
-- (`game_scheduling_seasons.team_slot_config`, keyed by stringified teams.id). That shape
-- was considered and deliberately NOT reused for basketball:
--
--   • REFERENTIAL INTEGRITY. A json map keyed by a stringified team id has no FK: when a
--     team row is replaced the key survives as dead weight and nothing complains. A real
--     `team integer REFERENCES teams(id) ON DELETE CASCADE` cannot rot. Basketball has
--     already been bitten by exactly this class of drift (BB_GROUPS['DU10'] is unreachable
--     because no team row carries a DU10 bb_source_id).
--   • CONSTRAINTS. `UNIQUE(season, team)`, the category/league CHECKs and the HH:MM format
--     CHECKs below are enforceable on a table and unenforceable inside a blob.
--   • AUDIT GRANULARITY. The kscw-hooks `items.*` hook diffs the items API per FIELD; a
--     json blob logs one opaque "team_slot_config changed" entry with no idea which team.
--   • CONCURRENCY. Two admins editing two different teams do not clobber each other. A
--     json blob is last-write-wins.
--   • VERSIONING. `team_slot_config` has no version field, which is exactly why
--     TeamSlotConfigPanel.tsx needs a four-branch back-compat ladder for ONE field. Named
--     columns migrate; blob shapes accrete readers.
--   • UI. The editor is a list of 11 homogeneous records → CLAUDE.md "Lists → tables,
--     always" maps 1:1 onto rows.
--
-- The CLUB-level half (timeslot matrix, Spielsamstag list) has no natural row identity, one
-- writer, and is edited as a whole — so it stays json, on the season row next to
-- `spielsamstage` and `team_slot_config`. Two shapes, each where it fits.
--
-- ── Why an explicit `league` + `ferien_hard` column, never `teams.league` ───────────────
-- `teams.league` is demonstrably stale on prod: team 76 is named "Herren 2 H3" and carries
-- league='H3LS', but the 26/27 ProBasket registration is Herren 2. Liga (H2LRA). Team 72
-- still reads full_name='KSC Wiedikon DU16' / league='DU16B'. Since the ProBasket Ferien
-- rule binds "alle interregionalen Ligen, sowie die 1. / 2. Seniorenligen" and nobody else,
-- deriving that flag from `teams.league` would give the WRONG three teams the hard block.
-- Both columns are therefore explicit and seeded from `teams.bb_source_id` via the
-- KSCW_TEAM_GROUP → GROUP_CODE_TO_LEAGUE mapping in the frontend
-- (src/modules/gameScheduling/data/basketballGroups.ts + utils/probasketSeason.ts).
--
-- ── Policy ─────────────────────────────────────────────────────────────────────────────
-- SCHEMA-ONLY and idempotent per CLAUDE.md. Item permissions live ONLY in
-- directus/scripts/setup-permissions.mjs — add `basketball_slots` + `basketball_team_rules`
-- there, NOT here. A Directus container restart is required after this migration so the
-- API sees the new collections before setup-permissions runs against them.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════════════════
-- 1. Club-level basketball slot config on the (sport-neutral) season row.
-- ═══════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.game_scheduling_seasons
  ADD COLUMN IF NOT EXISTS bb_slot_config jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.game_scheduling_seasons.bb_slot_config IS
  'Club-level basketball slot-generation config: {version, timeslots:[{dow,time,allow[],tolerate[]}], spielsamstage:[{date,status,note}]}. dow uses JS getDay (5=Fri, 6=Sat, 0=Sun); the TIMES are not authoritative here — they reference the fixed grid in src/modules/gameScheduling/utils/probasketSeason.ts (FRIDAY_SLOTS/SATURDAY_SLOTS/SUNDAY_SLOTS), so the two cannot drift. allow = the slot is meant for this category; tolerate = permitted but scored lower. spielsamstage.status: given (volleyball already booked KWI that weekend) | desired | fraglich | bei_bedarf. The per-LEAGUE season windows and the ProBasket Ferien/Sperrdaten are NOT stored here — they live in probasketSeason.ts and are mirrored by kscw-endpoints/src/basketball-slots.js.';

INSERT INTO directus_fields (collection, field, special, interface, sort, width, note, readonly, hidden)
SELECT 'game_scheduling_seasons', 'bb_slot_config', 'cast-json', 'input-code', 30, 'full',
       'Basketball: timeslot to category matrix + Spielsamstag list. Read by the basketball slot generator.',
       false, false
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'game_scheduling_seasons' AND field = 'bb_slot_config'
);

-- ═══════════════════════════════════════════════════════════════════════════════════════
-- 2. Per-team basketball constraint rules (the club's "Constrains BB Spielplanung" sheet).
-- ═══════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.basketball_team_rules (
  id                serial PRIMARY KEY,
  season            integer NOT NULL REFERENCES public.game_scheduling_seasons(id) ON DELETE CASCADE,
  team              integer NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  enabled           boolean NOT NULL DEFAULT true,
  category          varchar(16) NOT NULL DEFAULT 'seniors',
  league            varchar(16) NOT NULL DEFAULT 'JUN_REG',
  ferien_hard       boolean NOT NULL DEFAULT false,
  allowed_dows      jsonb   NOT NULL DEFAULT '[5,6,0]'::jsonb,
  preferred_dows    jsonb   NOT NULL DEFAULT '[]'::jsonb,
  start_min         varchar(5),
  start_max         varchar(5),
  start_hard        boolean NOT NULL DEFAULT true,
  halls             jsonb   NOT NULL DEFAULT '{"hard": false, "tiers": []}'::jsonb,
  own_back_to_back  boolean NOT NULL DEFAULT true,
  blocked           jsonb   NOT NULL DEFAULT '[]'::jsonb,
  note              text,
  created_by        integer REFERENCES public.members(id) ON DELETE SET NULL,
  date_created      timestamptz NOT NULL DEFAULT now(),
  date_updated      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT basketball_team_rules_season_team_unique UNIQUE (season, team)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'basketball_team_rules_category_chk') THEN
    ALTER TABLE public.basketball_team_rules ADD CONSTRAINT basketball_team_rules_category_chk
      CHECK (category IN ('seniors', 'youth', 'u18'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'basketball_team_rules_league_chk') THEN
    -- Mirrors ProbasketLeagueCode in src/modules/gameScheduling/utils/probasketSeason.ts.
    ALTER TABLE public.basketball_team_rules ADD CONSTRAINT basketball_team_rules_league_chk
      CHECK (league IN ('H4LR','D3LR','H3LR','D2LR','H2LR','D1LI','H1LI','BLS','MIXED',
                        'JUN_REG','JUN_INTER','HU14_INTER','KIDS_MINIS'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'basketball_team_rules_start_min_chk') THEN
    ALTER TABLE public.basketball_team_rules ADD CONSTRAINT basketball_team_rules_start_min_chk
      CHECK (start_min IS NULL OR start_min ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'basketball_team_rules_start_max_chk') THEN
    ALTER TABLE public.basketball_team_rules ADD CONSTRAINT basketball_team_rules_start_max_chk
      CHECK (start_max IS NULL OR start_max ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'basketball_team_rules_start_order_chk') THEN
    -- Zero-padded HH:MM sorts lexicographically, so a plain string compare is correct.
    ALTER TABLE public.basketball_team_rules ADD CONSTRAINT basketball_team_rules_start_order_chk
      CHECK (start_min IS NULL OR start_max IS NULL OR start_max >= start_min);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'basketball_team_rules_json_shape_chk') THEN
    ALTER TABLE public.basketball_team_rules ADD CONSTRAINT basketball_team_rules_json_shape_chk
      CHECK (jsonb_typeof(allowed_dows) = 'array'
         AND jsonb_typeof(preferred_dows) = 'array'
         AND jsonb_typeof(blocked) = 'array'
         AND jsonb_typeof(halls) = 'object');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'basketball_team_rules_dows_chk') THEN
    -- Basketball plays Fri/Sat/Sun only (JS getDay 5/6/0). A weekday in allowed_dows would
    -- silently generate nothing (no fixed grid exists for it), so reject it at write time.
    -- jsonb containment, not a subquery: CHECK constraints may not contain one.
    -- '[5,6,0]' <@ '[0,5,6]' is true; '[1]' <@ '[0,5,6]' is false.
    ALTER TABLE public.basketball_team_rules ADD CONSTRAINT basketball_team_rules_dows_chk
      CHECK (allowed_dows <@ '[0,5,6]'::jsonb AND preferred_dows <@ '[0,5,6]'::jsonb);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS basketball_team_rules_season_idx ON public.basketball_team_rules (season);

COMMENT ON TABLE public.basketball_team_rules IS
  'Per basketball team, per season: the club constraint matrix that drives basketball slot generation (Google Sheet "Constrains BB Spielplanung"). One row per (season, team). NO row = the team is not slot-generated at all — deliberate: MU8/MU10/DU12/HU12 and the two Classics squads are Turnier/veteran formats with no home fixtures, and volleyball''s "absent config means both sources" default would flood the grid. Edited via Basketball to Settings through the Directus items API, which Directus actor-logs on its own.';
COMMENT ON COLUMN public.basketball_team_rules.enabled IS
  'Generate slots for this team. false = keep the rules but skip generation (same effect as no row, without losing the matrix).';
COMMENT ON COLUMN public.basketball_team_rules.category IS
  'seniors | youth | u18 — joins the team to the club timeslot matrix in game_scheduling_seasons.bb_slot_config.timeslots. EXPLICIT, never derived from the team name: "1xDU18"/"2xDU18" are u18 and "Herren 2 H3" is seniors despite what the names say.';
COMMENT ON COLUMN public.basketball_team_rules.league IS
  'ProBasket league code (ProbasketLeagueCode in src/modules/gameScheduling/utils/probasketSeason.ts) — decides the team''s availability-grid WINDOW, which is per league, not per season (the 1.-Liga grid runs to 09.05.2027, the junior one stops on 13.12.2026). Seeded from teams.bb_source_id via KSCW_TEAM_GROUP, NOT from teams.league, which is stale on prod (team 76 "Herren 2 H3" carries H3LS but is registered H2LRA for 26/27).';
COMMENT ON COLUMN public.basketball_team_rules.ferien_hard IS
  'ProBasket "Spiel- und Sperrdaten 2026/2027", verbatim: "In folgenden Zeitfenster werden in allen interregionalen Ligen, sowie in der 1. / 2. Seniorenligen keine Spiele durch den Verband angesetzt. In allen anderen Ferien gilt eine grundsaetzliche Spielpflicht." true = a Ferien blackout HARD-blocks this team; false = it is only a soft score penalty. Sperrdaten ("Sperrdaten fuer alle") block everyone regardless of this flag. Explicit column, never derived from teams.league.';
COMMENT ON COLUMN public.basketball_team_rules.allowed_dows IS
  'HARD allow-list of JS getDay values (5=Fri, 6=Sat, 0=Sun). Sheet "weekends" = [6,0]; default [5,6,0].';
COMMENT ON COLUMN public.basketball_team_rules.preferred_dows IS
  'SOFT preference (scored, never filtered). Sheet "home friday" = [5] — a HOME preference only; it says nothing about away days.';
COMMENT ON COLUMN public.basketball_team_rules.start_min IS
  'Earliest tip-off HH:MM, INCLUSIVE. Sheet "start after 1.30" = 13:30. NULL = no lower bound.';
COMMENT ON COLUMN public.basketball_team_rules.start_max IS
  'Latest tip-off HH:MM, INCLUSIVE. Sheet "start before 1.30" = 13:30. NULL = no upper bound. Both bounds are inclusive by convention, so the Saturday 13:30 pitch is shared by the after-1.30 and before-1.30 camps. The sheet does not say whether 13:30 itself is allowed — inclusive is the reading that leaves DU14/HU14 more than three pitches a weekend. OPEN QUESTION for the sheet author.';
COMMENT ON COLUMN public.basketball_team_rules.start_hard IS
  'true = the start window is a HARD filter (the slot is not generated); false = a SOFT penalty only. Seeded true: a soft window would still leave Sat 11:00 in Lions D1''s inventory, i.e. the constraint would do nothing. The sheet states no hardness — this is a judgement call, flip per team if wrong.';
COMMENT ON COLUMN public.basketball_team_rules.halls IS
  '{"hard":bool,"tiers":[{"rank":int,"options":["KWI A+B"],"last_resort":bool}]}. hard=true -> only rank-1 options are generated (sheet "A+B (hard)"). hard=false -> every listed tier is generated, higher ranks scored lower; a hall in NO tier is never generated. Empty tiers = all halls equal.';
COMMENT ON COLUMN public.basketball_team_rules.own_back_to_back IS
  'Sheet "Back-to-back allowed?" — may this team occupy a pitch adjacent to one of its OWN placed games the same day. false -> adjacent candidates are PENALISED, not removed (soft). NOTE: this is NOT team_links link_type=adjacent, which is a constraint BETWEEN two teams.';
COMMENT ON COLUMN public.basketball_team_rules.blocked IS
  'Array of blocked-date RULES, never expanded dates (the ZH holiday ranges refresh annually via schulferien-sync.js, so frozen dates guarantee drift). Kinds: {"kind":"before_date","date":"YYYY-MM-DD"} (sheet "until oct"); {"kind":"school_holidays","canton":"ZH","include_weekend_before":true} (sheet "holidays and weekend before", resolved at generation time against hall_closures WHERE source=''school_holidays''); {"kind":"date_range","start":"…","end":"…"}. All hard.';

-- ═══════════════════════════════════════════════════════════════════════════════════════
-- 3. Generated basketball slot inventory.
-- ═══════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.basketball_slots (
  id              serial PRIMARY KEY,
  season          integer NOT NULL REFERENCES public.game_scheduling_seasons(id) ON DELETE CASCADE,
  kscw_team       integer NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  date            date        NOT NULL,
  "time"          varchar(5)  NOT NULL,
  end_time        varchar(5)  NOT NULL,
  hall            varchar(16) NOT NULL,
  status          varchar(16) NOT NULL DEFAULT 'available',
  source          varchar(16) NOT NULL DEFAULT 'generated',
  score           integer NOT NULL DEFAULT 0,
  score_reasons   jsonb   NOT NULL DEFAULT '[]'::jsonb,
  plan            integer REFERENCES public.basketball_slot_plan(id) ON DELETE SET NULL,
  generation_run  uuid,
  generated_at    timestamptz,
  note            text,
  created_by      integer REFERENCES public.members(id) ON DELETE SET NULL,
  date_created    timestamptz NOT NULL DEFAULT now(),
  date_updated    timestamptz NOT NULL DEFAULT now(),
  -- The generator's idempotency contract. It upserts with a TARGETLESS ON CONFLICT, so a
  -- matching unique on the identity tuple is mandatory (CLAUDE.md / the 245-256 batch:
  -- "targetless ON CONFLICT DO NOTHING must have a matching partial unique"). Without it a
  -- re-run duplicates every row instead of updating it.
  CONSTRAINT basketball_slots_identity_unique UNIQUE (season, kscw_team, date, "time", hall)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'basketball_slots_status_chk') THEN
    ALTER TABLE public.basketball_slots ADD CONSTRAINT basketball_slots_status_chk
      CHECK (status IN ('available', 'placed', 'blocked'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'basketball_slots_source_chk') THEN
    ALTER TABLE public.basketball_slots ADD CONSTRAINT basketball_slots_source_chk
      CHECK (source IN ('generated', 'manual'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'basketball_slots_hall_chk') THEN
    ALTER TABLE public.basketball_slots ADD CONSTRAINT basketball_slots_hall_chk
      CHECK (hall IN ('KWI A', 'KWI B', 'KWI C', 'KWI A+B'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'basketball_slots_time_chk') THEN
    ALTER TABLE public.basketball_slots ADD CONSTRAINT basketball_slots_time_chk
      CHECK ("time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'basketball_slots_reasons_chk') THEN
    ALTER TABLE public.basketball_slots ADD CONSTRAINT basketball_slots_reasons_chk
      CHECK (jsonb_typeof(score_reasons) = 'array');
  END IF;
END $$;

-- One PLACED slot per physical (season, date, time, hall): several teams may hold a
-- CANDIDATE for the same court (that is the whole point of the inventory), but only one
-- game can actually occupy it. Partial unique — the repo's standard shape for "identity
-- only in one state" (migration 246).
-- ⚠ Known limit: 'KWI A+B' and 'KWI A'/'KWI B' are the same floor but different strings, so
-- this index cannot catch a combined-court clash. `basketball_slot_plan`'s own
-- UNIQUE(season,date,time,hall) has exactly the same blind spot; the generator closes it in
-- code (hallsCollide). Fixing it structurally means normalising the hall vocabulary, which
-- is a bigger change than this migration.
CREATE UNIQUE INDEX IF NOT EXISTS basketball_slots_placed_unique
  ON public.basketball_slots (season, date, "time", hall)
  WHERE status = 'placed';

CREATE INDEX IF NOT EXISTS basketball_slots_season_date_idx ON public.basketball_slots (season, date);
CREATE INDEX IF NOT EXISTS basketball_slots_season_team_idx ON public.basketball_slots (season, kscw_team);
CREATE INDEX IF NOT EXISTS basketball_slots_plan_idx ON public.basketball_slots (plan) WHERE plan IS NOT NULL;

COMMENT ON TABLE public.basketball_slots IS
  'Generated basketball home-slot inventory: one row per (season, KSCW team, date, time, hall) that survives every HARD rule in basketball_team_rules + bb_slot_config. score = the SOFT ranking (higher is better); score_reasons = [{code,delta}] so the UI can explain it. Written only by POST /kscw/terminplanung/admin/basketball/generate-slots (raw knex + writeUserLog actor capture); re-running upserts on the identity key so it never duplicates. Distinct from basketball_slot_plan, which stays the hand-placed game grid.';
COMMENT ON COLUMN public.basketball_slots.hall IS
  'KWI A | KWI B | KWI C | KWI A+B. A+B is the combined big court and consumes BOTH halves — the generator treats A/B and A+B as mutually exclusive when checking closures, volleyball bookings and existing placements.';
COMMENT ON COLUMN public.basketball_slots.status IS
  'available | placed (a basketball_slot_plan game occupies it — see plan) | blocked (hand-parked; the generator never writes this). Kept in step with basketball_slot_plan by the two triggers below. NOTE: status and plan are deliberately NOT coupled by a CHECK — the FK''s ON DELETE SET NULL is itself an AFTER trigger and would trip such a CHECK on every placement delete.';
COMMENT ON COLUMN public.basketball_slots.source IS
  'generated (rewritten on every run) | manual (hand-added; the generator never deletes or overwrites it).';
COMMENT ON COLUMN public.basketball_slots.score_reasons IS
  '[{"code":"preferred_day","delta":30}, …] — every soft term that produced `score`, so the planner can see WHY one slot outranks another. Codes are defined in kscw-endpoints/src/basketball-slots.js (SCORE_CODES).';
COMMENT ON COLUMN public.basketball_slots.generation_run IS
  'uuid of the generator run that last wrote this row — lets an operator diff two runs and spot rows a re-run stopped producing.';

-- ═══════════════════════════════════════════════════════════════════════════════════════
-- 4. Keep basketball_slots.status in step with basketball_slot_plan placements.
--
--    TWO triggers on purpose:
--      · release runs BEFORE DELETE. It CANNOT be folded into the AFTER trigger: the FK's
--        ON DELETE SET NULL is itself an AFTER trigger and fires first, so an AFTER handler
--        would already see plan = NULL and could not find the row to release.
--      · claim runs AFTER INSERT OR UPDATE (no RI action involved there).
--    Named trg_*_0_* so they sort before any future trg_*_notify — Postgres fires
--    same-event triggers in ALPHABETICAL order (migration 246).
-- ═══════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.bb_slot_plan_release_slots() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  UPDATE public.basketball_slots
     SET status = 'available', plan = NULL, date_updated = now()
   WHERE plan = OLD.id;
  RETURN OLD;
END $fn$;

CREATE OR REPLACE FUNCTION public.bb_slot_plan_sync_slots() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  -- The placement moved (or lost its KSCW team): free the slot it used to hold.
  IF TG_OP = 'UPDATE' THEN
    UPDATE public.basketball_slots
       SET status = 'available', plan = NULL, date_updated = now()
     WHERE plan = OLD.id
       AND NOT (season = NEW.season
                AND kscw_team IS NOT DISTINCT FROM NEW.kscw_team
                AND date = NEW.date
                AND "time" = NEW."time"
                AND hall = NEW.hall);
  END IF;
  -- Claim the matching candidate, if the inventory happens to hold one. A placement into a
  -- slot the generator never offered simply matches nothing — that is legal (the planner
  -- may always overrule the generator) and must not raise.
  IF NEW.kscw_team IS NOT NULL THEN
    UPDATE public.basketball_slots
       SET status = 'placed', plan = NEW.id, date_updated = now()
     WHERE season = NEW.season
       AND kscw_team = NEW.kscw_team
       AND date = NEW.date
       AND "time" = NEW."time"
       AND hall = NEW.hall;
  END IF;
  RETURN NULL;
END $fn$;

DROP TRIGGER IF EXISTS trg_basketball_slot_plan_0_release_slots ON public.basketball_slot_plan;
CREATE TRIGGER trg_basketball_slot_plan_0_release_slots
  BEFORE DELETE ON public.basketball_slot_plan
  FOR EACH ROW EXECUTE FUNCTION public.bb_slot_plan_release_slots();

DROP TRIGGER IF EXISTS trg_basketball_slot_plan_0_sync_slots ON public.basketball_slot_plan;
CREATE TRIGGER trg_basketball_slot_plan_0_sync_slots
  AFTER INSERT OR UPDATE ON public.basketball_slot_plan
  FOR EACH ROW EXECUTE FUNCTION public.bb_slot_plan_sync_slots();

-- ═══════════════════════════════════════════════════════════════════════════════════════
-- 5. Directus admin metadata. Item PERMISSIONS live in setup-permissions.mjs, never here.
-- ═══════════════════════════════════════════════════════════════════════════════════════
INSERT INTO directus_collections
  (collection, icon, color, hidden, singleton, collapse, versioning, status, archive_app_filter, note)
SELECT v.collection, 'sports_basketball', '#e8590c', false, false, 'open', false, 'active', true, v.note
FROM (VALUES
  ('basketball_team_rules', 'Per-team basketball scheduling constraints (the club constraint matrix).'),
  ('basketball_slots',      'Generated basketball candidate slots. Written by the slot generator.')
) AS v(collection, note)
WHERE NOT EXISTS (SELECT 1 FROM directus_collections c WHERE c.collection = v.collection);

-- ── basketball_team_rules fields ──
INSERT INTO directus_fields (collection, field, special, interface, display, sort, width, note, readonly, hidden)
SELECT 'basketball_team_rules', v.field, v.special, v.interface, v.display, v.sort, v.width, v.note, false, false
FROM (VALUES
  ('season',           'm2o',          'select-dropdown-m2o', 'related-values',  1, 'half', 'Game-scheduling season (shared, sport-neutral identity).'),
  ('team',             'm2o',          'select-dropdown-m2o', 'related-values',  2, 'half', 'Basketball team (teams.sport = basketball).')
) AS v(field, special, interface, display, sort, width, note)
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields f WHERE f.collection = 'basketball_team_rules' AND f.field = v.field
);

INSERT INTO directus_fields (collection, field, special, interface, sort, width, note, readonly, hidden)
SELECT 'basketball_team_rules', v.field, v.special, v.interface, v.sort, v.width, v.note, false, false
FROM (VALUES
  ('enabled',          'cast-boolean', 'boolean',            3,  'half', 'Generate slots for this team.'),
  ('category',         NULL,           'select-dropdown',    4,  'half', 'seniors | youth | u18 — joins the club timeslot matrix.'),
  ('league',           NULL,           'select-dropdown',    5,  'half', 'ProBasket league code — decides the availability-grid window. Never read teams.league.'),
  ('ferien_hard',      'cast-boolean', 'boolean',            6,  'half', 'Ferien blackouts hard-block this team (interregional + 1./2. Seniorenliga).'),
  ('allowed_dows',     'cast-json',    'input-code',         7,  'half', 'HARD allow-list of JS getDay values (5=Fri, 6=Sat, 0=Sun).'),
  ('preferred_dows',   'cast-json',    'input-code',         8,  'half', 'SOFT weekday preference (scored, never filtered).'),
  ('start_min',        NULL,           'input',              9,  'half', 'Earliest tip-off HH:MM (inclusive).'),
  ('start_max',        NULL,           'input',              10, 'half', 'Latest tip-off HH:MM (inclusive).'),
  ('start_hard',       'cast-boolean', 'boolean',            11, 'half', 'Start window is a hard filter (else a soft penalty).'),
  ('halls',            'cast-json',    'input-code',         12, 'full', '{"hard":bool,"tiers":[{"rank","options","last_resort"}]}'),
  ('own_back_to_back', 'cast-boolean', 'boolean',            13, 'half', 'May sit next to one of this team''s OWN games the same day.'),
  ('blocked',          'cast-json',    'input-code',         14, 'full', 'Blocked-date RULES (before_date | school_holidays | date_range).'),
  ('note',             NULL,           'input-multiline',    15, 'full', 'Remark.')
) AS v(field, special, interface, sort, width, note)
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields f WHERE f.collection = 'basketball_team_rules' AND f.field = v.field
);

INSERT INTO directus_fields (collection, field, special, interface, display, sort, width, note, readonly, hidden)
SELECT 'basketball_team_rules', 'created_by', 'm2o', 'select-dropdown-m2o', 'related-values', 16, 'half',
       'Member who last set this row (actor).', false, false
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'basketball_team_rules' AND field = 'created_by'
);

INSERT INTO directus_fields (collection, field, special, interface, sort, width, readonly, hidden)
SELECT 'basketball_team_rules', v.field, v.special, 'datetime', v.sort, 'full', true, true
FROM (VALUES ('date_created', 'date-created', 90), ('date_updated', 'date-updated', 91)) AS v(field, special, sort)
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields f WHERE f.collection = 'basketball_team_rules' AND f.field = v.field
);

-- ── basketball_slots fields ──
INSERT INTO directus_fields (collection, field, special, interface, display, sort, width, note, readonly, hidden)
SELECT 'basketball_slots', v.field, 'm2o', 'select-dropdown-m2o', 'related-values', v.sort, 'half', v.note, false, false
FROM (VALUES
  ('season',    1,  'Game-scheduling season.'),
  ('kscw_team', 2,  'KSCW basketball team this candidate slot is offered to.')
) AS v(field, sort, note)
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields f WHERE f.collection = 'basketball_slots' AND f.field = v.field
);

INSERT INTO directus_fields (collection, field, special, interface, sort, width, note, readonly, hidden)
SELECT 'basketball_slots', v.field, v.special, v.interface, v.sort, v.width, v.note, v.readonly, false
FROM (VALUES
  ('date',           NULL,        'input',           3,  'half', 'Candidate home date (Fri/Sat/Sun).',                       false),
  ('time',           NULL,        'input',           4,  'half', 'Tip-off HH:MM.',                                            false),
  ('end_time',       NULL,        'input',           5,  'half', 'Tip-off + 2h.',                                             false),
  ('hall',           NULL,        'select-dropdown', 6,  'half', 'KWI A | KWI B | KWI C | KWI A+B.',                          false),
  ('status',         NULL,        'select-dropdown', 7,  'half', 'available | placed | blocked.',                             false),
  ('source',         NULL,        'select-dropdown', 8,  'half', 'generated (rewritten each run) | manual (never touched).',  false),
  ('score',          NULL,        'input',           9,  'half', 'Soft ranking — higher is better.',                          true),
  ('score_reasons',  'cast-json', 'input-code',      10, 'full', '[{code,delta}] — why this slot scored what it scored.',     true),
  ('generation_run', NULL,        'input',           12, 'half', 'uuid of the generator run that last wrote this row.',       true),
  ('generated_at',   NULL,        'datetime',        13, 'half', 'When the generator last wrote this row.',                   true),
  ('note',           NULL,        'input-multiline', 14, 'full', 'Remark.',                                                   false)
) AS v(field, special, interface, sort, width, note, readonly)
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields f WHERE f.collection = 'basketball_slots' AND f.field = v.field
);

INSERT INTO directus_fields (collection, field, special, interface, display, sort, width, note, readonly, hidden)
SELECT 'basketball_slots', v.field, 'm2o', 'select-dropdown-m2o', 'related-values', v.sort, 'half', v.note, false, false
FROM (VALUES
  ('plan',       11, 'The basketball_slot_plan game occupying this slot (status = placed).'),
  ('created_by', 15, 'Member who hand-added this slot (source = manual).')
) AS v(field, sort, note)
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields f WHERE f.collection = 'basketball_slots' AND f.field = v.field
);

INSERT INTO directus_fields (collection, field, special, interface, sort, width, readonly, hidden)
SELECT 'basketball_slots', v.field, v.special, 'datetime', v.sort, 'full', true, true
FROM (VALUES ('date_created', 'date-created', 90), ('date_updated', 'date-updated', 91)) AS v(field, special, sort)
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields f WHERE f.collection = 'basketball_slots' AND f.field = v.field
);

-- ── Relations ──
INSERT INTO directus_relations (many_collection, many_field, one_collection, one_deselect_action)
SELECT v.many_collection, v.many_field, v.one_collection, 'nullify'
FROM (VALUES
  ('basketball_team_rules', 'season',     'game_scheduling_seasons'),
  ('basketball_team_rules', 'team',       'teams'),
  ('basketball_team_rules', 'created_by', 'members'),
  ('basketball_slots',      'season',     'game_scheduling_seasons'),
  ('basketball_slots',      'kscw_team',  'teams'),
  ('basketball_slots',      'plan',       'basketball_slot_plan'),
  ('basketball_slots',      'created_by', 'members')
) AS v(many_collection, many_field, one_collection)
WHERE NOT EXISTS (
  SELECT 1 FROM directus_relations r
   WHERE r.many_collection = v.many_collection AND r.many_field = v.many_field
);

-- ═══════════════════════════════════════════════════════════════════════════════════════
-- 6. Seed — the 2026/27 constraint matrix.
--
--    Teams are resolved by teams.bb_source_id (the stable Basketplan id), NEVER by name:
--    "Herren 2 H3" plays league H2 and "Herren 3 (Unicorns) H4" plays H4, so every
--    name-based match is wrong. bb_source_id is a varchar, so a mismatch would insert 0
--    rows SILENTLY — the assertion at the end of this section fails loudly instead.
--
--    ⚠ NINE of the sheet's ELEVEN teams are seeded. The two DU18 rows are DELIBERATELY
--      LEFT OUT and this is not an oversight:
--        · the sheet identifies them as "DU18 Spark (1x)" and "DU18 Fire (2x)"; neither
--          nickname exists in the DB, in the ProBasket register (which says "DU18 A"/
--          "DU18 B"), or anywhere else — three naming systems, zero overlap;
--        · the two team_links rows already on prod pair them the OPPOSITE way round from
--          the sheet, so one of the two sources is wrong and we do not know which;
--        · bb_source_id 7182 (locally labelled "2xDU18") has since been established to be
--          the DU16 squad, and "KSC Wiedikon DU18 B" has no teams row and no known
--          Basketplan id at all.
--      A wrong mapping here decides which squad's name lands on which ProBasket sheet, so
--      it is not guessable. The ABSENCE of a rules row is the documented "not slot-
--      generated" state, so both squads simply do not appear in the generated inventory and
--      the settings UI shows them as un-configured — visible, not silently wrong.
--      TO RESOLVE: ask the sheet author to write the 1x/2x name (or the teams.id) next to
--      each DU18 cross-reference, then add the two rows here in a NEW migration.
--
--    Column readings taken from the sheet, all documented in the column COMMENTs above:
--      "start after 1.30"  -> start_min '13:30' inclusive
--      "start before 1.30" -> start_max '13:30' inclusive
--      "weekends"          -> allowed_dows [6,0]   (Friday excluded — hard)
--      "home friday"       -> preferred_dows [5]   (soft; allowed_dows stays [5,6,0])
--      "until oct"         -> before_date 2026-10-01 (the NARROW reading — see the risk note
--                             in the endpoint; "through 31.10" would delete five more of the
--                             thirteen Vorrunde weekends AND collide with the club's own
--                             desired 26/27.09 Spielsamstag)
--      "holidays and weekend before" -> school_holidays rule, ZH, include_weekend_before
-- ═══════════════════════════════════════════════════════════════════════════════════════
INSERT INTO public.basketball_team_rules
  (season, team, category, league, ferien_hard, allowed_dows, preferred_dows,
   start_min, start_max, start_hard, halls, own_back_to_back, blocked, note)
SELECT s.id, t.id, v.category, v.league, v.ferien_hard,
       v.allowed_dows::jsonb, v.preferred_dows::jsonb,
       v.start_min, v.start_max, true, v.halls::jsonb, v.own_back_to_back, v.blocked::jsonb, v.note
FROM (VALUES
  -- Lions D1 — 1. Liga Interregional, so Ferien are HARD. "A+B (hard)" = no fallback hall.
  ('4445', 'seniors', 'D1LI', true,  '[5,6,0]', '[]',  '13:30', NULL,
   '{"hard": true, "tiers": [{"rank": 1, "options": ["KWI A+B"]}]}', false,
   '[{"kind": "before_date", "date": "2026-10-01", "reason": "until_oct"}]',
   'Lions (D1) — constraint sheet 2026/27.'),
  -- Rhinos — the sheet writes "Rhinos (D2)"; ProBasket registered "KSC Wiedikon Rhinos D3"
  -- in Damen 3. Liga and no KSCW women's D2 team exists in any season. 3. Liga -> Ferien soft.
  ('1077', 'seniors', 'D3LR', false, '[5,6,0]', '[]',  '13:30', NULL,
   '{"hard": false, "tiers": [{"rank": 1, "options": ["KWI A+B"]}, {"rank": 2, "options": ["KWI A", "KWI B"]}]}', false,
   '[{"kind": "before_date", "date": "2026-10-01", "reason": "until_oct"}]',
   'Rhinos — the sheet labels it "Rhinos (D2)"; the registered team is Rhinos D3 (Damen 3. Liga).'),
  -- DU14 — youth: "start before 1.30", holidays blocked, KWI C tolerated as a last resort.
  ('5441', 'youth',   'JUN_REG', false, '[5,6,0]', '[]', NULL, '13:30',
   '{"hard": false, "tiers": [{"rank": 1, "options": ["KWI A+B"]}, {"rank": 2, "options": ["KWI A", "KWI B"]}, {"rank": 3, "options": ["KWI C"], "last_resort": true}]}', true,
   '[{"kind": "school_holidays", "canton": "ZH", "include_weekend_before": true}]',
   'DU14 — constraint sheet 2026/27.'),
  -- Herren 1 — 1. Liga Interregional (Ferien hard). "home friday" is a HOME preference only.
  ('1348', 'seniors', 'H1LI', true,  '[5,6,0]', '[5]', NULL,    NULL,
   '{"hard": true, "tiers": [{"rank": 1, "options": ["KWI A+B"]}]}', false,
   '[]',
   'Herren 1 (H1) — "home friday" is a soft home preference, never an away rule.'),
  -- Herren 2 — the sheet's "H2" is the LEAGUE. teams.name says "Herren 2 H3" and teams.league
  -- says "H3LS"; both are 25/26 leftovers. 2. Seniorenliga -> Ferien HARD.
  ('4829', 'seniors', 'H2LR', true,  '[5,6,0]', '[5]', '13:30', NULL,
   '{"hard": false, "tiers": [{"rank": 1, "options": ["KWI A+B"]}, {"rank": 2, "options": ["KWI A", "KWI B"]}]}', false,
   '[{"kind": "before_date", "date": "2026-10-01", "reason": "until_oct"}]',
   'Sheet row "H2" = the LEAGUE. The teams row is named "Herren 2 H3" (stale) but is registered Herren 2. Liga (H2LRA) for 26/27.'),
  -- Herren 3 (Unicorns) — the sheet's "H4" is the LEAGUE; same trap inverted. 4. Liga -> soft.
  ('7183', 'seniors', 'H4LR', false, '[5,6,0]', '[]',  '13:30', NULL,
   '{"hard": false, "tiers": [{"rank": 1, "options": ["KWI A+B"]}, {"rank": 2, "options": ["KWI A", "KWI B"]}]}', false,
   '[{"kind": "before_date", "date": "2026-10-01", "reason": "until_oct"}]',
   'Sheet row "H4" = the LEAGUE; the teams row is "Herren 3 (Unicorns) H4".'),
  ('5789', 'u18',     'JUN_REG', false, '[6,0]', '[]',  NULL,    NULL,
   '{"hard": false, "tiers": [{"rank": 1, "options": ["KWI A+B"]}, {"rank": 2, "options": ["KWI A", "KWI B"]}]}', true,
   '[{"kind": "school_holidays", "canton": "ZH", "include_weekend_before": true}]',
   'HU18 — constraint sheet 2026/27.'),
  ('5498', 'youth',   'JUN_REG', false, '[6,0]', '[]',  NULL,    NULL,
   '{"hard": false, "tiers": [{"rank": 1, "options": ["KWI A+B"]}, {"rank": 2, "options": ["KWI A", "KWI B"]}]}', true,
   '[{"kind": "school_holidays", "canton": "ZH", "include_weekend_before": true}]',
   'HU16 — constraint sheet 2026/27.'),
  ('5790', 'youth',   'JUN_REG', false, '[5,6,0]', '[]', NULL,   '13:30',
   '{"hard": false, "tiers": [{"rank": 1, "options": ["KWI A+B"]}, {"rank": 2, "options": ["KWI A", "KWI B"]}, {"rank": 3, "options": ["KWI C"], "last_resort": true}]}', true,
   '[{"kind": "school_holidays", "canton": "ZH", "include_weekend_before": true}]',
   'HU14 — constraint sheet 2026/27.')
) AS v(bb_source_id, category, league, ferien_hard, allowed_dows, preferred_dows,
       start_min, start_max, halls, own_back_to_back, blocked, note)
JOIN public.teams t
  ON t.bb_source_id = v.bb_source_id AND t.sport = 'basketball' AND t.active IS TRUE
JOIN public.game_scheduling_seasons s
  ON s.season = '2026/27'
ON CONFLICT (season, team) DO NOTHING;

-- Club-level config for 2026/27. Only written while still the '{}' default, so a
-- hand-edited config is never clobbered by a re-run of this migration.
--
-- Timeslot matrix, verbatim from the sheet's Timeslots block:
--   Fri 20:00 "Seniors (youth, U18 only)"  Sat 11:00 "youth"   Sat 13:30 "youth, Seniors"
--   Sat 16:00 "Seniors (youth)"            Sat 18:30 "Seniors" Sun 10:00 "youth"
--   Sun 12:30 "youth, Seniors"             Sun 15:00 "Seniors (youth)"
-- READING (stated because the sheet is ambiguous — see the endpoint's followups):
--   · a BARE category is `allow` — the slot is meant for it;
--   · a PARENTHESISED category is `tolerate` — permitted, but scored lower than an `allow`
--     team, so the generator only reaches for it when nothing better fits;
--   · "U18 only" on Friday is a HARD exclusion of the younger youth teams: Friday 20:00
--     tolerates u18 and nothing else, so HU16/HU14/DU14 can never be generated into it;
--   · "youth" without a qualifier includes u18 (the sheet only separates them where it says
--     "U18 only"), hence allow: ["youth","u18"].
--
-- Spielsamstage: `given` = volleyball has already booked KWI that weekend (an observation
-- about game_scheduling_slots, not a wish). 13/14.4 and 10/11.5 from the sheet's Desired
-- column are OMITTED: 2027-04-13 is a Tuesday and 2027-05-10 a Monday, so neither is a
-- weekend and the intended dates are unknowable. The sheet's malformed "12./-12" cell is
-- read as 12.12.2026, the Saturday whose KWI slots volleyball has actually booked.
UPDATE public.game_scheduling_seasons
   SET bb_slot_config = '{
  "version": 1,
  "timeslots": [
    { "dow": 5, "time": "20:00", "allow": ["seniors"],                    "tolerate": ["u18"] },
    { "dow": 6, "time": "11:00", "allow": ["youth", "u18"],               "tolerate": [] },
    { "dow": 6, "time": "13:30", "allow": ["youth", "u18", "seniors"],    "tolerate": [] },
    { "dow": 6, "time": "16:00", "allow": ["seniors"],                    "tolerate": ["youth", "u18"] },
    { "dow": 6, "time": "18:30", "allow": ["seniors"],                    "tolerate": [] },
    { "dow": 0, "time": "10:00", "allow": ["youth", "u18"],               "tolerate": [] },
    { "dow": 0, "time": "12:30", "allow": ["youth", "u18", "seniors"],    "tolerate": [] },
    { "dow": 0, "time": "15:00", "allow": ["seniors"],                    "tolerate": ["youth", "u18"] }
  ],
  "spielsamstage": [
    { "date": "2026-11-07", "status": "given",    "note": "Volleyball has booked KWI that weekend" },
    { "date": "2026-11-14", "status": "given",    "note": "Volleyball has booked KWI that weekend" },
    { "date": "2026-12-12", "status": "given",    "note": "Volleyball has booked KWI that weekend" },
    { "date": "2027-01-30", "status": "given",    "note": "Volleyball has booked KWI that weekend" },
    { "date": "2027-02-13", "status": "given",    "note": "Volleyball has booked KWI that weekend" },
    { "date": "2026-09-26", "status": "desired" },
    { "date": "2026-11-28", "status": "desired" },
    { "date": "2027-01-23", "status": "desired" },
    { "date": "2027-04-03", "status": "desired" },
    { "date": "2026-12-05", "status": "fraglich" }
  ]
}'::jsonb
 WHERE season = '2026/27' AND bb_slot_config = '{}'::jsonb;

-- ═══════════════════════════════════════════════════════════════════════════════════════
-- 7. Assert the seed actually landed.
--    The seed JOINs on a varchar bb_source_id, so a renamed/recreated team row makes the
--    JOIN miss and inserts ZERO rows without any error. Fail loudly instead of shipping an
--    empty matrix that would silently generate no slots at all.
-- ═══════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  expected constant integer := 9;   -- 11 sheet teams minus the 2 unresolved DU18 squads
  seeded   integer;
  seasons  integer;
BEGIN
  SELECT count(*) INTO seasons FROM public.game_scheduling_seasons WHERE season = '2026/27';
  IF seasons = 0 THEN
    RAISE NOTICE 'migration 278: no 2026/27 season row — constraint matrix not seeded (expected on a fresh install).';
    RETURN;
  END IF;

  SELECT count(*) INTO seeded
    FROM public.basketball_team_rules r
    JOIN public.game_scheduling_seasons s ON s.id = r.season
   WHERE s.season = '2026/27';

  IF seeded <> expected THEN
    RAISE EXCEPTION
      'migration 278: expected % basketball_team_rules rows for 2026/27, found %. The seed joins teams on the varchar bb_source_id (4445, 1077, 5441, 1348, 4829, 7183, 5789, 5498, 5790) with sport=''basketball'' AND active — check those team rows before re-running.',
      expected, seeded;
  END IF;

  RAISE NOTICE 'migration 278: % basketball_team_rules rows seeded for 2026/27 (the 2 DU18 squads are intentionally absent).', seeded;
END $$;

COMMIT;
