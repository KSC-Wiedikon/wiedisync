#!/usr/bin/env node
/**
 * Basketplan person scrape → `basketplan_people` staging (migration 230).
 *
 * Basketplan is the ISSUING authority for Swiss Basketball licences and is the
 * only register we can reach that carries nationality on ~100% of licensed
 * people. `bp-sync.js` cannot be extended for this: it reads the PUBLIC
 * `xmlView=true` games/rankings API, whereas person data needs an authenticated
 * session — and the login hashes the password client-side into a hidden
 * `j_password` and fingerprints the device, so a curl/fetch POST cannot
 * authenticate. Hence Playwright, and hence a separate script.
 *
 * ⚠⚠ NAVIGATION IS STRICT-ALLOWLIST, AND THAT IS A SAFETY REQUIREMENT, NOT STYLE.
 * The licence list and person pages contain plain <a href> links that MUTATE or
 * DESTROY club data — `hideLicenceFromClub.do`, `deleteLogo.do` — and the list's
 * own form (`printLicences.do`) stamps a `Gedruckt` timestamp on every licence it
 * renders. A generic crawler that follows links would quietly corrupt the club's
 * licence register. This script therefore NEVER clicks a link and never submits a
 * form: it only ever page.goto()s URLs built from the two allow-listed patterns
 * below, and asserts that shape before every navigation.
 *
 * Writes staging only. The fill-only application into `members` is a separate,
 * reviewable step — see --apply.
 *
 * Usage:
 *   BP_USER=… BP_PASS=… node basketplan-scrape-people.mjs <dev|prod> [--limit N] [--dry-run]
 *   node basketplan-scrape-people.mjs <dev|prod> --apply    # staging -> members, fill-only
 *
 * Credentials live in Bitwarden at `services/basketplan`:
 *   BP_USER=$(rbw get 'Basketplan - KSC Wiedikon' --folder services/basketplan --field username)
 *   BP_PASS=$(rbw get 'Basketplan - KSC Wiedikon' --folder services/basketplan)
 */
import { chromium } from 'playwright'
import { spawnSync } from 'node:child_process'

const BASE = 'https://www.basketplan.ch'
const CLUB_ID = 166
/** 2025/2026. The season picker is a plain GET; bump when the season rolls. */
const SEASON_ID = 30

/**
 * The ONLY two URL shapes this script may navigate to. Anything else — in
 * particular anything containing hide/delete/print — is refused before the
 * browser is asked to go there.
 */
const ALLOWED = [
  /^https:\/\/www\.basketplan\.ch\/showLogin\.do$/,
  /^https:\/\/www\.basketplan\.ch\/showPrintLicences\.do\?clubId=\d+&seasonId=\d+$/,
  /^https:\/\/www\.basketplan\.ch\/findPersonById\.do\?personId=\d+$/,
]

function assertAllowed(url) {
  if (!ALLOWED.some((re) => re.test(url))) {
    throw new Error(`REFUSED navigation to non-allowlisted URL: ${url}`)
  }
  // Belt and braces: these substrings must never appear in a URL we visit.
  if (/hide|delete|print(?!Licences)|remove|save|submit/i.test(url)) {
    throw new Error(`REFUSED navigation to state-changing URL: ${url}`)
  }
  return url
}

async function go(page, url) {
  await page.goto(assertAllowed(url), { waitUntil: 'domcontentloaded' })
}

/** dd.mm.yyyy → ISO, or null. Basketplan holds at least one corrupt year ("0996"). */
function parseDate(s) {
  const m = String(s || '').trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  if (!m) return null
  const [, d, mo, y] = m
  const year = Number(y)
  if (year < 1900 || year > 2100) return null
  return `${y}-${mo}-${d}`
}

const jaNein = (s) => {
  const v = String(s || '').trim().toLowerCase()
  return v === 'ja' ? true : v === 'nein' ? false : null
}

async function login(page) {
  await go(page, `${BASE}/showLogin.do`)
  await page.fill('input[name="j_username"]', process.env.BP_USER)
  await page.fill('input[name="p_password"]', process.env.BP_PASS)
  await Promise.all([
    page.waitForLoadState('networkidle'),
    page.click('input[type="image"]'),
  ])
  const body = await page.evaluate(() => document.body.innerText)
  if (!/Angemeldet als|Connecté|KSC WIEDIKON/i.test(body)) {
    throw new Error('login failed — no authenticated marker on the landing page')
  }
}

