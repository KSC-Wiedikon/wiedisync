#!/usr/bin/env node
/**
 * Basketplan opponent-CLUB contact scrape → `basketplan_clubs` (migration 279).
 *
 * ⚠⚠ THE SELECTORS IN THIS FILE ARE UNVERIFIED. ⚠⚠
 * I could not confirm the club-page structure: every candidate URL is session-
 * gated and returns 302 → showLogin.do when fetched anonymously (checked
 * 05.08.2026: findClubById.do?clubId=350, showClubs.do, and the same with
 * ?xmlView=true). I had no Basketplan credentials in this session, so nothing
 * below has ever run against the live site. Treat `harvestClubList()` and
 * `scrapeClubContact()` as a SPECIFICATION to be pinned on the first
 * --dry-run, not as working code. Both print exactly what they matched so the
 * first run is a diagnostic. Do NOT --apply before a --dry-run reads sensibly.
 *
 * Why this exists at all: ProBasket removed the contact list.
 *   "Spielplanverantwortliche Person: Bitte sorgt dafür das in Basketplan unter
 *    «Klub Funktionäre» die richtige Person (inkl. mind. E-Mail) hinterlegt ist.
 *    Wir werden hier mit dieser Liste zu arbeiten und es wird keine Excelliste
 *    geben."   — Einladung Spielplansitzung 05.09.2026
 * The Teamanmeldungen workbook has Team / Kategorie / Klub and no contact column,
 * so Basketplan «Klub Funktionäre» is the only source that exists.
 *
 * Why NOT in bp-sync.js and NOT in a cron:
 *  • bp-sync.js speaks the PUBLIC `xmlView=true` games/rankings API with no
 *    session. The club pages need an authenticated one.
 *  • The Basketplan login hashes the password client-side into a hidden
 *    `j_password` and ships a device fingerprint, so a curl/fetch POST cannot
 *    authenticate — hence Playwright, which the Directus container does not have.
 *  • It touches THIRD PARTIES' personal data. That is a decision a human takes
 *    per run, not something a nightly job should do unattended.
 *
 * ⚠⚠ NAVIGATION IS STRICT-ALLOWLIST, AND THAT IS A SAFETY REQUIREMENT, NOT STYLE.
 * Basketplan pages carry plain <a href> links that MUTATE or DESTROY club data
 * (hideLicenceFromClub.do, deleteLogo.do). A crawler that follows links would
 * quietly corrupt another club's register. This script NEVER clicks a link and
 * never submits a form: it only page.goto()s URLs built from the allow-listed
 * patterns below, and asserts that shape before every navigation. Extend ALLOWED
 * by nothing beyond what you have read and understood.
 *
 * ⚠ Run --dry-run against PROD, never dev: the nightly dev refresh scrubs contact
 * data, so nothing tested there proves anything about a fill-only predicate.
 * Store ONLY what the send path needs — name, role, up to two addresses, phone.
 * Never addresses or birthdates (the line migration 230 drew for basketplan_people).
 *
 * Usage:
 *   BP_USER=… BP_PASS=… node basketplan-scrape-clubs.mjs <dev|prod> --dry-run [--limit N]
 *   BP_USER=… BP_PASS=… node basketplan-scrape-clubs.mjs <dev|prod> --apply   [--limit N]
 *   node basketplan-scrape-clubs.mjs <dev|prod> --report      # no login: what is still missing
 *
 * Credentials live in Bitwarden at `services/basketplan`:
 *   BP_USER=$(rbw get 'Basketplan - KSC Wiedikon' --folder services/basketplan --field username)
 *   BP_PASS=$(rbw get 'Basketplan - KSC Wiedikon' --folder services/basketplan)
 */
import { spawnSync } from 'node:child_process'

const BASE = 'https://www.basketplan.ch'

