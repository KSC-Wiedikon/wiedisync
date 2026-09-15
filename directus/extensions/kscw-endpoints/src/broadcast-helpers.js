/**
 * KSCW Broadcast — shared helpers for the Contact-All endpoint.
 *
 * Plan 01 / Phase B / Task B2:
 *   Pure helpers — no Express routing here. The endpoint code in B5/B6 imports
 *   these to resolve sender, load activities, gate permissions, resolve
 *   audience, enforce rate limits, and validate payloads.
 *
 * Style mirrors `messaging-helpers.js` — a `BroadcastError` wrapper carries
 * `{ status, code, message, details }` and the endpoint converts it to JSON
 * via `sendBroadcastError` (or any local equivalent).
 */

// ─── Error wrapper ───────────────────────────────────────────────────────────

export class BroadcastError extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

/**
 * Convert a thrown BroadcastError (or unexpected error) into an Express response.
 * The B5/B6 endpoint can use this directly inside its try/catch.
 */
export function sendBroadcastError(res, logger, err) {
  if (err instanceof BroadcastError) {
    return res.status(err.status).json({
      code: err.code,
      message: err.message,
      ...(err.details !== undefined ? { details: err.details } : {}),
    })
  }
  logger?.error?.({ err: err?.message ?? String(err), stack: err?.stack }, 'broadcast endpoint crash')
  return res.status(500).json({ code: 'broadcast/internal', message: 'Internal server error' })
}

// ─── Constants ───────────────────────────────────────────────────────────────

const VALID_ACTIVITY_TYPES = new Set(['event', 'game', 'training'])
// Audience keys offered to the caller. The first four map directly to the real
// `participations.status` enum (confirmed | declined | tentative | waitlisted);
// `unanswered` is a synthetic audience = the activity's eligible roster MINUS
// anyone who already has a participation row (non-responders have NO row at all,
// so they can never be matched by a status). Frontend ALL_STATUSES must match.
const VALID_AUDIENCE_STATUSES = new Set([
  'confirmed', 'tentative', 'declined', 'waitlisted', 'unanswered',
])
const REAL_PARTICIPATION_STATUSES = new Set([
  'confirmed', 'tentative', 'declined', 'waitlisted',
])

// ─── 1. Sender resolution ────────────────────────────────────────────────────

/**
 * Resolve a request's accountability into the corresponding members row.
 *
 * `accountability.user` is a directus_users.id; the FK on `members` pointing
 * at `directus_users` is `members.user` (NOT `members.directus_user`) — see
 * the same convention in messaging-helpers.js#requireMember.
 *
 * Throws:
 *   401 broadcast/unauthenticated  — if no accountability.user
 *   403 broadcast/no_member_profile — if no member row links to this user
 */
export async function resolveSenderMember(database, accountability) {
  const userId = accountability?.user
  if (!userId) {
    throw new BroadcastError(401, 'broadcast/unauthenticated', 'Authentication required')
  }
  const row = await database('members')
    .where('user', userId)
    .select('id', 'first_name', 'last_name', 'email', 'role', 'language')
    .first()
  if (!row) {
    throw new BroadcastError(403, 'broadcast/no_member_profile',
      'No member profile linked to this user')
  }
  // Normalise role to a JS array regardless of whether knex hydrated jsonb.
  const role = Array.isArray(row.role)
    ? row.role
    : (typeof row.role === 'string' ? safeJsonParse(row.role, []) : [])
  return { ...row, role }
}

function safeJsonParse(s, fallback) {
  try { return JSON.parse(s) } catch { return fallback }
}

// ─── 2. Activity loader ──────────────────────────────────────────────────────

/**
 * Polymorphic activity loader.
 *
 * Returns a normalised `{ id, type, title, start_date, location, … }` shape
 * tailored per type so downstream callers (permission check + email builder)
 * can rely on a stable contract:
 *
 *   event:    { id, type:'event', title, start_date, end_date, location,
 *               teamIds, primary_sport, created_by }
 *               (events table has no sport column — `primary_sport` is
 *                derived from the first linked team via events_teams.)
 *   game:     { id, type:'game', title, team, teamName, teamSport,
 *               start_date, location }
 *               (games.date + games.time → start_date; team = games.kscw_team;
 *                title = "Heim/Auswärts vs. <opponent>".)
 *   training: { id, type:'training', title, team, teamName, teamSport,
 *               start_date, location }
 *               (training.date + training.start_time → start_date.)
 *
 * Throws:
 *   400 broadcast/invalid_type  — type ∉ {event, game, training}
 *   404 broadcast/not_found     — no row for that id
 */
