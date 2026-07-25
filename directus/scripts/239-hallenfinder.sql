-- Migration 239 — Hallenfinder: cached Stadt-Zürich external hall availability.
--
-- The club hunts for free training slots in City of Zürich sport halls every
-- season. The city's search tool (ssd-sporthallen.stadt-zuerich.ch) has no API
-- and can't be called from the browser (no CORS), so a nightly script scrapes it
-- (single-date "freie Termine" queries, Mon–Fri 18:00–22:00, min 1 h) and caches
-- the result here. The wiedisync /kscw/hallenfinder/search endpoint reads these
-- tables and derives "free every non-Schulferien week" for any weekday / start /
-- duration filter the UI asks for.
--
-- Like sync_runs (045), these tables are PRIVATE: only supabase_admin (the scrape
-- via psql) writes, and Members read exclusively through the role-gated custom
-- endpoint — never via Directus collection permissions. So there is deliberately
-- NO entry in setup-permissions.mjs and no directus_collections registration.
--
-- Schema-only + idempotent.

CREATE TABLE IF NOT EXISTS city_halls (
  einrichtung_id integer      PRIMARY KEY,          -- stable id from the city tool
  name           text         NOT NULL,
  hall_type      text,                              -- 'gymnastikraum' | 'sporthalle' | …
  address        text,
  plz            text,
  stadtkreis     text,                              -- "11"
  stadtquartier  text,                              -- "Seebach"
  schulkreis     text,                              -- "Glattal"
  first_seen     timestamptz  NOT NULL DEFAULT NOW(),
  last_seen      timestamptz  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE city_halls IS
  'Roster of City of Zürich sport halls seen in the Hallenfinder scrape. Private — read via /kscw/hallenfinder/search only.';

-- One row per (hall, weekday) for one scraped season. `dates` holds the per-week
-- outcome so the endpoint can derive any start-time / min-duration / "all
-- non-holiday weeks" filter without re-scraping:
--   [{ "date":"2026-09-01", "free":true, "holiday":false, "window":"18:00-22:00" }, …]
CREATE TABLE IF NOT EXISTS city_hall_availability (
  einrichtung_id     integer   NOT NULL REFERENCES city_halls(einrichtung_id) ON DELETE CASCADE,
  weekday            smallint  NOT NULL CHECK (weekday BETWEEN 1 AND 7),   -- 1=Mon … 7=Sun
  season_start       date      NOT NULL,
  season_end         date      NOT NULL,
  scrape_window_from text      NOT NULL,            -- "18:00"
  scrape_window_to   text      NOT NULL,            -- "22:00"
  scrape_min_minutes integer   NOT NULL,            -- 60
  dates              jsonb     NOT NULL DEFAULT '[]'::jsonb,
  scraped_at         timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (einrichtung_id, weekday, season_start, season_end)
);

COMMENT ON TABLE city_hall_availability IS
  'Per (hall, weekday) cached free/holiday outcome per week for one season. Private — read via /kscw/hallenfinder/search only.';

CREATE INDEX IF NOT EXISTS city_hall_availability_weekday_idx
  ON city_hall_availability (weekday, season_start, season_end);

-- Direct DB grants only. supabase_admin writes (scrape via psql); the endpoint
-- reads with the same role. No PUBLIC / anon / authenticated access.
REVOKE ALL ON city_halls            FROM PUBLIC;
REVOKE ALL ON city_halls            FROM anon, authenticated;
REVOKE ALL ON city_hall_availability FROM PUBLIC;
REVOKE ALL ON city_hall_availability FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON city_halls            TO supabase_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON city_hall_availability TO supabase_admin;

-- Track the nightly cron on /status like the other syncs (045 + logCronRun()).
INSERT INTO sync_runs (source, last_run_at, status) VALUES
  ('hallenfinder_sync', '1970-01-01T00:00:00Z', 'ok')
ON CONFLICT (source) DO NOTHING;
