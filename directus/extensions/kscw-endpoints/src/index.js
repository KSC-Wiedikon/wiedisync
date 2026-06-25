/**
 * KSCW Custom API Endpoints
 *
 * All endpoints prefixed with /kscw/ (e.g., /kscw/check-email)
 */

import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { spawn } from 'node:child_process'
import { syncSvGames, syncSvRankings } from './sv-sync.js'
import { syncBpGames, syncBpRankings } from './bp-sync.js'
import { registerPasswordReset } from './password-reset.js'
import { registerICalFeed } from './ical-feed.js'
import { registerPublicEvents } from './public-events.js'
import { registerForms } from './forms.js'
import { registerPublicForms } from './public-forms.js'
import { registerGCalSync } from './gcal-sync.js'
import { registerSchulferienSync } from './schulferien-sync.js'
import { registerScorerReminders } from './scorer-reminders.js'
import { registerScorerContacts } from './scorer-contacts.js'
import { registerScorerRoster } from './scorer-roster.js'
import { registerGameScheduling } from './game-scheduling.js'
import { registerSchedulingMailbox } from './scheduling-mailbox.js'
import { registerContactForm } from './contact-form.js'
import { registerWebPush, sendPushToMember, sendPushToMembers } from './web-push.js'
import { FRONTEND_URL } from './email-template.js'
import { sendLocalizedPush, tPush, memberLangToCode } from './push-i18n.js'
import { writeErrorLog, logErrorToFile, logAuthDenial, logWarning, cleanOldLogs, computeErrorHash, logCronRun } from './error-log.js'
import { registerStats } from './stats.js'
import { registerRegistration } from './registration.js'
import { registerNewsletter } from './newsletter.js'
import { registerNewsletterDigest } from './newsletter-digest.js'
import { registerClubdeskUpdate } from './clubdesk-update.js'
import { registerBugfixes } from './bugfixes.js'
import { registerEventNotify } from './event-notify.js'
import { registerMessaging } from './messaging.js'
import { registerBroadcastRoutes } from './broadcast.js'
import { registerActivitiesWithParticipations } from './activities.js'
import { writeUserLog } from './activity-log.js'
import { registerSvLicence } from './sv-licence.js'
import { registerMigrationsStatus } from './migrations-status.js'
import { registerSyncStatus } from './sync-status.js'
import { registerAudit } from './audit.js'
import { registerOpnform } from './opnform.js'
import { registerWadmin } from './wadmin.js'
import { registerSqlWorkspace } from './sql-workspace.js'
import { registerSqlAi } from './sql-ai.js'
import { registerExpenseUpload } from './expense-upload.js'
import { registerFinance } from './finance.js'
import { registerFinanceCamt } from './finance-camt.js'

// ── Helpers ──────────────────────────────────────────────────────

const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET || ''

async function verifyTurnstile(token) {
  if (!TURNSTILE_SECRET) {
    // Fail closed in production: reject requests when CAPTCHA is not configured.
    // Only allow bypass in local dev (localhost or explicit DEV_MODE).
    const isLocalDev = process.env.PUBLIC_URL?.includes('localhost') || process.env.DEV_MODE === 'true'
    if (!isLocalDev) {
      console.error('[kscw-endpoints] TURNSTILE_SECRET not configured — rejecting request (fail-closed)')
      return false
    }
    console.warn('[kscw-endpoints] TURNSTILE_SECRET not configured — CAPTCHA bypassed (local dev)')
    return true
  }
  const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret: TURNSTILE_SECRET, response: String(token || '') }).toString(),
  })
  const data = await resp.json()
  return data.success === true
}

function getCurrentSeason() {
  const now = new Date(); const y = now.getFullYear(); const m = now.getMonth()
  // Season starts in June (m=5); Jan–May (m<5) is still the previous season. Matches src/utils/dateHelpers.ts.
  return m < 5 ? `${y - 1}/${String(y).slice(2)}` : `${y}/${String(y + 1).slice(2)}`
}

function randomToken(len = 32) {
  return crypto.randomBytes(len).toString('hex').slice(0, len)
}

function addDays(date, days) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

// ── Password validation ───────────────────────────────────────
const COMMON_PASSWORDS = new Set([
  'password', '12345678', '123456789', '1234567890', 'qwerty123',
  'abcdefgh', 'iloveyou', 'trustno1', 'sunshine1', 'princess1',
  'football', 'baseball', 'dragon12', 'letmein12', 'welcome1',
  'monkey123', 'master12', 'qwertyui', 'asdfghjk', 'zxcvbnm1',
  'password1', 'password123', 'admin123', '11111111', '00000000',
  'abc12345', 'changeme', 'testtest',
])

function validatePassword(password) {
  if (!password || password.length < 8) {
    return 'Password must be at least 8 characters'
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return 'Password is too common — please choose a stronger one'
  }
  const hasLetter = /[a-zA-Z]/.test(password)
  const hasDigitOrSpecial = /[0-9!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)
  if (!hasLetter || !hasDigitOrSpecial) {
    return 'Password must contain at least one letter and one number or special character'
  }
  return null // valid
}

// ── PII scrubbing for request body logging ─────────────────────
const PII_KEYS = new Set(['email', 'password', 'phone', 'birthdate', 'first_name', 'last_name', 'token', 'otp', 'code', 'turnstile_token'])

function scrubBody(body) {
  if (!body || typeof body !== 'object') return body
  const safe = {}
  for (const [k, v] of Object.entries(body)) {
    safe[k] = PII_KEYS.has(k) ? '[REDACTED]' : v
  }
  return safe
}

// ── Structured error logging ───────────────────────────────────
/**
 * Log endpoint errors with full context: WHO (user/member), WHAT (endpoint),
 * WHY (error + stack), and WHICH (request body, scrubbed).
 * Writes to both Directus logger (stdout) AND persistent JSONL file.
 */
function logEndpointError(log, endpoint, err, req) {
  const userId = req?.accountability?.user || null
  const isAdmin = req?.accountability?.admin || false
  log.error({
    msg: `${endpoint}: ${err.message}`,
    endpoint,
    userId,
    isAdmin,
    status: err.status || 500,
    method: req?.method,
    body: req?.body ? scrubBody(req.body) : undefined,
    params: req?.params || undefined,
    query: req?.query || undefined,
    stack: err.stack,
  })
  // Also write to persistent file
  logErrorToFile(endpoint, err, req)
}

function requireAdmin(req, log) {
  if (!req.accountability?.admin) {
    if (log) {
      log.warn({
        msg: 'Admin access denied',
        userId: req.accountability?.user || null,
        endpoint: req.path,
        method: req.method,
      })
    }
    logAuthDenial(req.path, req, 'admin_required')
    const err = new Error('Admin access required')
    err.status = 403
    throw err
  }
}

function requireAuth(req, log) {
  if (!req.accountability?.user) {
    if (log) {
      log.warn({
        msg: 'Authentication required — unauthenticated request blocked',
        endpoint: req.path,
        method: req.method,
        ip: req.ip || req.headers?.['x-forwarded-for'] || 'unknown',
      })
    }
    logAuthDenial(req.path, req, 'auth_required')
    const err = new Error('Authentication required')
    err.status = 401
    throw err
  }
}

/**
 * Cap an arbitrary client-supplied payload to keep the JSONL error log from
 * being filled by attacker-controlled bodies.
 * - strings: truncated to 500 chars
 * - objects/arrays: JSON-serialised then truncated
 * - everything else: stringified + truncated
 */
function capPayload(payload, max = 500) {
  if (payload == null) return null
  try {
    const str = typeof payload === 'string' ? payload : JSON.stringify(payload)
    return str.length > max ? str.slice(0, max) + '…' : str
  } catch {
    return null
  }
}

/**
 * Tiny in-memory IP rate limiter shared by sensitive public endpoints.
 * Returns true when the request is allowed, false when over budget.
 * The map self-cleans when it grows past 1k entries.
 */
function ipRateLimit(map, req, maxAttempts, windowMs) {
  const ip = req.ip || req.headers?.['x-forwarded-for'] || 'unknown'
  const now = Date.now()
  const entry = map.get(ip)
  if (entry && now < entry.resetAt) {
    if (entry.count >= maxAttempts) return false
    entry.count++
  } else {
    map.set(ip, { count: 1, resetAt: now + windowMs })
  }
  if (map.size > 1000) {
    for (const [k, v] of map) { if (now > v.resetAt) map.delete(k) }
  }
  return true
}

export { logEndpointError, scrubBody, capPayload, ipRateLimit }

