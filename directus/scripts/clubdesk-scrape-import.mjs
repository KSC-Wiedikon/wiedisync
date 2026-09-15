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
import { launchBrowser } from './clubdesk-browser.mjs'
import { pickExact } from './clubdesk-dom.mjs'

const USER = process.env.CLUBDESK_USER
const PASS = process.env.CLUBDESK_PASS
const CSV = process.argv[2]
const MODE = process.argv[3] || 'preview'
const SHOTS = process.env.CLUBDESK_IMPORT_SHOTS || '' // optional dir for debug screenshots
const START = 'https://app.clubdesk.com/clubdesk/start'

// Log stamp: Swiss date AND time, in Europe/Zurich. It used to be
// `toISOString().slice(11,19)` — a bare UTC clock, so a line read `[15:05:03]`
// while the operator's screen said 17:05 and nothing said which DAY, on a log the
// admin page now shows in full (08.09.2026). de-CH + hour12:false is the app-wide
// rule; the comma de-CH puts between date and time is dropped so the stamp is one
// token.
const stamp = () => new Intl.DateTimeFormat('de-CH', {
  timeZone: 'Europe/Zurich', day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
}).format(new Date()).replace(', ', ' ')
const log = (...a) => console.error(`[${stamp()}]`, ...a) // logs → stderr; result → stdout
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

if (!USER || !PASS) { log('Missing CLUBDESK_USER/PASS'); process.exit(1) }
if (!CSV) { log('Usage: clubdesk-scrape-import.mjs <csv> <preview|commit>'); process.exit(1) }
if (!['preview', 'commit'].includes(MODE)) { log(`Bad mode "${MODE}" (preview|commit)`); process.exit(1) }

