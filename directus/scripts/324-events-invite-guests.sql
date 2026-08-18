-- Migration 324: events.invite_guests — are the invited teams' GUEST players invited too?
--
-- Trainings have had a per-activity guest switch since the beginning
-- (`trainings.excluded_guest_levels`, a jsonb list of tiers); games have a hard
-- club rule (a guest may never play a league game). Events had NOTHING: every
-- `member_teams` row of an invited team was audience, guest or not — the notify
-- fan-out, the auto-confirm, the absence auto-decline and the RSVP gate all read
-- the bare junction. So a Vorbereitungsturnier invited the two Gastspieler who
-- train with the team but cannot be entered on a match sheet, and the only way
-- out was to un-invite the team and hand-pick the roster.
--
-- One boolean, because that is the question a coach actually asks — events have
-- no per-tier semantics the way a training's Friday slot does. DEFAULT true, so
-- every existing event and every event created by an older client keeps exactly
-- today's audience.
--
-- ⚠ "Guest" here is `member_teams.guest_level > 0` — trains with us, may not play
-- league games. It is NOT `participations.guest_count` (a member's +1s) and NOT
-- the public signup door (`public_share_token` / `signup_url`), both of which
-- this column leaves untouched.
--
-- ⚠ The exclusion is decided per MEMBER, not per row: a member who is a guest on
-- one invited team but a core player on another invited team stays invited, and
-- a direct personal invite (`events_members`) always outranks the switch. A
-- club-wide event (no team links) is unaffected — there is no team to read a
-- guest level from.
--
-- Schema-only, idempotent. No permission change: Member/Leader read `events`
-- without a field list, and the public policy's field allow-list does not need it.

BEGIN;

ALTER TABLE events ADD COLUMN IF NOT EXISTS invite_guests boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.events.invite_guests IS
  'Do the guest players (member_teams.guest_level > 0) of the invited teams count as invited? '
  'true (default) = yes, the audience is every roster row as before. false = core roster only: '
  'guests are dropped from the notify fan-out, auto-confirm, absence auto-decline and the '
  'deadline reminder, and the RSVP gate refuses their confirmed/tentative write. Decided per '
  'member — core on any invited team, or personally invited via events_members, keeps them in. '
  'Nothing to do with participations.guest_count (+1s) or the public signup door.';

-- Register the column so the items API and the admin UI can read it. Sits next
-- to allow_maybe (24) / send_email_invite (23) — the other audience + RSVP
-- switches. ⚠ NULL in a VALUES list types as text and `options` is json.
INSERT INTO directus_fields (collection, field, interface, options, readonly, hidden, sort, width, note)
SELECT 'events', 'invite_guests', 'boolean', NULL::json, false, false, 25, 'half',
       'Are the invited teams'' guest players (G1–G3) invited? On = yes (default). Off = core roster only.'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'events' AND field = 'invite_guests'
);

COMMIT;

-- Verification (dev/prod):
--   \d events                                  -- invite_guests → boolean NOT NULL DEFAULT true
--   SELECT count(*) FROM events WHERE invite_guests IS NOT true;   -- → 0
