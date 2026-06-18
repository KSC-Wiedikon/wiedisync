#!/usr/bin/env node
/**
 * clubdesk-scrape-finance.mjs — Headless-browser automation of the ClubDesk
 * Finanz CSV exports (Rechnungen + Buchhaltung).
 *
 * Sibling of clubdesk-scrape-export.mjs (the member/Kontakte scraper). Same
 * approach: ClubDesk has NO public API, so we drive the web UI and trigger the
 * same "Alle Spalten" CSV export a human would, capturing the
 * GET /clubdesk/reportstore?reportId=… download. Reuses the proven login +
 * export-dialog logic verbatim; adds Finanzen navigation.
 *
 * Usage:
 *   CLUBDESK_USER=… CLUBDESK_PASS=… \
 *     node directus/scripts/clubdesk-scrape-finance.mjs [invoices-out.csv] [bookings-out.csv]
 *
 *   Defaults: <tmpdir>/clubdesk-rechnungen.csv, <tmpdir>/clubdesk-buchhaltung.csv
 *   Both files are CP1252 / ';'-CSV — exactly what import-clubdesk-finance.mjs consumes.
 *
 * ⚠ ONE active session per ClubDesk account — this boots any human signed in on
 *   the SAME account. Use a DEDICATED service account for unattended runs.
 *
 * ⚠ CALIBRATION: the Finanzen navigation (openFinanceTable) is anchored on
 *   visible German text ('Finanzen', 'Rechnungen', 'Buchhaltung'), not on
 *   build-hashed GXT classes. The toolbar/app entry point may need one live
 *   calibration pass (like the member scraper's geometry constants were). Every
 *   step asserts loudly — a miscalibrated run FAILS rather than exporting the
 *   wrong table. App internals: ClubDesk GXT/ExtGWT, tenant m_15650, export via
 *   GET /clubdesk/reportstore?reportId=<uuid>.
 */

import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const USER = process.env.CLUBDESK_USER
const PASS = process.env.CLUBDESK_PASS
const OUT_INVOICES = process.argv[2] || join(tmpdir(), 'clubdesk-rechnungen.csv')
const OUT_BOOKINGS = process.argv[3] || join(tmpdir(), 'clubdesk-buchhaltung.csv')
const START = 'https://app.clubdesk.com/clubdesk/start'

if (!USER || !PASS) {
  console.error('Missing credentials. Set CLUBDESK_USER and CLUBDESK_PASS in the environment.')
  process.exit(1)
}

const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Rect (viewport coords) of the first zero-child element whose trimmed text equals `text`. */
const leafRect = (page, text) =>
  page.evaluate((t) => {
    const el = [...document.querySelectorAll('*')]
      .find((e) => e.childElementCount === 0 && (e.innerText || '').trim() === t)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, right: r.right, bottom: r.bottom }
  }, text)

/** Open the Export dialog → "Alle Spalten" → OK, and return the captured download. */
async function exportAllColumns(page, label) {
  log(`[${label}] Opening Export dialog…`)
  await page.getByText('Export', { exact: true }).first().click()
  await page.getByText('Tabelle exportieren', { exact: true }).waitFor({ timeout: 20000 })
  await page.waitForTimeout(800)

  // Open the "Spalten" combo (caret right of the "Spalten:" label) → "Alle Spalten".
  const sp = await leafRect(page, 'Spalten:')
  if (!sp) throw new Error(`[${label}] Export dialog opened but "Spalten:" row not found.`)
  await page.mouse.click(sp.right + 120, sp.y)
  await page.waitForTimeout(800)
  const alle = page.getByText('Alle Spalten', { exact: true }).first()
  if (!(await alle.count())) throw new Error(`[${label}] "Alle Spalten" option not found.`)
  await alle.click()
  await page.waitForTimeout(500)

  const ok = await leafRect(page, 'OK')
  if (!ok) throw new Error(`[${label}] OK button not found in export dialog.`)
  log(`[${label}] Exporting…`)
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60000 }),
    page.mouse.click(ok.x, ok.y),
  ])
  return download
}

/**
 * Navigate to a Finanzen sub-table ('Rechnungen' | 'Buchhaltung') and wait for
 * its grid. CALIBRATION POINT — anchors on visible text; adjust here if a live
 * run can't find the Finanzen entry point or a sub-tab.
 */
