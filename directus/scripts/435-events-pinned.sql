-- Migration 435: events.pinned — an event shown at the top of Home, like a duty
--
-- Admins can pin an event (club assembly, a camp, a deadline that matters). Everyone who
-- can see the event gets it as a pinned card above the event list on Home — the same
-- spot as a scorer duty or a form sign-up (migration 434). Visibility is unchanged: a
-- pin never widens the audience; it only orders what a member already sees.
--
-- DEFAULT false: no existing event changes. Schema-only, idempotent. No permission change:
-- Member/Leader read `events` without a field list; the leader write list is explicit and
-- does not get this field (admins pin, like the form binding and form_signup_only).

BEGIN;

ALTER TABLE events ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.events.pinned IS
  'Pinned on Home for everyone who can see the event (above the event list, like a duty). '
  'Ordering only — never changes who sees the event. Set by admins.';

-- ⚠ NULL in a VALUES list types as text and `options` is json.
INSERT INTO directus_fields (collection, field, interface, options, readonly, hidden, sort, width, note)
SELECT 'events', 'pinned', 'boolean', NULL::json, false, false, 27, 'half',
       'Pinned on the home page for everyone who can see the event.'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'events' AND field = 'pinned'
);

COMMIT;

-- Verification: \d events → pinned boolean NOT NULL DEFAULT false
