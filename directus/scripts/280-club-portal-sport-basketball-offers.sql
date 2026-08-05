-- Migration 280: one club-portal table for both sports + the basketball offer
-- lifecycle on basketball_slot_plan.
--
-- ── Part 1: why GENERALISE game_scheduling_club_portals instead of adding a
--    basketball_club_portals table ─────────────────────────────────────────────
-- The migration-213 table is a thin ENVELOPE: (season, club) → token, status,
-- language, contact_name/contact_email, club_note, first_viewed_at, email_sent_at,
-- reminder_sent_at, expires_at. Every one of those columns is sport-agnostic. What
-- is NOT reusable is the ENGINE the envelope currently wraps (clubPortalOpponents /
-- findPortalOpponentByFixture / opponentSvrzFixtures all resolve through
-- svrz_games) — and that engine is not in this table. Adding a `sport`
-- discriminator to a table with 0 rows on prod is therefore the cheap option and
-- keeps ONE token lifecycle, ONE unique index and ONE admin list query.
--
-- ⚠ HONEST STATUS OF THE CODE THIS BUILDS ON: the volleyball club portal has NEVER
-- executed in production. `SELECT count(*) FROM game_scheduling_club_portals` = 0
-- and use_club_portals = false on the only season row (re-verified 05.08.2026).
-- This migration reuses its SHAPE (32-hex token, unique index, status ladder,
-- season-end expiry), which is verifiable by reading migration 213, and does NOT
-- reuse its fixture engine, which is unverified.
--
-- For sport='basketball': club_id carries basketplan_clubs.id AS TEXT and bp_club
-- carries the same value as an integer FK. Keying on our surrogate id rather than
-- the Basketplan clubId is deliberate — clubs are seeded from the ProBasket
-- workbook by NAME (migration 279) and most have no Basketplan id yet, so keying on
-- bp_club_id would block portal minting on an authenticated scrape landing first.
--
-- NO `use_bb_club_portals` ROLLOUT FLAG, ON PURPOSE. The volleyball ensure endpoint
-- refuses with `club_portals_disabled` unless the season sets use_club_portals, and
-- the only place that flag can be flipped is a panel rendered behind
-- `season.status === 'open'` — on prod's single season (2026/27, status='closed')
-- that combination is permanently unreachable. Basketball has no invite-close
-- lifecycle to model in the first place: the gate that matters is
-- basketball_slot_plan.proposal_status ('draft' = invisible to opponents), plus the
-- fact that minting and SENDING are two separate explicit admin calls. Adding a
-- default-false season flag here would ship a permanently disabled button.
--
-- ── Part 2: why the offer lifecycle goes on basketball_slot_plan ──────────────
-- basketball_slot_plan (migration 216) already IS "our available home dates": one
-- row per placed game (season, date, time, hall) with kscw_team + free-text
-- opponent. The only things missing are WHICH CLUB the game is offered to and their
-- ANSWER — which is the entire WSR Art. 18 deliverable:
--   "Einzige Ausnahme ist, wenn die Spiele bis zur Spielplansitzung, im
--    Einverständnis jeweils beider Klubs, abgemacht wurden und bei der
--    Geschäftsstelle vorliegen."  (Einladung Spielplansitzung, 05.09.2026)
-- So no basketball_fixtures table is needed: the placed row IS the proposal. This
-- is why basketball does not need the SVRZ fixture anchor at all.
--
-- responded_by_name / responded_by_email are CLAUDE.md's actor-capture option (b):
-- the portal write is token-authenticated with NO Directus user, so writeUserLog()
-- early-returns by design (activity-log.js:17) and the actor must live on the row.
--
-- Schema-only + idempotent per the CLAUDE.md migration policy. Item permissions live
-- in setup-permissions.mjs, NOT here.
--
-- Depends on: 279 (basketplan_clubs must exist for both FKs). Independent of 278.

BEGIN;

-- ── 1. game_scheduling_club_portals: sport discriminator + lifecycle ─────────
ALTER TABLE public.game_scheduling_club_portals
  ADD COLUMN IF NOT EXISTS sport       varchar(16) NOT NULL DEFAULT 'volleyball',
  ADD COLUMN IF NOT EXISTS bp_club     integer,
  ADD COLUMN IF NOT EXISTS revoked_at  timestamptz,
  ADD COLUMN IF NOT EXISTS reissued_at timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'game_scheduling_club_portals_sport_check') THEN
    ALTER TABLE public.game_scheduling_club_portals
      ADD CONSTRAINT game_scheduling_club_portals_sport_check
      CHECK (sport IN ('volleyball', 'basketball'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'game_scheduling_club_portals_bp_club_fk') THEN
    ALTER TABLE public.game_scheduling_club_portals
      ADD CONSTRAINT game_scheduling_club_portals_bp_club_fk
      FOREIGN KEY (bp_club) REFERENCES public.basketplan_clubs(id) ON DELETE CASCADE;
  END IF;
  -- A basketball portal without its club FK can resolve no offers; a volleyball
  -- portal must never carry one (its club_id lives in the SVRZ id space).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'game_scheduling_club_portals_bp_club_sport_check') THEN
    ALTER TABLE public.game_scheduling_club_portals
      ADD CONSTRAINT game_scheduling_club_portals_bp_club_sport_check
      CHECK (
        (sport = 'basketball' AND bp_club IS NOT NULL)
        OR (sport <> 'basketball' AND bp_club IS NULL)
      );
  END IF;
