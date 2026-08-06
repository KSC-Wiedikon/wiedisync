-- 292 — map each fee category to the income account ClubDesk actually books it to.
--
-- WHY: `finance_income_account_map` is EMPTY on prod while `autopost_enabled` is
-- true, so reconcileInvoiceLedger falls back to settings.income_account for every
-- invoice (finance-autopost.js:174). That fallback is account 43 = '3120
-- Sockelbeiträge Aktivmitglieder'. Issuing the 2026/27 dues run would therefore
-- credit the club's entire ~CHF 190'000 of membership income to a single wrong
-- line, and the P&L would show nothing under Volleyball or Basketball.
--
-- WHERE THE MAPPING COMES FROM: ClubDesk's own journal, not a guess. Across the
-- imported book (finance_transactions):
--     3110 Beiträge Passivmitglieder        3 entries    CHF    120   "Mitgliederbeitrag Passivmitglied 2025/2026 (…)"
--     3200 Aktivmitglieder VB             153 entries    CHF 54'730   volleyball member dues
--     3300 Aktivmitglieder BB             223 entries    CHF 79'900   basketball member dues
--     3120 Sockelbeiträge Aktivmitglieder  17 entries    CHF  7'520   "Sockelbeitrag 03.2026 VB" — CHF 20 monthly, NOT annual dues
-- 3120 is a different, small, recurring contribution. Defaulting annual dues into
-- it is what this migration fixes.
--
-- Accounts are resolved BY NUMBER, never by hardcoded id — the ids differ between
-- the dev clone and prod.
--
-- Categories cover both ClubDesk name families (see CD_BEITRAG_MAP), because
-- members.beitragskategorie can hold either spelling. 'Gratis' and 'Kein Beitrag'
-- are deliberately unmapped: they price at CHF 0 and the issue endpoint never
-- mints an invoice for them, so they can never reach the ledger.
--
-- Data-only + idempotent. ON CONFLICT DO NOTHING so a treasurer's later
-- re-mapping in the UI is never overwritten by a re-run.

INSERT INTO finance_income_account_map (fee_category, account)
SELECT v.category, a.id
FROM (VALUES
  -- Passive members → 3110
  ('Passivmitglied',                        '3110'),
  -- Volleyball → 3200
  ('VB Erwerbstätige',                      '3200'),
  ('VB Student*in Meisterschaft',           '3200'),
  ('VB Studenten/Lehrlinge',                '3200'),
  ('VB Studenten/Lehrlinge mit Abzug',      '3200'),
  ('VB Schüler*in Meisterschaft',           '3200'),
  ('VB Schüler Meisterschaft',              '3200'),
  ('VB Schüler*in Meisterschaft mit Abzug', '3200'),
  ('VB Schüler*in Turnier',                 '3200'),
  ('VB Schüler Turnier',                    '3200'),
  ('VB Schüler*in 1. Jahr',                 '3200'),
  ('VB Turnier KWI',                        '3200'),
  -- Basketball → 3300
  ('BB Erwerbstätige',                      '3300'),
  ('BB Erwerbstätig',                       '3300'),
  ('BB Erwerbstätige 1. Liga',              '3300'),
  ('BB Erwerbstätig 1. Liga',               '3300'),
  ('BB Lernende/Studierende',               '3300'),
  ('BB Student/Lehrling',                   '3300'),
  ('BB Studenten/Lehrlinge',                '3300'),
  ('BB Lernende/Studierende 1. Liga',       '3300'),
  ('BB Student/Lehrling 1. Liga',           '3300'),
  ('BB Jugend Meisterschaft',               '3300'),
  ('BB Junior:innen',                       '3300'),
  ('BB 2 Trainings',                        '3300'),
  ('BB Minis Turnier',                      '3300'),
  ('BB Minis',                              '3300'),
  ('BB 1 Trainings',                        '3300')
) AS v(category, acct_number)
JOIN finance_accounts a ON a.number::text = v.acct_number AND a.type = 'income'
ON CONFLICT (fee_category) DO NOTHING;
