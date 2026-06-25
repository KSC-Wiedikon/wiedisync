-- Migration 141: finance email send jobs — background/chunked dues-run sending.
--
-- A full dues run renders ~hundreds of QR-bill PDFs + sends that many emails; doing
-- it inside one HTTP request risks a gateway timeout. Instead the send endpoint
-- creates a job row, returns immediately (202), and processes in the background,
-- updating sent/failed as it chunks through. The UI polls this row for progress.
-- A per-run "running" guard (with a staleness window) prevents double-sends.
--
-- Schema-only + idempotent. Endpoint-gated (no items-API permission needed).

BEGIN;

CREATE TABLE IF NOT EXISTS finance_email_jobs (
  id               serial PRIMARY KEY,
  dues_run         integer REFERENCES finance_dues_runs(id) ON DELETE CASCADE,
  status           varchar(16) NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'failed')),
  test_mode        boolean NOT NULL DEFAULT true,
  total            integer NOT NULL DEFAULT 0,
  sent             integer NOT NULL DEFAULT 0,
  failed           integer NOT NULL DEFAULT 0,
  error            text,
  created_by_name  varchar(255),
  created_by_email varchar(255),
  date_created     timestamptz NOT NULL DEFAULT now(),
  date_updated     timestamptz
);
CREATE INDEX IF NOT EXISTS finance_email_jobs_run_idx ON finance_email_jobs (dues_run, id);

COMMENT ON TABLE finance_email_jobs IS
  'Background dues-run email sends: one row per send, progressed (sent/failed) as the worker chunks through. The UI polls it; a recent running row blocks a duplicate send.';

INSERT INTO directus_collections (collection, icon, color, "group", sort, archive_app_filter)
SELECT 'finance_email_jobs', 'outgoing_mail', '#059669', NULL, NULL, true
WHERE NOT EXISTS (SELECT 1 FROM directus_collections WHERE collection = 'finance_email_jobs');

INSERT INTO directus_fields (collection, field, special, interface, display, sort, width, note)
SELECT 'finance_email_jobs', 'dues_run', 'm2o', 'select-dropdown-m2o', 'related-values', 1, 'half', 'The dues run being emailed.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_email_jobs' AND field = 'dues_run');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_email_jobs', 'status', 'input', 2, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_email_jobs' AND field = 'status');
INSERT INTO directus_fields (collection, field, interface, readonly, sort, width)
SELECT 'finance_email_jobs', 'sent', 'input', true, 3, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_email_jobs' AND field = 'sent');
INSERT INTO directus_fields (collection, field, interface, readonly, sort, width)
SELECT 'finance_email_jobs', 'total', 'input', true, 4, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_email_jobs' AND field = 'total');
INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'finance_email_jobs', 'date_created', 'date-created', 'datetime', true, true, 90
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_email_jobs' AND field = 'date_created');

INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'finance_email_jobs', 'dues_run', 'finance_dues_runs', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'finance_email_jobs' AND many_field = 'dues_run');

COMMIT;