/**
 * The ONLY URL shapes this script may navigate to.
 * ⚠ CLUB_LIST_URL is the single biggest unknown: showClubs.do exists (it 302s to
 * the login rather than 404ing) but its rendered markup is unseen. If the first
 * --dry-run finds no findClubById.do links on it, print the page title, find the
 * real list page BY HAND in a browser, and pin it here with a dated comment.
 */
const CLUB_LIST_URL = `${BASE}/showClubs.do`
const ALLOWED = [
  /^https:\/\/www\.basketplan\.ch\/showLogin\.do$/,
  /^https:\/\/www\.basketplan\.ch\/showClubs\.do$/,
  /^https:\/\/www\.basketplan\.ch\/findClubById\.do\?clubId=\d+$/,
]

function assertAllowed(url) {
  if (!ALLOWED.some((re) => re.test(url))) {
    throw new Error(`REFUSED navigation to non-allowlisted URL: ${url}`)
  }
  // Belt and braces: these substrings must never appear in a URL we visit.
  if (/hide|delete|print|remove|save|submit/i.test(url)) {
    throw new Error(`REFUSED navigation to state-changing URL: ${url}`)
  }
  return url
}

async function go(page, url) {
  await page.goto(assertAllowed(url), { waitUntil: 'domcontentloaded' })
}

// ── DB access: psql over SSH, the wrapper every script in this repo uses ─────
const ENVS = {
  dev: { container: 'kscw-postgres', database: 'directus_kscw_dev', user: 'supabase_admin' },
  prod: { container: 'kscw-postgres', database: 'postgres', user: 'supabase_admin' },
}

function psql(env, sqlText, extraArgs = []) {
  const cmd = ['ssh', 'hetzner', 'sudo', 'docker', 'exec', '-i', env.container,
    'psql', '-U', env.user, '-d', env.database, '-X', '-v', 'ON_ERROR_STOP=1', ...extraArgs]
  const r = spawnSync(cmd[0], cmd.slice(1), { input: sqlText, encoding: 'utf-8' })
  if (r.status !== 0) throw new Error(`psql failed:\n${r.stderr || r.stdout}`)
  return r.stdout
}

const query = (env, sql) => psql(env, sql, ['-t', '-A', '-F', '\t']).trim()
export const lit = (v) => (v === null || v === undefined || v === '' ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)
const num = (v) => (v === null || v === undefined || v === '' ? 'NULL' : String(Number(v)))

/** Normalised name key — matches the `lower(btrim(name))` unique index on the table. */
export const nameKey = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')

/**
 * Pick the club's scheduling functionary out of a «Klub Funktionäre» table.
 *
 * Pure + exported so it is testable without a browser: hand it the rows a page
 * evaluate() produced ([{ role, name, personId, emails }]) and it returns the
 * one to store. Role matching is by REGEX on the label, never by column index —
 * Basketplan reorders columns between releases and its labels are
 * locale-dependent (the people scraper hit "Ufficiale" in a session that
 * rendered everything else in German).
 */
export function pickSchedulingContact(rows) {
  const list = Array.isArray(rows) ? rows.filter((r) => r && (r.emails || []).length) : []
  if (!list.length) return null
  // Preference order, most specific first. 'Spielplan' is what ProBasket names.
  const patterns = [/spielplan/i, /calendrier|calendario/i, /sekretariat|secr[ée]tariat/i, /pr[äa]sident|president/i]
  for (const re of patterns) {
    const hit = list.find((r) => re.test(String(r.role || '')))
    if (hit) return hit
  }
  return null // never fall back to "the first functionary" — that mails the wrong person
}

/** Harvest clubId + name from the club list page. Nothing is clicked. */
async function harvestClubList(page) {
  await go(page, CLUB_LIST_URL)
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll('a[href*="findClubById.do"]')].map((a) => {
      const id = (a.getAttribute('href') || '').match(/clubId=(\d+)/)?.[1]
      const name = (a.textContent || '').replace(/\s+/g, ' ').trim()
      return id && name ? { clubId: Number(id), name } : null
    }).filter(Boolean))
  const byId = new Map()
  for (const r of rows) if (!byId.has(r.clubId)) byId.set(r.clubId, r)
  return [...byId.values()]
}

