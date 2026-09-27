-- Migration 378: car pooling, per activity (games, trainings, events).
--
-- Brings back the feature retired in migration 257, redesigned around the reason
-- it went unused: it was a TEAM-level toggle, games-only (away games), offers
-- only, and buried at the bottom of the game modal. A full season passed without
-- one row. This version:
--   * is switched on PER ACTIVITY by whoever sets the activity up (coach/TR on a
--     game or training, the author on an event) — `carpool_enabled`, default OFF,
--     so nothing appears anywhere until someone asks for it;
--   * works on all three activity kinds;
--   * has both sides of the market — a driver OFFERS seats, a member without a
--     car REQUESTS one — with when (departure time), where (meeting point),
--     which way (there / back / both) and how many seats;
--   * is surfaced as a banner at the top of the activity's modal, as a chip on
--     every card, and on Home.
--
-- ⚠ Read and written ONLY through kscw-endpoints (carpools.js) — deliberately NOT
-- registered in Directus, same model as game_recordings (migration 375). Who may
-- see an activity's carpool board is "whoever may read the activity", which the
-- endpoint answers by reading the activity through ItemsService with the
-- caller's own accountability — i.e. the existing games/trainings/events read
-- policies, reused rather than re-expressed as a second set of policy filters
-- that would have to be kept in step (and that would walk the events M2M, the
-- documented deep-filter silent-empty trap). No permission rows (CLAUDE.md rule
-- 1): the tables have no /items grant at all, and the three new activity columns
-- ride the existing activity grants — except `games`, whose coach/spielplaner
-- writes go through the GAME_WRITE_FIELDS allow-list in setup-permissions.mjs.
-- `carpool_enabled` is added there in the same commit.
--
-- ⚠ Integrity lives HERE, not only in the endpoint (CLAUDE.md → Data integrity):
--   * a carpool row belongs to exactly one activity (CHECK num_nonnulls = 1),
--     and is dropped with it (ON DELETE CASCADE on all three FKs);
--   * one offer and one request per member per activity (partial uniques);
--   * seats can never be overbooked — a BEFORE trigger on carpool_passengers
--     locks the offer row and counts, so two members racing for the last seat
--     cannot both get it (a read-then-insert in the endpoint could not promise
--     that);
--   * an offer's seat count cannot drop below the seats already taken;
--   * a driver cannot ride in their own car, and only OFFERS take passengers.
--   Raised errors carry a stable `carpool_*` message the endpoint maps to a 409.
--
-- Actor capture (CLAUDE.md → Audit logging): every write is raw knex, so the
-- endpoint calls writeUserLog on each; `added_by_name` additionally records who
-- put a passenger in a car (the passenger themself, or the driver taking a
-- request).
--
-- ⚠⚠ Directus caches the schema at boot and a raw-SQL `directus_fields` insert
-- does NOT bust that cache. Restart after applying:
--   npm run db:migrate:dev && ssh hetzner "sudo docker restart directus-kscw-dev"
--
-- Schema-only + idempotent.

BEGIN;

-- ── The per-activity toggle ─────────────────────────────────────────────────
ALTER TABLE games     ADD COLUMN IF NOT EXISTS carpool_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE trainings ADD COLUMN IF NOT EXISTS carpool_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE events    ADD COLUMN IF NOT EXISTS carpool_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN games.carpool_enabled IS
  'Car pooling board shown on this game (offer / request rides). Default off; the coach/TR switches it on per game. Rides live in carpools (migration 378).';
COMMENT ON COLUMN trainings.carpool_enabled IS
  'Car pooling board shown on this training (offer / request rides). Default off; the coach/TR switches it on per training. Rides live in carpools (migration 378).';
COMMENT ON COLUMN events.carpool_enabled IS
  'Car pooling board shown on this event (offer / request rides). Default off; the event author switches it on. Rides live in carpools (migration 378).';

