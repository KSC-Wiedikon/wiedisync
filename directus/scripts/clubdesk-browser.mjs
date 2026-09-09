#!/usr/bin/env node
/**
 * clubdesk-browser.mjs — one home for the headless-Chromium launch every ClubDesk
 * automation script shares (scrape-export / -import / -groups / -finance,
 * remove-group, clear-field).
 *
 * Why a wrapper instead of `chromium.launch()` at each call site: chrome-headless-shell
 * intermittently dies with SIGSEGV *during startup* inside the Playwright container —
 * the process is signalled before Playwright ever gets a CDP connection, so the launch
 * rejects with "Target page, context or browser has been closed". It is rare (1 run in
 * ~30 on 09.09.2026) and it is not our state: nothing has been typed into ClubDesk yet,
 * no lock has been handed on, so the only correct response is to start a second browser.
 * Without that, a whole nightly sync — or a sync the admin clicked and is watching —
 * aborts on a crash that fixes itself a second later.
 *
 * ⚠ Retry ONLY the launch. Once a page exists, a crash may have left a half-filled
 *   ClubDesk dialog behind, and re-running blind can write the register twice.
 *
 * Usage:  import { launchBrowser } from './clubdesk-browser.mjs'
 *         const browser = await launchBrowser()
 *
 * Deployed flat to /opt/clubdesk-sync/ by `npm run clubdesk:deploy` (the glob is
 * `clubdesk-*.mjs`, so the name matters) and imported relative to the calling script,
 * which is why every consumer sits in the same directory.
 */
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

// Same three-arg set every ClubDesk script used before this file existed.
// --disable-dev-shm-usage matters: the container's /dev/shm is the 64 MB default.
const LAUNCH_ARGS = ['--no-sandbox', '--disable-dev-shm-usage']
const ATTEMPTS = 3
const BACKOFF_MS = [3000, 8000]

const stamp = () => new Intl.DateTimeFormat('de-CH', {
  timeZone: 'Europe/Zurich', day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
}).format(new Date()).replace(', ', ' ')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Launch headless Chromium, retrying a failed *start-up* up to 3 times.
 * @param {object} [opts] Playwright launch options; merged over the defaults.
 * @returns {Promise<import('playwright').Browser>}
 * @throws the last launch error when every attempt fails.
 */
export async function launchBrowser(opts = {}) {
  let last
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      return await chromium.launch({ headless: true, args: LAUNCH_ARGS, ...opts })
    } catch (err) {
      last = err
      if (attempt === ATTEMPTS) break
      const wait = BACKOFF_MS[attempt - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1]
      const why = String(err?.message ?? err).split('\n')[0]
      // stderr, like every other log line here — stdout is the JSON summary the
      // dispatcher reads with `tail -1`.
      console.error(`[${stamp()}] · Chromium failed to start (attempt ${attempt}/${ATTEMPTS}): ${why} — retrying in ${wait / 1000}s`)
      await sleep(wait)
    }
  }
  throw last
}

export { chromium }
