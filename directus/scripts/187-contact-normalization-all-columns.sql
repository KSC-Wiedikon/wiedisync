-- Migration 187: whole-row contact normalization — every remaining normalizable
-- column on members + registrations (extends 186, which covered phone/AHV/IBAN/
-- email). Prod survey 2026-07-07: names 4+6 whitespace, vm_email 12 case,
-- ahv_nummer 3 whitespace-only; billing_* and registrations already clean —
-- the statements are still all here so a re-run reconciles any future stray.
--
-- Canonical shapes (INFRA.md → "Contact-data normalization rule"):
--   names/address/city/labels → btrim + single internal spaces
--   emails (vm_email, billing_email) → trimmed + lowercased
--   billing_phone → kscw_normalize_phone (fn from 186; raw kept if unrewritable)
--   billing_iban → compact uppercase
--   nationalitaet_code → uppercase
--   whitespace-only → NULL (members.email stays ''-fallback: NOT NULL contract)
--
-- Idempotent; depends on migration 186 (kscw_normalize_phone).

BEGIN;

-- ── members: text hygiene ─────────────────────────────────────────────────────

UPDATE members SET first_name = btrim(regexp_replace(first_name, '\s+', ' ', 'g'))
WHERE first_name IS NOT NULL AND first_name <> btrim(regexp_replace(first_name, '\s+', ' ', 'g'));

UPDATE members SET last_name = btrim(regexp_replace(last_name, '\s+', ' ', 'g'))
WHERE last_name IS NOT NULL AND last_name <> btrim(regexp_replace(last_name, '\s+', ' ', 'g'));

UPDATE members SET adresse = btrim(regexp_replace(adresse, '\s+', ' ', 'g'))
WHERE adresse IS NOT NULL AND adresse <> btrim(regexp_replace(adresse, '\s+', ' ', 'g'));

UPDATE members SET ort = btrim(regexp_replace(ort, '\s+', ' ', 'g'))
WHERE ort IS NOT NULL AND ort <> btrim(regexp_replace(ort, '\s+', ' ', 'g'));

UPDATE members SET nationalitaet = btrim(regexp_replace(nationalitaet, '\s+', ' ', 'g'))
WHERE nationalitaet IS NOT NULL AND nationalitaet <> btrim(regexp_replace(nationalitaet, '\s+', ' ', 'g'));

UPDATE members SET plz = btrim(plz) WHERE plz IS NOT NULL AND plz <> btrim(plz);
UPDATE members SET anrede = btrim(anrede) WHERE anrede IS NOT NULL AND anrede <> btrim(anrede);
UPDATE members SET license_nr = btrim(license_nr) WHERE license_nr IS NOT NULL AND license_nr <> btrim(license_nr);
UPDATE members SET beitragskategorie = btrim(beitragskategorie) WHERE beitragskategorie IS NOT NULL AND beitragskategorie <> btrim(beitragskategorie);
UPDATE members SET sektion = btrim(sektion) WHERE sektion IS NOT NULL AND sektion <> btrim(sektion);

-- ── members: emails (vm_email + billing_email; members.email done in 186) ────

UPDATE members SET vm_email = lower(btrim(vm_email))
WHERE vm_email IS NOT NULL AND vm_email <> lower(btrim(vm_email));

UPDATE members SET billing_email = lower(btrim(billing_email))
WHERE billing_email IS NOT NULL AND billing_email <> lower(btrim(billing_email));

-- ── members: billing contact (same canonical shapes as the primary fields) ───

UPDATE members SET billing_name = btrim(regexp_replace(billing_name, '\s+', ' ', 'g'))
WHERE billing_name IS NOT NULL AND billing_name <> btrim(regexp_replace(billing_name, '\s+', ' ', 'g'));

UPDATE members SET billing_address = btrim(regexp_replace(billing_address, '\s+', ' ', 'g'))
WHERE billing_address IS NOT NULL AND billing_address <> btrim(regexp_replace(billing_address, '\s+', ' ', 'g'));

UPDATE members SET billing_ort = btrim(regexp_replace(billing_ort, '\s+', ' ', 'g'))
WHERE billing_ort IS NOT NULL AND billing_ort <> btrim(regexp_replace(billing_ort, '\s+', ' ', 'g'));

UPDATE members SET billing_plz = btrim(billing_plz)
WHERE billing_plz IS NOT NULL AND billing_plz <> btrim(billing_plz);

