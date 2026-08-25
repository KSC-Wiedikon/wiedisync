// src/modules/admin/utils/syncFailure.ts
//
// Turns the ClubDesk sync-down's raw failure line into something a club
// superadmin can act on.
//
// Until 2026-08-25 a failed sync wrote the fixed string "Sync failed — see the
// member sync log" — and that log is a file on the VPS, which the person who
// pressed the button cannot read. So the app could not distinguish "ClubDesk is
// down, try later" from "our scraper is broken", which is exactly the difference
// between waiting and calling for help. The dispatcher now stores the scraper's
// actual error line; this classifies it.
//
// ⚠ Patterns are matched against Playwright / Chromium error text, which is
// English regardless of the UI locale — so they are matched case-insensitively
// against the RAW string and never against a translated one.
//
// ⚠ The raw line is always kept and shown alongside the explanation. A classifier
// that swallowed the original would just be a prettier version of the same
// problem it exists to fix.

export type SyncFailureKind =
  | 'clubdesk_unreachable'
  | 'login_failed'
  | 'scraper_broken'
  | 'stale_reset'
  | 'unknown'

/** Chromium/Playwright network failures — the far end, not us. */
const UNREACHABLE = [
  'net::err_timed_out',
  'net::err_connection',
  'net::err_name_not_resolved',
  'net::err_address_unreachable',
  'net::err_internet_disconnected',
  'net::err_ssl',
  'econnrefused',
  'etimedout',
  'enotfound',
]

/**
 * Patterns a substring cannot express. ⚠ Playwright writes the duration BETWEEN
 * the words — `Timeout 30000ms exceeded.` — so 'timeout exceeded' never matches
 * it; a unit test caught exactly that. A bare navigation timeout on the login
 * page is the same story as a net:: error: the page never settled.
 */
const UNREACHABLE_RE = [
  /timeout\s+\d+\s*ms\s+exceeded/i,
  /navigation\s+timeout/i,
]

/** The session was reachable but would not let us in. */
const LOGIN = ['login failed', 'anmeldung', 'invalid credentials', 'benutzername', 'passwort']

/** Our own tooling failed — the browser never got as far as ClubDesk. */
const SCRAPER = [
  'browsertype.launch',
  'executable doesn\'t exist',
  'target page, context or browser has been closed',
  'permission denied',
  'no such file',
  'cannot find module',
]

export function classifySyncFailure(message: string | null | undefined): SyncFailureKind {
  const m = (message || '').toLowerCase()
  if (!m) return 'unknown'
  // Checked FIRST: the dispatcher's own stale-run recovery writes this, and it is
  // not a ClubDesk failure at all — the previous run died and will be retried.
  if (m.includes('stale run')) return 'stale_reset'
  // Scraper before unreachable: a launch failure can also mention a timeout, and
  // "our tooling is broken" is the more actionable of the two readings.
  if (SCRAPER.some((p) => m.includes(p))) return 'scraper_broken'
  if (UNREACHABLE.some((p) => m.includes(p))) return 'clubdesk_unreachable'
  if (UNREACHABLE_RE.some((re) => re.test(m))) return 'clubdesk_unreachable'
  if (LOGIN.some((p) => m.includes(p))) return 'login_failed'
  return 'unknown'
}

/** i18n key carrying the human explanation for each kind. */
export const SYNC_FAILURE_KEY: Record<SyncFailureKind, string> = {
  clubdesk_unreachable: 'clubdeskFailUnreachable',
  login_failed: 'clubdeskFailLogin',
  scraper_broken: 'clubdeskFailScraper',
  stale_reset: 'clubdeskFailStale',
  unknown: 'clubdeskFailUnknown',
}
