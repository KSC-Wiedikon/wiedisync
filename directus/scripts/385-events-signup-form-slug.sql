-- Migration 385: endpoint-owned OpnForm binding for event signup forms.
--
-- 2026-09-28 deep audit F15. `GET /kscw/events/:id/signups` listed OpnForm
-- submissions for whatever slug it parsed out of `events.signup_url` — a column
-- the event's creator (any coach) writes through the items API. Pointing it at
-- `forms.kscw.ch/forms/<any-slug>` returned 100 raw submissions of ANY club form
-- per call, fetched with the club-wide OPNFORM_PAT. Sibling of the 2026-07-03
-- wadmin slug-binding fix.
--
--   events.signup_form_slug  the slug of the OpnForm form that
--                            `POST /kscw/events/:id/signup-form` created for this
--                            event. The signups route reads ONLY this column;
--                            `signup_url` stays the display/CTA link.
--
-- Endpoint-owned, enforced in Postgres rather than only by field lists: the
-- BEFORE trigger silently keeps the stored value unless the writer set the
-- transaction-local GUC `kscw.signup_slug_write = 'on'` (event-signup-form.js
-- does, inside its own transaction). Silent keep, not an error, so an admin
-- saving the whole event row in the Directus UI never fails on it.
--
-- Backfill: only events whose CURRENT signup_url is exactly the URL the endpoint
-- itself wrote (its `user_logs` row) — never a URL someone pasted. 0 prod events
-- carry a signup_url today, so this is a no-op kept for correctness.
--
-- Schema/data only + idempotent.

BEGIN;

ALTER TABLE events ADD COLUMN IF NOT EXISTS signup_form_slug text;

COMMENT ON COLUMN events.signup_form_slug IS
  'OpnForm slug bound by POST /kscw/events/:id/signup-form. Endpoint-owned: writes without the kscw.signup_slug_write GUC are ignored (trigger events_signup_form_slug_guard). Migration 385.';

CREATE OR REPLACE FUNCTION public.events_signup_form_slug_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF coalesce(current_setting('kscw.signup_slug_write', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.signup_form_slug := NULL;
  ELSE
    NEW.signup_form_slug := OLD.signup_form_slug;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS events_signup_form_slug_guard ON events;
CREATE TRIGGER events_signup_form_slug_guard
  BEFORE INSERT OR UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION public.events_signup_form_slug_guard();

-- Backfill (endpoint-written links only).
SELECT set_config('kscw.signup_slug_write', 'on', true);
UPDATE events e
   SET signup_form_slug = substring(e.signup_url from '/forms/([A-Za-z0-9][A-Za-z0-9-]{0,80})')
 WHERE e.signup_form_slug IS NULL
   AND e.signup_url IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM user_logs u
      WHERE u.collection_name = 'events'
        AND u.record_id = e.id::text
        AND u.data->>'signup_url' = e.signup_url
        AND u.data->>'opnform_id' IS NOT NULL
   );
SELECT set_config('kscw.signup_slug_write', '', true);

-- ── Directus field registration (read-only, hidden) ─────────────────────────
INSERT INTO directus_fields (collection, field, interface, readonly, hidden, width, note)
SELECT 'events', 'signup_form_slug', 'input', true, true, 'half',
  'Endpoint-owned: the OpnForm form bound by "Create signup form". Never edit — writes are ignored.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'events' AND field = 'signup_form_slug');

COMMIT;
