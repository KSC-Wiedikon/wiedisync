#!/usr/bin/env node
/**
 * lint-db-names.mjs — fail the deploy when the database speaks German
 * (English-only DB migration, phase 6).
 *
 * Usage:
 *   node directus/scripts/lint-db-names.mjs <dev|prod>                 # every finding fails
 *   node directus/scripts/lint-db-names.mjs <dev|prod> --allow-known   # baseline entries pass
 *   node directus/scripts/lint-db-names.mjs <dev|prod> --json          # machine output
 *   npm run db:lint-names:dev | db:lint-names:prod                     # = --allow-known
 *
 * What it reads (read-only, one SELECT over the catalogs, `public` schema only):
 *   table, view, column, function, trigger, constraint and index names, the
 *   quoted literals inside every CHECK constraint (pg_get_constraintdef), and
 *   the labels of every enum type. Objects that belong to an extension
 *   (pg_depend deptype 'e') and Directus' own `directus_*` tables (with their
 *   columns, indexes, constraints and triggers) are skipped — not ours to name.
 *   Other schemas (auth, storage, extensions, … from the Supabase image) are
 *   never queried.
 *
 * How it matches (see DENY_* below): every name / literal is split into
 * tokens on `_`, digits, punctuation, whitespace and camelCase humps, then
 *   • any ä/ö/ü/ß anywhere is a finding;
 *   • EXACT words must equal a whole token  — `ort` hits `billing_ort`, never
 *     `sort`/`port`/`import`/`sort_order`;
 *   • STEMS may sit anywhere inside a token — `beitrag` hits
 *     `mitgliederbeitrag`. A stem is only listed here when no English word
 *     contains it (`halle` is EXACT because of `challenge`, `passiv` because of
 *     `passive`, `nationalitae` not `nationalit` because of `nationality`).
 *
 * Exceptions:
 *   • ALLOWLIST (this file): deliberate, permanent. One object + a reason each,
 *     never a pattern.
 *   • lint-db-names.baseline.json (`--allow-known`): German names that are
 *     already in the DB and wait for a future migration. Temporary — delete an
 *     entry when its migration ships (a stale entry is reported).
 *
 * Exit codes: 0 clean · 1 a finding that is neither allowlisted nor (with
 * --allow-known) in the baseline · 2 usage / psql error.
 *
 * Runs in `db:deploy:*` AFTER `db:migrate:*`, so the migration that fixes a
 * name is never blocked by the name it fixes.
 *
 * No npm dependencies.
 */

import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
export const BASELINE_FILE = join(HERE, 'lint-db-names.baseline.json')

// ── Denylist ─────────────────────────────────────────────────────────────────
// Mined from the old names in migrations 412–421 and the plan's rename map,
// plus the ClubDesk vocabulary (salutation, register status, fee categories,
// invoice/booking states) that leaked into CHECKs before.

/** German letters. Any occurrence is a finding (stem = the letter). */
export const UMLAUT_RE = /[äöüßÄÖÜẞ]/u

/**
 * Whole-token words: short, or contained in an English word, so they only
 * count when they are the entire token.
 */
export const DENY_EXACT = Object.freeze([
  'ort', 'plz', 'typ', 'herr', 'frau', 'modus', 'nein', 'ja', 'neu',
  'rolle', 'titel', 'firma', 'gast', 'halle', 'adress',
  'privat', 'alternativ', 'passiv', 'aktiv', 'termin', 'liste', 'heim', 'kurs',
  'stufe', 'jg', 'offliz',
  // Deliberately absent: `land`, `alter`, `gratis`, `liga` — English words too.
])

