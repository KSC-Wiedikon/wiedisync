-- Migration 186: contact-data canonicalization — SQL phone normalizer + one-time
-- backfill of members/registrations to the canonical formats.
--
-- Canonical shapes (single spec, INFRA.md → "Contact-data normalization rule";
-- JS mirrors: kscw-endpoints/src/normalize.js + src/utils/contact.ts, kept
-- honest by src/utils/__tests__/contact-normalize-parity.test.ts):
--   phone CH      → '+41 79 123 45 67'      phone foreign → '+436501234567'
--   iban          → 'CH93…' compact upper   ahv           → '756.1234.5678.97'
--   email         → trimmed lowercase
--
-- kscw_normalize_phone(text) returns the canonical form, or NULL when the input
-- is empty OR not safely rewritable (letters, Excel-mangled 4.9E+11, legacy
-- 9-digit pre-2007 numbers, wrong digit counts) — callers keep the raw value in
-- that case; unrewritable values surface via the data-quality report query in
-- clubdesk-diff-queries.sql and get fixed by hand.
--
-- Backfill counts on prod 2026-07-07: ~290 non-canonical phones (most repairable),
-- 1 dotless AHV, 0 IBAN changes expected, a handful of mixed-case emails.
-- Idempotent: re-running finds nothing left to rewrite.

BEGIN;

CREATE OR REPLACE FUNCTION kscw_normalize_phone(raw text) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE
  s text; compact text; cc text; nat text;
BEGIN
  s := btrim(coalesce(raw, ''));
  IF s = '' THEN RETURN NULL; END IF;
  -- Decorations → spaces: apostrophes (legacy CSV-guard corruption), ./-/()
  s := regexp_replace(s, '[''’/.()-]', ' ', 'g');
  s := btrim(regexp_replace(s, '\s+', ' ', 'g'));
  IF s ~ '[^0-9+ ]' THEN RETURN NULL; END IF;
  compact := replace(s, ' ', '');
  -- at most one '+', and only leading
  IF length(compact) - length(replace(compact, '+', '')) > 1
     OR position('+' in compact) > 1 THEN RETURN NULL; END IF;
  IF left(compact, 1) = '+' THEN cc := substr(compact, 2);
  ELSIF left(compact, 2) = '00' THEN cc := substr(compact, 3);
  ELSIF left(compact, 1) = '0' THEN
    nat := substr(compact, 2);
    -- 10-digit Swiss national only; 9-digit values are pre-2007 numbers → NULL
    IF length(nat) <> 9 THEN RETURN NULL; END IF;
    cc := '41' || nat;
  ELSIF length(compact) = 11 AND left(compact, 2) = '41' THEN cc := compact;
  -- bare 9 digits = Swiss national typed without the 0 (14 prod cases 2026-07-07)
  ELSIF length(compact) = 9 THEN cc := '41' || compact;
  ELSE RETURN NULL;
  END IF;
  IF cc !~ '^[1-9][0-9]{7,14}$' THEN RETURN NULL; END IF;
  IF left(cc, 2) = '41' THEN
    nat := substr(cc, 3);
    IF length(nat) = 10 AND left(nat, 1) = '0' THEN nat := substr(nat, 2); END IF; -- "+41 (0)79 …"
    IF length(nat) <> 9 OR left(nat, 1) = '0' THEN RETURN NULL; END IF;
    RETURN '+41 ' || substr(nat, 1, 2) || ' ' || substr(nat, 3, 3) || ' '
                  || substr(nat, 6, 2) || ' ' || substr(nat, 8, 2);
  END IF;
  RETURN '+' || cc;
END $fn$;

-- ── Backfill: members ─────────────────────────────────────────────────────────

UPDATE members SET phone = kscw_normalize_phone(phone)
WHERE kscw_normalize_phone(phone) IS NOT NULL AND phone <> kscw_normalize_phone(phone);

-- AHV: same EAN-13 intake rule as the ClubDesk down-sync (import-clubdesk-csv.mjs)
WITH n AS (
  SELECT id, regexp_replace(btrim(ahv_nummer), '[^0-9]', '', 'g') AS d
  FROM members
  WHERE NULLIF(btrim(ahv_nummer), '') IS NOT NULL
    AND btrim(ahv_nummer) !~ '[eE][+-]?[0-9]'
)
UPDATE members m
SET ahv_nummer = substr(n.d,1,3)||'.'||substr(n.d,4,4)||'.'||substr(n.d,8,4)||'.'||substr(n.d,12,2)
FROM n
WHERE m.id = n.id
  AND n.d ~ '^756[0-9]{10}$'
  AND (SELECT sum(substr(n.d,g.i,1)::int * CASE WHEN g.i % 2 = 1 THEN 1 ELSE 3 END)
         FROM generate_series(1,13) g(i)) % 10 = 0
  AND m.ahv_nummer <> substr(n.d,1,3)||'.'||substr(n.d,4,4)||'.'||substr(n.d,8,4)||'.'||substr(n.d,12,2);

UPDATE members SET iban = upper(regexp_replace(iban, '[\s.''-]', '', 'g'))
WHERE NULLIF(btrim(iban), '') IS NOT NULL
  AND iban <> upper(regexp_replace(iban, '[\s.''-]', '', 'g'));

UPDATE members SET email = lower(btrim(email))
WHERE email IS NOT NULL AND email <> lower(btrim(email));

-- ── Backfill: registrations (pending rows approved after this deploy copy
--    these values into members — normalize them at the source too) ────────────

UPDATE registrations SET telefon_mobil = kscw_normalize_phone(telefon_mobil)
WHERE kscw_normalize_phone(telefon_mobil) IS NOT NULL
  AND telefon_mobil <> kscw_normalize_phone(telefon_mobil);

WITH n AS (
  SELECT id, regexp_replace(btrim(ahv_nummer), '[^0-9]', '', 'g') AS d
  FROM registrations
  WHERE NULLIF(btrim(ahv_nummer), '') IS NOT NULL
    AND btrim(ahv_nummer) !~ '[eE][+-]?[0-9]'
)
UPDATE registrations r
SET ahv_nummer = substr(n.d,1,3)||'.'||substr(n.d,4,4)||'.'||substr(n.d,8,4)||'.'||substr(n.d,12,2)
FROM n
WHERE r.id = n.id
  AND n.d ~ '^756[0-9]{10}$'
  AND (SELECT sum(substr(n.d,g.i,1)::int * CASE WHEN g.i % 2 = 1 THEN 1 ELSE 3 END)
         FROM generate_series(1,13) g(i)) % 10 = 0
  AND r.ahv_nummer <> substr(n.d,1,3)||'.'||substr(n.d,4,4)||'.'||substr(n.d,8,4)||'.'||substr(n.d,12,2);

UPDATE registrations SET email = lower(btrim(email))
WHERE email IS NOT NULL AND email <> lower(btrim(email));

COMMIT;