const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/import-${name}.png` }).catch(() => {}) }

// Everything ClubDesk has on screen as a popup right now — the import dialog,
// a result dialog, an ERROR dialog — as text, outermost popups only. GWT
// renders every dialog as an absolutely-positioned panel, so "sizeable
// absolute/fixed box that is not inside another one" is the dialog set without
// knowing ClubDesk's class names. Used after the commit click (see run()):
// until 15.09.2026 nothing looked at the screen after "Ja", so an import that
// ClubDesk refused at the write step reported `committed:true` all the same.
const readPopups = (page) => page.evaluate(() => {
  const boxes = []
  for (const e of document.querySelectorAll('div')) {
    const cs = getComputedStyle(e)
    if (cs.position !== 'absolute' && cs.position !== 'fixed') continue
    if (cs.visibility === 'hidden' || cs.display === 'none') continue
    const r = e.getBoundingClientRect()
    if (r.width < 250 || r.height < 60 || r.width > 1300) continue
    boxes.push(e)
  }
  const outer = boxes.filter((e) => !boxes.some((o) => o !== e && o.contains(e)))
  return [...new Set(outer.map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean))]
    .map((t) => t.slice(0, 500))
})
// The "(N Einträge)" count of the contact grid — the default view the Kontakte
// tab opens on. Read before the import and after the commit: a create set that
// commits must grow it by `neu`.
const readGridCount = (page) => page.evaluate(() => {
  for (const e of document.querySelectorAll('*')) {
    let t = ''; for (const n of e.childNodes) if (n.nodeType === 3) t += n.textContent
    const m = t.match(/\((\d+)\s*Eintr/)
    if (m) return Number(m[1])
  }
  return null
})

// Click the element whose OWN text === exact; lowest-on-screen wins (dialog
// buttons sit low). The rule itself — incl. the hit test that keeps a click
// off a cell hidden behind the modal, the 15.09.2026 "Ja" that never took —
// lives in clubdesk-dom.mjs (pickExact) so it is testable against a real DOM.
const clickExact = async (page, exact, lowest = true) => {
  const pos = await page.evaluate(pickExact, { exact, lowest })
  if (!pos) return false
  await page.mouse.click(pos.x, pos.y); return true
}

// Is the wizard's confirmation ("Wollen Sie diese Änderungen übernehmen?")
// still on screen? After a "Ja" that took, ClubDesk closes it (and may show a
// result dialog); a "Ja" that did NOT take leaves it exactly as it was.
const confirmDialogOpen = async (page) => (await readPopups(page)).some((t) => /übernehmen\?/i.test(t))

// Read the pre-commit summary counts. SCOPED to the summary dialog subtree (the
// modal asking "…übernehmen?") so a stray number from the background contact
// table or the mapping dialog can never leak into the counts. The old page-wide
// x-band heuristic (x 850–1200) worked for the standard field set but broke when
// a CUSTOM field (Benutzer-Id / Wiedisync ID) shifted the layout — it then read a
// background value (e.g. total=8038) even though the real import was 1 row.
const readSummary = (page) => page.evaluate(() => {
  const ownText = (e) => { let t = ''; for (const n of e.childNodes) if (n.nodeType === 3) t += n.textContent; return t.trim() }
  // Find the summary dialog = nearest sizeable ancestor of the "…übernehmen?" line.
  let dialog = null
  for (const e of document.querySelectorAll('*')) {
    if (/übernehmen\?/i.test(ownText(e))) {
      let p = e
      for (let i = 0; i < 8 && p.parentElement; i++) {
        p = p.parentElement
        const r = p.getBoundingClientRect()
        if (r.width > 300 && r.width < 1100 && r.height > 120) { dialog = p; break }
      }
      break
    }
  }
  if (!dialog) return { total: null, neu: null, veraendert: null, unveraendert: null, hasSummary: false }
  const leaves = []
  for (const e of dialog.querySelectorAll('*')) {
    const t = ownText(e); if (!t) continue
    const r = e.getBoundingClientRect(); if (r.width === 0 || r.height === 0) continue
    leaves.push({ t, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) })
  }
  const countFor = (re) => {
    const lbl = leaves.find((o) => re.test(o.t))
    if (!lbl) return null
    // the count is the number in the same row, to the right of the label — no
    // x-band needed now that we only look inside the dialog.
    const nums = leaves.filter((o) => Math.abs(o.y - lbl.y) < 10 && /^\d+$/.test(o.t) && o.x > lbl.x)
    return nums.length ? parseInt(nums.sort((a, b) => a.x - b.x)[0].t, 10) : null
  }
  return {
    total: countFor(/Insgesamt eingelesene/i),
    neu: countFor(/Neue Kontakte/i),
    // ⚠ The (?<!Un) guard is load-bearing: ClubDesk OMITS a line when its count
    // is zero, and "Unveränderte Kontakte (entsprechen dem aktuellen Stand in
    // ClubDesk)" CONTAINS "veränderte Kontakte". Without the lookbehind, an
    // import that changes nothing has no "Veränderte" line to find, matches the
    // "Unveränderte" one instead, and reports every unchanged row as changed —
    // observed 2026-07-27 on the Gast backfill verification run, which printed
    // veraendert=707 off a dialog whose only lines were "Insgesamt: 707" and
    // "Unveränderte: 707". Harmless to the up-dispatcher's gate (scrape_ok only
    // needs a numeric total + no error), but the sync-up modal renders this
    // number at an admin as "changed contacts".
    veraendert: countFor(/(?<!Un)(Veränderte|Geänderte) Kontakte/i),
    unveraendert: countFor(/Unveränderte Kontakte/i),
    hasSummary: true,
  }
})

async function run() {
  const browser = await launchBrowser()
  let result = { mode: MODE, total: null, neu: null, veraendert: null, unveraendert: null, committed: false }
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
    result.count_before = await readGridCount(page)
    log(`Kontakte open (${result.count_before ?? '?'} Einträge). Opening Import…`)

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
    result.total = s.total; result.neu = s.neu; result.veraendert = s.veraendert; result.unveraendert = s.unveraendert
    log(`Summary: total=${s.total} neu=${s.neu} veraendert=${s.veraendert} unveraendert=${s.unveraendert} hasSummary=${s.hasSummary}`)
    // The wizard's own wording (incl. its "keine Zuordnung definiert" note), so
    // the log says what the operator would have read on screen.
    for (const t of await readPopups(page)) if (/übernehmen\?/i.test(t)) log(`  wizard: ${t}`)
    if (!s.hasSummary) throw new Error('Did not reach the confirmation summary (mapping may have failed).')

    if (MODE === 'commit') {
      if (!(await clickExact(page, 'Ja'))) throw new Error('No "Ja" button to commit.')
      // The write is only a write once the confirmation dialog has GONE. Wait
      // for that (an import of a few hundred rows takes ClubDesk a few seconds)
      // and refuse to call the run committed while the question is still on
      // screen: a click that did not take leaves the wizard untouched, and the
      // grid count / dialog sampling below could not tell that from a refused
      // write. This is not the "false 'nothing happened'" the sampling
      // deliberately does not gate on — a confirmation that is still open is
      // proof that nothing was submitted, so failing here cannot strand a
      // created contact unstamped. It is what turned the 15.09.2026 create set
      // (see clickExact) into `committed:true` with an unchanged screen.
      const deadline = Date.now() + 60000
      let stillOpen = true
      while (Date.now() < deadline) {
        await sleep(1000)
        if (!(await confirmDialogOpen(page))) { stillOpen = false; break }
      }
      if (stillOpen) {
        await shot(page, '3-confirm-still-open')
        throw new Error('Ja did not take — the confirmation dialog is still open after 60 s; nothing was written.')
      }
      // What ClubDesk says AFTER the write, sampled over ~12 s. `committed` is
      // still "we clicked Ja and the wizard accepted it" — it is deliberately
      // NOT gated on what is read here, because a false "nothing happened"
      // would leave the creates unstamped and the next push would duplicate
      // them. It is surfaced in the log and in the JSON result so a refused
      // write is visible instead of silent.
      const seen = []
      for (const [ms, name] of [[500, '3a-after-ja'], [3000, '3b-after-ja'], [7500, '3c-after-ja']]) {
        await sleep(ms)
        await shot(page, name)
        for (const t of await readPopups(page)) if (!seen.includes(t)) seen.push(t)
      }
      result.committed = true
      result.post_commit_dialogs = seen
      log('Committed (clicked Ja).')
      for (const t of seen) log(`  after Ja: ${t}`)
      if (!seen.length) log('  after Ja: (no dialog on screen)')
      await clickExact(page, 'OK').catch(() => {}) // dismiss any result dialog
      await sleep(2500)
      await shot(page, '4-after-ok')
      result.count_after = await readGridCount(page)
      const neu = Number(s.neu) || 0
      const delta = (result.count_before != null && result.count_after != null) ? result.count_after - result.count_before : null
      log(`Grid: ${result.count_before ?? '?'} → ${result.count_after ?? '?'} Einträge${delta != null ? ` (${delta >= 0 ? '+' : ''}${delta})` : ''}`)
      if (neu > 0 && delta != null && delta < neu) {
        result.warning = `create set previewed ${neu} new contact(s) but the grid grew by ${delta} — ClubDesk may have refused the write; check the dialogs above / the screenshots`
        log(`⚠ ${result.warning}`)
      }
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