/** Substring stems: distinctive German, contained in no English word. */
export const DENY_STEMS = Object.freeze([
  // members / registrations (413–418)
  'adresse', 'anrede', 'nachname', 'vorname', 'beitrag', 'kategorie', 'sektion',
  'eintritt', 'austritt', 'kantonsschul', 'nationalitae', 'nationalitat', 'mitglied',
  'geschlecht', 'geburt', 'telefon', 'bemerkung', 'lizenz', 'schiedsrichter',
  'freibrief', 'rueckkehr', 'nummer', 'zusatz', 'zivilstand', 'jahrgang', 'gruppe',
  'funktion', 'benutzer', 'firmen', 'webseite', 'versand', 'mahnen', 'mahnung',
  'inhaber', 'bestellt', 'offiziell', 'zuletzt', 'geaendert', 'geschaeft',
  'mittelschul', 'schule', 'schul', 'wohnort', 'strasse', 'kanton', 'gemeinde',
  // finance (419)
  'beleg', 'debitoren', 'kreditoren', 'konto', 'rechnung', 'zahlung', 'bezahlt',
  'storn', 'gestellt', 'abgeschrieben', 'teilweise', 'entwurf', 'eroeffnung',
  'eroffnung', 'abschluss', 'sammel', 'betrag', 'erwerbstaetig', 'erwerbstatig',
  'lernende', 'studierende', 'schueler', 'turnier', 'meisterschaft', 'verstorben',
  'ehemalig', 'zwischenjahr',
  // scheduling / events / basketball (420)
  'spiel', 'samstag', 'sonntag', 'ferien', 'verein', 'trainingsweekend',
  'sporthalle', 'turnhalle', 'anmeld', 'abgelaufen', 'frist', 'auswaert',
  'mannschaft', 'verband', 'saison', 'planung', 'veranstaltung', 'anlass',
  'anlaesse', 'abwesenheit', 'teilnahme', 'teilnehmer', 'absage', 'zusage',
  'bestaetig', 'einsatz', 'einsaetze', 'schreiber', 'ergebnis', 'punkte',
  'kasse',
  // city halls / feedback (421)
  'einrichtung', 'stadtkreis', 'stadtquartier', 'quartier', 'kreis', 'gymnastik',
  'vorstand', 'leitung', 'kommunikation',
])

// ── Allowlist ────────────────────────────────────────────────────────────────
// Deliberate, permanent exceptions. Exact `kind` + `name` (as printed), one
// reason each. Never a pattern: a new German name next to an allowlisted one
// must still fail.
//
// Checked and NOT needed (16.10.2026, dev + prod): clubdesk_value_map /
// clubdesk_field_map — their German vocabulary lives in rows (not scanned) and
// their column names are English; `kscw_*_sport_section` functions — renamed
// to `_permissions_section` in 414; the stored token `is_spielplaner` — no
// CHECK carries it. Add an entry only when a finding really is deliberate.
const NO_LEGACY = 'Guard CHECK that REJECTS the legacy German value (migration 415): the literal exists to keep it out of the column.'
export const ALLOWLIST = Object.freeze([
  { kind: 'check_value', name: "members.members_cantonal_school_no_legacy = 'nein'", reason: NO_LEGACY },
  { kind: 'check_value', name: "members.members_cantonal_school_no_legacy = 'Andere Kantonsschule'", reason: NO_LEGACY },
  { kind: 'check_value', name: "members.members_licence_category_no_legacy = '^(offizielle/r|ufficiale|officiel(/le)?)$'", reason: NO_LEGACY },
  { kind: 'check_value', name: "basketplan_people.basketplan_people_licence_category_no_legacy = '^(offizielle/r|ufficiale|officiel(/le)?)$'", reason: NO_LEGACY },
])

// ── Matcher ──────────────────────────────────────────────────────────────────

/** Lower-case tokens of an identifier or literal. */
export function tokenize(text) {
  return String(text ?? '')
    .replace(/([a-zäöü])([A-ZÄÖÜ])/gu, '$1 $2') // camelCase / PascalCase humps
    .toLowerCase()
    .split(/[^a-zäöüß]+/u)
    .filter(Boolean)
}