export async function loadActivity(itemsService, database, type, id) {
  if (!VALID_ACTIVITY_TYPES.has(type)) {
    throw new BroadcastError(400, 'broadcast/invalid_type',
      `Invalid activity type: ${type}`, { allowed: [...VALID_ACTIVITY_TYPES] })
  }
  if (id == null || id === '') {
    throw new BroadcastError(400, 'broadcast/invalid_id', 'Activity id is required')
  }

  if (type === 'event') {
    const ev = await database('events').where('id', id).first()
    if (!ev) throw new BroadcastError(404, 'broadcast/not_found', 'Event not found')
    // Resolve linked teams + the primary sport from the first one.
    const teamLinks = await database('events_teams')
      .where('events_id', id)
      .select('teams_id')
    const teamIds = teamLinks.map(r => r.teams_id).filter(Boolean)
    let primary_sport = null
    if (teamIds.length > 0) {
      const t = await database('teams').whereIn('id', teamIds).select('sport').first()
      primary_sport = t?.sport ?? null
    }
    return {
      id: ev.id,
      type: 'event',
      title: ev.title,
      description: ev.description ?? null,
      start_date: ev.start_date ?? null,
      end_date: ev.end_date ?? null,
      location: ev.location ?? null,
      teamIds,
      primary_sport,
      created_by: ev.created_by ?? null,
    }
  }

  if (type === 'game') {
    const g = await database('games').where('id', id).first()
    if (!g) throw new BroadcastError(404, 'broadcast/not_found', 'Game not found')
    const teamId = g.kscw_team ?? null
    let teamName = null
    let teamSport = null
    if (teamId) {
      const t = await database('teams').where('id', teamId).select('name', 'sport').first()
      teamName = t?.name ?? null
      teamSport = t?.sport ?? null
    }
    // Combine date + time into an ISO-like start_date (callers format for display).
    const start_date = combineDateAndTime(g.date, g.time)
    // Title: prefer "<home> vs. <away>" if we have it; fall back to game_id/league.
    const title = buildGameTitle(g, teamName)
    // Location: use hall when present, else the away_hall_json name.
    const location = g.hall || g.away_hall_json?.name || null
    return {
      id: g.id,
      type: 'game',
      title,
      team: teamId,
      teamName,
      teamSport,
      start_date,
      end_date: null,
      location,
      home_team: g.home_team ?? null,
      away_team: g.away_team ?? null,
      league: g.league ?? null,
    }
  }

  // type === 'training'
  const tr = await database('trainings').where('id', id).first()
  if (!tr) throw new BroadcastError(404, 'broadcast/not_found', 'Training not found')
  const teamId = tr.team ?? null
  let teamName = null
  let teamSport = null
  if (teamId) {
    const t = await database('teams').where('id', teamId).select('name', 'sport').first()
    teamName = t?.name ?? null
    teamSport = t?.sport ?? null
  }
  const start_date = combineDateAndTime(tr.date, tr.start_time)
  const title = teamName ? `Training ${teamName}` : 'Training'
  const location = tr.hall_name || tr.hall || null
  return {
    id: tr.id,
    type: 'training',
    title,
    team: teamId,
    teamName,
    teamSport,
    start_date,
    end_date: combineDateAndTime(tr.date, tr.end_time),
    location,
  }
}

function combineDateAndTime(date, time) {
  if (!date) return null
  const datePart = (date instanceof Date)
    ? date.toISOString().slice(0, 10)
    : String(date).slice(0, 10)
  if (!time) return datePart
  const timePart = String(time).slice(0, 8)  // HH:MM[:SS]
  return `${datePart}T${timePart}`
}

function buildGameTitle(game, teamName) {
  if (game.home_team && game.away_team) {
    return `${game.home_team} vs. ${game.away_team}`
  }
  if (teamName) return `${teamName} (${game.league ?? 'Spiel'})`
  return game.game_id ? `Spiel ${game.game_id}` : 'Spiel'
}

// ─── 3. Permission check ─────────────────────────────────────────────────────

/**
 * Gate a broadcast send by RBAC + scope.
 *
 * Rules:
 *   - admin / superuser  → always allowed
 *   - vorstand           → allowed for event broadcasts only
 *   - sport admin        → allowed when activity sport matches (vb_admin →
 *                          volleyball, bb_admin → basketball). For events the
 *                          activity sport is derived from the first linked team.
 *   - coach (teams_coaches) of activity.team — allowed for game/training
 *   - team_responsible (teams_responsibles) of activity.team — allowed for
 *                          game/training
 *
 * Throws:
 *   403 broadcast/not_authorized — on deny
 */
