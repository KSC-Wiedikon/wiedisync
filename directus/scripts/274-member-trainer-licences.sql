-- Migration 274: members.trainer_licences — coaching education (Trainerausbildung)
--
-- The club had no record of which coaches hold which coaching qualification.
-- Four values are in scope, and they are NOT one ladder:
--   • JS — Jugend+Sport Leiter/in (the federal J+S track, orthogonal to the rest)
--   • C / B / A — the federation trainer ladder (Swiss Volley / Swiss Basketball)
-- A J+S-qualified Trainer B is an ordinary case, so the column is MULTI-VALUED.
--
-- Storage mirrors `members.nationalitaet_codes` (migration 223): an ordered,
-- comma-separated code list in a single varchar, with a CHECK on the format.
-- Same reasoning as there — a junction table for a closed 4-value set buys
-- nothing, and every reader (profile, explorer, exports) wants the whole set
-- at once, never a join.
--
-- Order is normalized to JS,C,B,A by trigger so equality and display are
-- stable regardless of the order the UI or an admin typed them in. The trigger
-- deliberately does NOT drop unknown tokens — it upper-cases, trims and
-- de-duplicates, then lets the CHECK reject anything that is not one of the
-- four. Silently swallowing a typo would be worse than a loud 400.
--
-- Nullable throughout: "no coaching qualification" and "not asked yet" are the
-- normal state for the ~90% of members who are players.
--
-- NOT pushed to ClubDesk: the register has no Trainerausbildung column (the
-- only adjacent field is "JS ID", the J+S Personennummer, which already
-- down-syncs into members.js_id). wiedisync owns this one outright.
--
-- Schema-only + idempotent. After applying: `npm run db:setup-perms:dev|prod`
-- — the column joins the member-editable / club-visible field lists.

BEGIN;

ALTER TABLE members ADD COLUMN IF NOT EXISTS trainer_licences character varying(20);

-- Format guard. Matches the nationalitaet_codes precedent: NULL or a
-- comma-separated list of known codes, no empty string, no trailing comma.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'members'::regclass AND conname = 'members_trainer_licences_fmt'
  ) THEN
    ALTER TABLE members ADD CONSTRAINT members_trainer_licences_fmt
      CHECK (
        trainer_licences IS NULL
        OR trainer_licences::text ~ '^(JS|C|B|A)(,(JS|C|B|A))*$'
      );
  END IF;
END $$;

COMMENT ON COLUMN public.members.trainer_licences IS
  'Coaching education (Trainerausbildung) held by this member: ordered, comma-separated subset of JS (Jugend+Sport Leiter/in), C, B, A. Multi-valued by design — J+S is a separate track from the federation C/B/A ladder, so "JS,B" is an ordinary value. NULL = none / not recorded. Normalized to canonical order by trigger members_normalize_trainer_licences_trg. wiedisync-owned: ClubDesk has no counterpart column (its "JS ID" maps to members.js_id instead).';

-- ── Normalizer ───────────────────────────────────────────────────────────────
-- Upper-case, trim, de-duplicate, canonical order (JS,C,B,A), '' → NULL.
-- Unknown tokens are PRESERVED so the CHECK above rejects them loudly.
CREATE OR REPLACE FUNCTION members_normalize_trainer_licences()
RETURNS trigger AS $$
DECLARE
  normalized text;
BEGIN
  IF NEW.trainer_licences IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT string_agg(code, ',' ORDER BY rank, code)
    INTO normalized
    FROM (
      SELECT DISTINCT
             upper(btrim(tok)) AS code,
             CASE upper(btrim(tok))
               WHEN 'JS' THEN 1 WHEN 'C' THEN 2 WHEN 'B' THEN 3 WHEN 'A' THEN 4
               ELSE 9  -- unknown → sorts last, then the CHECK rejects the row
             END AS rank
        FROM unnest(string_to_array(NEW.trainer_licences, ',')) AS tok
       WHERE btrim(tok) <> ''
    ) AS codes;

  NEW.trainer_licences := NULLIF(COALESCE(normalized, ''), '');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS members_normalize_trainer_licences_trg ON members;
CREATE TRIGGER members_normalize_trainer_licences_trg
  BEFORE INSERT OR UPDATE OF trainer_licences ON members
  FOR EACH ROW
  EXECUTE FUNCTION members_normalize_trainer_licences();

-- ── Directus field registration ──────────────────────────────────────────────
-- Lands in the "Sport identity" group (migration 256) next to number/position/
-- license_nr — coaching education is sport-agnostic, so it belongs there rather
-- than in the VB- or BB-specific licence groups.
--
-- `input` (plain text), NOT select-multiple-checkbox: the multi-select
-- interfaces require special='cast-csv', which makes the items API hand back an
-- ARRAY while every raw-knex reader in kscw-endpoints still sees the CSV string.
-- That dual shape is exactly the footgun `nationalitaet_codes` (migration 223)
-- avoided by staying a plain string, and this column is read from both sides
-- too. The CHECK + normalizer make free-text safe; the note carries the codes.
INSERT INTO directus_fields
  (collection, field, interface, options, readonly, hidden, sort, width, "group", note)
SELECT 'members', 'trainer_licences', 'input', NULL,
  false, false, 45, 'half', 'grp_sport',
  'Coaching education (Trainerausbildung): comma-separated subset of JS, C, B, A (e.g. "JS,B"). J+S is a separate track from the C/B/A ladder, so several are allowed. Case/order/spacing are normalized on save; anything outside the four codes is rejected.'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'members' AND field = 'trainer_licences'
);

COMMIT;

-- Verification (dev/prod):
--   SELECT trainer_licences, count(*) FROM members GROUP BY 1 ORDER BY 2 DESC;
--   UPDATE members SET trainer_licences = 'b, js ,C' WHERE id = <test>;  -- → 'JS,C,B'
--   UPDATE members SET trainer_licences = 'D' WHERE id = <test>;         -- → CHECK violation
