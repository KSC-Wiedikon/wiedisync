-- Migration 213: Club portal — one opponent link/page per CLUB (not per team).
--
-- Today the opponent scheduling flow is per TEAM: game_scheduling_opponents has
-- one row per (kscw_team, opposing team, season), each with its own token → its
-- own emailed link. A club fielding several teams against several KSCW teams gets
-- several links to (usually) the same coordinator.
--
-- This adds a per-CLUB overlay, gated per season (use_club_portals). The per-team
-- opponent rows stay as the internal booking anchors — bookings, caps, derby
-- clamps and VM push are unchanged. A club portal groups the club's opponent rows
-- by the opponent-side club id from svrz_games (KSCW = 912530) and owns ONE shared
-- token + the club-level contact/language/status. The public /terminplanung/club/
-- :token page fans out to the club's pairings and reuses the per-fixture engine.
--
-- Three parts:
--   1. game_scheduling_opponents.club_id (+ index + backfill + field registration)
--   2. game_scheduling_club_portals (new collection)
--   3. game_scheduling_seasons.use_club_portals (rollout gate; true on 2027/28 only)
--
-- Schema-only + idempotent per the CLAUDE.md migration policy. The public portal
-- endpoints run on the system DB connection and are token-gated in code (like
-- /terminplanung/slots/:token), so item permissions for the readers live in
-- setup-permissions.mjs, NOT here.

BEGIN;

-- ── 1. game_scheduling_opponents.club_id ─────────────────────────────────
ALTER TABLE public.game_scheduling_opponents
  ADD COLUMN IF NOT EXISTS club_id character varying(32);

CREATE INDEX IF NOT EXISTS game_scheduling_opponents_season_club_idx
  ON public.game_scheduling_opponents (season, club_id);

-- Register the field so the items API + admin app read it.
INSERT INTO directus_fields (collection, field, special, interface, sort, width, note)
SELECT 'game_scheduling_opponents', 'club_id', NULL, 'input', 94, 'half',
       'SVRZ opponent club id (svrz_games home/away_club_id, the non-912530 side). Groups a club''s per-team opponent rows under one club portal.'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields f
  WHERE f.collection = 'game_scheduling_opponents' AND f.field = 'club_id'
);

-- Backfill: derive each opponent row's club id from the matching svrz_games
-- fixtures. Match mirrors opponentSvrzFixtures() / migration 105:
--   * season_name = the season's start year ("2026/27" → "2026")
--   * status open/waitingForApproval
--   * KSCW club (912530) on one side, the opponent's team_name on the other
--   * the KSCW side is THIS kscw_team (staticTeamIdentifier from raw JSON vs
--     teams.team_id 'vb_<id>', falling back to the "KSC Wiedikon <name>" label)
-- The opponent's club id is the SAME on both legs, so DISTINCT ON (o.id) with the
-- endpoint's fixture order is enough. Idempotent via "o.club_id IS NULL".
WITH oppclub AS (
  SELECT DISTINCT ON (o.id)
    o.id AS opponent_id,
    CASE WHEN g.home_club_id = '912530' THEN g.away_club_id ELSE g.home_club_id END AS opp_club_id
  FROM public.game_scheduling_opponents o
  JOIN public.game_scheduling_seasons s ON s.id = o.season
  JOIN public.teams t ON t.id = o.kscw_team
  JOIN public.svrz_games g
    ON g.season_name = split_part(s.season, '/', 1)
   AND g.status IN ('open', 'waitingForApproval')
   AND (
         (g.home_club_id = '912530' AND g.away_team_name = o.team_name)
      OR (g.away_club_id = '912530' AND g.home_team_name = o.team_name)
       )
  CROSS JOIN LATERAL (
    SELECT
      CASE WHEN g.home_club_id = '912530'
           THEN g.raw::jsonb -> 'encounter' -> 'teamHome' ->> 'staticTeamIdentifier'
           ELSE g.raw::jsonb -> 'encounter' -> 'teamAway' ->> 'staticTeamIdentifier'
      END AS fixture_sid,
      NULLIF(substring(COALESCE(t.team_id, '') FROM '(\d+)\s*$'), '') AS team_sid,
      CASE WHEN g.home_club_id = '912530' THEN g.home_team_name ELSE g.away_team_name END AS kscw_side_name
  ) m
  WHERE o.team_name IS NOT NULL
    AND o.club_id IS NULL
    AND (
          (m.fixture_sid IS NOT NULL AND m.team_sid IS NOT NULL AND m.fixture_sid = m.team_sid)
       OR (
            (m.fixture_sid IS NULL OR m.team_sid IS NULL)
            AND LOWER(COALESCE(m.kscw_side_name, '')) = LOWER('KSC Wiedikon ' || COALESCE(t.name, ''))
          )
        )
  ORDER BY o.id, g.starting_date_time, g.svrz_persistence_id
)
UPDATE public.game_scheduling_opponents o
SET club_id = oc.opp_club_id
FROM oppclub oc
WHERE o.id = oc.opponent_id
  AND o.club_id IS NULL
  AND oc.opp_club_id IS NOT NULL
  AND oc.opp_club_id <> '';

