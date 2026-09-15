#!/usr/bin/env node
/**
 * Run every Season-health check SQL against dev or prod and report.
 *
 *   npm run health:sql:dev                      # all checks
 *   npm run health:sql:dev -- --section games   # one section
 *   npm run health:sql:dev -- --check tr_slot_no_team --rows 5
 *   npm run health:sql:prod                     # read-only, same thing on prod
 *
 * Why this exists: the check registry is ~150 static SQL strings that no
 * linter can prove. `node --check` is syntax-only, eslint sees a string,
 * and a wrong column name only surfaces when the endpoint runs it. This
 * pipes each rendered statement into psql (ssh hetzner → docker exec, the
 * same path as db:clubdesk:diff) and fails loudly on the first bad one.
 *
 * Every check is executed twice — `count(*)` and `row_to_json … LIMIT n` —
 * so the report shows the row count AND the column shape, and the shape is
 * linted against the registry contract (a `sport` column for 'both' checks,
 * the id column its grain promises, dates as YYYY-MM-DD text).
 *
 * Exit code 1 if any check errored or broke the contract.
 */
import { spawn } from 'node:child_process'
import { CHECKS, TABLES } from '../directus/extensions/kscw-endpoints/src/season-health-checks.js'
import { renderSql, seasonContext } from '../directus/extensions/kscw-endpoints/src/season-health-sql.js'

const args = process.argv.slice(2)
const env = args.find((a) => a === 'dev' || a === 'prod') ?? 'dev'
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : def
}
const onlySection = opt('section', null)
const onlyCheck = opt('check', null)
const sampleRows = Number(opt('rows', 0)) // rows to PRINT; one row is always fetched for the shape lint
const jobs = Number(opt('jobs', 4))
const includeTables = !args.includes('--no-tables')

const DB = env === 'prod' ? 'postgres' : 'directus_kscw_dev'
const ctx = seasonContext()

const ID_BY_GRAIN = {
  player: 'member_id', team: 'team_id', game: 'game_id', training: 'training_id', event: 'event_id', club: null,
}

function psql(sql) {
  return new Promise((resolve) => {
    const started = Date.now()
    // Multiplex over one TCP session: ~150 statements × 4 workers would
    // otherwise trip sshd's MaxStartups and fail at random.
    const child = spawn('ssh', [
      '-o', 'ControlMaster=auto', '-o', 'ControlPath=~/.ssh/sockets/%r@%h-%p', '-o', 'ControlPersist=600',
      'hetzner',
      `sudo docker exec -i kscw-postgres psql -U supabase_admin -d ${DB} -X -q -At -v ON_ERROR_STOP=1`,
    ])
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { err += d })
    child.on('close', (code) => resolve({ code, out, err, ms: Date.now() - started }))
    child.stdin.end(sql)
  })
}

/** Runs one statement set: count, then sample rows as JSON. */
async function runOne(entry) {
  const rendered = renderSql(entry.sql, ctx)
  const script = [
    'SET statement_timeout = 30000;',
    `SELECT count(*) FROM (${rendered}) q;`,
    `SELECT row_to_json(q) FROM (${rendered}) q LIMIT ${Math.max(1, sampleRows)};`,
  ].join('\n')
  const { code, out, err, ms } = await psql(script)
  if (code !== 0 || /^ERROR:/m.test(err)) {
    const msg = err.split('\n').filter((l) => /ERROR|LINE|DETAIL|HINT/.test(l)).join(' · ') || err.trim()
    return { ...entry, ok: false, ms, error: msg }
  }
  const lines = out.trim().split('\n').filter(Boolean)
  const count = Number(lines[0])
  const rows = lines.slice(1).map((l) => JSON.parse(l))
  const problems = lintShape(entry, rows[0])
  return { ...entry, ok: problems.length === 0, ms, count, rows, problems }
}

function lintShape(entry, row) {
  const problems = []
  if (!row) return problems // nothing to lint on an empty result
  const keys = Object.keys(row)
  if (keys.some((k) => k === '?column?')) problems.push('unnamed column (?column?)')
  if (entry.kind === 'check') {
    if (entry.sport === 'both' && entry.grain !== 'club' && !entry.memberIdColumn && !keys.includes('sport')) {
      problems.push("sport 'both' but no `sport` column in rows")
    }
    if (keys.includes('sport') && row.sport !== null && !['volleyball', 'basketball'].includes(row.sport)) {
      problems.push(`sport value "${row.sport}" is not volleyball|basketball|null`)
    }
    const idCol = ID_BY_GRAIN[entry.grain]
    if (idCol && !keys.includes(idCol) && !(entry.memberIdColumn && keys.includes(entry.memberIdColumn))) {
      problems.push(`grain ${entry.grain} but no \`${idCol}\` column`)
    }
  }
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v) && /(^|_)date$/.test(k)) {
      problems.push(`\`${k}\` is a timestamp — cast the date to ::text`)
    }
    if (k === 'time' && typeof v === 'string' && /^\d{2}:\d{2}:\d{2}/.test(v)) {
      problems.push('`time` carries seconds — use to_char(time, \'HH24:MI\')')
    }
  }
  return problems
}

const entries = []
if (includeTables && !onlyCheck) {
  for (const [name, sql] of Object.entries(TABLES)) {
    if (!onlySection || onlySection === name) {
      entries.push({ kind: 'table', key: `table:${name}`, section: name, sport: 'both', grain: 'club', sql })
    }
  }
}
for (const c of CHECKS) {
  if (onlySection && c.section !== onlySection) continue
  if (onlyCheck && c.key !== onlyCheck) continue
  entries.push({ kind: 'check', ...c })
}

if (entries.length === 0) {
  console.error('nothing matched')
  process.exit(2)
}

console.log(`season-health SQL check · ${env} (${DB}) · season ${ctx.season} · today ${ctx.today} · ${entries.length} statements`)

const results = []
let cursor = 0
async function worker() {
  while (cursor < entries.length) {
    const e = entries[cursor++]
    const r = await runOne(e)
    results.push(r)
    const tag = r.ok ? '✓' : '✗'
    const head = `${tag} ${r.key.padEnd(44)} ${String(r.ms).padStart(5)}ms`
    if (!r.ok && r.error) console.log(`${head}  ERROR ${r.error}`)
    else {
      console.log(`${head}  rows=${r.count}${r.rows?.[0] ? '  cols=[' + Object.keys(r.rows[0]).join(',') + ']' : ''}`)
      for (const p of r.problems ?? []) console.log(`    ⚠ ${p}`)
      if (sampleRows > 0 && r.rows?.length) for (const row of r.rows) console.log('    ' + JSON.stringify(row))
    }
  }
}
await Promise.all(Array.from({ length: Math.max(1, jobs) }, worker))

const failed = results.filter((r) => !r.ok)
const totalMs = results.reduce((s, r) => s + r.ms, 0)
console.log(`\n${results.length - failed.length}/${results.length} ok · ${failed.length} failed · ${totalMs}ms total psql time`)
if (failed.length) {
  console.log('failed: ' + failed.map((r) => r.key).join(', '))
  process.exit(1)
}