export async function checkBroadcastPermission(database, sender, activityType, activity) {
  if (!VALID_ACTIVITY_TYPES.has(activityType)) {
    throw new BroadcastError(400, 'broadcast/invalid_type', `Invalid activity type: ${activityType}`)
  }
  const roles = Array.isArray(sender?.role) ? sender.role : []

  // Global admin short-circuit
  if (roles.includes('admin') || roles.includes('superuser')) return

  if (activityType === 'event') {
    if (roles.includes('vorstand')) return
    const sport = activity?.primary_sport
    if (sport === 'volleyball' && roles.includes('vb_admin')) return
    if (sport === 'basketball' && roles.includes('bb_admin')) return
    throw new BroadcastError(403, 'broadcast/not_authorized',
      'You are not allowed to broadcast for this event')
  }

  // game | training: sport admin OR team-level role
  const sport = activity?.teamSport
  if (sport === 'volleyball' && roles.includes('vb_admin')) return
  if (sport === 'basketball' && roles.includes('bb_admin')) return

  const teamId = activity?.team
  if (teamId == null) {
    throw new BroadcastError(403, 'broadcast/not_authorized',
      'Activity has no team — only sport admins can broadcast for it')
  }
  const memberId = sender?.id
  const isCoach = await database('teams_coaches')
    .where({ teams_id: teamId, members_id: memberId }).first()
  if (isCoach) return
  const isTR = await database('teams_responsibles')
    .where({ teams_id: teamId, members_id: memberId }).first()
  if (isTR) return

  throw new BroadcastError(403, 'broadcast/not_authorized',
    'You are not allowed to broadcast for this activity')
}

// ─── 4. Audience resolver ────────────────────────────────────────────────────

/**
 * Resolve the recipient set for a broadcast.
 *
 * Members come from `participations` filtered by activity + status whitelist.
 * `participations.activity_id` is `text` (see scripts/003-stat-views.sql which
 * casts `g.id::text` when joining), so we cast on our side too.
 *
 * Externals (event-only): rows on `event_signups` for that event whose
 * `member` is null or `is_member=false`. Members linked via event_signups.member
 * are EXCLUDED here because they're already covered by the participations query;
 * including them would double-mail.
 *
 * `wiedisync_active = true` is enforced for members so deactivated accounts
 * don't get pinged.
 *
 * Returns: { memberIds: number[], externals: Array<{id,email,name,language}> }
 */
export async function resolveAudience(database, activityType, activityId, audienceFilter) {
  if (!VALID_ACTIVITY_TYPES.has(activityType)) {
    throw new BroadcastError(400, 'broadcast/invalid_type', `Invalid activity type: ${activityType}`)
  }
  const statuses = Array.isArray(audienceFilter?.statuses) ? audienceFilter.statuses : []
  if (statuses.length === 0) {
    throw new BroadcastError(400, 'broadcast/invalid_audience',
      'audience.statuses must be a non-empty array')
  }
  for (const s of statuses) {
    if (!VALID_AUDIENCE_STATUSES.has(s)) {
      throw new BroadcastError(400, 'broadcast/invalid_audience',
        `Invalid status: ${s}`, { allowed: [...VALID_AUDIENCE_STATUSES] })
    }
  }

  const memberIdSet = new Set()

  // 1. Real participation statuses → direct status match on the rows that exist.
  const realStatuses = statuses.filter(s => REAL_PARTICIPATION_STATUSES.has(s))
  if (realStatuses.length > 0) {
    const memberRows = await database('participations as p')
      .join('members as m', 'm.id', 'p.member')
      .where('p.activity_type', activityType)
      .andWhere('p.activity_id', String(activityId))
      .whereIn('p.status', realStatuses)
      .andWhere('m.wiedisync_active', true)
      .distinct('m.id')
      .select('m.id')
    for (const r of memberRows) {
      const id = Number(r.id)
      if (Number.isFinite(id)) memberIdSet.add(id)
    }
  }

  // 2. Synthetic "unanswered" audience → eligible roster MINUS anyone who
  //    already has a participation row for this activity (any status). These
  //    members have no row at all, so a status match can never surface them.
  if (statuses.includes('unanswered')) {
    const unansweredIds = await resolveUnansweredMembers(database, activityType, activityId)
    for (const id of unansweredIds) memberIdSet.add(id)
  }

  const memberIds = [...memberIdSet]

  let externals = []
  if (activityType === 'event' && audienceFilter?.includeExternals === true) {
    const rows = await database('event_signups')
      .where('event', activityId)
      .andWhere(function () {
        this.where('is_member', false).orWhereNull('member')
      })
      .whereNotNull('email')
      .select('id', 'email', 'name', 'language')
    externals = rows.map(r => ({
      id: r.id,
      email: r.email,
      name: r.name,
      language: r.language ?? null,
    }))
  }

  return { memberIds, externals }
}

