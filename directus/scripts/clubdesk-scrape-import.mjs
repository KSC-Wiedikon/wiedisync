#!/usr/bin/env node
/**
 * clubdesk-scrape-import.mjs — Headless-browser automation of the ClubDesk
 * Kontakte CSV IMPORT (the write-side counterpart of clubdesk-scrape-export.mjs).
 *
 * ClubDesk has NO public API, so to PUSH member data we drive the same import
 * wizard a human would: Import → upload CSV → map columns → read the pre-commit
 * summary ("Neue Kontakte" / "Veränderte Kontakte") → commit ("Ja") or cancel.
 *
 * ClubDesk auto-matches existing contacts (by e-mail/name) and UPDATES them, so
 * re-importing a known contact is an update, not a duplicate — proven in the
 * sync-up spike (2026-06-27). We never compute the match ourselves; ClubDesk does,
 * and reports the breakdown before committing.
 *
 * Usage:
 *   CLUBDESK_USER=… CLUBDESK_PASS=… node clubdesk-scrape-import.mjs <csv> <mode>
 *     <csv>   path to a CSV (header row + rows). Semicolon or comma; ClubDesk
 *             auto-maps columns named like its fields (Vorname/Nachname/E-Mail/…).
 *     <mode>  'preview' → upload + read the summary, then CANCEL (no write)
 *             'commit'  → upload + read the summary, then click "Ja" (writes)
 *
 * Output: a single JSON line on stdout (last line) for the caller to parse:
 *   {"mode":"commit","total":12,"neu":3,"veraendert":9,"committed":true}
 *
 * ⚠ ONE ClubDesk session per account — run on the dedicated service account.
 * ⚠ 'commit' writes to the club's legal member record. Gate it behind a human OK.
 */
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const USER = process.env.CLUBDESK_USER
const PASS = process.env.CLUBDESK_PASS
const CSV = process.argv[2]
const MODE = process.argv[3] || 'preview'
const SHOTS = process.env.CLUBDESK_IMPORT_SHOTS || '' // optional dir for debug screenshots
const START = 'https://app.clubdesk.com/clubdesk/start'

const log = (...a) => console.error(`[${new Date().toISOString().slice(11, 19)}]`, ...a) // logs → stderr; result → stdout
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

if (!USER || !PASS) { log('Missing CLUBDESK_USER/PASS'); process.exit(1) }
if (!CSV) { log('Usage: clubdesk-scrape-import.mjs <csv> <preview|commit>'); process.exit(1) }
if (!['preview', 'commit'].includes(MODE)) { log(`Bad mode "${MODE}" (preview|commit)`); process.exit(1) }

