-- Migration 323: the federation licence portion of a category's dues rate
--
-- kscw.ch has told members, in both languages and for both sports, that "die
-- Swiss Volley Lizenzgebühren sind NICHT im Mitgliederbeitrag enthalten, werden
-- aber zusammen mit diesem auf einer gemeinsamen Rechnung verrechnet". No
-- invoice has ever carried such a line. ClubDesk's own history settles which
-- half is wrong: VB Erwerbstätige was billed 440 (170 invoices) and 540 (25 —
-- the no-Schreiberlizenz surcharge), never 550. The rate is licence-INCLUSIVE
-- and the published note was wrong (user decision 2026-08-15); the fix is to
-- itemise the rate, not to raise it.
--
-- `licence_chf` is that portion. It changes NO total: the invoice's first line
-- becomes (amount_chf − licence_chf) and a second line carries the licence, so
-- a member sees where their money goes and the club can show the federation's
-- cut without a second rate schedule.
--
-- ⚠ It is NOT a second fee engine and must never reach feeBreakdown(). The one
-- engine still owns "what does this member owe"; this column only says how that
-- number reads on the document. Every adjustment (surcharge, guest reduction,
-- discount, waiver) continues to apply to the TOTAL.
--
-- Seeds (user-confirmed 2026-08-15) come from the tier each category actually
-- licenses, priced off Swiss Volley's published 2026/27 table:
--   RLL 110  adults + students        JLL  60  the school categories
--   NLL 250 / Doppellizenz 110|250    Jugend U16 30 / Mini U13 15 — UNUSED here
-- The club's own arithmetic corroborates RLL 110: both the register's
-- "keine Lizenz" Abzug and the codified guest reduction are exactly CHF 110,
-- and the Spielplanung overrides already store 330 as an adult's licence-less
-- base. ⚠ The junior tiers were checked against Swiss Volley's licence record
-- (`sv_vm_check`), not assumed: the whole club holds RLL 163, JLL 83, NLL 5,
-- PL 3, DLR 3, DLN 1 and **zero** U16 or U13 licences — every licensed under-18
-- volleyball member is JLL. A Mini licensed next season is priced by editing
-- this column, not by a code change, which is the reason it is a column.
--
-- ⚠ Basketball is seeded 0 on purpose. The same "not included" claim is on the
-- website for the Swiss Basketball Verbandslizenz, but nobody has given the club
-- figures for it, and a guessed split on a real invoice is worse than none.
--
-- Schema + data seed, idempotent. No permission change: the finance role reads
-- and writes finance_dues_rates as a whole collection.

BEGIN;

ALTER TABLE finance_dues_rates ADD COLUMN IF NOT EXISTS licence_chf numeric(10,2) NOT NULL DEFAULT 0;

-- Never negative, and never more than the rate it is carved out of — a licence
-- larger than the fee would print a negative Mitgliederbeitrag line.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'finance_dues_rates'::regclass AND conname = 'finance_dues_rates_licence_range'
  ) THEN
    ALTER TABLE finance_dues_rates ADD CONSTRAINT finance_dues_rates_licence_range
      CHECK (licence_chf >= 0 AND licence_chf <= amount_chf);
  END IF;
END $$;

COMMENT ON COLUMN public.finance_dues_rates.licence_chf IS
  'The federation licence portion INSIDE amount_chf (Swiss Volley RLL 110 / JLL 60 …), in CHF. Presentation only: the dues run splits the invoice''s first position into (amount_chf - licence_chf) + this, and the total is unchanged. 0 = the category orders no licence. Never read by feeBreakdown().';

-- Seed the volleyball categories. Fill-only (`licence_chf = 0`), so a figure a
-- treasurer has already corrected is never overwritten by a re-run.
UPDATE finance_dues_rates r SET licence_chf = v.licence
FROM (VALUES
  ('VB Erwerbstätige',            110),   -- RLL
  ('VB Student*in Meisterschaft', 110),   -- RLL
  ('VB Studenten/Lehrlinge',      110),   -- RLL (legacy ClubDesk spelling)
  ('VB Schüler*in Meisterschaft',  60),   -- JLL
  ('VB Schüler Meisterschaft',     60),
  ('VB Schüler*in Turnier',        60),   -- JLL
  ('VB Schüler Turnier',           60),
  ('VB Schüler*in 1. Jahr',        60),   -- JLL
  ('VB Turnier KWI',               60)    -- JLL — "erstmalige Lizenz für Schüler:innen aus Wiedikon"
) AS v(category, licence)
WHERE lower(btrim(r.category)) = lower(v.category)
  AND r.licence_chf = 0
  AND r.amount_chf >= v.licence;

-- Expose it next to the amount in the Directus admin, same group as the rate.
INSERT INTO directus_fields (collection, field, interface, options, readonly, hidden, sort, width, note)
SELECT v.collection, v.field, v.interface, NULL::json, v.readonly, v.hidden, v.sort, v.width, v.note
FROM (VALUES
  ('finance_dues_rates', 'licence_chf', 'input', false, false, 6, 'half',
   'Federation licence portion contained in the amount above (Swiss Volley RLL 110, JLL 60). Splits the invoice into two lines; it does NOT add to the total. 0 = this category orders no licence.')
) AS v(collection, field, interface, readonly, hidden, sort, width, note)
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields df WHERE df.collection = v.collection AND df.field = v.field
);

COMMIT;

-- Verification (dev/prod):
--   SELECT category, amount_chf, licence_chf, amount_chf - licence_chf AS membership
--     FROM finance_dues_rates r JOIN finance_fiscal_years f ON f.id = r.fiscal_year
--    WHERE f.label = '2026/27' ORDER BY category;
--   -- → VB Erwerbstätige 440.00 / 110.00 / 330.00 · VB Schüler*in M. 310/60/250
--   -- → every BB row and Passivmitglied/Gratis/Kein Beitrag at 0.00
--   UPDATE finance_dues_rates SET licence_chf = 999 WHERE category = 'Passivmitglied';
--   -- → CHECK violation (licence > amount)
