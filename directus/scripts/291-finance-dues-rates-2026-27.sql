-- 291 — seed the 2026/27 membership-dues rate schedule.
--
-- WHY NOW: ClubDesk's "Rechnungen stellen" is broken by a vendor bug (invalid
-- Zahlungsverbindungen) with 116 invoices stuck, so the club is billing 2026/27
-- from wiedisync instead. `finance_dues_rates` was EMPTY — a native dues run
-- would have found no rate for anybody and billed nobody.
--
-- WHERE THE NUMBERS COME FROM: `CD_BEITRAG_MAP` in kscw-endpoints/src/clubdesk-update.js,
-- the fee table the ClubDesk push has been deriving Mitgliederbeitrag from since
-- 2026-07-06 (VB = the published website fees, BB = the ClubDesk values). Seeding
-- from the same table is what makes a native invoice and a ClubDesk invoice agree
-- on the amount.
--
-- ⚠ These are the BASE amounts only. The CHF 100 no-Schreiberlizenz surcharge and
-- the CHF 110 pure-guest discount are per-MEMBER, not per-category, so they cannot
-- live in a rate row — `feeBreakdown()` applies them on top at preview/issue time.
-- Billing the flat schedule alone would under-bill 141 members by CHF 14'100.
--
-- ⚠ DELIBERATELY NOT SEEDED: 'VB Schüler*in Meisterschaft mit Abzug' (1 member),
-- 'VB Studenten/Lehrlinge mit Abzug' (2) and the 10 active members with no category
-- at all. These are manual-override people; the map has no amount for them and
-- inventing one would silently bill the wrong number. They surface in the preview
-- as "No rate" for the treasurer to price by hand.
--
-- Data-only + idempotent (ON CONFLICT on the (fiscal_year, lower(category),
-- coalesce(sektion,'')) unique index). Rates are editable afterwards in
-- /admin/finance → Dues, so a re-run never fights a treasurer's correction.

INSERT INTO finance_dues_rates (fiscal_year, category, sektion, amount_chf, subject_template, active)
SELECT fy.id, v.category, NULL, v.amount, 'Mitgliederbeitrag {fy}', true
FROM finance_fiscal_years fy
CROSS JOIN (VALUES
  -- Volleyball
  ('VB Erwerbstätige',                 440),
  ('VB Student*in Meisterschaft',      380),
  ('VB Schüler*in Meisterschaft',      310),
  ('VB Schüler*in Turnier',            210),
  ('VB Schüler*in 1. Jahr',            110),
  ('VB Turnier KWI',                   110),
  -- Basketball
  ('BB Erwerbstätige 1. Liga',         560),
  ('BB Erwerbstätige',                 510),
  ('BB Lernende/Studierende 1. Liga',  460),
  ('BB Lernende/Studierende',          410),
  ('BB Jugend Meisterschaft',          310),
  ('BB 2 Trainings',                   310),
  ('BB Minis Turnier',                 210),
  -- Club-wide. The two zero rows are deliberate: they are a real price, and a
  -- seeded 0 tells the preview "no fee" instead of the amber "no rate" that
  -- means "someone still has to decide". Issuing skips amount <= 0.
  ('Passivmitglied',                    40),
  ('Gratis',                             0),
  ('Kein Beitrag',                       0)
) AS v(category, amount)
WHERE fy.label = '2026/27'
  -- Only categories someone is actually in — no dead rows in the treasurer's table.
  AND EXISTS (
    SELECT 1 FROM members m
    WHERE m.kscw_membership_active AND btrim(m.beitragskategorie) = v.category
  )
ON CONFLICT DO NOTHING;