/**
 * Resolve the "unanswered / no reply" audience for an activity: the eligible
 * roster MINUS every member who already has a participation row (any status).
 *
 * Eligibility mirrors the auto-confirm seeding in kscw-hooks so the broadcast
 * audience lines up with who the RSVP system considers in-scope:
 *   training — members of the team (`member_teams.team = trainings.team`),
 *              excluding guest levels in `excluded_guest_levels`.
 *   game     — members of the team (`member_teams.team = games.kscw_team`),
 *              guest_level = 0 only (guests can't RSVP to games).
 *   event    — club-wide events (no team & no member junction) → all active
 *              members; otherwise `events_teams ∪ events_members`, with the
 *              team arm narrowed to the core roster when `invite_guests` is off.
 *
 * `wiedisync_active = true` is enforced throughout. Returns a number[] of
 * member ids.
 */
export async function resolveUnansweredMembers(database, activityType, activityId) {
  const idText = String(activityId)
  let rows = []

  if (activityType === 'training') {
    rows = await database.raw(`
      SELECT m.id
      FROM trainings t
      JOIN member_teams mt ON mt.team = t.team
      JOIN members m ON m.id = mt.member
      WHERE t.id = ?::integer
        AND m.wiedisync_active = true
        AND (t.excluded_guest_levels IS NULL
             OR NOT (t.excluded_guest_levels::jsonb @> to_jsonb(mt.guest_level)))
        AND NOT EXISTS (
          SELECT 1 FROM participations p
          WHERE p.activity_type = 'training' AND p.activity_id = ?::text AND p.member = m.id
        )
    `, [activityId, idText])
  } else if (activityType === 'game') {
    rows = await database.raw(`
      SELECT m.id
      FROM games g
      JOIN member_teams mt ON mt.team = g.kscw_team
      JOIN members m ON m.id = mt.member
      WHERE g.id = ?::integer
        AND m.wiedisync_active = true
        AND mt.guest_level = 0
        AND NOT EXISTS (
          SELECT 1 FROM participations p
          WHERE p.activity_type = 'game' AND p.activity_id = ?::text AND p.member = m.id
        )
    `, [activityId, idText])
  } else {
    // event — determine club-wide vs scoped, then subtract responders.
    const [teamCount, memberCount] = await Promise.all([
      database('events_teams').where('events_id', activityId).count('* as c').first(),
      database('events_members').where('events_id', activityId).count('* as c').first(),
    ])
    const isClubWide = Number(teamCount?.c || 0) === 0 && Number(memberCount?.c || 0) === 0
    if (isClubWide) {
      rows = await database.raw(`
        SELECT m.id
        FROM members m
        WHERE m.wiedisync_active = true
          AND NOT EXISTS (
            SELECT 1 FROM participations p
            WHERE p.activity_type = 'event' AND p.activity_id = ?::text AND p.member = m.id
          )
      `, [idText])
    } else {
      rows = await database.raw(`
        SELECT DISTINCT e.member AS id
        FROM (
          -- Migration 324: invite_guests off → core roster only. UNION with the
          -- named-invite arm below, so a guest invited by name still counts.
          SELECT mt.member FROM events_teams et
            JOIN member_teams mt ON mt.team = et.teams_id
            JOIN events ev ON ev.id = et.events_id
            WHERE et.events_id = ?::integer
              AND (ev.invite_guests IS NOT FALSE OR COALESCE(mt.guest_level, 0) = 0)
          UNION
          SELECT em.members_id AS member FROM events_members em
            WHERE em.events_id = ?::integer
        ) e
        JOIN members m ON m.id = e.member
        WHERE m.wiedisync_active = true
          AND NOT EXISTS (
            SELECT 1 FROM participations p
            WHERE p.activity_type = 'event' AND p.activity_id = ?::text AND p.member = e.member
          )
      `, [activityId, activityId, idText])
    }
  }

  // database.raw returns { rows } on pg.
  const list = Array.isArray(rows) ? rows : (rows?.rows ?? [])
  const out = []
  for (const r of list) {
    const id = Number(r.id)
    if (Number.isFinite(id)) out.push(id)
  }
  return out
}

