/**
 * Basketplan registration worker — registers the coaches' tournament picks
 * (bb_tournament_picks, migration 398) on Basketplan, so the sport admin no
 * longer types them in by hand and a new batch is caught the minute it opens.
 *
 * MODES (bb_tournament_worker.mode, set on /tournaments by a basketball admin):
 *   off  — nothing runs (default; the kill switch).
 *   dry  — everything up to the submission: login, read, check the form offers
 *          the team, then journal "dry_run" instead of submitting.
 *   live — submits. ⚠ Only where the container env has
 *          BASKETPLAN_REGISTER_LIVE=1 (prod). Dev's DB is a nightly prod clone
 *          and shares the club login, so without the flag 'live' runs as 'dry'.
 *
 * WHEN (a per-minute cron calls POST /kscw/admin/bb-register-tick):
 *   - normally every 10 minutes, and only if a pick is still unregistered —
 *     otherwise Basketplan is not contacted at all;
 *   - while a weekend wish (migration 400) is still waiting, every minute
 *     between 07:00 and 22:00 Zurich: the list is re-read, and an open
 *     tournament that fits a waiting wish becomes a pick and is registered
 *     (bb-tournament-wishes.js). New batches open the moment they appear;
 *   - inside the opening window (rush_from..rush_until, ≤ 3 h) the list is
 *     re-read every poll_seconds (≥ 20 s), new tournaments are added to
 *     bb_tournaments, and a pick is submitted as soon as its tournament opens.
 *
 * NEVER TWICE: a live attempt writes its journal row as 'submitting' before
 * the request leaves; a partial unique index (migration 399) refuses a second
 * one for the same tournament + team, and a row stuck in 'submitting' (crash,
 * timeout) is never retried — a person looks at it. Before submitting, the
 * tournament page is re-read: a team already registered is journalled
 * 'already' and left alone. After submitting, the page is read again; only a
 * team id in the registrations table counts as 'registered'.
 *
 * NEVER WITHDRAWS: the client's allow-list is the four read pages plus the
 * registration form and its post. Basketplan's withdraw GET link is refused
 * by bpClient whatever the list says.
 *
 * PRIVACY: same as the import — only team ids leave a page; journal messages
 * carry our own wording and HTTP status codes, never page text.
 */

import { READ_PATHS, bpClient, parseTournamentDetail, parseTournamentList, planTournamentRows, syncBpTournaments } from './bp-tournaments.js'
import { addDays, matchWishes, waitingWishes, zurichHour } from './bb-tournament-wishes.js'

export const FORM_PATH = '/selectTeamForClubRegistration.do'
export const REGISTER_PATH = '/registerTeamForTournament.do'
export const WORKER_PATHS = [...READ_PATHS, FORM_PATH, REGISTER_PATH]
export const MODES = ['off', 'dry', 'live']
/** Outside the opening window, look for work this often (minutes). */
export const NORMAL_EVERY_MIN = 10
/** Watching for weekend wishes happens in these Zurich hours (from inclusive, until exclusive). */
export const WATCH_HOURS = [7, 22]
/** A tournament gone from the list this long is not matched to a wish. */
const STALE_MS = 3 * 86400000
/** A tick must end before the next one starts. */
const TICK_BUDGET_MS = 50_000
/** Results that block any further live submission for the tournament + team. */
export const FINAL_LIVE = ['submitting', 'registered', 'unconfirmed']

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ymd = (v) => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10))

/** The registration form → the team ids it offers (our teams that may enter). */
export function parseRegisterForm(html) {
  const s = String(html)
  const form = /<form[^>]*name="tournamentRegistrationForm"[\s\S]*?<\/form>/.exec(s)?.[0]
  if (!form) return { ok: false, teamIds: [] }
  const select = /<select[^>]*name="teamId"[\s\S]*?<\/select>/.exec(form)?.[0] || ''
  const teamIds = [...select.matchAll(/<option[^>]*value="(\d+)"/g)].map((m) => m[1])
  return { ok: true, teamIds }
}

/** What the worker may do right now. Pure. */
export function effectiveMode(mode, liveAllowed) {
  if (!MODES.includes(mode) || mode === 'off') return 'off'
  if (mode === 'live' && !liveAllowed) return 'dry'
  return mode
}

export function inWindow(settings, now) {
  if (!settings?.rush_from || !settings?.rush_until) return false
  const t = now.getTime()
  return t >= new Date(settings.rush_from).getTime() && t < new Date(settings.rush_until).getTime()
}

export function inWatchHours(now) {
  const h = zurichHour(now)
  return h >= WATCH_HOURS[0] && h < WATCH_HOURS[1]
}

