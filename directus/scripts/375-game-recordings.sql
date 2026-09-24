-- Migration 375: video recordings linked to a game.
--
-- A coach/TR (or an admin) pastes one or more video URLs for a game — the club's
-- own upload, a Swiss Volley TV replay, a YouTube livestream. Several per game
-- (e.g. one per set, or a livestream + a highlights cut), each with its own
-- `show_on_website` toggle:
--   * false (default) → member-only: visible in wiedisync's game modal only.
--   * true            → also served by GET /kscw/public/games/:id/recordings and
--                       shown in kscw.ch's game modal.
--
-- Read and written ONLY through kscw-endpoints (game-recordings.js) — deliberately
-- NOT registered in Directus. The public policy reads `games` via /items, and a
-- per-row "public or not" rule on a child table is exactly what the endpoint
-- enforces server-side; an /items grant would be one more policy row to keep in
-- step with it.
--
-- Schema-only + idempotent, per the migration policy.

BEGIN;

CREATE TABLE IF NOT EXISTS game_recordings (
  id              serial PRIMARY KEY,
  game            integer NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  url             varchar(1000) NOT NULL,
  title           varchar(120),
  show_on_website boolean NOT NULL DEFAULT false,
  sort            integer NOT NULL DEFAULT 0,

  -- Actor capture: written via raw knex, so Directus's revision trail never sees it
  -- (CLAUDE.md → Audit logging).
  created_by_name  varchar(150),
  created_by_email varchar(150),
  date_created     timestamptz NOT NULL DEFAULT now(),
  date_updated     timestamptz NOT NULL DEFAULT now(),

  -- The URL is rendered as an <a href> on the public website. https only, so a
  -- `javascript:` value can never reach an href even if the endpoint check regresses.
  CONSTRAINT game_recordings_url_https CHECK (url ~* '^https://[^[:space:]]+$')
);

COMMENT ON TABLE game_recordings IS
  'Video links for a game. show_on_website=true also publishes them on kscw.ch. '
  'Endpoint-only (kscw-endpoints/game-recordings.js), not registered in Directus.';

CREATE INDEX IF NOT EXISTS idx_game_recordings_game ON game_recordings (game, sort);

COMMIT;
