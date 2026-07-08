#!/usr/bin/env node
/**
 * import-clubdesk-csv.mjs — Load a ClubDesk member export into the
 * `clubdesk_export` staging table (migrations 064 + 065).
 *
 * Usage:
 *   node directus/scripts/import-clubdesk-csv.mjs <env> <csv-path>
 *
 *   <env>      ∈ { dev, prod }
 *   <csv-path> — path on local machine. CP1252-encoded, semicolon-delimited.
 *
 * Handles both ClubDesk export shapes:
 *   1. Section-filtered (Sektion=Volleyball etc.) — 60 cols, Gruppe + Funktion
 *      duplicated as leading iterator keys AND trailing detail columns.
 *   2. Full-club export — 58 cols, no duplicates, includes [Gruppen] and
 *      [Rolle] bracketed system columns.
 *
 * The script is HEADER-NAME-aware:
 *   - Reads the first row, maps each source column name to a known target
 *     column (with `_2` suffix for repeated names).
 *   - Reorders each data row to match the target table's column order.
 *   - Unmapped headers are dropped with a warning; missing target columns
 *     are filled with NULL.
 *
 * No npm deps — only node:child_process / node:fs / built-in TextDecoder.
 */

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

const ENVS = {
  dev:  { container: 'supabase-db-vek42jyj0owoutoouq29aisq', database: 'directus_kscw_dev', user: 'supabase_admin' },
  prod: { container: 'supabase-db-vek42jyj0owoutoouq29aisq', database: 'postgres',          user: 'supabase_admin' },
}

const rawArgs = process.argv.slice(2)
// --local (or CLUBDESK_IMPORT_LOCAL=1): run `docker exec` directly instead of
// hopping through `ssh hetzner` — used when this runs ON the VPS (e.g. cron).
const LOCAL = process.env.CLUBDESK_IMPORT_LOCAL === '1' || rawArgs.includes('--local')
// --emit-sql: print the psql script to stdout instead of running it, so a caller
// that can't reach the DB (e.g. the scrape running in a container) can pipe it
// into the pg container itself. Progress logs go to stderr to keep stdout clean.
const EMIT_SQL = rawArgs.includes('--emit-sql')
const [envName, csvPath] = rawArgs.filter((a) => !a.startsWith('--'))
if (!envName || !ENVS[envName] || !csvPath) {
  console.error('Usage: import-clubdesk-csv.mjs <dev|prod> <csv-path> [--local]')
  process.exit(1)
}
const env = ENVS[envName]

// ── Header-name → table-column map ─────────────────────────────────
// Keys are CSV header strings (with `_2` suffix appended by the
// dedup step for repeated headers). Values are clubdesk_export column
// names from migration 064 + 065.
const HEADER_TO_COL = {
  // Standard columns
  'Gruppe': 'gruppe',                                   'Funktion': 'funktion',
  'Nachname': 'nachname',                               'Vorname': 'vorname',
  'Firma': 'firma',                                     'Rolle': 'rolle',
  'Anrede': 'anrede',                                   'Titel': 'titel',
  'Briefanrede': 'briefanrede',                         'Benutzer-Id': 'benutzer_id',
  'Adresse': 'adresse',                                 'Adress-Zusatz': 'adress_zusatz',
  'PLZ': 'plz',                                         'Ort': 'ort',
  'Land': 'land',                                       'Nationalität': 'nationalitaet',
  'Telefon Privat': 'telefon_privat',                   'Telefon Geschäft': 'telefon_geschaeft',
  'Telefon Mobil': 'telefon_mobil',                     'Fax': 'fax',
  'E-Mail': 'email',                                    'E-Mail Alternativ': 'email_alternativ',
  'Gruppen': 'gruppen',                                 'Status': 'status',
  'Eintritt': 'eintritt',                               'Mitgliedsjahre': 'mitgliedsjahre',
  'Austritt': 'austritt',                               'Zivilstand': 'zivilstand',
  'Geschlecht': 'geschlecht',                           'Geburtsdatum': 'geburtsdatum',
  'Alter': 'alter_',                                    'Jahrgang': 'jahrgang',
  'Bemerkungen': 'bemerkungen',                         'Firmen-Webseite': 'firmen_webseite',
  'Rechnungsversand': 'rechnungsversand',               'Nie mahnen': 'nie_mahnen',
  'IBAN': 'iban',                                       'BIC': 'bic',
  'Kontoinhaber': 'kontoinhaber',                       'Lizenznummer': 'lizenznummer',
  'Lizenzart': 'lizenzart',                             'Lizenz bestellt': 'lizenz_bestellt',
  'Sektion': 'sektion',                                 'Beitragskategorie': 'beitragskategorie',
  'Betrag Bezahlt': 'betrag_bezahlt',                   'Clubnummer': 'clubnummer',
  'Mittelschule ZH': 'mittelschule_zh',                 'Offiziellen Lizenz': 'offiziellen_lizenz',
  'Mitgliederbeitrag': 'mitgliederbeitrag',             'AHV Nummer': 'ahv_nummer',
  'Passivmitglied': 'passivmitglied',                   'Offiziellen 100er': 'offiziellen_100er',
  'Jg.': 'jg',                                          '[Id]': 'clubdesk_id',
  'Wiedisync ID': 'wiedisync_id',                       // custom field: wiedisync's own member id (push round-trip key)
  // J+S Personennummer (SALTO). Down-sync only (fill-only into members.js_id).
  // Column header in ClubDesk is "JS ID" (created 2026-07-08).
  'JS ID': 'js_id',
  '[Zuletzt geändert am]': 'zuletzt_geaendert_am',      '[Zuletzt geändert von]': 'zuletzt_geaendert_von',
  // Bracketed system variants (full-club export only — migration 065)
  '[Gruppen]': 'gruppen_bracketed',                     '[Rolle]': 'rolle_bracketed',
  // Duplicate headers (section-filtered export adds trailing detail cols)
  'Gruppe_2': 'gruppe_2',                               'Funktion_2': 'funktion_2',
  'Gruppen_2': 'gruppen_2',                             'Rolle_2': 'rolle_2',
}

// Target column order (must match \copy column list below)
const TARGET_COLS = [
  'gruppe','funktion','nachname','vorname','firma',
  'rolle','rolle_2','anrede','titel','briefanrede',
  'benutzer_id','adresse','adress_zusatz','plz','ort',
  'land','nationalitaet','telefon_privat','telefon_geschaeft','telefon_mobil',
  'fax','email','email_alternativ','gruppen','status',
  'eintritt','mitgliedsjahre','austritt','zivilstand','geschlecht',
  'geburtsdatum','alter_','jahrgang','bemerkungen','firmen_webseite',
  'rechnungsversand','nie_mahnen','iban','bic','kontoinhaber',
  'lizenznummer','lizenzart','lizenz_bestellt','sektion','beitragskategorie',
  'betrag_bezahlt','clubnummer','mittelschule_zh','offiziellen_lizenz','mitgliederbeitrag',
  'ahv_nummer','passivmitglied','offiziellen_100er','gruppe_2','funktion_2',
  'gruppen_2','jg','clubdesk_id','zuletzt_geaendert_am','zuletzt_geaendert_von',
  'gruppen_bracketed','rolle_bracketed','wiedisync_id','js_id',
]