/** personIds from the licence list. Read from hrefs; nothing is clicked. */
async function harvestPersonIds(page) {
  await go(page, `${BASE}/showPrintLicences.do?clubId=${CLUB_ID}&seasonId=${SEASON_ID}`)
  const ids = await page.evaluate(() =>
    [...document.querySelectorAll('a[href*="findPersonById.do"]')]
      .map((a) => (a.getAttribute('href') || '').match(/personId=(\d+)/)?.[1])
      .filter(Boolean))
  return [...new Set(ids)].map(Number)
}

/**
 * Read one person page. Values come from the form controls by NAME — never by
 * visual position, which reorders between Basketplan releases.
 */
async function scrapePerson(page, personId) {
  await go(page, `${BASE}/findPersonById.do?personId=${personId}`)
  return page.evaluate(() => {
    const val = (name) => {
      const el = document.querySelector(`[name="${name}"]`)
      if (!el) return ''
      if (el.tagName === 'SELECT') {
        const o = el.options[el.selectedIndex]
        return o ? (o.value ?? '') : ''
      }
      return el.value ?? ''
    }
    const selText = (name) => {
      const el = document.querySelector(`select[name="${name}"]`)
      const o = el?.options?.[el.selectedIndex]
      return o ? (o.text || '').trim() : ''
    }
    return {
      // Field names verified against the live form (findPersonById.do), NOT
      // guessed: familyName/firstName/birthday, and `trainedInSwiss` for the
      // FIBA "in der Schweiz ausgebildet" flag, whose three options are -/Ja/Nein
      // so an unanswered "-" must stay NULL rather than collapse to false.
      lastName: val('familyName'), firstName: val('firstName'),
      birthdate: val('birthday'),
      nation1: val('nation_1'), nation2: val('nation_2'),
      natJustified: selText('natJustified'),
      trainedInCh: selText('trainedInSwiss'),
      otrProvisional: selText('regionalTableRefereeProvisorily'),
      otnProvisional: selText('nationalTableRefereeProvisorily'),
      otr1: val('regionalTableReferee1'), otr2: val('regionalTableReferee2'),
      otn1: val('nationalTableReferee1'), otn2: val('nationalTableReferee2'),
      refReg: val('regionalReferee'), refNat: val('nationalReferee'),
      refMini: val('miniReferee'), refYouth: val('youthReferee'),
      licenceNr: (document.body.innerText.match(/Lizenznummer:\s*(\d+)/) || [])[1] || '',
      lastScored: (document.body.innerText.match(/Letztes Spiel geschrieben am[:\s]*(\d{2}\.\d{2}\.\d{4})/) || [])[1] || '',
    }
  })
}

// Postgres via psql over SSH — the same wrapper apply-migrations.mjs and the
// ClubDesk importers use. Deliberately NOT the `pg` package: no script in this
// repo carries a Postgres client dependency, and the DB is only reachable from
// inside the VPS container anyway.
const ENVS = {
  dev:  { container: 'kscw-postgres', database: 'directus_kscw_dev', user: 'supabase_admin' },
  prod: { container: 'kscw-postgres', database: 'postgres',          user: 'supabase_admin' },
}

function psqlApply(env, sqlText) {
  const cmd = ['ssh', 'hetzner', 'sudo', 'docker', 'exec', '-i', env.container,
    'psql', '-U', env.user, '-d', env.database, '-X', '-v', 'ON_ERROR_STOP=1']
  const r = spawnSync(cmd[0], cmd.slice(1), { input: sqlText, encoding: 'utf-8' })
  if (r.status !== 0) throw new Error(`psql failed:\n${r.stderr || r.stdout}`)
  return r.stdout
}

const lit = (v) => (v === null || v === undefined || v === '' ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)
const num = (v) => (v === null || v === undefined || v === '' ? 'NULL' : String(Number(v)))
const bool = (v) => (v === null || v === undefined ? 'NULL' : v ? 'true' : 'false')


/**
 * Apply staged Basketplan data into `members`. FILL-ONLY and SET-TRUE-ONLY —
 * this never overwrites a value wiedisync already holds and never clears a flag.
 *
 * Match: licence number first (Basketplan ISSUES it, and migration 208 aligned
 * ours to theirs), then exact name + birthdate. Deliberately no fuzzy fallback —
 * a wrong match here writes a wrong nationality onto a real person.
 *
 * NOT applied, on purpose: address (Basketplan's are frequently worse than ours —
 * it holds `Hagenbuchrain` where we hold the correct `Hagenbuchrain 38`),
 * birthdate (it carries at least one corrupt year, "0996"), AHV and IBAN (sparse,
 * high-sensitivity, and exposed for minors). Those are not even staged.
 */