END $$;

-- Widen the natural key: the same club_id STRING can exist in both the SVRZ and
-- the basketplan_clubs id spaces, so (season, club_id) is no longer unique enough.
-- Prod has 0 rows, so this is a no-op there, but the migration must be correct on
-- any clone that does hold volleyball portals.
ALTER TABLE public.game_scheduling_club_portals
  DROP CONSTRAINT IF EXISTS game_scheduling_club_portals_season_club_unique;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'game_scheduling_club_portals_season_sport_club_unique') THEN
    ALTER TABLE public.game_scheduling_club_portals
      ADD CONSTRAINT game_scheduling_club_portals_season_sport_club_unique
      UNIQUE (season, sport, club_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS game_scheduling_club_portals_season_sport_idx
  ON public.game_scheduling_club_portals (season, sport);

-- The token index already exists from migration 213
-- (game_scheduling_club_portals_token_unique) and stays the single lookup path for
-- BOTH sports — 32 hex chars from crypto.randomBytes(16), globally unique, so a
-- basketball token can never collide with a volleyball one.

COMMENT ON COLUMN public.game_scheduling_club_portals.sport IS
  'volleyball = the SVRZ per-fixture engine (migration 213). basketball = ProBasket pre-agreement on placed basketball_slot_plan rows (migration 280). The two sports have SEPARATE public endpoints (/kscw/terminplanung/club/* vs /kscw/terminplanung/bb/club/*) that each resolve tokens out of this one table.';
COMMENT ON COLUMN public.game_scheduling_club_portals.bp_club IS
  'basketplan_clubs.id for basketball portals (same value as club_id, typed + FK-enforced). NULL for volleyball, whose club_id is an SVRZ club id.';
COMMENT ON COLUMN public.game_scheduling_club_portals.club_id IS
  'Opponent club id. sport=volleyball → SVRZ club id (the non-912530 side of svrz_games). sport=basketball → basketplan_clubs.id as text (NOT the Basketplan clubId, which is often still unknown).';
COMMENT ON COLUMN public.game_scheduling_club_portals.revoked_at IS
  'When an admin killed this link. status is flipped to ''revoked'' at the same time; the token lookup only accepts invited/viewed/booked.';
COMMENT ON COLUMN public.game_scheduling_club_portals.reissued_at IS
  'When the token was last regenerated (new 32-hex token, status reset to invited, first_viewed_at cleared).';

-- ── Directus metadata for the new portal columns ─────────────────────────────
INSERT INTO directus_fields (collection, field, special, interface, sort, width, note)
SELECT 'game_scheduling_club_portals', 'sport', NULL, 'input', 14, 'half',
       'volleyball | basketball. Selects which public endpoint family serves this token.'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'game_scheduling_club_portals' AND field = 'sport'
);

INSERT INTO directus_fields (collection, field, special, interface, display, sort, width, note)
SELECT 'game_scheduling_club_portals', 'bp_club', 'm2o', 'select-dropdown-m2o', 'related-values', 15, 'half',
       'Basketball opponent club (basketplan_clubs).'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'game_scheduling_club_portals' AND field = 'bp_club'
);

INSERT INTO directus_fields (collection, field, special, interface, sort, width)
SELECT 'game_scheduling_club_portals', v.field, NULL, 'datetime', v.sort, 'half'
FROM (VALUES ('revoked_at', 16), ('reissued_at', 17)) AS v(field, sort)
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields f
  WHERE f.collection = 'game_scheduling_club_portals' AND f.field = v.field
);

INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'game_scheduling_club_portals', 'bp_club', 'basketplan_clubs', NULL, NULL, NULL, NULL, NULL, 'delete'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_relations
  WHERE many_collection = 'game_scheduling_club_portals' AND many_field = 'bp_club'
);

