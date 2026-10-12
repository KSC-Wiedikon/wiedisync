-- Migration 407: who approved or rejected a registration, on the registration.
--
-- WHY
-- ---
-- Asked 12.10.2026: the Anmeldungen page should say who approved or rejected each
-- registration. The decision is an items-API PATCH from that page (status →
-- approved / rejected), so Directus's own activity + revision trail already holds
-- the actor — but nobody reads that, and `registrations.approved_by` /
-- `approved_at` (columns from the PocketBase era) were never written by anything.
--
-- WHAT CHANGES
-- ------------
--   registrations.approved_by_name / approved_by_email (approved_at exists),
--   registrations.rejected_at / rejected_by_name / rejected_by_email.
--   Stamped by the kscw-hooks `registrations.items.update` filter from the
--   caller's accountability whenever the status changes — never from the payload
--   (a self-declared approver is not evidence). Same actor pair as the document
--   waiver (`bb_docs_waived_by_*`, migration 358). Both pairs are kept: a row
--   rejected and later approved shows both decisions.
--   Backfill: each decided row gets its LATEST approval / rejection from
--   directus_revisions + directus_activity (actor, timestamp). Name and e-mail come
--   from the actor's member row, else from the Directus user (service logins).
--   The legacy `approved_by` text column is left as it is (2 rows on prod).
--   Fields registered read-only in directus_fields; restart after deploy.
--
-- Schema + backfill only, idempotent, per the migration policy. No permission rows.

BEGIN;

ALTER TABLE registrations ADD COLUMN IF NOT EXISTS approved_by_name varchar(255);
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS approved_by_email varchar(255);
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS rejected_at timestamptz;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS rejected_by_name varchar(255);
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS rejected_by_email varchar(255);

-- ── Backfill from the revision trail ─────────────────────────────────────────

WITH decisions AS (
  SELECT DISTINCT ON (r.item)
         r.item::integer AS reg_id,
         a."timestamp" AS at,
         NULLIF(btrim(concat_ws(' ', coalesce(m.first_name, u.first_name), coalesce(m.last_name, u.last_name))), '') AS name,
         coalesce(m.email, u.email) AS email
  FROM directus_revisions r
  JOIN directus_activity a ON a.id = r.activity
  LEFT JOIN directus_users u ON u.id = a."user"
  LEFT JOIN members m ON m."user" = a."user"
  WHERE r.collection = 'registrations'
    AND r.delta->>'status' = 'approved'
    AND r.item ~ '^[0-9]+$'
  ORDER BY r.item, a."timestamp" DESC
)
UPDATE registrations g
SET approved_at       = coalesce(g.approved_at, d.at),
    approved_by_name  = d.name,
    approved_by_email = d.email
FROM decisions d
WHERE d.reg_id = g.id
  AND g.approved_by_name IS NULL AND g.approved_by_email IS NULL;

WITH decisions AS (
  SELECT DISTINCT ON (r.item)
         r.item::integer AS reg_id,
         a."timestamp" AS at,
         NULLIF(btrim(concat_ws(' ', coalesce(m.first_name, u.first_name), coalesce(m.last_name, u.last_name))), '') AS name,
         coalesce(m.email, u.email) AS email
  FROM directus_revisions r
  JOIN directus_activity a ON a.id = r.activity
  LEFT JOIN directus_users u ON u.id = a."user"
  LEFT JOIN members m ON m."user" = a."user"
  WHERE r.collection = 'registrations'
    AND r.delta->>'status' = 'rejected'
    AND r.item ~ '^[0-9]+$'
  ORDER BY r.item, a."timestamp" DESC
)
UPDATE registrations g
SET rejected_at       = d.at,
    rejected_by_name  = d.name,
    rejected_by_email = d.email
FROM decisions d
WHERE d.reg_id = g.id
  AND g.rejected_at IS NULL AND g.rejected_by_name IS NULL;

-- ── Directus field registration (read-only) ──────────────────────────────────

INSERT INTO directus_fields (collection, field, interface, readonly, hidden, width, note)
SELECT 'registrations', f.field, f.iface, true, false, 'half', f.note
FROM (VALUES
  ('approved_by_name',  'input',    'Who approved — stamped by the server (migration 407).'),
  ('approved_by_email', 'input',    'Who approved — stamped by the server (migration 407).'),
  ('rejected_at',       'datetime', 'When rejected — stamped by the server (migration 407).'),
  ('rejected_by_name',  'input',    'Who rejected — stamped by the server (migration 407).'),
  ('rejected_by_email', 'input',    'Who rejected — stamped by the server (migration 407).')
) AS f(field, iface, note)
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields x WHERE x.collection = 'registrations' AND x.field = f.field
);

COMMIT;
