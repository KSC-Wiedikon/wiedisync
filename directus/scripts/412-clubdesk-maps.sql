-- Migration 412: the ClubDesk translation layer (phase 1 of the English-only DB
-- migration, plan: .planning/english-db-migration.md).
--
-- ClubDesk is German and stays German: its CSV headers and picklist values are a
-- hard contract (the import wizard auto-maps only exact labels and silently drops
-- unknown picklist values). Wiedisync's own schema moves to English. These two
-- tables are the ONE place where the two vocabularies meet — read by the JS sync
-- (import-clubdesk-csv.mjs, clubdesk-update.js, import-clubdesk-finance.mjs) and
-- by the SQL payload builders / views through cd_to_app() / app_to_cd().
--
--   clubdesk_field_map  ClubDesk header  ↔ wiedisync table.column (+ how to convert)
--   clubdesk_value_map  ClubDesk value   ↔ wiedisync English slug, per domain
--
-- ⚠ app_table / app_column / app_value hold the TARGET (English) names of the later
-- phases. Nothing reads these tables yet — consumers switch over in phases 2-3,
-- together with the column renames, so today's sync is unaffected.
--
-- Pull rule (phase 2+): a ClubDesk value with no row here is never written raw; it
-- is staged as a clubdesk_sync_proposals row instead. Push rule: only canonical
-- rows are pushed; is_canonical = false rows are legacy ClubDesk spellings that are
-- accepted on pull and mapped onto the current slug.
--
-- Countries are NOT duplicated here: transform 'country_primary' / 'country' uses
-- country_codes.name_de_clubdesk (push) and country_name_aliases (pull).
--
-- Like the finance tables (411), these are used through the system connection only
-- and are not registered as Directus collections. Schema-only + idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS clubdesk_field_map (
  id              serial PRIMARY KEY,
  feed            text NOT NULL CHECK (feed IN ('members', 'finance_bookings', 'finance_invoices')),
  clubdesk_header text NOT NULL,
  staging_column  text,          -- clubdesk_export column (members feed only)
  app_table       text,          -- NULL = staged / echoed only, never mapped into our tables
  app_column      text,
  direction       text NOT NULL CHECK (direction IN ('down', 'up', 'both', 'staged')),
  value_domain    text,          -- → clubdesk_value_map.domain; NULL = value travels verbatim
  transform       text CHECK (transform IN ('date_ch', 'datetime_ch', 'chf', 'phone', 'ahv', 'iban',
                                            'email', 'country', 'country_primary', 'yes_no', 'set')),
  notes           text,
  UNIQUE (feed, clubdesk_header)
);

CREATE TABLE IF NOT EXISTS clubdesk_value_map (
  id             serial PRIMARY KEY,
  domain         text NOT NULL,
  app_value      text NOT NULL,
  clubdesk_value text NOT NULL,
  is_canonical   boolean NOT NULL DEFAULT true,
  UNIQUE (domain, clubdesk_value)
);
-- exactly one value is pushed per slug
CREATE UNIQUE INDEX IF NOT EXISTS clubdesk_value_map_canonical_uq
  ON clubdesk_value_map (domain, app_value) WHERE is_canonical;

COMMENT ON TABLE clubdesk_field_map IS 'ClubDesk CSV header ↔ wiedisync column. ClubDesk stays German, wiedisync is English. Migration 412.';
COMMENT ON TABLE clubdesk_value_map IS 'ClubDesk picklist value ↔ wiedisync English slug, per domain. is_canonical=false = legacy spelling, pull only. Migration 412.';