export default {
  id: 'kscw',
  handler: (router, ctx) => {
    const { services, database, logger, getSchema } = ctx
    const log = logger.child({ extension: 'kscw-endpoints' })

    // ── Client Error Ingestion ─────────────────────────────────
    // POST /kscw/client-error — receives frontend errors and writes to JSONL log.
    // Rate-limited, accepts both auth and unauth requests.

    const clientErrorIp = new Map() // ip → { count, resetAt }

    router.post('/client-error', (req, res) => {
      try {
        // Rate limit: 30 errors per minute per IP
        const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown'
        const now = Date.now()
        const ipEntry = clientErrorIp.get(ip)
        if (ipEntry && now < ipEntry.resetAt) {
          if (ipEntry.count >= 30) return res.status(429).end()
          ipEntry.count++
        } else {
          clientErrorIp.set(ip, { count: 1, resetAt: now + 60000 })
        }
        // Clean stale entries
        if (clientErrorIp.size > 500) {
          for (const [k, v] of clientErrorIp) { if (now > v.resetAt) clientErrorIp.delete(k) }
        }

        const body = req.body
        if (!body || typeof body !== 'object') return res.status(400).end()

        // Reject empty payloads (no actual error data) — they only produce null-field noise
        if (!body.error && !body.stack && !body.type && !body.responseBody) return res.status(204).end()

        // Write to JSONL — add userId from auth if available, project tag for multi-app support
        writeErrorLog({
          level: 'error',
          source: 'frontend',
          project: body.project || 'wiedisync',
          event: body.event || 'client_error',
          userId: req.accountability?.user || null,
          operation: body.operation || null,
          collection: body.collection || null,
          recordId: body.recordId || null,
          endpoint: body.endpoint || null,
          method: body.method || null,
          status: body.status || null,
          action: body.action || null,
          page: body.page || null,
          userAgent: body.userAgent || null,
          responseBody: typeof body.responseBody === 'string' ? body.responseBody.slice(0, 1000) : null,
          // Cap payload size — uncapped attacker-controlled payloads can fill
          // the JSONL log over time (30 req/min × big payload × 30 days).
          payload: capPayload(body.payload),
          error: typeof body.error === 'string' ? body.error.slice(0, 1000) : null,
          type: typeof body.type === 'string' ? body.type.slice(0, 200) : null,
          stack: typeof body.stack === 'string' ? body.stack.slice(0, 2000) : null,
        })

        res.status(204).end()
      } catch {
        res.status(500).end()
      }
    })

    // ── Delete Account (cascade) ─────────────────────────────────
    // POST /kscw/delete-account — deletes member + Directus user + all cascade data
    // Auth required: user can only delete their own account, or admin can delete any

    router.post('/delete-account', async (req, res) => {
      try {
        requireAuth(req, log)

        const userId = req.accountability.user
        const isAdmin = req.accountability.admin
        const { member_id } = req.body

        // Resolve which member to delete
        let targetMemberId = member_id
        if (!targetMemberId) {
          // Default: delete own account
          const self = await database('members').where('user', userId).select('id').first()
          if (!self) return res.status(404).json({ error: 'Member not found' })
          targetMemberId = self.id
        } else if (!isAdmin) {
          // Non-admin can only delete their own account
          const self = await database('members').where('user', userId).select('id').first()
          if (!self || String(self.id) !== String(targetMemberId)) {
            return res.status(403).json({ error: 'Can only delete your own account' })
          }
        }

        const member = await database('members').where('id', targetMemberId).select('id', 'user', 'email').first()
        if (!member) return res.status(404).json({ error: 'Member not found' })

        const linkedUserId = member.user

        // Clean up email verifications (not FK-linked)
        if (member.email) {
          await database('email_verifications').where('email', member.email).delete()
        }

        // Delete member — CASCADE will handle member_teams, participations,
        // notifications, absences, user_logs, scorer_delegations, poll_votes,
        // slot_claims, push_subscriptions, coach/captain/TR junctions
        await database('members').where('id', targetMemberId).delete()

        // Delete linked Directus user (if exists)
        if (linkedUserId) {
          try {
            const schema = await getSchema()
            const { UsersService } = services
            const adminUsersService = new UsersService({ schema, knex: database, accountability: { admin: true } })
            await adminUsersService.deleteOne(linkedUserId)
          } catch (userErr) {
            // Log but don't fail — member is already deleted
            log.warn({ msg: `delete-account: Directus user deletion failed for ${linkedUserId}`, error: userErr.message })
          }
        }

        log.info(`Account deleted: member ${targetMemberId}${linkedUserId ? `, user ${linkedUserId}` : ''}${isAdmin && member_id ? ' (by admin)' : ''}`)
        res.json({ success: true, deleted_member: targetMemberId })
      } catch (err) {
        logEndpointError(log, 'delete-account', err, req)
        res.status(err.status || 500).json({ error: err.status ? err.message : 'Internal error' })
      }
    })

    // ── Public: Check Email ─────────────────────────────────────
    const checkEmailIpAttempts = new Map() // ip → [timestamps]

    router.post('/check-email', async (req, res) => {
      try {
        // Rate limit: max 10 requests per minute per IP
        const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown'
        const now = Date.now()
        const attempts = checkEmailIpAttempts.get(ip) || []
        const recentAttempts = attempts.filter(t => now - t < 60000)
        if (recentAttempts.length >= 10) {
          return res.status(429).json({ error: 'Too many requests' })
        }
        recentAttempts.push(now)
        checkEmailIpAttempts.set(ip, recentAttempts)
        if (checkEmailIpAttempts.size > 1000) {
          for (const [k, v] of checkEmailIpAttempts) {
            if (v.every(t => now - t >= 60000)) checkEmailIpAttempts.delete(k)
          }
        }

        const { email, turnstile_token } = req.body
        if (!email) return res.status(400).json({ error: 'Email required' })

        // Turnstile validation (public endpoint — belt-and-suspenders with filter hook)
        const captchaToken = turnstile_token || req.headers['x-turnstile-token']
        if (!captchaToken || !(await verifyTurnstile(captchaToken))) {
          return res.status(400).json({ error: 'Captcha verification failed' })
        }

        const normalised = email.toLowerCase().trim()

        const member = await database('members')
          .whereRaw('LOWER(email) = ?', [normalised])
          .select('id', 'wiedisync_active', 'shell', 'first_name', 'last_name')
          .first()

        // Also check directus_users — catches accounts imported/created outside
        // the normal flow where no `members` row exists or emails disagree.
        const directusUser = await database('directus_users')
          .whereRaw('LOWER(email) = ?', [normalised])
          .select('id')
          .first()

        const result = {
          exists: !!member || !!directusUser,
          claimed: member?.wiedisync_active || (!!directusUser && !member) || false,
          shell: member?.shell || false,
        }

        // For unclaimed members: include only team names/sport for pre-fill (no PII, no internal IDs)
        if (member && !member.wiedisync_active) {
          const season = getCurrentSeason()
          const memberTeams = await database('member_teams')
            .join('teams', 'teams.id', 'member_teams.team')
            .where('member_teams.member', member.id)
            .where('member_teams.season', season)
            .select('teams.name', 'teams.sport')
          result.existing_teams = memberTeams
        }

        res.json(result)
      } catch (err) {
        logEndpointError(log, 'check-email', err, req)
        res.status(500).json({ error: 'Internal error' })
      }
    })

    // ── Public: Teams & Sponsors ────────────────────────────────

    router.get('/public/teams', async (_req, res) => {
      try {
        const teams = await database('teams')
          .where('active', true)
          // `team_id` (e.g. bb_1348) is the season-stable external id — the public
          // website matches teams on it so its hardcoded defs survive the June-1
          // rollover (numeric `id` is reassigned every season). See /public/team/:id.
          .select('id', 'team_id', 'name', 'full_name', 'sport', 'league', 'season', 'color',
            'team_picture', 'team_picture_pos', 'social_url')
          .orderBy('name')

        // Attach a weekly training summary per team so the website team cards can
        // show live hall slots instead of hardcoded times. We pull every active
        // team's upcoming, non-cancelled, non-trial trainings in one query, resolve
        // hall name/address (denormalized column first, halls FK as fallback — same
        // as /public/team/:id), then collapse the dated rows into unique weekday +
        // time + hall slots ordered Mon→Sun.
        const today = new Date().toISOString().split('T')[0]
        const teamIds = teams.map((t) => t.id)
        const rawTrainings = teamIds.length
          ? await database('trainings')
              .whereIn('team', teamIds)
              .where('date', '>=', today)
              .where('cancelled', false)
              .where('is_trial', false)
              .select('team', 'date', 'start_time', 'end_time', 'hall', 'hall_name')
              .orderBy('date')
          : []

        const slotHallIds = [...new Set(rawTrainings.map((t) => t.hall).filter((id) => id != null))]
        const slotHallById = slotHallIds.length
          ? new Map(
              (await database('halls').whereIn('id', slotHallIds).select('id', 'name', 'address'))
                .map((h) => [h.id, h])
            )
          : new Map()

        const WEEKDAY = ['so', 'mo', 'di', 'mi', 'do', 'fr', 'sa'] // getUTCDay(): 0=Sun
        const DAY_ORDER = { mo: 1, di: 2, mi: 3, do: 4, fr: 5, sa: 6, so: 7 }
        const summaryByTeam = new Map()
        for (const t of rawTrainings) {
          const h = t.hall != null ? slotHallById.get(t.hall) : null
          const hallName = t.hall_name || (h?.name ?? null)
          const hallAddress = h?.address ?? null
          const ymd = t.date instanceof Date ? t.date.toISOString().slice(0, 10) : String(t.date).slice(0, 10)
          const day = WEEKDAY[new Date(`${ymd}T12:00:00Z`).getUTCDay()]
          const start = String(t.start_time || '').slice(0, 5)
          const end = String(t.end_time || '').slice(0, 5)
          const key = `${day}|${start}|${end}|${hallName || ''}`
          let slots = summaryByTeam.get(t.team)
          if (!slots) { slots = new Map(); summaryByTeam.set(t.team, slots) }
          if (!slots.has(key)) slots.set(key, { day, start, end, hall_name: hallName, hall_address: hallAddress })
        }

        const data = teams.map((t) => ({
          ...t,
          trainings: [...(summaryByTeam.get(t.id)?.values() ?? [])]
            .sort((a, b) => DAY_ORDER[a.day] - DAY_ORDER[b.day] || a.start.localeCompare(b.start)),
        }))
        res.json({ data })
      } catch (err) {
        logEndpointError(log, 'public/teams', err, _req)
        res.status(500).json({ error: 'Internal error' })
      }
    })

    router.get('/public/team/:id', async (req, res) => {
      try {
        let team = await database('teams').where('id', req.params.id).first()
        if (!team) return res.status(404).json({ error: 'Team not found' })

        // Season-rollover follow-through: the public site (kscw-website) hardcodes
        // a team's numeric id per slug. After the June-1 rollover every team gets a
        // new id (the old row is archived with active=false), so those hardcoded ids
        // point at last season's roster. `team_id` (e.g. vb_12747) is stable across
        // seasons, so if we were handed an archived team, hop to the active row that
        // shares it. Keeps stale hardcoded ids auto-following future rollovers.
        if (!team.active && team.team_id) {
          const activeTeam = await database('teams')
            .where('team_id', team.team_id).where('active', true).first()
          if (activeTeam) team = activeTeam
        }

        const today = new Date().toISOString().split('T')[0]

        const [roster, coaches, upcomingGames, completedGames, trainings, trialTrainings, rankings, barrageRankings, sponsors] = await Promise.all([
          database('member_teams')
            .join('members', 'members.id', 'member_teams.member')
            .where('member_teams.team', team.id)
            .where('members.kscw_membership_active', true)
            .select('members.id', 'members.first_name', 'members.last_name',
              'members.number', 'members.position', 'members.photo',
              'members.birthdate', 'members.birthdate_visibility',
              'members.website_visible', 'members.website_name_private',
              'member_teams.guest_level'),
          database('teams_coaches')
            .join('members', 'members.id', 'teams_coaches.members_id')
            .where('teams_coaches.teams_id', team.id)
            .select('members.id', 'members.first_name', 'members.last_name', 'members.photo',
              'members.birthdate', 'members.birthdate_visibility',
              'members.website_visible', 'members.website_name_private'),
          database('games')
            .where('kscw_team', team.id).where('date', '>=', today)
            .where('status', '!=', 'cancelled')
            .orderBy('date').limit(10),
          database('games')
            .where('kscw_team', team.id).where('status', 'completed')
            .orderBy('date', 'desc').limit(10),
          database('trainings')
            .where('team', team.id).where('date', '>=', today).where('cancelled', false)
            .orderBy('date').limit(10),
          // Trial trainings (Probetrainings): publicly surfaced on the team
          // page next to the "Get in touch" CTA when the team is open to new
          // players. Only populated when `open_for_players=true`.
          team.open_for_players
            ? database('trainings')
                .where('team', team.id).where('date', '>=', today).where('cancelled', false)
                .where('is_trial', true)
                .orderBy('date').limit(10)
            : Promise.resolve([]),
          // Rankings: all teams in same league+season (team.league matches overall league name)
          team.league && team.season
            ? database('rankings')
                .where('league', team.league).where('season', team.season)
                .orderBy('rank')
            : Promise.resolve([]),
          // Barrage standings this team appears in — promotion/relegation playoffs
          // ONLY (the `%barrage%` match deliberately excludes cup/Pokal/Turnier).
          // The regular-league query above keys off `team.league`, which never
          // equals the barrage group caption, so these rows would otherwise be
          // dropped and the promotion would be invisible on the public site.
          team.team_id && team.season
            ? database('rankings')
                .whereIn('league', database('rankings')
                  .select('league')
                  .where('season', team.season)
                  .where('team_id', team.team_id)
                  .whereRaw('league ILIKE ?', ['%barrage%']))
                .where('season', team.season)
                .orderBy('league').orderBy('rank')
            : Promise.resolve([]),
          // Sponsors: only sponsors explicitly linked to this team via junction table
          database('sponsors')
            .join('teams_sponsors', 'sponsors.id', 'teams_sponsors.sponsors_id')
            .where('teams_sponsors.teams_id', team.id)
            .where('sponsors.active', true)
            .orderBy('sponsors.sort_order')
            .select('sponsors.*'),
        ])

        // Extract 4-digit year from birthdate (handles ISO strings and Date objects).
        const extractYob = (birthdate, visibility) => {
          if (!birthdate || visibility === 'hidden') return null
          if (birthdate instanceof Date) {
            const y = birthdate.getFullYear()
            return Number.isFinite(y) ? String(y) : null
          }
          const m = String(birthdate).match(/\d{4}/)
          return m ? m[0] : null
        }

        // Website name-privacy (migration 116): when a member opts in, their
        // public surname collapses to an initial ("Müller" → "M.") and their
        // year of birth is dropped. First name / number / position are kept.
        // Website-scoped only — the internal app reads full names elsewhere.
        const lastInitial = (lastName) => {
          const s = (lastName || '').trim()
          return s ? s.charAt(0).toUpperCase() + '.' : ''
        }

        // ── Minor-protection (privacy / DSGVO): no personal data about an
        // under-18 may leave the server via this public endpoint.
        //  1. Teams underage *by definition* (every member is a minor — any
        //     "U<=18" team, plus Mini) expose NO roster at all, even when some
        //     birthdates are missing.
        //  2. On every other team (U20/U23, seniors) each member is age-checked
        //     against their birthdate and dropped if under 18. A missing or
        //     unparseable birthdate is treated as a minor (hidden) — we only
        //     expose someone we can prove is an adult.
        // Coaches are intentionally kept (adult staff, already shown on cards).
        // Website-scoped only — the internal app reads full rosters elsewhere.
        const isUnderageTeam = (name) => {
          const s = String(name || '')
          if (/mini/i.test(s)) return true
          const m = s.match(/U(\d{1,2})/i)
          return m ? Number(m[1]) <= 18 : false
        }
        const nowMs = Date.now()
        const isMinor = (birthdate) => {
          if (!birthdate) return true
          const d = birthdate instanceof Date ? birthdate : new Date(birthdate)
          if (Number.isNaN(d.getTime())) return true
          const now = new Date(nowMs)
          let age = now.getFullYear() - d.getFullYear()
          const md = now.getMonth() - d.getMonth()
          if (md < 0 || (md === 0 && now.getDate() < d.getDate())) age -= 1
          return age < 18
        }

        // Transform roster: expose yob (respecting birthdate_visibility) + guest_level,
        // strip raw birthdate / visibility flag from the public payload. Photo is
        // gated server-side by website_visible (default false = opt-in) so opted-out
        // members never expose a photo id — the website renders the club logo instead.
        const rosterPublic = isUnderageTeam(team.name)
          ? []
          : roster.filter((m) => !isMinor(m.birthdate)).map((m) => ({
          id: m.id,
          first_name: m.first_name,
          last_name: m.website_name_private ? lastInitial(m.last_name) : m.last_name,
          number: m.number,
          position: m.position,
          photo: m.website_visible ? m.photo : null,
          yob: m.website_name_private ? null : extractYob(m.birthdate, m.birthdate_visibility),
          guest_level: m.guest_level || 0,
        }))

        const coachesPublic = coaches.map((c) => ({
          id: c.id,
          first_name: c.first_name,
          last_name: c.website_name_private ? lastInitial(c.last_name) : c.last_name,
          photo: c.website_visible ? c.photo : null,
          yob: c.website_name_private ? null : extractYob(c.birthdate, c.birthdate_visibility),
        }))

        // ── Resolve officials (referees, scorers, BB officials) for each game.
        // SVRZ referees ride in `referees_json` ({name, id}[]); scorer/BB officials
        // are member/team FK IDs. Batch-fetch and attach public-shaped fields.
        const allGames = [...upcomingGames, ...completedGames]
        const memberIds = new Set()
        const teamIds = new Set()
        for (const g of allGames) {
          if (g.scorer_member) memberIds.add(g.scorer_member)
          if (g.scoreboard_member) memberIds.add(g.scoreboard_member)
          if (g.scorer_scoreboard_member) memberIds.add(g.scorer_scoreboard_member)
          if (g.bb_scorer_member) memberIds.add(g.bb_scorer_member)
          if (g.bb_timekeeper_member) memberIds.add(g.bb_timekeeper_member)
          if (g.bb_24s_official) memberIds.add(g.bb_24s_official)
          if (g.scorer_duty_team) teamIds.add(g.scorer_duty_team)
        }
        const [memberRows, teamRows] = await Promise.all([
          memberIds.size
            ? database('members').whereIn('id', [...memberIds])
                .select('id', 'first_name', 'last_name', 'birthdate')
            : Promise.resolve([]),
          teamIds.size
            ? database('teams').whereIn('id', [...teamIds]).select('id', 'name')
            : Promise.resolve([]),
        ])
        const memberById = new Map(memberRows.map((m) => [m.id, m]))
        const teamById = new Map(teamRows.map((t) => [t.id, t]))
        const memberName = (id) => {
          const m = memberById.get(id)
          // Minor-protection: never expose the name of an under-18 official
          // (e.g. a youth scorer on a youth game). Missing birthdate = treated
          // as a minor and suppressed, same rule as the roster above.
          if (!m || isMinor(m.birthdate)) return null
          return [m.first_name, m.last_name].filter(Boolean).join(' ') || null
        }

        const splitName = (full) => {
          if (!full) return { first_name: '', last_name: '' }
          const parts = String(full).trim().split(/\s+/)
          if (parts.length === 1) return { first_name: '', last_name: parts[0] }
          return { first_name: parts.slice(0, -1).join(' '), last_name: parts[parts.length - 1] }
        }

        const enrichGame = (g) => {
          // Referees: parse referees_json ({name,id}[]) into {first_name,last_name}[]
          let referees = null
          if (Array.isArray(g.referees_json) && g.referees_json.length) {
            referees = g.referees_json.map((r) => splitName(r && r.name))
          }
          // Volleyball scorer team + named scorer member (when assigned)
          const scorerTeamName = g.scorer_duty_team ? (teamById.get(g.scorer_duty_team)?.name ?? null) : null
          const scorerName = g.scorer_member ? memberName(g.scorer_member) : null
          // Basketball officials
          let bbOfficials = null
          const bbScorer = g.bb_scorer_member ? memberName(g.bb_scorer_member) : null
          const bbTimekeeper = g.bb_timekeeper_member ? memberName(g.bb_timekeeper_member) : null
          const bb24s = g.bb_24s_official ? memberName(g.bb_24s_official) : null
          if (bbScorer || bbTimekeeper || bb24s) {
            bbOfficials = { scorer: bbScorer, timekeeper: bbTimekeeper, shot_clock: bb24s }
          }
          return { ...g, referees, scorer_team: scorerTeamName, scorer_name: scorerName, bb_officials: bbOfficials }
        }

        const upcomingPublic = upcomingGames.map(enrichGame)
        const resultsPublic = completedGames.map(enrichGame)

        // Fall back to the linked hall's name/address when the training row's
        // denormalized hall_name is empty (older trainings created before the
        // column was populated still reference a hall via FK).
        const hallIds = [...new Set(
          [...trainings, ...trialTrainings].map((t) => t.hall).filter((id) => id != null)
        )]
        const hallById = hallIds.length
          ? new Map(
              (await database('halls').whereIn('id', hallIds).select('id', 'name', 'address'))
                .map((h) => [h.id, h])
            )
          : new Map()
        const enrichTraining = (t) => {
          const h = t.hall != null ? hallById.get(t.hall) : null
          return {
            ...t,
            hall_name: t.hall_name || (h?.name ?? null),
            hall_address: t.hall_address || (h?.address ?? null),
          }
        }
        const trainingsPublic = trainings.map(enrichTraining)
        const trialTrainingsPublic = trialTrainings.map(enrichTraining)

        // Strip internal/config columns before spreading the raw teams row into
        // the public payload. These are coach-dashboard prefs, feature toggles,
        // internal source IDs and member FKs that the public website never needs
        // (mirrors the PUBLIC_TEAM_FIELDS allowlist used by /public/teams).
        const {
          features_enabled,
          dashboard_range_from,
          dashboard_range_to,
          dashboard_league_only,
          bb_source_id,
          captain,
          ...publicTeam
        } = team

        res.json({
          data: {
            ...publicTeam,
            roster: rosterPublic,
            coaches: coachesPublic,
            upcoming_games: upcomingPublic,
            results: resultsPublic,
            upcoming_trainings: trainingsPublic,
            trial_trainings: trialTrainingsPublic,
            rankings,
            barrage_rankings: barrageRankings,
            sponsors,
          },
        })
      } catch (err) {
        logEndpointError(log, 'public/team', err, req)
        res.status(500).json({ error: 'Internal error' })
      }
    })

    router.get('/public/sponsors', async (_req, res) => {
      try {
        const sponsors = await database('sponsors').where('active', true).orderBy('sort_order')
        res.json({ data: sponsors })
      } catch (err) {
        logEndpointError(log, 'public/sponsors', err, _req)
        res.status(500).json({ error: 'Internal error' })
      }
    })

    // Count of non-member mixed tournament signups (for event participant count boost).
    // Non-members can't get a participations row (FK to members), so the kscw-website
    // form writes them to event_signups with is_member=false. This endpoint
    // lets the frontend add those to the event's confirmed count.
    router.get('/public/mixed-tournament/non-member-count', async (_req, res) => {
      try {
        const row = await database('event_signups')
          .where('form_slug', 'mixed_tournament_2026')
          .where('is_member', false)
          .count('* as count').first()
        res.json({ count: Number(row?.count ?? 0) })
      } catch (err) {
        logEndpointError(log, 'public/mixed-tournament/non-member-count', err, _req)
        res.status(500).json({ error: 'failed' })
      }
    })

    // ── Admin Sync Triggers ─────────────────────────────────────

    router.post('/admin/sv-sync', async (req, res) => {
      try {
        requireAdmin(req, log)
        log.info('Manual SV sync triggered')
        const games = await syncSvGames(database, log)
        const rankings = await syncSvRankings(database, log)
        res.json({ status: 'ok', games, rankings })
      } catch (err) {
        logEndpointError(log, 'admin/sv-sync', err, req)
        res.status(err.status || 500).json({ error: err.status ? err.message : 'Internal error' })
      }
    })

    router.post('/admin/bp-sync', async (req, res) => {
      try {
        requireAdmin(req, log)
        log.info('Manual BP sync triggered')
        const games = await syncBpGames(database, log)
        const rankings = await syncBpRankings(database, log, games.leagueHoldingIds)
        res.json({ status: 'ok', games, rankings })
      } catch (err) {
        logEndpointError(log, 'admin/bp-sync', err, req)
        res.status(err.status || 500).json({ error: err.status ? err.message : 'Internal error' })
      }
    })

    // ── Manual VM / SVRZ scraper triggers (fire-and-forget) ─────
    // VM + SVRZ run as child processes (cold runs ~9 min), so the handler
    // returns 202 immediately and records the sync_runs heartbeat when the
    // child exits. The data-health UI polls /admin/sync-status for completion.
    // (SV / BP / GCal stay synchronous — they're in-process and fast.)
    const childSyncRunning = new Set()

    // Mint a short-lived access token from the sync service account — same
    // source the cron uses (getCronAccessToken). DIRECTUS_ADMIN_TOKEN is not a
    // valid Directus static token here, and svrz-scheduling-sync.mjs has no
    // email/password fallback, so the child must be handed a real bearer token.
    async function mintSyncToken() {
      const email = process.env.DIRECTUS_SYNC_EMAIL
      const password = process.env.DIRECTUS_SYNC_PASSWORD
      if (!email || !password) return null
      try {
        const r = await fetch('http://127.0.0.1:8055/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        })
        if (!r.ok) return null
        const { data } = await r.json()
        return data?.access_token || null
      } catch { return null }
    }

    async function triggerChildSync(source, script, extraEnv = {}) {
      if (childSyncRunning.has(source)) return { started: false, reason: 'already-running' }
      if (!process.env.VM_USERNAME || !process.env.VM_PASSWORD) {
        return { started: false, reason: 'vm-credentials-missing' }
      }
      const token = await mintSyncToken()
      if (!token) return { started: false, reason: 'sync-credentials-missing' }
      childSyncRunning.add(source)
      const startedAt = Date.now()
      const env = {
        HOME: process.env.HOME,
        PATH: process.env.PATH,
        VM_USERNAME: process.env.VM_USERNAME,
        VM_PASSWORD: process.env.VM_PASSWORD,
        DIRECTUS_URL: 'http://127.0.0.1:8055',
        DIRECTUS_TOKEN: token,
        ...extraEnv,
      }
      const child = spawn('node', [script], { env })
      let stderr = ''
      child.stderr.on('data', (c) => { stderr += c.toString() })
      const timer = setTimeout(() => child.kill('SIGKILL'), 900_000)
      const finish = async (status, errorMessage) => {
        clearTimeout(timer)
        childSyncRunning.delete(source)
        try {
          await logCronRun(database, source, { status, durationMs: Date.now() - startedAt, errorMessage: errorMessage || null })
        } catch (e) { log.error(`${source} logCronRun failed: ${e.message}`) }
      }
      child.on('error', (err) => {
        log.error({ msg: `${source} manual sync spawn error: ${err.message}`, endpoint: `admin/${source}` })
        finish('error', err.message)
      })
      child.on('close', (code) => {
        if (code === 0) { log.info(`${source} manual sync ok`); finish('ok') }
        else if (code === 75) { log.info(`${source} manual sync deferred — VM temporarily unavailable`); finish('ok', 'deferred (attempt 1): VM temporarily unavailable') }
        else { log.error({ msg: `${source} manual sync exited ${code}: ${stderr.slice(-300)}`, endpoint: `admin/${source}` }); finish('error', stderr.slice(-300) || `exited ${code}`) }
      })
      return { started: true }
    }

    router.post('/admin/vm-sync', async (req, res) => {
      try {
        requireAdmin(req, log)
        const r = await triggerChildSync('vm_sync', '/directus/scripts/vm-sync-check.mjs')
        if (!r.started) return res.status(409).json({ status: 'skipped', reason: r.reason })
        log.info('Manual VM sync triggered')
        res.status(202).json({ status: 'started' })
      } catch (err) {
        logEndpointError(log, 'admin/vm-sync', err, req)
        res.status(err.status || 500).json({ error: err.status ? err.message : 'Internal error' })
      }
    })

    router.post('/admin/svrz-sync', async (req, res) => {
      try {
        requireAdmin(req, log)
        // Resolve the current season's SVRZ uuid the same way the cron does.
        const now = new Date()
        const startYear = now.getUTCMonth() >= 5 ? now.getUTCFullYear() : now.getUTCFullYear() - 1
        const seasonName = `${startYear}/${startYear + 1}`
        const known = await database('svrz_spielplaner_contacts')
          .where('season_name', seasonName).whereNotNull('season_uuid').first()
        const seasonUuid = known?.season_uuid || 'dcafddfe-8139-4e02-baad-d3f88ec00cd0'
        const r = await triggerChildSync('svrz_sync', '/directus/scripts/svrz-scheduling-sync.mjs', {
          SVRZ_SEASON_UUID: seasonUuid, SVRZ_SEASON_NAME: seasonName,
        })
        if (!r.started) return res.status(409).json({ status: 'skipped', reason: r.reason })
        log.info('Manual SVRZ sync triggered')
        res.status(202).json({ status: 'started' })
      } catch (err) {
        logEndpointError(log, 'admin/svrz-sync', err, req)
        res.status(err.status || 500).json({ error: err.status ? err.message : 'Internal error' })
      }
    })

    // ── Shell Invite Endpoints ──────────────────────────────────

    router.get('/team-invites/info/:token', async (req, res) => {
      try {
        const invite = await database('team_invites')
          .where('token', req.params.token).where('status', 'pending').first()
        if (!invite) return res.status(404).json({ error: 'Invite not found or expired' })
        if (invite.expires_at && new Date() > new Date(invite.expires_at)) {
          return res.status(400).json({ error: 'Invite expired' })
        }
        const team = await database('teams').where('id', invite.team).first()
        res.json({
          data: {
            team_name: team?.name || 'Unknown', team_sport: team?.sport || '',
            guest_level: invite.guest_level, expires_at: invite.expires_at,
          },
        })
      } catch (err) {
        logEndpointError(log, 'team-invites/info', err, req)
        res.status(500).json({ error: 'Internal error' })
      }
    })

    router.post('/team-invites/create', async (req, res) => {
      try {
        requireAuth(req, log)
        const { team: teamId, guest_level } = req.body
        if (!teamId) return res.status(400).json({ error: 'team required' })
        const gl = parseInt(guest_level)
        if (isNaN(gl) || gl < 0 || gl > 3) return res.status(400).json({ error: 'guest_level 0-3' })

        const team = await database('teams').where('id', teamId).first()
        if (!team) return res.status(404).json({ error: 'Team not found' })

        // Permission: admin or coach/TR of this team
        const userId = req.accountability.user
        const isAdmin = req.accountability.admin
        if (!isAdmin) {
          const isCoach = await database('teams_coaches')
            .where('teams_id', teamId).where('members_id', function () {
              this.select('id').from('members').where('user', userId)
            }).first()
          const isTR = await database('teams_responsibles')
            .where('teams_id', teamId).where('members_id', function () {
              this.select('id').from('members').where('user', userId)
            }).first()
          if (!isCoach && !isTR) return res.status(403).json({ error: 'Not authorized' })
        }

        // Max 20 pending
        const pendingCount = await database('team_invites')
          .where('team', teamId).where('status', 'pending').count('id as cnt').first()
        if ((pendingCount?.cnt || 0) >= 20) {
          return res.status(400).json({ error: 'Max 20 pending invites per team' })
        }

        const token = randomToken(32)
        const expiresAt = addDays(new Date(), 7).toISOString()

        await database('team_invites').insert({
          team: teamId, token, guest_level: gl, status: 'pending',
          expires_at: expiresAt, created_by: userId,
        })

        res.json({ token, qr_url: `${FRONTEND_URL}/join?token=${token}`, expires_at: expiresAt })
      } catch (err) {
        logEndpointError(log, 'team-invites/create', err, req)
        res.status(err.status || 500).json({ error: err.status ? err.message : 'Internal error' })
      }
    })

    const teamInviteClaimIp = new Map() // ip → { count, resetAt }
    router.post('/team-invites/claim', async (req, res) => {
      try {
        // Rate limit: 5 claim attempts per 15 min per IP. The token is
        // 32 hex / 128-bit so guessing is infeasible — the limit is mostly
        // to keep brute-DoS against the team_invites table bounded.
        if (!ipRateLimit(teamInviteClaimIp, req, 5, 15 * 60 * 1000)) {
          return res.status(429).json({ error: 'Too many requests' })
        }
        const { token, first_name, last_name, email: rawEmail } = req.body
        if (!token || !first_name || !last_name || !rawEmail) {
          return res.status(400).json({ error: 'token, first_name, last_name, email required' })
        }
        const email = rawEmail.toLowerCase().trim()

        const invite = await database('team_invites')
          .where('token', token).where('status', 'pending').first()
        if (!invite) return res.status(404).json({ error: 'Invalid or expired invite' })
        if (invite.expires_at && new Date() > new Date(invite.expires_at)) {
          return res.status(400).json({ error: 'Invite expired' })
        }

        // Check email not taken
        const existing = await database('members').where('email', email).first()
        if (existing) return res.status(400).json({ error: 'Email already registered' })

        const team = await database('teams').where('id', invite.team).first()
        if (!team) return res.status(400).json({ error: 'Team not found' })

        const shellExpires = addDays(new Date(), 30).toISOString()

        // Atomic: create member + member_teams + claim invite
        const memberId = await database.transaction(async (trx) => {
          const [member] = await trx('members').insert({
            first_name, last_name, email,
            shell: true, coach_approved_team: false, wiedisync_active: true,
            shell_expires: shellExpires, shell_reminder_sent: false,
            birthdate_visibility: 'hidden', language: 'german', role: JSON.stringify(['user']),
          }).returning('id')

          const mId = member.id || member

          await trx('member_teams').insert({
            member: mId, team: invite.team, season: getCurrentSeason(),
            guest_level: invite.guest_level,
          })

          // Now member_teams exists, enable approval
          await trx('members').where('id', mId).update({ coach_approved_team: true })

          await trx('team_invites').where('id', invite.id).update({
            status: 'claimed', claimed_by: mId, claimed_at: new Date().toISOString(),
          })

          return mId
        })

        log.info(`Shell invite claimed: member ${memberId} → team ${team.name}`)
        res.json({ success: true, member_id: memberId, team_name: team.name })
      } catch (err) {
        logEndpointError(log, 'team-invites/claim', err, req)
        res.status(err.status || 500).json({ error: err.status ? err.message : 'Internal error' })
      }
    })

    router.post('/team-invites/extend', async (req, res) => {
      try {
        requireAuth(req, log)
        const { member_id } = req.body
        if (!member_id) return res.status(400).json({ error: 'member_id required' })

        const member = await database('members').where('id', member_id).first()
        if (!member) return res.status(404).json({ error: 'Member not found' })
        if (!member.shell) return res.status(400).json({ error: 'Not a shell account' })

        // Permission: admin or coach/TR of member's team
        const userId = req.accountability.user
        if (!req.accountability.admin) {
          const memberTeam = await database('member_teams').where('member', member_id).select('team').first()
          if (!memberTeam) return res.status(403).json({ error: 'Not authorized' })
          const teamId = memberTeam.team
          const isCoach = await database('teams_coaches')
            .where('teams_id', teamId).where('members_id', function () {
              this.select('id').from('members').where('user', userId)
            }).first()
          const isTR = await database('teams_responsibles')
            .where('teams_id', teamId).where('members_id', function () {
              this.select('id').from('members').where('user', userId)
            }).first()
          if (!isCoach && !isTR) return res.status(403).json({ error: 'Not authorized' })
        }

        const newExpiry = addDays(new Date(), 30).toISOString()
        await database('members').where('id', member_id).update({
          shell_expires: newExpiry, kscw_membership_active: true, shell_reminder_sent: false,
        })

        res.json({ success: true, member_id, shell_expires: newExpiry })
      } catch (err) {
        logEndpointError(log, 'team-invites/extend', err, req)
        res.status(err.status || 500).json({ error: err.status ? err.message : 'Internal error' })
      }
    })

    // ── OTP Email Verification ──────────────────────────────────
    // POST /kscw/verify-email — send 8-digit OTP for pre-registration
    // POST /kscw/verify-email/confirm — verify OTP code

    const OTP_TEMPLATES = {
      german: {
        subject: 'WiediSync — Verifizierungscode',
        title: 'Verifizierungscode',
        body: 'Verwende den folgenden Code, um deine E-Mail-Adresse zu verifizieren:',
        validityLabel: 'Gültigkeit',
        validityText: 'Dieser Code ist 10 Minuten gültig.',
        plainText: (code) => `Dein Verifizierungscode: ${code}\n\nDieser Code ist 10 Minuten gültig.`,
      },
      swiss_german: {
        subject: 'WiediSync — Verifizierigscode',
        title: 'Verifizierigscode',
        body: 'Bruuch de folgend Code, zum dini E-Mail-Adrässe z verifiziere:',
        validityLabel: 'Gültigkeit',
        validityText: 'De Code isch 10 Minute gültig.',
        plainText: (code) => `Din Verifizierigscode: ${code}\n\nDe Code isch 10 Minute gültig.`,
      },
      english: {
        subject: 'WiediSync — Verification Code',
        title: 'Verification Code',
        body: 'Use the following code to verify your email address:',
        validityLabel: 'Validity',
        validityText: 'This code is valid for 10 minutes.',
        plainText: (code) => `Your verification code: ${code}\n\nThis code is valid for 10 minutes.`,
      },
      french: {
        subject: 'WiediSync — Code de vérification',
        title: 'Code de vérification',
        body: 'Utilisez le code suivant pour vérifier votre adresse e-mail\u00a0:',
        validityLabel: 'Validité',
        validityText: 'Ce code est valable 10 minutes.',
        plainText: (code) => `Votre code de vérification : ${code}\n\nCe code est valable 10 minutes.`,
      },
      italian: {
        subject: 'WiediSync — Codice di verifica',
        title: 'Codice di verifica',
        body: 'Usa il seguente codice per verificare il tuo indirizzo e-mail:',
        validityLabel: 'Validità',
        validityText: 'Questo codice è valido per 10 minuti.',
        plainText: (code) => `Il tuo codice di verifica: ${code}\n\nQuesto codice è valido per 10 minuti.`,
      },
    }

    // In-memory IP rate limiter for OTP requests
    const otpIpAttempts = new Map() // ip → { count, resetAt }

    router.post('/verify-email', async (req, res) => {
      try {
        const { email: rawEmail, lang: clientLang } = req.body
        if (!rawEmail) return res.status(400).json({ error: 'Email required' })
        const email = rawEmail.toLowerCase().trim()

        // Rate limit: max 10 OTP requests per hour per IP
        const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown'
        const now = Date.now()
        const ipAttempt = otpIpAttempts.get(ip)
        if (ipAttempt && now < ipAttempt.resetAt) {
          if (ipAttempt.count >= 10) {
            return res.status(429).json({ error: 'Too many requests. Try again later.' })
          }
          ipAttempt.count++
        } else {
          otpIpAttempts.set(ip, { count: 1, resetAt: now + 3600000 })
        }
        // Clean stale entries
        if (otpIpAttempts.size > 1000) {
          for (const [k, v] of otpIpAttempts) { if (now > v.resetAt) otpIpAttempts.delete(k) }
        }

        // Rate limit: max 3 per hour per email
        const oneHourAgo = new Date(Date.now() - 3600000).toISOString()
        const recent = await database('email_verifications')
          .where('email', email).where('date_created', '>', oneHourAgo)
          .count('id as cnt').first()
        if ((recent?.cnt || 0) >= 3) {
          return res.status(429).json({ error: 'Too many requests. Try again later.' })
        }

        // Resolve language: member preference > client hint > german
        let lang = 'german'
        const member = await database('members').where('email', email).select('language').first()
        if (member?.language && OTP_TEMPLATES[member.language]) {
          lang = member.language
        } else if (clientLang && OTP_TEMPLATES[clientLang]) {
          lang = clientLang
        }
        const t = OTP_TEMPLATES[lang]

        // Generate 8-digit code (cryptographically secure)
        const code = String(10000000 + (crypto.randomBytes(4).readUInt32BE(0) % 90000000))
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString() // 10 min

        await database('email_verifications').insert({ email, code, expires_at: expiresAt, verified: false })

        // Send branded OTP email
        const schema = await getSchema()
        const { MailService } = services
        const mailService = new MailService({ schema, knex: database })
        const { buildEmailLayout, buildAlertBox } = await import('./email-template.js')
        const otpBody =
          `<div style="font-size:14px;color:#e2e8f0;margin-bottom:16px">${t.body}</div>` +
          '<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px"><tr><td align="center" style="padding:20px 0">' +
          `<div style="font-size:36px;font-weight:700;color:#FFC832;letter-spacing:6px;font-family:monospace">${code}</div>` +
          '</td></tr></table>' +
          buildAlertBox('info', t.validityLabel, t.validityText)
        const otpHtml = buildEmailLayout(otpBody, {
          title: t.title,
          subtitle: 'WiediSync — KSC Wiedikon',
        })
        await mailService.send({
          to: email,
          subject: t.subject,
          html: otpHtml,
          text: t.plainText(code) + `\n\nKSC Wiedikon\n${FRONTEND_URL.replace('https://', '')}`,
        })

        res.json({ success: true })
      } catch (err) {
        logEndpointError(log, 'verify-email', err, req)
        res.status(500).json({ error: 'Internal error' })
      }
    })

    // In-memory rate limiter for OTP confirm attempts (per email)
    const otpAttempts = new Map() // email → { count, resetAt }

    router.post('/verify-email/confirm', async (req, res) => {
      try {
        const { email: rawEmail, code } = req.body
        if (!rawEmail || !code) return res.status(400).json({ error: 'email and code required' })
        const email = rawEmail.toLowerCase().trim()

        // Rate limit: max 5 attempts per 15 minutes per email
        const now = Date.now()
        const attempt = otpAttempts.get(email)
        if (attempt && now < attempt.resetAt) {
          if (attempt.count >= 5) {
            return res.status(429).json({ error: 'Too many attempts. Try again later.' })
          }
          attempt.count++
        } else {
          otpAttempts.set(email, { count: 1, resetAt: now + 15 * 60 * 1000 })
        }

        const record = await database('email_verifications')
          .where('email', email).where('code', code).where('verified', false)
          .where('expires_at', '>', new Date().toISOString())
          .orderBy('id', 'desc').first()

        if (!record) return res.status(400).json({ error: 'Invalid or expired code' })

        await database('email_verifications').where('id', record.id).update({ verified: true })
        res.json({ success: true, verified: true })
      } catch (err) {
        logEndpointError(log, 'verify-email/confirm', err, req)
        res.status(500).json({ error: 'Internal error' })
      }
    })

    // ── Set Password ──────────────────────────────────────────────
    // POST /kscw/set-password
    // Three modes:
    //   1. Authenticated (Bearer token) → updates current user's password
    //   2. Token from password-reset email → validates token, sets password
    //   3. Unauthenticated (email in body) → verifies OTP was confirmed,
    //      creates Directus user if needed, sets password

    router.post('/set-password', async (req, res) => {
      try {
        const { password, email: rawEmail, token } = req.body
        const pwError = validatePassword(password)
        if (pwError) {
          return res.status(400).json({ error: pwError })
        }

        const schema = await getSchema()
        const { UsersService } = services
        const adminUsersService = new UsersService({ schema, knex: database, accountability: { admin: true } })
        let userId
        let memberId

        if (req.accountability?.user) {
          // Mode 1: Authenticated user changing password
          userId = req.accountability.user
          const member = await database('members').where('user', userId).select('id').first()
          memberId = member?.id
        } else if (token) {
          // Mode 2: Password-reset token from email link.
          // Validated against the dedicated `password_reset_tokens` table
          // (SHA-256 hash, 1h TTL, single-use) — NEVER against
          // directus_users.token, which is a full-privilege static API
          // credential (security audit 2026-05-31, migration 073).
          const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
          const row = await database('password_reset_tokens')
            .where('token_hash', tokenHash)
            .select('id', 'user', 'expires_at')
            .first()
          if (!row) {
            return res.status(400).json({ error: 'Invalid or expired token' })
          }
          // Single-use: delete up-front so the link can't be replayed even if a
          // later step fails. (Expired rows are deleted here too.)
          await database('password_reset_tokens').where('id', row.id).delete()
          if (row.expires_at && new Date() > new Date(row.expires_at)) {
            return res.status(400).json({ error: 'Invalid or expired token' })
          }
          userId = row.user
          const member = await database('members').where('user', userId).select('id').first()
          memberId = member?.id
        } else if (rawEmail) {
          // Mode 3: OTP-verified user setting initial password
          const email = rawEmail.toLowerCase().trim()

          // Verify email was OTP-confirmed AND that the verification is still
          // fresh (within the original 10-min OTP window). Without the expiry
          // bound, an abandoned `verified` row stayed usable forever
          // (security audit 2026-05-31, "accepts any verified row").
          const verification = await database('email_verifications')
            .where('email', email).where('verified', true)
            .where('expires_at', '>', new Date().toISOString())
            .orderBy('id', 'desc').first()
          if (!verification) {
            return res.status(400).json({ error: 'Invalid or expired request' })
          }

          let member = await database('members')
            .whereRaw('LOWER(email) = ?', [email]).first()
          // Fallback: check if email matches a VM-synced email (Volleymanager claim)
          if (!member) {
            member = await database('members')
              .whereRaw('LOWER(vm_email) = ?', [email])
              .whereNull('user').first()
            if (member) {
              // Update the member's email to the verified one for future logins
              await database('members').where('id', member.id).update({ email })
              log.info(`VM email claim (set-password): member ${member.id} claimed via vm_email=${email}`)
            }
          }
          if (!member) {
            // Fallback: user exists in directus_users but has no member row
            const orphanUser = await database('directus_users')
              .whereRaw('LOWER(email) = ?', [email])
              .select('id').first()
            if (!orphanUser) {
              return res.status(400).json({ error: 'No account found', code: 'no_account' })
            }
            userId = orphanUser.id
          } else {
            memberId = member.id
            // Normalise stored email to lowercase to prevent future case drift
            if (member.email && member.email !== email) {
              await database('members').where('id', member.id).update({ email })
            }
            if (member.user) {
              // Member already linked to a Directus user — update password
              userId = member.user
            } else {
              // Create Directus user and link to member
              userId = await adminUsersService.createOne({
                email, password,
                first_name: member.first_name || '',
                last_name: member.last_name || '',
              })
              await database('members').where('id', member.id).update({ user: userId })
            }
          }

          // Clean up used verifications
          await database('email_verifications').where('email', email).delete()
        } else {
          return res.status(401).json({ error: 'Authentication or email required' })
        }

        await adminUsersService.updateOne(userId, { password })
        await database('members').where('user', userId).update({ wiedisync_active: true })

        res.json({ success: true, member_id: memberId ? String(memberId) : undefined })
      } catch (err) {
        logEndpointError(log, 'set-password', err, req)
        res.status(err.status || 500).json({ error: err.status ? err.message : 'Internal error' })
      }
    })

    // ── Register (new member) ──────────────────────────────────
    // POST /kscw/register — create Directus user + member after OTP verification

    router.post('/register', async (req, res) => {
      try {
        const { email: rawEmail, password, first_name, last_name, team, language } = req.body
        if (!rawEmail || !password || !first_name || !last_name || !team) {
          return res.status(400).json({ error: 'email, password, first_name, last_name, team required' })
        }
        const pwError = validatePassword(password)
        if (pwError) {
          return res.status(400).json({ error: pwError })
        }
        const email = rawEmail.toLowerCase().trim()

        // Verify email was OTP-confirmed
        const verification = await database('email_verifications')
          .where('email', email).where('verified', true)
          .where('expires_at', '>', new Date().toISOString())
          .orderBy('id', 'desc').first()
        if (!verification) {
          return res.status(400).json({ error: 'Email not verified' })
        }

        // Check not already registered (case-insensitive; also catches directus_users
        // rows without a linked member)
        const existing = await database('members')
          .whereRaw('LOWER(email) = ?', [email]).first()
        if (existing) {
          return res.status(400).json({ error: 'Email already registered', code: 'email_exists' })
        }
        const existingDirectusUser = await database('directus_users')
          .whereRaw('LOWER(email) = ?', [email])
          .select('id').first()
        if (existingDirectusUser) {
          return res.status(400).json({ error: 'Email already registered', code: 'email_exists' })
        }

        const schema = await getSchema()
        const { UsersService } = services
        const adminUsersService = new UsersService({ schema, knex: database, accountability: { admin: true } })

        // Look up the "Member" role
        const memberRole = await database('directus_roles').where('name', 'Member').first()
        if (!memberRole) throw new Error('Member role not found in directus_roles')

        // Create Directus user with Member role
        let userId
        try {
          userId = await adminUsersService.createOne({
            email, password, first_name, last_name,
            role: memberRole.id,
          })
        } catch (createErr) {
          // Directus enforces case-insensitive uniqueness; translate to a clean error
          const msg = String(createErr?.message || '')
          if (msg.includes('has to be unique') || msg.toLowerCase().includes('unique')) {
            return res.status(400).json({ error: 'Email already registered', code: 'email_exists' })
          }
          throw createErr
        }

        // Check if signup email matches an existing member's vm_email (Volleymanager claim)
        const vmMatch = await database('members')
          .whereRaw('LOWER(vm_email) = ?', [email])
          .whereNull('user')
          .first()

        let member
        if (vmMatch) {
          // Claim: link existing VM-matched member to new Directus user
          await database('members').where('id', vmMatch.id).update({
            user: userId,
            email,
            wiedisync_active: true,
            language: language || vmMatch.language || 'german',
            requested_team: vmMatch.coach_approved_team ? null : team,
          })
          member = vmMatch
          log.info(`VM email claim: member ${vmMatch.id} (${vmMatch.first_name} ${vmMatch.last_name}) claimed via vm_email=${email}`)
        } else {
          // Create new member record linked to user
          const [newMember] = await database('members').insert({
            user: userId,
            first_name, last_name, email,
            role: JSON.stringify(['user']),
            kscw_membership_active: true,
            coach_approved_team: false,
            requested_team: team,
            wiedisync_active: true,
            language: language || 'german',
            birthdate_visibility: 'hidden',
          }).returning('id')
          member = newMember
        }

        // Clean up verification
        await database('email_verifications').where('email', email).delete()

        // Notify coaches of the requested team
        const memberId = String(member.id || member)
        try {
          const teamRow = await database('teams').where('id', team).select('name').first()
          const teamName = teamRow?.name || `Team ${team}`
          const teamUrlPath = encodeURIComponent(teamName)
          const coaches = await database('teams_coaches')
            .where('teams_id', team)
            .select('members_id')
          const trMembers = await database('teams_responsibles')
            .where('teams_id', team)
            .select('members_id')
          const recipientIds = [...new Set([...coaches, ...trMembers].map(r => r.members_id))]

          if (recipientIds.length > 0) {
            // Create in-app notifications
            const notifRows = recipientIds.map(rid => ({
              member: rid,
              type: 'member_join_request',
              title: 'member_join_request',
              body: JSON.stringify({ memberName: `${first_name} ${last_name}`, teamName }),
              activity_type: 'team',
              activity_id: teamName,
              team: team,
              read: false,
            }))
            await database('notifications').insert(notifRows)

            // Send email to each coach/TR
            const { buildEmailLayout, buildAlertBox } = await import('./email-template.js')
            const schema = await getSchema()
            const { MailService } = services
            const mailService = new MailService({ schema, knex: database })
            const coachMembers = await database('members')
              .whereIn('id', recipientIds)
              .select('email', 'first_name', 'language')
            // Per-recipient locale: members.language → 5-bucket
            const TJR_LANG_TO_CODE = { german: 'de', swiss_german: 'gsw', english: 'en', french: 'fr', italian: 'it' }
            const TJR = {
              de: {
                subject: `WiediSync — Neue Beitrittsanfrage für ${teamName}`,
                intro: `<strong>${first_name} ${last_name}</strong> möchte dem Team <strong>${teamName}</strong> beitreten.`,
                alertTitle: 'Aktion erforderlich',
                alertBody: 'Bitte genehmige oder lehne die Anfrage auf der Teamseite ab.',
                cta: 'Zur Teamseite', title: 'Neue Beitrittsanfrage',
              },
              gsw: {
                subject: `WiediSync — Neui Bytrittsaafrog für ${teamName}`,
                intro: `<strong>${first_name} ${last_name}</strong> möcht zum Team <strong>${teamName}</strong>.`,
                alertTitle: 'Aktion erforderlich',
                alertBody: 'Bitte bewillig oder läne d Aafrog uf dr Team-Site ab.',
                cta: 'Zur Team-Site', title: 'Neui Bytrittsaafrog',
              },
              en: {
                subject: `WiediSync — New join request for ${teamName}`,
                intro: `<strong>${first_name} ${last_name}</strong> wants to join team <strong>${teamName}</strong>.`,
                alertTitle: 'Action required',
                alertBody: 'Please approve or reject the request on the team page.',
                cta: 'Go to team page', title: 'New join request',
              },
              fr: {
                subject: `WiediSync — Nouvelle demande d'adhésion pour ${teamName}`,
                intro: `<strong>${first_name} ${last_name}</strong> souhaite rejoindre l'équipe <strong>${teamName}</strong>.`,
                alertTitle: 'Action requise',
                alertBody: "Merci d'approuver ou de refuser la demande sur la page de l'équipe.",
                cta: "Voir la page de l'équipe", title: "Nouvelle demande d'adhésion",
              },
              it: {
                subject: `WiediSync — Nuova richiesta di adesione per ${teamName}`,
                intro: `<strong>${first_name} ${last_name}</strong> vuole unirsi alla squadra <strong>${teamName}</strong>.`,
                alertTitle: 'Azione richiesta',
                alertBody: 'Approva o rifiuta la richiesta sulla pagina della squadra.',
                cta: 'Vai alla pagina della squadra', title: 'Nuova richiesta di adesione',
              },
            }
            for (const coach of coachMembers) {
              if (!coach.email) continue
              const code = TJR_LANG_TO_CODE[coach.language] || 'de'
              const tt = TJR[code]
              const bodyHtml =
                `<div style="font-size:14px;color:#e2e8f0;margin-bottom:16px">${tt.intro}</div>` +
                buildAlertBox('info', tt.alertTitle, tt.alertBody) +
                `<div style="text-align:center;margin-top:20px"><a href="${FRONTEND_URL}/teams/${teamUrlPath}" style="display:inline-block;padding:12px 24px;background:#4A55A2;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">${tt.cta}</a></div>`
              const html = buildEmailLayout(bodyHtml, {
                title: tt.title,
                subtitle: `WiediSync — ${teamName}`,
              })
              mailService.send({
                to: coach.email,
                subject: tt.subject,
                html,
                text: `${first_name} ${last_name} → ${teamName}\n${FRONTEND_URL}/teams/${teamUrlPath}`,
              }).catch(e => log.error(`register notify email: ${e.message}`))
            }

            // Push notifications (per-recipient locale)
            const memberName = `${first_name} ${last_name}`
            sendLocalizedPush(
              database, recipientIds,
              (ids, title, body) => sendPushToMembers(database, ids, title, body, `${FRONTEND_URL}/teams/${teamUrlPath}`, 'team', log),
              'joinRequest.title', 'joinRequest.body',
              { name: memberName, team: teamName },
            ).catch(() => {})
          }
        } catch (notifErr) {
          log.error(`register notification: ${notifErr.message}`)
        }

        log.info(`New member registered: member ${memberId} → team ${team}`)
        res.json({ success: true, member_id: memberId })
      } catch (err) {
        logEndpointError(log, 'register', err, req)
        res.status(err.status || 500).json({ error: err.status ? err.message : 'Internal error' })
      }
    })

    // ── Feedback → GitHub Issue ─────────────────────────────────
    // Auto-creates GitHub issue on feedback submission (triggered by Directus Flow or manual)

    router.post('/admin/feedback-to-github', async (req, res) => {
      try {
        requireAdmin(req, log)
        const { feedback_id } = req.body
        if (!feedback_id) return res.status(400).json({ error: 'feedback_id required' })

        const fb = await database('feedback').where('id', feedback_id).first()
        if (!fb) return res.status(404).json({ error: 'Feedback not found' })

        const GITHUB_PAT = process.env.GITHUB_PAT
        if (!GITHUB_PAT) return res.status(500).json({ error: 'GITHUB_PAT not configured' })

        const repo = fb.source === 'website' ? 'kscw-website' : 'kscw'
        const labels = fb.type === 'bug' ? ['bug', 'user-reported'] : ['enhancement', 'user-reported']

        const member = fb.user ? await database('members').where('id', fb.user).first() : null
        const submitter = member ? `Member #${fb.user}` : (fb.name || 'Anonymous')

        let body = `**Type:** ${fb.type}\n**Submitter:** ${submitter}\n\n${fb.description || ''}`
        if (fb.screenshot) {
          body += `\n\n**Screenshot:** [View](${process.env.PUBLIC_URL}/assets/${fb.screenshot})`
        }

        const ghResp = await fetch(`https://api.github.com/repos/Lucanepa/${repo}/issues`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${GITHUB_PAT}`,
            'Content-Type': 'application/json',
            Accept: 'application/vnd.github+json',
          },
          body: JSON.stringify({ title: fb.title || `[${fb.type}] ${fb.description?.slice(0, 60)}`, body, labels }),
        })

        if (ghResp.ok) {
          const issue = await ghResp.json()
          await database('feedback').where('id', feedback_id).update({
            github_issue: issue.html_url, status: 'github',
          })
          res.json({ success: true, issue_url: issue.html_url })
        } else {
          const errText = await ghResp.text()
          log.error(`GitHub issue creation failed: ${errText}`)
          res.status(500).json({ error: 'GitHub API error' })
        }
      } catch (err) {
        logEndpointError(log, 'feedback-to-github', err, req)
        res.status(err.status || 500).json({ error: err.status ? err.message : 'Internal error' })
      }
    })

    // ── Scorer Delegation Transfer ──────────────────────────────
    // POST /kscw/scorer-delegation/accept — accept incoming delegation
    // POST /kscw/scorer-delegation/decline — decline incoming delegation

    router.post('/scorer-delegation/accept', async (req, res) => {
      try {
        requireAuth(req, log)
        const { delegation_id } = req.body
        if (!delegation_id) return res.status(400).json({ error: 'delegation_id required' })

        const d = await database('scorer_delegations').where('id', delegation_id).first()
        if (!d || d.status !== 'pending') return res.status(400).json({ error: 'Invalid delegation' })

        // Verify caller is the delegation recipient
        const callerMember = await database('members').where('user', req.accountability.user).select('id').first()
        if (!callerMember || String(callerMember.id) !== String(d.to_member)) {
          return res.status(403).json({ error: 'Not authorized — only the recipient can accept' })
        }

        // Transfer: update game record with new member. Role keys match the
        // frontend's ScorerDelegation.role values and the real (English) games
        // columns — the legacy German keys (taefeler/bb_anschreiber/…) pointed
        // at non-existent columns, silently breaking scoreboard/BB/combined
        // delegations (the game member was never transferred on accept).
        const ROLE_MEMBER = {
          scorer: 'scorer_member',
          scoreboard: 'scoreboard_member',
          scorer_scoreboard: 'scorer_scoreboard_member',
          bb_scorer: 'bb_scorer_member',
          bb_timekeeper: 'bb_timekeeper_member',
          bb_24s_official: 'bb_24s_official',
        }
        const ROLE_TEAM = {
          scorer: 'scorer_duty_team',
          scoreboard: 'scoreboard_duty_team',
          scorer_scoreboard: 'scorer_scoreboard_duty_team',
          bb_scorer: 'bb_scorer_duty_team',
          bb_timekeeper: 'bb_timekeeper_duty_team',
          bb_24s_official: 'bb_24s_duty_team',
        }

        const memberField = ROLE_MEMBER[d.role]
        const teamField = ROLE_TEAM[d.role]
        if (memberField) {
          // Audit HOOK-1: this raw-knex games write bypasses the LEADER-only
          // games.update permission. Only hand off a duty the delegator actually
          // currently holds — refuse if the game's current duty member isn't the
          // sender (blocks reassigning/hijacking an arbitrary game's assignment).
          const game = await database('games').where('id', d.game).first(memberField)
          if (!game) return res.status(404).json({ error: 'Game not found' })
          if (game[memberField] == null || String(game[memberField]) !== String(d.from_member)) {
            return res.status(403).json({ error: 'Delegator no longer holds this duty' })
          }
          const updates = { [memberField]: d.to_member }
          if (teamField && !d.same_team) updates[teamField] = d.to_team
          await database('games').where('id', d.game).update(updates)
        }

        await database('scorer_delegations').where('id', delegation_id).update({ status: 'accepted' })

        // Audit EP-SCH-3: record the actor for this raw-knex duty reassignment.
        await writeUserLog(database, log, {
          accountability: req.accountability,
          action: 'update', collection: 'games', recordId: String(d.game),
          data: { what: 'scorer_delegation_accept', delegation_id, role: d.role, from_member: d.from_member, to_member: d.to_member },
        }).catch(() => {})

        // Notify sender
        await database('notifications').insert({
          member: d.from_member, type: 'duty_delegation_accepted',
          title: 'Delegation accepted', body: `Your scorer duty delegation was accepted`,
          activity_type: 'game', activity_id: String(d.game), team: d.from_team, read: false,
        })

        // Push notification (recipient locale)
        sendLocalizedPush(
          database, [d.from_member],
          (ids, title, body) => sendPushToMembers(database, ids, title, body, FRONTEND_URL, 'delegation', log),
          'delegation.accepted.title', 'delegation.accepted.body',
        ).catch(() => {})

        res.json({ success: true })
      } catch (err) {
        logEndpointError(log, 'scorer-delegation/accept', err, req)
        res.status(err.status || 500).json({ error: err.status ? err.message : 'Internal error' })
      }
    })

    router.post('/scorer-delegation/decline', async (req, res) => {
      try {
        requireAuth(req, log)
        const { delegation_id } = req.body
        if (!delegation_id) return res.status(400).json({ error: 'delegation_id required' })

        const d = await database('scorer_delegations').where('id', delegation_id).first()
        if (!d || d.status !== 'pending') return res.status(400).json({ error: 'Invalid delegation' })

        // Verify caller is the delegation recipient
        const callerMember = await database('members').where('user', req.accountability.user).select('id').first()
        if (!callerMember || String(callerMember.id) !== String(d.to_member)) {
          return res.status(403).json({ error: 'Not authorized — only the recipient can decline' })
        }

        await database('scorer_delegations').where('id', delegation_id)
          .update({ status: 'declined' })
        // Audit EP-SCH-3: record the actor for this raw-knex status mutation.
        await writeUserLog(database, log, {
          accountability: req.accountability,
          action: 'update', collection: 'scorer_delegations', recordId: String(delegation_id),
          data: { what: 'scorer_delegation_decline', role: d.role, to_member: d.to_member },
        }).catch(() => {})
        if (d) {
          await database('notifications').insert({
            member: d.from_member, type: 'duty_delegation_declined',
            title: 'Delegation declined', body: `Your scorer duty delegation was declined`,
            activity_type: 'game', activity_id: String(d.game), team: d.from_team, read: false,
          })

          // Push notification (recipient locale)
          sendLocalizedPush(
            database, [d.from_member],
            (ids, title, body) => sendPushToMembers(database, ids, title, body, FRONTEND_URL, 'delegation', log),
            'delegation.declined.title', 'delegation.declined.body',
          ).catch(() => {})
        }

        res.json({ success: true })
      } catch (err) {
        logEndpointError(log, 'scorer-delegation/decline', err, req)
        res.status(err.status || 500).json({ error: err.status ? err.message : 'Internal error' })
      }
    })

    // ── Admin: VPS Metrics ────────────────────────────────────────
    // GET /kscw/admin/vps-metrics — live VPS resource usage

    router.get('/admin/vps-metrics', async (req, res) => {
      try {
        requireAdmin(req, log)
        const { execSync } = await import('child_process')
        const run = (cmd) => execSync(cmd, { timeout: 5000 }).toString().trim()

        // Uptime
        const uptimeRaw = run('cat /proc/uptime').split(' ')[0]
        const uptimeSecs = Math.floor(parseFloat(uptimeRaw))
        const days = Math.floor(uptimeSecs / 86400)
        const hours = Math.floor((uptimeSecs % 86400) / 3600)
        const uptime = days > 0 ? `${days}d ${hours}h` : `${hours}h`

        // Load average
        const loadavg = run('cat /proc/loadavg').split(' ').slice(0, 3).join(' / ')

        // Memory (from /proc/meminfo for container-safe parsing)
        const memLines = run('cat /proc/meminfo')
        const mem = (key) => parseInt(memLines.match(new RegExp(`${key}:\\s+(\\d+)`))?.[1] || '0') * 1024
        const totalMem = mem('MemTotal')
        const freeMem = mem('MemFree')
        const buffers = mem('Buffers')
        const cached = mem('Cached')
        const usedMem = totalMem - freeMem - buffers - cached
        const memPercent = Math.round((usedMem / totalMem) * 100)

        // Disk
        const dfLine = run('df -B1 / | tail -1').split(/\s+/)
        const diskTotal = parseInt(dfLine[1])
        const diskUsed = parseInt(dfLine[2])
        const diskPercent = Math.round((diskUsed / diskTotal) * 100)

        // CPU count
        const cpuCount = parseInt(run('nproc'))

        const fmt = (bytes) => {
          if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`
          return `${Math.round(bytes / 1048576)} MB`
        }

        res.json({
          uptime,
          loadavg,
          cpu_count: cpuCount,
          memory: { used: fmt(usedMem), total: fmt(totalMem), percent: memPercent },
          disk: { used: fmt(diskUsed), total: fmt(diskTotal), percent: diskPercent },
        })
      } catch (err) {
        logEndpointError(log, 'admin/vps-metrics', err, req)
        res.status(err.status || 500).json({ error: err.status ? err.message : 'Internal error' })
      }
    })

    // ── Admin: Slow Queries ────────────────────────────────────────
    // GET /kscw/admin/slow-queries — top queries by avg execution time

    router.get('/admin/slow-queries', async (req, res) => {
      try {
        requireAdmin(req, log)
      } catch (err) {
        return res.status(err.status || 403).json({ error: err.message })
      }
      try {
        const limit = Math.min(parseInt(req.query.limit) || 20, 50)
        const result = await database.raw(
          'SELECT round(s.total_exec_time::numeric, 1) AS total_ms, s.calls, round(s.mean_exec_time::numeric, 1) AS avg_ms, round(s.max_exec_time::numeric, 1) AS max_ms, s.rows, left(s.query, 200) AS query FROM extensions.pg_stat_statements s WHERE s.dbid = (SELECT oid FROM pg_database WHERE datname = current_database()) AND s.calls > 0 ORDER BY s.mean_exec_time DESC LIMIT ?',
          [limit]
        )
        return res.json({ data: result.rows ?? result })
      } catch (err) {
        log.error({ msg: 'slow-queries error', error: err.message })
        return res.status(500).json({ error: err.message })
      }
    })

    // ── Admin: Error Logs ────────────────────────────────────────
    // GET /kscw/admin/error-logs — read persistent error log files
    // Query: ?date=YYYY-MM-DD (default: today), &level=error|warn, &endpoint=xxx,
    //        &userId=xxx, &event=xxx, &limit=200, &search=xxx

    const ERROR_LOG_DIR = process.env.ERROR_LOG_DIR || '/directus/logs'

    router.get('/admin/error-logs', async (req, res) => {
      try {
        requireAdmin(req, log)

        const date = req.query.date || new Date().toISOString().slice(0, 10)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' })
        }
        const limit = Math.min(parseInt(req.query.limit) || 200, 1000)
        const levelFilter = req.query.level || null
        const endpointFilter = req.query.endpoint || null
        const userIdFilter = req.query.userId || null
        const eventFilter = req.query.event || null
        const projectFilter = req.query.project || null
        const searchFilter = req.query.search ? String(Array.isArray(req.query.search) ? req.query.search.join(' ') : req.query.search) : null
        const showSolved = req.query.show_solved === 'true'

        const logPath = path.join(ERROR_LOG_DIR, `errors-${date}.jsonl`)

        if (!fs.existsSync(logPath)) {
          return res.json({ data: [], date, total: 0, message: 'No log file for this date' })
        }

        const raw = fs.readFileSync(logPath, 'utf-8')
        const lines = raw.trim().split('\n').filter(Boolean)

        let entries = lines.map(line => {
          try { return JSON.parse(line) } catch { return null }
        }).filter(Boolean)

        // Compute hashes and merge annotations
        const hashes = entries.map(e => computeErrorHash(e))
        const annotations = await database('error_annotations')
          .whereIn('error_hash', [...new Set(hashes)])
        const annoMap = Object.fromEntries(annotations.map(a => [a.error_hash, a]))

        entries = entries.map((e, i) => {
          const anno = annoMap[hashes[i]]
          return {
            ...e,
            _hash: hashes[i],
            _annotation: anno ? { status: anno.status, note: anno.note, resolved_commit: anno.resolved_commit, date_updated: anno.date_updated } : null,
          }
        })

        // Hide solved by default
        if (!showSolved) {
          entries = entries.filter(e => e._annotation?.status !== 'solved')
        }

        // ── Enrich with human-readable context ──────────────────
        // Batch-lookup userIds → member name, role, teams/sports
        const uniqueUserIds = [...new Set(entries.map(e => e.userId).filter(Boolean))]
        const userMap = {}
        if (uniqueUserIds.length) {
          const members = await database('members')
            .select('members.id as member_id', 'members.first_name', 'members.last_name', 'members.role', 'members.user')
            .whereIn('members.user', uniqueUserIds)
          const memberIds = members.map(m => m.member_id)
          let teamsByMember = {}
          if (memberIds.length) {
            const mt = await database('member_teams')
              .join('teams', 'member_teams.team', 'teams.id')
              .select('member_teams.member', 'teams.name as team_name', 'teams.sport')
              .whereIn('member_teams.member', memberIds)
            for (const row of mt) {
              if (!teamsByMember[row.member]) teamsByMember[row.member] = []
              teamsByMember[row.member].push({ team: row.team_name, sport: row.sport })
            }
          }
          for (const m of members) {
            userMap[m.user] = {
              name: `${m.first_name} ${m.last_name}`,
              role: m.role,
              teams: teamsByMember[m.member_id] || [],
            }
          }
        }

        // Batch-lookup recordIds for known collections
        const recordGroups = {}
        for (const e of entries) {
          if (e.recordId && e.recordId !== 'null' && e.collection) {
            if (!recordGroups[e.collection]) recordGroups[e.collection] = new Set()
            recordGroups[e.collection].add(e.recordId)
          }
        }
        const recordMap = {}
        const LABEL_QUERIES = {
          teams:   { fields: ['name', 'sport'] },
          members: { fields: ['first_name', 'last_name'] },
          games:   { fields: ['home_team', 'away_team', 'date'] },
        }
        for (const [col, ids] of Object.entries(recordGroups)) {
          const cfg = LABEL_QUERIES[col]
          if (!cfg) continue
          try {
            const rows = await database(col).select('id', ...cfg.fields).whereIn('id', [...ids])
            for (const r of rows) {
              let label, sport
              if (col === 'teams') {
                label = r.name; sport = r.sport
              } else if (col === 'members') {
                label = `${r.first_name} ${r.last_name}`
              } else if (col === 'games') {
                label = `${r.home_team || '?'} vs ${r.away_team || '?'}`
              }
              recordMap[`${col}:${r.id}`] = { label, ...(sport ? { sport } : {}) }
            }
          } catch { /* collection might not exist or have different schema */ }
        }

        // Attach _context to each entry
        entries = entries.map(e => {
          const ctx = {}
          if (e.userId && userMap[e.userId]) {
            ctx.user = userMap[e.userId]
          }
          const rk = e.recordId && e.recordId !== 'null' && e.collection ? `${e.collection}:${e.recordId}` : null
          if (rk && recordMap[rk]) {
            ctx.record = recordMap[rk]
          }
          return Object.keys(ctx).length ? { ...e, _context: ctx } : e
        })

        // Apply filters (after enrichment so search covers _context fields)
        if (levelFilter) entries = entries.filter(e => e.level === levelFilter)
        if (endpointFilter) entries = entries.filter(e => e.endpoint?.includes(endpointFilter))
        if (userIdFilter) entries = entries.filter(e => e.userId === userIdFilter)
        if (eventFilter) entries = entries.filter(e => e.event === eventFilter)
        if (projectFilter) entries = entries.filter(e => (e.project || 'wiedisync') === projectFilter)
        if (searchFilter) {
          const q = searchFilter.toLowerCase()
          entries = entries.filter(e => JSON.stringify(e).toLowerCase().includes(q))
        }

        // Most recent first, capped by limit
        entries = entries.reverse().slice(0, limit)

        res.json({ data: entries, date, total: entries.length })
      } catch (err) {
        logEndpointError(log, 'admin/error-logs', err, req)
        res.status(err.status || 500).json({ error: err.status ? err.message : 'Internal error' })
      }
    })

    // GET /kscw/admin/error-logs/dates — list available log dates
    router.get('/admin/error-logs/dates', async (req, res) => {
      try {
        requireAdmin(req, log)
        const files = fs.readdirSync(ERROR_LOG_DIR)
          .filter(f => f.startsWith('errors-') && f.endsWith('.jsonl'))
          .map(f => {
            const date = f.replace('errors-', '').replace('.jsonl', '')
            const stat = fs.statSync(path.join(ERROR_LOG_DIR, f))
            return { date, size: stat.size, lines: fs.readFileSync(path.join(ERROR_LOG_DIR, f), 'utf-8').trim().split('\n').length }
          })
          .sort((a, b) => b.date.localeCompare(a.date))
        res.json({ data: files })
      } catch (err) {
        logEndpointError(log, 'admin/error-logs/dates', err, req)
        res.status(err.status || 500).json({ error: err.status ? err.message : 'Internal error' })
      }
    })

    // POST /kscw/admin/error-logs/annotate — create or update a single annotation
    router.post('/admin/error-logs/annotate', async (req, res) => {
      try {
        requireAdmin(req, log)
        const { error_hash, error_date, status, note, resolved_commit } = req.body
        if (!error_hash || !error_date) {
          return res.status(400).json({ error: 'error_hash and error_date are required' })
        }
        if (status && !['open', 'solved', 'important'].includes(status)) {
          return res.status(400).json({ error: 'status must be open, solved, or important' })
        }

        const result = await database.raw(`
          INSERT INTO error_annotations (error_hash, error_date, status, note, resolved_commit, user_created)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT (error_hash) DO UPDATE SET
            status = COALESCE(EXCLUDED.status, error_annotations.status),
            note = COALESCE(EXCLUDED.note, error_annotations.note),
            resolved_commit = COALESCE(EXCLUDED.resolved_commit, error_annotations.resolved_commit),
            date_updated = NOW()
          RETURNING *
        `, [error_hash, error_date, status || 'open', note || null, resolved_commit || null, req.accountability?.user || null])

        res.json({ data: result.rows[0] })
      } catch (err) {
        logEndpointError(log, 'admin/error-logs/annotate', err, req)
        res.status(err.status || 500).json({ error: err.status ? err.message : 'Internal error' })
      }
    })

    // POST /kscw/admin/error-logs/annotate-bulk — annotate multiple entries at once
    router.post('/admin/error-logs/annotate-bulk', async (req, res) => {
      try {
        requireAdmin(req, log)
        const { error_hashes, error_date, status, note, resolved_commit } = req.body
        if (!Array.isArray(error_hashes) || !error_hashes.length || !error_date) {
          return res.status(400).json({ error: 'error_hashes[] and error_date are required' })
        }
        if (status && !['open', 'solved', 'important'].includes(status)) {
          return res.status(400).json({ error: 'status must be open, solved, or important' })
        }

        const userId = req.accountability?.user || null
        const now = new Date().toISOString()
        const rows = error_hashes.map(h => ({
          error_hash: h,
          error_date: error_date,
          status: status || 'solved',
          note: note || null,
          resolved_commit: resolved_commit || null,
          user_created: userId,
          date_created: now,
          date_updated: now,
        }))
        await database('error_annotations')
          .insert(rows)
          .onConflict('error_hash')
          .merge(['status', 'note', 'resolved_commit', 'date_updated'])

        const result = await database('error_annotations')
          .whereIn('error_hash', error_hashes)
          .select('*')

        res.json({ data: result, count: result.length })
      } catch (err) {
        logEndpointError(log, 'admin/error-logs/annotate-bulk', err, req)
        res.status(err.status || 500).json({ error: err.status ? err.message : 'Internal error' })
      }
    })

    // GET /kscw/admin/error-logs/annotations — list annotations, optionally filtered
    router.get('/admin/error-logs/annotations', async (req, res) => {
      try {
        requireAdmin(req, log)
        const statusFilter = req.query.status || null
        const dateFilter = req.query.date || null

        let query = database('error_annotations').orderBy('date_updated', 'desc').limit(200)
        if (statusFilter) query = query.where('status', statusFilter)
        if (dateFilter) query = query.where('error_date', dateFilter)

        const rows = await query
        res.json({ data: rows, total: rows.length })
      } catch (err) {
        logEndpointError(log, 'admin/error-logs/annotations', err, req)
        res.status(err.status || 500).json({ error: err.status ? err.message : 'Internal error' })
      }
    })

    // ── Register sub-modules ────────────────────────────────────
    registerPasswordReset(router, ctx)
    registerICalFeed(router, ctx)
    registerPublicEvents(router, ctx)
    registerGCalSync(router, ctx)
    registerSchulferienSync(router, ctx)
    registerScorerReminders(router, ctx)
    registerScorerContacts(router, ctx)
    registerScorerRoster(router, ctx)
    registerGameScheduling(router, ctx)
    registerSchedulingMailbox(router, ctx)
    registerContactForm(router, ctx)
    registerWebPush(router, ctx)
    registerStats(router, ctx)
    registerRegistration(router, ctx)
    registerNewsletter(router, ctx)
    registerNewsletterDigest(router, ctx)
    registerClubdeskUpdate(router, ctx)
    registerBugfixes(router, ctx)
    registerEventNotify(router, ctx)
    registerForms(router, ctx, { logEndpointError, requireAuth })
    registerPublicForms(router, ctx, { ipRateLimit })
    registerMessaging(router, ctx)
    registerBroadcastRoutes(router, ctx)
    registerActivitiesWithParticipations(router, ctx)
    registerSvLicence(router, ctx)
    registerMigrationsStatus(router, ctx)
    registerSyncStatus(router, ctx)
    registerAudit(router, ctx)
    registerOpnform(router, ctx)
    registerWadmin(router, ctx)
    registerSqlWorkspace(router, ctx)
    registerSqlAi(router, ctx)
    registerExpenseUpload(router, ctx)
    registerFinance(router, ctx)
    registerFinanceCamt(router, ctx)

    log.info('KSCW endpoints loaded: ~63 routes')
  },
}
