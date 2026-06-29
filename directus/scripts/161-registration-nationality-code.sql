-- Migration 161: canonical ISO country code on registrations.
--
-- The public registration form stores `nationalitaet` as the country name in the
-- submitter's UI language (German page → "Polen", English → "Poland"), so it can't
-- be re-translated for an admin viewing in another language. The form now also
-- submits the ISO 3166-1 alpha-2 code; store it here as the canonical value and let
-- the admin UI localize the display name via Intl.DisplayNames. `nationalitaet`
-- stays as the human-entered display name (kept for the ClubDesk import CSV).
-- Schema-only + idempotent.

BEGIN;

ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS nationalitaet_code varchar(2);

-- Expose the column to the items API + data-model UI.
INSERT INTO directus_fields (collection, field, interface, readonly, width, note)
SELECT 'registrations', 'nationalitaet_code', 'input', true, 'half',
  'ISO 3166-1 alpha-2 country code (canonical). nationalitaet holds the display name.'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'registrations' AND field = 'nationalitaet_code'
);

-- Backfill codes for existing rows from the stored (localized) country name.
-- Only the names actually present today (Schweiz/Switzerland, Polen); future rows
-- arrive with the code from the form. NULL-only so it never clobbers a real code.
UPDATE registrations SET nationalitaet_code = CASE lower(btrim(nationalitaet))
    WHEN 'schweiz' THEN 'CH' WHEN 'switzerland' THEN 'CH' WHEN 'suisse' THEN 'CH' WHEN 'svizzera' THEN 'CH'
    WHEN 'polen' THEN 'PL' WHEN 'poland' THEN 'PL' WHEN 'pologne' THEN 'PL' WHEN 'polonia' THEN 'PL'
    ELSE nationalitaet_code END
  WHERE nationalitaet_code IS NULL AND NULLIF(btrim(nationalitaet), '') IS NOT NULL;

COMMIT;