const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/import-${name}.png` }).catch(() => {}) }

// Click the element whose OWN text === exact; lowest-on-screen wins (dialog buttons sit low).
const clickExact = async (page, exact, lowest = true) => {
  const pos = await page.evaluate(({ exact, lowest }) => {
    const c = [...document.querySelectorAll('*')].filter((e) => {
      let t = ''; for (const n of e.childNodes) if (n.nodeType === 3) t += n.textContent
      return t.trim() === exact
    }).map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0)
    if (!c.length) return null
    const r = (lowest ? c.sort((a, b) => b.top - a.top) : c.sort((a, b) => a.top - b.top))[0]
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  }, { exact, lowest })
  if (!pos) return false
  await page.mouse.click(pos.x, pos.y); return true
}

// Read the pre-commit summary counts. Each label sits in the modal body; its count
// is the number in the same row within the modal's x-band (avoids the background
// contact table whose PLZ/phone numbers share y but sit far left/right).
const readSummary = (page) => page.evaluate(() => {
  const leaves = []
  for (const e of document.querySelectorAll('*')) {
    let t = ''; for (const n of e.childNodes) if (n.nodeType === 3) t += n.textContent
    t = t.trim(); if (!t) continue
    const r = e.getBoundingClientRect(); if (r.width === 0 || r.height === 0) continue
    leaves.push({ t, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) })
  }
  const countFor = (re) => {
    const lbl = leaves.find((o) => re.test(o.t))
    if (!lbl) return null
    // number in the same row, to the right of the label, inside the modal band (x 850–1200)
    const nums = leaves.filter((o) => Math.abs(o.y - lbl.y) < 8 && /^\d+$/.test(o.t) && o.x > lbl.x && o.x >= 850 && o.x <= 1200)
    return nums.length ? parseInt(nums.sort((a, b) => a.x - b.x)[0].t, 10) : null
  }
  return {
    total: countFor(/Insgesamt eingelesene/i),
    neu: countFor(/Neue Kontakte/i),
    veraendert: countFor(/(Veränderte|Geänderte) Kontakte/i),
    hasSummary: leaves.some((o) => /übernehmen\?/i.test(o.t)),
  }
})

async function run() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  let result = { mode: MODE, total: null, neu: null, veraendert: null, committed: false }
  try {
    const ctx = await browser.newContext({ locale: 'de-CH', timezoneId: 'Europe/Zurich', viewport: { width: 1500, height: 950 }, deviceScaleFactor: 1 })
    const page = await ctx.newPage(); page.setDefaultTimeout(45000)

    log('Login…')
    await page.goto(START, { waitUntil: 'networkidle' })
    await page.fill('#userId', USER); await page.fill('#password', PASS)
    await Promise.all([page.waitForLoadState('networkidle').catch(() => {}), page.click('#submit')])
    await sleep(3000)
    if (await page.locator('#password').count()) throw new Error('Still on login form — bad credentials, or login blocked.')
    log('Logged in.')

    // Kontakte (2nd toolbar icon)
    const navBtn = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('div')].map((e) => ({ e, r: e.getBoundingClientRect() }))
        .filter(({ r }) => r.top > 40 && r.top < 120 && r.left < 320 && r.width > 20 && r.width < 70 && r.height > 20 && r.height < 70)
        .sort((a, b) => a.r.left - b.r.left)
      const b = btns[1]; return b ? { x: b.r.left + b.r.width / 2, y: b.r.top + b.r.height / 2 } : null
    })
    if (!navBtn) throw new Error('Could not locate the Kontakte toolbar button.')
    await page.mouse.click(navBtn.x, navBtn.y)
    await page.getByText(/\(\d+\s*Eintr/).first().waitFor({ timeout: 20000 }); await sleep(1500)
    log('Kontakte open. Opening Import…')

    await page.getByText('Import', { exact: true }).first().click(); await sleep(2500)
    const fileInput = await page.locator('input[type=file]').count()
    if (!fileInput) throw new Error('Import dialog opened but no file input found.')
    await page.setInputFiles('input[type=file]', CSV); await sleep(4500)
    await shot(page, '1-mapping')
    log('Uploaded → mapping step. Advancing to summary…')

    if (!(await clickExact(page, 'OK'))) throw new Error('No OK button on the mapping step.')
    await sleep(3500)
    await shot(page, '2-summary')
    const s = await readSummary(page)
    result.total = s.total; result.neu = s.neu; result.veraendert = s.veraendert
    log(`Summary: total=${s.total} neu=${s.neu} veraendert=${s.veraendert} hasSummary=${s.hasSummary}`)
    if (!s.hasSummary) throw new Error('Did not reach the confirmation summary (mapping may have failed).')

    if (MODE === 'commit') {
      if (!(await clickExact(page, 'Ja'))) throw new Error('No "Ja" button to commit.')
      await sleep(4500)
      await shot(page, '3-committed')
      result.committed = true
      log('Committed (clicked Ja).')
      await clickExact(page, 'OK').catch(() => {}) // dismiss any result dialog
    } else {
      // preview — back out without writing
      if (!(await clickExact(page, 'Nein'))) { for (let i = 0; i < 3; i++) { await page.keyboard.press('Escape'); await sleep(300) } }
      log('Preview only — backed out, nothing committed.')
    }
  } catch (e) {
    log('✗', e.message)
    process.exitCode = 1
    result.error = e.message
  } finally {
    await browser.close()
  }
  process.stdout.write(JSON.stringify(result) + '\n') // last line = machine-readable result
}
run()