/**
 * Read one club page's «Klub Funktionäre» block.
 * ⚠ UNVERIFIED SELECTORS — the row shape below is what the people scraper's
 * idiom implies, not what I have seen. Pin on the first --dry-run.
 */
async function scrapeClubContact(page, clubId) {
  await go(page, `${BASE}/findClubById.do?clubId=${clubId}`)
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll('tr')].map((tr) => {
      const cells = [...tr.querySelectorAll('td')].map((td) => (td.textContent || '').replace(/\s+/g, ' ').trim())
      if (!cells.length) return null
      const emails = [...tr.querySelectorAll('a[href^="mailto:"]')]
        .map((a) => decodeURIComponent((a.getAttribute('href') || '').replace(/^mailto:/i, '').split('?')[0]).trim())
        .filter(Boolean)
      const personLink = tr.querySelector('a[href*="findPersonById.do"]')
      const personId = (personLink?.getAttribute('href') || '').match(/personId=(\d+)/)?.[1] || null
      // The role label is whichever cell is NOT the name and NOT an address.
      const name = (personLink?.textContent || '').replace(/\s+/g, ' ').trim()
        || cells.find((c) => /,/.test(c) && !/@/.test(c)) || ''
      const role = cells.find((c) => c && c !== name && !/@/.test(c)) || ''
      const phone = cells.find((c) => /^[+0][\d\s/.()-]{6,}$/.test(c)) || null
      return { role, name, personId: personId ? Number(personId) : null, emails, phone }
    }).filter(Boolean))
  return { rows, picked: pickSchedulingContact(rows) }
}

function buildApplySql(matches) {
  // FILL/REFRESH only on the contact block, and only when the scrape actually
  // found something: a club whose Basketplan entry is empty must keep whatever a
  // KSCW planner typed in by hand (contact_source='manual'), never be blanked.
  const stmts = matches.map((m) => `
UPDATE public.basketplan_clubs SET
  bp_club_id              = COALESCE(bp_club_id, ${num(m.clubId)}),
  contact_name            = ${lit(m.name)},
  contact_email           = ${lit(m.emails[0] || null)},
  contact_email_secondary = ${lit(m.emails[1] || null)},
  contact_phone           = COALESCE(${lit(m.phone)}, contact_phone),
  contact_role_label      = ${lit(m.role)},
  bp_person_id            = COALESCE(${num(m.personId)}, bp_person_id),
  contact_source          = 'basketplan',
  contact_verified_at     = now(),
  last_synced_at          = now(),
  date_updated            = now()
WHERE lower(btrim(name)) = ${lit(nameKey(m.dbName))}
  AND ${lit(m.emails[0] || null)} IS NOT NULL;`)
  return `BEGIN;\n${stmts.join('\n')}\nCOMMIT;\n`
}

