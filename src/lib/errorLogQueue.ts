/**
 * Delivers frontend error reports to the backend JSONL log, and keeps the ones it
 * could not deliver in localStorage for later.
 *
 * `POST /kscw/client-error` runs on the same Directus that is failing when many errors
 * happen at once (a container restart during a deploy, say). The report died with the
 * request and the log showed nothing, which is how a member's failed screen left no
 * trace. public/boot-watchdog.js has done this for boot reports since 2026-09-16; this
 * is the same idea for everything that runs once the bundle has loaded.
 *
 * Callers hand over a report that is already redacted (sentry.ts → sendToErrorLog), so
 * no token reaches storage. Nothing in here may throw, log or report: a failure to
 * report must never become a new report.
 */

const QUEUE_KEY = 'kscw-error-log-queue'
const QUEUE_MAX = 20
// A flaky phone emits dozens of these in a second (the home page's parallel fetches all
// failing together), each for another collection, so they would not collapse into one.
// They get a small allowance of their own beside QUEUE_MAX and cannot push out any
// other report.
const NETWORK_ERROR_MAX = 3

// The collector takes 30 reports a minute per IP. That IP can be a whole hall's Wi-Fi
// and live reports count too, so the queue stays far below it. Without the window, a
// burst of delivered reports would trigger one flush each.
const FLUSH_MAX_PER_WINDOW = 5
const FLUSH_WINDOW_MS = 60_000
// Lets the boot's own requests and the session restore go first.
const FLUSH_START_DELAY_MS = 5_000
// A stalled connection may never reject. Giving up queues the report while the page is
// still there, and a flush can never hang on it for good.
const POST_TIMEOUT_MS = 15_000

// What the collector keeps of each field (kscw-endpoints index.js → POST /client-error).
// Anything longer would be stored here only to be cut there. Redaction has already run,
// so a cut cannot leave half a token that no rule matches any more.
const ERROR_MAX = 1000
const PAYLOAD_MAX = 500
const FIELD_MAX: Record<string, number> = { stack: 2000, responseBody: 1000 }
const OTHER_FIELD_MAX = 300

const API_BASE = (typeof window !== 'undefined' && window.location.hostname === 'wiedisync.kscw.ch')
  ? 'https://directus.kscw.ch'
  : (import.meta.env.VITE_DIRECTUS_URL || 'https://directus-dev.kscw.ch')

export type ErrorReport = Record<string, unknown>
type Outcome = 'delivered' | 'refused' | 'rate_limited' | 'failed'

let flushing = false
let started = false
// Bumped by every clear. A request that was under way across a sign-out belongs to the
// person who left, so it must not come back into the queue when it fails.
let generation = 0
let windowStart = 0
let sentInWindow = 0

async function post(report: ErrorReport): Promise<Outcome> {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), POST_TIMEOUT_MS)
  try {
    // Session cookie (if any) identifies the user; anonymous errors on public
    // pages send no cookie and are logged without a user — both accepted.
    const res = await fetch(`${API_BASE}/kscw/client-error`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
      keepalive: true, // survives page unload
      signal: abort.signal,
    })
    if (res.ok) return 'delivered'
    // A 4xx is an answer: the report was refused, and sending it again and again
    // would make it a poison pill. A Cloudflare 502/503/530 lands here or, without
    // CORS headers, in the catch below.
    if (res.status >= 500) return 'failed'
    return res.status === 429 ? 'rate_limited' : 'refused'
  } catch {
    return 'failed'
  } finally {
    clearTimeout(timer)
  }
}

function readQueue(): ErrorReport[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]')
    return Array.isArray(stored) ? stored.filter((r) => r && typeof r === 'object') : []
  } catch { return [] }
}

function writeQueue(queue: ErrorReport[]): boolean {
  try {
    if (queue.length) localStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
    else localStorage.removeItem(QUEUE_KEY)
    return true
  } catch { return false }
}

function withinCaps(queue: ErrorReport[]): ErrorReport[] {
  const isNetworkError = (r: ErrorReport) => r.event === 'network_error'
  const network = queue.filter(isNetworkError).slice(-NETWORK_ERROR_MAX)
  const others = queue.filter((r) => !isNetworkError(r)).slice(-QUEUE_MAX)
  return queue.filter((r) => network.includes(r) || others.includes(r))
}