// ── 1. Decode CSV (CP1252 → UTF-8) ──────────────────────────────────
const text = new TextDecoder('windows-1252').decode(readFileSync(csvPath))

// ── 2. Parse CSV (state machine; handles quoted fields w/ embedded newlines) ─
function parseCsv(s, delim = ';') {
  const rows = []
  let row = [], field = '', inQ = false, i = 0
  while (i < s.length) {
    const c = s[i]
    if (inQ) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i += 2 }
      else if (c === '"') { inQ = false; i++ }
      else { field += c; i++ }
    } else {
      if (c === '"' && field === '') { inQ = true; i++ }
      else if (c === delim) { row.push(field); field = ''; i++ }
      else if (c === '\r') { i++ }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++ }
      else { field += c; i++ }
    }
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  return rows
}

const allRows = parseCsv(text)
if (allRows.length < 2) {
  console.error('CSV has fewer than 2 rows — empty or unreadable.')
  process.exit(1)
}
const headerRaw = allRows[0]
const dataRows = allRows.slice(1).filter(r => r.some(c => c && c.length))

// ── 3. Build header → target-column index map (dedup repeated names) ─
const seen = new Map()
const sourceColNames = headerRaw.map(h => {
  const n = (seen.get(h) || 0) + 1
  seen.set(h, n)
  return n === 1 ? h : `${h}_${n}`
})
const sourceIxToTarget = sourceColNames.map(name => HEADER_TO_COL[name] || null)
const unmapped = sourceColNames.filter(n => !HEADER_TO_COL[n])
if (unmapped.length) {
  console.warn(`⚠ Unmapped CSV headers (dropped): ${unmapped.join(', ')}`)
}

// targetCol -> source index (for fast row reorder)
const targetToSourceIx = {}
sourceIxToTarget.forEach((tc, srcIx) => { if (tc) targetToSourceIx[tc] = srcIx })

