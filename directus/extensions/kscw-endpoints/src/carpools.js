/**
 * Car pooling — ride offers and ride requests per game, training or event
 * (migration 378).
 *
 *   GET    /kscw/carpools/upcoming                 Home: enabled activities that concern me
 *   GET    /kscw/carpools/:type/:id                the activity's board (+ `enabled`)
 *   POST   /kscw/carpools/:type/:id                create my offer or my request
 *   PATCH  /kscw/carpools/entries/:entryId         edit my entry
 *   DELETE /kscw/carpools/entries/:entryId         withdraw my entry (passengers are told)
 *   POST   /kscw/carpools/entries/:entryId/join    take seat(s) in an offered car
 *   DELETE /kscw/carpools/entries/:entryId/join    leave that car
 *   POST   /kscw/carpools/entries/:entryId/take    driver: take a request into my car
 *   DELETE /kscw/carpools/passengers/:pid          driver: drop a passenger from my car
 *
 * :type ∈ game | training | event.
 *
 * WHO MAY SEE A BOARD: whoever may read the activity AND is in its scope
 * (below). Readability is answered by reading the activity through ItemsService
 * with the caller's own accountability, so the games/trainings/events read
 * policies decide — no second copy of them here to drift (see migration 378's
 * header). Everything after that check is raw knex.
 *
 * WHO MAY WRITE: any member who can see the activity, on their OWN rows only
 * (`carpools.member` / `carpool_passengers.passenger` = the acting member). The
 * one cross-member write is the driver's: taking a request into their car, and
 * dropping a passenger from it. A household main account acting for a linked
 * member writes as that member — which is the point: a parent organising a lift
 * for a child. Full admins may withdraw any entry (moderation).
 *
 * SCOPE (migration 379): a shared game/event can be opened to chosen teams
 * only (`carpool_teams`, a jsonb id list on the activity; empty = everyone who
 * can see it — except a GAME, which everyone can see: its empty scope means
 * the game's own team + guest teams + individually invited guests, audit
 * 2026-09-28 F21). Scoped out = not a player/coach/TR of any listed ACTIVE
 * team and no ride of your own on it — the board then reads as empty
 * (`in_scope: false`) and every write, `/take` included, 403s
 * `carpool_not_in_scope`. Having a ride already keeps you in, so narrowing the
 * scope never strands a passenger.
 *
 * PER-OFFER TEAMS + RETURN TIME (migration 380): a driver can offer a ride to
 * some of the invited teams only (`carpools.teams`, empty = all). Such an offer
 * is hidden from members outside those teams (unless they sit in it) and a
 * join / take across teams is refused.
 *
 * GOING + RETURN (migration 393): every ride is for ONE way — `direction`
 * 'there' (the Going board) or 'back' (the Return board) — with its own
 * departure date + time and its own passengers. A driver doing both ways posts
 * two rides. Direction is immutable (a PATCH cannot move a car and its
 * passengers to the other board); a driver takes a request only into their car
 * for the same way, and a request is covered per way.
 *
 * New entries and seats need `carpool_enabled` and an activity that is neither
 * cancelled nor over; withdrawing and leaving are always allowed, so switching
 * the board off never strands anybody in a car they cannot get out of.
 *
 * Seat capacity is enforced by trg_carpool_passengers_capacity (a row lock in
 * Postgres), not by a count here — two members racing for the last seat cannot
 * both win. Its `carpool_*` exceptions map to 409s via mapCarpoolError().
 *
 * No contact details: the board carries names only — no phone numbers, not
 * even between people sharing a car (dropped 27.09.2026 at the club's request).
 * Members cannot read each other's phone through /items (migration 024) and
 * this endpoint must not become the way around that.
 *
 * Every mutation calls writeUserLog (raw knex bypasses the items audit hook —
 * CLAUDE.md → Audit logging) and notifies the other party in-app + push,
 * best-effort.
 */

import { writeUserLog } from './activity-log.js'
import { sendPushToMembers } from './web-push.js'
import { sendLocalizedPush } from './push-i18n.js'
import { FRONTEND_URL } from './email-template.js'

export const ACTIVITY = {
  game: { collection: 'games', fk: 'game' },
  training: { collection: 'trainings', fk: 'training' },
  event: { collection: 'events', fk: 'event' },
}

export const KINDS = ['offer', 'request']
export const DIRECTIONS = ['there', 'back']
/** Days a ride may leave before the activity's first / after its last day. */
export const DATE_SLACK_DAYS = 7
export const MAX_SEATS = 8
const MAX_LOCATION = 200
const MAX_NOTES = 500
const UPCOMING_DAYS = 21

const httpError = (status, message, code) => Object.assign(new Error(message), { status, code })
const idParam = (v) => (/^\d+$/.test(String(v ?? '')) ? Number(v) : null)

/** 'HH:MM' or 'HH:MM:SS' (24h) → 'HH:MM', else null. */
export function normalizeTime(raw) {
  const s = String(raw ?? '').trim()
  const m = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(s)
  return m ? `${m[1]}:${m[2]}` : null
}

/** 'YYYY-MM-DD' (a real calendar day) → itself, else null. */
export function normalizeDate(raw) {
  const s = String(raw ?? '').trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(`${s}T12:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null
}

const addDays = (ymdStr, n) => new Date(Date.parse(`${ymdStr}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10)

/**
 * The departure day a ride gets when none is sent: Going leaves on the
 * activity's first day, Return on its last.
 */
export function defaultRideDate(info, direction) {
  return (direction === 'back' ? info.last_date || info.date : info.date) ?? null
}

/**
 * Is `date` a sensible day for this way? Going: not after the activity's last
 * day, at most DATE_SLACK_DAYS before its first. Return: not before its first
 * day, at most DATE_SLACK_DAYS after its last.
 */
export function rideDateAllowed(info, direction, date) {
  if (!date || !info.date) return true
  const first = info.date
  const last = info.last_date || first
  if (direction === 'back') return date >= first && date <= addDays(last, DATE_SLACK_DAYS)
  return date <= last && date >= addDays(first, -DATE_SLACK_DAYS)
}

function seatsParam(raw, field = 'seats') {
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1 || n > MAX_SEATS) {
    throw httpError(400, `${field} must be a whole number from 1 to ${MAX_SEATS}`, 'invalid_seats')
  }
  return n
}

