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
 *   • Everyone who has answered the question — INCLUDING 'CH'.
 *     Swiss Volley is a federation in VIS with its own player index (no. 189 /
 *     SUI) exactly like the others, so the same question is answerable for our
 *     Swiss-origin members and the Transfers page groups them under it. Their
 *     `in_vis = false` blocks nothing (no international transfer applies to
 *     them), it is simply "no player of that name in Swiss Volley's index" —
 *     which is still worth seeing. ⚠ This reverses the original design; the
 *     comments on migration 240 still describe CH as deliberately skipped.
 *     Since migration 342 every answer IS a federation: a member whose first
 *     licence is issued here answers 'CH', so no answer excludes anyone.
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

/**
 * One federation roster, indexed every way the cascade needs it.
 *
 * ⚠ `byTokens` holds a SET per key, not a single number: the token bag
 * deliberately collapses name variants, so two DIFFERENT players can land on
 * one key. Where that happens the match is refused rather than guessed.
 */
export function buildRosterIndex(visRows) {
  const roster = new Map()
  const byTokens = new Map()
  const players = []
  // Player number → VIS's own spelling, so a hand-set link (migration 312) can
  // be CONFIRMED against the index rather than trusted.
  const byNo = new Map()
  for (const p of visRows || []) {
    if (!p.person) continue
    byNo.set(Number(p.no), `${p.person.firstName ?? ''} ${p.person.lastName ?? ''}`.trim())
    roster.set(`${norm(p.person.lastName)}|${norm(p.person.firstName)}`, p.no)
    const tk = tokenKey(p.person.firstName, p.person.lastName)
    if (!tk) continue
    if (!byTokens.has(tk)) byTokens.set(tk, new Set())
    byTokens.get(tk).add(p.no)
    players.push({
      no: p.no,
      tokens: new Set(nameTokens(p.person.firstName, p.person.lastName)),
      lastTokens: new Set(nameTokens(p.person.lastName)),
    })
  }
  return { roster, byTokens, players, byNo }
}

/**
 * Resolve ONE member against ONE federation index → `{ no, manualName }`.
 *
 * Extracted so the rules below are unit-testable rather than asserted in a
 * comment; `__tests__/vis-player-match.test.mjs` locks each one. ⚠ Mirrored in
 * `kscw-endpoints/src/vis-player-check.js` — change both.
 *
 * The cascade, in order, each step firing only if the previous found nothing:
 *   1. exact `lastname|firstname`
 *   2. equal token bags — the same name split differently across first/last
 *   3. surname exact + first-name prefix (VIS stores full legal given names)
 *   4. member tokens a strict SUBSET of one player's, surname on the surname
 * …then the hand-set link, which overrides all four when it is CONFIRMED.
 */
export function matchMember(m, { roster, byTokens, players, byNo }) {
  let no = roster.get(`${norm(m.ln)}|${norm(m.fn)}`)
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
  if (!no) {
    // VIS keeps EVERY legal given name, and the one a member goes by is not
    // always the first: member 34 is `Christiane` / `Clüver`, VIS #243602 in
    // the GER index is `Dorothea Christiane` / `Clüver`. A prefix cannot reach
    // a second given name, and step 2 needs the bags EQUAL.
    // ⚠ Measured over the whole prod cohort 2026-08-13 (430 members, 416 then
    // unmatched): this adds exactly ONE match — #243602 — with zero ties. Do
    // NOT relax it toward a bare surname match: the surname-only near-hits are
    // different people (`Linda Imhof` → `Stefan Imhof`).
    const mTokens = nameTokens(m.fn, m.ln)
    const mLast = nameTokens(m.ln)
    const cands = players.filter((p) => p.tokens.size > mTokens.length
      && mTokens.every((t) => p.tokens.has(t))
      && mLast.every((t) => p.lastTokens.has(t)))
    if (cands.length === 1) no = cands[0].no
  }
  // A CONFIRMED hand-set link (migration 312) wins over name matching — that is
  // what the column is for: the mismatches the cascade cannot reach (a married
  // name, a transliteration) are exactly the ones a human resolves.
  // ⚠ An UNCONFIRMED one wins nothing. `in_vis` is read as eligibility
  // evidence, so a typo'd number must never assert presence; it is recorded
  // with a NULL name and the Transfers page flags it.
  const manualName = m.manual != null ? (byNo.get(m.manual) ?? null) : null
  if (manualName) no = m.manual
  return { no: no ?? null, manualName }
}

