#!/usr/bin/env node
/**
 * Mechanical sweep of every FILTERED READ permission live in the database.
 *
 * WHY THIS EXISTS
 * ---------------
 * On 26.08.2026 the `participations` read policy took the app down: members could
 * log in and then watch the logo spin for two minutes. The cause was not data
 * volume and not a missing index — it was the SHAPE of the policy filter.
 *
 * Directus does not compile a policy `_or` into EXISTS subqueries. It emits ONE
 * FLAT LEFT JOIN PER RELATION HOP, as SIBLINGS off shared parents, and then
 * re-evaluates the entire predicate inside `COUNT(CASE WHEN … )` ONCE PER
 * SELECTED FIELD. Sibling joins CROSS-MULTIPLY, so branches do not add:
 *
 *     302 driving rows → 46 LEFT JOINs → 148,915,476 intermediate rows
 *
 * Two hand-audits sampled the policy file and both MISSED collections. This
 * enumerates instead, so the guarantee is permanent rather than anecdotal.
 *
 * ⚠ IT READS `directus_permissions`, NOT `setup-permissions.mjs`. The deployed
 * rows are the truth; a rule that failed to apply (a 502 mid-run leaves the file
 * and the database disagreeing) would otherwise be invisible.
 *
 * ⚠⚠ THIS IS A CANDIDATE FINDER, NOT A VERDICT. It scores branch COUNT × table
 * size, and is blind to branch CARDINALITY — which is the dimension that actually
 * decides. Measured on prod, 26.08.2026:
 *
 *     trainings / Team Responsible   2 sibling branches, 2,399 rows
 *       → looks alarming, is 3,310 intermediate rows (1.4×, 10 ms), because
 *         `coach` averages 1.43 rows per team and `team_responsible` 1.05.
 *     participations / Member        the same shape over `member_teams`, which
 *       averages ~21 per team → four orders of magnitude worse.
 *
 * So: every candidate must be MEASURED before it is believed. Reconstruct the
 * sibling LEFT JOINs by hand and `count(*)` them — see DEVLOG 26.08.2026.
 *
 * Usage:  npm run db:audit-filters:prod   (or :dev)
 * Exits 2 if it cannot parse what it read — a sweep that silently parses nothing
 * would report "clean", which is worse than reporting an error.
 */
import { execFileSync } from 'node:child_process'

const TARGET = process.argv[2] === 'dev' ? 'dev' : 'prod'
const DB = TARGET === 'dev' ? 'directus_kscw_dev' : 'postgres'
const SEP = '~~~' // NOT \t — a backslash escape does not survive the ssh shell hop

const psql = (sql) => execFileSync('ssh', ['hetzner',
  `sudo docker exec -i kscw-postgres psql -U supabase_admin -d ${DB} -tA -F'${SEP}' -c "${sql.replace(/\s+/g, ' ')}"`,
], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

const raw = psql(`SELECT pol.name, p.collection, p.permissions::text
                  FROM directus_permissions p JOIN directus_policies pol ON pol.id = p.policy
                  WHERE p.action='read' AND p.permissions IS NOT NULL
                    AND p.permissions::text NOT IN ('{}','null') ORDER BY 1,2`)

const rowCounts = Object.fromEntries(
  psql('SELECT relname, n_live_tup FROM pg_stat_user_tables').trim().split('\n')
    .map((l) => { const [t, n] = l.split(SEP); return [t, Number(n)] }))

/** Depth of relation hops; `_`-prefixed keys are operators/logicals, not hops. */
function walkDepth(node, d = 0) {
  if (node == null || typeof node !== 'object') return d
  let max = d
  for (const [k, v] of Object.entries(node)) {
    if (k.startsWith('_')) {
      for (const e of Array.isArray(v) ? v : [v]) max = Math.max(max, walkDepth(e, d))
    } else max = Math.max(max, walkDepth(v, d + 1))
  }
  return max
}
const orBranches = (f) => (Array.isArray(f?._or) ? f._or
  : Array.isArray(f?._and) ? f._and.flatMap((x) => (Array.isArray(x?._or) ? x._or : [])) : [])

const lines = raw.trim().split('\n').filter(Boolean)
let parsed = 0
const found = []
for (const line of lines) {
  const [policy, collection, fjson] = line.split(SEP)
  let f
  try { f = JSON.parse(fjson); parsed++ } catch { continue }
  const branches = orBranches(f)
  const deep = branches.filter((b) => walkDepth(b) >= 2)
  if (deep.length < 2) continue
  const n = rowCounts[collection] ?? 0
  found.push({ policy, collection, rows: n, branches: branches.length, deep: deep.length,
    depth: Math.max(...deep.map((b) => walkDepth(b))),
    note: n >= 1000 ? 'MEASURE THIS' : n >= 100 ? 'measure if it grows' : 'small table' })
}

// A sweep that parses nothing reports "clean". That is the failure mode to guard.
if (parsed === 0 || parsed < lines.length * 0.8) {
  console.error(`✗ SWEEP BROKEN: parsed ${parsed} of ${lines.length} filters — a "clean" result here would be a lie`)
  process.exit(2)
}

found.sort((a, b) => b.rows * b.deep - a.rows * a.deep)
console.log(`\n${TARGET}: ${lines.length} filtered read rules, ${parsed} parsed, ${found.length} with ≥2 deep-walking _or branches\n`)
console.log('collection'.padEnd(24), 'policy'.padEnd(23), 'rows'.padStart(7), 'br'.padStart(4), 'deep'.padStart(5), 'depth'.padStart(6), ' note')
for (const x of found) {
  console.log(x.collection.padEnd(24), x.policy.padEnd(23), String(x.rows).padStart(7),
    String(x.branches).padStart(4), String(x.deep).padStart(5), String(x.depth).padStart(6), ' ' + x.note)
}
console.log('\n⚠ Candidates, not verdicts — branch cardinality decides, and this cannot see it.')
console.log('  Measure before believing: rebuild the sibling LEFT JOINs and count(*) them.\n')
