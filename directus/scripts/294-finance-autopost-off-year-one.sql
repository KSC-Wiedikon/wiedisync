-- 294 — turn native auto-posting OFF for the first season on wiedisync.
--
-- THE DECISION (user, 2026-08-06): wiedisync ISSUES the 2026/27 membership
-- invoices; ClubDesk keeps the BOOKS on cash basis exactly as it always has.
-- One variable changes this season, not two.
--
-- WHY CASH, on this club's own numbers:
--   * ClubDesk books cash — 442 of 442 `typ LIKE 'Rechnung%'` bookings debit
--     *1000 Bank*, and *1100 Debitoren* is touched 3 times in the whole 754-row
--     year. wiedisync's autopost is accrual (Debit Debitoren / Credit Income at
--     issue), so leaving it on would put ~CHF 190'000 of receivables into an
--     account the club has never used, mid-move, without a disclosed policy change.
--   * The distortion accrual would fix barely exists here. Dues are billed in
--     August and essentially all of them are paid inside the same fiscal year:
--     2025-08 CHF 43'100 · 2025-09 CHF 58'160 · 2025-10 CHF 14'705, tail to March,
--     one single entry in May. Recognising at issue instead of at payment would
--     move roughly one invoice across the 31.05 boundary.
--   * Annual income is CHF 195'089 — far under the CHF 500'000 threshold in
--     Art. 957 OR, so cash-basis ("Milchbüchleinrechnung") is legally sufficient
--     for the association.
--   * It also dissolves the open write-off question. 47 invoices carrying
--     CHF 7'026 were written off last season and NONE of them appears in the
--     journal — on cash basis a written-off amount was never booked as income, so
--     there is nothing to reverse and no bad-debt account is needed. That is why
--     the chart has none. Under accrual it would be mandatory.
--
-- CONSEQUENCE, stated plainly: with autopost off, a native invoice posts NO
-- ledger entry. FY 2026/27 therefore has no wiedisync book, and the treasurer
-- continues to book bank receipts in ClubDesk as today. That works precisely
-- because ClubDesk's bookings already debit 1000 Bank directly — where the
-- invoice was issued does not enter into it.
--
-- ⚠ REVISIT AT A CLEAN YEAR BOUNDARY, with the Revisor. Switching to accrual
-- later needs, at minimum: a Debitorenverluste expense account in the chart,
-- `bad_debt_account` + `expense_account` mapped in finance_ledger_settings (both
-- NULL today — finance-autopost.js:55 silently DROPS the leg rather than erroring),
-- and a working settlement path so Debitoren does not overstate forever.
--
-- Idempotent, but deliberately NOT a hard reset: it only flips a row that is
-- still in the shipped default state. Once the treasurer turns auto-posting back
-- on in the UI, a re-run must not silently turn it off again.

UPDATE finance_ledger_settings
   SET autopost_enabled = false,
       date_updated = now(),
       updated_by_name = COALESCE(updated_by_name, 'migration 294 — cash basis, season one')
 WHERE id = 1
   AND autopost_enabled IS TRUE
   -- Only while nothing native has been posted yet. A book that already contains
   -- native entries must not have its posting rule changed underneath it.
   AND NOT EXISTS (SELECT 1 FROM finance_transactions WHERE source = 'native');

COMMENT ON COLUMN finance_ledger_settings.autopost_enabled IS
  'Post native invoices/payments to the GL automatically (accrual). OFF since migration 294: season one on wiedisync issues invoices while ClubDesk keeps the books on cash basis. Turning this on requires bad_debt_account + expense_account to be mapped first.';
