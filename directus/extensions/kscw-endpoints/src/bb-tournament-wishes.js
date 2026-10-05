/**
 * Basketball tournament weekend wishes (migration 400) — the pure part.
 *
 * New batches open the moment Basketplan publishes them, so there is nothing
 * to pick in advance. A coach names the weekends the team wants to play
 * instead; when an open tournament for the team's league appears in such a
 * week (and not at one of the team's places to avoid), the worker turns it
 * into an ordinary pick and registers it. At most one per team and week:
 * a week already holding a registration or a live pick is "covered".
 *
 * Shared by the endpoints (bb-tournament-picks.js) and the worker
 * (bb-tournament-worker.js); kept free of either to avoid an import cycle.
 */

/** 'MixU 8M' and 'mixu8m' are the same league. */
export const leagueKey = (s) => String(s ?? '').replace(/\s+/g, '').toLowerCase()

export function zurichToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(now)
}

/** Hour of the day in Zurich, 0–23. */
export function zurichHour(now = new Date()) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', hour: '2-digit', hourCycle: 'h23' }).format(now))
}

export const ymd = (v) => (v == null ? null : v instanceof Date ? zurichToday(v) : String(v).slice(0, 10))

export const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10)

/** 'yyyy-mm-dd' → the Monday of its week, or null. */
export function weekStart(day) {
  const s = String(day ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const t = new Date(`${s}T12:00:00Z`)
  if (Number.isNaN(t.getTime())) return null
  return addDays(s, -((t.getUTCDay() + 6) % 7))
}

/** Does the team's league appear in the tournament's leagues? */
export function teamFits(team, tournament) {
  const k = leagueKey(team.league)
  return !!k && (tournament.leagues || []).some((l) => leagueKey(l) === k)
}

const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/** Is the tournament at one of the places to avoid (host club or hall, by substring)? */
export function avoided(tournament, avoid) {
  const where = fold(`${tournament.host_club ?? ''} ${tournament.hall ?? ''}`)
  return (avoid || []).some((w) => fold(w).length >= 2 && where.includes(fold(w)))
}

/** Results after which a pick no longer holds its week (Basketplan refused the team). */
export const DEAD_RESULTS = ['not_offered']

const key = (tournament, team) => `${tournament}:${team}`

/** A pick still counts: deadline not past and Basketplan has not refused it. */
export function pickAlive(tournament, attempt, today) {
  const deadline = ymd(tournament.deadline)
  if (deadline != null && deadline < today) return false
  return !(attempt && DEAD_RESULTS.includes(attempt.result))
}

/** Newest attempt per tournament + team (input newest first). */
export function latestAttempts(attempts) {
  const by = new Map()
  for (const a of attempts || []) {
    const k = key(a.tournament, a.team)
    if (!by.has(k)) by.set(k, a)
  }
  return by
}

/** The team's tournaments in the wish's week (Monday–Sunday), by date. */
export function weekTournaments(wish, team, tournaments) {
  const from = ymd(wish.week_start)
  const to = addDays(from, 6)
  return tournaments
    .filter((t) => {
      const start = ymd(t.date)
      const end = ymd(t.end_date) || start
      return start <= to && end >= from && teamFits(team, t)
    })
    .sort((a, b) => (ymd(a.date) < ymd(b.date) ? -1 : ymd(a.date) > ymd(b.date) ? 1 : Number(a.id) - Number(b.id)))
}

/**
 * One wish's state. Pure.
 *   past | registered (Basketplan has the team that week) | picked (a live pick
 *   holds the week) | waiting (nothing yet — the worker is watching).
 */
export function wishState(wish, team, tournaments, pickBy, attemptBy, today) {
  const brief = (t) => ({ id: Number(t.id), date: ymd(t.date), host_club: t.host_club ?? null })
  if (addDays(ymd(wish.week_start), 6) < today) return { state: 'past', tournament: null }
  const week = weekTournaments(wish, team, tournaments)
  const reg = week.find((t) => (t.kscw_bp_team_ids || []).map(String).includes(String(team.bb_source_id)))
  if (reg) return { state: 'registered', tournament: brief(reg) }
  const picked = week.find((t) => pickBy.has(key(t.id, team.id)) && pickAlive(t, attemptBy.get(key(t.id, team.id)), today))
  if (picked) return { state: 'picked', tournament: brief(picked) }
  return { state: 'waiting', tournament: null }
}

/**
 * Which tournament to pick for each waiting wish. Pure.
 *   wishes:      [{ id, team, week_start }]
 *   teams:       Map id → { id, league, bb_source_id, hidden, avoid }
 *   tournaments: bb_tournaments rows
 *   picks:       [{ tournament, team }]
 *   attempts:    journal rows, newest first
 * → [{ wish, team, tournament }] — at most one per wish.
 */
export function matchWishes({ wishes, teams, tournaments, picks, attempts, today }) {
  const pickBy = new Map((picks || []).map((p) => [key(p.tournament, p.team), p]))
  const attemptBy = latestAttempts(attempts)
  const out = []
  for (const w of wishes) {
    const team = teams.get(Number(w.team))
    if (!team || team.hidden || !team.bb_source_id) continue
    if (wishState(w, team, tournaments, pickBy, attemptBy, today).state !== 'waiting') continue
    const t = weekTournaments(w, team, tournaments).find((c) =>
      c.registration_open
      && ymd(c.date) >= today
      && !(ymd(c.deadline) && ymd(c.deadline) < today)
      && !avoided(c, team.avoid)
      && !pickBy.has(key(c.id, team.id)))
    if (t) out.push({ wish: Number(w.id), team: Number(team.id), tournament: Number(t.id) })
  }
  return out
}

/** Wishes the worker must watch for: not past, nothing holding the week yet. Pure. */
export function waitingWishes({ wishes, teams, tournaments, picks, attempts, today }) {
  const pickBy = new Map((picks || []).map((p) => [key(p.tournament, p.team), p]))
  const attemptBy = latestAttempts(attempts)
  return wishes.filter((w) => {
    const team = teams.get(Number(w.team))
    if (!team || team.hidden || !team.bb_source_id) return false
    return wishState(w, team, tournaments, pickBy, attemptBy, today).state === 'waiting'
  })
}