function buildApplySql() {
  return `
BEGIN;

CREATE TEMP TABLE bp_match ON COMMIT DROP AS
SELECT DISTINCT ON (mem.id)
       mem.id AS member_id, bp.*
  FROM basketplan_people bp
  JOIN members mem
    ON  nullif(btrim(mem.license_nr::text),'') = nullif(btrim(bp.licence_nr),'')
   OR  (lower(btrim(mem.last_name))  = lower(btrim(bp.last_name))
    AND lower(btrim(mem.first_name)) = lower(btrim(bp.first_name))
    AND mem.birthdate = bp.birthdate)
 ORDER BY mem.id,
          -- licence-number matches win over name+birthdate ones
          (nullif(btrim(mem.license_nr::text),'') = nullif(btrim(bp.licence_nr),'')) DESC;

-- ── Nationality: fill only where wiedisync has none ─────────────────────────
-- nation_1 is primary; nation_2 is appended when it resolves too, giving the
-- ordered "CH,IT" the trigger turns into ClubDesk's single German name.
-- An unresolvable (ambiguous) option contributes NOTHING rather than a guess —
-- so a member whose ONLY value is ambiguous stays empty and shows up in the
-- residue report below.
UPDATE members m
   SET nationalitaet_codes = codes
  FROM (
    SELECT b.member_id,
           concat_ws(',', n1.iso, nullif(n2.iso, n1.iso)) AS codes
      FROM bp_match b
      LEFT JOIN basketplan_nations n1 ON n1.bp_id = b.nation1_id AND NOT n1.ambiguous
      LEFT JOIN basketplan_nations n2 ON n2.bp_id = b.nation2_id AND NOT n2.ambiguous
     WHERE n1.iso IS NOT NULL
  ) x
 WHERE m.id = x.member_id
   AND m.nationalitaet_codes IS NULL
   AND x.codes ~ '^[A-Z]{2}(,[A-Z]{2})*$';

-- ── Officials: set-true only, never clear ──────────────────────────────────
-- Basketplan stores acquisition DATES; a date present means the licence was
-- issued. Absence is not evidence of revocation (a lapsed licence keeps its
-- date), so nothing here may set a flag back to false.
UPDATE members m SET otr1_bb = true FROM bp_match b
 WHERE m.id = b.member_id AND b.otr1_since IS NOT NULL AND m.otr1_bb IS DISTINCT FROM true;
UPDATE members m SET otr2_bb = true FROM bp_match b
 WHERE m.id = b.member_id AND b.otr2_since IS NOT NULL AND m.otr2_bb IS DISTINCT FROM true;
UPDATE members m SET otn1_bb = true FROM bp_match b
 WHERE m.id = b.member_id AND b.otn1_since IS NOT NULL AND m.otn1_bb IS DISTINCT FROM true;
UPDATE members m SET otn2_bb = true FROM bp_match b
 WHERE m.id = b.member_id AND b.otn2_since IS NOT NULL AND m.otn2_bb IS DISTINCT FROM true;
-- Any national table-official level also implies the coarse flag, which still
-- drives scorer eligibility and the ClubDesk push.
UPDATE members m SET otn_bb = true FROM bp_match b
 WHERE m.id = b.member_id AND (b.otn1_since IS NOT NULL OR b.otn2_since IS NOT NULL)
   AND m.otn_bb IS DISTINCT FROM true;
UPDATE members m SET referee_bb = true FROM bp_match b
 WHERE m.id = b.member_id
   AND (b.referee_reg_since IS NOT NULL OR b.referee_nat_since IS NOT NULL)
   AND m.referee_bb IS DISTINCT FROM true;

COMMIT;

SELECT 'members_with_nationality' AS metric, count(*) AS value FROM members WHERE nationalitaet_codes IS NOT NULL
UNION ALL SELECT 'members_still_without', count(*) FROM members WHERE nationalitaet_codes IS NULL
UNION ALL SELECT 'otn1_bb', count(*) FROM members WHERE otn1_bb
UNION ALL SELECT 'otn2_bb', count(*) FROM members WHERE otn2_bb
UNION ALL SELECT 'otr1_bb', count(*) FROM members WHERE otr1_bb
UNION ALL SELECT 'otr2_bb', count(*) FROM members WHERE otr2_bb;
`
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const target = args.find((a) => a === 'dev' || a === 'prod')
  const limitArg = args.indexOf('--limit')
  const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : Infinity

  if (!args.includes('--apply')) {
    for (const k of ['BP_USER', 'BP_PASS']) {
      if (!process.env[k]) throw new Error(`missing env ${k}`)
    }
  }
  if (!dryRun && !target) throw new Error('specify dev or prod (or pass --dry-run)')

  // --apply consumes what a previous run staged; it never touches Basketplan.
  if (args.includes('--apply')) {
    if (!target) throw new Error('--apply needs dev or prod')
    console.log(psqlApply(ENVS[target], buildApplySql()))
    return
  }

  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
  const rows = []
  try {
    await login(page)
    console.log('[bp] authenticated')
    const ids = await harvestPersonIds(page)
    console.log(`[bp] ${ids.length} licensed people in season ${SEASON_ID}`)
    const todo = ids.slice(0, limit)
    for (const [i, id] of todo.entries()) {
      const p = await scrapePerson(page, id)
      rows.push({ person_id: id, ...p })
      if ((i + 1) % 25 === 0 || i + 1 === todo.length) {
        console.log(`[bp] ${i + 1}/${todo.length}`)
      }
    }
  } finally {
    await browser.close()
  }

  const withNat = rows.filter((r) => r.nation1 && r.nation1 !== '0').length
  console.log(`[bp] scraped ${rows.length}; nationality set on ${withNat}`)

  if (dryRun) {
    console.log(JSON.stringify(rows.slice(0, 3), null, 1))
    console.log('[bp] --dry-run: nothing written')
    return
  }

  const env = ENVS[target]
  const values = rows.map((r) => `(${[
    num(r.person_id), lit(r.lastName), lit(r.firstName),
    parseDate(r.birthdate) ? lit(parseDate(r.birthdate)) + '::date' : 'NULL',
    lit(r.licenceNr),
    r.nation1 && r.nation1 !== '0' ? num(r.nation1) : 'NULL',
    r.nation2 && r.nation2 !== '0' ? num(r.nation2) : 'NULL',
    bool(jaNein(r.natJustified)), bool(jaNein(r.trainedInCh)),
    ...['otr1', 'otr2', 'otn1', 'otn2', 'refReg', 'refNat', 'refMini', 'refYouth', 'lastScored']
      .map((k) => (parseDate(r[k]) ? lit(parseDate(r[k])) + '::date' : 'NULL')),
  ].join(', ')})`).join(',\n')

  const sql = `BEGIN;
INSERT INTO basketplan_people
  (person_id, last_name, first_name, birthdate, licence_nr,
   nation1_id, nation2_id, nation_confirmed, trained_in_ch,
   otr1_since, otr2_since, otn1_since, otn2_since,
   referee_reg_since, referee_nat_since, referee_mini_since, referee_youth_since,
   last_scored_at)
VALUES
${values}
ON CONFLICT (person_id) DO UPDATE SET
  last_name=EXCLUDED.last_name, first_name=EXCLUDED.first_name,
  birthdate=EXCLUDED.birthdate, licence_nr=EXCLUDED.licence_nr,
  nation1_id=EXCLUDED.nation1_id, nation2_id=EXCLUDED.nation2_id,
  nation_confirmed=EXCLUDED.nation_confirmed, trained_in_ch=EXCLUDED.trained_in_ch,
  otr1_since=EXCLUDED.otr1_since, otr2_since=EXCLUDED.otr2_since,
  otn1_since=EXCLUDED.otn1_since, otn2_since=EXCLUDED.otn2_since,
  referee_reg_since=EXCLUDED.referee_reg_since, referee_nat_since=EXCLUDED.referee_nat_since,
  referee_mini_since=EXCLUDED.referee_mini_since, referee_youth_since=EXCLUDED.referee_youth_since,
  last_scored_at=EXCLUDED.last_scored_at, scraped_at=now();
COMMIT;
SELECT 'staged' AS metric, count(*) AS value FROM basketplan_people;
`
  psqlApply(env, sql)
  console.log(`[bp] staged ${rows.length} rows into basketplan_people (${target})`)
}

main().catch((e) => { console.error('[bp] FAILED:', e.message); process.exit(1) })