// ─── 5. Rate limit check ─────────────────────────────────────────────────────

/**
 * Per-activity rate limit for broadcasts.
 *
 * Rules:
 *   - At most 3 broadcasts per (activity_type, activity_id) in the trailing 60 min.
 *   - At least 20 minutes between consecutive broadcasts on the same activity.
 *
 * Returns:
 *   { allowed: true }
 *   { allowed: false, retryAfterSec: <seconds> }
 *
 * NOTE: this does not insert a row — the endpoint inserts the broadcast row
 * after a successful send. Concurrent calls could race past this gate; spec
 * accepts that for a soft limit (audit table catches abuse).
 */
export async function checkRateLimit(database, activityType, activityId, senderMemberId) {
  if (!VALID_ACTIVITY_TYPES.has(activityType)) {
    throw new BroadcastError(400, 'broadcast/invalid_type', `Invalid activity type: ${activityType}`)
  }
  const oneHourAgoIso = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const now = Date.now()

  // Per-activity soft limit (applies to all senders): 3/hour with 20-min spacing.
  // Keeps the activity chat from being spammed even across multiple coordinators.
  const rows = await database('broadcasts')
    .where('activity_type', activityType)
    .andWhere('activity_id', activityId)
    .andWhere('sent_at', '>', oneHourAgoIso)
    .orderBy('sent_at', 'desc')
    .limit(3)
    .select('sent_at')

  if (rows.length >= 3) {
    const oldest = new Date(rows[rows.length - 1].sent_at).getTime()
    const retryAfterSec = Math.max(1, Math.ceil((oldest + 60 * 60 * 1000 - now) / 1000))
    return { allowed: false, retryAfterSec }
  }

  if (rows.length > 0) {
    const lastMs = new Date(rows[0].sent_at).getTime()
    const sinceLastSec = Math.floor((now - lastMs) / 1000)
    if (sinceLastSec < 20 * 60) {
      const retryAfterSec = Math.max(1, 20 * 60 - sinceLastSec)
      return { allowed: false, retryAfterSec }
    }
  }

  // Per-sender global limit: max 10 broadcasts per sender per hour across ALL
  // activities. Prevents one coordinator from spamming the club by rotating
  // through activities (e.g. 3 games × 3/hour = 9 emails/hour to overlapping audiences).
  // Skipped when senderMemberId is not supplied (backward-compat).
  if (senderMemberId != null) {
    const senderRecent = await database('broadcasts')
      .where('sender', senderMemberId)
      .andWhere('sent_at', '>', oneHourAgoIso)
      .count({ n: '*' }).first()
    if (Number(senderRecent?.n ?? 0) >= 10) {
      return { allowed: false, retryAfterSec: 60 * 60 }
    }
  }

  return { allowed: true }
}

// ─── 6. Payload validation ───────────────────────────────────────────────────

/**
 * Validate the POST body shape of a broadcast request.
 *
 * Required:
 *   channels: { email?: bool, push?: bool, inApp?: bool } — at least one true
 *   message:  string, 1-2000 chars
 *   audience: {
 *     statuses: string[]   — non-empty subset of:
 *                            { confirmed | tentative | declined | waitlisted
 *                            | unanswered }
 *     includeExternals?: bool
 *   }
 *
 * Conditional:
 *   channels.email === true  → subject required, 3-200 chars
 *   channels.inApp === true  → 501 broadcast/not_implemented
 *                              (Phase B blocked on the messaging flag flip)
 *
 * The `includeExternals` flag is only meaningful for events; the semantic
 * check happens in `resolveAudience` — here we just shape-check the boolean.
 *
 * Throws:
 *   400 broadcast/invalid_payload — { field, message } in details
 *   501 broadcast/not_implemented — for inApp before messaging flag-flip
 */
