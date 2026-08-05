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
// PINNED 2026-08-05 against the live site (logged in as KSC Wiedikon / club 166).
// `showClubs.do` was the original guess and yields ZERO findClubById links; the
// real federation-wide list is the "Clubs des Verbandes" nav entry below, which
// returns 80 clubs as <a href="/findClubById.do?clubId=N">Name</a>.
// ("Klub Suchen" = /showSearchClub.do is a search FORM — a dead end for a crawler
// that is forbidden from submitting forms.)
const CLUB_LIST_URL = `${BASE}/showClubLogosForFederation.do`
const ALLOWED = [
  /^https:\/\/www\.basketplan\.ch\/showLogin\.do$/,
  /^https:\/\/www\.basketplan\.ch\/showClubLogosForFederation\.do$/,
  /^https:\/\/www\.basketplan\.ch\/findClubById\.do\?clubId=\d+$/,
  // Read-only person record. The club page carries NO mailto and no address —
  // the functionary's email only exists here. See scrapePersonContact().
  /^https:\/\/www\.basketplan\.ch\/findPersonById\.do\?personId=\d+$/,
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

/**
 * Rows out of psql, tab-separated, one per line.
 *
 * ⚠ The separator is built INSIDE the SQL (`|| E'\t' ||`), never passed as
 * `-F '\t'`. `psql()` shells out via `spawnSync('ssh', [...])`, and ssh does not
 * pass argv through — it JOINS the arguments with spaces and hands the result to
 * a remote shell, which then word-splits it. A bare tab argument is whitespace to
 * that shell, so it vanishes and psql dies with
 * `option requires an argument -- 'F'`. The SQL text goes over stdin, where no
 * shell can touch it, so an escape sequence there is safe.
 * (Fixed 2026-08-05 — the original `['-t','-A','-F','\t']` had never run.)
 */
const query = (env, sql) => psql(env, sql, ['-t', '-A']).trim()
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
 * Read the person record behind a functionary link.
 *
 * PINNED 2026-08-05 against personId 9049 (Gönültas Ekrem, the Spielplan contact
 * of club 350 / BBZU). ⚠ This page renders as a LABEL/VALUE TEXT TABLE, not as a
 * form — an `input[value]` sweep returns nothing, which is exactly how the first
 * probe concluded "no data" on a page that has plenty. Read cell text, in pairs.
 *
 * Observed labels (German UI): "E-mail privat", "E-mail geschäftlich",
 * "Telefon zu Hause", "Telefon geschäftlich", "Handy", "Lizenznummer".
 * ⚠ Labels are LOCALE-DEPENDENT on this site (the licence list renders
 * `Offizielle/r` vs `Ufficiale` depending on session language) — match loosely on
 * `e-?mail` + a `privat|gesch` qualifier rather than on the exact German string.
 */
async function scrapePersonContact(page, personId) {
  await go(page, `${BASE}/findPersonById.do?personId=${personId}`)
  return page.evaluate(() => {
    // ⚠ The table is NESTED: an outer <tr> wraps the whole "Generelle
    // Informationen" block, so its first cell is a paragraph that CONTAINS the
    // string "E-mail privat" and its second cell is the same paragraph again.
    // A naive `pairs.find(key matches /e-mail.*privat/)` therefore hits that
    // outer row first and returns the blob, which fails validation and silently
    // falls back to the club inbox — the whole first dry-run mailed
    // `president@aaraubasket.ch` instead of the scheduler's own address.
    // A real label is short, so require that. (Fixed 2026-08-05.)
    const LABEL_MAX = 40
    const pairs = []
    for (const tr of document.querySelectorAll('tr')) {
      const cells = [...tr.querySelectorAll('td')].map((td) => (td.textContent || '').replace(/\s+/g, ' ').trim())
      if (cells.length >= 2 && cells[0] && cells[0].length <= LABEL_MAX) pairs.push([cells[0], cells[1]])
    }
    const find = (re) => pairs.find(([k]) => re.test(k))?.[1]?.trim() || null
    return {
      privat: find(/e-?mail.*privat/i),
      business: find(/e-?mail.*(gesch|business|prof)/i),
      phone: find(/handy|mobile|natel/i) || find(/telefon.*(gesch|zu hause)/i) || null,
    }
  })
}

/**
 * Read one club page's functionary block, then follow the chosen person.
 *
 * PINNED 2026-08-05 against club 350. Shape actually observed:
 *   <tr><td>Spielplan</td><td><a href="/findPersonById.do?personId=9049">Gönültas Ekrem</a></td></tr>
 * ⚠ There is NO mailto anywhere on the club page and no email column — the
 * original stub looked for both and would have found nothing on every club. The
 * functionary's address lives ONLY on the person page.
 * ⚠ The club's own "Email geschäftlich" (input[name=email], e.g. info@bbzu.ch) is
 * a CLUB inbox, not the Spielplan person. It is kept as the SECONDARY address so
 * a mail still reaches the club when the person's own address is blank — never as
 * the primary, or we would mail the general inbox and call it the scheduler.
 */
async function scrapeClubContact(page, clubId) {
  await go(page, `${BASE}/findClubById.do?clubId=${clubId}`)
  const { rows, clubEmail } = await page.evaluate(() => {
    const out = []
    for (const tr of document.querySelectorAll('tr')) {
      const tds = [...tr.querySelectorAll('td')]
      if (tds.length < 2 || tds.length > 6) continue
      const cells = tds.map((td) => (td.textContent || '').replace(/\s+/g, ' ').trim())
      const personLink = tr.querySelector('a[href*="findPersonById.do"]')
      if (!personLink) continue
      const personId = (personLink.getAttribute('href') || '').match(/personId=(\d+)/)?.[1] || null
      const name = (personLink.textContent || '').replace(/\s+/g, ' ').trim()
      // Role is the first cell; the name cell is the one holding the link.
      const role = cells[0] && cells[0] !== name ? cells[0] : (cells[1] !== name ? cells[1] : '')
      if (!role || !personId) continue
      out.push({ role, name, personId: Number(personId), emails: [], phone: null })
    }
    const ce = document.querySelector('input[name="email"]')?.value?.trim() || null
    return { rows: out, clubEmail: ce && /@/.test(ce) ? ce : null }
  })

  // pickSchedulingContact requires an email to consider a row, but on this site
  // emails only exist one navigation deeper. Choose on ROLE first, then resolve.
  const byRole = pickSchedulingContact(rows.map((r) => ({ ...r, emails: ['pending'] })))
  const chosen = byRole ? rows.find((r) => r.personId === byRole.personId && r.role === byRole.role) : null
  let picked = null
  if (chosen) {
    const p = await scrapePersonContact(page, chosen.personId)
    // ⚠ A single Basketplan email FIELD routinely holds SEVERAL addresses, and
    // the separator is inconsistent — observed live: "a@x.ch;b@y.ch",
    // "a@x.ch ; b@y.ch; c@z.ch", "a@x.ch, b@y.ch". Storing that verbatim puts a
    // semicolon-joined string in a To: header, which most MTAs reject outright.
    // Split, validate each, and keep the order the club wrote them in.
    const splitEmails = (raw) =>
      String(raw || '')
        .split(/[;,]+|\s+/)
        .map((s) => s.trim().replace(/^[<(]|[>)]$/g, ''))
        .filter((s) => /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(s))
    // Priority: the scheduler's own addresses first (privat, then business), the
    // club inbox only as a last resort — mailing info@ and calling it the
    // Spielplan contact is exactly the mistake this whole scrape exists to avoid.
    const emails = [...new Set([
      ...splitEmails(p.privat),
      ...splitEmails(p.business),
      ...splitEmails(clubEmail),
    ])]
    picked = { ...chosen, emails, phone: p.phone, fromClubInbox: emails.length > 0 && !splitEmails(p.privat).length && !splitEmails(p.business).length }
  }
  return { rows, picked, clubEmail }
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
  const rows = query(env, `SELECT id || E'\\t' || name || E'\\t' || coalesce(bp_club_id::text,'')
                                || E'\\t' || contact_source || E'\\t' || coalesce(contact_email,'')
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

    // Match Basketplan's club names onto our registry. Exact normalised name,
    // or an explicit reviewed alias — NEVER a fuzzy match, which mails a
    // stranger. Unmatched names are printed.
    const byKey = new Map(rows.map((r) => [nameKey(r.name), r]))
    // Alias: our registry name (from the ProBasket Teamanmeldungen "Klub"
    // column) -> Basketplan clubId. The workbook abbreviates where Basketplan
    // spells out, so ~half the registry cannot match on name alone.
    // Every entry below was verified 2026-08-05 by reading that club's TEAM
    // list out of Teamanmeldungen_26-27.xlsx and confirming it is the same club
    // (e.g. Klub "BBZU" owns "BBZU Fever DU16"/"BBZU Heroes H3" -> Basketplan
    // 350 "Basketball Zürich Unterland"). Do NOT extend this by guessing from
    // the name: check the team list.
    const CLUB_ID_ALIASES = {
      'bbc schaan': 126,            // BBC Schaan Woodchucks
      'bbzu': 350,                  // Basketball Zürich Unterland
      'bca': 416,                   // BC Altstetten
      'bc aka': 87,                 // BC Alte Kanti Aarau
      'bc bears wil': 383,          // BC Bears Wil Basketball
      'bc brunnen': 457,            // Basketballclub Brunnen
      'bc fällanden red lions': 482,
      'bcl rivers': 503,            // Basketballclub Landquart Rivers
      'bc marmotas': 504,
      'bc olympiakos': 174,         // BC Olympiakos Zürich
      'bc rj lakers': 84,           // BC Rapperswil-Jona Lakers
      'bc sarnen': 128,
      'bc silvercoast': 502,
      'bc uster': 458,
      'bc winterthur': 69,
      'bc zürich 93': 481,
      'biq': 433,                   // Basketball im Quartier
      'bsco': 404,                  // BSC Obfelden
      'bs kriens': 277,             // Basketballschule Kriens
      'bzo': 417,                   // Basketball Züri Oberland
      'cvjm frauenfeld': 57,        // CVJM Basketball Frauenfeld
      'gc zürich basketball': 54,   // Grasshopper Club Zürich Basketball Sektion
      'grbb': 125,                  // Graubünden Basketball (GRBB Chur)
      'griffins basketball': 395,   // Mörschwil Griffins Basketball
      'ktv schaffhausen': 117,
      'megas alexandros': 181,      // SVA Megas Alexandros
      'oberthurgau pirates': 382,   // Basketball Oberthurgau
      'scb': 308,                   // Swiss Central Basketball
      'seeblick bears cham': 432,   // Ballsport Seeblick
      'stingerz': 405,              // Stingerz Zürich
      'tvrb': 42,                   // TV Reussbühl Basket
      'unicorn 02 basket': 179,     // Unicorn 02 Basket Spreitenbach
      'wallabies': 77,              // Goldcoast Wallabies Küsnacht-Erlenbach
      'weinland bc': 498,           // Weinland Basketball Club
      // ⚠ NOT MAPPABLE from this page: "BC Arlesheim" (plays D1LRA against our
      // Lions but is a BASEL-region club, so it is absent from ProBasket's
      // federation list). Enter its contact by hand in the settings page.
    }
    const byClubId = new Map(listed.map((c) => [c.clubId, c]))
    const matches = []; const unmatched = []
    const claimed = new Set()
    for (const c of listed) {
      const hit = byKey.get(nameKey(c.name))
      if (hit) { matches.push({ ...c, dbName: hit.name }); claimed.add(nameKey(hit.name)) }
      else unmatched.push(c.name)
    }
    // Second pass: registry rows still unmatched, resolved through the alias map.
    let aliased = 0
    for (const r of rows) {
      const k = nameKey(r.name)
      if (claimed.has(k)) continue
      const id = CLUB_ID_ALIASES[k]
      const c = id ? byClubId.get(id) : null
      if (!c) continue
      matches.push({ ...c, dbName: r.name }); claimed.add(k); aliased++
      console.log(`  · alias: "${r.name}" → Basketplan ${c.clubId} "${c.name}"`)
    }
    const stillMissing = rows.filter((r) => !claimed.has(nameKey(r.name))).map((r) => r.name)
    console.log(`[bb-clubs] matched ${matches.length} clubs (${matches.length - aliased} by exact name, ${aliased} by alias). ${stillMissing.length} of our ${rows.length} opponents have no Basketplan entry: ${stillMissing.join(', ') || '—'}`)

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