/** Run on this tick? Inside the window always; else every NORMAL_EVERY_MIN minutes. */
export function shouldRun(settings, now, liveAllowed) {
  if (effectiveMode(settings?.mode, liveAllowed) === 'off') return false
  return inWindow(settings, now) || now.getUTCMinutes() % NORMAL_EVERY_MIN === 0
}

/**
 * Picks still to register. Pure.
 *   picks:      [{ tournament, team }]
 *   tournaments: Map id → bb_tournaments row
 *   teams:      Map id → { bb_source_id }
 *   blocked:    Set of `${tournament}:${team}` with a FINAL_LIVE journal row
 */
export function pendingPicks(picks, tournaments, teams, blocked, today) {
  const out = []
  for (const p of picks) {
    const t = tournaments.get(Number(p.tournament))
    const team = teams.get(Number(p.team))
    if (!t || !team?.bb_source_id) continue
    if (ymd(t.deadline) && ymd(t.deadline) < today) continue
    if ((t.kscw_bp_team_ids || []).map(String).includes(String(team.bb_source_id))) continue
    if (blocked.has(`${p.tournament}:${p.team}`)) continue
    out.push({ tournament: Number(p.tournament), team: Number(p.team), bp: String(team.bb_source_id) })
  }
  return out
}

export function createBbTournamentWorker({ database, log, fetchImpl = fetch, env = process.env, sleepImpl = sleep }) {
  const liveAllowed = env.BASKETPLAN_REGISTER_LIVE === '1'
  const clubId = String(env.BASKETPLAN_CLUB_ID || '166')
  let running = false
  let journalled = 0
  /** One Basketplan session, kept between ticks; logs in again once if it expired. */
  let session = null

  const settings = () => database('bb_tournament_worker').where('id', 1).first()

  /** Journal a non-submitting outcome — once per day per tournament/team/result. */
  async function note(tournament, team, mode, result, message) {
    const since = new Date(Date.now() - 86400000)
    const dup = await database('bb_tournament_registrations')
      .where({ tournament, team, result }).where('attempted_at', '>=', since).first('id')
    if (dup) return
    const now = new Date()
    await database('bb_tournament_registrations').insert({ tournament, team, mode, result, message, attempted_at: now, finished_at: now })
    journalled++
  }

  async function getSession(username, password) {
    if (session) return session
    const c = bpClient(fetchImpl, { allow: WORKER_PATHS })
    await c.login(username, password)
    session = {
      ...c,
      async getHtml(path) {
        try {
          return await c.getHtml(path)
        } catch (e) {
          if (!/not logged in/.test(e.message)) throw e
          await c.login(username, password)
          return c.getHtml(path)
        }
      },
    }
    return session
  }

  /** Everything matchWishes needs, or null without any current wish. */
  async function wishContext(today) {
    const wishes = await database('bb_tournament_wishes').where('week_start', '>=', addDays(today, -6))
      .select('id', 'team', 'week_start', 'wished_by', 'wished_by_name')
    if (!wishes.length) return null
    const teamIds = [...new Set(wishes.map((w) => Number(w.team)))]
    const [teamRows, prefs, tournaments, picks, attempts] = await Promise.all([
      database('teams').whereIn('id', teamIds).where('active', true).select('id', 'league', 'bb_source_id'),
      database('bb_tournament_team_prefs').whereIn('team', teamIds).select('team', 'hidden', 'avoid'),
      database('bb_tournaments')
        .where((q) => q.where('date', '>=', addDays(today, -6)).orWhere('end_date', '>=', today))
        .where('last_seen_at', '>=', new Date(Date.now() - STALE_MS)),
      database('bb_tournament_picks').whereIn('team', teamIds).select('tournament', 'team'),
      database('bb_tournament_registrations').whereIn('team', teamIds).orderBy('attempted_at', 'desc').select('tournament', 'team', 'result'),
    ])
    const prefBy = new Map(prefs.map((p) => [Number(p.team), p]))
    const teams = new Map(teamRows.map((t) => [Number(t.id), { ...t, hidden: !!prefBy.get(Number(t.id))?.hidden, avoid: prefBy.get(Number(t.id))?.avoid || [] }]))
    return { wishes, teams, tournaments, picks, attempts, today }
  }

  /** Waiting wishes → picks (the normal flow then registers them). Returns how many. */
  async function pickFromWishes(today, mode, fresh) {
    const ctx = await wishContext(today)
    if (!ctx) return 0
    const byId = new Map(ctx.wishes.map((w) => [Number(w.id), w]))
    let made = 0
    for (const m of matchWishes(ctx)) {
      const w = byId.get(m.wish)
      const now = new Date()
      const rows = await database('bb_tournament_picks')
        .insert({ tournament: m.tournament, team: m.team, picked_by: w?.wished_by ?? null, picked_by_name: w?.wished_by_name ?? null, note: null, wish: m.wish, date_created: now, date_updated: now })
        .onConflict(['tournament', 'team']).ignore()
        .returning('id')
      if (!rows.length) continue
      made++
      fresh?.add(m.tournament)
      await note(m.tournament, m.team, mode, 'wish_picked', 'Picked from a weekend wish')
      log.info(`[BB Worker] wish ${m.wish}: picked tournament ${m.tournament} for team ${m.team}`)
    }
    return made
  }

  async function hasWaitingWishes(today) {
    const ctx = await wishContext(today)
    return !!ctx && waitingWishes(ctx).length > 0
  }

  async function markRegistered(tournamentId, bp) {
    const row = await database('bb_tournaments').where('id', tournamentId).first('kscw_bp_team_ids')
    const ids = new Set((row?.kscw_bp_team_ids || []).map(String))
    ids.add(String(bp))
    await database('bb_tournaments').where('id', tournamentId).update({ kscw_bp_team_ids: [...ids] })
  }

  async function loadPending(today) {
    const picks = await database('bb_tournament_picks').select('tournament', 'team')
    if (!picks.length) return []
    const tIds = [...new Set(picks.map((p) => Number(p.tournament)))]
    const teamIds = [...new Set(picks.map((p) => Number(p.team)))]
    const [tRows, teamRows, blockedRows] = await Promise.all([
      database('bb_tournaments').whereIn('id', tIds),
      database('teams').whereIn('id', teamIds).where('active', true).select('id', 'bb_source_id'),
      database('bb_tournament_registrations').whereIn('result', FINAL_LIVE).select('tournament', 'team'),
    ])
    return pendingPicks(
      picks,
      new Map(tRows.map((t) => [Number(t.id), t])),
      new Map(teamRows.map((t) => [Number(t.id), t])),
      new Set(blockedRows.map((r) => `${r.tournament}:${r.team}`)),
      today,
    )
  }

  /** One pick: re-read, check the form, then submit (live) or journal (dry). */
  async function registerOne(client, p, mode) {
    const detailPath = `/findTournamentById.do?tournamentId=${p.tournament}`
    const before = parseTournamentDetail(await client.getHtml(detailPath))
    if (before.teamIds.includes(p.bp)) {
      await markRegistered(p.tournament, p.bp)
      await note(p.tournament, p.team, mode, 'already', 'Already registered on Basketplan')
      return 'already'
    }
    if (!before.open) return 'not_open'

    const form = parseRegisterForm(await client.getHtml(`${FORM_PATH}?tournamentId=${p.tournament}&loggedInAsClubWithId=${clubId}`))
    if (!form.ok) return 'not_open'
    if (!form.teamIds.includes(p.bp)) {
      await note(p.tournament, p.team, mode, 'not_offered', 'Basketplan does not offer this team for the tournament (age group, full or closed)')
      return 'not_offered'
    }
    if (mode !== 'live') {
      await note(p.tournament, p.team, mode, 'dry_run', 'Would register now (test run)')
      return 'dry_run'
    }

    // Claim first: the unique index is the guarantee, not this process.
    let journalId
    try {
      const [row] = await database('bb_tournament_registrations')
        .insert({ tournament: p.tournament, team: p.team, mode, result: 'submitting', message: null, attempted_at: new Date() })
        .returning('id')
      journalId = row?.id ?? row
      journalled++
    } catch (e) {
      if (e?.code === '23505') return 'skipped'
      throw e
    }

    let result = 'unconfirmed'
    let message
    try {
      const res = await client.request(REGISTER_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ tournamentId: String(p.tournament), teamId: p.bp }),
      })
      const after = parseTournamentDetail(await client.getHtml(detailPath))
      if (after.teamIds.includes(p.bp)) {
        result = 'registered'
        message = 'Registered on Basketplan'
        await markRegistered(p.tournament, p.bp)
      } else {
        message = `Submitted (HTTP ${res.status}) but the team is not on the tournament page — check Basketplan`
      }
    } catch (e) {
      message = `Submitted, outcome unknown: ${String(e.message).slice(0, 200)} — check Basketplan`
    }
    await database('bb_tournament_registrations').where('id', journalId).update({ result, message, finished_at: new Date() })
    log.info(`[BB Worker] tournament ${p.tournament} team ${p.team}: ${result}`)
    return result
  }

  /**
   * Re-read the list (opening window, wish watch): refresh open flags, add new
   * tournaments. Returns the ids that are open now and were not before.
   */
  async function refreshList(client) {
    const list = parseTournamentList(await client.getHtml('/findAllTournaments.do'))
    const knownRows = await database('bb_tournaments').whereIn('id', list.map((t) => t.id)).select('id', 'registration_open')
    const wasOpen = new Map(knownRows.map((r) => [Number(r.id), !!r.registration_open]))
    const known = new Set(wasOpen.keys())
    const opened = new Set()
    const ourBp = await database('teams').where('sport', 'basketball').where('active', true).whereNot('bb_source_id', '').pluck('bb_source_id')
    const now = new Date()
    for (const t of list) {
      const isOpen = /^Anmelden$/i.test(t.status || '')
      if (isOpen && !wasOpen.get(t.id)) opened.add(t.id)
      if (known.has(t.id)) {
        await database('bb_tournaments').where('id', t.id).update({
          registration_open: isOpen,
          list_status: t.status ? String(t.status).slice(0, 60) : null,
          last_seen_at: now,
        })
      } else {
        const d = parseTournamentDetail(await client.getHtml(`/findTournamentById.do?tournamentId=${t.id}`))
        const [row] = planTournamentRows([{ ...t, ...d, club: d.club || t.club }], ourBp)
        await database('bb_tournaments').insert({ ...row, first_seen_at: now, last_seen_at: now }).onConflict('id').ignore()
      }
    }
    return opened
  }

  /** One tick. Returns a summary; never throws for "nothing to do". */
  async function run({ now = new Date(), force = false } = {}) {
    if (running) return { skipped: 'busy' }
    const s = await settings()
    const mode = effectiveMode(s?.mode, liveAllowed)
    if (mode === 'off') return { skipped: 'off' }
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(now)
    const rush = inWindow(s, now)
    const watch = !rush && inWatchHours(now) && await hasWaitingWishes(today)
    if (!force && !watch && !shouldRun(s, now, liveAllowed)) return { skipped: 'not_due' }
    const username = env.BASKETPLAN_USERNAME
    const password = env.BASKETPLAN_PASSWORD
    if (!username || !password) return { skipped: 'no_credentials' }

    running = true
    journalled = 0
    const started = Date.now()
    const counts = {}
    const tally = (r, n = 1) => { if (n) counts[r] = (counts[r] || 0) + n }
    try {
      // Tournaments already known can answer a wish without asking Basketplan.
      // Watching runs every minute; a pick whose tournament did not just open
      // (or was not just picked) waits for the usual 10-minute mark.
      const fresh = new Set()
      const due = rush || force || now.getUTCMinutes() % NORMAL_EVERY_MIN === 0
      tally('wish_picked', await pickFromWishes(today, mode, fresh))
      let pending = await loadPending(today)
      if (!pending.length && !rush && !watch) return { mode, rush, watch, pending: 0, quiet: journalled === 0 }

      const client = await getSession(username, password)
      const pollMs = Math.max(20, Number(s.poll_seconds) || 30) * 1000
      for (;;) {
        if (rush || watch) {
          for (const id of await refreshList(client)) fresh.add(id)
          tally('wish_picked', await pickFromWishes(today, mode, fresh))
        }
        pending = await loadPending(today)
        const open = rush || watch
          ? new Set((await database('bb_tournaments').whereIn('id', pending.map((p) => p.tournament)).where('registration_open', true).pluck('id')).map(Number))
          : null
        for (const p of pending) {
          if (open && !open.has(p.tournament)) continue
          if (!due && !fresh.has(p.tournament)) continue
          try {
            const r = await registerOne(client, p, mode)
            if (r !== 'not_open') tally(r)
          } catch (e) {
            tally('error')
            log.warn(`[BB Worker] tournament ${p.tournament} team ${p.team}: ${e.message}`)
            await note(p.tournament, p.team, mode, 'error', String(e.message).slice(0, 300))
          }
        }
        if (!rush || Date.now() - started + pollMs > TICK_BUDGET_MS) break
        await sleepImpl(pollMs)
      }
      if (counts.registered) {
        // The new registrations become calendar games now, not tomorrow morning.
        try { await syncBpTournaments(database, log, { fetchImpl }) } catch (e) { log.warn(`[BB Worker] follow-up sync: ${e.message}`) }
      }
      return { mode, rush, watch, counts, quiet: journalled === 0 }
    } catch (e) {
      // A broken session must not stick: the next tick logs in afresh.
      session = null
      throw e
    } finally {
      running = false
    }
  }

  return { run, liveAllowed }
}
