/**
 * Google Calendar Push — KSCW home games → "KSCW Heimspiele/Halle KWI".
 *
 * The pull half (gcal-sync.js) imports hall closures FROM that calendar. This is
 * the other direction: every KSCW home game in a KWI hall is written TO it, so
 * the hall administration (who own the calendar) and the club see the same
 * fixture list without anyone retyping it. Until 2026-07 this was a manual bulk
 * entry by the hall admin once per season.
 *
 * Auth is a Google service account (wiedisync-gcal@kscw-calendar.iam...), added
 * to the calendar's share list as a writer. No user, no OAuth consent, no
 * refresh token — we sign a JWT with the private key and swap it for an access
 * token. Key lives in GCAL_SERVICE_ACCOUNT_B64 (base64 of the JSON key file);
 * with no key set, push is a no-op and the pull behaves exactly as before.
 *
 * Ownership rule: we only ever touch events carrying our own private
 * extendedProperty (wiedisync=game). Everything else on that calendar — the hall
 * closures, the Handball tournament, ASVZ Volleynight — is other people's data
 * and is never updated or deleted, no matter what our DB thinks.
 */

import crypto from 'node:crypto'

export const KSCW_CALENDAR_ID = '145bqacb4v5qfkr97u2fdchi5o@group.calendar.google.com'
const KWI_ADDRESS = 'Kantonsschule Wiedikon, Goldbrunnenstrasse 80, 8055 Zürich'
const GAME_DURATION_MIN = 120 // games carry no end time; the hall admin's own entries used 2h

// ── auth ──────────────────────────────────────────────────────────────────────

let cachedToken = null // { token, expiresAt }

function loadKey() {
  const b64 = process.env.GCAL_SERVICE_ACCOUNT_B64
  if (!b64) return null
  try {
    const key = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'))
    return key.client_email && key.private_key ? key : null
  } catch {
    return null
  }
}

export function isPushEnabled() {
  return loadKey() !== null
}

// There is exactly ONE production calendar and dev's database is a nightly clone
// of prod — so a dev instance with a key would push the same games and then fight
// prod over every edit. Dev therefore runs GCAL_PUSH_DRY_RUN=true: the full path
// (auth, fetch, diff) runs and logs what it WOULD do, and nothing is written.
const isDryRun = () => process.env.GCAL_PUSH_DRY_RUN === 'true'

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token
  const key = loadKey()
  if (!key) throw new Error('GCAL_SERVICE_ACCOUNT_B64 not set')

  const b64url = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const unsigned = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url({
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/calendar',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  })}`
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(key.private_key, 'base64url')

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    }),
  })
  const body = await resp.json()
  if (!body.access_token) throw new Error(`GCal token exchange failed: ${JSON.stringify(body).slice(0, 200)}`)
  cachedToken = { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 }
  return cachedToken.token
}