-- ── 2. game_scheduling_club_portals ──────────────────────────────────────
-- One row per (season, club_id): the shared opponent-facing token + the
-- club-level contact/language/status. A club's per-team opponent rows are grouped
-- to it by the natural key (season, club_id) — no FK on the opponent side, robust
-- to re-import/resync (same soft-reference model as bookings.svrz_game_id).
CREATE TABLE IF NOT EXISTS public.game_scheduling_club_portals (
  id               serial PRIMARY KEY,
  season           integer NOT NULL REFERENCES public.game_scheduling_seasons(id) ON DELETE CASCADE,
  club_id          character varying(32)  NOT NULL,
  club_name        character varying(255),
  token            character varying(255) NOT NULL,
  status           character varying(32)  NOT NULL DEFAULT 'invited',
  language         character varying(5),
  contact_name     text,
  contact_email    text,
  club_note        text,
  first_viewed_at  timestamptz,
  email_sent_at    timestamptz,
  reminder_sent_at timestamptz,
  expires_at       timestamptz,
  created_by_admin boolean NOT NULL DEFAULT true,
  date_created     timestamptz NOT NULL DEFAULT now(),
  date_updated     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT game_scheduling_club_portals_season_club_unique UNIQUE (season, club_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS game_scheduling_club_portals_token_unique
  ON public.game_scheduling_club_portals (token);

COMMENT ON TABLE public.game_scheduling_club_portals IS
  'Per-club opponent scheduling portal. One row per (season, club_id) — the shared token behind /terminplanung/club/:token plus the club-level contact/language/status. Groups the club''s per-team game_scheduling_opponents rows (by season+club_id) so an opponent club gets ONE link covering all its teams vs KSCW. Only minted for seasons with game_scheduling_seasons.use_club_portals = true. Managed via the kscw game-scheduling endpoints (knex); public reads are token-gated in code.';

-- ── Directus admin metadata (visibility/debugging only; item perms in setup-permissions.mjs) ──
INSERT INTO directus_collections (collection, icon, color, "group", sort, archive_field, archive_value, unarchive_value, archive_app_filter)
SELECT 'game_scheduling_club_portals', 'link', '#3e4889', NULL, NULL, NULL, NULL, NULL, true
WHERE NOT EXISTS (SELECT 1 FROM directus_collections WHERE collection = 'game_scheduling_club_portals');

INSERT INTO directus_fields (collection, field, special, interface, display, sort, width, note)
SELECT 'game_scheduling_club_portals', 'season', 'm2o', 'select-dropdown-m2o', 'related-values', 1, 'half', 'Game-scheduling season.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'game_scheduling_club_portals' AND field = 'season');

INSERT INTO directus_fields (collection, field, special, interface, sort, width, note)
SELECT 'game_scheduling_club_portals', v.field, NULL, 'input', v.sort, 'half', v.note
FROM (VALUES
  ('club_id',       2, 'SVRZ opponent club id (the non-912530 side of svrz_games).'),
  ('club_name',     3, 'Opponent club display name.'),
  ('token',         4, 'Shared opponent-facing access token (public /terminplanung/club/:token).'),
  ('status',        5, 'Portal lifecycle: invited → viewed → booked (derived; per-pairing badges remain authoritative).'),
  ('language',      6, 'Club UI language (de/gsw/en/fr/it); propagated to the club''s opponent rows.'),
  ('contact_name',  7, 'Club invite recipient names, comma-joined (union of the club''s team + calendar contacts).'),
  ('contact_email', 8, 'Club invite recipient emails, comma-joined (union of the club''s team + calendar contacts).')
) AS v(field, sort, note)
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields f
  WHERE f.collection = 'game_scheduling_club_portals' AND f.field = v.field
);

INSERT INTO directus_fields (collection, field, special, interface, sort, width, note)
SELECT 'game_scheduling_club_portals', 'club_note', NULL, 'input-multiline', 9, 'full', 'Club-level remark (mirrored to the club''s opponent rows'' opponent_note).'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'game_scheduling_club_portals' AND field = 'club_note');

INSERT INTO directus_fields (collection, field, special, interface, sort, width)
SELECT 'game_scheduling_club_portals', v.field, NULL, 'datetime', v.sort, 'half'
FROM (VALUES
  ('first_viewed_at',  10),
  ('email_sent_at',    11),
  ('reminder_sent_at', 12),
  ('expires_at',       13)
) AS v(field, sort)
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields f
  WHERE f.collection = 'game_scheduling_club_portals' AND f.field = v.field
);

INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'game_scheduling_club_portals', 'date_created', 'date-created', 'datetime', true, true, 90
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'game_scheduling_club_portals' AND field = 'date_created');

INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'game_scheduling_club_portals', 'date_updated', 'date-updated', 'datetime', true, true, 91
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'game_scheduling_club_portals' AND field = 'date_updated');

INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'game_scheduling_club_portals', 'season', 'game_scheduling_seasons', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'game_scheduling_club_portals' AND many_field = 'season');

-- ── 3. game_scheduling_seasons.use_club_portals (rollout gate) ────────────
-- false = the season keeps the per-team link flow verbatim (2026/27). true =
-- portals are minted + the club invite UI is offered (set on 2027/28 only).
ALTER TABLE public.game_scheduling_seasons
  ADD COLUMN IF NOT EXISTS use_club_portals boolean NOT NULL DEFAULT false;

INSERT INTO directus_fields (collection, field, special, interface, sort, width, note)
SELECT 'game_scheduling_seasons', 'use_club_portals', 'cast-boolean', 'boolean', 30, 'half',
       'When true, opponents get ONE link per club (/terminplanung/club/:token) instead of one per team. Set on 2027/28 onward; 2026/27 stays per-team.'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields f
  WHERE f.collection = 'game_scheduling_seasons' AND f.field = 'use_club_portals'
);

COMMIT;
