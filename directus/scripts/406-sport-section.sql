-- Migration 406: a stored sport section on members and events (2026-10-11 audit, M7).
--
-- WHY
-- ---
-- A board member or sport admin below full admin is confined to one sport
-- (vb_admin / bb_admin, member-sport.js `sportAdminScope`). Until now only the UI
-- and a few hooks knew that: the `KSCW Sport Admin` policy granted club-wide rows,
-- because one policy serves vb_admin and bb_admin alike and nothing on a member
-- row says which section it belongs to. Owner decision 12.10.2026: enforce it on
-- the server. setup-permissions.mjs now gives each section its own per-user policy
-- (`KSCW Sport Admin VB` / `BB`) whose row filters read the columns added here.
--
-- A member's section is derived (member-sport.js): the sports of every team they
-- are attached to in any capacity — roster, coach, team responsible — then
-- `sektion`, then the fee-category prefix, else 'both'. Policy filters cannot run
-- that rule, and walking `member_teams` from a policy is the M2M deep-filter trap
-- (CLAUDE.md: a frontend filter through the same junction returns [] silently).
-- So the answer is stored, and a policy filter becomes a scalar or an M2O hop:
--   members:  { sport_section: { _in: ['volleyball', 'both'] } }
--   absences: { member: { sport_section: { _in: [...] } } }
-- `events` get the same column for the same reason (their teams are an M2M).
--
-- WHAT CHANGES
-- ------------
--   members.sport_section, events.sport_section — 'volleyball' | 'basketball' |
--   'both', NOT NULL, default 'both'. Kept by triggers, never by a client:
--     - BEFORE INSERT OR UPDATE on members / events recomputes the row's value,
--       so a value sent through /items is overwritten whatever the field grants say.
--     - AFTER INSERT/UPDATE/DELETE on member_teams, teams_coaches,
--       teams_responsibles (members) and events_teams (events) recompute the
--       rows they touch; AFTER UPDATE OF sport on teams recomputes every member
--       and event linked to that team.
--   kscw_member_sport_section() is the SQL twin of member-sport.js
--   `sportFromPartsDetailed` (answers only). resolveMemberSports() reads the
--   stored column, so the policy rows, the read-privacy hook and the endpoint
--   gates all decide on the same value. Change the rule in both places.
--   Both fields are registered hidden + readonly in directus_fields. Restart the
--   container after this migration (a raw directus_fields insert does not bust
--   the schema cache) and BEFORE `db:setup-perms`, whose filters name the field.
--
-- Schema-only + idempotent, per the migration policy. No permission rows.

BEGIN;

-- ── 1. Columns ───────────────────────────────────────────────────────────────