-- ClubDesk value → our slug (exact first, then case/space-insensitive). NULL = unmapped.
CREATE OR REPLACE FUNCTION cd_to_app(p_domain text, p_value text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT app_value FROM clubdesk_value_map
   WHERE domain = p_domain
     AND (clubdesk_value = btrim(p_value)
          OR lower(regexp_replace(clubdesk_value, '\s+', '', 'g')) = lower(regexp_replace(p_value, '\s+', '', 'g')))
   ORDER BY (clubdesk_value = btrim(p_value)) DESC, is_canonical DESC
   LIMIT 1
$$;

-- Our slug → the canonical ClubDesk value. NULL = no ClubDesk equivalent.
CREATE OR REPLACE FUNCTION app_to_cd(p_domain text, p_value text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT clubdesk_value FROM clubdesk_value_map
   WHERE domain = p_domain AND app_value = p_value AND is_canonical
$$;

-- ── value map ──────────────────────────────────────────────────────────────────
INSERT INTO clubdesk_value_map (domain, app_value, clubdesk_value, is_canonical) VALUES
  ('salutation', 'mr', 'Herr', true),
  ('salutation', 'ms', 'Frau', true),

  ('sex', 'm', 'männlich', true),
  ('sex', 'f', 'weiblich', true),

  ('register_status', 'non_member', 'Kein Mitglied', true),
  ('register_status', 'active',     'Aktivmitglied', true),
  ('register_status', 'passive',    'Passivmitglied', true),
  ('register_status', 'honorary',   'Ehrenmitglied', true),
  ('register_status', 'former',     'Ehemaliges Mitglied', true),
  ('register_status', 'deceased',   'Verstorben', true),
  ('register_status', 'gap_year',   'Zwischenjahr', true),

  ('section', 'volleyball', 'Volleyball', true),
  ('section', 'basketball', 'Basketball', true),
  ('section', 'club',       'KSCW', true),

  -- current categories (CD_BEITRAG_MAP, clubdesk-update.js)
  ('fee_category', 'vb_employed',              'VB Erwerbstätige', true),
  ('fee_category', 'vb_student_league',        'VB Student*in Meisterschaft', true),
  ('fee_category', 'vb_pupil_league',          'VB Schüler*in Meisterschaft', true),
  ('fee_category', 'vb_pupil_tournament',      'VB Schüler*in Turnier', true),
  ('fee_category', 'vb_pupil_first_year',      'VB Schüler*in 1. Jahr', true),
  ('fee_category', 'vb_tournament_kwi',        'VB Turnier KWI', true),
  ('fee_category', 'bb_employed',              'BB Erwerbstätige', true),
  ('fee_category', 'bb_employed_first_league', 'BB Erwerbstätige 1. Liga', true),
  ('fee_category', 'bb_student',               'BB Lernende/Studierende', true),
  ('fee_category', 'bb_student_first_league',  'BB Lernende/Studierende 1. Liga', true),
  ('fee_category', 'bb_youth_league',          'BB Jugend Meisterschaft', true),
  ('fee_category', 'bb_minis_tournament',      'BB Minis Turnier', true),
  ('fee_category', 'bb_2_trainings',           'BB 2 Trainings', true),
  ('fee_category', 'bb_1_training',            'BB 1 Trainings', true),
  ('fee_category', 'passive',                  'Passivmitglied', true),
  ('fee_category', 'free',                     'Gratis', true),
  ('fee_category', 'none',                     'Kein Beitrag', true),
  -- legacy spellings still found in ClubDesk / old signup rows (pull only)
  ('fee_category', 'vb_student_league',        'VB Studenten/Lehrlinge', false),
  ('fee_category', 'vb_pupil_league',          'VB Schüler Meisterschaft', false),
  ('fee_category', 'vb_pupil_tournament',      'VB Schüler Turnier', false),
  ('fee_category', 'bb_employed',              'BB Erwerbstätig', false),
  ('fee_category', 'bb_employed_first_league', 'BB Erwerbstätig 1. Liga', false),
  ('fee_category', 'bb_student',               'BB Student/Lehrling', false),
  ('fee_category', 'bb_student',               'BB Studenten/Lehrlinge', false),
  ('fee_category', 'bb_student_first_league',  'BB Student/Lehrling 1. Liga', false),
  ('fee_category', 'bb_youth_league',          'BB Junior:innen', false),
  ('fee_category', 'bb_minis_tournament',      'BB Minis', false),
  ('fee_category', 'vb_pupil_first_year',      'VB Schüler*in erstes Jahr', false),
  -- old discounted student tier, only on historic invoices
  ('fee_category', 'vb_student_discounted',    'VB Studenten/Lehrlinge mit Abzug', true),

  ('official_licence', 'vb_scorer', 'VB SC', true),
  ('official_licence', 'otr1',      'OTR1', true),
  ('official_licence', 'otr2',      'OTR2', true),
  ('official_licence', 'otn1',      'OTN1', true),
  ('official_licence', 'otn2',      'OTN2', true),

  ('trainer_licence', 'js', 'J+S', true),
  ('trainer_licence', 'c',  'C', true),
  ('trainer_licence', 'b',  'B', true),
  ('trainer_licence', 'a',  'A', true),
  ('trainer_licence', 't1', 'Trainer 1', true),
  ('trainer_licence', 't2', 'Trainer 2', true),
  ('trainer_licence', 't3', 'Trainer 3', true),

  ('licence_category', 'official', 'Offizielle/r', true),

  ('yes_no', 'true',  'Ja', true),
  ('yes_no', 'false', 'Nein', true),

  ('group_function', 'player', 'Spieler*in', true),
  ('group_function', 'coach',  'Trainer*in', true),
  ('group_function', 'guest',  'Guest', true),

  -- pushed as an empty cell (kantonsschuleCell), so pull-only
  ('cantonal_school', 'none',  'Nein', false),
  ('cantonal_school', 'other', 'Andere Kantonsschule', false),

  ('invoice_status', 'draft',                      'Entwurf', true),
  ('invoice_status', 'issued',                     'Gestellt', true),
  ('invoice_status', 'paid',                       'Bezahlt', true),
  ('invoice_status', 'paid_partially_written_off', 'Bezahlt (teilw. abgeschrieben)', true),
  ('invoice_status', 'partially_paid',             'Teilweise bezahlt', true),
  ('invoice_status', 'cancelled',                  'Storniert', true),
  ('invoice_status', 'written_off',                'Abgeschrieben', true),

  ('booking_type', 'standard',                'Standard', true),
  ('booking_type', 'invoice',                 'Rechnung', true),
  ('booking_type', 'invoice_collective',      'Rechnung (Sammel)', true),
  ('booking_type', 'invoice_collective_item', 'Rechnung (Sammelposition)', true),
  ('booking_type', 'opening',                 'Eröffnung', true),
  ('booking_type', 'opening',                 'Eroeffnung', false),
  ('booking_type', 'closing',                 'Abschluss', true),
  ('booking_type', 'reversal',                'Storno', true)
ON CONFLICT (domain, clubdesk_value) DO NOTHING;

-- ── field map: member export / import ──────────────────────────────────────────
INSERT INTO clubdesk_field_map (feed, clubdesk_header, staging_column, app_table, app_column, direction, value_domain, transform, notes) VALUES
  ('members', '[Id]',                 'clubdesk_id',          'members', 'clubdesk_id',        'both',   NULL, NULL, 'import record identity; first column of UPDATE rows'),
  ('members', 'Wiedisync ID',         'wiedisync_id',         'members', 'uuid',               'both',   NULL, NULL, 'link key on pull; NOT a match key for the import wizard'),
  ('members', 'Vorname',              'first_name',           'members', 'first_name',         'both',   NULL, NULL, 'CREATE rows only — never on UPDATE rows (legal names)'),
  ('members', 'Nachname',             'last_name',            'members', 'last_name',          'both',   NULL, NULL, 'CREATE rows only — never on UPDATE rows (legal names)'),
  ('members', 'E-Mail',               'email',                'members', 'email',              'both',   NULL, 'email', 'pull via conflict rule only'),
  ('members', 'E-Mail Alternativ',    'email_alternative',    NULL,      NULL,                 'staged', NULL, NULL, 'linker / drift only'),
  ('members', 'Telefon Privat',       'phone_private',        'members', 'phone',              'both',   NULL, 'phone', NULL),
  ('members', 'Telefon Mobil',        'phone_mobile',         'members', 'phone',              'both',   NULL, 'phone', 'pull prefers Mobil over Privat'),
  ('members', 'Adresse',              'address',              'members', 'address',            'both',   NULL, NULL, NULL),
  ('members', 'PLZ',                  'postal_code',          'members', 'postal_code',        'both',   NULL, NULL, NULL),
  ('members', 'Ort',                  'city',                 'members', 'city',               'both',   NULL, NULL, NULL),
  ('members', 'Land',                 'country',              NULL,      NULL,                 'up',     NULL, 'country', 'Schweiz default, fill-only'),
  ('members', 'Geburtsdatum',         'birthdate',            'members', 'birthdate',          'both',   NULL, 'date_ch', NULL),
  ('members', 'Geschlecht',           'sex',                  'members', 'sex',                'both',   'sex', NULL, NULL),
  ('members', 'Anrede',               'salutation',           'members', 'salutation',         'both',   'salutation', NULL, NULL),
  ('members', 'Nationalität',         'nationality',          'members', 'nationality_codes',  'both',   NULL, 'country_primary', 'single value in ClubDesk = first code'),
  ('members', 'Federation of Origin', 'federation_of_origin', 'members', 'federation_of_origin','both',  NULL, 'country', NULL),
  ('members', 'AHV Nummer',           'ahv_number',           'members', 'ahv_number',         'both',   NULL, 'ahv', NULL),
  ('members', 'IBAN',                 'iban',                 'members', 'iban',               'both',   NULL, 'iban', 'pull via conflict rule only'),
  ('members', 'JS ID',                'js_id',                'members', 'js_id',              'down',   NULL, NULL, 'fill-only'),
  ('members', 'Trainer Lizenz',       'trainer_licence',      'members', 'trainer_licences',   'both',   'trainer_licence', 'set', 'free-text field in ClubDesk, e.g. "J+S, B"'),
  ('members', 'Gast',                 'guest',                NULL,      NULL,                 'up',     'yes_no', 'yes_no', 'derived from member_teams.guest_level; never pulled'),
  ('members', 'Beitragskategorie',    'fee_category',         'members', 'fee_category',       'both',   'fee_category', NULL, NULL),
  ('members', 'Mitgliederbeitrag',    'membership_fee',       NULL,      NULL,                 'up',     NULL, 'chf', 'derived on CREATE; echo on UPDATE'),
  ('members', 'Status',               'status',               'members', 'register_status',    'both',   'register_status', NULL, NULL),
  ('members', 'Eintritt',             'joined_on',            'members', 'joined_on',          'both',   NULL, 'date_ch', NULL),
  ('members', 'Austritt',             'left_on',              'members', 'left_on',            'both',   NULL, 'date_ch', 'only with a departed status'),
  ('members', 'Sektion',              'section',              'members', 'section',            'both',   'section', NULL, NULL),
  ('members', 'Lizenznummer',         'licence_no',           'members', 'license_nr',         'both',   NULL, NULL, 'fill-only on push'),
  ('members', 'Lizenzart',            'licence_type',         'members', 'licence_category',   'up',     'licence_category', NULL, 'Offizielle/r suppressed'),
  ('members', 'Lizenz bestellt',      'licence_ordered',      'members', 'licence_ordered_at', 'up',     NULL, 'date_ch', 'fill-only'),
  ('members', 'Offiziellen Lizenz',   'official_licence',     'members', 'scorer_vb,otr1_bb,otr2_bb,otn1_bb,otn2_bb', 'both', 'official_licence', 'set', 'pull = set_true only'),
  ('members', 'Mittelschule ZH',      'cantonal_school',      'members', 'cantonal_school',    'up',     'cantonal_school', NULL, 'picklist; Rämibühl sub-schools collapse'),
  ('members', 'Schiedsrichter',       NULL,                   'members', 'referee_vb,referee_bb', 'up',  'yes_no', 'yes_no', 'CREATE rows only'),
  ('members', '[Gruppen]',            'groups_bracketed',     NULL,      NULL,                 'down',   NULL, NULL, 'referee/scorer group flags'),
  ('members', 'Gruppen',              'groups',               NULL,      NULL,                 'staged', NULL, NULL, 'importing does not create group membership'),
  ('members', 'Gruppe',               'group_name',           NULL,      NULL,                 'staged', NULL, NULL, NULL),
  ('members', 'Funktion',             'function',             NULL,      NULL,                 'staged', 'group_function', NULL, NULL),
  ('members', 'Rolle',                'role',                 NULL,      NULL,                 'staged', NULL, NULL, NULL),
  ('members', '[Rolle]',              'role_bracketed',       NULL,      NULL,                 'staged', NULL, NULL, NULL),
  ('members', 'Firma',                'company',              NULL,      NULL,                 'staged', NULL, NULL, NULL),
  ('members', 'Titel',                'title',                NULL,      NULL,                 'staged', NULL, NULL, NULL),
  ('members', 'Briefanrede',          'letter_salutation',    NULL,      NULL,                 'staged', NULL, NULL, NULL),
  ('members', 'Benutzer-Id',          'user_id',              NULL,      NULL,                 'staged', NULL, NULL, NULL),
  ('members', 'Adress-Zusatz',        'address_extra',        NULL,      NULL,                 'staged', NULL, NULL, NULL),
  ('members', 'Telefon Geschäft',     'phone_business',       NULL,      NULL,                 'staged', NULL, NULL, NULL),
  ('members', 'Fax',                  'fax',                  NULL,      NULL,                 'staged', NULL, NULL, NULL),
  ('members', 'Mitgliedsjahre',       'membership_years',     NULL,      NULL,                 'staged', NULL, NULL, NULL),
  ('members', 'Zivilstand',           'marital_status',       NULL,      NULL,                 'staged', NULL, NULL, NULL),
  ('members', 'Alter',                'age',                  NULL,      NULL,                 'staged', NULL, NULL, NULL),
  ('members', 'Jahrgang',             'birth_year',           NULL,      NULL,                 'staged', NULL, NULL, NULL),
  ('members', 'Jg.',                  'birth_year_short',     NULL,      NULL,                 'staged', NULL, NULL, NULL),
  ('members', 'Bemerkungen',          'remarks',              NULL,      NULL,                 'staged', NULL, NULL, NULL),
  ('members', 'Firmen-Webseite',      'company_website',      NULL,      NULL,                 'staged', NULL, NULL, NULL),
  ('members', 'Rechnungsversand',     'invoice_delivery',     NULL,      NULL,                 'staged', NULL, NULL, NULL),
  ('members', 'Nie mahnen',           'never_dun',            NULL,      NULL,                 'staged', NULL, NULL, NULL),
  ('members', 'BIC',                  'bic',                  NULL,      NULL,                 'staged', NULL, NULL, NULL),
  ('members', 'Kontoinhaber',         'account_holder',       NULL,      NULL,                 'staged', NULL, NULL, NULL),
  ('members', 'Betrag Bezahlt',       'amount_paid',          NULL,      NULL,                 'staged', NULL, NULL, NULL),
  ('members', 'Clubnummer',           'club_number',          NULL,      NULL,                 'staged', NULL, NULL, NULL),
  ('members', 'Passivmitglied',       'passive_member',       NULL,      NULL,                 'staged', NULL, NULL, NULL),
  ('members', 'Offiziellen 100er',    'officials_surcharge',  NULL,      NULL,                 'staged', NULL, NULL, 'field deleted in ClubDesk'),
  ('members', '[Zuletzt geändert am]','last_changed_at',      NULL,      NULL,                 'staged', NULL, NULL, NULL),
  ('members', '[Zuletzt geändert von]','last_changed_by',     NULL,      NULL,                 'staged', NULL, NULL, NULL)
ON CONFLICT (feed, clubdesk_header) DO NOTHING;

-- ── field map: finance exports ─────────────────────────────────────────────────
INSERT INTO clubdesk_field_map (feed, clubdesk_header, app_table, app_column, direction, value_domain, transform, notes) VALUES
  ('finance_bookings', 'ID',                  'finance_transactions', 'clubdesk_id',           'down', NULL, NULL, 'keyed per fiscal year: "2025/26#17"'),
  ('finance_bookings', 'Typ',                 'finance_transactions', 'entry_type',            'down', 'booking_type', NULL, NULL),
  ('finance_bookings', 'Beleg',               'finance_transactions', 'voucher_no',            'down', NULL, NULL, NULL),
  ('finance_bookings', 'Datum',               'finance_transactions', 'booking_date',          'down', NULL, 'date_ch', NULL),
  ('finance_bookings', 'Text',                'finance_transactions', 'text',                  'down', NULL, NULL, NULL),
  ('finance_bookings', 'Soll (Nummer)',       'finance_transactions', 'debit_account_number',  'down', NULL, NULL, NULL),
  ('finance_bookings', 'Soll (Bezeichnung)',  'finance_transactions', 'debit_account_name',    'down', NULL, NULL, NULL),
  ('finance_bookings', 'Haben (Nummer)',      'finance_transactions', 'credit_account_number', 'down', NULL, NULL, NULL),
  ('finance_bookings', 'Haben (Bezeichnung)', 'finance_transactions', 'credit_account_name',   'down', NULL, NULL, NULL),
  ('finance_bookings', 'Betrag (CHF)',        'finance_transactions', 'amount_chf',            'down', NULL, 'chf', NULL),

  ('finance_invoices', 'Nummer',              'finance_invoices', 'number',             'down', NULL, NULL, 'also clubdesk_id'),
  ('finance_invoices', 'Rechnungsdatum',      'finance_invoices', 'invoice_date',       'down', NULL, 'date_ch', NULL),
  ('finance_invoices', 'Betreff',             'finance_invoices', 'subject',            'down', NULL, NULL, NULL),
  ('finance_invoices', 'Betrag',              'finance_invoices', 'amount',             'down', NULL, 'chf', NULL),
  ('finance_invoices', 'Status',              'finance_invoices', 'status',             'down', 'invoice_status', NULL, 'header appears twice; first wins'),
  ('finance_invoices', 'Mahnstatus',          'finance_invoices', 'dunning_level',      'down', NULL, NULL, 'parse the level number'),
  ('finance_invoices', 'Fällig am',           'finance_invoices', 'due_date',           'down', NULL, 'date_ch', NULL),
  ('finance_invoices', 'Betrag Bezahlt',      'finance_invoices', 'amount_paid',        'down', NULL, 'chf', NULL),
  ('finance_invoices', 'Offener Betrag',      'finance_invoices', 'open_amount',        'down', NULL, 'chf', NULL),
  ('finance_invoices', 'Überbezahlt Betrag',  'finance_invoices', 'overpaid_amount',    'down', NULL, 'chf', NULL),
  ('finance_invoices', 'Abgeschrieben Betrag','finance_invoices', 'written_off_amount', 'down', NULL, 'chf', NULL),
  ('finance_invoices', 'Zahlungsart',         'finance_invoices', 'payment_method',     'down', NULL, NULL, 'verbatim until a payment_method domain exists'),
  ('finance_invoices', 'Referenznummer',      'finance_invoices', 'reference',          'down', NULL, NULL, NULL),
  ('finance_invoices', 'Beitragskategorie',   'finance_invoices', 'fee_category',       'down', 'fee_category', NULL, NULL),
  ('finance_invoices', 'Abgeschlossen am',    'finance_invoices', 'closed_on',          'down', NULL, 'date_ch', NULL),
  ('finance_invoices', 'Erstellt am',         'finance_invoices', 'cd_created_at',      'down', NULL, 'datetime_ch', 'Zurich wall clock'),
  ('finance_invoices', 'Geändert am',         'finance_invoices', 'cd_changed_at',      'down', NULL, 'datetime_ch', 'Zurich wall clock'),
  ('finance_invoices', 'Empfänger',           'finance_invoices', 'recipient_name',     'down', NULL, NULL, NULL),
  ('finance_invoices', 'E-Mail',              'finance_invoices', 'recipient_email',    'down', NULL, 'email', NULL),
  ('finance_invoices', 'Benutzer-Id',         'finance_invoices', 'cd_user_id',         'down', NULL, NULL, NULL),
  ('finance_invoices', '[Id]',                'finance_invoices', 'cd_contact_id',      'down', NULL, NULL, 'recipient contact id, not the invoice id')
ON CONFLICT (feed, clubdesk_header) DO NOTHING;

COMMIT;
