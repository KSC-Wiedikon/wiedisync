-- 332 — staff corrections for scorer-course signup answers
--
-- The /admin scorer-course table renders each signup straight from OpnForm, and
-- only the KSCW-owned tracking columns (present / exam_* / sv_license / notes)
-- are editable. Everything the participant typed — name, email, phone, address,
-- birthdate, club, team, SVRZ licence — is read-only, so a typo can only be
-- fixed by asking them to sign up again.
--
-- ⚠⚠ Why an override column and NOT a write back to OpnForm. OpnForm does expose
-- PUT /forms/{form}/submissions/{id}, but it routes through StoreFormSubmissionJob,
-- which ends in `if (!$this->isPartial) FormSubmitted::dispatch(...)` — and
-- FormSubmitted is what the NotifyFormSubmission listener runs the form's email
-- integrations from. Editing a misspelt street would therefore re-send the
-- participant their confirmation AND re-notify scorer@volleyball.kscw.ch, every
-- time, with no suppression flag. Corrections live here instead: the submission
-- stays exactly as the participant filed it (which is the record of what they
-- actually claimed), and staff edits shadow it at display and export time.
--
-- ⚠ TEXT holding a JSON document, not jsonb — deliberately. wadmin's
-- assertScalarBody rejects any top-level object in the request body for
-- section-scoped Website Admins, and scorer_courses is run by exactly those
-- (cp-smile@gmx.ch holds ["scorer_courses"] and nothing else). A jsonb column
-- would 400 for the very people who need this. The client stringifies; same
-- shape as members.role and website_admin_access.sections.
--
-- Keys are OpnForm field UUIDs, values are the corrected strings:
--   {"718ff4f7-…":"Léo","f48fc93d-…":"Birmensdorferstrasse 12"}
-- An absent key means "no correction" and the form answer shows through, so
-- clearing a correction is a delete of the key, never an empty string.
--
-- ⚠ sv_license stays its OWN column and is NOT folded in here. It predates this,
-- the SVRZ export and the exam-sheet filename both read it directly, and moving
-- it would break both for no gain.

ALTER TABLE scorer_course_attendance
  ADD COLUMN IF NOT EXISTS field_overrides text;

COMMENT ON COLUMN scorer_course_attendance.field_overrides IS
  'JSON object of staff corrections to the OpnForm answers, keyed by OpnForm field UUID. Absent key = no correction. Never written back to OpnForm (that would re-fire its email integrations).';

-- Register it so the items API accepts it and the Directus admin can read it.
INSERT INTO directus_fields (collection, field, special, interface, options, display, readonly, hidden, sort, width, note)
SELECT 'scorer_course_attendance', 'field_overrides', NULL, 'input-multiline', NULL, NULL, false, false,
       (SELECT COALESCE(MAX(sort), 0) + 1 FROM directus_fields WHERE collection = 'scorer_course_attendance'),
       'full',
       'Staff corrections to the participant''s own answers, as JSON keyed by OpnForm field id. The signup itself is never modified — OpnForm re-sends its notification emails on every update.'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields
   WHERE collection = 'scorer_course_attendance' AND field = 'field_overrides'
);
