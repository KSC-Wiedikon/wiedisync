-- 304 — basketball Mitgliederbeiträge +CHF 10, season 2026/27.
--
-- User decision 2026-08-10: every BASKETBALL fee category rises by CHF 10.
-- Volleyball, Passivmitglied (CHF 40, club-wide) and the two zero rows are
-- untouched.
--
--   BB Erwerbstätige 1. Liga         560 → 570
--   BB Erwerbstätige                 510 → 520
--   BB Lernende/Studierende 1. Liga  460 → 470
--   BB Lernende/Studierende          410 → 420
--   BB Jugend Meisterschaft          310 → 320   (legacy alias 'BB 2 Trainings' too)
--   BB Minis Turnier                 210 → 220
--
-- SAFE TO RE-PRICE 2026/27 IN PLACE: `finance_dues_rates` holds the base the
-- native dues run bills from, and on 2026-08-10 there were ZERO rows in
-- finance_dues_runs — the season had not been invoiced, so nothing has to be
-- credited or re-issued. The August run bills the new amounts.
--
-- ⚠ Base amounts only. The CHF 100 no-Schreiberlizenz/Offiziellen surcharge and
-- the CHF 110 pure-guest reduction are per-MEMBER and are applied on top by
-- feeBreakdown() at preview/issue time — exactly as migration 291 documents.
-- The matching CD_BEITRAG_MAP in kscw-endpoints/src/clubdesk-update.js moves in
-- the SAME commit; the two must agree or a native invoice and a ClubDesk invoice
-- price the same member differently.
--
-- Absolute values, not `amount_chf + 10`: a re-run must not compound. Scoped to
-- the 2026/27 fiscal year — an earlier season stays at what it actually billed.

UPDATE finance_dues_rates r
SET amount_chf = v.amount
FROM finance_fiscal_years fy,
  (VALUES
    ('BB Erwerbstätige 1. Liga',        570),
    ('BB Erwerbstätige',                520),
    ('BB Lernende/Studierende 1. Liga', 470),
    ('BB Lernende/Studierende',         420),
    ('BB Jugend Meisterschaft',         320),
    ('BB 2 Trainings',                  320),
    ('BB Minis Turnier',                220)
  ) AS v(category, amount)
WHERE r.fiscal_year = fy.id
  AND fy.label = '2026/27'
  AND btrim(r.category) = v.category
  AND r.amount_chf IS DISTINCT FROM v.amount;
