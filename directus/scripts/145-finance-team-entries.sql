-- Migration 145: per-team finance entries — sponsoring income + team bills/costs.
--
-- "the ledger shall also have accounts per team (for sponsoring and bills
-- purposes)". A lightweight per-team ledger the treasurer fills: sponsoring/other
-- income IN and bills/costs OUT, per team + fiscal year. The per-team SUMMARY
-- endpoint combines these with the team-tagged native invoices (which already
-- carry a `team` FK, migration 128) into income / expense / net per team.
--
-- Schema-only + idempotent. Endpoint-gated (no items-API permission needed).

BEGIN;

CREATE TABLE IF NOT EXISTS finance_team_entries (
  id               serial PRIMARY KEY,
  team             integer NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  fiscal_year      integer REFERENCES finance_fiscal_years(id) ON DELETE SET NULL,
  kind             varchar(16) NOT NULL DEFAULT 'sponsoring' CHECK (kind IN ('sponsoring', 'income', 'expense')),
  amount           numeric(12,2) NOT NULL CHECK (amount >= 0),
  label            varchar(255),
  sponsor          varchar(255),
  entry_date       date,
  note             varchar(255),
  created_by_name  varchar(255),
  created_by_email varchar(255),
  date_created     timestamptz NOT NULL DEFAULT now(),
  user_created     uuid
);
CREATE INDEX IF NOT EXISTS finance_team_entries_team_idx ON finance_team_entries (team, fiscal_year);

COMMENT ON TABLE finance_team_entries IS
  'Per-team finance ledger: sponsoring/other income (IN) and bills/costs (OUT), per team + fiscal year. The teams-summary endpoint nets these with team-tagged native invoices.';

INSERT INTO directus_collections (collection, icon, color, "group", sort, archive_app_filter)
SELECT 'finance_team_entries', 'groups', '#059669', NULL, NULL, true
WHERE NOT EXISTS (SELECT 1 FROM directus_collections WHERE collection = 'finance_team_entries');

INSERT INTO directus_fields (collection, field, special, interface, display, sort, width, note)
SELECT 'finance_team_entries', 'team', 'm2o', 'select-dropdown-m2o', 'related-values', 1, 'half', 'Team this entry belongs to.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_team_entries' AND field = 'team');
INSERT INTO directus_fields (collection, field, special, interface, display, sort, width)
SELECT 'finance_team_entries', 'fiscal_year', 'm2o', 'select-dropdown-m2o', 'related-values', 2, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_team_entries' AND field = 'fiscal_year');
INSERT INTO directus_fields (collection, field, interface, options, sort, width)
SELECT 'finance_team_entries', 'kind', 'select-dropdown',
  '{"choices":[{"text":"Sponsoring","value":"sponsoring"},{"text":"Other income","value":"income"},{"text":"Expense","value":"expense"}]}'::json, 3, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_team_entries' AND field = 'kind');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_team_entries', 'amount', 'input', 4, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_team_entries' AND field = 'amount');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_team_entries', 'label', 'input', 5, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_team_entries' AND field = 'label');
INSERT INTO directus_fields (collection, field, interface, sort, width)
SELECT 'finance_team_entries', 'sponsor', 'input', 6, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_team_entries' AND field = 'sponsor');
INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'finance_team_entries', 'date_created', 'date-created', 'datetime', true, true, 90
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_team_entries' AND field = 'date_created');

INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'finance_team_entries', 'team', 'teams', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'finance_team_entries' AND many_field = 'team');
INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'finance_team_entries', 'fiscal_year', 'finance_fiscal_years', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'finance_team_entries' AND many_field = 'fiscal_year');

COMMIT;