-- ── Rides: an offer (driver with seats) or a request (member needing seats) ─
CREATE TABLE IF NOT EXISTS carpools (
  id                 serial PRIMARY KEY,
  game               integer REFERENCES games(id)     ON DELETE CASCADE,
  training           integer REFERENCES trainings(id) ON DELETE CASCADE,
  event              integer REFERENCES events(id)    ON DELETE CASCADE,
  kind               varchar(10) NOT NULL,
  -- The driver (offer) or the member who needs a ride (request).
  member             integer NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  -- 'there' = to the activity, 'back' = home afterwards, 'both' = round trip.
  direction          varchar(10) NOT NULL DEFAULT 'both',
  -- Offer: free seats in the car (driver excluded). Request: seats needed.
  seats              smallint NOT NULL DEFAULT 1,
  departure_time     time without time zone,
  departure_location varchar(200),
  notes              varchar(500),
  date_created       timestamptz NOT NULL DEFAULT now(),
  date_updated       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT carpools_one_activity CHECK (num_nonnulls(game, training, event) = 1),
  CONSTRAINT carpools_kind_check      CHECK (kind IN ('offer', 'request')),
  CONSTRAINT carpools_direction_check CHECK (direction IN ('there', 'back', 'both')),
  CONSTRAINT carpools_seats_range     CHECK (seats BETWEEN 1 AND 8)
);

COMMENT ON TABLE carpools IS
  'Car pooling (migration 378): ride offers and ride requests for one game, training or event. Endpoint-only (kscw-endpoints/src/carpools.js) — no Directus registration, no /items grant.';

CREATE INDEX IF NOT EXISTS carpools_game_idx     ON carpools (game)     WHERE game     IS NOT NULL;
CREATE INDEX IF NOT EXISTS carpools_training_idx ON carpools (training) WHERE training IS NOT NULL;
CREATE INDEX IF NOT EXISTS carpools_event_idx    ON carpools (event)    WHERE event    IS NOT NULL;
CREATE INDEX IF NOT EXISTS carpools_member_idx   ON carpools (member);

-- One offer and one request per member per activity. (A member edits their
-- entry rather than stacking a second one; a parent driving two cars is not a
-- case worth a second row.)
CREATE UNIQUE INDEX IF NOT EXISTS carpools_game_member_kind_uq
  ON carpools (game, member, kind) WHERE game IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS carpools_training_member_kind_uq
  ON carpools (training, member, kind) WHERE training IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS carpools_event_member_kind_uq
  ON carpools (event, member, kind) WHERE event IS NOT NULL;

-- ── Passengers: who sits in which offered car ───────────────────────────────
CREATE TABLE IF NOT EXISTS carpool_passengers (
  id            serial PRIMARY KEY,
  carpool       integer NOT NULL REFERENCES carpools(id) ON DELETE CASCADE,
  passenger     integer NOT NULL REFERENCES members(id)  ON DELETE CASCADE,
  -- Seats this passenger takes (a parent with a child = 2).
  seats         smallint NOT NULL DEFAULT 1,
  -- Actor capture: the passenger themself, or the driver who took their request.
  added_by_name varchar(150),
  date_created  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT carpool_passengers_seats_range CHECK (seats BETWEEN 1 AND 8)
);

COMMENT ON TABLE carpool_passengers IS
  'Car pooling (migration 378): a member riding in an offered car. Seat capacity is enforced by trg_carpool_passengers_capacity.';

CREATE UNIQUE INDEX IF NOT EXISTS carpool_passengers_pair_uq ON carpool_passengers (carpool, passenger);
CREATE INDEX IF NOT EXISTS carpool_passengers_passenger_idx ON carpool_passengers (passenger);

-- ── Capacity: a car never holds more passengers than it has seats ───────────
-- Locks the offer row first, so concurrent joins serialise on it and the count
-- each one sees includes the other's committed row.
CREATE OR REPLACE FUNCTION trg_carpool_passengers_capacity() RETURNS trigger AS $$
DECLARE
  v_offer carpools%ROWTYPE;
  v_taken integer;