async function openFinanceTable(page, which) {
  log(`Navigating to Finanzen → ${which}…`)
  // 1. Enter the Finanzen module (top-level app). Try the visible label first.
  const finanzen = page.getByText('Finanzen', { exact: true }).first()
  if (await finanzen.count()) {
    await finanzen.click()
  } else {
    // Fallback: the apps toolbar is icon-only (the HAR showed a `bank-line` icon
    // for Finanzen). Click the toolbar button bearing the bank glyph.
    const bank = await page.evaluate(() => {
      const img = [...document.querySelectorAll('img,svg,[style*="bank"]')]
        .find((e) => /bank/i.test(e.getAttribute('src') || e.getAttribute('href') || e.outerHTML.slice(0, 200)))
      if (!img) return null
      const r = img.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })
    if (!bank) throw new Error('Could not locate the Finanzen entry point (no "Finanzen" text, no bank icon).')
    await page.mouse.click(bank.x, bank.y)
  }
  await page.waitForTimeout(2000)

  // 2. Open the sub-tab (Rechnungen / Buchhaltung).
  const tab = page.getByText(which, { exact: true }).first()
  await tab.waitFor({ timeout: 20000 })
  await tab.click()
  // 3. Assert the grid loaded — ClubDesk lists show a "(N Einträge)" count header.
  await page.getByText(/\(\d+\s*Eintr/).first().waitFor({ timeout: 20000 })
  await page.waitForTimeout(1500)
  log(`Finanzen → ${which} open.`)
}

/** Sanity-check a downloaded CSV has the expected header columns. */
function assertCsv(path, label, mustHave) {
  const header = new TextDecoder('windows-1252').decode(readFileSync(path)).split(/\r?\n/)[0] || ''
  for (const col of mustHave) {
    if (!header.includes(col)) {
      throw new Error(`[${label}] Export looks wrong — header missing "${col}". Got: ${header.slice(0, 160)}…`)
    }
  }
  const cols = header.split(';').length
  log(`[${label}] ✓ ${path} — ${cols} columns.`)
}

async function run() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  try {
    const ctx = await browser.newContext({
      locale: 'de-CH', timezoneId: 'Europe/Zurich',
      viewport: { width: 1500, height: 950 }, acceptDownloads: true,
    })
    const page = await ctx.newPage()
    page.setDefaultTimeout(45000)

    // ── Login (identical to clubdesk-scrape-export.mjs) ───────────────
    log('Opening ClubDesk login…')
    await page.goto(START, { waitUntil: 'networkidle' })
    await page.fill('#userId', USER)
    await page.fill('#password', PASS)
    await Promise.all([
      page.waitForLoadState('networkidle').catch(() => {}),
      page.click('#submit'),
    ])
    await page.waitForTimeout(3000)
    if (await page.locator('#password').count()) {
      throw new Error('Still on the login form after submit — wrong credentials, or login blocked (2FA/CAPTCHA?).')
    }
    log('Logged in.')

    // ── Rechnungen → export ───────────────────────────────────────────
    await openFinanceTable(page, 'Rechnungen')
    const invDl = await exportAllColumns(page, 'Rechnungen')
    await invDl.saveAs(OUT_INVOICES)
    log(`Downloaded Rechnungen via ${invDl.url()}`)
    assertCsv(OUT_INVOICES, 'Rechnungen', ['[Id]', 'Betrag', 'Rechnungsdatum'])

    // ── Buchhaltung → export ──────────────────────────────────────────
    await openFinanceTable(page, 'Buchhaltung')
    const bkDl = await exportAllColumns(page, 'Buchhaltung')
    await bkDl.saveAs(OUT_BOOKINGS)
    log(`Downloaded Buchhaltung via ${bkDl.url()}`)
    assertCsv(OUT_BOOKINGS, 'Buchhaltung', ['Soll (Nummer)', 'Haben (Nummer)', 'Betrag (CHF)'])

    log(`✓ Done. Invoices → ${OUT_INVOICES}, Bookings → ${OUT_BOOKINGS}`)
    // Last two lines = the paths, for shell chaining.
    console.log(OUT_INVOICES)
    console.log(OUT_BOOKINGS)
  } finally {
    await browser.close()
  }
}

run().catch((e) => {
  console.error('✗', e.message || String(e))
  process.exit(1)
})