UPDATE members SET billing_phone = kscw_normalize_phone(billing_phone)
WHERE kscw_normalize_phone(billing_phone) IS NOT NULL AND billing_phone <> kscw_normalize_phone(billing_phone);

UPDATE members SET billing_iban = upper(regexp_replace(billing_iban, '[\s.''-]', '', 'g'))
WHERE NULLIF(btrim(billing_iban), '') IS NOT NULL
  AND billing_iban <> upper(regexp_replace(billing_iban, '[\s.''-]', '', 'g'));

-- ── members: whitespace-only → NULL (email excluded — NOT NULL '' contract) ──

UPDATE members SET phone = NULL          WHERE phone IS NOT NULL AND btrim(phone) = '';
UPDATE members SET adresse = NULL        WHERE adresse IS NOT NULL AND btrim(adresse) = '';
UPDATE members SET plz = NULL            WHERE plz IS NOT NULL AND btrim(plz) = '';
UPDATE members SET ort = NULL            WHERE ort IS NOT NULL AND btrim(ort) = '';
UPDATE members SET nationalitaet = NULL  WHERE nationalitaet IS NOT NULL AND btrim(nationalitaet) = '';
UPDATE members SET anrede = NULL         WHERE anrede IS NOT NULL AND btrim(anrede) = '';
UPDATE members SET ahv_nummer = NULL     WHERE ahv_nummer IS NOT NULL AND btrim(ahv_nummer) = '';
UPDATE members SET iban = NULL           WHERE iban IS NOT NULL AND btrim(iban) = '';
UPDATE members SET vm_email = NULL       WHERE vm_email IS NOT NULL AND btrim(vm_email) = '';
UPDATE members SET license_nr = NULL     WHERE license_nr IS NOT NULL AND btrim(license_nr) = '';
UPDATE members SET billing_name = NULL   WHERE billing_name IS NOT NULL AND btrim(billing_name) = '';
UPDATE members SET billing_email = NULL  WHERE billing_email IS NOT NULL AND btrim(billing_email) = '';
UPDATE members SET billing_address = NULL WHERE billing_address IS NOT NULL AND btrim(billing_address) = '';
UPDATE members SET billing_plz = NULL    WHERE billing_plz IS NOT NULL AND btrim(billing_plz) = '';
UPDATE members SET billing_ort = NULL    WHERE billing_ort IS NOT NULL AND btrim(billing_ort) = '';
UPDATE members SET billing_phone = NULL  WHERE billing_phone IS NOT NULL AND btrim(billing_phone) = '';
UPDATE members SET billing_iban = NULL   WHERE billing_iban IS NOT NULL AND btrim(billing_iban) = '';

-- ── registrations: same hygiene (13 rows on prod, already clean — future-proof) ─

UPDATE registrations SET vorname = btrim(regexp_replace(vorname, '\s+', ' ', 'g'))
WHERE vorname IS NOT NULL AND vorname <> btrim(regexp_replace(vorname, '\s+', ' ', 'g'));

UPDATE registrations SET nachname = btrim(regexp_replace(nachname, '\s+', ' ', 'g'))
WHERE nachname IS NOT NULL AND nachname <> btrim(regexp_replace(nachname, '\s+', ' ', 'g'));

UPDATE registrations SET adresse = btrim(regexp_replace(adresse, '\s+', ' ', 'g'))
WHERE adresse IS NOT NULL AND adresse <> btrim(regexp_replace(adresse, '\s+', ' ', 'g'));

UPDATE registrations SET ort = btrim(regexp_replace(ort, '\s+', ' ', 'g'))
WHERE ort IS NOT NULL AND ort <> btrim(regexp_replace(ort, '\s+', ' ', 'g'));

UPDATE registrations SET team = btrim(regexp_replace(team, '\s+', ' ', 'g'))
WHERE team IS NOT NULL AND team <> btrim(regexp_replace(team, '\s+', ' ', 'g'));

UPDATE registrations SET plz = btrim(plz) WHERE plz IS NOT NULL AND plz <> btrim(plz);
UPDATE registrations SET anrede = btrim(anrede) WHERE anrede IS NOT NULL AND anrede <> btrim(anrede);

UPDATE registrations SET nationalitaet_code = upper(btrim(nationalitaet_code))
WHERE nationalitaet_code IS NOT NULL AND nationalitaet_code <> upper(btrim(nationalitaet_code));

COMMIT;