async function api(path, { method = 'GET', body, query } = {}) {
  const token = await getAccessToken()
  const qs = query ? `?${new URLSearchParams(query)}` : ''
  const resp = await fetch(`https://www.googleapis.com/calendar/v3${path}${qs}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (resp.status === 204) return null
  const json = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new Error(`GCal ${method} ${path} → ${resp.status} ${JSON.stringify(json.error ?? json).slice(0, 200)}`)
  return json
}

// ── shaping ───────────────────────────────────────────────────────────────────

// Wall-clock time in Zurich, as YYYY-MM-DDTHH:MM. Comparing wall time (rather
// than instants) keeps the DST boundary honest: a 20:00 game is 20:00 whether
// it falls in CET or CEST, and Google echoes back an offset we'd otherwise have
// to re-derive.
function zurichWallTime(isoWithOffset) {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Zurich',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(isoWithOffset))
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}

function addMinutes(hhmm, minutes) {
  const [h, m] = hhmm.split(':').map(Number)
  const total = h * 60 + m + minutes
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

// "VB D4 vs. Rüschlikon 4 (Halle A)" — the format the hall administration has
// used for years. Keep it; they read this calendar.
function buildEvent(game) {
  const prefix = game.source === 'basketplan' ? 'BB' : 'VB'
  const team = game.team_name || game.home_team || '?'
  const hall = `Halle ${game.hall_letter}`
  const startTime = String(game.time).slice(0, 5)
  const day = String(game.date).slice(0, 10)

  return {
    summary: `${prefix} ${team} vs. ${game.away_team} (${hall})`,
    description: `KSC Wiedikon ${team} – ${game.away_team}\nDetails: wiedisync.kscw.ch`,
    location: `${hall}, ${KWI_ADDRESS}`,
    start: { dateTime: `${day}T${startTime}:00`, timeZone: 'Europe/Zurich' },
    end: { dateTime: `${day}T${addMinutes(startTime, GAME_DURATION_MIN)}:00`, timeZone: 'Europe/Zurich' },
    transparency: 'transparent', // never block anyone's own calendar
    extendedProperties: { private: { wiedisync: 'game', game_id: game.game_id } },
  }
}

function needsUpdate(existing, desired) {
  return (
    existing.summary !== desired.summary ||
    (existing.description ?? '') !== desired.description ||
    (existing.location ?? '') !== desired.location ||
    zurichWallTime(existing.start?.dateTime) !== `${desired.start.dateTime.slice(0, 16)}` ||
    zurichWallTime(existing.end?.dateTime) !== `${desired.end.dateTime.slice(0, 16)}` ||
    existing.extendedProperties?.private?.game_id !== desired.extendedProperties.private.game_id
  )
}

// ── sync ──────────────────────────────────────────────────────────────────────

/**
 * Reconcile KWI home games onto the calendar.
 * Returns { created, updated, deleted, skipped, eventIds } — eventIds is every
 * event we own, so the pull half can skip its own output instead of re-importing
 * our games as hall_events.
 */
export async function pushHomeGames(db, log) {
  if (!isPushEnabled()) return { created: 0, updated: 0, deleted: 0, skipped: 0, eventIds: new Set(), disabled: true }

  // Manage today forward only. Past events are frozen history: never rewritten,
  // never swept, even if the game row is later corrected or deleted.
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Zurich' }).format(new Date())

  const games = await db('games as g')
    .join('halls as h', 'h.id', 'g.hall')
    .leftJoin('teams as t', 't.id', 'g.kscw_team')
    .where('g.type', 'home')
    .whereRaw("h.name ~* '^kwi'")
    .andWhere('g.date', '>=', today)
    .whereNotNull('g.game_id')
    .select(
      'g.game_id',
      'g.away_team',
      'g.home_team',
      'g.source',
      db.raw('g.date::text as date'),
      db.raw("to_char(g.time, 'HH24:MI') as time"),
      db.raw("right(h.name, 1) as hall_letter"),
      't.name as team_name',
    )

  const desired = new Map()
  let skipped = 0
  for (const game of games) {
    // No kick-off time means we cannot place it in a hall slot honestly. Leave it
    // off the calendar rather than invent an hour.
    if (!game.time || !game.away_team) { skipped++; continue }
    desired.set(game.game_id, buildEvent(game))
  }

  // Everything we own, from today forward. Two sources: the private marker
  // (everything the sync itself has written) and the transitional signature of
  // the 70 events seeded by hand in 2026-07, which predate the marker.
  const existing = new Map() // game_id → event
  const timeMin = `${today}T00:00:00Z`

  const collect = async (query) => {
    let pageToken
    do {
      const page = await api(`/calendars/${encodeURIComponent(KSCW_CALENDAR_ID)}/events`, {
        query: { timeMin, singleEvents: 'true', maxResults: '250', ...query, ...(pageToken ? { pageToken } : {}) },
      })
      for (const ev of page.items ?? []) {
        const marked = ev.extendedProperties?.private?.wiedisync === 'game'
        const gameId = ev.extendedProperties?.private?.game_id
        if (marked && gameId) { existing.set(gameId, ev); continue }
        // Transitional: seeded by hand, keyed by the visible "Spielnummer" line.
        // Both halves of the signature must match so we can never adopt — and
        // therefore never delete — an event a human wrote.
        const desc = ev.description ?? ''
        const legacy = /Spielnummer (\S+)/.exec(desc)
        if (legacy && desc.includes('wiedisync.kscw.ch')) existing.set(`vb_${legacy[1]}`, ev)
      }
      pageToken = page.nextPageToken
    } while (pageToken)
  }

  await collect({ privateExtendedProperty: 'wiedisync=game' })
  await collect({}) // adoption sweep; drops out naturally once every event is marked

  const dryRun = isDryRun()
  let created = 0
  let updated = 0
  let deleted = 0
  const eventIds = new Set()

  for (const [gameId, event] of desired) {
    const current = existing.get(gameId)
    if (!current) {
      if (!dryRun) {
        const made = await api(`/calendars/${encodeURIComponent(KSCW_CALENDAR_ID)}/events`, {
          method: 'POST', body: event, query: { sendUpdates: 'none' },
        })
        eventIds.add(made.id)
      }
      created++
    } else {
      eventIds.add(current.id)
      if (needsUpdate(current, event)) {
        if (!dryRun) {
          await api(`/calendars/${encodeURIComponent(KSCW_CALENDAR_ID)}/events/${current.id}`, {
            method: 'PATCH', body: event, query: { sendUpdates: 'none' },
          })
        }
        updated++
      }
    }
  }

  // Ours, but no longer a KWI home game — cancelled, rescheduled away, or moved
  // to Döltschi. Only events we own reach this loop.
  for (const [gameId, event] of existing) {
    if (desired.has(gameId)) continue
    if (!dryRun) {
      await api(`/calendars/${encodeURIComponent(KSCW_CALENDAR_ID)}/events/${event.id}`, {
        method: 'DELETE', query: { sendUpdates: 'none' },
      })
    }
    deleted++
  }

  if (skipped) log.warn({ msg: `gcal-push: ${skipped} home game(s) skipped (no kick-off time or opponent)`, endpoint: 'gcal-sync' })
  log.info({ msg: `gcal-push${dryRun ? ' (dry run — nothing written)' : ''}: +${created} ~${updated} -${deleted}`, endpoint: 'gcal-sync' })
  return { created, updated, deleted, skipped, dryRun, eventIds }
}