/**
 * The German signals in one name or literal: [] when clean, else the matched
 * stems (deduped, in order of discovery).
 */
export function matchGerman(text, { exact = DENY_EXACT, stems = DENY_STEMS } = {}) {
  const raw = String(text ?? '')
  const hits = []
  const add = (s) => { if (!hits.includes(s)) hits.push(s) }
  const um = raw.match(new RegExp(UMLAUT_RE.source, 'gu'))
  if (um) for (const ch of um) add(ch.toLowerCase())
  for (const tok of tokenize(raw)) {
    if (exact.includes(tok)) add(tok)
    for (const s of stems) if (tok.includes(s)) add(s)
  }
  return hits
}

/**
 * Every single-quoted literal in a constraint definition, unescaped. A literal
 * that is a JSON array of strings (`role <@ '["user", …]'::jsonb`) is split
 * into its elements, so each value is its own finding — and adding an English
 * value next to a baselined German one does not change the baselined key.
 */
export function extractCheckLiterals(def) {
  const out = []
  const re = /'((?:[^']|'')*)'/g
  let m
  while ((m = re.exec(String(def ?? '')))) {
    const lit = m[1].replace(/''/g, "'")
    let arr = null
    if (/^\s*\[/.test(lit)) {
      try { arr = JSON.parse(lit) } catch { arr = null }
    }
    if (Array.isArray(arr) && arr.every((v) => typeof v === 'string')) out.push(...arr)
    else out.push(lit)
  }
  return out
}

/** The name a finding is printed and keyed under. */
export function displayName(row) {
  const qualified = ['column', 'constraint', 'trigger', 'enum_value', 'check_value']
  return qualified.includes(row.kind) && row.table ? `${row.table}.${row.name}` : row.name
}

/**
 * Catalog rows (the SQL's JSON lines) → findings. A CHECK constraint yields its
 * name as a `constraint` row and each literal as a `check_value` row
 * (`table.constraint = 'literal'`).
 */
export function lintRows(rows, opts) {
  const findings = []
  const seen = new Set()
  const push = (kind, name, text) => {
    const stems = matchGerman(text, opts)
    if (!stems.length) return
    const key = `${kind}|${name}`
    if (seen.has(key)) return // overloaded functions, duplicate literals
    seen.add(key)
    findings.push({ kind, name, stems })
  }
  for (const row of rows) {
    if (row.table && String(row.table).startsWith('directus_')) continue
    if (!row.table && String(row.name).startsWith('directus_')) continue
    const name = displayName(row)
    push(row.kind, name, row.name)
    if (row.kind === 'constraint' && row.def) {
      for (const lit of extractCheckLiterals(row.def)) {
        push('check_value', `${name} = '${lit}'`, lit)
      }
    }
  }
  return findings
}

const keyOf = (e) => `${e.kind}|${e.name}`

/**
 * Split findings into failing / allowlisted / baselined, and report baseline
 * entries that no longer match anything (their migration has shipped).
 */
export function classify(findings, { allowlist = ALLOWLIST, baseline = [] } = {}) {
  for (const e of [...allowlist, ...baseline]) {
    if (!e || typeof e.kind !== 'string' || typeof e.name !== 'string') {
      throw new Error(`lint-db-names: malformed allowlist/baseline entry ${JSON.stringify(e)}`)
    }
  }
  for (const e of allowlist) {
    if (!e.reason || !String(e.reason).trim()) throw new Error(`lint-db-names: allowlist entry ${keyOf(e)} has no reason`)
  }
  const allow = new Map(allowlist.map((e) => [keyOf(e), e]))
  const base = new Map(baseline.map((e) => [keyOf(e), e]))
  const failing = []
  const allowed = []
  const known = []
  for (const f of findings) {
    const k = keyOf(f)
    if (allow.has(k)) allowed.push({ ...f, reason: allow.get(k).reason })
    else if (base.has(k)) known.push({ ...f, note: base.get(k).note ?? null })
    else failing.push(f)
  }
  const byKey = (a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind.localeCompare(b.kind))
  failing.sort(byKey); allowed.sort(byKey); known.sort(byKey)
  const hit = new Set(findings.map(keyOf))
  const staleBaseline = baseline.filter((e) => !hit.has(keyOf(e)))
  const staleAllowlist = allowlist.filter((e) => !hit.has(keyOf(e)))
  return { failing, allowed, known, staleBaseline, staleAllowlist, ok: failing.length === 0 }
}

