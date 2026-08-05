-- Migration 281: teach members.trainer_licences the BASKETBALL coach ladder.
--
-- Migration 274 modelled coaching education as a subset of {JS, C, B, A}: the
-- federal Jugend+Sport track plus Swiss Volley's C/B/A rungs. That covered the
-- volleyball half of the club and nothing else. Basketball grades its coaches on
-- its OWN ladder — "Trainer 1 / Trainer 2 / Trainer 3" — which is not a spelling
-- variant of C/B/A but a separate federation's qualification. Three basketball
-- coaches already carry it in ClubDesk ("Trainer 1" ×2, "Trainer 2+" ×1), and
-- every one of them was silently dropped: the down-sync parser resolves an
-- unrecognised cell to NULL and skips the row rather than risk the CHECK
-- aborting the whole import. Nothing was corrupted — the data simply never
-- arrived.
--
-- The fix keeps ONE column. Collapsing "Trainer 2" onto "B" was considered and
-- rejected (user 2026-08-05): it would assert an equivalence between two
-- federations' ladders that nobody has verified, and the push would then render
-- a basketball coach's qualification in volleyball wording. A second column was
-- rejected too — ClubDesk has a single "Trainer Lizenz" cell, so two wiedisync
-- columns would have to fight over it.
--
-- T1/T2/T3 therefore join JS/C/B/A as peers, exactly as multi-valued as before:
-- a J+S-qualified basketball Trainer 2 is "JS,T2", the direct analogue of the
-- "JS,B" that migration 274 called an ordinary value. Canonical order puts the
-- federal track first, then the volleyball rungs, then the basketball rungs, so
-- the stored string groups by ladder and reads the way a human would list it.
--
-- ⚠ The widest legal value is 'JS,C,B,A,T1,T2,T3' — 17 characters, inside the
-- column's varchar(20). A fourth rung on either ladder would NOT fit; widen the
-- column in the same migration that adds it.
--
-- ⚠ Parsing exists in FOUR places and all four move together (see
-- [[trainer-licences-field]]): the SQL below, the SQL down-sync parser in
-- import-clubdesk-csv.mjs, the JS parser + push renderer in clubdesk-update.js,
-- and src/utils/trainerLicences.ts in the frontend.
--
-- Schema-only + idempotent. No permission change: the column is already in
-- MEMBER_EDITABLE_FIELDS / MEMBER_VISIBLE_FIELDS and its Directus field
-- registration (migration 274) is an `input`, so it needs no option list.

BEGIN;

-- Format guard. DROP-then-CREATE rather than a conditional add: the constraint
-- exists (migration 274) and its body is what changes, so an IF NOT EXISTS
-- guard would leave the OLD narrower rule in place and this migration would
-- silently do nothing. Re-adding revalidates every row — the only values in the
-- wild are 'JS', which the new pattern still accepts.
ALTER TABLE members DROP CONSTRAINT IF EXISTS members_trainer_licences_fmt;
ALTER TABLE members ADD CONSTRAINT members_trainer_licences_fmt
  CHECK (
    trainer_licences IS NULL
    OR trainer_licences::text ~ '^(JS|C|B|A|T1|T2|T3)(,(JS|C|B|A|T1|T2|T3))*$'
  );

-- Upper-case, trim, de-duplicate, canonical order (JS,C,B,A,T1,T2,T3), '' → NULL.
-- Unknown tokens are still PRESERVED so the CHECK rejects them loudly — the
-- trigger must never be the thing that silently swallows a typo.
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
               -- Basketball ladder, after the volleyball rungs (migration 281).
               WHEN 'T1' THEN 5 WHEN 'T2' THEN 6 WHEN 'T3' THEN 7
               ELSE 9  -- unknown → sorts last, then the CHECK rejects the row
             END AS rank
        FROM unnest(string_to_array(NEW.trainer_licences, ',')) AS tok
       WHERE btrim(tok) <> ''
    ) AS codes;

  NEW.trainer_licences := NULLIF(COALESCE(normalized, ''), '');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON COLUMN public.members.trainer_licences IS
  'Coaching education (Trainerausbildung) held by this member: ordered, comma-separated subset of JS (Jugend+Sport Leiter/in), the Swiss Volley rungs C/B/A, and the Swiss Basketball rungs T1/T2/T3 (= "Trainer 1/2/3", migration 281). Multi-valued by design and ACROSS ladders — J+S is a separate track from either federation''s ladder, so "JS,B" and "JS,T2" are ordinary values. The two sport ladders are NOT interchangeable: T2 is not a synonym for B. NULL = none / not recorded. Normalized to canonical order by trigger members_normalize_trainer_licences_trg. Synced two-way with ClubDesk''s free-text "Trainer Lizenz" cell (its "JS ID" is a different thing and maps to members.js_id).';

COMMIT;

-- Verify (dev):
--   SELECT trainer_licences, count(*) FROM members GROUP BY 1 ORDER BY 2 DESC;
--   UPDATE members SET trainer_licences = 't2, js' WHERE id = <test>;  -- → 'JS,T2'
--   UPDATE members SET trainer_licences = 'T4'     WHERE id = <test>;  -- → CHECK violation
