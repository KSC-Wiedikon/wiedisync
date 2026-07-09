-- Migration 197: basketball licensing situation + transfer/minor documents.
--
-- Swiss Basketball's licensing procedure ("Liste der Dokumente für jeden Fall")
-- requires different documents per case. Until now the registration form only
-- handled "new player" (+ the two FIBA documents for non-Swiss players) and had
-- no way to collect the documents transfers and minors need. This migration adds
-- the columns behind the new "situation" selector on the anmeldung form:
--
--   bb_situation       — neu | transfer_ch | transfer_intl | rueckkehr
--   bb_doc_freibrief   — signed release letter (Freibrief) for a Swiss-club transfer
--   bb_doc_u18parents  — FIBA parental consent, U18 international transfer / returner
--   bb_doc_schoolcert  — school-enrolment certificate, U18 intl transfer / returner (OPTIONAL)
--
-- The three document columns mirror the existing bb_doc_lizenz / bb_doc_selfdecl /
-- bb_doc_natdecl fields exactly: plain uuid columns with the Directus `file`
-- special and NO foreign-key relation (file lifecycle is handled by the
-- registration quarantine hook + orphan-sweep cron, not by a DB cascade).
--
-- Required-document enforcement lives in code (kscw-endpoints registration.js +
-- bb-docs.js, kscw-hooks approval gate, kscw-website registration-form.js).
--
-- Schema-only + idempotent.

BEGIN;

ALTER TABLE registrations ADD COLUMN IF NOT EXISTS bb_situation      varchar(32);
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS bb_doc_freibrief  uuid;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS bb_doc_u18parents uuid;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS bb_doc_schoolcert uuid;

-- ── Directus admin metadata ────────────────────────────────────────────
INSERT INTO directus_fields (collection, field, interface, width, note)
SELECT 'registrations', 'bb_situation', 'input', 'half',
  'Licensing situation: neu | transfer_ch | transfer_intl | rueckkehr'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'registrations' AND field = 'bb_situation');

INSERT INTO directus_fields (collection, field, special, interface, display, width, note)
SELECT 'registrations', 'bb_doc_freibrief', 'file', 'file', 'file', 'full',
  'Signed release letter (Freibrief) — transfer from another Swiss club'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'registrations' AND field = 'bb_doc_freibrief');

INSERT INTO directus_fields (collection, field, special, interface, display, width, note)
SELECT 'registrations', 'bb_doc_u18parents', 'file', 'file', 'file', 'full',
  'FIBA parental consent (U18) — international transfer / returner'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'registrations' AND field = 'bb_doc_u18parents');

INSERT INTO directus_fields (collection, field, special, interface, display, width, note)
SELECT 'registrations', 'bb_doc_schoolcert', 'file', 'file', 'file', 'full',
  'School-enrolment certificate (U18 international transfer / returner) — optional'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'registrations' AND field = 'bb_doc_schoolcert');

COMMIT;
