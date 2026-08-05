#!/usr/bin/env node
/**
 * Is each member present in the VIS player index of their federation of origin?
 * → `members.in_vis` / `vis_player_no` / `in_vis_checked_at` (migration 240).
 *
 * A transfer can only be REQUESTED for a player already in VIS. If they are not
 * there, the club must first ask the federation of origin to enter them — a
 * different action, to a different party. This check is what tells the two apart.
 *
 * ⚠ THIS SCRIPT IS MIRRORED by the endpoint
 * `kscw-endpoints/src/vis-player-check.js`, which serves the "Check VIS now"
 * button on /admin/transfers (2026-08-05). Two copies exist because this one
 * reaches Postgres through `sudo docker exec … psql` — which does not exist
 * inside the Directus container — and the extension bundle must not import
 * across the `scripts/` bind-mount (a separate deploy unit, CLAUDE.md §4).
 * **If you change the ISO→FIVB map, the cohort SELECT, the name-matching
 * cascade or the write rule here, change it there in the same commit.** This
 * script stays the monthly cron run; the endpoint is the same check on demand.
 *
 * ⚠ READ-ONLY against VIS, by construction: the request type is a hardcoded
 * constant asserted against a read-verb allowlist at module load. The same proxy
 * serves Save/Sign/Confirm/Release/CancelVolleyTransfer, so a wrong type here
 * would not fetch wrong data — it would alter a real player's eligibility.
 *
 * ⚠ VIS ignores name filters (`Filter LastName` returns the full 130k index), so
 * presence is established by pulling the whole player roster of the relevant
 * federation and matching locally — ~30 federation rosters, a few thousand rows
 * each, rather than a per-member lookup.
 *
 * That was long assumed to be expensive enough to justify running this MONTHLY.
 * It is not: measured 2026-08-05 on both envs, 24 federations / 464 members /
 * ~3.6-3.8s end to end. The cron guard in `/opt/vis-sync/vis-sync.sh` moved to
 * WEEKLY (Mondays, `date +%u` = 1) the same day.
 *
 * WHO IS CHECKED
 *   • Everyone with a federation of origin other than 'NONE' — INCLUDING 'CH'.
 *     Swiss Volley is a federation in VIS with its own player index (no. 189 /
 *     SUI) exactly like the others, so the same question is answerable for our
 *     Swiss-origin members and the Transfers page groups them under it. Their
 *     `in_vis = false` blocks nothing (no international transfer applies to
 *     them), it is simply "no player of that name in Swiss Volley's index" —
 *     which is still worth seeing. ⚠ This reverses the original design; the
 *     comments on migration 240 still describe CH as deliberately skipped.
 *   • 'NONE' stays out: there is no federation to look them up in.
 *   • GUESTS STAY OUT. A member whose every `member_teams` row has
 *     `guest_level > 0` trains with a team without being licensed by the club, so
 *     there is no eligibility to establish and nothing on the Transfers page
 *     applies to them. Kept in step with the page, which drops them for the same
 *     reason.
 *
 * ⚠ Swiss Volley's roster is the largest one this job pulls (it is our own
 * country and the only federation where most of the club is in scope). That is a
 * one-off cost per run, not per member — the roster is fetched once and matched
 * locally like every other federation's.
 *
 * Usage:
 *   VIS_USER=… VIS_PASS=… node vis-player-check.mjs <dev|prod> [--dry-run]
 *   KSCW_LOCAL_PSQL=1 …            # when running ON the VPS (no ssh hop)
 */
import { spawnSync } from 'node:child_process'

const PROXY = 'https://proxy.app.fivb.com'

const REQUEST_TYPE = 'GetPlayerList'
const FED_LIST_TYPE = 'GetFederationList'
for (const t of [REQUEST_TYPE, FED_LIST_TYPE]) {
  if (!/^(Get|Check|Export|List)/.test(t)) throw new Error(`refusing to run: ${t} is not a read-only VIS verb`)
}

/**
 * ISO 3166-1 alpha-2 → FIVB 3-letter federation code. FIVB codes are IOC-style
 * and NOT derivable from ISO (DE→GER, NL→NED, LK→SRI, IR→IRI), so they are
 * mapped explicitly. An unmapped country is reported and skipped — never guessed.
 */