BEGIN
  SELECT * INTO v_offer FROM carpools WHERE id = NEW.carpool FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'carpool_not_found' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_offer.kind <> 'offer' THEN
    RAISE EXCEPTION 'carpool_not_an_offer' USING ERRCODE = 'check_violation';
  END IF;
  IF v_offer.member = NEW.passenger THEN
    RAISE EXCEPTION 'carpool_driver_is_passenger' USING ERRCODE = 'check_violation';
  END IF;
  SELECT COALESCE(sum(seats), 0) INTO v_taken
    FROM carpool_passengers
   WHERE carpool = NEW.carpool
     AND id IS DISTINCT FROM NEW.id;
  IF v_taken + NEW.seats > v_offer.seats THEN
    RAISE EXCEPTION 'carpool_full' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_carpool_passengers_capacity ON carpool_passengers;
CREATE TRIGGER trg_carpool_passengers_capacity
  BEFORE INSERT OR UPDATE OF carpool, passenger, seats ON carpool_passengers
  FOR EACH ROW EXECUTE FUNCTION trg_carpool_passengers_capacity();

-- ── An offer cannot shrink below its passengers, or turn into a request ─────
CREATE OR REPLACE FUNCTION trg_carpools_guard() RETURNS trigger AS $$
DECLARE
  v_taken integer;
BEGIN
  IF NEW.kind <> OLD.kind THEN
    RAISE EXCEPTION 'carpool_kind_immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.game IS DISTINCT FROM OLD.game
     OR NEW.training IS DISTINCT FROM OLD.training
     OR NEW.event IS DISTINCT FROM OLD.event THEN
    RAISE EXCEPTION 'carpool_activity_immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.kind = 'offer' AND NEW.seats < OLD.seats THEN
    SELECT COALESCE(sum(seats), 0) INTO v_taken FROM carpool_passengers WHERE carpool = NEW.id;
    IF NEW.seats < v_taken THEN
      RAISE EXCEPTION 'carpool_seats_below_taken' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.date_updated := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_carpools_guard ON carpools;
CREATE TRIGGER trg_carpools_guard
  BEFORE UPDATE ON carpools
  FOR EACH ROW EXECUTE FUNCTION trg_carpools_guard();

-- ── Register the three toggles so the items API + Data Explorer can read them
INSERT INTO directus_fields (collection, field, interface, options, readonly, hidden, sort, width, note)
SELECT v.c, 'carpool_enabled', 'boolean', NULL::json, false, false, 61, 'half',
       'Car pooling: show the offer / request rides board on this activity. Default off.'
  FROM (VALUES ('games'), ('trainings'), ('events')) AS v(c)
 WHERE NOT EXISTS (
   SELECT 1 FROM directus_fields f WHERE f.collection = v.c AND f.field = 'carpool_enabled'
 );

COMMIT;

-- Verification (dev/prod):
--   SELECT count(*) FILTER (WHERE carpool_enabled) FROM games;      -- → 0 (default off)
--   SELECT collection FROM directus_fields WHERE field = 'carpool_enabled';  -- → 3 rows
--   -- Capacity holds:
--   BEGIN;
--     INSERT INTO carpools (game, kind, member, seats) VALUES ((SELECT min(id) FROM games), 'offer', (SELECT min(id) FROM members), 1) RETURNING id;
--     INSERT INTO carpool_passengers (carpool, passenger) VALUES (currval('carpools_id_seq'), (SELECT max(id) FROM members));
--     INSERT INTO carpool_passengers (carpool, passenger) VALUES (currval('carpools_id_seq'), (SELECT max(id) - 1 FROM members));
--   ROLLBACK;                          -- → second passenger raises carpool_full
--   -- After applying, restart the container or the fields read back as aliases.
