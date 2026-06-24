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
  'gruppen_bracketed','rolle_bracketed',
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
  "         lower(split_part(btrim(vorname),' ',1)) AS vn1, to_date(geburtsdatum,'DD.MM.YYYY') AS dob\n" +
  '  FROM clubdesk_export\n' +
  "  WHERE geburtsdatum ~ '^[0-9]{2}\\.[0-9]{2}\\.[0-9]{4}$'\n" +
  "    AND to_char(to_date(geburtsdatum,'DD.MM.YYYY'),'DD.MM.YYYY') = geburtsdatum),\n" +
  'email_match AS (\n' +
  '  SELECT m.id, min(cd.dob) AS dob FROM members m\n' +
  "  JOIN cd ON btrim(coalesce(m.email,'')) <> '' AND lower(btrim(m.email)) IN (cd.email, cd.email_alt)\n" +
  "   AND lower(split_part(btrim(m.first_name),' ',1)) = cd.vn1\n" +
  '  WHERE m.birthdate IS NULL\n' +
  '  GROUP BY m.id HAVING count(DISTINCT cd.dob) = 1)\n' +
  'UPDATE members m SET birthdate = email_match.dob\n' +
  '  FROM email_match WHERE m.id = email_match.id AND m.birthdate IS NULL;\n' +
  'COMMIT;\n' +
  "SELECT 'members_missing_birthdate' AS metric, (SELECT count(*) FROM members WHERE birthdate IS NULL) AS value;\n" +
  // ── Propagate ClubDesk contact fields to members (finance member explorer) ──
  // The scrape stages address/category/sektion/phone for every member, but only
  // birthdate was ever applied. Fill the rest so the finance Members view mirrors
  // ClubDesk. ClubDesk-authoritative fields (beitragskategorie, sektion — members
  // can't edit them) always update; member-editable ones (adresse/plz/ort/phone)
  // fill only when empty so a member's own profile edit is never clobbered.
  // Matched by licence (1:1) then email(+alt) with a first-name-token guard (same
  // safe matching as the birthdate passes). Own transaction.
  'BEGIN;\n' +
  'WITH cd AS (\n' +
  '  SELECT lower(btrim(lizenznummer)) lic,\n' +
  "         left(NULLIF(btrim(adresse),''),255) adresse, left(NULLIF(btrim(plz),''),10) plz, left(NULLIF(btrim(ort),''),100) ort,\n" +
  "         left(NULLIF(btrim(beitragskategorie),''),100) categ, left(NULLIF(btrim(sektion),''),32) sektion,\n" +
  "         left(COALESCE(NULLIF(btrim(telefon_mobil),''), NULLIF(btrim(telefon_privat),'')),255) phone\n" +
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
  "         lower(split_part(btrim(vorname),' ',1)) vn1,\n" +
  "         left(NULLIF(btrim(adresse),''),255) adresse, left(NULLIF(btrim(plz),''),10) plz, left(NULLIF(btrim(ort),''),100) ort,\n" +
  "         left(NULLIF(btrim(beitragskategorie),''),100) categ, left(NULLIF(btrim(sektion),''),32) sektion,\n" +
  "         left(COALESCE(NULLIF(btrim(telefon_mobil),''), NULLIF(btrim(telefon_privat),'')),255) phone\n" +
  '  FROM clubdesk_export),\n' +
  'mt AS (\n' +
  '  SELECT DISTINCT ON (mm.id) mm.id, cd.adresse, cd.plz, cd.ort, cd.categ, cd.sektion, cd.phone\n' +
  "  FROM members mm JOIN cd ON NULLIF(btrim(mm.email),'') IS NOT NULL\n" +
  '       AND lower(btrim(mm.email)) IN (cd.email, cd.email_alt)\n' +
  "       AND lower(split_part(btrim(mm.first_name),' ',1)) = cd.vn1\n" +
  '  ORDER BY mm.id, cd.categ NULLS LAST, cd.adresse NULLS LAST)\n' +
  'UPDATE members t SET\n' +
  '  beitragskategorie = COALESCE(mt.categ, t.beitragskategorie), sektion = COALESCE(mt.sektion, t.sektion),\n' +
  "  adresse = COALESCE(NULLIF(btrim(t.adresse),''), mt.adresse), plz = COALESCE(NULLIF(btrim(t.plz),''), mt.plz),\n" +
  "  ort = COALESCE(NULLIF(btrim(t.ort),''), mt.ort), phone = COALESCE(NULLIF(btrim(t.phone),''), mt.phone)\n" +
  'FROM mt WHERE t.id = mt.id;\n' +
  'COMMIT;\n' +
  "SELECT 'members_with_address' AS metric, (SELECT count(*) FROM members WHERE NULLIF(btrim(adresse),'') IS NOT NULL) AS value;\n"

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