/** Baseline file → entries. Missing file = empty baseline. */
export function loadBaseline(file = BASELINE_FILE) {
  if (!existsSync(file)) return []
  const json = JSON.parse(readFileSync(file, 'utf-8'))
  const entries = Array.isArray(json) ? json : json.entries
  if (!Array.isArray(entries)) throw new Error(`${file}: expected an array or { entries: [...] }`)
  return entries
}

/** Human-readable report, one finding per line: `kind | name | stem(s)`. */
export function formatReport(result, { target = '' } = {}) {
  const line = (f) => `  ${f.kind} | ${f.name} | ${f.stems.join(', ')}`
  const out = []
  if (result.failing.length) {
    out.push(`✗ db:lint-names${target ? ` (${target})` : ''}: ${result.failing.length} German name(s) — new DB names and enum values must be English:`)
    out.push(...result.failing.map(line))
  } else {
    out.push(`✓ db:lint-names${target ? ` (${target})` : ''}: no new German names`)
  }
  if (result.known.length) {
    out.push(`  ${result.known.length} known leftover(s) in lint-db-names.baseline.json (waiting for a migration):`)
    out.push(...result.known.map(line))
  }
  if (result.allowed.length) out.push(`  ${result.allowed.length} allowlisted.`)
  for (const e of result.staleBaseline) out.push(`  ! stale baseline entry, remove it: ${e.kind} | ${e.name}`)
  for (const e of result.staleAllowlist) out.push(`  ! allowlist entry matches nothing (object gone?): ${e.kind} | ${e.name}`)
  return out.join('\n')
}

// ── Catalog query ────────────────────────────────────────────────────────────
// One JSON object per line: { kind, table, name, def }. `def` only for CHECKs.
export const CATALOG_SQL = `
WITH ns AS (SELECT oid FROM pg_namespace WHERE nspname = 'public'),
ext AS (SELECT classid, objid FROM pg_depend WHERE deptype = 'e'),
rels AS (
  SELECT c.oid, c.relname::text AS relname, c.relkind
    FROM pg_class c
   WHERE c.relnamespace = (SELECT oid FROM ns)
     AND NOT EXISTS (SELECT 1 FROM ext WHERE ext.classid = 'pg_class'::regclass AND ext.objid = c.oid)
)
SELECT json_build_object('kind', kind, 'table', tbl, 'name', name, 'def', def)
FROM (
  SELECT CASE WHEN relkind IN ('v','m') THEN 'view' ELSE 'table' END AS kind,
         NULL::text AS tbl, relname AS name, NULL::text AS def
    FROM rels WHERE relkind IN ('r','p','f','v','m')
  UNION ALL
  SELECT 'column', r.relname, a.attname::text, NULL
    FROM rels r JOIN pg_attribute a ON a.attrelid = r.oid
   WHERE r.relkind IN ('r','p','f','v','m') AND a.attnum > 0 AND NOT a.attisdropped
  UNION ALL
  SELECT 'index', t.relname, i.relname, NULL
    FROM rels i JOIN pg_index x ON x.indexrelid = i.oid JOIN pg_class t ON t.oid = x.indrelid
  UNION ALL
  SELECT 'constraint', r.relname, con.conname::text,
         CASE WHEN con.contype = 'c' THEN pg_get_constraintdef(con.oid) END
    FROM pg_constraint con JOIN rels r ON r.oid = con.conrelid
  UNION ALL
  SELECT 'constraint', ty.typname::text, con.conname::text,
         CASE WHEN con.contype = 'c' THEN pg_get_constraintdef(con.oid) END
    FROM pg_constraint con JOIN pg_type ty ON ty.oid = con.contypid
   WHERE ty.typnamespace = (SELECT oid FROM ns)
     AND NOT EXISTS (SELECT 1 FROM ext WHERE ext.classid = 'pg_type'::regclass AND ext.objid = ty.oid)
  UNION ALL
  SELECT 'trigger', r.relname, tg.tgname::text, NULL
    FROM pg_trigger tg JOIN rels r ON r.oid = tg.tgrelid
   WHERE NOT tg.tgisinternal
  UNION ALL
  SELECT 'function', NULL, p.proname::text, NULL
    FROM pg_proc p
   WHERE p.pronamespace = (SELECT oid FROM ns)
     AND NOT EXISTS (SELECT 1 FROM ext WHERE ext.classid = 'pg_proc'::regclass AND ext.objid = p.oid)
  UNION ALL
  SELECT 'enum_value', ty.typname::text, e.enumlabel::text, NULL
    FROM pg_type ty JOIN pg_enum e ON e.enumtypid = ty.oid
   WHERE ty.typnamespace = (SELECT oid FROM ns)
     AND NOT EXISTS (SELECT 1 FROM ext WHERE ext.classid = 'pg_type'::regclass AND ext.objid = ty.oid)
  UNION ALL
  SELECT 'enum', NULL, ty.typname::text, NULL
    FROM pg_type ty
   WHERE ty.typnamespace = (SELECT oid FROM ns) AND ty.typtype IN ('e','d')
     AND NOT EXISTS (SELECT 1 FROM ext WHERE ext.classid = 'pg_type'::regclass AND ext.objid = ty.oid)
) s;
`

