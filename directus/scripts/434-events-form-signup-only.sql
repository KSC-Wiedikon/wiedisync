-- Migration 434: events.form_signup_only — a private event whose audience IS its form sign-ups
--
-- The club runs some sign-ups through a public OpnForm (forms.kscw.ch) sent out by email:
-- a course, a camp, a helpers' list. The form's email field is checked against Wiedisync
-- (our OpnForm fork + POST /kscw/opnform/v1/signup), and whoever submits it must end up
-- signed in to a matching Wiedisync event that only they can see, cannot sign out of, and
-- that is pinned on their home page.
--
-- One boolean on the event, next to the existing form binding (`signup_form_slug`, 385):
--   * audience — the event starts with NO team, role or member link; every sign-up adds an
--     `events_members` row. The member read policy already shows an event to its invited
--     members (setup-permissions.mjs EVENTS_VISIBLE), so nothing changes there — except that
--     a public type (club / tournament) is readable by everyone, hence the CHECK below.
--   * "no links = club-wide" — autoConfirmEvent, backfillMemberAutoConfirm, the absence
--     auto-decline (eventEligibilitySql) and the unanswered-reminder audience all read an
--     event with no team and no member rows as "everyone". A form-only event with no
--     sign-up yet looks exactly like that, so each of them skips it (kscw-hooks + endpoints).
--   * RSVP — the confirmed row is written by the endpoint; a member's own create/update/
--     delete on it is refused by the kscw-hooks participations filter, and the app shows the
--     answer read-only.
--
-- DEFAULT false: every existing event keeps its behaviour. Schema-only, idempotent. No
-- permission change: Member/Leader read `events` without a field list; the leader write
-- list is explicit and does not get this field (admins set it, like the form binding).

BEGIN;

ALTER TABLE events ADD COLUMN IF NOT EXISTS form_signup_only boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.events.form_signup_only IS
  'Private sign-up event: the audience is exactly the people who submitted the bound OpnForm '
  '(signup_form_slug). Each submission adds an events_members row and a confirmed RSVP; members '
  'cannot change that RSVP. With no sign-up yet the event is NOT club-wide — every '
  '"no team and no member link = everyone" rule skips it. Never a public type (club/tournament).';

-- A public type is readable by every member regardless of links, which would make the
-- private event public.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_form_signup_only_private_type') THEN
    ALTER TABLE events ADD CONSTRAINT events_form_signup_only_private_type
      CHECK (NOT form_signup_only OR event_type NOT IN ('club', 'tournament'));
  END IF;
END $$;

-- Register the column so the items API and the admin UI can read it. Next to
-- invite_guests (25). ⚠ NULL in a VALUES list types as text and `options` is json.
INSERT INTO directus_fields (collection, field, interface, options, readonly, hidden, sort, width, note)
SELECT 'events', 'form_signup_only', 'boolean', NULL::json, false, false, 26, 'half',
       'Private sign-up event: only people who submit the linked form see it, and they are signed in automatically (read-only).'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'events' AND field = 'form_signup_only'
);

COMMIT;

-- Verification (dev/prod):
--   \d events                                              -- form_signup_only boolean NOT NULL DEFAULT false
--   SELECT count(*) FROM events WHERE form_signup_only;    -- → 0 right after the migration