-- ── 2. basketball_slot_plan: the offer/response lifecycle ────────────────────
ALTER TABLE public.basketball_slot_plan
  ADD COLUMN IF NOT EXISTS opponent_club      integer,
  ADD COLUMN IF NOT EXISTS proposal_status    varchar(16) NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS offered_at         timestamptz,
  ADD COLUMN IF NOT EXISTS responded_at       timestamptz,
  ADD COLUMN IF NOT EXISTS responded_by_name  text,
  ADD COLUMN IF NOT EXISTS responded_by_email text,
  ADD COLUMN IF NOT EXISTS opponent_note      text,
  ADD COLUMN IF NOT EXISTS counter_proposals  jsonb;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'basketball_slot_plan_opponent_club_fk') THEN
    ALTER TABLE public.basketball_slot_plan
      ADD CONSTRAINT basketball_slot_plan_opponent_club_fk
      FOREIGN KEY (opponent_club) REFERENCES public.basketplan_clubs(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'basketball_slot_plan_proposal_status_check') THEN
    ALTER TABLE public.basketball_slot_plan
      ADD CONSTRAINT basketball_slot_plan_proposal_status_check
      CHECK (proposal_status IN ('draft', 'offered', 'accepted', 'declined', 'countered'));
  END IF;
  -- A row can only leave draft once it is addressed to a club — otherwise the
  -- portal payload has nothing to scope on and the offer is unreachable.
  -- ⚠ ON DELETE SET NULL on opponent_club can therefore not fire while a row is
  -- non-draft; deleting a club that still has live offers raises instead of
  -- silently orphaning them. That is the intended behaviour.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'basketball_slot_plan_offer_needs_club_check') THEN
    ALTER TABLE public.basketball_slot_plan
      ADD CONSTRAINT basketball_slot_plan_offer_needs_club_check
      CHECK (proposal_status = 'draft' OR opponent_club IS NOT NULL);
  END IF;
END $$;

-- The portal's hot path: every offer for one club in one season.
CREATE INDEX IF NOT EXISTS basketball_slot_plan_season_oppclub_status_idx
  ON public.basketball_slot_plan (season, opponent_club, proposal_status);

COMMENT ON COLUMN public.basketball_slot_plan.opponent_club IS
  'The opponent CLUB this placed game is offered to (basketplan_clubs). Groups a club''s offers under its single portal. The free-text `opponent` column keeps the TEAM name — display-only, and never a join key against Basketplan, which spells the same team differently from the workbook.';
COMMENT ON COLUMN public.basketball_slot_plan.proposal_status IS
  'draft (internal, INVISIBLE to the opponent) → offered (published to the club portal) → accepted | declined | countered. The public payload filters proposal_status <> ''draft'' — that filter IS the visibility gate, there is no separate boolean.';
COMMENT ON COLUMN public.basketball_slot_plan.responded_by_email IS
  'Who at the opponent club answered. The portal write is token-authenticated with no Directus user, so writeUserLog() cannot record an actor — this pair IS the audit trail (CLAUDE.md → Audit logging, option b).';
COMMENT ON COLUMN public.basketball_slot_plan.counter_proposals IS
  'jsonb array of {date, time} alternatives the opponent suggested when declining. NEVER auto-applied — a KSCW planner re-places the game in the prep grid.';

-- ── Directus metadata for the new slot-plan columns ──────────────────────────
INSERT INTO directus_fields (collection, field, special, interface, display, sort, width, note)
SELECT 'basketball_slot_plan', 'opponent_club', 'm2o', 'select-dropdown-m2o', 'related-values', 11, 'half',
       'Opponent club this game is offered to (basketplan_clubs).'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'basketball_slot_plan' AND field = 'opponent_club'
);

INSERT INTO directus_fields (collection, field, special, interface, sort, width, note)
SELECT 'basketball_slot_plan', v.field, NULL, 'input', v.sort, 'half', v.note
FROM (VALUES
  ('proposal_status',    12, 'draft | offered | accepted | declined | countered.'),
  ('responded_by_name',  15, 'Opponent contact who answered.'),
  ('responded_by_email', 16, 'Opponent contact address (actor capture for the token-authenticated write).')
) AS v(field, sort, note)
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields f
  WHERE f.collection = 'basketball_slot_plan' AND f.field = v.field
);

INSERT INTO directus_fields (collection, field, special, interface, sort, width)
SELECT 'basketball_slot_plan', v.field, NULL, 'datetime', v.sort, 'half'
FROM (VALUES ('offered_at', 13), ('responded_at', 14)) AS v(field, sort)
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields f
  WHERE f.collection = 'basketball_slot_plan' AND f.field = v.field
);

INSERT INTO directus_fields (collection, field, special, interface, sort, width, note)
SELECT 'basketball_slot_plan', 'opponent_note', NULL, 'input-multiline', 17, 'full',
       'Remark the opponent club left on this game.'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'basketball_slot_plan' AND field = 'opponent_note'
);

INSERT INTO directus_fields (collection, field, special, interface, sort, width, note)
SELECT 'basketball_slot_plan', 'counter_proposals', 'cast-json', 'input-code', 18, 'full',
       'Alternative dates the opponent suggested: [{date, time}]. Never auto-applied.'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'basketball_slot_plan' AND field = 'counter_proposals'
);

INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'basketball_slot_plan', 'opponent_club', 'basketplan_clubs', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_relations
  WHERE many_collection = 'basketball_slot_plan' AND many_field = 'opponent_club'
);

COMMIT;
