-- Migration 064: clubdesk_export staging table
--
-- Holds the latest ClubDesk member export (Excel/CSV) for cross-check
-- queries against Directus `members`. Outside Directus collections by
-- design — no admin UI, no API exposure, queried only via psql/SQL by
-- operators. Imported via `npm run db:clubdesk:import:{dev|prod}` which
-- TRUNCATEs and re-COPYs from a CSV (one Funktion-row per ClubDesk
-- person; the deduping happens in views).
--
-- Columns are all TEXT — we don't trust ClubDesk types (dates are
-- dd.mm.yyyy strings, ints are stringly-typed, several columns are
-- mostly empty). Cast in queries where needed.
--
-- The export has FOUR duplicate column names (Gruppe×2, Funktion×2,
-- Rolle×2, Gruppen×2). They're flattened here with `_2` suffixes in
-- the same positional order as the source CSV header.

BEGIN;

CREATE TABLE IF NOT EXISTS clubdesk_export (
  row_id              BIGSERIAL PRIMARY KEY,
  imported_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_file         TEXT,
  -- Source columns in CSV header order (60 columns, 4 duplicates suffixed _2)
  gruppe              TEXT,  -- col 0
  funktion            TEXT,  -- col 1
  nachname            TEXT,  -- col 2
  vorname             TEXT,  -- col 3
  firma               TEXT,
  rolle               TEXT,  -- col 5
  rolle_2             TEXT,  -- col 6 (duplicate header)
  anrede              TEXT,
  titel               TEXT,
  briefanrede         TEXT,
  benutzer_id         TEXT,
  adresse             TEXT,
  adress_zusatz       TEXT,
  plz                 TEXT,
  ort                 TEXT,
  land                TEXT,
  nationalitaet       TEXT,
  telefon_privat      TEXT,
  telefon_geschaeft   TEXT,
  telefon_mobil       TEXT,
  fax                 TEXT,
  email               TEXT,  -- col 21
  email_alternativ    TEXT,  -- col 22
  gruppen             TEXT,  -- col 23  (comma-list of all Gruppen the person belongs to)
  status              TEXT,  -- col 24  (Aktivmitglied / Passivmitglied / Ehemaliges Mitglied)
  eintritt            TEXT,
  mitgliedsjahre      TEXT,
  austritt            TEXT,
  zivilstand          TEXT,
  geschlecht          TEXT,
  geburtsdatum        TEXT,
  alter_              TEXT,  -- `alter` is reserved in SQL
  jahrgang            TEXT,
  bemerkungen         TEXT,
  firmen_webseite     TEXT,
  rechnungsversand    TEXT,
  nie_mahnen          TEXT,
  iban                TEXT,
  bic                 TEXT,
  kontoinhaber        TEXT,
  lizenznummer        TEXT,  -- col 40  (SVRZ licence number, joins to members.license_nr)
  lizenzart           TEXT,
  lizenz_bestellt     TEXT,
  sektion             TEXT,  -- col 43  (Volleyball / Basketball / KSCW / "")
  beitragskategorie   TEXT,
  betrag_bezahlt      TEXT,
  clubnummer          TEXT,
  mittelschule_zh     TEXT,
  offiziellen_lizenz  TEXT,  -- col 48  ("Volleyball Lizenz" ⇒ has scorer licence)
  mitgliederbeitrag   TEXT,
  ahv_nummer          TEXT,
  passivmitglied      TEXT,
  offiziellen_100er   TEXT,
  gruppe_2            TEXT,  -- col 53 (duplicate header)
  funktion_2          TEXT,  -- col 54
  gruppen_2           TEXT,  -- col 55
  jg                  TEXT,
  clubdesk_id         TEXT,  -- col 57  ([Id] in export)
  zuletzt_geaendert_am   TEXT,
  zuletzt_geaendert_von  TEXT
);

CREATE INDEX IF NOT EXISTS idx_clubdesk_export_email ON clubdesk_export ((LOWER(email)));
CREATE INDEX IF NOT EXISTS idx_clubdesk_export_email_alt ON clubdesk_export ((LOWER(email_alternativ)));
CREATE INDEX IF NOT EXISTS idx_clubdesk_export_lic ON clubdesk_export (lizenznummer);
CREATE INDEX IF NOT EXISTS idx_clubdesk_export_clubdesk_id ON clubdesk_export (clubdesk_id);
CREATE INDEX IF NOT EXISTS idx_clubdesk_export_sektion ON clubdesk_export (sektion);

REVOKE ALL ON clubdesk_export FROM PUBLIC;
REVOKE ALL ON clubdesk_export FROM anon, authenticated;

-- Singleton metadata: when was the latest import, what file, how many rows
CREATE TABLE IF NOT EXISTS clubdesk_export_meta (
  id              INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_import_at  TIMESTAMPTZ,
  source_file     TEXT,
  row_count       INT
);
INSERT INTO clubdesk_export_meta (id) VALUES (1) ON CONFLICT DO NOTHING;
REVOKE ALL ON clubdesk_export_meta FROM PUBLIC;
REVOKE ALL ON clubdesk_export_meta FROM anon, authenticated;

-- ── Convenience views ──────────────────────────────────────────────
-- ClubDesk exports one row per (person, Gruppe/Funktion) — so the same
-- person typically appears multiple times. `clubdesk_people` collapses
-- to one row per person, keeping their identifying fields and the
-- comma-list of Gruppen they belong to.

CREATE OR REPLACE VIEW clubdesk_people AS
SELECT DISTINCT ON (COALESCE(NULLIF(clubdesk_id, ''), LOWER(NULLIF(email, ''))))
  clubdesk_id, nachname, vorname, email, email_alternativ,
  status, geschlecht, geburtsdatum, jahrgang, alter_,
  lizenznummer, lizenzart, sektion, beitragskategorie,
  offiziellen_lizenz, passivmitglied, telefon_mobil,
  gruppen, imported_at
FROM clubdesk_export
ORDER BY COALESCE(NULLIF(clubdesk_id, ''), LOWER(NULLIF(email, ''))), row_id;

CREATE OR REPLACE VIEW clubdesk_volleyball AS
SELECT * FROM clubdesk_people WHERE sektion = 'Volleyball';

REVOKE ALL ON clubdesk_people FROM PUBLIC;
REVOKE ALL ON clubdesk_people FROM anon, authenticated;
REVOKE ALL ON clubdesk_volleyball FROM PUBLIC;
REVOKE ALL ON clubdesk_volleyball FROM anon, authenticated;

COMMIT;