export function validateBroadcastPayload(body) {
  if (!body || typeof body !== 'object') {
    throw new BroadcastError(400, 'broadcast/invalid_payload',
      'Body must be an object', { field: 'body' })
  }

  // — channels —
  const channels = body.channels
  if (!channels || typeof channels !== 'object') {
    throw new BroadcastError(400, 'broadcast/invalid_payload',
      'channels object required', { field: 'channels' })
  }
  const email = channels.email === true
  const push = channels.push === true
  const inApp = channels.inApp === true
  if (!email && !push && !inApp) {
    throw new BroadcastError(400, 'broadcast/invalid_payload',
      'At least one channel must be true', { field: 'channels' })
  }
  // Note: inApp is allowed at the payload layer. Event-only enforcement
  // happens in broadcast.js after loadActivity() resolves the activity type.

  // — message —
  if (typeof body.message !== 'string') {
    throw new BroadcastError(400, 'broadcast/invalid_payload',
      'message string required', { field: 'message' })
  }
  const trimmed = body.message.trim()
  if (trimmed.length < 1 || trimmed.length > 2000) {
    throw new BroadcastError(400, 'broadcast/invalid_payload',
      'message must be 1-2000 characters', { field: 'message' })
  }

  // — subject (only when emailing) —
  if (email) {
    if (typeof body.subject !== 'string') {
      throw new BroadcastError(400, 'broadcast/invalid_payload',
        'subject string required when channels.email is true', { field: 'subject' })
    }
    const subj = body.subject.trim()
    if (subj.length < 3 || subj.length > 200) {
      throw new BroadcastError(400, 'broadcast/invalid_payload',
        'subject must be 3-200 characters', { field: 'subject' })
    }
  }

  // — audience —
  const audience = body.audience
  if (!audience || typeof audience !== 'object') {
    throw new BroadcastError(400, 'broadcast/invalid_payload',
      'audience object required', { field: 'audience' })
  }
  if (!Array.isArray(audience.statuses) || audience.statuses.length === 0) {
    throw new BroadcastError(400, 'broadcast/invalid_payload',
      'audience.statuses must be a non-empty array', { field: 'audience.statuses' })
  }
  for (const s of audience.statuses) {
    if (typeof s !== 'string' || !VALID_AUDIENCE_STATUSES.has(s)) {
      throw new BroadcastError(400, 'broadcast/invalid_payload',
        `Invalid status: ${s}`,
        { field: 'audience.statuses', allowed: [...VALID_AUDIENCE_STATUSES] })
    }
  }
  if (audience.includeExternals !== undefined && typeof audience.includeExternals !== 'boolean') {
    throw new BroadcastError(400, 'broadcast/invalid_payload',
      'audience.includeExternals must be boolean if present',
      { field: 'audience.includeExternals' })
  }
}

// ─── 7. Activity-chat conversation helper ────────────────────────────────────

/**
 * Find the existing activity_chat conversation for an activity, or create one.
 *
 * Event-only (Plan 02 scope — games/trainings rejected by schema CHECK in
 * migration 015). Race-safe via the partial unique index
 * `uq_conversations_one_per_activity`: concurrent creators hit Postgres error
 * 23505 → we re-select and return the winner's row.
 *
 * `services` is the Directus services object (carries ItemsService).
 * `schema` is from `await getSchema()`.
 * `sender` is the member row (for created_by).
 *
 * Returns the conversations row as stored in the DB.
 */
export async function findOrCreateActivityConversation(database, services, schema, activity, sender) {
  const { ItemsService } = services || {}
  if (!ItemsService) {
    throw new BroadcastError(500, 'broadcast/services_missing',
      'ItemsService not available')
  }
  if (activity?.type !== 'event') {
    throw new BroadcastError(400, 'broadcast/inapp_events_only',
      'activity_chat conversations are event-only',
      { activityType: activity?.type })
  }

  // 1. Try existing
  let row = await database('conversations')
    .where({ type: 'activity_chat', activity_type: 'event', activity_id: activity.id })
    .first()
  if (row) return row

  // 2. Create — via ItemsService so Directus realtime + hooks fire.
  const conversationsService = new ItemsService('conversations', { schema, knex: database })
  const newId = crypto.randomUUID()
  try {
    await conversationsService.createOne({
      id: newId,
      type: 'activity_chat',
      team: null,
      activity_type: 'event',
      activity_id: activity.id,
      title: activity.title ?? null,
      created_by: sender?.id ?? null,
      created_at: new Date().toISOString(),
    })
    row = await database('conversations').where('id', newId).first()
    return row
  } catch (e) {
    const msg = e?.message ?? String(e)
    const isDupe = e?.code === '23505' || /duplicate key|unique|already exists/i.test(msg)
    if (isDupe) {
      row = await database('conversations')
        .where({ type: 'activity_chat', activity_type: 'event', activity_id: activity.id })
        .first()
      if (row) return row
    }
    throw e
  }
}
