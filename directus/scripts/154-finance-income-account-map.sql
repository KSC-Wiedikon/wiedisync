-- Migration 154: per-category dues income mapping for auto-posting.
-- A single default income account can't reproduce ClubDesk's split (3110
-- Passivmitglieder, 3120 Aktivmitglieder, 3200 Aktivmitglieder VB, 3210 J+S …).
-- This map sends each membership category (finance_invoices.fee_category, set from
-- the dues-rate category = members.beitragskategorie) to its own income account.
-- The auto-poster uses it for the invoice's issue posting + credit-note reversal,
-- falling back to finance_ledger_settings.income_account for anything unmapped.
--
-- Schema-only + idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS finance_income_account_map (
  fee_category    varchar(128) PRIMARY KEY,
  account         integer REFERENCES finance_accounts(id) ON DELETE SET NULL,
  date_updated    timestamp with time zone DEFAULT now() NOT NULL,
  updated_by_name varchar(255)
);

INSERT INTO directus_collections (collection, icon, note, hidden, sort)
SELECT 'finance_income_account_map', 'category', 'Dues category → income account map for auto-posting', false, 61
WHERE NOT EXISTS (SELECT 1 FROM directus_collections WHERE collection = 'finance_income_account_map');

COMMIT;
