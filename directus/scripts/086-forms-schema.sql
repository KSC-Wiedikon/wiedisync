-- Migration 086: Internal Forms — `forms` + `form_submissions`.
--
-- Native, internal-only form builder for the club app (build-vs-buy: rejected
-- OpnForm — no PDF export, workspace-only scoping not team-level, second system).
-- A `form` is "an event you fill in instead of RSVP to": title + a JSON field
-- definition, scoped to the whole club or to specific teams, authored by
-- Sport Admin (any) or coaches/TRs (their own teams), filled by members.
--
-- Use cases: tournament/event signups with extra fields (shirt size, dietary,
-- transport), kit/jersey orders, season-feedback surveys (optionally anonymous),
-- volunteer/duty signups, consent/data collection.
--
-- SCOPE OF THIS MIGRATION (schema-only + idempotent, per CLAUDE.md):
--   * `forms`             — the form definition (fields as JSONB).
--   * `form_submissions`  — one row per submission (answers as JSONB).
--   * BEFORE INSERT guard on `form_submissions` (open-only, closes_at, dedup).
--   * Directus admin metadata for both collections.
--
-- NOT in this migration:
--   * `forms_teams` M2M junction — created via the Directus admin UI (hard rule:
--     API/SQL-created M2M shows "relationship hasn't been configured correctly"),
--     then renamed + captured into migration 087.
--   * Permissions — live ONLY in setup-permissions.mjs (declarative/idempotent).
--
-- Mirrors the create-table pattern of migration 085 (scheduling_blocks) and the
-- JSON-column metadata of 082 (teams.recruiting_positions) / 069 (fine_rules.tiers).

BEGIN;

-- ── forms ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS forms (
  id              serial PRIMARY KEY,
  title           text NOT NULL,
  description     text,
  status          text NOT NULL DEFAULT 'draft',
  audience        text NOT NULL DEFAULT 'club_wide',
  fields          jsonb NOT NULL DEFAULT '[]'::jsonb,
  anonymous       boolean NOT NULL DEFAULT false,
  allow_multiple  boolean NOT NULL DEFAULT false,
  opens_at        timestamptz,
  closes_at       timestamptz,
  created_by      integer REFERENCES members(id) ON DELETE SET NULL,
  date_created    timestamptz NOT NULL DEFAULT now(),
  date_updated    timestamptz NOT NULL DEFAULT now(),
  user_created    uuid,
  user_updated    uuid,
  CONSTRAINT forms_status_check   CHECK (status   IN ('draft', 'open', 'closed')),
  CONSTRAINT forms_audience_check CHECK (audience IN ('club_wide', 'teams'))
);

CREATE INDEX IF NOT EXISTS forms_status_idx     ON forms (status);
CREATE INDEX IF NOT EXISTS forms_created_by_idx ON forms (created_by);

COMMENT ON TABLE forms IS
  'Internal form definitions. `fields` is the JSON form schema (array of {id,type,label,required,options?}); `answers` on form_submissions is keyed by those field ids. Scoped club-wide or to teams (via the forms_teams M2M, migration 087). Authored by Sport Admin (any) or coaches/TRs (own teams) per setup-permissions.mjs.';
COMMENT ON COLUMN forms.fields IS
  'Form definition: array of field defs. Field types v1: short_text, long_text, single_choice, multi_choice, number, date, yes_no. Choice types carry options[].';
COMMENT ON COLUMN forms.anonymous IS
  'When true, submissions store member=NULL — no "who responded" tracking and no per-member dedup.';
COMMENT ON COLUMN forms.allow_multiple IS
  'When true, a member may submit more than once (ignored for anonymous forms).';
COMMENT ON COLUMN forms.closes_at IS
  'Optional deadline. After this instant the submission guard rejects new submissions.';