const ISO2FIVB = {
  CH: 'SUI',
  DE: 'GER', IT: 'ITA', FR: 'FRA', AF: 'AFG', ES: 'ESP', PL: 'POL', US: 'USA',
  SE: 'SWE', LK: 'SRI', AT: 'AUT', PT: 'POR', ET: 'ETH', RU: 'RUS', FI: 'FIN',
  BG: 'BUL', CZ: 'CZE', NL: 'NED', NZ: 'NZL', PE: 'PER', RS: 'SRB', AL: 'ALB',
  SI: 'SLO', MX: 'MEX', BR: 'BRA', GB: 'GBR', GR: 'GRE', HU: 'HUN', IQ: 'IRQ',
  IR: 'IRI', CO: 'COL', TR: 'TUR', UA: 'UKR', HR: 'CRO', BE: 'BEL', DK: 'DEN',
  NO: 'NOR', JP: 'JPN', CN: 'CHN', KR: 'KOR', AR: 'ARG', CA: 'CAN', CU: 'CUB',
  DO: 'DOM', EG: 'EGY', TN: 'TUN', MA: 'MAR', IN: 'IND', TH: 'THA', RO: 'ROU',
  SK: 'SVK', EE: 'EST', LV: 'LAT', LT: 'LTU', BA: 'BIH', MK: 'MKD', ME: 'MNE',
  IE: 'IRL', IS: 'ISL', LU: 'LUX', ZA: 'RSA', KE: 'KEN', NG: 'NGR', VE: 'VEN',
  CL: 'CHI', UY: 'URU', PY: 'PAR', EC: 'ECU', BO: 'BOL',
}

const ENVS = {
  dev: { container: 'kscw-postgres', database: 'directus_kscw_dev', user: 'supabase_admin' },
  prod: { container: 'kscw-postgres', database: 'postgres', user: 'supabase_admin' },
}

/**
 * ⚠ Never pass a `|` inside an ssh argv — ssh joins args into a REMOTE SHELL
 * string, so it becomes a pipe. `-tA` already defaults to `|`, so -F is not
 * needed. (Cost a silent zero-row result once.)
 */
function psql(env, sql) {
  const local = process.env.KSCW_LOCAL_PSQL === '1'
  const base = ['sudo', 'docker', 'exec', '-i', env.container,
    'psql', '-U', env.user, '-d', env.database, '-tA', '-X', '-v', 'ON_ERROR_STOP=1']
  const cmd = local ? base : ['ssh', 'hetzner', ...base]
  const r = spawnSync(cmd[0], cmd.slice(1), { input: sql, encoding: 'utf-8' })
  if (r.status !== 0) throw new Error(`psql failed:\n${r.stderr || r.stdout}`)
  return r.stdout
}

/** Accent- and punctuation-insensitive, so "Krawczyński" matches "Krawczynski". */
const norm = (s) => String(s || '').toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '')

/**
 * The whole name as a SORTED token bag, so it no longer matters which side of
 * the first/last split a middle name or a compound surname landed on.
 *
 * Real case that forced this (2026-08-05): member 729 is `Paula Fiorella` /
 * `Farina`; VIS #243491 in the ARG index is `Paula` / `Fiorella Farina`. Same
 * three tokens, opposite split — the exact key misses AND the prefix fallback
 * below never fires, because that one requires the SURNAME to be exact.
 *
 * ⚠ Splits BEFORE stripping punctuation — `norm()` would fuse "Fiorella Farina"
 * into one token and defeat the point.
 */
const nameTokens = (...parts) => parts
  .flatMap((p) => String(p || '').split(/[^\p{L}]+/u))
  .map((t) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, ''))
  .filter(Boolean)
  .sort()
const tokenKey = (first, last) => nameTokens(first, last).join(' ')

