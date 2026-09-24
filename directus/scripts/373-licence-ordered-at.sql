-- Migration 373: members.licence_ordered_at — the date a licence was ordered
--
-- Feeds ClubDesk's `Lizenz bestellt` cell, which the push never sent (424 of
-- the linked licence holders had it empty on 24.09.2026). The club's rule
-- (user, 24.09.2026):
--   volleyball  Lizenz bestellt = the licence ACTIVATION date in Volleymanager
--               (sv_vm_check.licence_activation_date — already stored, nothing
--               to add here)
--   basketball  Lizenz bestellt = the day the licence was set to "ordered" in
--               wiedisync (the licence-status workflow, migration 301)
--
-- The basketball date had nowhere to live: licence_status_updated_at is
-- overwritten when the status moves on to finalized/licenced, so the order
-- date was lost the moment the licence arrived. This column keeps it. It is
-- stamped by the members licence_status filter hook in kscw-hooks whenever the
-- status moves TO 'ordered'.
--
-- Backfill: the latest move to 'ordered' in the Directus revision trail (every
-- hand edit of licence_status goes through the items API, so the trail is
-- complete since migration 301 shipped), falling back to
-- licence_status_updated_at for a row still sitting at 'ordered' without one.
-- Dates are Europe/Zurich calendar days — that is the day the club means.
--
-- Schema + backfill only; idempotent (fill-only backfill, IF NOT EXISTS).

BEGIN;

ALTER TABLE members ADD COLUMN IF NOT EXISTS licence_ordered_at date;

COMMENT ON COLUMN members.licence_ordered_at IS
  'Day the licence was set to ordered (licence_status workflow). Basketball source of ClubDesk "Lizenz bestellt"; volleyball uses sv_vm_check.licence_activation_date. Stamped by the kscw-hooks licence_status filter.';

UPDATE members m
   SET licence_ordered_at = h.ordered_on
  FROM (
    SELECT r.item::int AS member_id,
           max((a.timestamp AT TIME ZONE 'Europe/Zurich')::date) AS ordered_on
      FROM directus_revisions r
      JOIN directus_activity a ON a.id = r.activity
     WHERE r.collection = 'members'
       AND r.delta->>'licence_status' = 'ordered'
       AND r.item ~ '^[0-9]+$'
     GROUP BY r.item
  ) h
 WHERE m.id = h.member_id
   AND m.licence_ordered_at IS NULL;

UPDATE members
   SET licence_ordered_at = (licence_status_updated_at AT TIME ZONE 'Europe/Zurich')::date
 WHERE licence_status = 'ordered'
   AND licence_ordered_at IS NULL
   AND licence_status_updated_at IS NOT NULL;

-- Register the field so the items API (the licence_status hook writes it into
-- the same payload) and the Data Explorer read it as a real date column.
INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, width, note)
SELECT 'members', 'licence_ordered_at', NULL, 'datetime', true, false, 'half',
       'Day the licence was set to ordered — ClubDesk "Lizenz bestellt" (basketball)'
 WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'members' AND field = 'licence_ordered_at');

COMMIT;

-- Verification:
--   SELECT licence_status, count(*), count(licence_ordered_at) FROM members GROUP BY 1;