-- ── form_submissions ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS form_submissions (
  id            serial PRIMARY KEY,
  form          integer NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  member        integer REFERENCES members(id) ON DELETE SET NULL,
  answers       jsonb NOT NULL DEFAULT '{}'::jsonb,
  submitted_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS form_submissions_form_idx   ON form_submissions (form);
CREATE INDEX IF NOT EXISTS form_submissions_member_idx ON form_submissions (member);

COMMENT ON TABLE form_submissions IS
  'One row per form submission. `answers` is a JSON object keyed by form.fields[].id. `member` is NULL for anonymous forms.';

-- ── Submission integrity guard ───────────────────────────────────────
-- Enforces server-side (mirrors the project''s data-integrity-via-triggers
-- convention): only submit to OPEN forms, before closes_at, and — unless the
-- form allows multiple — at most one submission per member.
CREATE OR REPLACE FUNCTION trg_form_submissions_guard() RETURNS trigger AS $$
DECLARE
  f forms%ROWTYPE;
BEGIN
  SELECT * INTO f FROM forms WHERE id = NEW.form;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'form_submissions: form % does not exist', NEW.form;
  END IF;
  IF f.status <> 'open' THEN
    RAISE EXCEPTION 'form_submissions: form % is not open (status=%)', NEW.form, f.status;
  END IF;
  IF f.closes_at IS NOT NULL AND now() > f.closes_at THEN
    RAISE EXCEPTION 'form_submissions: form % is past its deadline (%)', NEW.form, f.closes_at;
  END IF;
  IF NEW.member IS NOT NULL AND NOT f.allow_multiple AND EXISTS (
    SELECT 1 FROM form_submissions s WHERE s.form = NEW.form AND s.member = NEW.member
  ) THEN
    RAISE EXCEPTION 'form_submissions: member % already submitted to form %', NEW.member, NEW.form;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS form_submissions_guard ON form_submissions;
CREATE TRIGGER form_submissions_guard
  BEFORE INSERT ON form_submissions
  FOR EACH ROW EXECUTE FUNCTION trg_form_submissions_guard();

-- ── Directus admin metadata: collections ─────────────────────────────
INSERT INTO directus_collections (collection, icon, color, "group", sort, archive_field, archive_value, unarchive_value, archive_app_filter)
SELECT 'forms', 'assignment', '#2563EB', NULL, NULL, 'status', 'closed', 'open', true
WHERE NOT EXISTS (SELECT 1 FROM directus_collections WHERE collection = 'forms');

INSERT INTO directus_collections (collection, icon, color, "group", sort, archive_field, archive_value, unarchive_value, archive_app_filter)
SELECT 'form_submissions', 'assignment_turned_in', '#2563EB', NULL, NULL, NULL, NULL, NULL, true
WHERE NOT EXISTS (SELECT 1 FROM directus_collections WHERE collection = 'form_submissions');

-- ── Directus admin metadata: forms fields ────────────────────────────
INSERT INTO directus_fields (collection, field, special, interface, sort, width, note)
SELECT 'forms', 'title', NULL, 'input', 1, 'full', 'Form title shown to members.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'forms' AND field = 'title');

INSERT INTO directus_fields (collection, field, special, interface, sort, width, note)
SELECT 'forms', 'description', NULL, 'input-multiline', 2, 'full', 'Optional intro text.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'forms' AND field = 'description');

INSERT INTO directus_fields (collection, field, special, interface, options, sort, width, note)
SELECT 'forms', 'status', NULL, 'select-dropdown',
  '{"choices":[{"text":"Draft","value":"draft"},{"text":"Open","value":"open"},{"text":"Closed","value":"closed"}]}'::json,
  3, 'half', 'Lifecycle. Submissions allowed only while open.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'forms' AND field = 'status');

INSERT INTO directus_fields (collection, field, special, interface, options, sort, width, note)
SELECT 'forms', 'audience', NULL, 'select-dropdown',
  '{"choices":[{"text":"Club-wide","value":"club_wide"},{"text":"Teams","value":"teams"}]}'::json,
  4, 'half', 'Club-wide (everyone) or scoped to specific teams (via forms_teams).'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'forms' AND field = 'audience');

INSERT INTO directus_fields (collection, field, special, interface, options, sort, width, note)
SELECT 'forms', 'fields', 'cast-json', 'input-code',
  '{"language":"json"}'::json,
  5, 'full', 'Form definition (JSON array of field defs). Edited via the app builder.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'forms' AND field = 'fields');

INSERT INTO directus_fields (collection, field, special, interface, sort, width, note)
SELECT 'forms', 'anonymous', 'cast-boolean', 'boolean', 6, 'half', 'Submissions not tied to a member.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'forms' AND field = 'anonymous');

INSERT INTO directus_fields (collection, field, special, interface, sort, width, note)
SELECT 'forms', 'allow_multiple', 'cast-boolean', 'boolean', 7, 'half', 'Allow more than one submission per member.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'forms' AND field = 'allow_multiple');

INSERT INTO directus_fields (collection, field, special, interface, sort, width, note)
SELECT 'forms', 'opens_at', NULL, 'datetime', 8, 'half', 'Optional open date (informational).'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'forms' AND field = 'opens_at');

INSERT INTO directus_fields (collection, field, special, interface, sort, width, note)
SELECT 'forms', 'closes_at', NULL, 'datetime', 9, 'half', 'Optional deadline; submissions blocked after this.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'forms' AND field = 'closes_at');

INSERT INTO directus_fields (collection, field, special, interface, sort, width)
SELECT 'forms', 'created_by', 'm2o', 'select-dropdown-m2o', 10, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'forms' AND field = 'created_by');

INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'forms', 'date_created', 'date-created', 'datetime', true, true, 90
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'forms' AND field = 'date_created');

INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'forms', 'date_updated', 'date-updated', 'datetime', true, true, 91
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'forms' AND field = 'date_updated');

INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'forms', 'user_created', 'user-created', 'select-dropdown-m2o', true, true, 92
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'forms' AND field = 'user_created');

INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'forms', 'user_updated', 'user-updated', 'select-dropdown-m2o', true, true, 93
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'forms' AND field = 'user_updated');

-- ── Directus admin metadata: form_submissions fields ─────────────────
INSERT INTO directus_fields (collection, field, special, interface, display, sort, width)
SELECT 'form_submissions', 'form', 'm2o', 'select-dropdown-m2o', 'related-values', 1, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'form_submissions' AND field = 'form');

INSERT INTO directus_fields (collection, field, special, interface, display, sort, width, note)
SELECT 'form_submissions', 'member', 'm2o', 'select-dropdown-m2o', 'related-values', 2, 'half', 'NULL for anonymous submissions.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'form_submissions' AND field = 'member');

INSERT INTO directus_fields (collection, field, special, interface, options, sort, width, note)
SELECT 'form_submissions', 'answers', 'cast-json', 'input-code',
  '{"language":"json"}'::json,
  3, 'full', 'Answers keyed by form.fields[].id.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'form_submissions' AND field = 'answers');

INSERT INTO directus_fields (collection, field, special, interface, readonly, sort, width)
SELECT 'form_submissions', 'submitted_at', NULL, 'datetime', true, 4, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'form_submissions' AND field = 'submitted_at');

-- ── Directus relations metadata (M2O FKs) ────────────────────────────
INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'forms', 'created_by', 'members', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'forms' AND many_field = 'created_by');

INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'form_submissions', 'form', 'forms', NULL, NULL, NULL, NULL, NULL, 'delete'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'form_submissions' AND many_field = 'form');

INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'form_submissions', 'member', 'members', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'form_submissions' AND many_field = 'member');

COMMIT;