async function main() {
  const [envName, ...flags] = process.argv.slice(2)
  if (!ENVS[envName]) {
    console.error('Usage: basketplan-scrape-clubs.mjs <dev|prod> [--dry-run|--apply|--report] [--limit N]')
    process.exit(1)
  }
  const env = ENVS[envName]
  const apply = flags.includes('--apply')
  const report = flags.includes('--report')
  const limit = Number((flags.find((f) => f.startsWith('--limit')) || '').split(/[= ]/)[1] || 0)
    || Number(flags[flags.indexOf('--limit') + 1]) || 0

  // Registry as it stands. Also the whole of --report.
  const rows = query(env, `SELECT id, name, bp_club_id, contact_source, coalesce(contact_email,'')
                             FROM public.basketplan_clubs
                            WHERE active AND NOT is_own_club
                            ORDER BY name;`)
    .split('\n').filter(Boolean)
    .map((l) => { const [id, name, bpId, src, email] = l.split('\t'); return { id: Number(id), name, bpId: bpId || null, src, email } })

  const missing = rows.filter((r) => !r.email)
  console.log(`[bb-clubs] registry: ${rows.length} opponent clubs, ${rows.length - missing.length} with a contact, ${missing.length} without.`)
  if (report) {
    for (const r of missing) console.log(`  – ${r.name}${r.bpId ? ` (bp ${r.bpId})` : ''}`)
    console.log('\nNo login performed. Fill these via the Basketball settings page, or run --dry-run.')
    return
  }

  if (!process.env.BP_USER || !process.env.BP_PASS) {
    console.error('BP_USER / BP_PASS are required (rbw get "Basketplan - KSC Wiedikon" --folder services/basketplan).')
    process.exit(1)
  }
  if (envName === 'dev') {
    console.warn('⚠ dev is a scrubbed clone — contact columns are NULLed nightly, so a dev run proves nothing. Use prod.')
  }

  // Playwright is imported lazily so --report works without it installed.
  const { chromium } = await import('playwright')
  const browser = await chromium.launch()
  const page = await browser.newPage()
  try {
    await go(page, `${BASE}/showLogin.do`)
    await page.fill('input[name="j_username"]', process.env.BP_USER)
    await page.fill('input[name="p_password"]', process.env.BP_PASS)
    await Promise.all([page.waitForLoadState('networkidle'), page.click('input[type="image"]')])
    const body = await page.evaluate(() => document.body.innerText)
    if (!/Angemeldet als|Connecté|KSC WIEDIKON/i.test(body)) {
      throw new Error('login failed — no authenticated marker on the landing page')
    }

    const listed = await harvestClubList(page)
    console.log(`[bb-clubs] club list: ${listed.length} entries at ${CLUB_LIST_URL}`)
    if (!listed.length) {
      console.error('⚠ No findClubById.do links found. The club-list URL is a GUESS — open it in a browser,')
      console.error('  find the real list page, and pin it in CLUB_LIST_URL with a dated comment.')
      console.error(`  page title was: ${await page.title()}`)
      return
    }

    // Match Basketplan's club names onto our registry. Exact normalised name
    // only — a fuzzy match here mails a stranger. Unmatched names are printed.
    const byKey = new Map(rows.map((r) => [nameKey(r.name), r]))
    const matches = []; const unmatched = []
    for (const c of listed) {
      const hit = byKey.get(nameKey(c.name))
      if (hit) matches.push({ ...c, dbName: hit.name }); else unmatched.push(c.name)
    }
    console.log(`[bb-clubs] matched ${matches.length}/${listed.length} by exact name; ${unmatched.length} Basketplan clubs are not opponents of ours.`)

    const targets = (limit ? matches.slice(0, limit) : matches)
    const resolved = []
    for (const t of targets) {
      const { rows: funcRows, picked } = await scrapeClubContact(page, t.clubId)
      if (!picked) {
        console.log(`  ✗ ${t.dbName} (bp ${t.clubId}) — no «Spielplan» functionary with an email (${funcRows.length} rows seen)`)
        continue
      }
      resolved.push({ ...t, ...picked })
      console.log(`  ✓ ${t.dbName} (bp ${t.clubId}) — ${picked.role || '?'} · ${picked.name || '?'} · ${picked.emails.join(', ')}`)
    }

    if (!apply) {
      console.log(`\n[bb-clubs] DRY RUN — nothing written. ${resolved.length} contacts resolved.`)
      return
    }
    if (!resolved.length) { console.log('[bb-clubs] nothing to write.'); return }
    psql(env, buildApplySql(resolved))
    console.log(`[bb-clubs] ✓ wrote ${resolved.length} contacts to basketplan_clubs (${envName}).`)
  } finally {
    await browser.close()
  }
}

// Only run when invoked directly, so the pure helpers stay importable in tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(`[bb-clubs] ✗ ${err.message}`); process.exit(1) })
}