function optionalText(raw, max) {
  if (raw == null) return null
  const s = String(raw).replace(/\s+/g, ' ').trim()
  return s ? s.slice(0, max) : null
}

/**
 * Validate an offer/request body. `partial` (PATCH) validates only the keys
 * present and never accepts `kind` or `direction` — an offer does not turn into
 * a request, and a Going ride does not move to the Return board.
 */
export function parseEntryInput(body, { partial = false } = {}) {
  const b = body && typeof body === 'object' ? body : {}
  const out = {}
  if (!partial) {
    if (!KINDS.includes(b.kind)) throw httpError(400, 'kind must be offer or request', 'invalid_kind')
    out.kind = b.kind
  }
  if (!partial) {
    const d = b.direction ?? 'there'
    if (!DIRECTIONS.includes(d)) throw httpError(400, 'direction must be there or back', 'invalid_direction')
    out.direction = d
  }
  if (!partial || 'seats' in b) out.seats = seatsParam(b.seats ?? 1)
  if (!partial || 'departure_time' in b) {
    if (b.departure_time == null || b.departure_time === '') out.departure_time = null
    else {
      const t = normalizeTime(b.departure_time)
      if (!t) throw httpError(400, 'departure_time must be HH:MM', 'invalid_time')
      out.departure_time = t
    }
  }
  if (!partial || 'departure_date' in b) {
    if (b.departure_date == null || b.departure_date === '') out.departure_date = null
    else {
      const d = normalizeDate(b.departure_date)
      if (!d) throw httpError(400, 'departure_date must be YYYY-MM-DD', 'invalid_date')
      out.departure_date = d
    }
  }
  if (!partial || 'teams' in b) {
    const teams = parseScope(b.teams)
    out.teams = teams.length ? JSON.stringify(teams) : null
  }
  if (!partial || 'departure_location' in b) out.departure_location = optionalText(b.departure_location, MAX_LOCATION)
  if (!partial || 'notes' in b) out.notes = optionalText(b.notes, MAX_NOTES)
  // Team choice is a driver's; a request is simply for whoever can drive.
  if (!partial && out.kind === 'request') out.teams = null
  // An offer with no meeting point is not actionable for anyone reading it.
  if (!partial && out.kind === 'offer' && !out.departure_location) {
    throw httpError(400, 'An offer needs a meeting point', 'missing_location')
  }
  return out
}

/** Postgres errors from migration 378's constraints/triggers → HTTP. */
export function mapCarpoolError(err) {
  const msg = String(err?.message ?? '')
  for (const code of ['carpool_full', 'carpool_seats_below_taken', 'carpool_driver_is_passenger', 'carpool_not_an_offer']) {
    if (msg.includes(code)) return httpError(409, code, code)
  }
  if (err?.code === '23505') {
    if (/carpool_passengers_pair_uq/.test(msg)) return httpError(409, 'Already in this car', 'carpool_already_passenger')
    return httpError(409, 'You already have an entry of this kind here', 'carpool_duplicate')
  }
  return err
}

/** Today in Zurich as YYYY-MM-DD. */
export function zurichToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

const ymd = (v) => {
  if (v == null) return null
  if (v instanceof Date) return zurichToday(v)
  return String(v).slice(0, 10) || null
}

/** `carpool_teams` (jsonb array, or its JSON text) → unique positive team ids. */
export function parseScope(raw) {
  let v = raw
  if (typeof v === 'string') { try { v = JSON.parse(v) } catch { return [] } }
  if (!Array.isArray(v)) return []
  return [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n > 0))]
}

/** Empty scope = open to all who can see the activity; else any team in common. */
export function scopeAllows(scope, myTeamIds) {
  if (!scope?.length) return true
  const mine = new Set([...(myTeamIds ?? [])].map(Number))
  return scope.some((t) => mine.has(Number(t)))
}

/**
 * The teams a board is for, or null = everyone who can read the activity.
 * An explicit `carpool_teams` scope wins; an unscoped GAME falls back to its
 * own team + guest teams, because `games` is readable club-wide (audit
 * 2026-09-28 F21). An unscoped TRAINING falls back to its team: the trainings
 * read policy lets a coach/TR seat on an ARCHIVED team read that team's old
 * sessions (COACH_OR_TR_OF_TEAM has no active filter), and `teamsOf` is
 * active-gated, so this cuts the residue seat out. Events: their read policy
 * is the audience.
 */
export function effectiveScope(type, scope, activityTeams = []) {
  if (scope?.length) return scope
  if ((type === 'game' || type === 'training') && activityTeams?.length) return activityTeams
  return null
}

/**
 * Normalise an activity row (as read by knex) into what the board needs:
 * the date the ride is for, its last day (writes close after it), a label and
 * whether it is still open for new rides.
 */