// ── 4. Emit CSV in target column order ──────────────────────────────
const csvEscape = (s) => {
  if (s == null || s === '') return ''
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const outLines = dataRows.map(row =>
  TARGET_COLS.map(tc => {
    const srcIx = targetToSourceIx[tc]
    return srcIx == null ? '' : csvEscape(row[srcIx] || '')
  }).join(';')
)

// ── 5. Send to psql via SSH ─────────────────────────────────────────
const fileTag = basename(csvPath).replace(/'/g, "''")
const psqlInput =
  'BEGIN;\n' +
  'TRUNCATE clubdesk_export RESTART IDENTITY;\n' +
  `\\copy clubdesk_export(${TARGET_COLS.join(', ')}) FROM STDIN WITH (FORMAT csv, DELIMITER ';', QUOTE '"', NULL '');\n` +
  outLines.join('\n') + '\n' +
  '\\.\n' +
  `UPDATE clubdesk_export_meta SET last_import_at = NOW(), source_file = '${fileTag}', row_count = (SELECT COUNT(*) FROM clubdesk_export) WHERE id = 1;\n` +
  'COMMIT;\n' +
  "SELECT 'rows', (SELECT COUNT(*) FROM clubdesk_export), 'volleyball', (SELECT COUNT(*) FROM clubdesk_volleyball), 'last_import', (SELECT last_import_at FROM clubdesk_export_meta WHERE id=1);\n" +
  // ── Apply ClubDesk birthdates to members (minor-protection dependency) ──
  // members.birthdate gates public roster visibility: the public team API strips
  // under-18s and treats a MISSING birthdate as a minor (hidden — see the public
  // /kscw/public/team/:id endpoint + the public /items/members permission filter).
  // ClubDesk is the source of truth, so fill NULL birthdates from clubdesk_export
  // on every sync — otherwise new members regress to "hidden". Never overwrite an
  // existing birthdate. Two unambiguous passes (each only applies a single distinct
  // dob per member): (1) licence — lizenznummer is 1:1 per person, authoritative;
  // (2) email guarded by a first-name token match, so a shared family email cannot
  // cross-assign a birthdate. A failed/accented name match simply skips (the member
  // stays hidden = fail-safe). Only well-formed, calendar-valid dd.mm.yyyy parses.
  // Own transaction so a match hiccup never rolls back the staging load above.
  'BEGIN;\n' +
  'WITH cd AS (\n' +
  "  SELECT lower(btrim(lizenznummer)) AS lic, to_date(geburtsdatum,'DD.MM.YYYY') AS dob\n" +
  '  FROM clubdesk_export\n' +
  "  WHERE geburtsdatum ~ '^[0-9]{2}\\.[0-9]{2}\\.[0-9]{4}$'\n" +
  "    AND to_char(to_date(geburtsdatum,'DD.MM.YYYY'),'DD.MM.YYYY') = geburtsdatum),\n" +
  'lic_match AS (\n' +
  '  SELECT m.id, min(cd.dob) AS dob FROM members m\n' +
  "  JOIN cd ON cd.lic <> '' AND cd.lic = lower(btrim(m.license_nr))\n" +
  "  WHERE m.birthdate IS NULL AND btrim(coalesce(m.license_nr,'')) <> ''\n" +
  '  GROUP BY m.id HAVING count(DISTINCT cd.dob) = 1)\n' +
  'UPDATE members m SET birthdate = lic_match.dob\n' +
  '  FROM lic_match WHERE m.id = lic_match.id AND m.birthdate IS NULL;\n' +
  'WITH cd AS (\n' +
  '  SELECT lower(btrim(email)) AS email, lower(btrim(email_alternativ)) AS email_alt,\n' +
  "         lower(btrim(nachname)) AS nachname,\n" +
  "         lower(split_part(btrim(vorname),' ',1)) AS vn1, to_date(geburtsdatum,'DD.MM.YYYY') AS dob\n" +
  '  FROM clubdesk_export\n' +
  "  WHERE geburtsdatum ~ '^[0-9]{2}\\.[0-9]{2}\\.[0-9]{4}$'\n" +
  "    AND to_char(to_date(geburtsdatum,'DD.MM.YYYY'),'DD.MM.YYYY') = geburtsdatum),\n" +
  // Last-name equality guard (audit #13): a shared family email + same first
  // name (child 'Thomas' on the parent 'Thomas Müller's address) would otherwise
  // stamp the parent's adult DOB onto the minor, flipping the public roster's
  // minor-protection to expose the child. The contact-fields pass + clubdesk_id
  // linker already AND last-name equality; this pass must match them.
  'email_match AS (\n' +
  '  SELECT m.id, min(cd.dob) AS dob FROM members m\n' +
  "  JOIN cd ON btrim(coalesce(m.email,'')) <> '' AND lower(btrim(m.email)) IN (cd.email, cd.email_alt)\n" +
  "   AND lower(btrim(m.last_name)) = cd.nachname\n" +
  "   AND lower(split_part(btrim(m.first_name),' ',1)) = cd.vn1\n" +
  '  WHERE m.birthdate IS NULL\n' +
  '  GROUP BY m.id HAVING count(DISTINCT cd.dob) = 1)\n' +
  'UPDATE members m SET birthdate = email_match.dob\n' +
  '  FROM email_match WHERE m.id = email_match.id AND m.birthdate IS NULL;\n' +
  'COMMIT;\n' +
  "SELECT 'members_missing_birthdate' AS metric, (SELECT count(*) FROM members WHERE birthdate IS NULL) AS value;\n" +
  // (The Geschlecht→sex and Anrede/Nationalität/AHV fill passes run AFTER the
  // clubdesk_id linker below, so members linked in THIS run are filled in the
  // same run instead of waiting a whole sync cycle.)
  // ── Propagate ClubDesk contact fields to members (finance member explorer) ──
  // The scrape stages address/category/sektion/phone for every member, but only
  // birthdate was ever applied. Fill the rest so the finance Members view mirrors
  // ClubDesk. ClubDesk-authoritative fields (beitragskategorie, sektion — members
  // can't edit them) always update; member-editable ones (adresse/plz/ort/phone)
  // fill only when empty so a member's own profile edit is never clobbered.
  // Matched by licence (1:1) then email(+alt) with a last-name equality + first-name-
  // token guard (same safe matching as the birthdate passes + the clubdesk_id linker).
  // The last-name guard stops a shared family email (parent↔child) cross-assigning each
  // other's authoritative Beitragskategorie/address. Own transaction.
  'BEGIN;\n' +
  'WITH cd AS (\n' +
  '  SELECT lower(btrim(lizenznummer)) lic,\n' +
  "         left(NULLIF(btrim(adresse),''),255) adresse, left(NULLIF(btrim(plz),''),10) plz, left(NULLIF(btrim(ort),''),100) ort,\n" +
  "         left(NULLIF(btrim(beitragskategorie),''),100) categ, left(NULLIF(btrim(sektion),''),32) sektion,\n" +
  // Phone fills ONLY when canonical (kscw_normalize_phone, migration 186/189
  // policy 2026-07-07): an unrewritable ClubDesk value (legacy 9-digit, free
  // text, Excel-mangled) is NOT imported — same rule as the AHV intake. The
  // member re-enters their number in the profile; garbage never crosses over.
  "         kscw_normalize_phone(left(COALESCE(NULLIF(btrim(telefon_mobil),''), NULLIF(btrim(telefon_privat),'')),255)) phone\n" +
  "  FROM clubdesk_export WHERE NULLIF(btrim(lizenznummer),'') IS NOT NULL),\n" +
  'mt AS (\n' +
  '  SELECT DISTINCT ON (mm.id) mm.id, cd.adresse, cd.plz, cd.ort, cd.categ, cd.sektion, cd.phone\n' +
  '  FROM members mm JOIN cd ON cd.lic = lower(btrim(mm.license_nr))\n' +
  "  WHERE NULLIF(btrim(mm.license_nr),'') IS NOT NULL\n" +
  '  ORDER BY mm.id, cd.categ NULLS LAST, cd.adresse NULLS LAST)\n' +
  'UPDATE members t SET\n' +
  '  beitragskategorie = COALESCE(mt.categ, t.beitragskategorie), sektion = COALESCE(mt.sektion, t.sektion),\n' +
  "  adresse = COALESCE(NULLIF(btrim(t.adresse),''), mt.adresse), plz = COALESCE(NULLIF(btrim(t.plz),''), mt.plz),\n" +
  "  ort = COALESCE(NULLIF(btrim(t.ort),''), mt.ort), phone = COALESCE(NULLIF(btrim(t.phone),''), mt.phone)\n" +
  'FROM mt WHERE t.id = mt.id;\n' +
  'WITH cd AS (\n' +
  '  SELECT lower(btrim(email)) email, lower(btrim(email_alternativ)) email_alt,\n' +
  "         lower(btrim(nachname)) nachname, lower(split_part(btrim(vorname),' ',1)) vn1,\n" +
  "         left(NULLIF(btrim(adresse),''),255) adresse, left(NULLIF(btrim(plz),''),10) plz, left(NULLIF(btrim(ort),''),100) ort,\n" +
  "         left(NULLIF(btrim(beitragskategorie),''),100) categ, left(NULLIF(btrim(sektion),''),32) sektion,\n" +
  // Phone fills ONLY when canonical (kscw_normalize_phone, migration 186/189
  // policy 2026-07-07): an unrewritable ClubDesk value (legacy 9-digit, free
  // text, Excel-mangled) is NOT imported — same rule as the AHV intake. The
  // member re-enters their number in the profile; garbage never crosses over.
  "         kscw_normalize_phone(left(COALESCE(NULLIF(btrim(telefon_mobil),''), NULLIF(btrim(telefon_privat),'')),255)) phone\n" +
  '  FROM clubdesk_export),\n' +
  'mt AS (\n' +
  '  SELECT DISTINCT ON (mm.id) mm.id, cd.adresse, cd.plz, cd.ort, cd.categ, cd.sektion, cd.phone\n' +
  "  FROM members mm JOIN cd ON NULLIF(btrim(mm.email),'') IS NOT NULL\n" +
  '       AND lower(btrim(mm.email)) IN (cd.email, cd.email_alt)\n' +
  '       AND lower(btrim(mm.last_name)) = cd.nachname\n' +
  "       AND lower(split_part(btrim(mm.first_name),' ',1)) = cd.vn1\n" +
  '  ORDER BY mm.id, cd.categ NULLS LAST, cd.adresse NULLS LAST)\n' +
  'UPDATE members t SET\n' +
  '  beitragskategorie = COALESCE(mt.categ, t.beitragskategorie), sektion = COALESCE(mt.sektion, t.sektion),\n' +
  "  adresse = COALESCE(NULLIF(btrim(t.adresse),''), mt.adresse), plz = COALESCE(NULLIF(btrim(t.plz),''), mt.plz),\n" +
  "  ort = COALESCE(NULLIF(btrim(t.ort),''), mt.ort), phone = COALESCE(NULLIF(btrim(t.phone),''), mt.phone)\n" +
  'FROM mt WHERE t.id = mt.id;\n' +
  'COMMIT;\n' +
  "SELECT 'members_with_address' AS metric, (SELECT count(*) FROM members WHERE NULLIF(btrim(adresse),'') IS NOT NULL) AS value;\n" +
  // ── Link members.clubdesk_id from staging (the sync-up "is this contact already
  // in ClubDesk?" key) ────────────────────────────────────────────────────────
  // Migration 158 did this once, but only matched email + a ONE-directional first-
  // name prefix (member-name LIKE clubdesk-name||'%'), so a member stored under a
  // short form ("Alex") never linked to the full ClubDesk name ("Alexander") even
  // with an identical email AND licence — leaving them falsely listed as "not yet
  // in ClubDesk" and at risk of being DUPLICATED on sync-up. Re-link on every sync,
  // NULL-only (never clobber a manual/existing link): (1) licence (1:1, authoritative,
  // no name needed); (2) email(+alt) + last-name equality + SYMMETRIC first-name
  // prefix (handles Alex↔Alexander, Nico↔Nicolas, Sharu↔Sharusanth). last-name
  // equality guards a shared family email from cross-linking parent↔child. Only
  // unambiguous matches (one distinct clubdesk_id) are applied. Own transaction.
  //
  // REVERSE-uniqueness guard: HAVING count(DISTINCT cd.cdid)=1 only stops ONE member
  // matching MANY contacts. It does NOT stop MANY members matching ONE contact — two
  // family members sharing an email/similar name would otherwise be assigned the SAME
  // clubdesk_id, corrupting departed-detection (both deactivated when one leaves) and
  // sync-up. So each pass also filters to cdids that map to exactly ONE candidate
  // member AND are not already held by another member (NOT EXISTS). A cdid claimed by
  // >1 member is SKIPPED and reported below ('clubdesk_link_ambiguous') for a human to
  // link manually. These app-level guards are now belt-and-braces on top of the
  // partial unique index members_clubdesk_id_uq (migration 170): a dup assignment that
  // slips past them aborts THIS linker's own transaction loudly (surfaces in the sync
  // log) rather than silently corrupting — so don't "simplify away" the CTEs.
  'BEGIN;\n' +
  // ── Wiedisync ID link (2026-07-07) — the AUTHORITATIVE key, runs FIRST ──────
  // wiedisync pushes its member UUID (members.uuid, migration 184; pre-184
  // pushes carried the numeric members.id) into the ClubDesk "Wiedisync ID"
  // custom field on every create+update; here we read it straight back and link
  // by an EXACT key match — immune to the name/email/accent drift the heuristic
  // passes below suffer (it is what closes the create round-trip
  // up→[Id]→down-link). Both key formats stay accepted forever: UUID → uuid,
  // digits → id. Same unambiguity + not-already-held guards as the other
  // passes; the partial unique index members_clubdesk_id_uq is the final
  // backstop.
  'WITH cd AS (\n' +
  "  SELECT btrim(clubdesk_id) cdid, lower(btrim(wiedisync_id)) wid FROM clubdesk_export\n" +
  "  WHERE NULLIF(btrim(clubdesk_id),'') IS NOT NULL\n" +
  "    AND (btrim(wiedisync_id) ~ '^[0-9]+$'\n" +
  "         OR btrim(wiedisync_id) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')),\n" +
  'wid_match AS (\n' +
  '  SELECT mm.id, min(cd.cdid) cdid FROM members mm\n' +
  '  JOIN cd ON cd.wid = CASE WHEN cd.wid ~ \'^[0-9]+$\' THEN mm.id::text ELSE mm.uuid::text END\n' +
  '  WHERE mm.clubdesk_id IS NULL\n' +
  '  GROUP BY mm.id HAVING count(DISTINCT cd.cdid) = 1),\n' +
  'wid_uniq AS (SELECT cdid FROM wid_match GROUP BY cdid HAVING count(*) = 1)\n' +
  'UPDATE members m SET clubdesk_id = wid_match.cdid\n' +
  '  FROM wid_match JOIN wid_uniq USING (cdid)\n' +
  '  WHERE m.id = wid_match.id AND m.clubdesk_id IS NULL\n' +
  '    AND NOT EXISTS (SELECT 1 FROM members x WHERE x.clubdesk_id = wid_match.cdid);\n' +
  'WITH cd AS (\n' +
  '  SELECT btrim(clubdesk_id) cdid, lower(btrim(email)) email, lower(btrim(email_alternativ)) email_alt,\n' +
  "         lower(btrim(lizenznummer)) lic, lower(btrim(nachname)) nachname,\n" +
  "         lower(split_part(btrim(vorname),' ',1)) vn1\n" +
  "  FROM clubdesk_export WHERE NULLIF(btrim(clubdesk_id),'') IS NOT NULL),\n" +
  'lic_match AS (\n' +
  '  SELECT mm.id, min(cd.cdid) cdid FROM members mm\n' +
  "  JOIN cd ON cd.lic <> '' AND cd.lic = lower(btrim(mm.license_nr))\n" +
  "  WHERE mm.clubdesk_id IS NULL AND NULLIF(btrim(mm.license_nr),'') IS NOT NULL\n" +
  '  GROUP BY mm.id HAVING count(DISTINCT cd.cdid) = 1),\n' +
  'lic_uniq AS (SELECT cdid FROM lic_match GROUP BY cdid HAVING count(*) = 1)\n' +
  'UPDATE members m SET clubdesk_id = lic_match.cdid\n' +
  '  FROM lic_match JOIN lic_uniq USING (cdid)\n' +
  '  WHERE m.id = lic_match.id AND m.clubdesk_id IS NULL\n' +
  '    AND NOT EXISTS (SELECT 1 FROM members x WHERE x.clubdesk_id = lic_match.cdid);\n' +
  // ACCENT-INSENSITIVE name match (2026-07-07): compare unaccent()ed names on
  // both sides. Our sync-UP transliterates letters CP1252 can't hold (ć→c, ń→n,
  // ł→l — toCp1252Buffer), so a just-created contact is stored in ClubDesk with
  // an ASCII name while wiedisync keeps the accented original. An EXACT last-name
  // match then never links it → the member is stranded "pushed, awaiting link"
  // forever (the Kacper Krawczyński/Krawczynski case). unaccent() normalises both
  // sides identically (verified: Krawczyński→Krawczynski, Curavić→Curavic,
  // łódź→lodz), so the create round-trip (up → new [Id] → down-link) closes even
  // for accented names. email + first-name still constrain, so no family mislink.
  'WITH cd AS (\n' +
  '  SELECT btrim(clubdesk_id) cdid, lower(btrim(email)) email, lower(btrim(email_alternativ)) email_alt,\n' +
  "         unaccent(lower(btrim(nachname))) nachname, unaccent(lower(split_part(btrim(vorname),' ',1))) vn1\n" +
  "  FROM clubdesk_export WHERE NULLIF(btrim(clubdesk_id),'') IS NOT NULL),\n" +
  'email_match AS (\n' +
  '  SELECT mm.id, min(cd.cdid) cdid FROM members mm\n' +
  "  JOIN cd ON NULLIF(btrim(mm.email),'') IS NOT NULL AND lower(btrim(mm.email)) IN (cd.email, cd.email_alt)\n" +
  '       AND unaccent(lower(btrim(mm.last_name))) = cd.nachname\n' +
  // Blank-first-name guard (audit #15): a member with an empty first_name makes
  // split_part('',' ',1)='' → `cd.vn1 LIKE '%'` = TRUE for every contact, so the
  // first-name guard collapses to match-all. Require both sides non-empty.
  "       AND NULLIF(split_part(btrim(mm.first_name),' ',1),'') IS NOT NULL AND NULLIF(cd.vn1,'') IS NOT NULL\n" +
  "       AND (unaccent(lower(split_part(btrim(mm.first_name),' ',1))) LIKE cd.vn1 || '%'\n" +
  "            OR cd.vn1 LIKE unaccent(lower(split_part(btrim(mm.first_name),' ',1))) || '%')\n" +
  '  WHERE mm.clubdesk_id IS NULL\n' +
  '  GROUP BY mm.id HAVING count(DISTINCT cd.cdid) = 1),\n' +
  'email_uniq AS (SELECT cdid FROM email_match GROUP BY cdid HAVING count(*) = 1)\n' +
  'UPDATE members m SET clubdesk_id = email_match.cdid\n' +
  '  FROM email_match JOIN email_uniq USING (cdid)\n' +
  '  WHERE m.id = email_match.id AND m.clubdesk_id IS NULL\n' +
  '    AND NOT EXISTS (SELECT 1 FROM members x WHERE x.clubdesk_id = email_match.cdid);\n' +
  'COMMIT;\n' +
  "SELECT 'members_linked_clubdesk' AS metric, (SELECT count(*) FROM members WHERE clubdesk_id IS NOT NULL) AS value;\n" +
  // ── Create members for ClubDesk contacts with no Directus row (user 2026-07-07) ──
  // Every pass in this script UPDATEs existing members rows — a ClubDesk contact
  // with no members row was silently never created. That is why the ~167 Passiv-/
  // Ehrenmitglieder (and any future direct-in-ClubDesk signup) were missing from
  // Directus and from every member count derived from it. Create them here:
  // AFTER the linker (a contact that just linked to an existing member must not
  // be re-created) and BEFORE the sex/identity/contact passes (fresh rows get
  // enriched in this same run). Scope: CURRENT members only — Status ∈ Aktiv/
  // Passiv/Ehren/Zwischenjahr and no Austritt; 'Kein Mitglied' contacts
  // (companies, parents, suppliers) and departed members stay out of members.
  // clubdesk_id is set IN the insert: a row with clubdesk_id populated can never
  // enter the sync-up CREATE set (clubdesk-update.js builds creates from
  // whereNull('clubdesk_id')), so this pass cannot cause duplicate contacts in
  // ClubDesk. SAME-PERSON GUARDS: ClubDesk itself carries duplicate contacts for
  // one person (old exited twin + re-registered twin, married-name changes,
  // first/middle-name order swaps — 18 such found in the 2026-07-07 rehearsal,
  // sometimes with the members row linked to the STALE twin). A contact whose
  // cdid is unclaimed may therefore still BE an already-represented person, so
  // creation is skipped when ANY existing member (linked or not — unlinked also
  // covers fresh wiedisync registrations the linker couldn't link yet) matches:
  //   G1 same email + symmetric first-name prefix   (catches married-name change)
  //   G2 same last name + symmetric first-name prefix (catches re-registrations)
  //   G3 same email + same last name                  (catches name-order swaps)
  // G1/G3 match the member email against BOTH staged emails (email +
  // email_alternativ), like the linker — a married-name change whose old email
  // survives only in E-Mail Alternativ would otherwise slip all three guards.
  // The symmetric-prefix rule is the linker's own. G3 deliberately has no
  // first-name condition: it also skips a family member sharing the household
  // email AND last name (1 known case) — skipping + reporting a real person is
  // recoverable (add by hand), creating a duplicate person silently is not.
  // G4 (within-batch): the members-based guards can't see sibling rows of the
  // same INSERT…SELECT, so two same-person twin contacts that are BOTH absent
  // from Directus would both insert. A fresh row is dropped when another
  // CURRENT contact with a lower [Id] (numeric-safe (length,value) text order)
  // matches it on the same G1/G2/G3 rules — the older twin wins, the loser
  // stays unclaimed and surfaces in the suspected-duplicate report (it matches
  // the winner's member row from this run onward).
  // Skipped contacts are reported below (clubdesk_contact_suspected_duplicate)
  // for a human to merge in ClubDesk or add manually. Everything else rides on
  // DB defaults (kscw_membership_active true, website_visible false,
  // wiedisync_active false, consent_decision 'pending'); no Directus hook/flow
  // fires on this raw-SQL channel. email falls back to '' when ClubDesk has none
  // (a handful of passive contacts): NOT NULL allows it and
  // trg_members_prevent_email_blanking only guards UPDATEs.
  'BEGIN;\n' +
  'WITH cd AS (\n' +
  '  SELECT DISTINCT ON (btrim(clubdesk_id)) btrim(clubdesk_id) AS cdid,\n' +
  "         left(btrim(vorname),255) AS first_name, left(btrim(nachname),255) AS last_name,\n" +
  // Stored lowercased — the canonical email shape (migration 186 backfilled the
  // stock; match keys below were always lowercased).
  "         lower(left(btrim(email),255)) AS email,\n" +
  "         lower(btrim(email)) AS email_l, lower(btrim(email_alternativ)) AS email_alt_l,\n" +
  "         lower(btrim(nachname)) AS nachname_l,\n" +
  "         lower(split_part(btrim(vorname),' ',1)) AS vn1\n" +
  '  FROM clubdesk_export\n' +
  "  WHERE NULLIF(btrim(clubdesk_id),'') IS NOT NULL AND length(btrim(clubdesk_id)) <= 64\n" +
  "    AND NULLIF(btrim(austritt),'') IS NULL\n" +
  "    AND btrim(status) IN ('Aktivmitglied','Passivmitglied','Ehrenmitglied','Zwischenjahr')\n" +
  '  ORDER BY btrim(clubdesk_id), row_id DESC),\n' +
  'fresh AS (\n' +
  '  SELECT cd.* FROM cd\n' +
  '  WHERE NOT EXISTS (SELECT 1 FROM members m WHERE btrim(m.clubdesk_id) = cd.cdid)\n' +
  '    AND NOT EXISTS (SELECT 1 FROM members m WHERE\n' +
  "          NULLIF(btrim(m.email),'') IS NOT NULL AND lower(btrim(m.email)) IN (cd.email_l, cd.email_alt_l)\n" +
  "          AND NULLIF(split_part(btrim(m.first_name),' ',1),'') IS NOT NULL AND NULLIF(cd.vn1,'') IS NOT NULL\n" +
  "          AND (lower(split_part(btrim(m.first_name),' ',1)) LIKE cd.vn1 || '%'\n" +
  "               OR cd.vn1 LIKE lower(split_part(btrim(m.first_name),' ',1)) || '%'))\n" +
  '    AND NOT EXISTS (SELECT 1 FROM members m WHERE\n' +
  '          lower(btrim(m.last_name)) = cd.nachname_l\n' +
  "          AND NULLIF(split_part(btrim(m.first_name),' ',1),'') IS NOT NULL AND NULLIF(cd.vn1,'') IS NOT NULL\n" +
  "          AND (lower(split_part(btrim(m.first_name),' ',1)) LIKE cd.vn1 || '%'\n" +
  "               OR cd.vn1 LIKE lower(split_part(btrim(m.first_name),' ',1)) || '%'))\n" +
  '    AND NOT EXISTS (SELECT 1 FROM members m WHERE\n' +
  "          NULLIF(btrim(m.email),'') IS NOT NULL AND lower(btrim(m.email)) IN (cd.email_l, cd.email_alt_l)\n" +
  '          AND lower(btrim(m.last_name)) = cd.nachname_l)\n' +
  '    AND NOT EXISTS (SELECT 1 FROM cd c2 WHERE\n' +
  '          (length(c2.cdid), c2.cdid) < (length(cd.cdid), cd.cdid)\n' +
  "          AND (((NULLIF(cd.email_l,'') IS NOT NULL AND cd.email_l IN (c2.email_l, c2.email_alt_l))\n" +
  "                OR (NULLIF(cd.email_alt_l,'') IS NOT NULL AND cd.email_alt_l IN (c2.email_l, c2.email_alt_l)))\n" +
  '               AND (c2.nachname_l = cd.nachname_l\n' +
  "                    OR (NULLIF(c2.vn1,'') IS NOT NULL AND NULLIF(cd.vn1,'') IS NOT NULL\n" +
  "                        AND (c2.vn1 LIKE cd.vn1 || '%' OR cd.vn1 LIKE c2.vn1 || '%')))\n" +
  '            OR (c2.nachname_l = cd.nachname_l\n' +
  "                AND NULLIF(c2.vn1,'') IS NOT NULL AND NULLIF(cd.vn1,'') IS NOT NULL\n" +
  "                AND (c2.vn1 LIKE cd.vn1 || '%' OR cd.vn1 LIKE c2.vn1 || '%'))))),\n" +
  'ins AS (\n' +
  '  INSERT INTO members (first_name, last_name, email, clubdesk_id)\n' +
  "  SELECT first_name, last_name, COALESCE(email,''), cdid FROM fresh\n" +
  '  RETURNING 1)\n' +
  "SELECT 'members_created_from_clubdesk' AS metric, count(*) AS value FROM ins;\n" +
  'COMMIT;\n' +
  // Report the contacts the same-person guards skipped (current members whose
  // cdid stayed unclaimed): each is either a ClubDesk duplicate contact to MERGE
  // in ClubDesk, or (rarely) a real second person sharing the household email +
  // last name — add that one manually. Mirrors clubdesk_link_ambiguous below.
  'WITH cd AS (\n' +
  '  SELECT DISTINCT ON (btrim(clubdesk_id)) btrim(clubdesk_id) AS cdid,\n' +
  '         btrim(vorname) AS vorname, btrim(nachname) AS nachname,\n' +
  "         lower(btrim(email)) AS email_l, lower(btrim(email_alternativ)) AS email_alt_l,\n" +
  "         lower(btrim(nachname)) AS nachname_l,\n" +
  "         lower(split_part(btrim(vorname),' ',1)) AS vn1\n" +
  '  FROM clubdesk_export\n' +
  "  WHERE NULLIF(btrim(clubdesk_id),'') IS NOT NULL AND length(btrim(clubdesk_id)) <= 64\n" +
  "    AND NULLIF(btrim(austritt),'') IS NULL\n" +
  "    AND btrim(status) IN ('Aktivmitglied','Passivmitglied','Ehrenmitglied','Zwischenjahr')\n" +
  '  ORDER BY btrim(clubdesk_id), row_id DESC)\n' +
  "SELECT 'clubdesk_contact_suspected_duplicate' AS metric, cd.cdid,\n" +
  "       cd.vorname || ' ' || cd.nachname AS contact,\n" +
  "       string_agg(DISTINCT m.id::text, ',' ORDER BY m.id::text) AS member_ids\n" +
  '  FROM cd JOIN members m ON (\n' +
  "       (NULLIF(btrim(m.email),'') IS NOT NULL AND lower(btrim(m.email)) IN (cd.email_l, cd.email_alt_l)\n" +
  '        AND lower(btrim(m.last_name)) = cd.nachname_l)\n' +
  "    OR ((NULLIF(btrim(m.email),'') IS NOT NULL AND lower(btrim(m.email)) IN (cd.email_l, cd.email_alt_l)\n" +
  '         OR lower(btrim(m.last_name)) = cd.nachname_l)\n' +
  "        AND NULLIF(split_part(btrim(m.first_name),' ',1),'') IS NOT NULL AND NULLIF(cd.vn1,'') IS NOT NULL\n" +
  "        AND (lower(split_part(btrim(m.first_name),' ',1)) LIKE cd.vn1 || '%'\n" +
  "             OR cd.vn1 LIKE lower(split_part(btrim(m.first_name),' ',1)) || '%')))\n" +
  '  WHERE NOT EXISTS (SELECT 1 FROM members x WHERE btrim(x.clubdesk_id) = cd.cdid)\n' +
  '  GROUP BY cd.cdid, cd.vorname, cd.nachname;\n' +
  // ── Apply ClubDesk Geschlecht → members.sex (fill-only) ──
  // Runs AFTER the linker so members linked this run are filled immediately.
  // sex historically only came from the Volleymanager path (licensed VB players),
  // so basketball/passive/new members stayed empty and the Data Health "Missing
  // sex" list refilled with every new cohort. ClubDesk carries Geschlecht for
  // everyone: fill NULL/empty sex for clubdesk_id-linked members (1:1, unique
  // index) — never overwrite, so VM-sourced values and manual corrections (e.g.
  // a wrong ClubDesk Geschlecht fixed by hand) survive every sync. The
  // count(DISTINCT)=1 guard skips a contact staged with conflicting values.
  // Own transaction, same isolation rationale as the birthdate passes.
  'BEGIN;\n' +
  'WITH cd AS (\n' +
  '  SELECT btrim(clubdesk_id) AS cdid,\n' +
  "         CASE lower(btrim(geschlecht)) WHEN 'männlich' THEN 'm' WHEN 'weiblich' THEN 'f' END AS sex\n" +
  '  FROM clubdesk_export\n' +
  "  WHERE NULLIF(btrim(clubdesk_id),'') IS NOT NULL\n" +
  "    AND lower(btrim(geschlecht)) IN ('männlich','weiblich')),\n" +
  'sex_match AS (\n' +
  '  SELECT m.id, min(cd.sex) AS sex FROM members m\n' +
  '  JOIN cd ON cd.cdid = btrim(m.clubdesk_id)\n' +
  "  WHERE m.sex IS NULL OR btrim(m.sex) = ''\n" +
  '  GROUP BY m.id HAVING count(DISTINCT cd.sex) = 1)\n' +
  'UPDATE members m SET sex = sex_match.sex\n' +
  "  FROM sex_match WHERE m.id = sex_match.id AND (m.sex IS NULL OR btrim(m.sex) = '');\n" +
  'COMMIT;\n' +
  "SELECT 'members_missing_sex' AS metric, (SELECT count(*) FROM members WHERE sex IS NULL OR btrim(sex)='') AS value;\n" +
  // ── Apply ClubDesk identity fields (Anrede / Nationalität / AHV) — fill-only ──
  // ClubDesk is the legal register for these, but all three are member-editable
  // in wiedisync, so the sync only FILLS empties (a member's own edit is never
  // clobbered; this is also the down-sync half required before these columns may
  // ever join CD_PUSH_HEADERS — see clubdesk-update.js). AHV must match the
  // official 756.xxxx.xxxx.xx shape or it is skipped — a free-text cell must not
  // permanently occupy a legal-register column (fill-only means garbage would
  // never self-heal). DELIBERATELY EXCLUDED after the 2026-07-04 review:
  //   • iban — a member who deletes their IBAN (PayoutIbanCard) would have it
  //     resurrected every sync (iban_confirmed defaults false → no marker to
  //     tell "deleted" from "never had"); needs a tombstone before importing.
  //   • never_dun — the ratchet silently reverted the DunningConsole's explicit
  //     "undo never-dun" every week; the flag stays owned by migration 146 +
  //     the console + the Data Health drift view.
  // Caveat (accepted): a member who deliberately CLEARS anrede/nationalität/AHV
  // gets the ClubDesk value re-filled next sync — same no-tombstone limitation.
  // clubdesk_id-keyed (1:1); DISTINCT ON picks the latest staged row should a
  // contact ever appear twice. Change-guard WHERE avoids no-op row churn.
  // AHV recovery (2026-07-05): ClubDesk holds several dot-mangled but digit-complete
  // AHV numbers ("756.74468971.66", "7567859436260") — strip to digits and accept a
  // 13-digit 756-prefixed value ONLY when its EAN-13 check digit validates, then
  // reformat to the official dotted shape. Excel-destroyed cells ("7.56E+12") and
  // insurance-card numbers fail the shape/checksum and stay skipped (fix in ClubDesk).
  'BEGIN;\n' +
  'WITH cd0 AS (\n' +
  '  SELECT DISTINCT ON (btrim(clubdesk_id)) btrim(clubdesk_id) AS cdid,\n' +
  "         left(NULLIF(btrim(anrede),''),10) AS anrede,\n" +
  "         left(NULLIF(btrim(nationalitaet),''),100) AS nationalitaet,\n" +
  '         btrim(ahv_nummer) AS ahv_raw,\n' +
  "         regexp_replace(btrim(ahv_nummer), '[^0-9]', '', 'g') AS ahv_digits\n" +
  '  FROM clubdesk_export\n' +
  "  WHERE NULLIF(btrim(clubdesk_id),'') IS NOT NULL\n" +
  '  ORDER BY btrim(clubdesk_id), row_id DESC),\n' +
  'cd AS (\n' +
  // Accept an AHV only when its 13 digits pass the EAN-13 mod-10 check digit —
  // this single branch covers BOTH already-dotted and dot-mangled inputs (audit
  // #14): a dotted-but-invalid-check-digit cell (single-digit typo) used to be
  // stored verbatim and, because the pass is fill-only, never self-healed. Now
  // both intake paths reject a bad check digit consistently and re-emit the
  // canonical dotted form.
  '  SELECT cdid, anrede, nationalitaet,\n' +
  "         CASE WHEN ahv_digits ~ '^756[0-9]{10}$'\n" +
  '               AND (SELECT sum(substr(ahv_digits,g.i,1)::int * CASE WHEN g.i % 2 = 1 THEN 1 ELSE 3 END)\n' +
  '                      FROM generate_series(1,13) g(i)) % 10 = 0\n' +
  "              THEN substr(ahv_digits,1,3)||'.'||substr(ahv_digits,4,4)||'.'||substr(ahv_digits,8,4)||'.'||substr(ahv_digits,12,2)\n" +
  '         END AS ahv\n' +
  '  FROM cd0)\n' +
  'UPDATE members m SET\n' +
  "  anrede        = COALESCE(NULLIF(btrim(m.anrede),''), cd.anrede),\n" +
  "  nationalitaet = COALESCE(NULLIF(btrim(m.nationalitaet),''), cd.nationalitaet),\n" +
  "  ahv_nummer    = COALESCE(NULLIF(btrim(m.ahv_nummer),''), cd.ahv)\n" +
  'FROM cd WHERE btrim(m.clubdesk_id) = cd.cdid AND (\n' +
  "     (NULLIF(btrim(m.anrede),'') IS NULL AND cd.anrede IS NOT NULL)\n" +
  "  OR (NULLIF(btrim(m.nationalitaet),'') IS NULL AND cd.nationalitaet IS NOT NULL)\n" +
  "  OR (NULLIF(btrim(m.ahv_nummer),'') IS NULL AND cd.ahv IS NOT NULL));\n" +
  'COMMIT;\n' +
  "SELECT 'members_missing_identity_fields' AS metric,\n" +
  "  (SELECT count(*) FROM members WHERE NULLIF(btrim(anrede),'') IS NULL\n" +
  "     OR NULLIF(btrim(nationalitaet),'') IS NULL OR NULLIF(btrim(ahv_nummer),'') IS NULL) AS value;\n" +
  // ── Apply ClubDesk contact fields + birthdate by clubdesk_id — fill-only ──
  // The licence/email+name contact pass above predates the clubdesk_id linker and
  // misses linked members whose wiedisync email differs from ClubDesk (kid with an
  // own login email vs the parent contact email, renamed inboxes, no licence) —
  // surfaced 2026-07-05 as 8 missing addresses / 5 phones / 8 categories + Mateo
  // Porte's birthdate despite every one of them being clubdesk_id-linked. Same
  // semantics as that pass: beitragskategorie + sektion are ClubDesk-authoritative
  // (update whenever ClubDesk has a value; members can't edit them), while
  // adresse/plz/ort/phone/birthdate FILL only when empty (a member's own profile
  // edit is never clobbered). birthdate only from a calendar-valid dd.mm.yyyy and
  // never overwritten (missing birthdate = treated as minor by the public API —
  // fail-safe direction). Change-guard WHERE avoids no-op row churn.
  'BEGIN;\n' +
  'WITH cd AS (\n' +
  '  SELECT DISTINCT ON (btrim(clubdesk_id)) btrim(clubdesk_id) AS cdid,\n' +
  "         CASE WHEN geburtsdatum ~ '^[0-9]{2}\\.[0-9]{2}\\.[0-9]{4}$'\n" +
  "                AND to_char(to_date(geburtsdatum,'DD.MM.YYYY'),'DD.MM.YYYY') = geburtsdatum\n" +
  "              THEN to_date(geburtsdatum,'DD.MM.YYYY') END AS dob,\n" +
  "         left(NULLIF(btrim(adresse),''),255) AS adresse, left(NULLIF(btrim(plz),''),10) AS plz,\n" +
  "         left(NULLIF(btrim(ort),''),100) AS ort,\n" +
  // Phone fill ONLY when canonical (same skip-garbage rule as the passes above
  // and the AHV intake — migration 189 policy).
  "         kscw_normalize_phone(left(COALESCE(NULLIF(btrim(telefon_mobil),''), NULLIF(btrim(telefon_privat),'')),255)) AS phone,\n" +
  "         left(NULLIF(btrim(beitragskategorie),''),100) AS categ, left(NULLIF(btrim(sektion),''),32) AS sektion,\n" +
  // J+S Personennummer — ClubDesk-owned, fill-only into members.js_id (like AHV).
  "         left(NULLIF(btrim(js_id),''),32) AS js_id\n" +
  '  FROM clubdesk_export\n' +
  "  WHERE NULLIF(btrim(clubdesk_id),'') IS NOT NULL\n" +
  '  ORDER BY btrim(clubdesk_id), row_id DESC)\n' +
  'UPDATE members m SET\n' +
  '  birthdate = COALESCE(m.birthdate, cd.dob),\n' +
  "  adresse   = COALESCE(NULLIF(btrim(m.adresse),''), cd.adresse),\n" +
  "  plz       = COALESCE(NULLIF(btrim(m.plz),''), cd.plz),\n" +
  "  ort       = COALESCE(NULLIF(btrim(m.ort),''), cd.ort),\n" +
  "  phone     = COALESCE(NULLIF(btrim(m.phone),''), cd.phone),\n" +
  "  js_id     = COALESCE(NULLIF(btrim(m.js_id),''), cd.js_id),\n" +
  "  beitragskategorie = COALESCE(cd.categ, NULLIF(btrim(m.beitragskategorie),'')),\n" +
  "  sektion   = COALESCE(cd.sektion, NULLIF(btrim(m.sektion),''))\n" +
  'FROM cd WHERE btrim(m.clubdesk_id) = cd.cdid AND (\n' +
  '     (m.birthdate IS NULL AND cd.dob IS NOT NULL)\n' +
  "  OR (NULLIF(btrim(m.adresse),'') IS NULL AND cd.adresse IS NOT NULL)\n" +
  "  OR (NULLIF(btrim(m.plz),'') IS NULL AND cd.plz IS NOT NULL)\n" +
  "  OR (NULLIF(btrim(m.ort),'') IS NULL AND cd.ort IS NOT NULL)\n" +
  "  OR (NULLIF(btrim(m.phone),'') IS NULL AND cd.phone IS NOT NULL)\n" +
  "  OR (NULLIF(btrim(m.js_id),'') IS NULL AND cd.js_id IS NOT NULL)\n" +
  "  OR (cd.categ IS NOT NULL AND cd.categ IS DISTINCT FROM NULLIF(btrim(m.beitragskategorie),''))\n" +
  "  OR (cd.sektion IS NOT NULL AND cd.sektion IS DISTINCT FROM NULLIF(btrim(m.sektion),'')));\n" +
  'COMMIT;\n' +
  "SELECT 'members_missing_contact_fields' AS metric,\n" +
  "  (SELECT count(*) FROM members m JOIN clubdesk_export c ON btrim(c.clubdesk_id) = btrim(m.clubdesk_id)\n" +
  "    WHERE (m.birthdate IS NULL AND NULLIF(btrim(c.geburtsdatum),'') IS NOT NULL)\n" +
  "       OR (NULLIF(btrim(m.adresse),'') IS NULL AND NULLIF(btrim(c.adresse),'') IS NOT NULL)\n" +
  "       OR (NULLIF(btrim(m.phone),'') IS NULL AND COALESCE(NULLIF(btrim(c.telefon_mobil),''), NULLIF(btrim(c.telefon_privat),'')) IS NOT NULL)) AS value;\n" +
  // ── Referee flags from ClubDesk group membership (user 2026-07-07) ──────────
  // ClubDesk is the source of truth for "is a referee for Wiedikon": a member in
  // the "VB Schiedsrichter*innen" group → referee_vb, in "Schiedsrichter BB" →
  // referee_bb. Set-true only (a member dropped from the group keeps the flag
  // until manually cleared — avoids clobbering a registration-set referee whose
  // ClubDesk group the club hasn't assigned yet). The wiedisync profile reads
  // these to show "Referee for Wiedikon" (read-only). gruppen_bracketed is the
  // authoritative comma-joined group list ([Gruppen] col).
  'BEGIN;\n' +
  "UPDATE members m SET referee_vb = true\n" +
  '  FROM clubdesk_export c\n' +
  "  WHERE btrim(c.clubdesk_id) = btrim(m.clubdesk_id) AND m.referee_vb IS DISTINCT FROM true\n" +
  "    AND c.gruppen_bracketed ~* '(^|,)\\s*VB Schiedsrichter\\*innen\\s*(,|$)';\n" +
  "UPDATE members m SET referee_bb = true\n" +
  '  FROM clubdesk_export c\n' +
  "  WHERE btrim(c.clubdesk_id) = btrim(m.clubdesk_id) AND m.referee_bb IS DISTINCT FROM true\n" +
  "    AND c.gruppen_bracketed ~* '(^|,)\\s*Schiedsrichter BB\\s*(,|$)';\n" +
  // Every VOLLEYBALL referee is automatically a scorer (user 2026-07-07) — so a
  // VB referee always carries the Schreiber licence too. Basketball is separate
  // (a BB referee is NOT auto-made a table official). Set-true only.
  "UPDATE members SET scorer_vb = true WHERE referee_vb = true AND scorer_vb IS DISTINCT FROM true;\n" +
  'COMMIT;\n' +
  "SELECT 'members_referee' AS metric, (SELECT count(*) FROM members WHERE referee_vb OR referee_bb) AS value;\n" +
  // Report contacts that would have matched MULTIPLE still-unlinked members (skipped
  // above) so a human can link them manually — "ambiguous, needs manual link".
  'WITH cd AS (\n' +
  '  SELECT btrim(clubdesk_id) cdid, lower(btrim(email)) email, lower(btrim(email_alternativ)) email_alt,\n' +
  "         lower(btrim(nachname)) nachname, lower(split_part(btrim(vorname),' ',1)) vn1\n" +
  "  FROM clubdesk_export WHERE NULLIF(btrim(clubdesk_id),'') IS NOT NULL),\n" +
  'ambig AS (\n' +
  '  SELECT cd.cdid, mm.id AS member_id FROM members mm\n' +
  "  JOIN cd ON NULLIF(btrim(mm.email),'') IS NOT NULL AND lower(btrim(mm.email)) IN (cd.email, cd.email_alt)\n" +
  '       AND lower(btrim(mm.last_name)) = cd.nachname\n' +
  // Blank-first-name guard (audit #15): a member with an empty first_name makes
  // split_part('',' ',1)='' → `cd.vn1 LIKE '%'` = TRUE for every contact, so the
  // first-name guard collapses to match-all. Require both sides non-empty.
  "       AND NULLIF(split_part(btrim(mm.first_name),' ',1),'') IS NOT NULL AND NULLIF(cd.vn1,'') IS NOT NULL\n" +
  "       AND (lower(split_part(btrim(mm.first_name),' ',1)) LIKE cd.vn1 || '%'\n" +
  "            OR cd.vn1 LIKE lower(split_part(btrim(mm.first_name),' ',1)) || '%')\n" +
  '  WHERE mm.clubdesk_id IS NULL)\n' +
  "SELECT 'clubdesk_link_ambiguous' AS metric, cdid,\n" +
  "       string_agg(member_id::text, ',' ORDER BY member_id) AS member_ids\n" +
  '  FROM ambig GROUP BY cdid HAVING count(DISTINCT member_id) > 1;\n' +
  // ── Refresh public_stats.member_count (kscw-website About page) ──
  // The website shows a live member count from the prod public_stats collection
  // (public read on directus.kscw.ch /items/public_stats). Its Directus flow
  // ("Public stats: recount") only fires on API writes — this raw-SQL channel
  // bypasses the event bus — so refresh the count here explicitly after the
  // create pass above. to_regclass-guarded: the dev DB has no public_stats and
  // ON_ERROR_STOP=1 would otherwise abort the whole import.
  'DO $$ BEGIN\n' +
  "  IF to_regclass('public.public_stats') IS NOT NULL THEN\n" +
  '    UPDATE public.public_stats\n' +
  '       SET value = (SELECT count(*) FROM public.members WHERE kscw_membership_active),\n' +
  '           date_updated = now()\n' +
  "     WHERE id = 'member_count';\n" +
  '  END IF;\n' +
  'END $$;\n' +
  "SELECT 'members_active_total' AS metric, (SELECT count(*) FROM members WHERE kscw_membership_active) AS value;\n"

if (EMIT_SQL) {
  // Flush fully before exiting: process.exit() right after writing a large
  // payload to a pipe/file truncates it (the write is async). Exit only once
  // the buffer has drained via the write callback.
  process.stdout.write(psqlInput, () => process.exit(0))
} else {
  console.error(`→ ${envName}/${env.database}: importing ${csvPath} (${dataRows.length} data rows, ${TARGET_COLS.length} target cols)...`)
  const dockerExec = ['sudo', 'docker', 'exec', '-i', env.container,
    'psql', '-U', env.user, '-d', env.database,
    '-X', '-v', 'ON_ERROR_STOP=1']
  const cmd = LOCAL ? dockerExec : ['ssh', 'hetzner', ...dockerExec]
  const r = spawnSync(cmd[0], cmd.slice(1), { input: psqlInput, encoding: 'utf-8' })
  if (r.status !== 0) {
    console.error('psql failed:')
    console.error(r.stderr || r.stdout)
    process.exit(1)
  }
  process.stdout.write(r.stdout)
  console.log('✓ import complete')
}