/**
 * Replace `vis_players` (migration 313) with exactly what this run downloaded.
 *
 * A FULL replace inside one transaction, not an upsert: it makes the table mean
 * "the last successful download" instead of "everything ever seen", which is
 * what keeps a federation nobody claims any more from lingering, and what makes
 * `synced_at` uniform and therefore meaningful.
 *
 * ⚠ Skipped when the download produced nothing. An empty `rows` here means every
 * federation was unmapped or the cohort was empty — never that VIS is genuinely
 * empty — so wiping the table on it would destroy good data on a bad run.
 *
 * ⚠ Chunked INSERTs: a single VALUES list of every federation's roster is tens
 * of thousands of rows on one statement.
 *
 * Returns the number of rows written.
 */
function writeVisPlayerStaging(env, rows) {
  if (!rows.length) {
    console.warn('[vis] ⚠ nothing downloaded — leaving vis_players untouched')
    return 0
  }

  // Is a VIS player number global, or only unique within a federation? The
  // composite PK is correct either way, so rather than assume, say so out loud
  // when the data answers it.
  const seenIso = new Map()
  for (const r of rows) {
    const prev = seenIso.get(r.no)
    if (prev && prev !== r.iso) {
      console.warn(`[vis] ⚠ player #${r.no} listed under BOTH ${prev} and ${r.iso}`)
    } else if (!prev) seenIso.set(r.no, r.iso)
  }

  // Same quoting rule as the members write below: doubled single quotes, and a
  // hard length cap so a pathological upstream value cannot blow the statement.
  const lit = (s) => (s == null || s === '' ? 'NULL' : `'${String(s).slice(0, 200).replace(/'/g, "''")}'`)
  const num = (n) => (Number.isFinite(Number(n)) ? String(Number(n)) : 'NULL')

  const statements = []
  for (let i = 0; i < rows.length; i += 1000) {
    const vals = rows.slice(i, i + 1000).map((r) =>
      `(${lit(r.iso)}, ${r.no}, ${lit(r.code)}, ${num(r.fedNo)}, ${lit(r.fn)}, ${lit(r.ln)})`).join(',\n')
    statements.push(
      'INSERT INTO vis_players (federation_iso, player_no, federation_code, federation_no, first_name, last_name)\n'
      + `VALUES\n${vals}\nON CONFLICT (federation_iso, player_no) DO NOTHING;`)
  }
  psql(env, `BEGIN;\nDELETE FROM vis_players;\n${statements.join('\n')}\nCOMMIT;`)
  return rows.length
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const target = args.find((a) => a === 'dev' || a === 'prod')
  for (const k of ['VIS_USER', 'VIS_PASS']) if (!process.env[k]) throw new Error(`missing env ${k}`)
  if (!target) throw new Error('specify dev or prod')
  const env = ENVS[target]

  const members = psql(env, `SELECT m.id, m.first_name, m.last_name, m.federation_of_origin,
             coalesce(m.vis_player_no_manual::text, '')
      FROM members m
     WHERE m.federation_of_origin IS NOT NULL
       AND m.kscw_membership_active
       -- Guests hold no club licence, so nothing about eligibility or transfers
       -- applies to them. A member who is a full player on ANY team qualifies.
       -- ⚠ CURRENT season: join teams and require active. Unqualified, this
       -- answered "is this member a licensed player?" from EVERY season ever, so
       -- a past-season full player who is a guest today (or on no roster at all)
       -- was still pushed into the FIVB VIS index as club-licensed — and in_vis
       -- is read back as eligibility evidence.
       AND EXISTS (SELECT 1 FROM member_teams mt
                    JOIN teams t ON t.id = mt.team AND t.active
                    WHERE mt.member = m.id AND coalesce(mt.guest_level, 0) = 0)
     ORDER BY m.federation_of_origin, m.last_name;`)
    .trim().split('\n').filter(Boolean)
    .map((l) => {
      const [id, fn, ln, foo, manual] = l.split('|')
      return { id, fn, ln, foo, manual: manual ? Number(manual) : null }
    })

  console.log(`[vis] ${members.length} licensed member(s) with a federation of origin`)
  if (!members.length) return

  const cookie = await visLogin()
  const feds = (await visPost(cookie, `<Request Type="${FED_LIST_TYPE}" Properties="No Code Name"/>`)).data
  const byCode = new Map(feds.map((f) => [f.code, f]))

  const rosters = new Map(); const unmapped = []; const staging = []
  for (const iso of [...new Set(members.map((m) => m.foo))]) {
    const fed = byCode.get(ISO2FIVB[iso])
    if (!fed) { unmapped.push(iso); console.log(`  ⚠ ${iso}: no VIS federation mapped — skipped`); continue }
    const j = await visPost(cookie,
      `<Request Type="${REQUEST_TYPE}" Properties="No"><Filter NoFederation="${fed.no}"/>` +
      `<Relation Name="Person" Properties="FirstName LastName"/></Request>`)
    const index = buildRosterIndex(j.data)
    rosters.set(iso, index)
    // Kept for staging (migration 313). Same rows the index is built from, and
    // the same `!p.person` guard — a roster entry with no person carries no
    // name to store and no name to match.
    for (const p of j.data || []) {
      if (!p.person) continue
      const no = Number(p.no)
      if (!Number.isInteger(no)) continue
      staging.push({
        iso, no, code: fed.code, fedNo: fed.no,
        fn: p.person.firstName ?? null, ln: p.person.lastName ?? null,
      })
    }
    console.log(`  ${iso} (${fed.code}): ${index.roster.size} players`)
  }

  const found = [], notFound = []
  for (const m of members) {
    const index = rosters.get(m.foo)
    if (!index) continue // unmapped federation — leave the row untouched, not false
    const { no, manualName } = matchMember(m, index)
    ;(no ? found : notFound).push({ ...m, no, manualName })
  }

  console.log(`\n[vis] in VIS: ${found.length} | not found: ${notFound.length}`)
  for (const f of found) {
    console.log(`  ✓ ${f.ln}, ${f.fn} (${f.foo}) — VIS #${f.no}${f.manualName ? ` (manual → "${f.manualName}")` : ''}`)
  }
  // A hand-set number the index does not know is the one state worth shouting
  // about: somebody believes that link holds and it does not.
  for (const n of notFound.filter((m) => m.manual != null)) {
    console.log(`  ⚠ ${n.ln}, ${n.fn} (${n.foo}) — manual #${n.manual} is NOT in the ${ISO2FIVB[n.foo]} index`)
  }
  if (unmapped.length) console.log(`  ⚠ unmapped federations, left unchecked: ${unmapped.join(', ')}`)

  if (dryRun) { console.log('[vis] --dry-run: nothing written'); return }

  // Only rows we actually evaluated are written; an unmapped federation leaves
  // in_vis NULL rather than asserting a false negative.
  // ⚠ `NULL::text` and not a bare NULL: an untyped NULL in a VALUES list takes
  // the type of the column it lands beside, and quote-doubling is what keeps a
  // VIS-supplied name from closing the literal (standard_conforming_strings is
  // on, so a backslash is not an escape here).
  const sqlName = (s) => (s ? `'${String(s).slice(0, 200).replace(/'/g, "''")}'` : 'NULL::text')
  const vals = [...found, ...notFound]
    .map((m) => `(${m.id}, ${m.no ? 'true' : 'false'}, ${m.no ?? 'NULL'}, ${sqlName(m.manualName)})`).join(',\n')
  psql(env, `BEGIN;
UPDATE members m SET in_vis = v.f, vis_player_no = v.n, vis_manual_vis_name = v.mn, in_vis_checked_at = now()
  FROM (VALUES\n${vals}\n) AS v(id, f, n, mn) WHERE m.id = v.id;
COMMIT;
SELECT 'in_vis true' AS m, count(*) AS n FROM members WHERE in_vis
UNION ALL SELECT 'in_vis false', count(*) FROM members WHERE in_vis = false
UNION ALL SELECT 'unchecked', count(*) FROM members WHERE in_vis IS NULL;`)
  console.log(`[vis] wrote ${found.length + notFound.length} row(s) (${target})`)

  // Derived data, written last and on its own: the members UPDATE above IS the
  // job, so a staging failure must not fail the run or mask the verdicts it
  // already committed. Loud warning, non-zero exit withheld deliberately.
  try {
    const n = writeVisPlayerStaging(env, staging)
    if (n) console.log(`[vis] staged ${n} roster row(s) from ${rosters.size} federation(s)`)
  } catch (e) {
    console.warn(`[vis] ⚠ roster staging FAILED — verdicts above are unaffected: ${e.message}`)
  }
}

// Only run as a job when invoked directly — the test imports the two pure
// helpers above and must not kick off a VIS session by doing so.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error('[vis] FAILED:', e.message); process.exit(1) })
}