async function visLogin() {
  const r = await fetch(`${PROXY}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: process.env.VIS_USER, password: process.env.VIS_PASS }),
  })
  const body = await r.text()
  if (!r.ok || !/authenticated/.test(body)) throw new Error(`VIS login failed: ${r.status} ${body.slice(0, 200)}`)
  const cookie = (r.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ')
  if (!cookie) throw new Error('VIS login returned no session cookie')
  return cookie
}

/** ⚠ `accept: application/json` AND `origin` are required — else 406. */
const visHeaders = (cookie) => ({
  'content-type': 'application/xml', accept: 'application/json',
  origin: 'https://app.fivb.com', cookie,
  'x-fivb-env': 'production', 'x-fivb-version': 'VISSharp',
  'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
})

async function visPost(cookie, body) {
  const r = await fetch(`${PROXY}/proxy`, { method: 'POST', headers: visHeaders(cookie), body })
  const text = await r.text()
  if (!r.ok) throw new Error(`VIS request failed: ${r.status} ${text.slice(0, 250)}`)
  const json = JSON.parse(text)
  if (json.errors) throw new Error(`VIS error: ${JSON.stringify(json.errors).slice(0, 250)}`)
  return json
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const target = args.find((a) => a === 'dev' || a === 'prod')
  for (const k of ['VIS_USER', 'VIS_PASS']) if (!process.env[k]) throw new Error(`missing env ${k}`)
  if (!target) throw new Error('specify dev or prod')
  const env = ENVS[target]

  const members = psql(env, `SELECT m.id, m.first_name, m.last_name, m.federation_of_origin
      FROM members m
     WHERE m.federation_of_origin IS NOT NULL
       AND m.federation_of_origin <> 'NONE'
       AND m.kscw_membership_active
       -- Guests hold no club licence, so nothing about eligibility or transfers
       -- applies to them. A member who is a full player on ANY team qualifies.
       AND EXISTS (SELECT 1 FROM member_teams mt
                    WHERE mt.member = m.id AND coalesce(mt.guest_level, 0) = 0)
     ORDER BY m.federation_of_origin, m.last_name;`)
    .trim().split('\n').filter(Boolean)
    .map((l) => { const [id, fn, ln, foo] = l.split('|'); return { id, fn, ln, foo } })

  console.log(`[vis] ${members.length} licensed member(s) with a federation of origin`)
  if (!members.length) return

  const cookie = await visLogin()
  const feds = (await visPost(cookie, `<Request Type="${FED_LIST_TYPE}" Properties="No Code Name"/>`)).data
  const byCode = new Map(feds.map((f) => [f.code, f]))

  const rosters = new Map(); const unmapped = []
  for (const iso of [...new Set(members.map((m) => m.foo))]) {
    const fed = byCode.get(ISO2FIVB[iso])
    if (!fed) { unmapped.push(iso); console.log(`  ⚠ ${iso}: no VIS federation mapped — skipped`); continue }
    const j = await visPost(cookie,
      `<Request Type="${REQUEST_TYPE}" Properties="No"><Filter NoFederation="${fed.no}"/>` +
      `<Relation Name="Person" Properties="FirstName LastName"/></Request>`)
    const roster = new Map()
    // ⚠ A Set per key, not a single number: the token bag deliberately collapses
    // name variants, so two DIFFERENT players can land on one key. Where that
    // happens the match is refused rather than guessed.
    const byTokens = new Map()
    for (const p of j.data || []) {
      if (!p.person) continue
      roster.set(`${norm(p.person.lastName)}|${norm(p.person.firstName)}`, p.no)
      const tk = tokenKey(p.person.firstName, p.person.lastName)
      if (!tk) continue
      if (!byTokens.has(tk)) byTokens.set(tk, new Set())
      byTokens.get(tk).add(p.no)
    }
    rosters.set(iso, { roster, byTokens })
    console.log(`  ${iso} (${fed.code}): ${roster.size} players`)
  }

  const found = [], notFound = []
  for (const m of members) {
    const entry = rosters.get(m.foo)
    if (!entry) continue // unmapped federation — leave the row untouched, not false
    const { roster, byTokens } = entry
    const key = `${norm(m.ln)}|${norm(m.fn)}`
    let no = roster.get(key)
    if (!no) {
      // Same tokens, split differently across first/last (see nameTokens). Only
      // when it identifies exactly ONE player — a tie is left unmatched.
      const cands = byTokens.get(tokenKey(m.fn, m.ln))
      if (cands && cands.size === 1) no = [...cands][0]
    }
    if (!no) {
      // VIS stores full legal given names ("Kacper Jan"); accept a prefix match
      // on the first name when the surname is exact.
      for (const [k, v] of roster) {
        const [ln, fn] = k.split('|')
        if (ln === norm(m.ln) && (fn.startsWith(norm(m.fn)) || norm(m.fn).startsWith(fn))) { no = v; break }
      }
    }
    ;(no ? found : notFound).push({ ...m, no: no ?? null })
  }

  console.log(`\n[vis] in VIS: ${found.length} | not found: ${notFound.length}`)
  for (const f of found) console.log(`  ✓ ${f.ln}, ${f.fn} (${f.foo}) — VIS #${f.no}`)
  if (unmapped.length) console.log(`  ⚠ unmapped federations, left unchecked: ${unmapped.join(', ')}`)

  if (dryRun) { console.log('[vis] --dry-run: nothing written'); return }

  // Only rows we actually evaluated are written; an unmapped federation leaves
  // in_vis NULL rather than asserting a false negative.
  const vals = [...found, ...notFound]
    .map((m) => `(${m.id}, ${m.no ? 'true' : 'false'}, ${m.no ?? 'NULL'})`).join(',\n')
  psql(env, `BEGIN;
UPDATE members m SET in_vis = v.f, vis_player_no = v.n, in_vis_checked_at = now()
  FROM (VALUES\n${vals}\n) AS v(id, f, n) WHERE m.id = v.id;
COMMIT;
SELECT 'in_vis true' AS m, count(*) AS n FROM members WHERE in_vis
UNION ALL SELECT 'in_vis false', count(*) FROM members WHERE in_vis = false
UNION ALL SELECT 'unchecked', count(*) FROM members WHERE in_vis IS NULL;`)
  console.log(`[vis] wrote ${found.length + notFound.length} row(s) (${target})`)
}

main().catch((e) => { console.error('[vis] FAILED:', e.message); process.exit(1) })