function cappedPayload(payload: unknown): unknown {
  try {
    const json = JSON.stringify(payload)
    return json.length > PAYLOAD_MAX ? json.slice(0, PAYLOAD_MAX) : payload
  } catch { return undefined }
}

/** The report as it will go out later: bounded, and marked like a boot-watchdog one. */
function forLater(report: ErrorReport, at: string): ErrorReport {
  const later: ErrorReport = {}
  for (const [key, value] of Object.entries(report)) {
    if (typeof value === 'string') later[key] = value.slice(0, FIELD_MAX[key] ?? OTHER_FIELD_MAX)
    else if (typeof value === 'number' || typeof value === 'boolean') later[key] = value
  }
  // The collector cuts `error` at 1000 characters: make room, or the marker goes.
  const marker = ` — deferred from ${at}`
  later.error = String(report.error || '').slice(0, ERROR_MAX - marker.length) + marker
  // The log's `ts` is the delivery time, so `payload.at` is when it really happened.
  // The collector stores the payload as a JSON string cut at 500 characters, so these
  // two go first, and the request's own fields sit under `data` where none can
  // overwrite them.
  later.payload = { deferred: true, at, data: cappedPayload(report.payload) }
  return later
}

/** Out of storage before it is sent, so another open tab cannot send it too. */
function takeOldest(): ErrorReport | null {
  const [oldest, ...rest] = readQueue()
  if (!oldest) return null
  // If it could not be removed it would go out again on every flush: leave it there.
  return writeQueue(rest) ? oldest : null
}

function withinFlushBudget(): boolean {
  const now = Date.now()
  if (now - windowStart >= FLUSH_WINDOW_MS) {
    windowStart = now
    sentInWindow = 0
  }
  return sentInWindow < FLUSH_MAX_PER_WINDOW
}

/**
 * Sends a few queued reports, one at a time, and stops at the first failure. Posts
 * directly, not through `deliverErrorReport`, so its failures create no new report and
 * its deliveries trigger no further flush.
 */
export async function flushErrorLogQueue(): Promise<void> {
  if (flushing) return
  flushing = true
  const startedIn = generation
  try {
    while (startedIn === generation && withinFlushBudget()) {
      const report = takeOldest()
      if (!report) return
      const outcome = await post(report)
      // A 429 says nothing about this report: the limit is shared by a whole hall's
      // Wi-Fi. It keeps its place, unlike a report the collector actually refused.
      if (outcome === 'failed' || outcome === 'rate_limited') {
        if (startedIn === generation) writeQueue(withinCaps([report, ...readQueue()]))
        return
      }
      // Only answers count: a phone that keeps dropping off must still flush when it
      // comes back.
      sentInWindow++
    }
  } catch { /* never throw */ } finally {
    flushing = false
  }
}

/** Send a redacted report; keep it for later if it could not be delivered. */
export function deliverErrorReport(report: ErrorReport): Promise<void> {
  const at = new Date().toISOString()
  const startedIn = generation
  return post(report).then((outcome) => {
    if (outcome === 'delivered') return flushErrorLogQueue()
    if (outcome === 'failed' && startedIn === generation) writeQueue(withinCaps([...readQueue(), forLater(report, at)]))
  }).catch(() => { /* never throw */ })
}

/**
 * Forget every undelivered report. Reports go out with whatever session cookie is there
 * at delivery time, so one left behind would be logged under the next person to sign in
 * on a shared device.
 */
export function clearErrorLogQueue(): void {
  generation++
  try { localStorage.removeItem(QUEUE_KEY) } catch { /* storage unavailable — nothing to clear */ }
}

/** Call once at app start. */
export function startErrorLogQueue(): void {
  if (started || typeof window === 'undefined') return
  started = true
  window.addEventListener('online', () => { void flushErrorLogQueue() })
  setTimeout(() => { void flushErrorLogQueue() }, FLUSH_START_DELAY_MS)
}