export const ENVS = Object.freeze({
  dev: { container: 'kscw-postgres', database: 'directus_kscw_dev', user: 'supabase_admin' },
  prod: { container: 'kscw-postgres', database: 'postgres', user: 'supabase_admin' },
})

/** psql over ssh, SQL on stdin (never `-c`: ssh re-splits argv). Read-only. */
export function fetchCatalog(env) {
  const cmd = ['ssh', 'hetzner', 'sudo', 'docker', 'exec', '-i', env.container,
    'psql', '-U', env.user, '-d', env.database, '-t', '-A', '-X', '-q', '-v', 'ON_ERROR_STOP=1']
  const sql = `BEGIN READ ONLY;\n${CATALOG_SQL}\nROLLBACK;\n`
  const r = spawnSync(cmd[0], cmd.slice(1), { input: sql, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0) throw new Error(`psql failed: ${(r.stderr || r.stdout || '').trim()}`)
  return r.stdout.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{')).map((l) => JSON.parse(l))
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function main(argv) {
  const envName = argv[0]
  const json = argv.includes('--json')
  const allowKnown = argv.includes('--allow-known')
  const unknown = argv.slice(1).filter((a) => !['--json', '--allow-known'].includes(a))
  if (!ENVS[envName] || unknown.length) {
    console.error('Usage: lint-db-names.mjs <dev|prod> [--allow-known] [--json]')
    return 2
  }
  let rows
  try {
    rows = fetchCatalog(ENVS[envName])
  } catch (e) {
    console.error(`✗ db:lint-names (${envName}): ${e.message}`)
    return 2
  }
  if (!rows.length) {
    console.error(`✗ db:lint-names (${envName}): the catalog query returned nothing — refusing to call that clean`)
    return 2
  }
  const result = classify(lintRows(rows), { baseline: allowKnown ? loadBaseline() : [] })
  if (json) {
    console.log(JSON.stringify({ env: envName, scanned: rows.length, allowKnown, ...result }, null, 2))
  } else {
    console.log(formatReport(result, { target: envName }))
  }
  return result.ok ? 0 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2))
}