export function describeActivity(type, row, { teamName = null, today = zurichToday() } = {}) {
  let date = null; let lastDate = null; let time = null; let label = ''; let cancelled = false
  if (type === 'game') {
    date = ymd(row.date); lastDate = date
    time = row.time ? String(row.time).slice(0, 5) : null
    label = [row.home_team, row.away_team].filter(Boolean).join(' – ')
    cancelled = row.status === 'cancelled' || row.status === 'postponed'
  } else if (type === 'training') {
    date = ymd(row.date); lastDate = date
    time = row.start_time ? String(row.start_time).slice(0, 5) : null
    label = teamName || ''
    cancelled = row.cancelled === true
  } else {
    // timestamptz → the Zurich calendar day, not the UTC one.
    date = ymd(row.start_date)
    lastDate = ymd(row.end_date) || date
    time = row.all_day || !(row.start_date instanceof Date)
      ? null
      : new Intl.DateTimeFormat('de-CH', { timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit', hour12: false }).format(row.start_date)
    label = row.title || ''
    cancelled = row.cancelled === true
  }
  const past = !!lastDate && lastDate < today
  return {
    type,
    id: Number(row.id),
    label,
    team: teamName,
    date,
    last_date: lastDate,
    time,
    enabled: row.carpool_enabled === true,
    scope: parseScope(row.carpool_teams),
    cancelled,
    past,
    open: row.carpool_enabled === true && !cancelled && !past,
  }
}

/**
 * Build the board from raw rows: one leg per way (393). Pure — unit-tested.
 * `totals` sums both legs, for the banner.
 */
export function buildBoard(entries, passengers, me, opts = {}) {
  const there = buildLeg(entries.filter((e) => e.direction !== 'back'), passengers, me, opts)
  const back = buildLeg(entries.filter((e) => e.direction === 'back'), passengers, me, opts)
  return {
    there,
    back,
    totals: {
      offers: there.totals.offers + back.totals.offers,
      seats_free: there.totals.seats_free + back.totals.seats_free,
      requests_open: there.totals.requests_open + back.totals.requests_open,
    },
  }
}

/**
 * One way's board (Going or Return) from raw rows. Pure — unit-tested.
 *   entries:    carpools rows joined with the member's name
 *   passengers: carpool_passengers rows joined with the passenger's name
 *   me:         the acting member id (or null)
 * Offers carry seats_taken / seats_free / passengers; a request is `covered`
 * once its requester sits in any offered car of the activity.
 */
export function buildLeg(entries, passengers, me, { myTeams = [], admin = false } = {}) {
  const meId = me != null ? Number(me) : null
  const person = (r, prefix) => ({
    id: Number(r[`${prefix}id`]),
    first_name: r[`${prefix}first_name`] ?? '',
    last_name: r[`${prefix}last_name`] ?? '',
    nickname: r[`${prefix}nickname`] ?? null,
  })

  const byOffer = new Map()
  for (const p of passengers) {
    const k = Number(p.carpool)
    if (!byOffer.has(k)) byOffer.set(k, [])
    byOffer.get(k).push(p)
  }

  const offers = []
  const requests = []
  const riding = new Map() // passenger member id → [driver person]
  const myCars = new Set() // offer ids I sit in
  for (const e of entries) {
    if (e.kind !== 'offer') continue
    const driver = person(e, 'm_')
    for (const p of byOffer.get(Number(e.id)) ?? []) {
      const pid = Number(p.passenger)
      if (!riding.has(pid)) riding.set(pid, [])
      riding.get(pid).push(driver)
      if (pid === meId) myCars.add(Number(e.id))
    }
  }

  for (const e of entries) {
    const owner = person(e, 'm_')
    const mine = meId != null && owner.id === meId
    const teams = parseScope(e.teams)
    // An offer for other teams (380): hidden unless it is mine or I sit in it.
    if (e.kind === 'offer' && teams.length && !admin && !mine
      && !myCars.has(Number(e.id)) && !scopeAllows(teams, myTeams)) continue
    const base = {
      id: Number(e.id),
      kind: e.kind,
      member: owner,
      direction: e.direction,
      seats: Number(e.seats),
      departure_date: ymd(e.departure_date),
      departure_time: e.departure_time ? String(e.departure_time).slice(0, 5) : null,
      teams,
      departure_location: e.departure_location ?? null,
      notes: e.notes ?? null,
      mine,
      date_created: e.date_created,
    }
    if (e.kind === 'offer') {
      const inCar = myCars.has(Number(e.id))
      const rows = byOffer.get(Number(e.id)) ?? []
      const taken = rows.reduce((s, p) => s + Number(p.seats || 1), 0)
      offers.push({
        ...base,
        seats_taken: taken,
        seats_free: Math.max(0, Number(e.seats) - taken),
        i_am_passenger: inCar,
        passengers: rows.map((p) => ({
          id: Number(p.id),
          seats: Number(p.seats || 1),
          added_by_name: p.added_by_name ?? null,
          member: person(p, 'p_'),
        })),
      })
    } else {
      const drivers = riding.get(owner.id) ?? []
      requests.push({ ...base, covered: drivers.length > 0, covered_by: drivers.map((d) => ({ id: d.id, first_name: d.first_name, last_name: d.last_name, nickname: d.nickname })) })
    }
  }

  const byTime = (a, b) => String(a.departure_date ?? '9999').localeCompare(String(b.departure_date ?? '9999'))
    || String(a.departure_time ?? '99').localeCompare(String(b.departure_time ?? '99')) || a.id - b.id
  offers.sort(byTime)
  requests.sort((a, b) => Number(a.covered) - Number(b.covered) || byTime(a, b))

  return {
    offers,
    requests,
    totals: {
      offers: offers.length,
      seats_free: offers.reduce((s, o) => s + o.seats_free, 0),
      requests_open: requests.filter((r) => !r.covered).length,
    },
    mine: {
      offer: offers.find((o) => o.mine)?.id ?? null,
      request: requests.find((r) => r.mine)?.id ?? null,
      riding_in: [...myCars],
    },
  }
}

const FORBIDDEN_NAMES = new Set(['ForbiddenError', 'ForbiddenException'])
const isForbidden = (e) => FORBIDDEN_NAMES.has(e?.name) || e?.code === 'FORBIDDEN' || e?.status === 403

export function registerCarpools(router, { services, database, logger, getSchema }) {
  const log = logger.child({ endpoint: 'carpools' })
  const { ItemsService } = services

  const fail = (res, err, route) => {
    const e = mapCarpoolError(err)
    const status = e?.status || 500
    if (status >= 500) log.error({ msg: `${route} failed: ${e?.message}`, stack: e?.stack })
    res.status(status).json({ error: status >= 500 ? 'Internal error' : e.message, code: e?.code })
  }

  const requireSession = (req) => {
    if (!req.accountability?.user && !req.accountability?.admin) throw httpError(401, 'Authentication required')
  }

  async function actingMember(req) {
    const userId = req.accountability?.user
    if (!userId) return null
    return database('members').where('user', userId).first('id', 'first_name', 'last_name', 'nickname')
  }

  async function requireMember(req) {
    const m = await actingMember(req)
    if (!m) throw httpError(403, 'Only club members can use car pooling', 'no_member')
    return m
  }

  /**
   * Team ids a member belongs to for scoping: active rosters + coach + TR.
   * Every leg is gated on `teams.active` — a coach/TR seat on an archived team
   * is residue, not a current audience (audit 2026-09-28 F31).
   */
  async function teamsOf(memberId) {
    const [playTeams, coachTeams, trTeams] = await Promise.all([
      database('member_teams as mt').join('teams as t', 't.id', 'mt.team').where('mt.member', memberId).where('t.active', true).pluck('mt.team'),
      database('teams_coaches as tc').join('teams as t', 't.id', 'tc.teams_id').where('tc.members_id', memberId).where('t.active', true).pluck('tc.teams_id'),
      database('teams_responsibles as tr').join('teams as t', 't.id', 'tr.teams_id').where('tr.members_id', memberId).where('t.active', true).pluck('tr.teams_id'),
    ])
    return [...new Set([...playTeams, ...coachTeams, ...trTeams].filter((x) => x != null).map(Number))]
  }

  /** Does the caller already have a ride (entry or seat) on this activity? */
  async function isInvolved(type, id, memberId) {
    const fk = ACTIVITY[type].fk
    const row = await database('carpools as c')
      .leftJoin('carpool_passengers as p', 'p.carpool', 'c.id')
      .where(`c.${fk}`, id)
      .where((q) => q.where('c.member', memberId).orWhere('p.passenger', memberId))
      .first('c.id')
    return !!row
  }

  /**
   * The implicit audience of an UNSCOPED game/training board (audit 2026-09-28
   * F21): a game's own team + its guest teams, a training's team. `games` is
   * readable club-wide, so "whoever may read the activity" made every away
   * game's board — minors' pickup points and notes included — readable and
   * writable by any member; the trainings policy still admits a stale
   * coach/TR seat on an archived team. Events need no such step: their read
   * policy is already audience-scoped. Empty (no team) = open, as before.
   */
  async function audienceTeams(act) {
    if (act.type === 'training') return act.teamId != null ? [Number(act.teamId)] : []
    if (act.type !== 'game') return []
    const guests = await database('game_guest_teams').where('game', act.id).pluck('team')
    return [...new Set([act.teamId, ...guests].filter((x) => x != null).map(Number))]
  }

  /**
   * Scope check (migration 379). Admins pass. A scoped board is for its teams;
   * an unscoped game board for the game's teams + individually invited guests
   * (`game_guests`); an unscoped training board for its (active) team;
   * anything else for whoever can read it. Having a ride on
   * the activity already always keeps you in.
   */
  async function inScope(req, act, me) {
    if (req.accountability?.admin === true) return true
    const teams = effectiveScope(act.type, act.info.scope, act.info.scope.length ? [] : await audienceTeams(act))
    if (!teams) return true
    if (!me) return false
    if (scopeAllows(teams, await teamsOf(me.id))) return true
    if (act.type === 'game' && !act.info.scope.length
      && (await database('game_guests').where({ game: act.id, member: me.id }).first('id'))) return true
    return isInvolved(act.type, act.id, me.id)
  }

  async function assertInScope(req, act, me) {
    if (!(await inScope(req, act, me))) {
      throw httpError(403, 'Car pooling for this activity is open to other teams', 'carpool_not_in_scope')
    }
  }

  /** Names for the "open to" line on the banner. */
  async function scopeTeams(scope) {
    if (!scope.length) return []
    const rows = await database('teams').whereIn('id', scope).select('id', 'name', 'sport')
    return rows.map((r) => ({ id: Number(r.id), name: r.name, sport: r.sport ?? null }))
  }

  /**
   * Can the caller read this activity? ItemsService under the caller's own
   * accountability — the existing read policy is the answer. 404 either way
   * (not found / not visible), so ids cannot be probed.
   */
  async function assertVisible(req, type, id) {
    if (req.accountability?.admin) return
    const schema = await getSchema()
    const svc = new ItemsService(ACTIVITY[type].collection, { schema, accountability: req.accountability })
    try {
      const row = await svc.readOne(id, { fields: ['id'] })
      if (!row) throw httpError(404, 'Activity not found')
    } catch (e) {
      if (e?.status === 404 || isForbidden(e)) throw httpError(404, 'Activity not found')
      throw e
    }
  }

  async function loadActivity(type, id) {
    const def = ACTIVITY[type]
    if (!def) throw httpError(400, 'Unknown activity type')
    const row = await database(def.collection).where('id', id).first()
    if (!row) throw httpError(404, 'Activity not found')
    let teamName = null
    const teamId = type === 'game' ? row.kscw_team : type === 'training' ? row.team : null
    if (teamId != null) teamName = (await database('teams').where('id', teamId).first('name'))?.name ?? null
    return { row, teamId: teamId != null ? Number(teamId) : null, info: describeActivity(type, row, { teamName }) }
  }

  /** Visible + loaded, from route params. */
  async function activityFromParams(req) {
    const type = String(req.params.type)
    if (!ACTIVITY[type]) throw httpError(400, 'Unknown activity type')
    const id = idParam(req.params.id)
    if (id == null) throw httpError(400, 'Invalid id')
    await assertVisible(req, type, id)
    return { type, id, ...(await loadActivity(type, id)) }
  }

  /** The carpool row + its activity, visible to the caller. */
  async function entryFromParams(req, param = 'entryId') {
    const entryId = idParam(req.params[param])
    if (entryId == null) throw httpError(400, 'Invalid id')
    const entry = await database('carpools').where('id', entryId).first()
    if (!entry) throw httpError(404, 'Ride not found')
    const type = entry.game != null ? 'game' : entry.training != null ? 'training' : 'event'
    const id = Number(entry[ACTIVITY[type].fk])
    await assertVisible(req, type, id)
    return { entry, type, id, ...(await loadActivity(type, id)) }
  }

  const assertRideDate = (info, direction, date) => {
    if (!rideDateAllowed(info, direction, date)) {
      throw httpError(400, 'That day does not fit this activity', 'carpool_invalid_date')
    }
  }

  const assertOpen = (info) => {
    if (!info.enabled) throw httpError(409, 'Car pooling is not enabled for this activity', 'carpool_disabled')
    if (info.cancelled) throw httpError(409, 'This activity is cancelled', 'carpool_closed')
    if (info.past) throw httpError(409, 'This activity is over', 'carpool_closed')
  }

  async function board(type, id, meId, { admin = false } = {}) {
    const fk = ACTIVITY[type].fk
    const entries = await database('carpools as c')
      .join('members as m', 'm.id', 'c.member')
      .where(`c.${fk}`, id)
      .orderBy('c.id')
      .select('c.*', 'm.id as m_id', 'm.first_name as m_first_name', 'm.last_name as m_last_name',
        'm.nickname as m_nickname')
    const offerIds = entries.filter((e) => e.kind === 'offer').map((e) => e.id)
    const passengers = offerIds.length
      ? await database('carpool_passengers as p')
        .join('members as m', 'm.id', 'p.passenger')
        .whereIn('p.carpool', offerIds)
        .orderBy('p.id')
        .select('p.*', 'm.id as p_id', 'm.first_name as p_first_name', 'm.last_name as p_last_name',
          'm.nickname as p_nickname')
      : []
    const myTeams = meId != null ? await teamsOf(meId) : []
    return buildBoard(entries, passengers, meId, { myTeams, admin })
  }

  /**
   * The teams a ride can be offered to (380): the board's scope when set,
   * else the activity's own teams — a game's playing team + guest teams, an
   * event's invited teams (a club-wide event: none, i.e. no picker), a
   * training's one team.
   */
  async function activityTeams(act) {
    let ids = act.info.scope
    if (!ids.length) {
      if (act.type === 'game') {
        const guests = await database('game_guest_teams').where('game', act.id).pluck('team')
        ids = [act.teamId, ...guests]
      } else if (act.type === 'training') {
        ids = [act.teamId]
      } else {
        ids = await database('events_teams').where('events_id', act.id).pluck('teams_id')
      }
    }
    ids = [...new Set(ids.filter((x) => x != null).map(Number))]
    return scopeTeams(ids)
  }

  /** Offer teams must be a subset of the activity's teams (when it has any). */
  async function assertOfferTeams(act, teamsJson) {
    const chosen = parseScope(teamsJson)
    if (!chosen.length) return
    const allowed = new Set((await activityTeams(act)).map((t) => t.id))
    if (allowed.size && chosen.some((t) => !allowed.has(t))) {
      throw httpError(400, 'A ride can only be offered to the teams invited', 'carpool_invalid_teams')
    }
  }

  /** Is this member inside an offer's team choice? */
  async function offerAllows(offer, memberId) {
    const teams = parseScope(offer.teams)
    return !teams.length || scopeAllows(teams, await teamsOf(memberId))
  }

  const displayName = (m) => [((m?.nickname || '').trim() || m?.first_name), m?.last_name].filter(Boolean).join(' ')

  /** In-app notification + localized push to `memberIds`. Never throws. */
  async function notify(memberIds, key, act, vars) {
    const ids = [...new Set(memberIds.filter((x) => x != null).map(Number))]
    if (!ids.length) return
    try {
      const { info, teamId } = act
      const activity = [info.label, info.date ? info.date.split('-').reverse().join('.') : null].filter(Boolean).join(', ')
      const payload = { ...vars, activity }
      await database('notifications').insert(ids.map((member) => ({
        member,
        type: 'carpool_update',
        title: key,
        body: JSON.stringify(payload),
        activity_type: info.type,
        activity_id: String(info.id),
        team: teamId,
        read: false,
      })))
      const url = `${FRONTEND_URL}/carpool/${info.type}/${info.id}`
      await sendLocalizedPush(
        database, ids,
        (bucket, title, body) => sendPushToMembers(database, bucket, title, body, url, `carpool-${info.type}-${info.id}`, log),
        'carpool.title', `${key}.push`, payload,
      )
    } catch (e) {
      log.warn({ msg: `carpool notify failed: ${e.message}`, key })
    }
  }

  // ── Home: enabled, upcoming activities that concern me ─────────────────────
  // "Concern me" = a game/training of a team I play for, coach or lead; an
  // event I can read (the events read policy is already audience-scoped); or
  // any activity where I already have a ride entry or a seat. Games are
  // readable club-wide, so the policy alone would put every team's away game
  // on everyone's Home — hence the team scoping for games/trainings.
  router.get('/carpools/upcoming', async (req, res) => {
    try {
      requireSession(req)
      const me = await actingMember(req)
      if (!me) return res.json({ data: [] })

      const today = zurichToday()
      const until = zurichToday(new Date(Date.now() + UPCOMING_DAYS * 86400000))

      const teamIds = await teamsOf(me.id)

      // Activities I'm already in, whatever the team.
      const involved = await database('carpools as c')
        .leftJoin('carpool_passengers as p', 'p.carpool', 'c.id')
        .where((q) => q.where('c.member', me.id).orWhere('p.passenger', me.id))
        .select('c.game', 'c.training', 'c.event')
      const invIds = { game: new Set(), training: new Set(), event: new Set() }
      for (const r of involved) for (const k of Object.keys(invIds)) if (r[k] != null) invIds[k].add(Number(r[k]))

      const games = await database('games')
        .where('carpool_enabled', true)
        .whereBetween('date', [today, until])
        .whereNotIn('status', ['cancelled', 'postponed'])
        .where((q) => {
          q.whereIn('kscw_team', teamIds.length ? teamIds : [-1])
          if (invIds.game.size) q.orWhereIn('id', [...invIds.game])
        })
        .select('*')
      const trainings = await database('trainings')
        .where('carpool_enabled', true)
        .whereBetween('date', [today, until])
        .where('cancelled', false)
        .where((q) => {
          q.whereIn('team', teamIds.length ? teamIds : [-1])
          if (invIds.training.size) q.orWhereIn('id', [...invIds.training])
        })
        .select('*')
      // Events: the read policy decides, through ItemsService (scalar filters
      // only — no M2M walk here, so no deep-filter trap).
      const schema = await getSchema()
      const eventSvc = new ItemsService('events', { schema, accountability: req.accountability })
      const visibleEvents = await eventSvc.readByQuery({
        filter: { _and: [{ carpool_enabled: { _eq: true } }, { cancelled: { _eq: false } }] },
        fields: ['id'],
        limit: 200,
      })
      const eventIds = visibleEvents.map((e) => Number(e.id))
      const events = eventIds.length
        ? await database('events').whereIn('id', eventIds)
          .whereRaw(`(COALESCE(end_date, start_date) AT TIME ZONE 'Europe/Zurich')::date >= ?::date`, [today])
          .whereRaw(`(start_date AT TIME ZONE 'Europe/Zurich')::date <= ?::date`, [until])
          .select('*')
        : []

      const teamNames = new Map()
      const tIds = [...new Set([...games.map((g) => g.kscw_team), ...trainings.map((t) => t.team)].filter((x) => x != null))]
      if (tIds.length) for (const t of await database('teams').whereIn('id', tIds).select('id', 'name')) teamNames.set(Number(t.id), t.name)

      const acts = [
        ...games.map((r) => describeActivity('game', r, { teamName: teamNames.get(Number(r.kscw_team)) ?? null, today })),
        ...trainings.map((r) => describeActivity('training', r, { teamName: teamNames.get(Number(r.team)) ?? null, today })),
        ...events.map((r) => describeActivity('event', r, { today })),
      ]
        .filter((a) => a.open)
        // Scoped boards (379): only for the chosen teams, or someone already riding.
        .filter((a) => scopeAllows(a.scope, teamIds) || invIds[a.type].has(a.id))

      // Totals for every listed activity in two queries.
      const counts = new Map()
      const keyOf = (r) => (r.game != null ? `game:${r.game}` : r.training != null ? `training:${r.training}` : `event:${r.event}`)
      // Riders per activity AND way (393): a Going seat does not cover a Return request.
      const legKey = (r) => `${keyOf(r)}:${r.direction === 'back' ? 'back' : 'there'}`
      const byType = { game: [], training: [], event: [] }
      for (const a of acts) byType[a.type].push(a.id)
      if (acts.length) {
        const rows = await database('carpools as c')
          .where((q) => {
            q.whereIn('c.game', byType.game.length ? byType.game : [-1])
              .orWhereIn('c.training', byType.training.length ? byType.training : [-1])
              .orWhereIn('c.event', byType.event.length ? byType.event : [-1])
          })
          .select('c.*')
        const offerIds = rows.filter((r) => r.kind === 'offer').map((r) => r.id)
        const pax = offerIds.length ? await database('carpool_passengers').whereIn('carpool', offerIds).select('carpool', 'passenger', 'seats') : []
        const taken = new Map(); const ridersByAct = new Map()
        const offerAct = new Map(rows.filter((r) => r.kind === 'offer').map((r) => [Number(r.id), legKey(r)]))
        for (const p of pax) {
          taken.set(Number(p.carpool), (taken.get(Number(p.carpool)) ?? 0) + Number(p.seats || 1))
          const k = offerAct.get(Number(p.carpool))
          if (!ridersByAct.has(k)) ridersByAct.set(k, new Set())
          ridersByAct.get(k).add(Number(p.passenger))
        }
        for (const r of rows) {
          const k = keyOf(r)
          const c = counts.get(k) ?? { offers: 0, seats_free: 0, requests_open: 0, my_role: null }
          const riders = ridersByAct.get(legKey(r)) ?? new Set()
          // Offers for other teams (380) are not this member's to count.
          const forMe = r.kind !== 'offer' || Number(r.member) === Number(me.id)
            || scopeAllows(parseScope(r.teams), teamIds) || riders.has(Number(me.id))
          if (r.kind === 'offer' && !forMe) { counts.set(k, c); continue }
          if (r.kind === 'offer') {
            c.offers += 1
            c.seats_free += Math.max(0, Number(r.seats) - (taken.get(Number(r.id)) ?? 0))
            if (Number(r.member) === Number(me.id)) c.my_role = 'driver'
          } else {
            if (!riders.has(Number(r.member))) c.requests_open += 1
            if (Number(r.member) === Number(me.id) && !c.my_role) c.my_role = riders.has(Number(me.id)) ? 'passenger' : 'requester'
          }
          if (riders.has(Number(me.id)) && c.my_role !== 'driver') c.my_role = 'passenger'
          counts.set(k, c)
        }
      }

      const data = acts
        .map((a) => ({ ...a, ...(counts.get(`${a.type}:${a.id}`) ?? { offers: 0, seats_free: 0, requests_open: 0, my_role: null }) }))
        .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.time ?? '').localeCompare(String(b.time ?? '')))
      res.json({ data })
    } catch (err) { fail(res, err, 'GET carpools/upcoming') }
  })

  // ── Entry routes (registered before /:type/:id so "entries" is never a type) ─

  router.patch('/carpools/entries/:entryId', async (req, res) => {
    try {
      requireSession(req)
      const me = await requireMember(req)
      const act = await entryFromParams(req)
      if (Number(act.entry.member) !== Number(me.id)) throw httpError(403, 'Not your ride')
      assertOpen(act.info)
      await assertInScope(req, act, me)
      const patch = parseEntryInput(req.body, { partial: true })
      if (!Object.keys(patch).length) throw httpError(400, 'Nothing to update')
      if (act.entry.kind === 'offer' && 'departure_location' in patch && !patch.departure_location) {
        throw httpError(400, 'An offer needs a meeting point', 'missing_location')
      }
      if (act.entry.kind === 'request') delete patch.teams
      else if ('teams' in patch) await assertOfferTeams(act, patch.teams)
      if ('departure_date' in patch) {
        patch.departure_date ??= defaultRideDate(act.info, act.entry.direction)
        assertRideDate(act.info, act.entry.direction, patch.departure_date)
      }
      await database('carpools').where('id', act.entry.id).update(patch)
      await writeUserLog(database, log, {
        accountability: req.accountability, action: 'update', collection: 'carpools',
        recordId: act.entry.id, data: { ...patch, [act.type]: act.id },
      })
      res.json({ data: await board(act.type, act.id, me.id) })
    } catch (err) { fail(res, err, 'PATCH carpools/entries') }
  })

  router.delete('/carpools/entries/:entryId', async (req, res) => {
    try {
      requireSession(req)
      const me = await actingMember(req)
      const act = await entryFromParams(req)
      const own = me && Number(act.entry.member) === Number(me.id)
      if (!own && req.accountability?.admin !== true) throw httpError(403, 'Not your ride')
      const riders = act.entry.kind === 'offer'
        ? await database('carpool_passengers').where('carpool', act.entry.id).pluck('passenger')
        : []
      await database('carpools').where('id', act.entry.id).del()
      await writeUserLog(database, log, {
        accountability: req.accountability, action: 'delete', collection: 'carpools',
        recordId: act.entry.id, data: { kind: act.entry.kind, member: act.entry.member, [act.type]: act.id, passengers: riders },
      })
      if (riders.length) {
        const owner = own ? me : await database('members').where('id', act.entry.member).first('first_name', 'last_name', 'nickname')
        await notify(riders, 'carpool_cancelled', act, { name: displayName(owner) })
      }
      res.json({ data: await board(act.type, act.id, me?.id ?? null) })
    } catch (err) { fail(res, err, 'DELETE carpools/entries') }
  })

  router.post('/carpools/entries/:entryId/join', async (req, res) => {
    try {
      requireSession(req)
      const me = await requireMember(req)
      const act = await entryFromParams(req)
      if (act.entry.kind !== 'offer') throw httpError(400, 'You can only join an offered ride')
      assertOpen(act.info)
      await assertInScope(req, act, me)
      if (!(await offerAllows(act.entry, me.id))) {
        throw httpError(403, 'This ride is offered to other teams', 'carpool_offer_other_teams')
      }
      const seats = seatsParam(req.body?.seats ?? 1)
      const [row] = await database('carpool_passengers')
        .insert({ carpool: act.entry.id, passenger: me.id, seats, added_by_name: displayName(me) })
        .returning('id')
      await writeUserLog(database, log, {
        accountability: req.accountability, action: 'create', collection: 'carpool_passengers',
        recordId: row?.id ?? row, data: { carpool: act.entry.id, passenger: me.id, seats, [act.type]: act.id },
      })
      // The driver hears about every taken seat, with what is left — and a
      // distinct "car is full" message when this was the last one.
      const taken = Number((await database('carpool_passengers').where('carpool', act.entry.id).sum('seats as n').first())?.n ?? 0)
      const free = Math.max(0, Number(act.entry.seats) - taken)
      await notify([act.entry.member], free === 0 ? 'carpool_joined_full' : 'carpool_joined', act, { name: displayName(me), seats, free })
      res.json({ data: await board(act.type, act.id, me.id) })
    } catch (err) { fail(res, err, 'POST carpools/join') }
  })

  router.delete('/carpools/entries/:entryId/join', async (req, res) => {
    try {
      requireSession(req)
      const me = await requireMember(req)
      const act = await entryFromParams(req)
      const n = await database('carpool_passengers').where({ carpool: act.entry.id, passenger: me.id }).del()
      if (!n) throw httpError(404, 'You are not in this car')
      await writeUserLog(database, log, {
        accountability: req.accountability, action: 'delete', collection: 'carpool_passengers',
        recordId: act.entry.id, data: { carpool: act.entry.id, passenger: me.id, [act.type]: act.id },
      })
      await notify([act.entry.member], 'carpool_left', act, { name: displayName(me) })
      res.json({ data: await board(act.type, act.id, me.id) })
    } catch (err) { fail(res, err, 'DELETE carpools/join') }
  })

  // Driver takes a request: the requester becomes a passenger in the driver's
  // own offer for the same activity, with the seats they asked for.
  router.post('/carpools/entries/:entryId/take', async (req, res) => {
    try {
      requireSession(req)
      const me = await requireMember(req)
      const act = await entryFromParams(req)
      if (act.entry.kind !== 'request') throw httpError(400, 'Only a request can be taken')
      assertOpen(act.info)
      await assertInScope(req, act, me)
      const fk = ACTIVITY[act.type].fk
      // Only into my car for the same way (393): a Going request is not a Return seat.
      const offer = await database('carpools').where({ [fk]: act.id, kind: 'offer', member: me.id, direction: act.entry.direction }).first()
      if (!offer) throw httpError(409, 'Offer a ride first, then take requests into your car', 'carpool_no_offer')
      if (!(await offerAllows(offer, act.entry.member))) {
        throw httpError(409, 'Your ride is offered to other teams than this person\'s', 'carpool_offer_other_teams')
      }
      const requester = await database('members').where('id', act.entry.member).first('id', 'first_name', 'last_name', 'nickname')
      const [row] = await database('carpool_passengers')
        .insert({ carpool: offer.id, passenger: act.entry.member, seats: Number(act.entry.seats) || 1, added_by_name: displayName(me) })
        .returning('id')
      await writeUserLog(database, log, {
        accountability: req.accountability, action: 'create', collection: 'carpool_passengers',
        recordId: row?.id ?? row, data: { carpool: offer.id, passenger: act.entry.member, request: act.entry.id, [act.type]: act.id },
      })
      await notify([act.entry.member], 'carpool_taken', act, { name: displayName(me), passenger: displayName(requester) })
      res.json({ data: await board(act.type, act.id, me.id) })
    } catch (err) { fail(res, err, 'POST carpools/take') }
  })

  router.delete('/carpools/passengers/:pid', async (req, res) => {
    try {
      requireSession(req)
      const me = await requireMember(req)
      const pid = idParam(req.params.pid)
      if (pid == null) throw httpError(400, 'Invalid id')
      const p = await database('carpool_passengers').where('id', pid).first()
      if (!p) throw httpError(404, 'Passenger not found')
      req.params.entryId = String(p.carpool)
      const act = await entryFromParams(req)
      if (Number(act.entry.member) !== Number(me.id)) throw httpError(403, 'Not your car')
      await database('carpool_passengers').where('id', pid).del()
      await writeUserLog(database, log, {
        accountability: req.accountability, action: 'delete', collection: 'carpool_passengers',
        recordId: pid, data: { carpool: act.entry.id, passenger: p.passenger, removed_by_driver: true, [act.type]: act.id },
      })
      await notify([p.passenger], 'carpool_removed', act, { name: displayName(me) })
      res.json({ data: await board(act.type, act.id, me.id) })
    } catch (err) { fail(res, err, 'DELETE carpools/passengers') }
  })

  // ── Activity board ─────────────────────────────────────────────────────────

  router.get('/carpools/:type/:id', async (req, res) => {
    try {
      requireSession(req)
      const act = await activityFromParams(req)
      const me = await actingMember(req)
      const scope_teams = await scopeTeams(act.info.scope)
      if (!(await inScope(req, act, me))) {
        return res.json({ activity: act.info, data: buildBoard([], [], null), me: me?.id ?? null, in_scope: false, scope_teams })
      }
      const data = act.info.enabled || (await database('carpools').where(ACTIVITY[act.type].fk, act.id).first('id'))
        ? await board(act.type, act.id, me?.id ?? null, { admin: req.accountability?.admin === true })
        : buildBoard([], [], null)
      const activity_teams = await activityTeams(act)
      res.json({ activity: act.info, data, me: me?.id ?? null, in_scope: true, scope_teams, activity_teams })
    } catch (err) { fail(res, err, 'GET carpools/:type/:id') }
  })

  router.post('/carpools/:type/:id', async (req, res) => {
    try {
      requireSession(req)
      const me = await requireMember(req)
      const act = await activityFromParams(req)
      assertOpen(act.info)
      await assertInScope(req, act, me)
      const input = parseEntryInput(req.body)
      if (input.kind === 'offer') await assertOfferTeams(act, input.teams)
      input.departure_date ??= defaultRideDate(act.info, input.direction)
      assertRideDate(act.info, input.direction, input.departure_date)
      const [row] = await database('carpools')
        .insert({ ...input, member: me.id, [ACTIVITY[act.type].fk]: act.id })
        .returning('id')
      const entryId = row?.id ?? row
      await writeUserLog(database, log, {
        accountability: req.accountability, action: 'create', collection: 'carpools',
        recordId: entryId, data: { ...input, [act.type]: act.id },
      })

      // Match-making nudge: a new request tells the drivers who still have a
      // free seat; a new offer tells the members still waiting for a ride.
      const b = await board(act.type, act.id, me.id)
      if (input.kind === 'request') {
        const drivers = b.offers.filter((o) => o.seats_free > 0 && !o.mine).map((o) => o.member.id)
        await notify(drivers, 'carpool_requested', act, { name: displayName(me), seats: input.seats })
      } else {
        let waiting = b.requests.filter((r) => !r.covered && !r.mine).map((r) => r.member.id)
        // An offer for some teams only nudges the people it is actually for.
        const offerTeams = parseScope(input.teams)
        if (offerTeams.length) {
          const keep = []
          for (const m of waiting) if (scopeAllows(offerTeams, await teamsOf(m))) keep.push(m)
          waiting = keep
        }
        await notify(waiting, 'carpool_offered', act, { name: displayName(me), seats: input.seats })
      }
      res.json({ data: b, id: entryId })
    } catch (err) { fail(res, err, 'POST carpools/:type/:id') }
  })
}
