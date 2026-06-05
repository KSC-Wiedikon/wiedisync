-- Migration 088: Forms submission v2 — editable submissions + success message.
--
-- Adds:
--   * forms.success_message — optional custom thank-you text shown after submit.
--   * form_submissions BEFORE UPDATE guard — lets a member edit their own
--     submission (setup-permissions grants update on own rows, fields=['answers'])
--     but only while the form is still OPEN and before its deadline. Mirrors the
--     existing BEFORE INSERT guard (migration 086) minus the dedup check.
--
-- Schema-only + idempotent, per CLAUDE.md. Permissions live in
-- setup-permissions.mjs (Member form_submissions update on own rows).

BEGIN;

-- ── forms.success_message ────────────────────────────────────────────
ALTER TABLE forms ADD COLUMN IF NOT EXISTS success_message text;

COMMENT ON COLUMN forms.success_message IS
  'Optional custom confirmation text shown to the member after a successful submission (falls back to a generic "thank you" when null).';

INSERT INTO directus_fields (collection, field, special, interface, sort, width, note)
SELECT 'forms', 'success_message', NULL, 'input-multiline', 12, 'full',
  'Optional thank-you message shown after submitting.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'forms' AND field = 'success_message');

-- ── form_submissions BEFORE UPDATE guard (editable submissions) ───────
-- A member may revise their answers, but only while the form is open and not
-- past its deadline. No dedup check (that only applies to fresh INSERTs).
CREATE OR REPLACE FUNCTION trg_form_submissions_update_guard() RETURNS trigger AS $$
DECLARE
  f forms%ROWTYPE;
BEGIN
  -- Only re-validate when the answers actually change (status flips / admin
  -- back-office edits on other columns shouldn't be blocked by a closed form).
  IF NEW.answers IS NOT DISTINCT FROM OLD.answers THEN
    RETURN NEW;
  END IF;
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
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS form_submissions_update_guard ON form_submissions;
CREATE TRIGGER form_submissions_update_guard
  BEFORE UPDATE ON form_submissions
  FOR EACH ROW EXECUTE FUNCTION trg_form_submissions_update_guard();

COMMIT;
