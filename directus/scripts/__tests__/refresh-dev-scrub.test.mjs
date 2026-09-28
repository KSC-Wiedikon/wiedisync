/**
 * The two dev-refresh scripts must scrub with the SAME SQL, and it must cover
 * what the 2026-09-28 audit found leaking (F13 credentials, F14 PII).
 *
 * WHY THIS EXISTS
 * ---------------
 * refresh-dev-daily.sh (nightly, root cron on the VPS) and
 * refresh-dev-from-prod.sh (on demand, from a workstation) used to carry two
 * hand-synced copies of the scrub. They drifted before — the attended one
 * recreated `unaccent`, the nightly one did not, and the ClubDesk sync-down
 * broke every night while the manual run made it look fixed. Both now run
 * refresh-dev-scrub.sql; this test fails if either stops doing so, or if the
 * prod-equality guard (the only thing standing between a re-pinned dev token
 * and a prod root credential) diverges between them.
 *
 * Static checks only: the scripts drive docker + psql on the VPS and are
 * never executed from a test.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (f) => readFileSync(resolve(HERE, '..', f), 'utf-8')

const daily = read('refresh-dev-daily.sh')
const manual = read('refresh-dev-from-prod.sh')
const scrub = read('refresh-dev-scrub.sql')

const guardQuery = (src) => {
  const m = src.match(/-c "(SELECT 'UPDATE directus_users SET token = NULL[^"]+)"/)
  assert.ok(m, 'prod-equality guard query not found')
  return m[1]
}

test('both refresh scripts run the shared scrub file, not an inline copy', () => {
  assert.match(daily, /refresh-dev-scrub\.sql/)
  assert.match(manual, /refresh-dev-scrub\.sql/)
  for (const [name, src] of [['daily', daily], ['from-prod', manual]]) {
    assert.doesNotMatch(src, /cat > "\$SCRUB" <<'SQL'/, `${name}: inline scrub heredoc is back`)
    assert.match(src, /-v scrub_pii=/, `${name}: scrub_pii not passed`)
  }
})

test('the prod-equality guard is identical in both scripts', () => {
  assert.equal(guardQuery(daily), guardQuery(manual))
  assert.match(guardQuery(daily), /md5\(token\)/)
  assert.match(guardQuery(daily), /md5\(password\)/)
})

test('scratch files live in a private, always-removed temp dir (F71)', () => {
  for (const [name, src] of [['daily', daily], ['from-prod', manual]]) {
    assert.match(src, /umask 077/, `${name}: no umask 077`)
    assert.match(src, /mktemp -d/, `${name}: no mktemp -d`)
    assert.match(src, /trap 'rm -rf "\$WORK"' EXIT/, `${name}: no cleanup trap`)
    assert.doesNotMatch(src, /\/tmp\/refresh_(devcreds|scrub|repin|restore)_/, `${name}: fixed /tmp path is back`)
  }
})

test('an unset or bogus scrub_pii aborts instead of silently skipping PII', () => {
  // psql's \if only WARNS on a bad value and treats it as false.
  assert.match(scrub, /^SELECT \(:'scrub_pii'\)::boolean AS scrub_pii \\gset$/m)
  const gset = scrub.indexOf('\\gset')
  assert.ok(gset < scrub.indexOf('\\if :scrub_pii'), 'the cast must run before the \\if')
})

test('credentials are scrubbed OUTSIDE the PII block (always, even --no-scrub)', () => {
  const credsAt = scrub.search(/UPDATE directus_users\s+SET token\s+= NULL,\s+password\s+= NULL,\s+tfa_secret = NULL/)
  assert.ok(credsAt > 0, 'credential UPDATE missing')
  assert.ok(credsAt < scrub.indexOf('\\if :scrub_pii'), 'credential scrub must precede the PII gate')
  assert.ok(scrub.indexOf('password_enc = NULL') < scrub.indexOf('\\if :scrub_pii'))
})

test('the PII block covers the F14 columns', () => {
  const pii = scrub.slice(scrub.indexOf('\\if :scrub_pii'), scrub.indexOf('\\endif'))
  for (const needle of [
    'ahv_nummer            = NULL', // members
    'iban                  = pg_temp.kscw_iban(iban)',
    'adresse               = pg_temp.kscw_street(adresse)',
    'birthdate             = pg_temp.kscw_shift_date(birthdate)',
    'telefon_mobil     = NULL', // clubdesk_export
    'telefon_privat    = NULL',
    'geburtsdatum      = pg_temp.kscw_shift_ddmmyyyy(geburtsdatum)',
    'UPDATE directus_revisions',
    'UPDATE user_logs',
    'recipient_email',
  ]) {
    assert.ok(pii.includes(needle), `PII block lost: ${needle}`)
  }
})

test('every prod-valid link token and API key is rotated OUTSIDE the PII block', () => {
  const creds = scrub.slice(0, scrub.indexOf('\\if :scrub_pii'))
  for (const needle of [
    'members                      SET ical_token',
    'game_scheduling_opponents    SET token',
    'game_scheduling_club_portals SET token',
    'SET verify_token      = md5(',
    'SET unsubscribe_token = md5(',
    'SET public_share_token = md5(',
    'team_invites                 SET token',
    'DELETE FROM password_reset_tokens',
    'ai_anthropic_api_key         = NULL',
    'mapbox_key                   = NULL',
  ]) {
    assert.ok(creds.includes(needle), `credential section is missing: ${needle}`)
  }
})

test('the nightly script refuses to run from a location a non-root user can write (F72)', () => {
  assert.match(daily, /stat -c '%u %a'/)
  assert.match(daily, /\[ "\$own" != 0 \]/)
  assert.match(daily, /8#\$mode & 8#022/)
  const deploy = readFileSync(resolve(HERE, '..', '..', '..', 'scripts', 'deploy-directus-scripts.sh'), 'utf-8')
  // What root's crontab runs is installed root-owned OUTSIDE the container's bind mount.
  assert.match(deploy, /ROOT_RUN="refresh-dev-daily\.sh:0700 refresh-dev-scrub\.sql:0600"/)
  assert.match(deploy, /install -o root -g root -m \$mode/)
})

test('a rollback re-scrubs the restored safety dump before dev starts', () => {
  const rb = daily.slice(daily.indexOf('rollback(){'), daily.indexOf('\n}\n', daily.indexOf('rollback(){')))
  const startAt = rb.indexOf('docker start')
  assert.ok(startAt > 0, 'rollback no longer starts dev?')
  for (const step of ['if scrub; then', 'repin', 'if ! pguard; then']) {
    const at = rb.indexOf(step)
    assert.ok(at > 0 && at < startAt, `rollback must run "${step}" before docker start`)
  }
})

// ── Prod-equality guard: allowlist password exemption (round 2) ─────────────
// Nulling the allowlisted logins' passwords would lock the operator out of dev
// admin every night. The exemption is for PASSWORDS only: a token equal to
// prod's is a bearer credential and must always go.
test('the guard exempts allowlist PASSWORDS but never tokens', () => {
  const q = guardQuery(daily)
  const [tokenPart, passwordPart] = q.split('UNION ALL')
  assert.ok(passwordPart, 'guard no longer has a password half')
  assert.doesNotMatch(tokenPart, /ALLOW_SQL/, 'tokens must not get an allowlist exemption')
  assert.match(passwordPart, /\(email IS NULL OR lower\(email\) NOT IN \(\$ALLOW_SQL_LIT\)\)/)
  for (const [name, src] of [['daily', daily], ['from-prod', manual]]) {
    // Inside the SQL string literal the list's quotes have to be doubled.
    assert.match(src, /^\s*ALLOW_SQL_LIT=\$\{ALLOW_SQL\/\/\\'\/\\'\\'\}$/m, `${name}: ALLOW_SQL_LIT not derived from ALLOW_SQL`)
    assert.ok(src.indexOf('ALLOW_SQL_LIT=') < src.indexOf('-d "$PROD_DB" -t -A'), `${name}: ALLOW_SQL_LIT defined after the guard`)
    assert.match(src, /ACCEPTED RESIDUAL/, `${name}: the residual is no longer documented`)
  }
})

// ── ClubDesk dev-target imports scrub like the refresh (F14 remainder) ──────
const { createDevScrubber, CLUBDESK_EXPORT_SCRUB, DEV_IBAN } = await import('../import-clubdesk-dev-scrub.mjs')
const { spawnSync } = await import('node:child_process')
const { writeFileSync, rmSync, mkdtempSync } = await import('node:fs')
const { tmpdir } = await import('node:os')
const { createHash } = await import('node:crypto')

test('the JS scrub covers exactly the clubdesk_export columns the refresh SQL scrubs', () => {
  const start = scrub.indexOf('UPDATE clubdesk_export SET')
  assert.ok(start > 0, 'clubdesk_export UPDATE missing from the SQL')
  const block = scrub.slice(start, scrub.indexOf(';', start))
  const KIND_OF = (expr) => {
    if (/^NULL$/.test(expr)) return 'null'
    if (/pg_temp\.kscw_iban/.test(expr)) return 'iban'
    if (/pg_temp\.kscw_street/.test(expr)) return 'street'
    if (/pg_temp\.kscw_shift_ddmmyyyy/.test(expr)) return 'ddmmyyyy'
    if (/'scrub_'\|\|substr\(md5\(/.test(expr)) return 'email'
    return `unknown:${expr}`
  }
  const sqlMap = {}
  for (const line of block.split('\n').slice(1)) {
    const m = line.match(/^\s*([a-z_]+)\s*=\s*(.+?),?\s*$/)
    if (m) sqlMap[m[1]] = KIND_OF(m[2])
  }
  assert.deepEqual({ ...CLUBDESK_EXPORT_SCRUB }, sqlMap)
})

test('dev scrubber: birthdate keeps the year and today\'s age, deterministically', () => {
  const today = { y: 2026, m: 9, d: 28 }
  const s = createDevScrubber({ salt: 'fixed', today })
  const ageOn = (iso) => {
    const [y, m, d] = iso.split('-').map(Number)
    return today.y - y - ((m > today.m || (m === today.m && d > today.d)) ? 1 : 0)
  }
  for (const iso of ['2008-09-28', '2008-09-29', '2008-01-01', '2008-12-31', '1990-02-28', '2012-02-29', '1975-05-03']) {
    const out = s.shiftIso(iso)
    assert.match(out, /^\d{4}-\d{2}-\d{2}$/)
    assert.equal(out.slice(0, 4), iso.slice(0, 4), `${iso}: year changed`)
    assert.equal(ageOn(out), ageOn(iso), `${iso}: age changed (${out})`)
    assert.equal(s.shiftIso(iso), out, `${iso}: not deterministic within a run`)
  }
  assert.equal(s.shiftDdmmyyyy('03.05.1975').slice(-4), '1975')
  assert.equal(s.shiftDdmmyyyy('31.02.2020'), null, 'invalid calendar date must become NULL')
  assert.equal(s.shiftDdmmyyyy('1975-05-03'), null, 'non dd.mm.yyyy must become NULL')
  // A different run salt gives an unrelated value (salt is never stored).
  const other = createDevScrubber({ salt: 'other', today })
  assert.notDeepEqual(
    ['1975-05-03', '1990-02-28', '2001-11-11'].map(s.shiftIso),
    ['1975-05-03', '1990-02-28', '2001-11-11'].map(other.shiftIso))
})

test('dev scrubber: street, IBAN, email and NULL columns match the refresh SQL', () => {
  const s = createDevScrubber({ salt: 'fixed' })
  assert.match(s.street('Bahnhofstrasse 1'), /^Teststrasse ([1-9]|[1-9]\d|1\d\d|200)$/)
  assert.equal(s.street(' BAHNHOFSTRASSE 1 '), s.street('bahnhofstrasse 1'), 'street hash must be trim + lower-case keyed')
  assert.equal(s.iban('CH56 0483 5012 3456 7800 9'), DEV_IBAN)
  assert.equal(s.email('petra@example.ch'), `scrub_${createHash('md5').update('petra@example.ch').digest('hex').slice(0, 16)}@devsink.invalid`)
  const cols = ['nachname', 'ahv_nummer', 'telefon_mobil', 'iban', 'geburtsdatum', 'bemerkungen', 'plz']
  const row = ['Müller', '756.1234.5678.97', '+41 79 123 45 67', 'CH5604835012345678009', '03.05.1975', 'Allergie', '8003']
  s.clubdeskExportRow(cols, row)
  assert.deepEqual([row[0], row[1], row[2], row[3], row[5], row[6]], ['Müller', '', '', DEV_IBAN, '', '8003'])
  assert.match(row[4], /^\d{2}\.\d{2}\.1975$/)
})

// End to end through the real CLIs: the dev target must not emit a single real
// value, and the prod target must still emit them untouched.
const PII = ['756.1234.5678.97', '+41 79 123 45 67', 'Bahnhofstrasse 1', 'CH5604835012345678009', '03.05.1975', 'petra@example.ch', 'Allergie Nüsse']

test('import-clubdesk-csv: a dev target stages no real PII; prod is unchanged', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'cd-dev-scrub-'))
  const csv = resolve(dir, 'export.csv')
  writeFileSync(csv, Buffer.from([
    'Nachname;Vorname;E-Mail;Adresse;Telefon Mobil;AHV Nummer;IBAN;Geburtsdatum;Bemerkungen;PLZ;Status;[Id]',
    'Müller;Petra;petra@example.ch;Bahnhofstrasse 1;+41 79 123 45 67;756.1234.5678.97;CH5604835012345678009;03.05.1975;Allergie Nüsse;8003;Aktivmitglied;1000001',
  ].join('\r\n') + '\r\n', 'latin1'))
  const run = (env) => spawnSync('node', [resolve(HERE, '..', 'import-clubdesk-csv.mjs'), env, csv, '--emit-sql'], { encoding: 'utf-8' })
  const dev = run('dev')
  const prod = run('prod')
  rmSync(dir, { recursive: true, force: true })
  assert.equal(dev.status, 0, dev.stderr)
  assert.equal(prod.status, 0, prod.stderr)
  for (const v of PII) {
    assert.ok(!dev.stdout.includes(v), `dev import leaked ${v}`)
    assert.ok(prod.stdout.includes(v), `prod import lost ${v} — the prod path must stay unchanged`)
  }
  assert.ok(dev.stdout.includes(DEV_IBAN))
  assert.match(dev.stdout, /;Teststrasse \d+;/)
  assert.match(dev.stdout, /;\d{2}\.\d{2}\.1975;/)
  assert.ok(dev.stdout.includes('Müller;Petra') || dev.stdout.includes('Petra'), 'non-PII columns must survive')
  // Apart from the data rows, dev and prod emit the same SQL.
  const strip = (s) => s.split('\n').filter((l) => !l.includes('1000001')).join('\n')
  assert.equal(strip(dev.stdout), strip(prod.stdout))
})

test('import-clubdesk-finance: a dev target scrubs recipient_email; prod is unchanged', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'cd-dev-fin-'))
  const inv = resolve(dir, 'inv.csv')
  const bk = resolve(dir, 'bk.csv')
  writeFileSync(inv, Buffer.from('[Id];Nummer;Rechnungsdatum;Betreff;Betrag;Status;Empfänger;E-Mail\r\nCD-1;R-1;01.07.2025;Beitrag;210;Bezahlt;Petra Müller;petra@example.ch\r\n', 'latin1'))
  writeFileSync(bk, Buffer.from("Datum;Soll (Nummer);Soll (Bezeichnung);Haben (Nummer);Haben (Bezeichnung);Betrag (CHF);Typ;Beleg;Text;ID\r\n01.07.2025;1000;Kasse;3000;Ertrag VB;1'234.50;Standard;B-1;Testbuchung;42\r\n", 'latin1'))
  const run = (env) => spawnSync('node', [resolve(HERE, '..', 'import-clubdesk-finance.mjs'), env, inv, bk, '--emit-sql'], { encoding: 'utf-8' })
  const dev = run('dev')
  const prod = run('prod')
  rmSync(dir, { recursive: true, force: true })
  assert.equal(dev.status, 0, dev.stderr)
  assert.equal(prod.status, 0, prod.stderr)
  assert.ok(!dev.stdout.includes('petra@example.ch'), 'dev finance import leaked the recipient email')
  assert.ok(prod.stdout.includes("'petra@example.ch'"), 'prod finance import must keep the recipient email')
  const scrubbed = `scrub_${createHash('md5').update('petra@example.ch').digest('hex').slice(0, 16)}@devsink.invalid`
  assert.equal(dev.stdout.replace(scrubbed, 'petra@example.ch'), prod.stdout)
})
