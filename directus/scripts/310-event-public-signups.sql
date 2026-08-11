-- 310-event-public-signups.sql
-- The guests' door: a shareable link that lets somebody WITHOUT a Wiedisync
-- account sign up for one event.
--
-- Two doors, and they must not be confused (see kscw-endpoints/src/event-signup-form.js):
--   • Members RSVP natively into `participations`. That is what feeds counts,
--     rosters, reminders and the absence machinery.
--   • Non-members have no account and cannot write a participation row, so they
--     land here instead.
-- A MEMBER who signed up through this door would leave no participation row and
-- the event card would read "0 going" while the hall filled up. The public page
-- therefore detects a session and sends members to the native RSVP; this table
-- is only ever the fallback for the account-less.
--
-- Internal table, same posture as site_text (309) and website_admin_access (063):
-- NOT registered in Directus (no directus_collections / directus_fields row), so
-- there is no /items/event_public_signups REST surface and no public policy to
-- grant. Reached only through /kscw/public/events/:token* and the authenticated
-- /kscw/events/:id/signups merge — see kscw-endpoints/src/public-event-signup.js.

BEGIN;

-- ── The share token ───────────────────────────────────────────────
--
-- A random token, NOT the numeric event id. `/events/42` is enumerable, which is
-- fine behind AuthRoute but not for a URL handed to strangers: the token IS the
-- authorisation, so it has to be unguessable. Nullable — an event has no public
-- door until somebody deliberately opens one — and UNIQUE so a token resolves to
-- exactly one event.
ALTER TABLE events ADD COLUMN IF NOT EXISTS public_share_token varchar(64);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'events_public_share_token_key'
  ) THEN
    ALTER TABLE events ADD CONSTRAINT events_public_share_token_key UNIQUE (public_share_token);
  END IF;
END $$;

-- Minted server-side only, so pin the shape here as well: URL-safe base64 of at
-- least 24 chars. A hand-written short token would be brute-forceable and the
-- database is the last place that can refuse it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'events_public_share_token_format'
  ) THEN
    ALTER TABLE events ADD CONSTRAINT events_public_share_token_format
      CHECK (public_share_token IS NULL OR public_share_token ~ '^[A-Za-z0-9_-]{24,64}$');
  END IF;
END $$;

-- ── The signups ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS event_public_signups (
  id           serial PRIMARY KEY,
  event        integer NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name         varchar(200) NOT NULL,
  email        varchar(255),
  phone        varchar(60),
  guest_count  integer NOT NULL DEFAULT 0,
  note         text,
  -- Kept so a duplicate submission can be spotted and a spammer traced, never
  -- exposed through any read path.
  ip_hash      varchar(64),
  date_created timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT event_public_signups_name_not_blank CHECK (btrim(name) <> ''),
  -- Bounded so a stray client cannot book out a hall in one request.
  CONSTRAINT event_public_signups_guest_count_sane CHECK (guest_count BETWEEN 0 AND 20)
);

CREATE INDEX IF NOT EXISTS idx_event_public_signups_event
  ON event_public_signups (event);

-- One signup per email per event. Partial, because email is optional: a walk-up
-- with no address must still be able to sign up, and several of those are not
-- duplicates of each other.
--
-- ⚠ Targetless ON CONFLICT does NOT fire against a partial unique index — a
-- writer that wants upsert semantics must name the predicate explicitly
-- (see the 2026-07 schema review). The endpoint deliberately does NOT upsert; it
-- catches 23505 and reports "already signed up", so the constraint is a guard,
-- not an upsert key.
CREATE UNIQUE INDEX IF NOT EXISTS uq_event_public_signups_event_email
  ON event_public_signups (event, lower(email))
  WHERE email IS NOT NULL;

COMMIT;
