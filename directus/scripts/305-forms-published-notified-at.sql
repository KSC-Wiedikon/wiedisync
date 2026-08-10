-- 305 — forms.published_notified_at: make the publish fan-out dedupe durable.
--
-- `notifyFormPublished` deduped by looking for an existing `form_published`
-- NOTIFICATION row. Notifications are transient by design: the nightly cleanup
-- cron deletes anything older than 30 days via an untyped catch-all (rules 1-2
-- protect only activity_type IN ('game','training','event'); form rows carry
-- 'form' and fall through), and members can delete their own rows from the bell
-- menu. The dedupe needs ZERO surviving rows club-wide, so a small team's form
-- can lose its key in days.
--
-- Consequence: a club-wide form published in January and typo-fixed in March
-- re-notified AND re-pushed every `wiedisync_active` member, repeating on every
-- later edit — the trigger is `payload.status === 'open'`, and the form builder
-- posts the whole object including `status` on every save. Coaches can trigger
-- it too (LEADER holds forms.update).
--
-- Fix: keep the state on the form itself, exactly as announcements already do
-- with `fanout_sent_at`. Claiming it is a conditional UPDATE, so the fan-out is
-- re-entrant and immune to the purge.
--
-- Audit 2026-08-08, finding 19. Schema-only; idempotent.

ALTER TABLE forms ADD COLUMN IF NOT EXISTS published_notified_at timestamptz;

COMMENT ON COLUMN forms.published_notified_at IS
  'When the publish fan-out (notification + web push) was sent for this form. '
  'Set by a conditional UPDATE in kscw-hooks notifyFormPublished so the fan-out '
  'runs exactly once per form, re-entrantly. Replaces a dedupe that keyed on a '
  'notifications row the 30-day cleanup cron purged (audit 2026-08-08, #19). '
  'NULL = never announced.';

-- Backfill: any form already open AND already announced must not re-announce on
-- its next edit. Derive from the surviving notification rows; forms whose row
-- was already purged are indistinguishable from never-announced ones, so they
-- get the form's own creation time rather than NULL — announcing an OLD form to
-- the whole club is the failure mode this migration exists to prevent, and a
-- missed announcement for a form published weeks ago is the cheaper error.
UPDATE forms f
SET published_notified_at = COALESCE(
      (SELECT min(n.date_created) FROM notifications n
        WHERE n.type = 'form_published' AND n.activity_id = f.id::text),
      f.date_created,
      now()
    )
WHERE f.published_notified_at IS NULL
  AND f.status = 'open';

-- Register the column so the items API and the admin UI can read it.
INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, width, note)
SELECT 'forms', 'published_notified_at', 'cast-timestamp', 'datetime', true, true, 'half',
       'When the publish fan-out was sent. Managed by kscw-hooks; do not edit.'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'forms' AND field = 'published_notified_at'
);