ALTER TABLE members ADD COLUMN IF NOT EXISTS sport_section text NOT NULL DEFAULT 'both';
ALTER TABLE events  ADD COLUMN IF NOT EXISTS sport_section text NOT NULL DEFAULT 'both';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'members_sport_section_check') THEN
    ALTER TABLE members ADD CONSTRAINT members_sport_section_check
      CHECK (sport_section IN ('volleyball', 'basketball', 'both'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_sport_section_check') THEN
    ALTER TABLE events ADD CONSTRAINT events_sport_section_check
      CHECK (sport_section IN ('volleyball', 'basketball', 'both'));
  END IF;
END $$;

-- ── 2. The rule ──────────────────────────────────────────────────────────────

-- member-sport.js sportFromPartsDetailed, answers only. Every team the member is
-- attached to, in any capacity, of any season: one real sport → that sport, two →
-- 'both'. No team with a real sport → `sektion`, then the 'VB ' / 'BB ' fee
-- prefix, then 'both'. `teams.sport` is lowercased but not trimmed, like
-- normalizeSport(); sektion and fee are trimmed and lowercased, like the JS.
CREATE OR REPLACE FUNCTION kscw_member_sport_section(p_member integer, p_sektion text, p_fee text)
RETURNS text
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH sports AS (
    SELECT DISTINCT lower(t.sport) AS sport
    FROM (
      SELECT team AS team_id FROM member_teams WHERE member = p_member
      UNION ALL
      SELECT teams_id FROM teams_coaches WHERE members_id = p_member
      UNION ALL
      SELECT teams_id FROM teams_responsibles WHERE members_id = p_member
    ) links
    JOIN teams t ON t.id = links.team_id
    WHERE lower(t.sport) IN ('volleyball', 'basketball')
  ), n AS (SELECT count(*) AS c, min(sport) AS only FROM sports)
  SELECT CASE
    WHEN n.c > 1 THEN 'both'
    WHEN n.c = 1 THEN n.only
    WHEN lower(btrim(coalesce(p_sektion, ''), E' \t\r\n')) = 'volleyball' THEN 'volleyball'
    WHEN lower(btrim(coalesce(p_sektion, ''), E' \t\r\n')) = 'basketball' THEN 'basketball'
    WHEN left(lower(btrim(coalesce(p_fee, ''), E' \t\r\n')), 3) = 'vb ' THEN 'volleyball'
    WHEN left(lower(btrim(coalesce(p_fee, ''), E' \t\r\n')), 3) = 'bb ' THEN 'basketball'
    ELSE 'both'
  END
  FROM n
$$;

-- An event's section: the sports of its teams. No team (a club event) or teams of
-- both sports → 'both'.
CREATE OR REPLACE FUNCTION kscw_event_sport_section(p_event integer)
RETURNS text
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH sports AS (
    SELECT DISTINCT lower(t.sport) AS sport
    FROM events_teams et
    JOIN teams t ON t.id = et.teams_id
    WHERE et.events_id = p_event
      AND lower(t.sport) IN ('volleyball', 'basketball')
  ), n AS (SELECT count(*) AS c, min(sport) AS only FROM sports)
  SELECT CASE WHEN n.c = 1 THEN n.only ELSE 'both' END FROM n
$$;

-- ── 3. Row triggers on the owning tables ─────────────────────────────────────

CREATE OR REPLACE FUNCTION trg_members_sport_section() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.sport_section := kscw_member_sport_section(NEW.id, NEW.sektion, NEW.beitragskategorie);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_members_sport_section ON members;
CREATE TRIGGER trg_members_sport_section
  BEFORE INSERT OR UPDATE ON members
  FOR EACH ROW EXECUTE FUNCTION trg_members_sport_section();

CREATE OR REPLACE FUNCTION trg_events_sport_section() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.sport_section := kscw_event_sport_section(NEW.id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_events_sport_section ON events;
CREATE TRIGGER trg_events_sport_section
  BEFORE INSERT OR UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION trg_events_sport_section();

-- ── 4. Recompute when a link or a team's sport changes ───────────────────────

-- Touch only rows whose value actually moves: the members BEFORE trigger above
-- recomputes again, and an unchanged row gets no new version.
CREATE OR REPLACE FUNCTION kscw_refresh_member_sport_section(p_members integer[]) RETURNS void
LANGUAGE sql
SET search_path = public
AS $$
  UPDATE members m
  SET sport_section = kscw_member_sport_section(m.id, m.sektion, m.beitragskategorie)
  WHERE m.id = ANY(p_members)
    AND m.sport_section IS DISTINCT FROM kscw_member_sport_section(m.id, m.sektion, m.beitragskategorie)
$$;

CREATE OR REPLACE FUNCTION kscw_refresh_event_sport_section(p_events integer[]) RETURNS void
LANGUAGE sql
SET search_path = public
AS $$
  UPDATE events e
  SET sport_section = kscw_event_sport_section(e.id)
  WHERE e.id = ANY(p_events)
    AND e.sport_section IS DISTINCT FROM kscw_event_sport_section(e.id)
$$;

-- member_teams links by `member`; the two staff junctions by `members_id`.
CREATE OR REPLACE FUNCTION trg_member_link_sport_section() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  ids integer[] := ARRAY[]::integer[];
BEGIN
  IF TG_TABLE_NAME = 'member_teams' THEN
    IF TG_OP <> 'INSERT' THEN ids := ids || OLD.member; END IF;
    IF TG_OP <> 'DELETE' THEN ids := ids || NEW.member; END IF;
  ELSE
    IF TG_OP <> 'INSERT' THEN ids := ids || OLD.members_id; END IF;
    IF TG_OP <> 'DELETE' THEN ids := ids || NEW.members_id; END IF;
  END IF;
  PERFORM kscw_refresh_member_sport_section(ids);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_member_teams_sport_section ON member_teams;
CREATE TRIGGER trg_member_teams_sport_section
  AFTER INSERT OR UPDATE OF member, team OR DELETE ON member_teams
  FOR EACH ROW EXECUTE FUNCTION trg_member_link_sport_section();

DROP TRIGGER IF EXISTS trg_teams_coaches_sport_section ON teams_coaches;
CREATE TRIGGER trg_teams_coaches_sport_section
  AFTER INSERT OR UPDATE OF members_id, teams_id OR DELETE ON teams_coaches
  FOR EACH ROW EXECUTE FUNCTION trg_member_link_sport_section();

DROP TRIGGER IF EXISTS trg_teams_responsibles_sport_section ON teams_responsibles;
CREATE TRIGGER trg_teams_responsibles_sport_section
  AFTER INSERT OR UPDATE OF members_id, teams_id OR DELETE ON teams_responsibles
  FOR EACH ROW EXECUTE FUNCTION trg_member_link_sport_section();

CREATE OR REPLACE FUNCTION trg_events_teams_sport_section() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  ids integer[] := ARRAY[]::integer[];
BEGIN
  IF TG_OP <> 'INSERT' THEN ids := ids || OLD.events_id; END IF;
  IF TG_OP <> 'DELETE' THEN ids := ids || NEW.events_id; END IF;
  PERFORM kscw_refresh_event_sport_section(ids);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_events_teams_sport_section ON events_teams;
CREATE TRIGGER trg_events_teams_sport_section
  AFTER INSERT OR UPDATE OF events_id, teams_id OR DELETE ON events_teams
  FOR EACH ROW EXECUTE FUNCTION trg_events_teams_sport_section();

CREATE OR REPLACE FUNCTION trg_teams_sport_section() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM kscw_refresh_member_sport_section(ARRAY(
    SELECT member FROM member_teams WHERE team = NEW.id
    UNION SELECT members_id FROM teams_coaches WHERE teams_id = NEW.id
    UNION SELECT members_id FROM teams_responsibles WHERE teams_id = NEW.id));
  PERFORM kscw_refresh_event_sport_section(ARRAY(
    SELECT events_id FROM events_teams WHERE teams_id = NEW.id));
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_teams_sport_section ON teams;
CREATE TRIGGER trg_teams_sport_section
  AFTER UPDATE OF sport ON teams
  FOR EACH ROW WHEN (OLD.sport IS DISTINCT FROM NEW.sport)
  EXECUTE FUNCTION trg_teams_sport_section();

-- ── 5. Backfill ──────────────────────────────────────────────────────────────

UPDATE members m
SET sport_section = kscw_member_sport_section(m.id, m.sektion, m.beitragskategorie)
WHERE m.sport_section IS DISTINCT FROM kscw_member_sport_section(m.id, m.sektion, m.beitragskategorie);

UPDATE events e
SET sport_section = kscw_event_sport_section(e.id)
WHERE e.sport_section IS DISTINCT FROM kscw_event_sport_section(e.id);

-- ── 6. Directus field registration (read-only, hidden) ───────────────────────

INSERT INTO directus_fields (collection, field, interface, readonly, hidden, width, note)
SELECT 'members', 'sport_section', 'input', true, true, 'half',
  'Derived (migration 406): volleyball | basketball | both. Kept by triggers; writes are ignored.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'members' AND field = 'sport_section');

INSERT INTO directus_fields (collection, field, interface, readonly, hidden, width, note)
SELECT 'events', 'sport_section', 'input', true, true, 'half',
  'Derived (migration 406): the sport of the event''s teams, or both. Kept by triggers; writes are ignored.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'events' AND field = 'sport_section');

COMMIT;
