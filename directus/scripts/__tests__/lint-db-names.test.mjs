/**
 * db:lint-names (English-only DB, phase 6): the matcher that fails a deploy
 * when a table / column / function / trigger / constraint / index name, a
 * CHECK literal or an enum label is German. Nothing here talks to a database.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
  ALLOWLIST, BASELINE_FILE, DENY_EXACT, DENY_STEMS, classify, extractCheckLiterals,
  formatReport, lintRows, loadBaseline, matchGerman, tokenize,
} from '../lint-db-names.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(resolve(HERE, '../../../package.json'), 'utf-8'))

// ── Tokens ───────────────────────────────────────────────────────────────────
test('tokenize splits on _, digits, punctuation and camelCase humps', () => {
  assert.deepEqual(tokenize('billing_plz'), ['billing', 'plz'])
  assert.deepEqual(tokenize('otn1_since'), ['otn', 'since'])
  assert.deepEqual(tokenize('FirstName'), ['first', 'name'])
  assert.deepEqual(tokenize('VB Schüler*in 1. Jahr'), ['vb', 'schüler', 'in', 'jahr'])
  assert.deepEqual(tokenize(''), [])
})

// ── True positives ───────────────────────────────────────────────────────────
test('old names from migrations 413–421 are caught', () => {
  const cases = {
    adresse: 'adresse', plz: 'plz', billing_ort: 'ort', ort: 'ort', anrede: 'anrede',
    beitragskategorie: 'beitrag', mitgliederbeitrag: 'beitrag', sektion: 'sektion',
    eintritt: 'eintritt', austritt: 'austritt', nationalitaet_codes: 'nationalitae',
    kantonsschule: 'kantonsschul', is_spielplaner: 'spiel', spielsamstage: 'spiel',
    typ: 'typ', beleg: 'beleg', debitoren_account: 'debitoren', ferien_hard: 'ferien',
    modus: 'modus', einrichtung_id: 'einrichtung', stadtkreis: 'stadtkreis',
    rating_verein: 'verein', rating_vorstand: 'vorstand', vorname: 'vorname',
    nachname: 'nachname', lizenznummer: 'lizenz', gruppen: 'gruppe', briefanrede: 'anrede',
    nie_mahnen: 'mahnen', zuletzt_geaendert_am: 'zuletzt', rolle_2: 'rolle',
    vm_vb_spielplan_contact: 'spiel', team_kasse: 'kasse', clubdesk_offliz_to_dx: 'offliz',
  }
  for (const [name, stem] of Object.entries(cases)) {
    assert.ok(matchGerman(name).includes(stem), `${name} should hit ${stem}, got ${JSON.stringify(matchGerman(name))}`)
  }
})

test('ClubDesk vocabulary in CHECK literals is caught', () => {
  for (const v of ['Herr', 'Frau', 'Storniert', 'Bezahlt', 'Gestellt', 'Kein Beitrag', 'Eroeffnung',
    'Aktivmitglied', 'trainingsweekend', 'verein', 'spielsamstag', 'Nein', 'Anmeldefrist abgelaufen']) {
    assert.ok(matchGerman(v).length > 0, `${v} should be German`)
  }
})

test('any ä/ö/ü/ß is a finding, reported as the letter', () => {
  assert.deepEqual(matchGerman('männlich'), ['ä'])
  assert.deepEqual(matchGerman('Größe'), ['ö', 'ß'])
  assert.ok(matchGerman('Nationalität').includes('ä'))
  assert.ok(matchGerman('ÜBERSICHT').includes('ü'))
})

// ── False positives ──────────────────────────────────────────────────────────
test('ort / typ / frau / halle / passiv only match a whole token', () => {
  for (const name of ['sort', 'sort_order', 'port', 'import', 'export', 'report', 'support', 'effort',
    'cohort', 'transport_mode', 'imported_at', 'typo', 'typical', 'fraud_flag', 'challenge',
    'passive_member', 'private', 'alternative_email', 'terminal', 'terminated_at', 'listed', 'neutral']) {
    assert.deepEqual(matchGerman(name), [], `${name} is English`)
  }
})

test('English schema vocabulary is clean', () => {
  for (const name of ['address', 'postal_code', 'city', 'salutation', 'fee_category', 'club_section',
    'permissions_section', 'joined_on', 'left_on', 'nationality_codes', 'cantonal_school', 'is_scheduler',
    'scheduler_assignments', 'game_saturdays', 'school_holidays_hard', 'mode', 'voucher_no', 'entry_type',
    'receivables_account', 'title_de', 'name_de_clubdesk', 'clubdesk_value_map', 'land', 'country',
    'alter_table', 'gratis', 'section', 'category', 'membership_fee', 'licence_no', 'kscw_member_permissions_section',
    'facility_id', 'city_district', 'school_district', 'rating_board', 'otr1_since', 'is_libero', 'twint']) {
    assert.deepEqual(matchGerman(name), [], `${name} is English`)
  }
})

test('every exact word and stem is lower-case and unique', () => {
  for (const list of [DENY_EXACT, DENY_STEMS]) {
    assert.equal(new Set(list).size, list.length)
    for (const w of list) assert.match(w, /^[a-z]+$/)
  }
})

// ── CHECK literals ───────────────────────────────────────────────────────────
test('extractCheckLiterals reads ARRAY literals, escaped quotes and jsonb arrays', () => {
  assert.deepEqual(
    extractCheckLiterals("CHECK (((paid_to)::text = ANY (ARRAY[('team_kasse'::character varying)::text, ('club_kasse'::character varying)::text])))"),
    ['team_kasse', 'club_kasse'],
  )
  assert.deepEqual(extractCheckLiterals("CHECK ((x <> 'it''s'::text))"), ["it's"])
  assert.deepEqual(
    extractCheckLiterals(`CHECK ((role <@ '["user", "vorstand"]'::jsonb))`),
    ['user', 'vorstand'],
  )
  assert.deepEqual(extractCheckLiterals("CHECK ((x ~ '^[0-9]{4}$'::text))"), ['^[0-9]{4}$'])
  assert.deepEqual(extractCheckLiterals(null), [])
})

// ── Rows → findings ──────────────────────────────────────────────────────────
const ROWS = [
  { kind: 'table', table: null, name: 'members' },
  { kind: 'column', table: 'members', name: 'sort_order' },
  { kind: 'column', table: 'city_halls', name: 'plz' },
  { kind: 'constraint', table: 'fines', name: 'fines_paid_to_check',
    def: "CHECK (((paid_to)::text = ANY (ARRAY['team_kasse'::text, 'cash'::text])))" },
  { kind: 'function', table: null, name: 'members_vorstand_implies_admin' },
  { kind: 'function', table: null, name: 'members_vorstand_implies_admin' }, // overload
  { kind: 'enum_value', table: 'pay_kind', name: 'Bar' },
  { kind: 'enum_value', table: 'sex_enum', name: 'männlich' },
  // Directus' own tables are skipped, whatever they contain.
  { kind: 'table', table: null, name: 'directus_vorstand' },
  { kind: 'column', table: 'directus_users', name: 'plz' },
  { kind: 'index', table: 'directus_fields', name: 'idx_ort' },
]

test('lintRows qualifies names, emits CHECK literals, dedupes and skips directus_*', () => {
  const f = lintRows(ROWS)
  assert.deepEqual(f.map((x) => `${x.kind} | ${x.name} | ${x.stems.join(',')}`), [
    'column | city_halls.plz | plz',
    "check_value | fines.fines_paid_to_check = 'team_kasse' | kasse",
    'function | members_vorstand_implies_admin | vorstand',
    'enum_value | sex_enum.männlich | ä',
  ])
})

// ── Allowlist + baseline ─────────────────────────────────────────────────────
test('allowlisted findings pass, with their reason', () => {
  const findings = lintRows(ROWS)
  const r = classify(findings, {
    allowlist: [{ kind: 'column', name: 'city_halls.plz', reason: 'test' }],
    baseline: [],
  })
  assert.equal(r.allowed.length, 1)
  assert.equal(r.allowed[0].reason, 'test')
  assert.ok(!r.failing.some((x) => x.name === 'city_halls.plz'))
  assert.equal(r.ok, false)
})

test('the allowlist is exact: a sibling German name still fails', () => {
  const findings = lintRows([
    { kind: 'column', table: 'city_halls', name: 'plz' },
    { kind: 'column', table: 'city_halls', name: 'plz_2' },
    { kind: 'column', table: 'other', name: 'plz' },
  ])
  const r = classify(findings, { allowlist: [{ kind: 'column', name: 'city_halls.plz', reason: 'x' }] })
  assert.deepEqual(r.failing.map((x) => x.name), ['city_halls.plz_2', 'other.plz'])
})

test('an allowlist entry needs a reason; a malformed entry throws', () => {
  assert.throws(() => classify([], { allowlist: [{ kind: 'column', name: 'a.b' }] }), /no reason/)
  assert.throws(() => classify([], { baseline: [{ name: 'a.b' }] }), /malformed/)
})

test('baseline entries pass as known; stale ones are reported, not failed', () => {
  const findings = lintRows(ROWS)
  const baseline = findings.map((x) => ({ kind: x.kind, name: x.name, note: 'later' }))
  baseline.push({ kind: 'column', name: 'gone.plz', note: 'shipped' })
  const r = classify(findings, { allowlist: [], baseline })
  assert.equal(r.ok, true)
  assert.equal(r.failing.length, 0)
  assert.equal(r.known.length, findings.length)
  assert.deepEqual(r.staleBaseline.map((e) => e.name), ['gone.plz'])
  assert.match(formatReport(r, { target: 'dev' }), /stale baseline entry, remove it: column \| gone\.plz/)
})

test('report prints `kind | name | stem` and the verdict', () => {
  const r = classify(lintRows(ROWS), { allowlist: [] })
  const out = formatReport(r, { target: 'prod' })
  assert.match(out, /^✗ db:lint-names \(prod\): 4 German name/)
  assert.match(out, /column \| city_halls\.plz \| plz/)
  assert.match(formatReport(classify([], { allowlist: [] })), /^✓ db:lint-names: no new German names/)
})

// ── The shipped allowlist, baseline and wiring ───────────────────────────────
test('shipped allowlist entries are specific and reasoned', () => {
  for (const e of ALLOWLIST) {
    assert.ok(e.reason && e.reason.length > 20, `${e.name} needs a real reason`)
    assert.doesNotMatch(e.name, /[*%]/, 'no patterns in the allowlist')
  }
  // The no-legacy guards really do carry German: the matcher must still see them.
  for (const e of ALLOWLIST.filter((x) => x.kind === 'check_value')) {
    const lit = e.name.slice(e.name.indexOf(" = '") + 4, -1)
    assert.ok(matchGerman(lit).length > 0, `${e.name} no longer matches — drop the entry`)
  }
})

test('shipped baseline parses and every entry still matches the denylist', () => {
  const entries = loadBaseline(BASELINE_FILE)
  assert.ok(Array.isArray(entries))
  for (const e of entries) {
    assert.ok(e.kind && e.name && e.note, JSON.stringify(e))
    const subject = e.kind === 'check_value' ? e.name.slice(e.name.indexOf(" = '") + 4, -1) : e.name.split('.').pop()
    assert.ok(matchGerman(subject).length > 0, `${e.name}: the matcher no longer flags it — remove it from the baseline`)
  }
})

test('db:deploy runs the guard AFTER migrate, with the baseline', () => {
  for (const env of ['dev', 'prod']) {
    assert.equal(pkg.scripts[`db:lint-names:${env}`], `node directus/scripts/lint-db-names.mjs ${env} --allow-known`)
    const deploy = pkg.scripts[`db:deploy:${env}`]
    const migrate = deploy.indexOf(`db:migrate:${env}`)
    const lint = deploy.indexOf(`db:lint-names:${env}`)
    assert.ok(migrate >= 0 && lint > migrate, `db:deploy:${env} must lint after migrate: ${deploy}`)
  }
})
