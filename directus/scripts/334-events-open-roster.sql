-- Migration 334: `events.open_roster` — is this event's audience broader than a
-- single team? Companion to 333, which supplied the join; this supplies the
-- *condition*.
--
-- WHY A SECOND COLUMN. 333 made "you can read the RSVPs of any event you can
-- see" expressible. That rule is too loose: `EVENTS_VISIBLE` opens every
-- verein/tournament event to the whole club so it can appear in everyone's
-- calendar, but plenty of those are one team's day out — "Rämi Turnier" is H3
-- only, "Wetzikon Turnier" one team, and their rosters have no business being
-- club-readable just because the fixture is. Being *listed* club-wide and being
-- *rostered* club-wide are two different questions, and only the first one
-- `EVENTS_VISIBLE` answers.
--
-- So gate the widening on audience breadth, which is the thing that actually
-- broke: an event is open-rostered when it spans more than one team.
--
--   open_roster = (number of invited teams <> 1)
--                 OR (invited_roles is a non-empty array)
--
--   <> 1, not > 1, on purpose. ZERO teams is not "narrow" — it is a club-wide
--   event (Generalversammlung, Mixed-Turnier, Photoday Day 2 all carry no
--   events_teams rows at all), which is the broadest audience there is.
--   ONE team is the only narrow case, and it is exactly the case the existing
--   SAME_TEAM_AS_ME rule already covers completely — every person in a
--   single-team event's audience shares that team, so nothing is missing there
--   and nothing needs to open.
--   Roles force it true even alongside one team: "H3 + every scorer" reaches
--   people who share no team with H3.
--
-- A filter cannot COUNT, so this has to be a stored column. Trigger-maintained
-- from both sides — `events` (invited_roles) and `events_teams` (the count) —
-- never hand-written.
--
-- Schema-only + idempotent. The permission that CONSUMES it lives in
-- setup-permissions.mjs (CLAUDE.md §1), where it reads:
--     { event: { _and: [ { open_roster: true }, EVENTS_VISIBLE ] } }
-- i.e. broad audience AND you can see the event.

BEGIN;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS open_roster boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN events.open_roster IS
  'TRUE when the audience spans more than one team (teams <> 1, or invited_roles non-empty) — such an event shows its full RSVP roster to everyone who can see it. Derived; maintained by trg_events_open_roster + trg_events_teams_open_roster. Never write it by hand.';

CREATE OR REPLACE FUNCTION fn_event_open_roster(p_event integer, p_roles json)
RETURNS boolean AS $$
  SELECT (SELECT count(*) FROM events_teams et WHERE et.events_id = p_event) <> 1
      OR (p_roles IS NOT NULL
          AND json_typeof(p_roles) = 'array'
          AND json_array_length(p_roles) > 0);
$$ LANGUAGE sql STABLE;

-- Side 1: the event itself (invited_roles). BEFORE, so the value is correct in
-- the same row write. NEW.id is already populated on INSERT — column defaults
-- are applied before BEFORE-ROW triggers fire.
CREATE OR REPLACE FUNCTION trg_events_open_roster() RETURNS trigger AS $$
BEGIN
  NEW.open_roster := fn_event_open_roster(NEW.id, NEW.invited_roles);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_events_open_roster ON events;
CREATE TRIGGER trg_events_open_roster
  BEFORE INSERT OR UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION trg_events_open_roster();

-- Side 2: the team junction (the count). AFTER, and guarded by IS DISTINCT FROM
-- so adding a 3rd team to an already-open event does not fire trg_events_notify
-- and push a pointless realtime update to every connected client.
CREATE OR REPLACE FUNCTION trg_events_teams_open_roster() RETURNS trigger AS $$
DECLARE
  ids integer[];
  eid integer;
BEGIN
  ids := ARRAY(SELECT DISTINCT x FROM unnest(ARRAY[
           CASE WHEN TG_OP <> 'DELETE' THEN NEW.events_id END,
           CASE WHEN TG_OP <> 'INSERT' THEN OLD.events_id END
         ]) AS x WHERE x IS NOT NULL);
  FOREACH eid IN ARRAY ids LOOP
    UPDATE events e
       SET open_roster = fn_event_open_roster(e.id, e.invited_roles)
     WHERE e.id = eid
       AND e.open_roster IS DISTINCT FROM fn_event_open_roster(e.id, e.invited_roles);
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_events_teams_open_roster ON events_teams;
CREATE TRIGGER trg_events_teams_open_roster
  AFTER INSERT OR UPDATE OR DELETE ON events_teams
  FOR EACH ROW EXECUTE FUNCTION trg_events_teams_open_roster();

UPDATE events e
   SET open_roster = fn_event_open_roster(e.id, e.invited_roles)
 WHERE e.open_roster IS DISTINCT FROM fn_event_open_roster(e.id, e.invited_roles);

INSERT INTO directus_fields (collection, field, interface, display, readonly, sort, width, note)
SELECT 'events', 'open_roster', 'boolean', 'boolean', true, 95, 'half',
       'Derived: audience spans more than one team → full RSVP roster is visible to everyone who can see the event. Do not edit.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'events' AND field = 'open_roster');

COMMIT;
