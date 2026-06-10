/**
 * KSCW Directus Hooks Extension — Lean Version
 *
 * Most validation & notification logic has been pushed to Postgres triggers:
 *   - trg_slot_claims_validate      (past dates, duplicate claims)
 *   - trg_members_shell_convert     (shell→full on password set)
 *   - trg_members_coach_approval_guard (coach_approved requires member_teams)
 *   - trg_participations_guest_block (guests can't confirm games)
 *   - trg_trainings_revoke_claims   (auto-revoke on uncancelling)
 *   - trg_games_notify              (batch notifications on game CRUD)
 *   - trg_trainings_notify          (batch notifications on training CRUD)
 *   - trg_events_notify             (batch notifications on event CRUD)
 *   - trg_scorer_delegation_validate (same-team auto-accept)
 *   - Postgres DEFAULT values: members.language='german', birthdate_visibility='full'
 *
 * This extension only handles logic that CANNOT run in Postgres:
 *   1. Auth hooks (wiedisync_active on login — needs Directus auth event)
 *   2. Crons with email/HTTP (participation reminders, scorer reminders, shell lifecycle)
 *   3. Notification cleanup (old notifications)
 */

import { logCronError, logCronRun, logWarning, logAuthDenial, cleanOldLogs, writeErrorLog } from '../../kscw-endpoints/src/error-log.js'
import { initSentry } from '../../kscw-endpoints/src/sentry.js'
import { buildEmailLayout, buildInfoCard, buildAlertBox, bucketEmailsByLocale } from '../../kscw-endpoints/src/email-template.js'
import { sendLocalizedPush, bucketMembersByLocale, tPush } from '../../kscw-endpoints/src/push-i18n.js'
import { registerAuditHook } from './audit.js'
import { sanitizeAnnouncementHtml } from './sanitize-html.js'
import { snapshotSlot, cascadeSlotUpdate, generateInitialTrainings, topUpIndefiniteSlots } from './slot-cascade.js'

// Frontend URL — env var or auto-detect from Directus PUBLIC_URL
const FRONTEND_URL = process.env.FRONTEND_URL
  || (process.env.PUBLIC_URL?.includes('directus-dev') ? 'https://wiedisync.pages.dev' : 'https://wiedisync.kscw.ch')

// Escape user/admin-supplied text before interpolating into outbound email
// HTML. Used by registration rejection emails and any other place where a
// human-controlled string lands in an `html:` mail body.
function escapeEmailHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Strictly-validated YYYY-MM-DD date string for safe interpolation into
// `database.raw` SQL templates. PG `date` columns come back as `Date` or
// `string` depending on the driver — both paths funnel through this guard
// before reaching SQL text. Returns null when the input doesn't match the
// shape (caller must abort / skip rather than continue with an injection-
// shaped value). 2026-05-12 audit finding #9.
function safeDateStr(input) {
  if (!input) return null
  const raw = input?.toISOString?.().split('T')[0] || String(input).split('T')[0]
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null
}

const PUSH_WORKER_URL = process.env.PUSH_WORKER_URL || 'https://kscw-push.lucanepa.workers.dev'
const PUSH_AUTH_SECRET = process.env.PUSH_AUTH_SECRET || ''

async function sendPushToMembers(db, memberIds, title, body, url, tag, log) {
  if (!memberIds || memberIds.length === 0 || !PUSH_AUTH_SECRET) return
  try {
    const subscriptions = await db('push_subscriptions')
      .whereIn('member', memberIds)
      .select('endpoint', 'keys_p256dh', 'keys_auth')
    if (subscriptions.length === 0) return

    const resp = await fetch(`${PUSH_WORKER_URL}/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${PUSH_AUTH_SECRET}`,
      },
      body: JSON.stringify({
        subscriptions: subscriptions.map(s => ({
          endpoint: s.endpoint,
          keys: { p256dh: s.keys_p256dh, auth: s.keys_auth },
        })),
        title: title || 'KSC Wiedikon',
        body: body || '',
        url: url || FRONTEND_URL,
        ...(tag ? { tag } : {}),
      }),
      signal: AbortSignal.timeout(15000),
    })

    if (resp.ok) {
      const data = await resp.json()
      // Clean up expired subscriptions
      if (data.expired?.length > 0) {
        await db('push_subscriptions').whereIn('endpoint', data.expired).delete()
      }
      log.info(`[push] Sent ${data.sent || 0}, failed ${data.failed || 0}, cleaned ${data.expired?.length || 0}`)
    }
  } catch (err) {
    log.warn({ msg: `[push] Failed: ${err.message}`, event: 'push_send', memberCount: memberIds?.length, stack: err.stack })
    logWarning('push_send_failed', err.message, { memberCount: memberIds?.length, stack: err.stack })
  }
}

// Junction create payloads deliver the related field as a bare id OR a
// junction-object (`{ id: 108 }`, the M2M write format the app uses) — unwrap
// to a scalar so it can be used directly in `.where('id', …)`.
function toIdValue(v) {
  return v && typeof v === 'object' ? (v.id ?? v) : v
}

// ── Role Sync ────────────────────────────────────────────────────
// Keeps each member's Directus user role in sync with their app role
// (members.role array) and coach/TR junction membership.
//
// Directus 11: one role per user, multiple policies per role.
// Priority: superuser/admin > Sport Admin > Vorstand+Coach > Vorstand > Team Responsible > Member

/**
 * Determine the correct Directus role for a member.
 * @returns {{ userId: string, roleName: string } | null}
 */
async function resolveDirectusRole(db, memberId) {
  const member = await db('members').where('id', memberId).select('role', 'user').first()
  if (!member || !member.user) return null

  const roles = Array.isArray(member.role) ? member.role : []

  if (roles.includes('superuser') || roles.includes('admin')) {
    return { userId: member.user, roleName: 'Superuser' }
  }
  if (roles.includes('vb_admin') || roles.includes('bb_admin')) {
    return { userId: member.user, roleName: 'Sport Admin' }
  }

  // Check coach/TR junctions
  const isCoach = await db('teams_coaches').where('members_id', memberId).first()
  const isTR = await db('teams_responsibles').where('members_id', memberId).first()
  const isTeamResponsible = !!(isCoach || isTR)

  // Vorstand who is also a coach → Team Responsible (higher write access)
  if (roles.includes('vorstand') && isTeamResponsible) {
    return { userId: member.user, roleName: 'Team Responsible' }
  }
  if (roles.includes('vorstand')) {
    return { userId: member.user, roleName: 'Vorstand' }
  }
  if (isTeamResponsible) {
    return { userId: member.user, roleName: 'Team Responsible' }
  }

  return { userId: member.user, roleName: 'Member' }
}

// ── Turnstile CAPTCHA ────────────────────────────────────────────
// Directus filter hooks don't receive HTTP headers, so we use AsyncLocalStorage
// to bridge the X-Turnstile-Token header from middleware into filter hooks.
import { AsyncLocalStorage } from 'node:async_hooks'

const turnstileStore = new AsyncLocalStorage()
const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET || ''

async function verifyTurnstile(token) {
  if (!TURNSTILE_SECRET) return true // skip in dev
  if (!token) return false
  const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret: TURNSTILE_SECRET, response: token }).toString(),
  })
  const data = await resp.json()
  return data.success === true
}

// Why password auth instead of a static admin token:
// Directus can silently invalidate static tokens on role/schema changes,
// which caused SV/BP syncs to log "401 Invalid user credentials" unnoticed.
// Logging in per-run exchanges env credentials for a short-lived access_token,
// which is resilient to those invalidations.
async function getCronAccessToken(log, contextName) {
  const email = process.env.DIRECTUS_SYNC_EMAIL
  const password = process.env.DIRECTUS_SYNC_PASSWORD
  if (!email || !password) {
    log.warn(`${contextName} skipped: DIRECTUS_SYNC_EMAIL or DIRECTUS_SYNC_PASSWORD not set`)
    return null
  }
  const r = await fetch('http://localhost:8055/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!r.ok) {
    const body = await r.text().catch(() => '')
    throw new Error(`auth/login ${r.status}: ${body.slice(0, 200)}`)
  }
  const { data } = await r.json()
  if (!data?.access_token) throw new Error('auth/login returned no access_token')
  return data.access_token
}

export default ({ action, filter, init, schedule }, { services, database, logger, getSchema }) => {
  initSentry().catch(() => {})
  const log = logger.child({ extension: 'kscw-hooks' })

  // ── 0. Turnstile Middleware + Filter Hooks ─────────────────────
  // Capture X-Turnstile-Token from request headers via AsyncLocalStorage,
  // then validate in filter hooks for public item creation.

  init('middlewares.before', ({ app }) => {
    app.use((req, _res, next) => {
      const token = req.headers['x-turnstile-token'] || ''
      turnstileStore.run({ turnstileToken: token }, next)
    })
  })

  // Block unauthenticated members.create / feedback.create / event_signups.create without valid Turnstile
  filter('items.create', async (payload, meta, context) => {
    const collection = meta.collection
    if (collection !== 'members' && collection !== 'feedback' && collection !== 'event_signups') return payload

    // Skip for authenticated users (admins creating members, logged-in feedback)
    if (context.accountability?.user) return payload

    // Skip in dev (no secret configured)
    if (!TURNSTILE_SECRET) return payload

    const store = turnstileStore.getStore()
    const token = store?.turnstileToken
    if (!(await verifyTurnstile(token))) {
      log.warn({
        msg: 'Turnstile CAPTCHA failed on public create',
        collection,
        event: 'captcha_failed',
      })
      logWarning('captcha_failed', 'Turnstile verification failed', { collection })
      const err = new Error('Captcha verification failed')
      err.status = 403
      throw err
    }
    return payload
  })

  // ── Feedback screenshots → private folder (security audit 2026-05-31) ──────
  // Anon can fetch any uploaded file via GET /assets/:id; the public
  // directus_files read is scoped to FOLDER-LESS files (setup-permissions.mjs),
  // so move feedback screenshots — which can contain a member's authenticated
  // screen / PII — into a private folder on create/update. /assets then 403s
  // them for anon while the folder-less public photos keep serving. The folder
  // is created by migration 074 with this fixed UUID on every environment.
  const FEEDBACK_FILES_FOLDER = 'feedbac0-0000-4000-8000-000000000001'
  async function quarantineFeedbackScreenshot(feedbackId) {
    try {
      if (!feedbackId) return
      const row = await database('feedback').where('id', feedbackId).select('screenshot').first()
      if (row?.screenshot) {
        await database('directus_files').where('id', row.screenshot).update({ folder: FEEDBACK_FILES_FOLDER })
      }
    } catch (err) {
      log.error({ msg: `[feedback-quarantine] ${err.message}`, event: 'feedback_quarantine', stack: err.stack })
    }
  }
  action('feedback.items.create', async ({ key }) => { await quarantineFeedbackScreenshot(key) })
  action('feedback.items.update', async ({ keys }) => {
    for (const k of (Array.isArray(keys) ? keys : [])) await quarantineFeedbackScreenshot(k)
  })

  // ── 0b. Cascade: Directus user deletion → delete linked member ──
  // When a user is deleted from Directus admin UI, also delete the linked member.
  // The Postgres CASCADE constraints then clean up all member-owned data.

  // Capture member IDs before user deletion (filter runs before delete)
  const pendingUserDeletes = new Map()

  filter('users.delete', async (keys) => {
    try {
      const members = await database('members').whereIn('user', keys).select('id', 'user', 'email')
      for (const m of members) {
        pendingUserDeletes.set(m.user, { memberId: m.id, email: m.email })
      }
    } catch (e) {
      log.warn({ msg: `user-delete cascade lookup failed: ${e.message}`, event: 'cascade_delete' })
    }
    return keys
  })

  action('users.delete', async ({ keys }) => {
    for (const userId of keys) {
      const pending = pendingUserDeletes.get(userId)
      if (!pending) continue
      pendingUserDeletes.delete(userId)
      try {
        // Clean up email verifications (not FK-linked)
        if (pending.email) {
          await database('email_verifications').where('email', pending.email).delete()
        }
        // Delete member — CASCADE handles all child records
        await database('members').where('id', pending.memberId).delete()
        log.info(`[cascade] Deleted member ${pending.memberId} (user ${userId} deleted from admin)`)
      } catch (err) {
        log.error({ msg: `[cascade] Member delete failed for ${pending.memberId}: ${err.message}`, event: 'cascade_delete', userId, memberId: pending.memberId, stack: err.stack })
        logCronError('cascade_delete', err, { userId, memberId: pending.memberId })
      }
    }
  })

  // ── 0c. Cascade: Member deletion → delete linked Directus user ──
  // When a member is deleted from the admin UI, also delete the linked directus_user.
  // Without this, deleting a member orphans the user record.

  const pendingMemberDeletes = new Map()

  filter('members.items.delete', async (keys) => {
    try {
      const members = await database('members').whereIn('id', keys).select('id', 'user')
      for (const m of members) {
        if (m.user) pendingMemberDeletes.set(m.id, m.user)
      }
    } catch (e) {
      log.warn({ msg: `member-delete cascade lookup failed: ${e.message}`, event: 'cascade_delete' })
    }
    return keys
  })

  action('members.items.delete', async ({ keys }) => {
    for (const memberId of keys) {
      const userId = pendingMemberDeletes.get(memberId)
      if (!userId) continue
      pendingMemberDeletes.delete(memberId)
      try {
        await database('directus_users').where('id', userId).delete()
        log.info(`[cascade] Deleted user ${userId} (member ${memberId} deleted from admin)`)
      } catch (err) {
        log.error({ msg: `[cascade] User delete failed for ${userId}: ${err.message}`, event: 'cascade_delete', userId, memberId, stack: err.stack })
        logCronError('cascade_delete', err, { userId, memberId })
      }
    }
  })

  // ── 1. Wiedisync Active on Auth ─────────────────────────────────
  // Mark wiedisync_active=true on successful login
  // (Can't be a Postgres trigger because Directus auth doesn't write to members table)

  action('auth.login', async ({ user }) => {
    if (!user) return
    try {
      await database('members')
        .where('user', user)
        .where('wiedisync_active', false)
        .update({ wiedisync_active: true })
    } catch (err) {
      log.warn({ msg: `wiedisync_active: ${err.message}`, event: 'auth.login', userId: user, stack: err.stack })
      logWarning('auth_login_hook', err.message, { userId: user, stack: err.stack })
    }
  })

  // ── 1b. Role Sync — keep Directus user role in sync ─────────────
  // When members.role changes or coach/TR junctions change, update the
  // linked Directus user's role to the correct tier.

  let roleNameToId = null

  async function getRoleMap() {
    if (roleNameToId) return roleNameToId
    const roles = await database('directus_roles').select('id', 'name')
    roleNameToId = Object.fromEntries(roles.map(r => [r.name, r.id]))
    return roleNameToId
  }

  async function syncMemberRole(memberId) {
    try {
      const map = await getRoleMap()
      const result = await resolveDirectusRole(database, memberId)
      if (!result) return

      const roleId = map[result.roleName]
      if (!roleId) {
        log.warn(`[role-sync] Role "${result.roleName}" not found in Directus`)
        return
      }

      const currentUser = await database('directus_users').where('id', result.userId).select('role').first()
      if (currentUser && currentUser.role !== roleId) {
        await database('directus_users').where('id', result.userId).update({ role: roleId })
        log.info(`[role-sync] Member ${memberId} → ${result.roleName}`)
      }
    } catch (err) {
      log.warn({ msg: `[role-sync] Failed for member ${memberId}: ${err.message}`, event: 'role_sync', memberId, stack: err.stack })
      logWarning('role_sync', err.message, { memberId, stack: err.stack })
    }
  }

  // Defense-in-depth: strip `role` from the update payload unless the caller
  // is admin / superuser. The Directus field-level permission on members.role
  // SHOULD be admin-only — but the action hook below escalates `members.role`
  // to a Directus user role, so a single misconfigured field perm would let
  // any member self-promote to Superuser. Fail closed at the filter layer.
  filter('members.items.update', async (payload, _meta, context) => {
    if (!payload || !('role' in payload)) return payload
    const userId = context?.accountability?.user
    if (!userId) return payload // system-context update (cron/hook) — trust
    const m = await database('members').where('user', userId).select('role').first()
    const roles = Array.isArray(m?.role) ? m.role : []
    if (roles.includes('admin') || roles.includes('superuser')) return payload
    delete payload.role
    log.warn({ msg: '[role-sync] non-admin attempted members.role update — stripped', userId })
    return payload
  })

  // Same guard on CREATE. Directus does NOT enforce field-level permission
  // filters on create payloads, so without this a non-admin members.create
  // could smuggle `role:["superuser"]` — which the action('members.items.create')
  // → syncMemberRole path would then escalate to a Directus Superuser role.
  // System context (no accountability.user — cron/hook/registration backend)
  // and admins keep their role write; everyone else gets `role` stripped.
  filter('members.items.create', async (payload, _meta, context) => {
    if (!payload || !('role' in payload)) return payload
    const userId = context?.accountability?.user
    if (!userId) return payload // system-context create (cron/hook) — trust
    const m = await database('members').where('user', userId).select('role').first()
    const roles = Array.isArray(m?.role) ? m.role : []
    if (roles.includes('admin') || roles.includes('superuser')) return payload
    delete payload.role
    log.warn({ msg: '[role-sync] non-admin attempted members.role on create — stripped', userId })
    return payload
  })

  // Sync when members.role array changes
  action('members.items.update', async ({ keys, payload }) => {
    if (payload && 'role' in payload) {
      for (const id of keys) await syncMemberRole(id)
    }
    // Sync member photo → directus_users.avatar
    if (payload && 'photo' in payload) {
      for (const id of keys) {
        try {
          const member = await database('members').where('id', id).select('user', 'photo').first()
          if (member?.user) {
            await database('directus_users').where('id', member.user).update({ avatar: member.photo })
          }
        } catch (err) {
          logWarning('photo_sync', err.message, { memberId: id, stack: err.stack })
        }
      }
    }
    // is_spielplaner flipped → attach/revoke the TERMINPLANUNG policy so the
    // backend game_scheduling_* API tracks the flag without a setup-perms re-run.
    if (payload && 'is_spielplaner' in payload) {
      for (const id of keys) {
        if (payload.is_spielplaner === true) await ensureTerminplanungAccess(id)
        else await revokeTerminplanungAccessIfNotSpielplaner(id)
      }
    }
    // Auto-confirm opt-in flipped on (migration 077) → backfill existing
    // upcoming activities of that type. Idempotent (NOT EXISTS), so a no-op
    // when the flag was already on or nothing is outstanding.
    if (payload && (payload.auto_confirm_trainings === true || payload.auto_confirm_games === true || payload.auto_confirm_events === true)) {
      for (const id of keys) {
        try {
          let n = 0
          if (payload.auto_confirm_trainings === true) n += await backfillMemberAutoConfirm(id, 'training')
          if (payload.auto_confirm_games === true) n += await backfillMemberAutoConfirm(id, 'game')
          if (payload.auto_confirm_events === true) n += await backfillMemberAutoConfirm(id, 'event')
          if (n > 0) log.info(`[auto-confirm-backfill] member ${id}: ${n} participations confirmed`)
        } catch (err) {
          log.error({ msg: `[auto-confirm-backfill] member ${id}: ${err.message}`, event: 'auto_confirm_backfill_failed', memberId: id, stack: err.stack })
        }
      }
    }
  })

  // ── Direct LEADER policy attachment ─────────────────────────────
  // Permission gating MUST NOT depend on the Directus role alone — custom
  // roles (e.g. "Website Admin"), missed sync events, or manual role edits
  // can leave a real coach/TR without the LEADER policy. Mirror role-sync
  // with a user-level directus_access row attached to the LEADER policy.
  // The LEADER policy's writes are already self-scoped via M2M filters, so
  // an extra attachment can't widen access beyond what the user's data
  // already proves.

  async function getLeaderPolicyId() {
    const row = await database('directus_policies').where('name', 'KSCW Team Responsible').select('id').first()
    return row?.id ?? null
  }

  async function ensureLeaderAccess(memberId) {
    try {
      const member = await database('members').where('id', memberId).select('user').first()
      if (!member?.user) return
      const policyId = await getLeaderPolicyId()
      if (!policyId) return
      const existing = await database('directus_access')
        .where({ user: member.user, policy: policyId })
        .first()
      if (existing) return
      const { randomUUID } = await import('node:crypto')
      await database('directus_access').insert({ id: randomUUID(), user: member.user, policy: policyId })
      log.info(`[leader-access] Attached LEADER policy to user ${member.user} (member ${memberId})`)
    } catch (err) {
      log.warn({ msg: `[leader-access] attach failed for member ${memberId}: ${err.message}`, memberId, stack: err.stack })
      logWarning('leader_access_attach', err.message, { memberId, stack: err.stack })
    }
  }

  // ── Direct TERMINPLANUNG policy attachment ──────────────────────
  // Mirrors the LEADER pattern: the `KSCW Terminplanung` policy (club-wide
  // game-scheduling, CRUD on game_scheduling_*) is layered per-user via a
  // directus_access row, gated on members.is_spielplaner. Keeps the backend
  // items-API access in lockstep with the flag so admins don't have to re-run
  // setup-permissions.mjs after toggling it. setup-permissions.mjs §12 still
  // performs the same attach/revoke as an idempotent reconcile on every deploy.
  async function getTerminplanungPolicyId() {
    const row = await database('directus_policies').where('name', 'KSCW Terminplanung').select('id').first()
    return row?.id ?? null
  }

  async function ensureTerminplanungAccess(memberId) {
    try {
      const member = await database('members').where('id', memberId).select('user').first()
      if (!member?.user) return
      const policyId = await getTerminplanungPolicyId()
      if (!policyId) return
      const existing = await database('directus_access')
        .where({ user: member.user, policy: policyId })
        .first()
      if (existing) return
      const { randomUUID } = await import('node:crypto')
      await database('directus_access').insert({ id: randomUUID(), user: member.user, policy: policyId })
      log.info(`[terminplanung-access] Attached TERMINPLANUNG policy to user ${member.user} (member ${memberId})`)
    } catch (err) {
      log.warn({ msg: `[terminplanung-access] attach failed for member ${memberId}: ${err.message}`, memberId, stack: err.stack })
      logWarning('terminplanung_access_attach', err.message, { memberId, stack: err.stack })
    }
  }

  async function revokeTerminplanungAccessIfNotSpielplaner(memberId) {
    try {
      const member = await database('members').where('id', memberId).select('user', 'is_spielplaner').first()
      if (!member?.user) return
      if (member.is_spielplaner === true) return
      const policyId = await getTerminplanungPolicyId()
      if (!policyId) return
      const deleted = await database('directus_access')
        .where({ user: member.user, policy: policyId })
        .delete()
      if (deleted) log.info(`[terminplanung-access] Revoked TERMINPLANUNG policy from user ${member.user} (member ${memberId} no longer is_spielplaner)`)
    } catch (err) {
      log.warn({ msg: `[terminplanung-access] revoke failed for member ${memberId}: ${err.message}`, memberId, stack: err.stack })
      logWarning('terminplanung_access_revoke', err.message, { memberId, stack: err.stack })
    }
  }

  async function revokeLeaderAccessIfOrphan(memberId) {
    try {
      const member = await database('members').where('id', memberId).select('user').first()
      if (!member?.user) return
      const stillCoach = await database('teams_coaches').where('members_id', memberId).first()
      const stillTR = await database('teams_responsibles').where('members_id', memberId).first()
      if (stillCoach || stillTR) return
      const policyId = await getLeaderPolicyId()
      if (!policyId) return
      const deleted = await database('directus_access')
        .where({ user: member.user, policy: policyId })
        .delete()
      if (deleted) log.info(`[leader-access] Revoked LEADER policy from user ${member.user} (member ${memberId} no longer coach/TR)`)
    } catch (err) {
      log.warn({ msg: `[leader-access] revoke failed for member ${memberId}: ${err.message}`, memberId, stack: err.stack })
      logWarning('leader_access_revoke', err.message, { memberId, stack: err.stack })
    }
  }

  // Sync when coach/TR junctions change (create)
  action('teams_coaches.items.create', async ({ payload }) => {
    const memberId = toIdValue(payload?.members_id)
    if (memberId) {
      await syncMemberRole(memberId)
      await ensureLeaderAccess(memberId)
    }
  })
  action('teams_responsibles.items.create', async ({ payload }) => {
    const memberId = toIdValue(payload?.members_id)
    if (memberId) {
      await syncMemberRole(memberId)
      await ensureLeaderAccess(memberId)
    }
  })

  // Sync when coach/TR junctions change (delete)
  // Capture member IDs before deletion via filter, then sync in action
  const pendingJunctionDeletes = new Map()

  filter('teams_coaches.items.delete', async (keys) => {
    try {
      const rows = await database('teams_coaches').whereIn('id', keys).select('members_id')
      for (const r of rows) pendingJunctionDeletes.set(`coach-${r.members_id}`, r.members_id)
    } catch (e) { /* ignore */ }
    return keys
  })

  filter('teams_responsibles.items.delete', async (keys) => {
    try {
      const rows = await database('teams_responsibles').whereIn('id', keys).select('members_id')
      for (const r of rows) pendingJunctionDeletes.set(`tr-${r.members_id}`, r.members_id)
    } catch (e) { /* ignore */ }
    return keys
  })

  // Drain the pending-junction map under try/finally so a syncMemberRole
  // failure can't leave the entry orphaned forever. Snapshot keys first so
  // we never iterate the map while mutating it (concurrent inserts from
  // overlapping deletes are otherwise lost).
  async function drainPendingJunction(prefix) {
    const toProcess = []
    for (const [key, memberId] of pendingJunctionDeletes) {
      if (key.startsWith(prefix)) toProcess.push([key, memberId])
    }
    for (const [key, memberId] of toProcess) {
      try {
        await syncMemberRole(memberId)
        await revokeLeaderAccessIfOrphan(memberId)
      } finally {
        pendingJunctionDeletes.delete(key)
      }
    }
  }

  action('teams_coaches.items.delete', async () => { await drainPendingJunction('coach-') })
  action('teams_responsibles.items.delete', async () => { await drainPendingJunction('tr-') })

  // ── Absence Auto-Decline ────────────────────────────────────────
  // When an absence is created or updated, auto-decline all overlapping
  // future trainings/games/events for that member. Skips activities where
  // the member already has a participation record (so manual overrides stick).
  // Also handles weekly absences (day-of-week matching).

  // Sentinel stamped on rows the auto-decline INSERT *created* (vs rows that
  // pre-existed and were overridden by the UPDATE branch). `waitlisted_at` is
  // never legitimately set on a `declined` row and isn't surfaced for declined
  // rows in the UI, and the migration-038 BEFORE-UPDATE trigger only touches
  // `auto_declined_by`, so it survives as a marker. On unwind we DELETE the
  // created rows and REVERT the overridden ones (instead of deleting the
  // member's original confirmed RSVP). 1970-01-01Z = "auto-decline created".
  const AUTO_DECLINE_CREATED_SENTINEL = '1970-01-01 00:00:00+00'

  /**
   * Reverse the effect of an absence's auto-declines. Created rows (sentinel
   * set) are deleted; overridden rows (a pre-existing confirmed/tentative/
   * waitlisted RSVP the absence flipped to declined) are reverted to
   * 'confirmed' with the marker + sentinel cleared, so the member's original
   * attendance is restored rather than silently destroyed. Manual overrides
   * are already detached by the trigger (auto_declined_by → NULL on a user
   * status edit) and so match neither branch — they're left untouched.
   * Returns { deleted, reverted } counts.
   */
  async function unwindAbsenceAutoDeclines(absenceId) {
    const del = await database.raw(
      `DELETE FROM participations
       WHERE auto_declined_by = ?::integer
         AND waitlisted_at = ?::timestamptz`,
      [absenceId, AUTO_DECLINE_CREATED_SENTINEL],
    )
    const rev = await database.raw(
      `UPDATE participations
       SET status = 'confirmed', auto_declined_by = NULL, note = ''
       WHERE auto_declined_by = ?::integer
         AND (waitlisted_at IS NULL OR waitlisted_at <> ?::timestamptz)`,
      [absenceId, AUTO_DECLINE_CREATED_SENTINEL],
    )
    return { deleted: del?.rowCount || 0, reverted: rev?.rowCount || 0 }
  }

  /**
   * Auto-decline future activities that overlap with the given absence.
   * Uses a single INSERT...SELECT per activity type (no per-row loop).
   */
  async function autoDeclineForAbsence(absenceId) {
    try {
      const absence = await database('absences').where('id', absenceId).first()
      if (!absence) return

      const memberId = absence.member
      // 2026-05-14: knex returns Postgres `date` columns as JS Date objects, so
      // `.split('T')[0]` short-circuits to undefined and the fallback handed
      // back the Date itself. `Date > '2026-05-13'` then coerced to `NaN >
      // NaN` → false, so `effectiveStart` was ALWAYS clamped to today even for
      // future-dated absences. Net: a future absence (e.g. Aug 27–28) declined
      // every activity from today through end_date. Always coerce to
      // YYYY-MM-DD string via safeDateStr() before any comparison or SQL bind.
      const startDate = safeDateStr(absence.start_date)
      const endDate = safeDateStr(absence.end_date)
      if (!startDate || !endDate) return
      const today = new Date().toISOString().split('T')[0]
      const effectiveStart = startDate > today ? startDate : today

      // Parse affects — JSON array like ["all"] or ["trainings","games"]
      let affects = absence.affects
      if (typeof affects === 'string') {
        try { affects = JSON.parse(affects) } catch { affects = ['all'] }
      }
      if (!Array.isArray(affects) || affects.length === 0) affects = ['all']
      const allTypes = affects.includes('all')

      const isWeekly = absence.type === 'weekly'
      let daysOfWeek = absence.days_of_week
      if (isWeekly) {
        if (typeof daysOfWeek === 'string') {
          try { daysOfWeek = JSON.parse(daysOfWeek) } catch { daysOfWeek = [] }
        }
        if (!Array.isArray(daysOfWeek) || daysOfWeek.length === 0) return
        // Audit 2026-05-12 #9 — coerce each entry to a valid 0..6 integer
        // BEFORE interpolating into raw SQL. Even though the source is a
        // jsonb column, the trigger path doesn't guarantee element type, so
        // a malformed value (string, decimal, out-of-range) would otherwise
        // land in the IN-list verbatim.
        daysOfWeek = daysOfWeek
          .map(d => Number(d))
          .filter(d => Number.isInteger(d) && d >= 0 && d <= 6)
        if (daysOfWeek.length === 0) return
      }

      // Day-of-week filter for weekly absences (Postgres: 0=Sun,1=Mon..6=Sat; our format: 0=Mon..6=Sun)
      // Convert our Mon=0..Sun=6 to Postgres EXTRACT(DOW): Sun=0,Mon=1..Sat=6
      const pgDowClause = isWeekly
        ? `AND EXTRACT(DOW FROM d.date) IN (${daysOfWeek.map(d => (d + 1) % 7).join(',')})`
        : ''

      // Unwind: reverse any auto-declines this absence previously created
      // that no longer match the (possibly shortened / re-scoped) window.
      // Created rows are deleted; rows that pre-existed and were overridden are
      // reverted to 'confirmed' (restoring the member's original RSVP rather
      // than destroying it — see unwindAbsenceAutoDeclines). Tentative/
      // waitlisted prior statuses revert to confirmed (no column to stash the
      // exact prior status without a migration; attendance is preserved, which
      // is the point). Still-covered rows are immediately re-applied by the
      // UPDATE/INSERT below. Manual overrides survive — the BEFORE UPDATE
      // trigger detaches `auto_declined_by` the moment a user flips `status`.
      await unwindAbsenceAutoDeclines(absenceId)

      let declined = 0

      // Per the agreed policy: an absence hard-overrides existing confirmed /
      // tentative / waitlisted RSVPs. The two-step pattern (UPDATE then INSERT)
      // is required because participations has no UNIQUE(member,activity_id)
      // constraint, so ON CONFLICT is unavailable. Migration 038 reshapes the
      // trigger to preserve `auto_declined_by` when we set status + marker in
      // the same UPDATE — without that, the marker would be cleared and the
      // override would be indistinguishable from a manual edit.

      // Trainings
      if (allTypes || affects.includes('trainings')) {
        const trainingDowClause = pgDowClause.replace(/d\.date/g, 't.date')
        const upd = await database.raw(`
          UPDATE participations p
          SET status = 'declined', note = ?, auto_declined_by = ?::integer
          FROM trainings t
          WHERE p.activity_type = 'training' AND p.activity_id = t.id::text
            AND p.member = ?::integer
            AND p.status IN ('confirmed', 'tentative', 'waitlisted')
            AND t.date >= ?::date AND t.date <= ?::date
            AND t.cancelled = false
            ${trainingDowClause}
        `, [absence.reason || '', absenceId, memberId, effectiveStart, endDate])
        declined += upd?.rowCount || 0

        const ins = await database.raw(`
          INSERT INTO participations (member, activity_type, activity_id, status, note, guest_count, is_staff, auto_declined_by, waitlisted_at)
          SELECT ?::integer, 'training', t.id::text, 'declined', ?, 0, false, ?::integer, '1970-01-01 00:00:00+00'::timestamptz
          FROM trainings t
          WHERE t.date >= ?::date AND t.date <= ?::date
            AND t.cancelled = false
            ${trainingDowClause}
            AND EXISTS (SELECT 1 FROM member_teams mt WHERE mt.team = t.team AND mt.member = ?::integer)
            AND NOT EXISTS (
              SELECT 1 FROM participations p
              WHERE p.activity_type = 'training' AND p.activity_id = t.id::text AND p.member = ?::integer
            )
        `, [memberId, absence.reason || '', absenceId, effectiveStart, endDate, memberId, memberId])
        declined += ins?.rowCount || 0
      }

      // Games
      if (allTypes || affects.includes('games')) {
        const upd = await database.raw(`
          UPDATE participations p
          SET status = 'declined', note = ?, auto_declined_by = ?::integer
          FROM games g
          WHERE p.activity_type = 'game' AND p.activity_id = g.id::text
            AND p.member = ?::integer
            AND p.status IN ('confirmed', 'tentative', 'waitlisted')
            AND g.date >= ?::date AND g.date <= ?::date
            AND g.kscw_team IS NOT NULL
            AND COALESCE(g.status, '') NOT IN ('completed', 'postponed', 'cancelled')
            ${pgDowClause.replace(/d\.date/g, 'g.date')}
        `, [absence.reason || '', absenceId, memberId, effectiveStart, endDate])
        declined += upd?.rowCount || 0

        const ins = await database.raw(`
          INSERT INTO participations (member, activity_type, activity_id, status, note, guest_count, is_staff, auto_declined_by, waitlisted_at)
          SELECT ?::integer, 'game', g.id::text, 'declined', ?, 0, false, ?::integer, '1970-01-01 00:00:00+00'::timestamptz
          FROM games g
          WHERE g.date >= ?::date AND g.date <= ?::date
            AND g.kscw_team IS NOT NULL
            AND COALESCE(g.status, '') NOT IN ('completed', 'postponed', 'cancelled')
            ${pgDowClause.replace(/d\.date/g, 'g.date')}
            AND EXISTS (SELECT 1 FROM member_teams mt WHERE mt.team = g.kscw_team AND mt.member = ?::integer)
            AND NOT EXISTS (
              SELECT 1 FROM participations p
              WHERE p.activity_type = 'game' AND p.activity_id = g.id::text AND p.member = ?::integer
            )
        `, [memberId, absence.reason || '', absenceId, effectiveStart, endDate, memberId, memberId])
        declined += ins?.rowCount || 0
      }

      // Events
      if (allTypes || affects.includes('events')) {
        // events.start_date is timestamptz → localize to Zurich for the
        // calendar-date window/DOW match (UTC would shift a 00:00–02:00 Zurich
        // event to the previous day and mismatch the absence window).
        const eventDateZ = "(e.start_date AT TIME ZONE 'Europe/Zurich')::date"
        const upd = await database.raw(`
          UPDATE participations p
          SET status = 'declined', note = ?, auto_declined_by = ?::integer
          FROM events e
          WHERE p.activity_type = 'event' AND p.activity_id = e.id::text
            AND p.member = ?::integer
            AND p.status IN ('confirmed', 'tentative', 'waitlisted')
            AND ${eventDateZ} >= ?::date AND ${eventDateZ} <= ?::date
            ${pgDowClause.replace(/d\.date/g, eventDateZ)}
        `, [absence.reason || '', absenceId, memberId, effectiveStart, endDate])
        declined += upd?.rowCount || 0

        const ins = await database.raw(`
          INSERT INTO participations (member, activity_type, activity_id, status, note, guest_count, is_staff, auto_declined_by, waitlisted_at)
          SELECT DISTINCT ON (e.id) ?::integer, 'event', e.id::text, 'declined', ?, 0, false, ?::integer, '1970-01-01 00:00:00+00'::timestamptz
          FROM events e
          JOIN events_teams et ON et.events_id = e.id
          WHERE ${eventDateZ} >= ?::date AND ${eventDateZ} <= ?::date
            ${pgDowClause.replace(/d\.date/g, eventDateZ)}
            AND EXISTS (SELECT 1 FROM member_teams mt WHERE mt.team = et.teams_id AND mt.member = ?::integer)
            AND NOT EXISTS (
              SELECT 1 FROM participations p
              WHERE p.activity_type = 'event' AND p.activity_id = e.id::text AND p.member = ?::integer
            )
        `, [memberId, absence.reason || '', absenceId, effectiveStart, endDate, memberId, memberId])
        declined += ins?.rowCount || 0
      }

      if (declined > 0) log.info(`[absence-auto-decline] Absence ${absenceId}: ${declined} activities declined for member ${memberId}`)
    } catch (err) {
      log.error({ msg: `[absence-auto-decline] ${err.message}`, event: 'absence_auto_decline', absenceId, stack: err.stack })
      logCronError('absence_auto_decline', err)
    }
  }

  // Edit-attribution (migration 051): stamp directus_users.id of the writer
  // on every authenticated create/update so the UI can flag third-party
  // edits. System-context writes (no accountability) leave the columns null.
  // Filters always overwrite client-supplied values so they can't be spoofed.
  // Resolve editor's display name + role relative to the affected member.
  // Role = 'coach' | 'team_responsible' | 'admin' | 'staff' (fallback).
  // Migration 053 added the columns; this fills them at write time so the
  // frontend can render "Edited by coach (Daniela Imhof) on …" without a
  // per-row round-trip.
  async function resolveAbsenceEditorMeta(accountability, affectedMemberId) {
    try {
      const editorUser = await database('directus_users').where('id', accountability.user)
        .select('first_name', 'last_name').first()
      const name = [editorUser?.first_name, editorUser?.last_name].filter(Boolean).join(' ') || null
      if (accountability.admin) return { name, role: 'admin' }
      if (!affectedMemberId) return { name, role: 'staff' }

      const memberTeams = await database('member_teams').where('member', affectedMemberId).select('team')
      const teamIds = memberTeams.map(mt => mt.team).filter(Boolean)
      if (teamIds.length === 0) return { name, role: 'staff' }

      const editorMember = await database('members').where('user', accountability.user).select('id').first()
      if (!editorMember) return { name, role: 'staff' }

      const isCoach = await database('teams_coaches')
        .whereIn('teams_id', teamIds)
        .andWhere('members_id', editorMember.id)
        .first()
      if (isCoach) return { name, role: 'coach' }

      const isTR = await database('teams_responsibles')
        .whereIn('teams_id', teamIds)
        .andWhere('members_id', editorMember.id)
        .first()
      if (isTR) return { name, role: 'team_responsible' }

      return { name, role: 'staff' }
    } catch (err) {
      log.error({ msg: `[absence-editor-meta] ${err.message}`, event: 'absence_editor_meta', stack: err.stack })
      return { name: null, role: 'staff' }
    }
  }

  filter('absences.items.create', async (payload, _meta, { accountability }) => {
    if (!accountability?.user) return payload
    const meta = await resolveAbsenceEditorMeta(accountability, payload.member)
    return {
      ...payload,
      last_edited_by: accountability.user,
      last_edited_at: new Date().toISOString(),
      last_edited_name: meta.name,
      last_edited_role: meta.role,
    }
  })
  filter('absences.items.update', async (payload, meta, { accountability }) => {
    if (!accountability?.user) return payload
    let affectedMemberId = payload.member
    if (!affectedMemberId && Array.isArray(meta?.keys) && meta.keys.length === 1) {
      const row = await database('absences').where('id', meta.keys[0]).select('member').first()
      affectedMemberId = row?.member
    }
    const editorMeta = await resolveAbsenceEditorMeta(accountability, affectedMemberId)
    return {
      ...payload,
      last_edited_by: accountability.user,
      last_edited_at: new Date().toISOString(),
      last_edited_name: editorMeta.name,
      last_edited_role: editorMeta.role,
    }
  })

  async function notifyAbsenceThirdParty(absenceId, op) {
    try {
      const row = await database('absences').where('id', absenceId)
        .select('id', 'member', 'start_date', 'end_date', 'type', 'reason', 'reason_detail', 'last_edited_by', 'indefinite').first()
      if (!row || !row.last_edited_by || !row.member) return

      const memberRow = await database('members').where('id', row.member)
        .select('id', 'user').first()
      if (!memberRow) return
      if (memberRow.user && memberRow.user === row.last_edited_by) return // self-edit

      const editorUser = await database('directus_users').where('id', row.last_edited_by)
        .select('first_name', 'last_name').first()
      const editorName = [editorUser?.first_name, editorUser?.last_name].filter(Boolean).join(' ') || 'Staff'

      const isWeekly = row.type === 'weekly'
      await database('notifications').insert({
        member: row.member,
        type: 'absence_third_party_edit',
        title: op === 'create'
          ? (isWeekly ? 'absence_weekly_created_for_you' : 'absence_created_for_you')
          : (isWeekly ? 'absence_weekly_updated_for_you' : 'absence_updated_for_you'),
        body: JSON.stringify({
          editor: editorName,
          start: row.start_date,
          end: row.indefinite ? null : row.end_date,
          reason: row.reason || null,
          detail: row.reason_detail || null,
          weekly: isWeekly,
        }),
        activity_type: 'absence',
        activity_id: String(row.id),
        read: false,
      })

      // Web push fanout — same dispatch path as upcoming_activity /
      // deadline_reminder. The dd.mm.yyyy formatter mirrors the front-end
      // (Swiss / dot-day-first) so the push body matches the in-app row.
      // safeDateStr() normalizes first: knex hands back `date` columns as JS
      // Date objects, and `String(Date).slice(0,10)` yields "Wed Aug 27" (not
      // an ISO date), which then split/reverse mangles. absences.start_date is
      // a pg `date` (no TZ skew), so no AT TIME ZONE needed — just ISO it.
      const startIso = safeDateStr(row.start_date)
      const startFmt = startIso
        ? startIso.split('-').reverse().join('.')
        : ''
      const keyBase = isWeekly
        ? (op === 'create' ? 'absence.weekly.created' : 'absence.weekly.updated')
        : (op === 'create' ? 'absence.created' : 'absence.updated')
      await sendLocalizedPush(
        database,
        [row.member],
        (ids, title, body) => sendPushToMembers(database, ids, title, body, `${FRONTEND_URL}/absences`, 'absence', log),
        `${keyBase}.title`,
        `${keyBase}.body`,
        { editor: editorName, start: startFmt },
      )
    } catch (err) {
      log.error({ msg: `[absence-notify] ${err.message}`, event: 'absence_notify', absenceId, stack: err.stack })
    }
  }

  action('absences.items.create', async ({ key }) => {
    await autoDeclineForAbsence(key)
    await notifyAbsenceThirdParty(key, 'create')
  })
  action('absences.items.update', async ({ keys }) => {
    for (const k of keys) {
      await autoDeclineForAbsence(k)
      await notifyAbsenceThirdParty(k, 'update')
    }
  })
  action('absences.items.delete', async ({ keys }) => {
    // Reverse any auto-declines this absence had created: delete the rows it
    // created, revert the pre-existing RSVPs it overrode back to 'confirmed'
    // (don't destroy them). Manual overrides are protected by the clear-marker
    // trigger (they match neither branch).
    try {
      for (const k of keys) {
        const { deleted, reverted } = await unwindAbsenceAutoDeclines(k)
        if (deleted > 0 || reverted > 0) log.info(`[absence-auto-decline] Absence ${k} deleted: ${deleted} reversed, ${reverted} RSVPs restored`)
      }
    } catch (err) {
      log.error({ msg: `[absence-auto-decline] delete: ${err.message}`, event: 'absence_auto_decline_delete', stack: err.stack })
    }
  })

  // ── Team join request notifications ──────────────────────────────
  // Notify coaches + team responsibles when a member requests to join a team.
  // Fires for both collection creates (team_requests) and inline
  // members.requested_team sets from the account-claim flow.
  async function notifyTeamJoinRequest(memberId, teamId) {
    try {
      if (!memberId || !teamId) return
      const member = await database('members').where('id', memberId)
        .select('id', 'first_name', 'last_name').first()
      if (!member) return

      const teamRow = await database('teams').where('id', teamId)
        .select('name').first()
      const teamName = teamRow?.name || `Team ${teamId}`
      const teamUrlPath = encodeURIComponent(teamName)

      const coaches = await database('teams_coaches').where('teams_id', teamId).select('members_id')
      const trMembers = await database('teams_responsibles').where('teams_id', teamId).select('members_id')
      const recipientIds = [...new Set([...coaches, ...trMembers].map(r => r.members_id))]
        .filter(id => id && id !== memberId)
      if (recipientIds.length === 0) return

      // In-app notifications
      await database('notifications').insert(recipientIds.map(rid => ({
        member: rid,
        type: 'member_join_request',
        title: 'member_join_request',
        body: JSON.stringify({ memberName: `${member.first_name} ${member.last_name}`, teamName }),
        activity_type: 'team',
        activity_id: teamName,
        team: teamId,
        read: false,
      })))

      // Emails
      const schema = await getSchema()
      const { MailService } = services
      const mailService = new MailService({ schema, knex: database })
      const recipients = await database('members')
        .whereIn('id', recipientIds)
        .select('email', 'first_name', 'language')
      // Per-recipient locale via members.language → 5 buckets (de/gsw/en/fr/it)
      const TJR_LANG_TO_CODE = { german: 'de', swiss_german: 'gsw', english: 'en', french: 'fr', italian: 'it' }
      // Escape member-supplied first/last name + admin-supplied team name before
      // they land in email HTML; subject lines are plain text so they don't
      // need escaping, only the `intro` HTML body.
      const safeMemberName = `${escapeEmailHtml(member.first_name || '')} ${escapeEmailHtml(member.last_name || '')}`.trim()
      const safeTeamNameHtml = escapeEmailHtml(teamName)
      const TJR = {
        de: {
          subject: `WiediSync — Neue Beitrittsanfrage für ${teamName}`,
          intro: `<strong>${safeMemberName}</strong> möchte dem Team <strong>${safeTeamNameHtml}</strong> beitreten.`,
          alertTitle: 'Aktion erforderlich',
          alertBody: 'Bitte genehmige oder lehne die Anfrage auf der Teamseite ab.',
          cta: 'Zur Teamseite', title: 'Neue Beitrittsanfrage',
        },
        gsw: {
          subject: `WiediSync — Neui Bytrittsaafrog für ${teamName}`,
          intro: `<strong>${safeMemberName}</strong> möcht zum Team <strong>${safeTeamNameHtml}</strong>.`,
          alertTitle: 'Aktion erforderlich',
          alertBody: 'Bitte bewillig oder läne d Aafrog uf dr Team-Site ab.',
          cta: 'Zur Team-Site', title: 'Neui Bytrittsaafrog',
        },
        en: {
          subject: `WiediSync — New join request for ${teamName}`,
          intro: `<strong>${safeMemberName}</strong> wants to join team <strong>${safeTeamNameHtml}</strong>.`,
          alertTitle: 'Action required',
          alertBody: 'Please approve or reject the request on the team page.',
          cta: 'Go to team page', title: 'New join request',
        },
        fr: {
          subject: `WiediSync — Nouvelle demande d'adhésion pour ${teamName}`,
          intro: `<strong>${safeMemberName}</strong> souhaite rejoindre l'équipe <strong>${safeTeamNameHtml}</strong>.`,
          alertTitle: 'Action requise',
          alertBody: "Merci d'approuver ou de refuser la demande sur la page de l'équipe.",
          cta: "Voir la page de l'équipe", title: "Nouvelle demande d'adhésion",
        },
        it: {
          subject: `WiediSync — Nuova richiesta di adesione per ${teamName}`,
          intro: `<strong>${safeMemberName}</strong> vuole unirsi alla squadra <strong>${safeTeamNameHtml}</strong>.`,
          alertTitle: 'Azione richiesta',
          alertBody: 'Approva o rifiuta la richiesta sulla pagina della squadra.',
          cta: 'Vai alla pagina della squadra', title: 'Nuova richiesta di adesione',
        },
      }
      for (const r of recipients) {
        if (!r.email) continue
        const code = TJR_LANG_TO_CODE[r.language] || 'de'
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
          to: r.email,
          subject: tt.subject,
          html,
          text: `${member.first_name} ${member.last_name} → ${teamName}\n${FRONTEND_URL}/teams/${teamUrlPath}`,
        }).catch(e => log.error(`team-join-request email: ${e.message}`))
      }

      // Push (per-recipient locale)
      const memberName = `${member.first_name} ${member.last_name}`
      await sendLocalizedPush(
        database, recipientIds,
        (ids, title, body) => sendPushToMembers(database, ids, title, body, `${FRONTEND_URL}/teams/${teamUrlPath}`, 'team', log),
        'joinRequest.title', 'joinRequest.body',
        { name: memberName, team: teamName },
      )
    } catch (err) {
      log.error({ msg: `[team-join-request] ${err.message}`, stack: err.stack })
    }
  }

  action('team_requests.items.create', async ({ payload, key }) => {
    const memberId = payload?.member
    const teamId = payload?.team
    if (memberId && teamId) await notifyTeamJoinRequest(memberId, teamId)
    else if (key) {
      const row = await database('team_requests').where('id', key).select('member', 'team').first()
      if (row) await notifyTeamJoinRequest(row.member, row.team)
    }
  })

  // ── Announcements (Vereinsnews) — publish fanout ─────────────────
  // Fires when an announcement is created or updated. If it's now published
  // (published_at set) and hasn't been fanned out yet (fanout_sent_at null),
  // resolves the audience and sends push + email per the per-post toggles.
  // Sets fanout_sent_at after sending so subsequent edits don't re-fanout.
  function stripHtmlPlain(html) {
    return String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
  }
  function pickAnnouncementTranslation(translations, lang) {
    const t = translations || {}
    const map = { german: 'de', swiss_german: 'gsw', english: 'en', french: 'fr', italian: 'it' }
    const code = map[lang] || lang || 'de'
    return t[code] || t.de || t.en || Object.values(t).find(v => v && v.title) || { title: '', body: '' }
  }

  async function resolveAnnouncementAudience(ann) {
    if (ann.audience_type !== 'all') {
      // Sport-scoped fanout REQUIRES an explicit sport. A null audience_sport
      // must NOT fall through to the all-members blast (the
      // validateAnnouncementAudience filter rejects this for non-admins, but a
      // system-context / future-scheduled row could still reach here) — return
      // an empty audience so the post is marked fanned-out without club-wide mail.
      if (!ann.audience_sport) {
        log.warn({ msg: `[announcements] audience_type=${ann.audience_type} but audience_sport is null — skipping fanout`, annId: ann.id })
        return []
      }
      // Sport-scoped: reach EVERY member on an ACTIVE team of that sport in the
      // current season, regardless of wiedisync_active. Club-wide sport comms
      // (tournaments, discounts, federation news) should hit the whole sport,
      // not just app opt-ins — but NOT ex-members or archived-season rosters
      // (member_teams/teams have no season guard otherwise). Per-channel opt-out
      // still applies inside the send loop (email requires a non-null address;
      // push requires an active subscription).
      const rows = await database('member_teams as mt')
        .join('teams as t', 't.id', 'mt.team')
        .join('members as m', 'm.id', 'mt.member')
        .where('t.sport', ann.audience_sport)
        .where('t.active', true)
        .where('m.kscw_membership_active', true)
        .distinct('m.id')
        .select('m.id')
      return rows.map(r => r.id).filter(Boolean)
    }
    // Default 'all' — every wiedisync-active member
    const rows = await database('members')
      .where('wiedisync_active', true)
      .select('id')
    return rows.map(r => r.id).filter(Boolean)
  }

  async function notifyAnnouncementPublished(annId) {
    try {
      if (!annId) return
      const ann = await database('announcements').where('id', annId).first()
      if (!ann) return
      // Not published yet, or already fanned out
      if (!ann.published_at) return
      if (ann.fanout_sent_at) return
      // Don't fanout for future-scheduled posts (let an admin trigger again later if needed)
      if (new Date(ann.published_at) > new Date()) return
      // Nothing requested? Still mark as fanned out so we don't keep checking
      if (!ann.notify_push && !ann.notify_email) {
        await database('announcements').where('id', annId).update({ fanout_sent_at: new Date().toISOString() })
        return
      }

      const memberIds = await resolveAnnouncementAudience(ann)
      if (memberIds.length === 0) {
        await database('announcements').where('id', annId).update({ fanout_sent_at: new Date().toISOString() })
        return
      }

      // Re-entrancy lock: stamp fanout_sent_at BEFORE the send loop, not after.
      // The check above (fanout_sent_at null) and the write were previously
      // separated by the whole per-recipient loop, so an edit / cron tick that
      // re-entered mid-send would pass the null check and double-mail the club.
      // Conditional update (whereNull) makes the stamp a claim: only the call
      // that flips it from null actually sends. Lost races no-op here.
      const claimed = await database('announcements')
        .where('id', annId)
        .whereNull('fanout_sent_at')
        .update({ fanout_sent_at: new Date().toISOString() })
      if (!claimed) {
        log.info(`[announcements] Fanout for #${annId} already claimed by a concurrent run — skipping`)
        return
      }

      const translations = (typeof ann.translations === 'string')
        ? (() => { try { return JSON.parse(ann.translations) } catch { return {} } })()
        : (ann.translations || {})

      const baseTr = pickAnnouncementTranslation(translations, 'german')
      const baseTitle = baseTr.title || 'Vereinsnews'
      const baseBodyText = stripHtmlPlain(baseTr.body).slice(0, 200)
      const newsUrl = `${FRONTEND_URL}/news`

      // Push fanout (per-recipient locale via members.language)
      if (ann.notify_push) {
        const CODE_TO_LANG = { de: 'german', gsw: 'swiss_german', en: 'english', fr: 'french', it: 'italian' }
        const buckets = await bucketMembersByLocale(database, memberIds)
        for (const [code, ids] of Object.entries(buckets)) {
          if (!ids || ids.length === 0) continue
          const tr = pickAnnouncementTranslation(translations, CODE_TO_LANG[code])
          const title = tr.title || baseTitle
          const body = (stripHtmlPlain(tr.body).slice(0, 200)) || baseBodyText
          await sendPushToMembers(database, ids, title, body, newsUrl, `announcement-${annId}`, log)
        }
      }

      // Email fanout (per-recipient locale resolution)
      if (ann.notify_email) {
        try {
          const schema = await getSchema()
          const { MailService } = services
          const mailService = new MailService({ schema, knex: database })
          const recipients = await database('members')
            .whereIn('id', memberIds)
            .whereNotNull('email')
            .select('id', 'email', 'first_name', 'language')

          let sent = 0
          let failed = 0
          for (const r of recipients) {
            try {
              const tr = pickAnnouncementTranslation(translations, r.language)
              const title = tr.title || baseTitle
              const rawBodyHtml = tr.body || baseTr.body || ''
              const isGerman = !r.language || r.language === 'german' || r.language === 'swiss_german'
              const ctaLabel = isGerman ? 'Auf WiediSync ansehen' : 'View on WiediSync'

              // Audit 2026-05-12 #14 — allowlist-sanitize the announcement body
              // before interpolating into the outbound email. Admin-authored
              // rich text only; strips script/style/iframe/img and all
              // attributes except https-only href on <a>. Closes the
              // phishing-redirect / tracking-pixel / event-handler injection
              // vector that a compromised Sport Admin could exploit.
              const bodyHtml = sanitizeAnnouncementHtml(rawBodyHtml)

              // Gate: never render `ann.link` inline in the email. External/CTA
              // links stay behind wiedisync login — recipients click the layout
              // CTA ("Auf WiediSync ansehen") to reach the full post + link.
              //
              // Body wrapper forces justified text. Inline anchors get an
              // explicit light-blue style (default browser blue is unreadable
              // on the #1e293b dark card). We inline-style via regex rather
              // than a <style> block so the CTA button <a> isn't affected.
              const bodyWithStyledLinks = bodyHtml.replace(
                /<a\s/gi,
                '<a style="color:#93c5fd;text-decoration:underline" ',
              )
              const emailBody =
                `<div style="font-size:14px;color:#e2e8f0;line-height:1.6;text-align:justify">${bodyWithStyledLinks}</div>`

              const html = buildEmailLayout(emailBody, {
                title: isGerman ? 'Vereinsnews' : 'Club news',
                subtitle: title,
                greeting: r.first_name ? (isGerman ? `Hallo ${r.first_name}` : `Hi ${r.first_name}`) : (isGerman ? 'Hallo' : 'Hi'),
                ctaUrl: newsUrl,
                ctaLabel,
              })

              await mailService.send({
                to: r.email,
                subject: `${isGerman ? 'Vereinsnews' : 'Club news'}: ${title}`,
                html,
                text: `${title}\n\n${stripHtmlPlain(bodyHtml).slice(0, 500)}\n\n${newsUrl}`,
              })
              sent++
            } catch (perEmailErr) {
              failed++
              log.warn({ msg: `[announcements] email to ${r.email} failed: ${perEmailErr.message}` })
            }
          }
          log.info(`[announcements] Emails: ${sent} sent, ${failed} failed (out of ${recipients.length})`)
        } catch (emailErr) {
          log.warn({ msg: `[announcements] email batch failed: ${emailErr.message}`, stack: emailErr.stack })
        }
      }

      // fanout_sent_at was already stamped before the send loop (re-entrancy
      // lock above), so no second write is needed here.
      log.info(`[announcements] Fanout complete for #${annId} → ${memberIds.length} recipients (push=${!!ann.notify_push}, email=${!!ann.notify_email})`)
    } catch (err) {
      log.error({ msg: `[announcements] ${err.message}`, event: 'announcement_fanout', annId, stack: err.stack })
      writeErrorLog?.('announcement_fanout_failed', err.message, { annId, stack: err.stack })
    }
  }

  action('announcements.items.create', async ({ key }) => {
    if (key) await notifyAnnouncementPublished(key)
  })
  action('announcements.items.update', async ({ keys }) => {
    for (const k of keys || []) await notifyAnnouncementPublished(k)
  })

  // ── Announcements: server-side created_by + audience_sport enforcement ──
  // F5: Prevents an admin (Sport Admin+) from spoofing `created_by` via
  // direct API. On create, set from accountability user's linked member;
  // on update, never allow it to change.
  // F3: Prevents a sport-scoped admin (vb_admin / bb_admin) from posting
  // an announcement targeting the OTHER sport. Global admin/superuser
  // and members with BOTH sport roles bypass.
  async function validateAnnouncementAudience(payload, context) {
    const userId = context?.accountability?.user
    if (!userId) return
    const m = await database('members').where('user', userId).select('role').first()
    if (!m) return
    const roles = Array.isArray(m.role) ? m.role : []
    // Global admins / superusers can post anything. Members with both sport
    // admin roles also pass through.
    if (roles.includes('admin') || roles.includes('superuser')) return
    const isVb = roles.includes('vb_admin')
    const isBb = roles.includes('bb_admin')
    if (isVb && isBb) return

    // Club-wide announcements (audience_sport unset OR audience_type='all'):
    // only full admins may address every member of every team. A
    // sport-scoped admin omitting audience_sport must NOT silently fall
    // through to the all-members fanout (resolveAnnouncementAudience treats
    // missing sport as "all").
    if (!payload?.audience_sport) {
      const err = new Error('Only global admins can post club-wide announcements. Set audience_sport to your scope.')
      err.status = 403
      throw err
    }

    if (payload.audience_sport === 'volleyball' && !isVb) {
      const err = new Error('Only volleyball admins can post volleyball-targeted announcements.')
      err.status = 403
      throw err
    }
    if (payload.audience_sport === 'basketball' && !isBb) {
      const err = new Error('Only basketball admins can post basketball-targeted announcements.')
      err.status = 403
      throw err
    }
  }

  filter('announcements.items.create', async (payload, _meta, context) => {
    await validateAnnouncementAudience(payload, context)
    const userId = context?.accountability?.user
    if (userId) {
      const m = await database('members').where('user', userId).select('id').first()
      if (m?.id) payload.created_by = m.id
      else delete payload.created_by
    } else {
      delete payload.created_by
    }
    return payload
  })
  filter('announcements.items.update', async (payload, _meta, context) => {
    await validateAnnouncementAudience(payload, context)
    if (payload && Object.prototype.hasOwnProperty.call(payload, 'created_by')) {
      delete payload.created_by
    }
    return payload
  })

  // ── Cron: Announcement scheduled-publish fanout (every 5 min) ──
  // Picks up posts where published_at has now arrived but fanout_sent_at
  // is still null (i.e. created with a future published_at and never
  // re-saved by an admin). Calls the same notifyAnnouncementPublished
  // helper which marks fanout_sent_at on every code path so the cron
  // doesn't loop on the same row.
  schedule('*/5 * * * *', async () => {
    try {
      const due = await database('announcements')
        .whereNotNull('published_at')
        .where('published_at', '<=', new Date())
        .whereNull('fanout_sent_at')
        .select('id')
      if (due.length === 0) return
      for (const row of due) {
        await notifyAnnouncementPublished(row.id)
      }
      log.info(`[announcements/cron] Scheduled fanout fired for ${due.length} post(s)`)
    } catch (err) {
      log.error({ msg: `[announcements/cron] ${err.message}`, stack: err.stack })
      logCronError('announcement_fanout_cron', err)
    }
  })

  // ── Auto-confirm RSVP helpers ──────────────────────────────────
  // Insert `confirmed` participations for all eligible members of an activity.
  // Uses NOT EXISTS to skip members already declined (absence overlay), already
  // confirmed/tentative (manual), and members in the training's excluded
  // guest-levels. Idempotent: safe to call on create AND on later flip-on.
  //
  // Returns rowCount inserted (0 if disabled / nothing to do).
  function parseTeamFeatures(fe) {
    if (typeof fe === 'string') {
      try { return JSON.parse(fe) || {} } catch { return {} }
    }
    return fe || {}
  }

  async function effectiveTrainingAutoConfirm(training, team) {
    if (training.auto_confirm_rsvp === true) return true
    if (training.auto_confirm_rsvp === false) return false
    return parseTeamFeatures(team?.features_enabled).training_auto_confirm === true
  }

  async function effectiveGameAutoConfirm(game, team) {
    if (game.auto_confirm_rsvp === true) return true
    if (game.auto_confirm_rsvp === false) return false
    return parseTeamFeatures(team?.features_enabled).game_auto_confirm === true
  }

  async function autoConfirmTraining(trainingId, { onlyIfFuture = false } = {}) {
    const training = await database('trainings').where('id', trainingId).first()
    if (!training || training.cancelled || !training.team || !training.date) return 0
    if (onlyIfFuture) {
      const today = new Date().toISOString().split('T')[0]
      const dateStr = training.date.toISOString?.().split('T')[0] || String(training.date).split('T')[0]
      if (dateStr < today) return 0
    }
    const team = await database('teams').where('id', training.team).first('features_enabled')
    // Team setting on → confirm every team member (legacy behavior). Off → only
    // members who personally opted in via members.auto_confirm_trainings (OR
    // semantics — migration 077). We no longer early-return on team-off, since
    // individual opt-ins must still be honoured.
    const teamOn = await effectiveTrainingAutoConfirm(training, team)
    const eligibleClause = teamOn ? 'TRUE' : 'm.auto_confirm_trainings = true'

    let excluded = training.excluded_guest_levels
    if (typeof excluded === 'string') { try { excluded = JSON.parse(excluded) } catch { excluded = [] } }
    if (!Array.isArray(excluded)) excluded = []
    const excludedClause = excluded.length > 0
      ? `AND mt.guest_level NOT IN (${excluded.map(() => '?').join(',')})`
      : ''
    const ins = await database.raw(`
      INSERT INTO participations (member, activity_type, activity_id, status, note, guest_count, is_staff)
      SELECT mt.member, 'training', ?::text, 'confirmed', '', 0, false
      FROM member_teams mt
      JOIN members m ON m.id = mt.member
      WHERE mt.team = ?::integer
        AND (${eligibleClause})
        ${excludedClause}
        AND NOT EXISTS (
          SELECT 1 FROM participations p
          WHERE p.activity_type = 'training' AND p.activity_id = ?::text AND p.member = mt.member
        )
    `, [String(trainingId), training.team, ...excluded, String(trainingId)])
    return ins?.rowCount || 0
  }

  async function autoConfirmGame(gameId, { onlyIfFuture = false } = {}) {
    const game = await database('games').where('id', gameId).first()
    if (!game || !game.kscw_team || !game.date) return 0
    if (['completed', 'postponed', 'cancelled'].includes(game.status || '')) return 0
    if (onlyIfFuture) {
      const today = new Date().toISOString().split('T')[0]
      const dateStr = game.date.toISOString?.().split('T')[0] || String(game.date).split('T')[0]
      if (dateStr < today) return 0
    }
    const team = await database('teams').where('id', game.kscw_team).first('features_enabled')
    // Team setting on → everyone (legacy). Off → only members who opted in via
    // members.auto_confirm_games (migration 077). Guests (guest_level > 0) are
    // always excluded — trg_participations_guest_block enforces it too.
    const teamOn = await effectiveGameAutoConfirm(game, team)
    const eligibleClause = teamOn ? 'TRUE' : 'm.auto_confirm_games = true'

    const ins = await database.raw(`
      INSERT INTO participations (member, activity_type, activity_id, status, note, guest_count, is_staff)
      SELECT mt.member, 'game', ?::text, 'confirmed', '', 0, false
      FROM member_teams mt
      JOIN members m ON m.id = mt.member
      WHERE mt.team = ?::integer
        AND mt.guest_level = 0
        AND (${eligibleClause})
        AND NOT EXISTS (
          SELECT 1 FROM participations p
          WHERE p.activity_type = 'game' AND p.activity_id = ?::text AND p.member = mt.member
        )
    `, [String(gameId), game.kscw_team, String(gameId)])
    return ins?.rowCount || 0
  }

  // Auto-confirm opted-in members on an event (member opt-in only — there is no
  // team-level event auto-confirm). Eligibility mirrors useUserVisibleEventIds:
  // members of an invited team (events_teams) ∪ individually invited
  // (events_members) ∪ everyone when the event is club-wide (no team and no
  // member junction). Whole-event mode only — per-session events need per-row
  // RSVPs. NOT EXISTS skips manual answers and absence-declines. Returns count.
  async function autoConfirmEvent(eventId, { onlyIfFuture = false } = {}) {
    const event = await database('events').where('id', eventId).first()
    if (!event || event.cancelled || !event.start_date) return 0
    if (event.participation_mode && event.participation_mode !== 'whole') return 0
    if (onlyIfFuture) {
      const today = new Date().toISOString().split('T')[0]
      const dateStr = safeDateStr(event.start_date)
      if (dateStr && dateStr < today) return 0
    }
    const [teamCount, memberCount] = await Promise.all([
      database('events_teams').where('events_id', eventId).count('* as c').first(),
      database('events_members').where('events_id', eventId).count('* as c').first(),
    ])
    const isClubWide = Number(teamCount?.c || 0) === 0 && Number(memberCount?.c || 0) === 0
    const eligibleSql = isClubWide
      ? `SELECT m.id AS member FROM members m WHERE m.wiedisync_active = true`
      : `SELECT mt.member FROM events_teams et
           JOIN member_teams mt ON mt.team = et.teams_id
           WHERE et.events_id = ?::integer
         UNION
         SELECT em.members_id AS member FROM events_members em
           WHERE em.events_id = ?::integer`
    const eligibleParams = isClubWide ? [] : [eventId, eventId]
    const ins = await database.raw(`
      INSERT INTO participations (member, activity_type, activity_id, status, note, guest_count, is_staff)
      SELECT DISTINCT e.member, 'event', ?::text, 'confirmed', '', 0, false
      FROM (${eligibleSql}) e
      JOIN members m ON m.id = e.member
      WHERE m.auto_confirm_events = true
        AND NOT EXISTS (
          SELECT 1 FROM participations p
          WHERE p.activity_type = 'event' AND p.activity_id = ?::text AND p.member = e.member
        )
    `, [String(eventId), ...eligibleParams, String(eventId)])
    return ins?.rowCount || 0
  }

  // Backfill: confirm a single member on all their existing upcoming activities
  // of one type. Run when a member flips an auto_confirm_* flag on. NOT EXISTS
  // skips anything already answered or absence-declined (those are rows too),
  // so it never overwrites a prior choice. Idempotent.
  async function backfillMemberAutoConfirm(memberId, type) {
    const today = new Date().toISOString().split('T')[0]
    if (type === 'training') {
      const res = await database.raw(`
        INSERT INTO participations (member, activity_type, activity_id, status, note, guest_count, is_staff)
        SELECT ?::integer, 'training', t.id::text, 'confirmed', '', 0, false
        FROM trainings t
        JOIN member_teams mt ON mt.team = t.team AND mt.member = ?::integer
        WHERE t.cancelled = false
          AND t.date::date >= ?::date
          AND (t.excluded_guest_levels IS NULL
               OR NOT (t.excluded_guest_levels::jsonb @> to_jsonb(mt.guest_level)))
          AND NOT EXISTS (
            SELECT 1 FROM participations p
            WHERE p.activity_type = 'training' AND p.activity_id = t.id::text AND p.member = ?::integer
          )
      `, [memberId, memberId, today, memberId])
      return res?.rowCount || 0
    }
    if (type === 'game') {
      const res = await database.raw(`
        INSERT INTO participations (member, activity_type, activity_id, status, note, guest_count, is_staff)
        SELECT ?::integer, 'game', g.id::text, 'confirmed', '', 0, false
        FROM games g
        JOIN member_teams mt ON mt.team = g.kscw_team AND mt.member = ?::integer
        WHERE g.status NOT IN ('completed', 'postponed', 'cancelled')
          AND g.date::date >= ?::date
          AND mt.guest_level = 0
          AND NOT EXISTS (
            SELECT 1 FROM participations p
            WHERE p.activity_type = 'game' AND p.activity_id = g.id::text AND p.member = ?::integer
          )
      `, [memberId, memberId, today, memberId])
      return res?.rowCount || 0
    }
    if (type === 'event') {
      const res = await database.raw(`
        INSERT INTO participations (member, activity_type, activity_id, status, note, guest_count, is_staff)
        SELECT DISTINCT ?::integer, 'event', e.id::text, 'confirmed', '', 0, false
        FROM events e
        WHERE e.cancelled = false
          AND (e.participation_mode IS NULL OR e.participation_mode = 'whole')
          AND e.start_date::date >= ?::date
          AND (
            EXISTS (SELECT 1 FROM events_teams et JOIN member_teams mt
                      ON mt.team = et.teams_id
                    WHERE et.events_id = e.id AND mt.member = ?::integer)
            OR EXISTS (SELECT 1 FROM events_members em
                       WHERE em.events_id = e.id AND em.members_id = ?::integer)
            OR (NOT EXISTS (SELECT 1 FROM events_teams et2 WHERE et2.events_id = e.id)
                AND NOT EXISTS (SELECT 1 FROM events_members em2 WHERE em2.events_id = e.id))
          )
          AND NOT EXISTS (
            SELECT 1 FROM participations p
            WHERE p.activity_type = 'event' AND p.activity_id = e.id::text AND p.member = ?::integer
          )
      `, [memberId, today, memberId, memberId, memberId])
      return res?.rowCount || 0
    }
    return 0
  }

  // Shared per-training pass: absence-decline then auto-confirm. Used by
  // both the trainings.items.create hook and the slot-cascade callsites
  // (initial generation, slot update fill, nightly rolling top-up) — those
  // do bulk INSERTs directly on `trainings` and bypass the Directus
  // item-create event, so without this we'd miss every cascaded training.
  async function applyTrainingAutoRSVP(trainingId) {
    try {
      const training = await database('trainings').where('id', trainingId).first()
      if (!training || training.cancelled || !training.team || !training.date) return
      const dateStr = safeDateStr(training.date)
      if (!dateStr) return
      const res = await database.raw(`
        INSERT INTO participations (member, activity_type, activity_id, status, note, guest_count, is_staff, auto_declined_by, waitlisted_at)
        SELECT mt.member, 'training', ?::text, 'declined', COALESCE(a.reason, ''), 0, false, a.id, '1970-01-01 00:00:00+00'::timestamptz
        FROM member_teams mt
        JOIN absences a ON a.member = mt.member
        WHERE mt.team = ?::integer
          AND a.start_date::date <= ?::date AND a.end_date::date >= ?::date
          AND (a.affects::jsonb @> '"all"' OR a.affects::jsonb @> '"trainings"')
          AND (a.type IS DISTINCT FROM 'weekly' OR (a.days_of_week::jsonb @> to_jsonb((EXTRACT(DOW FROM ?::date)::int + 6) % 7)))
          AND NOT EXISTS (
            SELECT 1 FROM participations p
            WHERE p.activity_type = 'training' AND p.activity_id = ?::text AND p.member = mt.member
          )
      `, [String(trainingId), training.team, dateStr, dateStr, dateStr, String(trainingId)])
      if (res?.rowCount > 0) log.info(`[absence-auto-decline] Training ${trainingId}: ${res.rowCount} members auto-declined`)
      const confirmed = await autoConfirmTraining(trainingId)
      if (confirmed > 0) log.info(`[auto-confirm] Training ${trainingId}: ${confirmed} members auto-confirmed`)
    } catch (err) {
      log.error({ msg: `[auto-rsvp] Training ${trainingId}: ${err.message}`, event: 'training_auto_rsvp_failed', trainingId, stack: err.stack })
    }
  }

  // When a training is created via Directus, run the auto-RSVP pass.
  // (Slot-cascade bulk inserts call applyTrainingAutoRSVP directly — see
  // the hall_slots.items.create / .update actions and the nightly cron.)
  action('trainings.items.create', async ({ key }) => {
    await applyTrainingAutoRSVP(key)
  })

  action('games.items.create', async ({ key }) => {
    try {
      const game = await database('games').where('id', key).first()
      if (!game || !game.kscw_team || !game.date) return
      const dateStr = safeDateStr(game.date)
      if (!dateStr) return
      const res = await database.raw(`
        INSERT INTO participations (member, activity_type, activity_id, status, note, guest_count, is_staff, auto_declined_by, waitlisted_at)
        SELECT mt.member, 'game', ?::text, 'declined', COALESCE(a.reason, ''), 0, false, a.id, '1970-01-01 00:00:00+00'::timestamptz
        FROM member_teams mt
        JOIN absences a ON a.member = mt.member
        WHERE mt.team = ?::integer
          AND a.start_date::date <= ?::date AND a.end_date::date >= ?::date
          AND (a.affects::jsonb @> '"all"' OR a.affects::jsonb @> '"games"')
          AND (a.type IS DISTINCT FROM 'weekly' OR (a.days_of_week::jsonb @> to_jsonb((EXTRACT(DOW FROM ?::date)::int + 6) % 7)))
          AND NOT EXISTS (
            SELECT 1 FROM participations p
            WHERE p.activity_type = 'game' AND p.activity_id = ?::text AND p.member = mt.member
          )
      `, [String(key), game.kscw_team, dateStr, dateStr, dateStr, String(key)])
      if (res?.rowCount > 0) log.info(`[absence-auto-decline] Game ${key}: ${res.rowCount} members auto-declined`)

      // Auto-confirm pass — per-activity override + team default. Guest-level=0
      // only (trg_participations_guest_block enforces). NOT EXISTS protects
      // absence-declined rows above and any prior participation.
      const confirmed = await autoConfirmGame(key)
      if (confirmed > 0) log.info(`[auto-confirm] Game ${key}: ${confirmed} members auto-confirmed`)
    } catch (err) {
      log.error({ msg: `[absence-auto-decline] Game create: ${err.message}`, event: 'absence_auto_decline_game', key, stack: err.stack })
    }
  })

  // Events — mirror trainings/games: decline for members already on absence
  action('events.items.create', async ({ key }) => {
    try {
      const event = await database('events').where('id', key).first()
      if (!event || !event.start_date) return
      // events.start_date is timestamptz; absence window/DOW matching is by
      // calendar date → derive the date in Zurich, not UTC (a 01:00 Zurich
      // event is the previous day in UTC and would match the wrong day).
      const ds = await database.raw(
        `SELECT to_char((? ::timestamptz AT TIME ZONE 'Europe/Zurich')::date, 'YYYY-MM-DD') AS d`,
        [event.start_date],
      )
      const dateStr = ds?.rows?.[0]?.d
      if (!dateStr) return
      const res = await database.raw(`
        INSERT INTO participations (member, activity_type, activity_id, status, note, guest_count, is_staff, auto_declined_by, waitlisted_at)
        SELECT DISTINCT ON (mt.member) mt.member, 'event', ?::text, 'declined', COALESCE(a.reason, ''), 0, false, a.id, '1970-01-01 00:00:00+00'::timestamptz
        FROM events_teams et
        JOIN member_teams mt ON mt.team = et.teams_id
        JOIN absences a ON a.member = mt.member
        WHERE et.events_id = ?::integer
          AND a.start_date::date <= ?::date AND a.end_date::date >= ?::date
          AND (a.affects::jsonb @> '"all"' OR a.affects::jsonb @> '"events"')
          AND (a.type IS DISTINCT FROM 'weekly' OR (a.days_of_week::jsonb @> to_jsonb((EXTRACT(DOW FROM ?::date)::int + 6) % 7)))
          AND NOT EXISTS (
            SELECT 1 FROM participations p
            WHERE p.activity_type = 'event' AND p.activity_id = ?::text AND p.member = mt.member
          )
      `, [String(key), key, dateStr, dateStr, dateStr, String(key)])
      if (res?.rowCount > 0) log.info(`[absence-auto-decline] Event ${key}: ${res.rowCount} members auto-declined`)

      // Auto-confirm pass — opted-in members only (no team-level event setting).
      // NOT EXISTS protects the absence-declines just inserted above.
      const confirmed = await autoConfirmEvent(key)
      if (confirmed > 0) log.info(`[auto-confirm] Event ${key}: ${confirmed} members auto-confirmed`)
    } catch (err) {
      log.error({ msg: `[absence-auto-decline] Event create: ${err.message}`, event: 'absence_auto_decline_event', key, stack: err.stack })
    }
  })

  // ── Activity date-change re-evaluation ─────────────────────────
  // When a training/game/event date moves, reverse stale auto-declines that
  // no longer apply (activity moved OUT of absence window), then insert fresh
  // ones for the new date (activity moved INTO a window). Manual overrides
  // are safe — the BEFORE UPDATE trigger on participations detaches them.

  async function reEvalActivityAutoDeclines(activityType, activityId, teamFilterSql, teamFilterParams, dateStr) {
    // 1. Remove auto-declines that no longer match (new date outside window)
    await database.raw(`
      DELETE FROM participations p
      USING absences a
      WHERE p.activity_type = ?
        AND p.activity_id = ?::text
        AND p.auto_declined_by = a.id
        AND (
          a.start_date::date > ?::date OR a.end_date::date < ?::date
          OR (
            NOT (a.affects::jsonb @> '"all"' OR a.affects::jsonb @> ?)
          )
          OR (
            a.type = 'weekly' AND NOT (a.days_of_week::jsonb @> to_jsonb((EXTRACT(DOW FROM ?::date)::int + 6) % 7))
          )
        )
    `, [activityType, String(activityId), dateStr, dateStr, `"${activityType}s"`, dateStr])
    // 2. Insert fresh auto-declines for the new date (NOT EXISTS skips manual overrides)
    //    Sentinel waitlisted_at marks these as auto-decline-created so the
    //    absence unwind DELETEs them rather than reverting to 'confirmed'.
    await database.raw(`
      INSERT INTO participations (member, activity_type, activity_id, status, note, guest_count, is_staff, auto_declined_by, waitlisted_at)
      SELECT mt.member, ?, ?::text, 'declined', COALESCE(a.reason, ''), 0, false, a.id, '1970-01-01 00:00:00+00'::timestamptz
      FROM member_teams mt
      JOIN absences a ON a.member = mt.member
      WHERE ${teamFilterSql}
        AND a.start_date::date <= ?::date AND a.end_date::date >= ?::date
        AND (a.affects::jsonb @> '"all"' OR a.affects::jsonb @> ?)
        AND (a.type IS DISTINCT FROM 'weekly' OR (a.days_of_week::jsonb @> to_jsonb((EXTRACT(DOW FROM ?::date)::int + 6) % 7)))
        AND NOT EXISTS (
          SELECT 1 FROM participations p
          WHERE p.activity_type = ? AND p.activity_id = ?::text AND p.member = mt.member
        )
    `, [activityType, String(activityId), ...teamFilterParams, dateStr, dateStr, `"${activityType}s"`, dateStr, activityType, String(activityId)])
  }

  // Notify the whole team (players + coaches + TR) when a training is
  // cancelled from the "Cancel training" control. Mirrors notifyAbsenceThirdParty:
  // an in-app `notifications` row (client localizes via title+body keys) plus a
  // per-recipient localized web push. Reinstating sends cancelled:false so it
  // never reaches here; past trainings are skipped (nothing to warn about).
  async function notifyTrainingCancelled(trainingId) {
    const tr = await database('trainings').where('id', trainingId)
      .select('id', 'team', 'date', 'cancelled').first()
    if (!tr || !tr.cancelled || !tr.team || !tr.date) return

    const dateStr = safeDateStr(tr.date)
    if (!dateStr) return
    const today = safeDateStr(new Date())
    if (today && dateStr < today) return // past training — skip

    const teamRow = await database('teams').where('id', tr.team).select('name').first()
    const teamName = teamRow?.name || `Team ${tr.team}`

    const [players, coaches, trs] = await Promise.all([
      database('member_teams').where('team', tr.team).select('member'),
      database('teams_coaches').where('teams_id', tr.team).select('members_id'),
      database('teams_responsibles').where('teams_id', tr.team).select('members_id'),
    ])
    const memberIds = [...new Set([
      ...players.map(r => r.member),
      ...coaches.map(r => r.members_id),
      ...trs.map(r => r.members_id),
    ].filter(Boolean))]
    if (memberIds.length === 0) return

    const active = await database('members')
      .whereIn('id', memberIds)
      .andWhere('wiedisync_active', true)
      .select('id')
    const recipientIds = active.map(r => r.id)
    if (recipientIds.length === 0) return

    const dateFmt = dateStr.split('-').reverse().join('.') // dd.mm.yyyy

    await database('notifications').insert(recipientIds.map(rid => ({
      member: rid,
      type: 'training_cancelled',
      title: 'training_cancelled',
      body: JSON.stringify({ date: dateFmt }),
      activity_type: 'training',
      activity_id: String(tr.id),
      team: tr.team,
      read: false,
    })))

    await sendLocalizedPush(
      database,
      recipientIds,
      (pids, title, body) => sendPushToMembers(database, pids, title, body, `${FRONTEND_URL}/trainings`, `training-cancelled-${tr.id}`, log),
      'trainingCancelled.title',
      'trainingCancelled.body',
      { team: teamName, date: dateFmt },
    )
  }

  // ── Forms (migrations 086/087) ──────────────────────────────────────
  // Notify the scoped audience once, when a form transitions to `open`.
  // Dedupes on an existing form_published notification so editing an already
  // open form (the builder always re-sends status) never re-notifies.
  async function notifyFormPublished(formId) {
    const form = await database('forms').where('id', formId)
      .select('id', 'title', 'status', 'audience').first()
    if (!form || form.status !== 'open') return

    const already = await database('notifications')
      .where({ type: 'form_published', activity_id: String(form.id) }).first()
    if (already) return

    let memberIds = []
    if (form.audience === 'club_wide') {
      const rows = await database('members').where('wiedisync_active', true).select('id')
      memberIds = rows.map(r => r.id)
    } else {
      const teamRows = await database('forms_teams').where('forms_id', formId).select('teams_id')
      const teamIds = [...new Set(teamRows.map(r => r.teams_id).filter(Boolean))]
      if (teamIds.length === 0) return
      const [players, coaches, trs] = await Promise.all([
        database('member_teams').whereIn('team', teamIds).select('member'),
        database('teams_coaches').whereIn('teams_id', teamIds).select('members_id'),
        database('teams_responsibles').whereIn('teams_id', teamIds).select('members_id'),
      ])
      memberIds = [...new Set([
        ...players.map(r => r.member),
        ...coaches.map(r => r.members_id),
        ...trs.map(r => r.members_id),
      ].filter(Boolean))]
    }
    if (memberIds.length === 0) return

    const active = await database('members')
      .whereIn('id', memberIds)
      .andWhere('wiedisync_active', true)
      .select('id')
    const recipientIds = active.map(r => r.id)
    if (recipientIds.length === 0) return

    await database('notifications').insert(recipientIds.map(rid => ({
      member: rid,
      type: 'form_published',
      title: 'form_published',
      body: JSON.stringify({ title: form.title }),
      activity_type: 'form',
      activity_id: String(form.id),
      team: null,
      read: false,
    })))

    await sendLocalizedPush(
      database,
      recipientIds,
      (pids, title, body) => sendPushToMembers(database, pids, title, body, `${FRONTEND_URL}/forms`, `form-${form.id}`, log),
      'formPublished.title',
      'formPublished.body',
      { title: form.title },
    )
  }

  action('forms.items.update', async ({ keys, payload }) => {
    if (payload && payload.status === 'open') {
      for (const k of keys) {
        try {
          await notifyFormPublished(k)
        } catch (err) {
          log.error({ msg: `[form-published-notify] ${err.message}`, event: 'form_published_notify', keys: [k], stack: err.stack })
        }
      }
    }
  })

  action('forms.items.create', async ({ key, payload }) => {
    if (payload && payload.status === 'open') {
      try {
        await notifyFormPublished(key)
      } catch (err) {
        log.error({ msg: `[form-published-notify] ${err.message}`, event: 'form_published_notify', keys: [key], stack: err.stack })
      }
    }
  })

  // ── Form submissions: server-side required-field validation ─────────
  // The app validates required fields client-side; this is the backstop for
  // any write that reaches Directus (member fill view, admin back-office). The
  // public website submits via the knex endpoint, which validates separately.
  // Best-effort: never block on an unexpected shape, only on a genuine miss.
  function answerIsEmpty(field, v) {
    if (v === null || v === undefined) return true
    if (field.type === 'multi_choice') return !(Array.isArray(v) && v.length > 0)
    if (field.type === 'yes_no') return false // a boolean is always an answer
    if (typeof v === 'string') return v.trim() === ''
    return false
  }
  filter('form_submissions.items.create', async (payload) => {
    try {
      if (!payload || !payload.form) return payload
      const form = await database('forms').where('id', payload.form).select('fields').first()
      const fields = Array.isArray(form?.fields) ? form.fields : []
      const answers = payload.answers && typeof payload.answers === 'object' ? payload.answers : {}
      for (const f of fields) {
        if (f && f.required && answerIsEmpty(f, answers[f.id])) {
          throw new Error(`Missing required field: ${f.label || f.id}`)
        }
      }
    } catch (err) {
      if (err.message && err.message.startsWith('Missing required field')) throw err
      // Swallow lookup/shape errors — the guard trigger still enforces integrity.
      log.warn({ msg: `[form-submission-validate] ${err.message}`, event: 'form_submission_validate' })
    }
    return payload
  })

  // ── Notify the form's owner (+ co-managers) when a response arrives ──
  // The author no longer has to keep re-opening the responses view. Recipients:
  // the form creator, plus coaches/TRs of any team the form is scoped to. The
  // submitter is excluded (so test-filling your own form is quiet). Anonymous
  // forms still notify — the owner sees a response landed, not who sent it.
  async function notifyFormSubmission(submissionId) {
    const sub = await database('form_submissions').where('id', submissionId)
      .select('id', 'form', 'member').first()
    if (!sub) return
    const form = await database('forms').where('id', sub.form)
      .select('id', 'title', 'created_by', 'audience').first()
    if (!form) return

    const recipients = new Set()
    if (form.created_by) recipients.add(form.created_by)
    if (form.audience === 'teams') {
      const teamRows = await database('forms_teams').where('forms_id', form.id).select('teams_id')
      const teamIds = [...new Set(teamRows.map(r => r.teams_id).filter(Boolean))]
      if (teamIds.length > 0) {
        const [coaches, trs] = await Promise.all([
          database('teams_coaches').whereIn('teams_id', teamIds).select('members_id'),
          database('teams_responsibles').whereIn('teams_id', teamIds).select('members_id'),
        ])
        for (const r of coaches) if (r.members_id) recipients.add(r.members_id)
        for (const r of trs) if (r.members_id) recipients.add(r.members_id)
      }
    }
    // Don't notify the person who just submitted.
    if (sub.member) recipients.delete(sub.member)
    if (recipients.size === 0) return

    const active = await database('members')
      .whereIn('id', [...recipients]).andWhere('wiedisync_active', true).select('id')
    const recipientIds = active.map(r => r.id)
    if (recipientIds.length === 0) return

    await database('notifications').insert(recipientIds.map(rid => ({
      member: rid,
      type: 'form_submission',
      title: 'form_submission',
      body: JSON.stringify({ title: form.title }),
      activity_type: 'form',
      activity_id: String(form.id),
      team: null,
      read: false,
    })))

    await sendLocalizedPush(
      database,
      recipientIds,
      (pids, title, body) => sendPushToMembers(database, pids, title, body, `${FRONTEND_URL}/forms`, `form-sub-${form.id}`, log),
      'formSubmission.title',
      'formSubmission.body',
      { title: form.title },
    )
  }

  action('form_submissions.items.create', async ({ key }) => {
    try {
      await notifyFormSubmission(key)
    } catch (err) {
      log.error({ msg: `[form-submission-notify] ${err.message}`, event: 'form_submission_notify', keys: [key], stack: err.stack })
    }
  })

  action('trainings.items.update', async ({ keys, payload }) => {
    // Notify the team when a training is cancelled (coach/TR pressed "Cancel
    // training"). payload.cancelled === true only on the cancel transition.
    if (payload && payload.cancelled === true) {
      for (const k of keys) {
        try {
          await notifyTrainingCancelled(k)
        } catch (err) {
          log.error({ msg: `[training-cancel-notify] ${err.message}`, event: 'training_cancel_notify', keys: [k], stack: err.stack })
        }
      }
    }

    // Re-eval absence-decline when date changed
    if (payload && 'date' in payload) {
      try {
        for (const k of keys) {
          const t = await database('trainings').where('id', k).first()
          if (!t || t.cancelled || !t.team || !t.date) continue
          const dateStr = t.date.toISOString?.().split('T')[0] || String(t.date).split('T')[0]
          await reEvalActivityAutoDeclines('training', k, 'mt.team = ?::integer', [t.team], dateStr)
        }
      } catch (err) {
        log.error({ msg: `[absence-auto-decline] Training update: ${err.message}`, event: 'absence_auto_decline_training_update', keys, stack: err.stack })
      }
    }

    // Backfill auto-confirm when auto_confirm_rsvp flips on (or any future-dated
    // update where effective auto-confirm is true and rows are missing).
    if (payload && 'auto_confirm_rsvp' in payload) {
      try {
        for (const k of keys) {
          const c = await autoConfirmTraining(k, { onlyIfFuture: true })
          if (c > 0) log.info(`[auto-confirm] Training ${k} update: ${c} members auto-confirmed`)
        }
      } catch (err) {
        log.error({ msg: `[auto-confirm] Training update: ${err.message}`, keys, stack: err.stack })
      }
    }
  })

  action('games.items.update', async ({ keys, payload }) => {
    if (payload && 'date' in payload) {
      try {
        for (const k of keys) {
          const g = await database('games').where('id', k).first()
          if (!g || !g.kscw_team || !g.date) continue
          if (['completed', 'postponed', 'cancelled'].includes(g.status)) continue
          const dateStr = g.date.toISOString?.().split('T')[0] || String(g.date).split('T')[0]
          await reEvalActivityAutoDeclines('game', k, 'mt.team = ?::integer', [g.kscw_team], dateStr)
        }
      } catch (err) {
        log.error({ msg: `[absence-auto-decline] Game update: ${err.message}`, event: 'absence_auto_decline_game_update', keys, stack: err.stack })
      }
    }

    if (payload && 'auto_confirm_rsvp' in payload) {
      try {
        for (const k of keys) {
          const c = await autoConfirmGame(k, { onlyIfFuture: true })
          if (c > 0) log.info(`[auto-confirm] Game ${k} update: ${c} members auto-confirmed`)
        }
      } catch (err) {
        log.error({ msg: `[auto-confirm] Game update: ${err.message}`, keys, stack: err.stack })
      }
    }
  })

  // Team toggle flip → backfill future activities that still inherit (auto_confirm_rsvp IS NULL).
  action('teams.items.update', async ({ keys, payload }) => {
    if (!payload || !('features_enabled' in payload)) return
    const fe = parseTeamFeatures(payload.features_enabled)
    const wantsTraining = fe.training_auto_confirm === true
    const wantsGame = fe.game_auto_confirm === true
    if (!wantsTraining && !wantsGame) return

    try {
      for (const teamId of keys) {
        if (wantsTraining) {
          const rows = await database.raw(`
            INSERT INTO participations (member, activity_type, activity_id, status, note, guest_count, is_staff)
            SELECT mt.member, 'training', t.id::text, 'confirmed', '', 0, false
            FROM trainings t
            JOIN member_teams mt ON mt.team = t.team
            WHERE t.team = ?::integer
              AND t.cancelled = false
              AND t.date >= CURRENT_DATE
              AND t.auto_confirm_rsvp IS NULL
              AND NOT (COALESCE(t.excluded_guest_levels, '[]')::jsonb @> to_jsonb(mt.guest_level))
              AND NOT EXISTS (
                SELECT 1 FROM participations p
                WHERE p.activity_type = 'training' AND p.activity_id = t.id::text AND p.member = mt.member
              )
          `, [teamId])
          if (rows?.rowCount > 0) log.info(`[auto-confirm] Team ${teamId} training backfill: ${rows.rowCount} confirmed`)
        }
        if (wantsGame) {
          const rows = await database.raw(`
            INSERT INTO participations (member, activity_type, activity_id, status, note, guest_count, is_staff)
            SELECT mt.member, 'game', g.id::text, 'confirmed', '', 0, false
            FROM games g
            JOIN member_teams mt ON mt.team = g.kscw_team
            WHERE g.kscw_team = ?::integer
              AND g.date >= CURRENT_DATE
              AND g.auto_confirm_rsvp IS NULL
              AND COALESCE(g.status, '') NOT IN ('completed','postponed','cancelled')
              AND mt.guest_level = 0
              AND NOT EXISTS (
                SELECT 1 FROM participations p
                WHERE p.activity_type = 'game' AND p.activity_id = g.id::text AND p.member = mt.member
              )
          `, [teamId])
          if (rows?.rowCount > 0) log.info(`[auto-confirm] Team ${teamId} game backfill: ${rows.rowCount} confirmed`)
        }
      }
    } catch (err) {
      log.error({ msg: `[auto-confirm] Team toggle backfill: ${err.message}`, keys, stack: err.stack })
    }
  })

  action('events.items.update', async ({ keys, payload }) => {
    if (!payload || !('start_date' in payload)) return
    try {
      for (const k of keys) {
        const e = await database('events').where('id', k).first()
        if (!e || !e.start_date) continue
        // events.start_date is timestamptz; absence window/DOW matching is by
        // calendar date, so derive the date in Zurich (not UTC). An event at
        // 01:00 Zurich is the previous day in UTC, which would match the wrong
        // absence day. safeDateStr() on the raw value would keep the UTC date.
        const ds = await database.raw(
          `SELECT to_char((? ::timestamptz AT TIME ZONE 'Europe/Zurich')::date, 'YYYY-MM-DD') AS d`,
          [e.start_date],
        )
        const dateStr = ds?.rows?.[0]?.d
        if (!dateStr) continue
        await reEvalActivityAutoDeclines(
          'event',
          k,
          'EXISTS (SELECT 1 FROM events_teams et WHERE et.events_id = ?::integer AND et.teams_id = mt.team)',
          [k],
          dateStr,
        )
      }
    } catch (err) {
      log.error({ msg: `[absence-auto-decline] Event update: ${err.message}`, event: 'absence_auto_decline_event_update', keys, stack: err.stack })
    }
  })

  // ── Hall Closure → Training Auto-Cancel ────────────────────────
  // When a hall_closures record is created or moved, cancel all future trainings
  // in that hall+date range. When the closure is deleted (or no longer covers
  // a training's date), reverse any trainings this closure had auto-cancelled.
  // Manual cancels are protected by the clear-marker trigger.

  async function applyClosureAutoCancel(closureId) {
    try {
      const c = await database('hall_closures').where('id', closureId).first()
      if (!c) return
      const start = c.start_date?.toISOString?.().split('T')[0]
        || String(c.start_date).split('T')[0]
      const end = c.end_date?.toISOString?.().split('T')[0]
        || String(c.end_date).split('T')[0]
      const today = new Date().toISOString().split('T')[0]
      const effectiveStart = start > today ? start : today
      const reason = c.reason || 'Halle geschlossen'

      // 1. Reverse trainings this closure had previously cancelled that no
      //    longer fall in its (new) window — covers date-range edits.
      await database.raw(`
        UPDATE trainings
        SET cancelled = false,
            cancel_reason = '',
            auto_cancelled_by_closure = NULL
        WHERE auto_cancelled_by_closure = ?::integer
          AND (hall != ? OR date < ?::date OR date > ?::date)
      `, [closureId, c.hall, start, end])

      // 2. Auto-cancel non-cancelled future trainings newly covered.
      const res = await database.raw(`
        UPDATE trainings
        SET cancelled = true,
            cancel_reason = ?,
            auto_cancelled_by_closure = ?::integer
        WHERE hall = ?
          AND date >= ?::date AND date <= ?::date
          AND cancelled = false
      `, [reason, closureId, c.hall, effectiveStart, end])
      if (res?.rowCount > 0) log.info(`[closure-auto-cancel] Closure ${closureId}: ${res.rowCount} trainings auto-cancelled`)
    } catch (err) {
      log.error({ msg: `[closure-auto-cancel] ${err.message}`, event: 'closure_auto_cancel', closureId, stack: err.stack })
    }
  }

  action('hall_closures.items.create', async ({ key }) => { await applyClosureAutoCancel(key) })
  action('hall_closures.items.update', async ({ keys }) => { for (const k of keys) await applyClosureAutoCancel(k) })
  action('hall_closures.items.delete', async ({ keys }) => {
    try {
      for (const k of keys) {
        const res = await database.raw(`
          UPDATE trainings
          SET cancelled = false, cancel_reason = '', auto_cancelled_by_closure = NULL
          WHERE auto_cancelled_by_closure = ?::integer
        `, [k])
        if (res?.rowCount > 0) log.info(`[closure-auto-cancel] Closure ${k} deleted: ${res.rowCount} trainings reversed`)
      }
    } catch (err) {
      log.error({ msg: `[closure-auto-cancel] delete: ${err.message}`, event: 'closure_auto_cancel_delete', stack: err.stack })
    }
  })

  // ── Cron: Absence Auto-Decline Sweep (01:30 UTC) ────────────────
  // Catches gaps: existing absences + newly generated recurring trainings,
  // or any edge case missed by the create/update hooks above.
  schedule('30 1 * * *', async () => {
    try {
      let total = 0

      // Trainings: decline for absent members who have no participation yet
      // (waitlisted_at sentinel marks these auto-decline-created → unwind DELETEs)
      const t1 = await database.raw(`
        INSERT INTO participations (member, activity_type, activity_id, status, note, guest_count, is_staff, auto_declined_by, waitlisted_at)
        SELECT mt.member, 'training', t.id::text, 'declined', COALESCE(a.reason, ''), 0, false, a.id, '1970-01-01 00:00:00+00'::timestamptz
        FROM trainings t
        JOIN member_teams mt ON mt.team = t.team
        JOIN absences a ON a.member = mt.member
        WHERE t.date >= CURRENT_DATE AND t.cancelled = false
          AND a.start_date::date <= t.date AND a.end_date::date >= t.date
          AND (a.affects::jsonb @> '"all"' OR a.affects::jsonb @> '"trainings"')
          AND (a.type IS DISTINCT FROM 'weekly' OR (a.days_of_week::jsonb @> to_jsonb(((EXTRACT(DOW FROM t.date)::int + 6) % 7))))
          AND NOT EXISTS (
            SELECT 1 FROM participations p
            WHERE p.activity_type = 'training' AND p.activity_id = t.id::text AND p.member = mt.member
          )
      `)
      total += t1?.rowCount || 0

      // Games
      const t2 = await database.raw(`
        INSERT INTO participations (member, activity_type, activity_id, status, note, guest_count, is_staff, auto_declined_by, waitlisted_at)
        SELECT mt.member, 'game', g.id::text, 'declined', COALESCE(a.reason, ''), 0, false, a.id, '1970-01-01 00:00:00+00'::timestamptz
        FROM games g
        JOIN member_teams mt ON mt.team = g.kscw_team
        JOIN absences a ON a.member = mt.member
        WHERE g.date >= CURRENT_DATE AND g.kscw_team IS NOT NULL
          AND COALESCE(g.status, '') NOT IN ('completed', 'postponed', 'cancelled')
          AND a.start_date::date <= g.date AND a.end_date::date >= g.date
          AND (a.affects::jsonb @> '"all"' OR a.affects::jsonb @> '"games"')
          AND (a.type IS DISTINCT FROM 'weekly' OR (a.days_of_week::jsonb @> to_jsonb(((EXTRACT(DOW FROM g.date)::int + 6) % 7))))
          AND NOT EXISTS (
            SELECT 1 FROM participations p
            WHERE p.activity_type = 'game' AND p.activity_id = g.id::text AND p.member = mt.member
          )
      `)
      total += t2?.rowCount || 0

      // Events — note DISTINCT ON so multi-team events produce one row per member.
      // events.start_date is timestamptz → localize to Zurich for the calendar-
      // date window/DOW match (a 01:00 Zurich event is the prior day in UTC).
      // Sentinel waitlisted_at marks these auto-decline-created → unwind DELETEs.
      const t3 = await database.raw(`
        INSERT INTO participations (member, activity_type, activity_id, status, note, guest_count, is_staff, auto_declined_by, waitlisted_at)
        SELECT DISTINCT ON (mt.member, e.id) mt.member, 'event', e.id::text, 'declined', COALESCE(a.reason, ''), 0, false, a.id, '1970-01-01 00:00:00+00'::timestamptz
        FROM events e
        JOIN events_teams et ON et.events_id = e.id
        JOIN member_teams mt ON mt.team = et.teams_id
        JOIN absences a ON a.member = mt.member
        WHERE (e.start_date AT TIME ZONE 'Europe/Zurich')::date >= CURRENT_DATE
          AND a.start_date::date <= (e.start_date AT TIME ZONE 'Europe/Zurich')::date AND a.end_date::date >= (e.start_date AT TIME ZONE 'Europe/Zurich')::date
          AND (a.affects::jsonb @> '"all"' OR a.affects::jsonb @> '"events"')
          AND (a.type IS DISTINCT FROM 'weekly' OR (a.days_of_week::jsonb @> to_jsonb(((EXTRACT(DOW FROM (e.start_date AT TIME ZONE 'Europe/Zurich')::date)::int + 6) % 7))))
          AND NOT EXISTS (
            SELECT 1 FROM participations p
            WHERE p.activity_type = 'event' AND p.activity_id = e.id::text AND p.member = mt.member
          )
      `)
      total += t3?.rowCount || 0

      if (total > 0) log.info(`[absence-sweep] Auto-declined ${total} participations`)
    } catch (err) {
      log.error({ msg: `[absence-sweep] ${err.message}`, event: 'cron.absence_sweep', stack: err.stack })
      logCronError('absence_sweep', err)
    }
  })

  // ── 2. Cron: Shell Account Expiry (02:00 UTC) ──────────────────
  // Batch UPDATE — no loop needed

  schedule('0 2 * * *', async () => {
    try {
      const count = await database('members')
        .where('shell', true)
        .where('shell_expires', '<', new Date().toISOString())
        .whereNotNull('shell_expires')
        .where('kscw_membership_active', true)
        .update({ kscw_membership_active: false })
      if (count > 0) log.info(`Shell expiry: ${count} deactivated`)
    } catch (err) {
      log.error({ msg: `Shell expiry: ${err.message}`, event: 'cron.shell_expiry', stack: err.stack })
      logCronError('shell_expiry', err)
    }
  })

  // ── 3. Cron: Invite Expiry (03:00 UTC) ─────────────────────────
  // Expire pending team_invites past their expiry date

  schedule('0 3 * * *', async () => {
    try {
      const count = await database('team_invites')
        .where('status', 'pending')
        .where('expires_at', '<', new Date().toISOString())
        .update({ status: 'expired' })
      if (count > 0) log.info(`Invite expiry: ${count} expired`)
    } catch (err) {
      log.error({ msg: `Invite expiry: ${err.message}`, event: 'cron.invite_expiry', stack: err.stack })
      logCronError('invite_expiry', err)
    }
  })

  // ── 4. Cron: Scorer Delegation Expiry (05:00 UTC) ──────────────
  // Expire pending delegations for past games

  schedule('0 5 * * *', async () => {
    try {
      const today = new Date().toISOString().split('T')[0]
      const count = await database('scorer_delegations')
        .where('status', 'pending')
        .whereIn('game', function () {
          this.select('id').from('games').where('date', '<', today)
        })
        .update({ status: 'expired' })
      if (count > 0) log.info(`Delegation expiry: ${count} expired`)
    } catch (err) {
      log.error({ msg: `Delegation expiry: ${err.message}`, event: 'cron.delegation_expiry', stack: err.stack })
      logCronError('delegation_expiry', err)
    }
  })

  // ── 5. Cron: Notification Cleanup (04:00 UTC) ──────────────────
  // 1) Delete notifications for past activities (day after activity date)
  // 2) Delete orphaned notifications (activity was deleted)
  // 3) Fallback: delete remaining notifications older than 30 days

  schedule('0 4 * * *', async () => {
    try {
      // 1) Past activities — delete notifications whose game/training/event already happened
      const pastGames = await database.raw(`
        DELETE FROM notifications n
        USING games g
        WHERE n.activity_type = 'game' AND n.activity_id = g.id::text
          AND g.date < CURRENT_DATE
      `)
      const pastTrainings = await database.raw(`
        DELETE FROM notifications n
        USING trainings t
        WHERE n.activity_type = 'training' AND n.activity_id = t.id::text
          AND t.date < CURRENT_DATE
      `)
      const pastEvents = await database.raw(`
        DELETE FROM notifications n
        USING events e
        WHERE n.activity_type = 'event' AND n.activity_id = e.id::text
          AND e.start_date::date < CURRENT_DATE
      `)

      // 2) Orphaned — activity was deleted but notification lingers
      const orphaned = await database.raw(`
        DELETE FROM notifications
        WHERE activity_type IN ('game', 'training', 'event')
          AND activity_id IS NOT NULL AND activity_id != ''
          AND (
            (activity_type = 'game'     AND NOT EXISTS (SELECT 1 FROM games     WHERE id::text = notifications.activity_id))
            OR (activity_type = 'training' AND NOT EXISTS (SELECT 1 FROM trainings WHERE id::text = notifications.activity_id))
            OR (activity_type = 'event'    AND NOT EXISTS (SELECT 1 FROM events    WHERE id::text = notifications.activity_id))
          )
      `)

      // 3) Fallback — catch-all for non-activity notifications (team, poll, etc.)
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - 30)
      const old = await database('notifications')
        .where('date_created', '<', cutoff.toISOString())
        .delete()

      const pastCount = (pastGames?.rowCount || 0) + (pastTrainings?.rowCount || 0) + (pastEvents?.rowCount || 0)
      const total = pastCount + (orphaned?.rowCount || 0) + old
      if (total > 0) log.info(`Notification cleanup: ${total} deleted (past=${pastCount}, orphaned=${orphaned?.rowCount || 0}, old=${old})`)
    } catch (err) {
      log.error({ msg: `Notification cleanup: ${err.message}`, event: 'cron.notification_cleanup', stack: err.stack })
      logCronError('notification_cleanup', err)
    }
  })

  // ── 6. Cron: Participation Reminders (07:00 UTC) ───────────────
  // Creates in-app notifications for unresponded members when deadline is tomorrow.
  // Uses batch INSERT...SELECT — no per-member loop.

  schedule('0 7 * * *', async () => {
    try {
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      const tomorrowStr = tomorrow.toISOString().split('T')[0]

      // Games with respond_by = tomorrow. Skip cancelled/postponed/completed
      // games (mirror the upcoming-games query) and guests — guests are hard-
      // blocked from game RSVPs (trg_participations_guest_block), so a reminder
      // they can't answer is just noise. COALESCE so NULL status/guest_level
      // rows aren't dropped.
      const gamesInserted = await database.raw(`
        INSERT INTO notifications (member, type, title, body, activity_type, activity_id, team, read)
        SELECT mt.member, 'deadline_reminder',
               'RSVP: ' || COALESCE(g.home_team, '') || ' vs ' || COALESCE(g.away_team, ''),
               COALESCE(g.date::text, ''),
               'game', g.id::text, g.kscw_team, false
        FROM games g
        JOIN member_teams mt ON mt.team = g.kscw_team
        WHERE g.respond_by::date = ?::date
          AND g.kscw_team IS NOT NULL
          AND COALESCE(g.status, '') NOT IN ('completed', 'postponed', 'cancelled')
          AND COALESCE(mt.guest_level, 0) = 0
          AND NOT EXISTS (
            SELECT 1 FROM participations p
            WHERE p.activity_type = 'game' AND p.activity_id = g.id::text AND p.member = mt.member
          )
      `, [tomorrowStr])

      // Trainings with respond_by = tomorrow
      const trainingsInserted = await database.raw(`
        INSERT INTO notifications (member, type, title, body, activity_type, activity_id, team, read)
        SELECT mt.member, 'deadline_reminder',
               'deadline_training',
               json_build_object(
                 'date', COALESCE(to_char(t.date, 'DD.MM.YY'), ''),
                 'hall', COALESCE(h.name, '')
               )::text,
               'training', t.id::text, t.team, false
        FROM trainings t
        JOIN member_teams mt ON mt.team = t.team
        LEFT JOIN halls h ON h.id = t.hall
        WHERE t.respond_by::date = ?::date
          AND t.team IS NOT NULL
          AND t.cancelled = false
          AND (t.excluded_guest_levels IS NULL
               OR NOT (t.excluded_guest_levels::jsonb @> to_jsonb(mt.guest_level)))
          AND NOT EXISTS (
            SELECT 1 FROM participations p
            WHERE p.activity_type = 'training' AND p.activity_id = t.id::text AND p.member = mt.member
          )
      `, [tomorrowStr])

      // Auto-cancel trainings past deadline with insufficient participation
      const autoCancelled = await database.raw(`
        UPDATE trainings SET cancelled = true, cancel_reason = 'auto_cancel_min_not_met'
        WHERE auto_cancel_on_min = true
          AND cancelled = false
          AND respond_by IS NOT NULL
          AND respond_by::date <= CURRENT_DATE
          AND min_participants > 0
          AND (
            SELECT COUNT(*) FROM participations p
            WHERE p.activity_type = 'training' AND p.activity_id = trainings.id::text AND p.status = 'confirmed'
          ) < min_participants
      `)

      // Auto-decline tentatives past deadline (per-team feature)
      await database.raw(`
        UPDATE participations SET status = 'declined'
        WHERE status = 'tentative'
          AND activity_type IN ('game', 'training')
          AND EXISTS (
            SELECT 1 FROM (
              SELECT id::text AS aid, respond_by, team AS team_id FROM trainings WHERE respond_by IS NOT NULL
              UNION ALL
              SELECT id::text AS aid, respond_by, kscw_team AS team_id FROM games WHERE respond_by IS NOT NULL
            ) a
            JOIN teams t ON t.id = a.team_id
            WHERE a.aid = participations.activity_id
              AND a.respond_by::date <= CURRENT_DATE
              AND (t.features_enabled->>'auto_decline_tentative')::boolean = true
          )
      `)

      log.info(`Participation reminders: games=${gamesInserted?.rowCount || 0}, trainings=${trainingsInserted?.rowCount || 0}, auto-cancelled=${autoCancelled?.rowCount || 0}`)

      // Send push notifications for deadline reminders
      try {
        const deadlineMembers = await database('notifications')
          .where('type', 'deadline_reminder')
          .where('read', false)
          .whereRaw("date_created::date = CURRENT_DATE")
          .distinct('member')
          .pluck('member')
        if (deadlineMembers.length > 0) {
          await sendLocalizedPush(
            database, deadlineMembers,
            (ids, title, body) => sendPushToMembers(database, ids, title, body, FRONTEND_URL, 'deadline_reminder', log),
            'deadline.title', 'deadline.body',
          )
        }
      } catch (pushErr) {
        log.warn({ msg: `Deadline push: ${pushErr.message}`, event: 'cron.deadline_push', stack: pushErr.stack })
        logCronError('deadline_push', pushErr)
      }
    } catch (err) {
      log.error({ msg: `Participation reminders: ${err.message}`, event: 'cron.participation_reminders', stack: err.stack })
      logCronError('participation_reminders', err)
    }
  })

  // ── 7. Cron: Daily Notification Reminders (06:30 UTC) ──────────
  // Upcoming activity notifications for tomorrow's games/trainings/events

  schedule('30 6 * * *', async () => {
    try {
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      const tomorrowStr = tomorrow.toISOString().split('T')[0]

      // Games tomorrow
      await database.raw(`
        INSERT INTO notifications (member, type, title, body, activity_type, activity_id, team, read)
        SELECT mt.member, 'upcoming_activity',
               'upcoming_game',
               json_build_object(
                 'home_team', COALESCE(g.home_team, ''),
                 'away_team', COALESCE(g.away_team, ''),
                 'date', COALESCE(to_char(g.date, 'DD.MM.YY'), ''),
                 'time', COALESCE(to_char(g.time, 'HH24:MI'), ''),
                 'hall', COALESCE(h.name, '')
               )::text,
               'game', g.id::text, g.kscw_team, false
        FROM games g
        JOIN member_teams mt ON mt.team = g.kscw_team
        LEFT JOIN halls h ON h.id = g.hall
        WHERE g.date = ?::date AND g.kscw_team IS NOT NULL
          AND COALESCE(g.status, '') NOT IN ('completed', 'postponed', 'cancelled')
      `, [tomorrowStr])

      // Trainings tomorrow
      await database.raw(`
        INSERT INTO notifications (member, type, title, body, activity_type, activity_id, team, read)
        SELECT mt.member, 'upcoming_activity',
               'upcoming_training',
               json_build_object(
                 'date', COALESCE(to_char(t.date, 'DD.MM.YY'), ''),
                 'time', COALESCE(to_char(t.start_time, 'HH24:MI'), ''),
                 'hall', COALESCE(h.name, '')
               )::text,
               'training', t.id::text, t.team, false
        FROM trainings t
        JOIN member_teams mt ON mt.team = t.team
        LEFT JOIN halls h ON h.id = t.hall
        WHERE t.date = ?::date AND t.team IS NOT NULL AND t.cancelled = false
      `, [tomorrowStr])

      // Events tomorrow — events.start_date is timestamptz, so localize to
      // Zurich for both the displayed date/time and the day filter (UTC would
      // show 17:00 for a 19:00 Zurich game and bucket a 00:00–02:00 Zurich
      // event onto the wrong calendar day).
      await database.raw(`
        INSERT INTO notifications (member, type, title, body, activity_type, activity_id, team, read)
        SELECT DISTINCT mt.member, 'upcoming_activity',
               'upcoming_event',
               json_build_object(
                 'title', COALESCE(e.title, 'Event'),
                 'date', COALESCE(to_char(e.start_date AT TIME ZONE 'Europe/Zurich', 'DD.MM.YY'), ''),
                 'time', COALESCE(to_char(e.start_date AT TIME ZONE 'Europe/Zurich', 'HH24:MI'), ''),
                 'location', COALESCE(NULLIF(h.name, ''), e.location, '')
               )::text,
               'event', e.id::text, et.teams_id, false
        FROM events e
        JOIN events_teams et ON et.events_id = e.id
        JOIN member_teams mt ON mt.team = et.teams_id
        LEFT JOIN halls h ON h.id = e.hall
        WHERE (e.start_date AT TIME ZONE 'Europe/Zurich')::date = ?::date
      `, [tomorrowStr])

      log.info('Daily notification reminders sent')

      // Send push notifications for upcoming activities
      try {
        const upcomingMembers = await database('notifications')
          .where('type', 'upcoming_activity')
          .where('read', false)
          .whereRaw("date_created::date = CURRENT_DATE")
          .distinct('member')
          .pluck('member')
        if (upcomingMembers.length > 0) {
          await sendLocalizedPush(
            database, upcomingMembers,
            (ids, title, body) => sendPushToMembers(database, ids, title, body, FRONTEND_URL, 'upcoming_activity', log),
            'tomorrow.title', 'tomorrow.body',
          )
        }
      } catch (pushErr) {
        log.warn({ msg: `Upcoming push: ${pushErr.message}`, event: 'cron.upcoming_push', stack: pushErr.stack })
        logCronError('upcoming_push', pushErr)
      }
    } catch (err) {
      log.error({ msg: `Daily reminders: ${err.message}`, event: 'cron.daily_reminders', stack: err.stack })
      logCronError('daily_reminders', err)
    }
  })

  // ── 8. Cron: Shell Reminder (09:00 UTC) ────────────────────────
  // Email shell members 10 days before expiry

  schedule('0 9 * * *', async () => {
    try {
      const reminderDate = new Date()
      reminderDate.setDate(reminderDate.getDate() + 10)
      const reminderStr = reminderDate.toISOString().split('T')[0]

      const expiring = await database('members')
        .where('shell', true)
        .where('kscw_membership_active', true)
        .where('shell_reminder_sent', false)
        .whereNotNull('shell_expires')
        .whereRaw("shell_expires::date <= ?::date", [reminderStr])
        .select('id', 'email', 'first_name', 'shell_expires')

      if (expiring.length === 0) return

      const schema = await getSchema()
      const { MailService } = services
      const mailService = new MailService({ schema, knex: database })

      for (const m of expiring) {
        if (!m.email || m.email.includes('@placeholder')) continue
        try {
          await mailService.send({
            to: m.email,
            subject: 'WiediSync — Dein Gastkonto läuft bald ab',
            text: `Hallo ${m.first_name || ''},\n\nDein WiediSync-Gastkonto läuft am ${m.shell_expires} ab.\nMelde dich bei deinem Coach, um es zu verlängern.\n\nKSC Wiedikon`,
          })
          await database('members').where('id', m.id).update({ shell_reminder_sent: true })
        } catch (mailErr) {
          log.warn({ msg: `Shell reminder mail failed for member ${m.id}`, event: 'cron.shell_reminder', memberId: m.id, stack: mailErr.stack })
          logCronError('shell_reminder_mail', mailErr, { memberId: m.id })
        }
      }
      log.info(`Shell reminder: ${expiring.length} members notified`)
    } catch (err) {
      log.error({ msg: `Shell reminder: ${err.message}`, event: 'cron.shell_reminder', stack: err.stack })
      logCronError('shell_reminder', err)
    }
  })

  // ── 9. Cron: Swiss Volley Sync (06:00 UTC) ────────────────────
  // Calls the existing SV sync endpoint via internal HTTP

  schedule('0 6 * * *', async () => {
    const startedAt = Date.now()
    try {
      const token = await getCronAccessToken(log, 'SV sync')
      if (!token) return
      const res = await fetch('http://localhost:8055/kscw/admin/sv-sync', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const body = await res.text()
      if (!res.ok) throw new Error(`${res.status} ${body}`)
      log.info(`SV sync cron: ${body}`)
      await logCronRun(database, 'sv_sync', { status: 'ok', durationMs: Date.now() - startedAt })
    } catch (err) {
      log.error({ msg: `SV sync cron: ${err.message}`, event: 'cron.sv_sync', stack: err.stack })
      logCronError('sv_sync', err)
      await logCronRun(database, 'sv_sync', { status: 'error', durationMs: Date.now() - startedAt, errorMessage: err.message })
    }
  })

  // ── 10. Cron: Basketplan Sync (06:05 UTC) ─────────────────────
  // Calls the existing BP sync endpoint via internal HTTP

  schedule('5 6 * * *', async () => {
    const startedAt = Date.now()
    try {
      const token = await getCronAccessToken(log, 'BP sync')
      if (!token) return
      const res = await fetch('http://localhost:8055/kscw/admin/bp-sync', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const body = await res.text()
      if (!res.ok) throw new Error(`${res.status} ${body}`)
      log.info(`BP sync cron: ${body}`)
      await logCronRun(database, 'bp_sync', { status: 'ok', durationMs: Date.now() - startedAt })
    } catch (err) {
      log.error({ msg: `BP sync cron: ${err.message}`, event: 'cron.bp_sync', stack: err.stack })
      logCronError('bp_sync', err)
      await logCronRun(database, 'bp_sync', { status: 'error', durationMs: Date.now() - startedAt, errorMessage: err.message })
    }
  })

  // ── 10b. Cron: Volleymanager Sync (weekly, Mondays 04:00 UTC) ──
  // Runs vm-sync-check.mjs: team metadata → `teams`, players/writers/referees
  // → `sv_vm_check` + members licence flags. Weekly (was monthly) so team
  // name/league corrections — heaviest around season rollover — propagate fast.
  // Shared runner so both the weekly cron and the failure-watchdog (below) use
  // the same spawn/log path. In-memory lock prevents overlapping runs (the
  // watchdog could otherwise fire while a run is still in flight).
  let vmSyncRunning = false
  async function runVmSync(reason) {
    if (!process.env.VM_USERNAME || !process.env.VM_PASSWORD) {
      log.warn('VM sync skipped: VM_USERNAME or VM_PASSWORD not set')
      return
    }
    if (vmSyncRunning) {
      log.info(`VM sync (${reason}) skipped: a run is already in progress`)
      return
    }
    vmSyncRunning = true
    const startedAt = Date.now()
    try {
      const token = await getCronAccessToken(log, 'VM sync')
      if (!token) return
      const { spawn } = await import('node:child_process')
      const env = {
        HOME: process.env.HOME,
        PATH: process.env.PATH,
        VM_USERNAME: process.env.VM_USERNAME,
        VM_PASSWORD: process.env.VM_PASSWORD,
        DIRECTUS_URL: 'http://127.0.0.1:8055',
        DIRECTUS_TOKEN: token,
      }
      const output = await new Promise((resolve, reject) => {
        const child = spawn('node', ['/directus/scripts/vm-sync-check.mjs'], { env })
        let stdout = ''
        let stderr = ''
        child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
        child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
        const timer = setTimeout(() => {
          child.kill('SIGKILL')
          reject(Object.assign(new Error('VM sync timed out after 10 min'), { status: null }))
        }, 600_000)
        child.on('close', (code) => {
          clearTimeout(timer)
          if (code === 0) resolve(stdout)
          else reject(Object.assign(new Error(`VM sync exited ${code}: ${stderr.slice(-500)}`), { status: code }))
        })
        child.on('error', (err) => { clearTimeout(timer); reject(err) })
      })
      log.info(`VM sync cron (${reason}): ${output.split('\n').slice(-6).join(' | ')}`)
      await logCronRun(database, 'vm_sync', { status: 'ok', durationMs: Date.now() - startedAt })
    } catch (err) {
      log.error({ msg: `VM sync cron (${reason}): ${err.message}`, exitCode: err.status, event: 'cron.vm_sync' })
      logCronError('vm_sync', new Error(err.message))
      await logCronRun(database, 'vm_sync', { status: 'error', durationMs: Date.now() - startedAt, errorMessage: err.message })
    } finally {
      vmSyncRunning = false
    }
  }

  schedule('0 4 * * 1', () => runVmSync('weekly'))

  // ── 10b². Watchdog: retry VM sync every 30 min while it's failing ──
  // VM intermittently 403s (2026-06-08). If the last vm_sync recorded `error`,
  // re-run every 30 min until it succeeds (status flips to `ok` → the watchdog
  // goes quiet on its own). Bounded: skip the <25min just-ran/in-progress
  // window so it never races the weekly run, and give up after 12h so a
  // genuinely-down VM isn't hammered until the next weekly cycle.
  schedule('*/30 * * * *', async () => {
    if (!process.env.VM_USERNAME || !process.env.VM_PASSWORD) return
    try {
      const row = await database('sync_runs').where({ source: 'vm_sync' }).first()
      if (!row || row.status !== 'error' || !row.last_run_at) return
      const ageMin = (Date.now() - new Date(row.last_run_at).getTime()) / 60000
      if (ageMin < 25 || ageMin > 720) return
      log.info(`VM sync watchdog: last run errored ~${Math.round(ageMin)}min ago — retrying`)
      await runVmSync('watchdog-retry')
    } catch (err) {
      log.error({ msg: `VM sync watchdog: ${err.message}`, event: 'cron.vm_sync_watchdog' })
    }
  })

  // ── 10c. Cron: SVRZ scheduling sync (daily 04:30 UTC) ──
  // Calls svrz-scheduling-sync.mjs — walks SVRZ JSON API, upserts games + contacts
  schedule('30 4 * * *', async () => {
    if (!process.env.VM_USERNAME || !process.env.VM_PASSWORD) {
      log.warn('SVRZ sync skipped: VM_USERNAME or VM_PASSWORD not set')
      return
    }
    const startedAt = Date.now()
    try {
      const token = await getCronAccessToken(log, 'SVRZ sync')
      if (!token) return
      const { spawn } = await import('node:child_process')
      const now = new Date()
      const startYear = now.getMonth() >= 5 ? now.getFullYear() : now.getFullYear() - 1
      const seasonName = `${startYear}/${startYear + 1}`
      const known = await database('svrz_spielplaner_contacts')
        .where('season_name', seasonName).whereNotNull('season_uuid').first()
      const seasonUuid = known?.season_uuid || 'dcafddfe-8139-4e02-baad-d3f88ec00cd0'
      const env = {
        HOME: process.env.HOME,
        PATH: process.env.PATH,
        VM_USERNAME: process.env.VM_USERNAME,
        VM_PASSWORD: process.env.VM_PASSWORD,
        DIRECTUS_URL: 'http://127.0.0.1:8055',
        DIRECTUS_TOKEN: token,
        SVRZ_SEASON_UUID: seasonUuid,
        SVRZ_SEASON_NAME: seasonName,
      }
      // Async spawn keeps the Directus event loop responsive while the sync runs
      // (cold run ≈9 min, ~2970 serial PATCHes). execSync previously blocked
      // /server/ping long enough to trigger uptime 503 alerts.
      const output = await new Promise((resolve, reject) => {
        const child = spawn('node', ['/directus/scripts/svrz-scheduling-sync.mjs'], { env })
        let stdout = ''
        let stderr = ''
        child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
        child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
        const timer = setTimeout(() => {
          child.kill('SIGKILL')
          reject(Object.assign(new Error('SVRZ sync timed out after 15 min'), { status: null }))
        }, 900_000)
        child.on('error', (err) => { clearTimeout(timer); reject(err) })
        child.on('close', (code) => {
          clearTimeout(timer)
          if (code === 0) resolve(stdout)
          else reject(Object.assign(new Error(stderr.trim() || `exited ${code}`), { status: code }))
        })
      })
      log.info(`SVRZ sync cron: ${output.split('\n').slice(-6).join(' | ')}`)
      await logCronRun(database, 'svrz_sync', { status: 'ok', durationMs: Date.now() - startedAt })
    } catch (err) {
      log.error({ msg: `SVRZ sync cron: ${err.message}`, exitCode: err.status, event: 'cron.svrz_sync' })
      logCronError('svrz_sync', new Error(err.message))
      await logCronRun(database, 'svrz_sync', { status: 'error', durationMs: Date.now() - startedAt, errorMessage: err.message })
    }
  })

  // ── 10e. Cron: Google Calendar / hall events sync (daily 04:00 UTC) ──
  // The /admin/gcal-sync endpoint was admin-trigger only, so hall_events
  // never refreshed automatically — /status orange "Hall schedule sync"
  // 41d ago was the consequence. Cron now hits the same endpoint nightly
  // with a system-context token so the venue feed stays fresh.
  schedule('0 4 * * *', async () => {
    const startedAt = Date.now()
    try {
      const token = await getCronAccessToken(log, 'GCal sync')
      if (!token) return
      const res = await fetch('http://localhost:8055/kscw/admin/gcal-sync', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const body = await res.text()
      if (!res.ok) throw new Error(`${res.status} ${body}`)
      log.info(`GCal sync cron: ${body.slice(0, 200)}`)
      await logCronRun(database, 'gcal_sync', { status: 'ok', durationMs: Date.now() - startedAt })
    } catch (err) {
      log.error({ msg: `GCal sync cron: ${err.message}`, event: 'cron.gcal_sync', stack: err.stack })
      logCronError('gcal_sync', err)
      await logCronRun(database, 'gcal_sync', { status: 'error', durationMs: Date.now() - startedAt, errorMessage: err.message })
    }
  })

  // ── 10e². Cron: Spielplanung mailbox sync (every 10 min) ──
  // Pulls the Migadu mailbox volleyball@spielplanung.kscw.ch (INBOX + Sent)
  // into scheduling_emails via the kscw-endpoints IMAP sync, so opponent
  // replies surface in the Terminplanung dashboard. Dormant until
  // SCHEDULING_IMAP_PASSWORD is set on the container.
  schedule('*/10 * * * *', async () => {
    if (!process.env.SCHEDULING_IMAP_PASSWORD) return
    const startedAt = Date.now()
    try {
      const token = await getCronAccessToken(log, 'Mailbox sync')
      if (!token) return
      const res = await fetch('http://localhost:8055/kscw/admin/terminplanung/mailbox/sync', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const body = await res.text()
      if (!res.ok) throw new Error(`${res.status} ${body}`)
      const result = JSON.parse(body)
      if (result.processed > 0) log.info(`Mailbox sync cron: ${result.processed} new messages`)
      await logCronRun(database, 'mailbox_sync', { status: 'ok', durationMs: Date.now() - startedAt, rowsChanged: result.processed || 0 })
    } catch (err) {
      log.error({ msg: `Mailbox sync cron: ${err.message}`, event: 'cron.mailbox_sync', stack: err.stack })
      logCronError('mailbox_sync', err)
      await logCronRun(database, 'mailbox_sync', { status: 'error', durationMs: Date.now() - startedAt, errorMessage: err.message })
    }
  })

  // ── 10f. Cron: Schulferien sync (monthly, 1st @ 04:30 UTC) ──
  // Imports the City of Zürich school-holiday calendar into hall_closures
  // (source='school_holidays') so the halls show as closed during the holidays
  // and holiday-date trainings auto-cancel. The published calendar only changes
  // a few times a year, so a monthly poll is plenty; the job is idempotent so a
  // missed month self-heals on the next run.
  schedule('30 4 1 * *', async () => {
    const startedAt = Date.now()
    try {
      const token = await getCronAccessToken(log, 'Schulferien sync')
      if (!token) return
      const res = await fetch('http://localhost:8055/kscw/admin/schulferien-sync', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const body = await res.text()
      if (!res.ok) throw new Error(`${res.status} ${body}`)
      log.info(`Schulferien sync cron: ${body.slice(0, 200)}`)
      await logCronRun(database, 'schulferien_sync', { status: 'ok', durationMs: Date.now() - startedAt })
    } catch (err) {
      log.error({ msg: `Schulferien sync cron: ${err.message}`, event: 'cron.schulferien_sync', stack: err.stack })
      logCronError('schulferien_sync', err)
      await logCronRun(database, 'schulferien_sync', { status: 'error', durationMs: Date.now() - startedAt, errorMessage: err.message })
    }
  })

  // ── 10d. Cron: Refresh teams.season dropdown choices (May 1 annually, 03:00 UTC) ──
  // Earliest allowed season is the one currently "live": Jan-Apr → last autumn's; May onwards → this autumn's.
  // The window only shifts on May 1 (old season ends), so one run per year is enough.
  // Past seasons are removed so admins can't accidentally assign a team to a finished season.

  function computeSeasonChoices(now = new Date(), count = 5) {
    const y = now.getFullYear()
    const m = now.getMonth()
    const startYear = m >= 4 ? y : y - 1
    const choices = []
    for (let i = 0; i < count; i++) {
      const a = startYear + i
      const b = String(a + 1).slice(2)
      const v = `${a}/${b}`
      choices.push({ text: v, value: v })
    }
    return choices
  }

  async function refreshSeasonChoices() {
    const choices = computeSeasonChoices()
    const options = { choices, allowOther: false }
    await database('directus_fields')
      .where({ collection: 'teams', field: 'season' })
      .update({ interface: 'select-dropdown', options: JSON.stringify(options) })
    return choices.map(c => c.value).join(', ')
  }

  schedule('0 3 1 5 *', async () => {
    try {
      const seasons = await refreshSeasonChoices()
      log.info(`[season-refresh] teams.season choices set to: ${seasons}`)
    } catch (err) {
      log.error({ msg: `Season refresh cron: ${err.message}`, event: 'cron.season_refresh', stack: err.stack })
      logCronError('season_refresh', err)
    }
  })

  // ── 11. Filter: Member Privacy (birthdate_visibility, hide_phone, hide_email) ──
  // Enforces privacy settings at the API level so even direct API access respects them.
  // Admins and the member's own record are exempt.

  filter('members.items.read', async (payload, meta, context) => {
    // Admins see everything
    if (context.accountability?.admin) return payload

    const currentUser = context.accountability?.user || null

    const items = Array.isArray(payload) ? payload : [payload]

    // Re-fetch the gating flags (user, hide_phone, hide_email, birthdate_visibility)
    // directly from the DB keyed by member id. The redaction MUST NOT depend on the
    // caller's `?fields=` projection — if the gating flags are omitted from the
    // requested fields, the in-payload values are undefined and a JS `=== true`
    // scrub silently leaks the hidden phone/email/birthdate. By reading the
    // authoritative flags from the DB we enforce privacy regardless of projection,
    // and fail closed (redact) when an item's gating flag can't be resolved.
    const ids = []
    for (const item of items) {
      if (item && item.id != null) ids.push(item.id)
    }
    const gateById = new Map()
    if (ids.length > 0) {
      const rows = await database('members')
        .whereIn('id', ids)
        .select('id', 'user', 'hide_phone', 'hide_email', 'birthdate_visibility')
      for (const row of rows) gateById.set(row.id, row)
    }

    for (const item of items) {
      if (!item) continue

      // Authoritative gating flags from the DB (never the requested projection).
      const gate = item.id != null ? gateById.get(item.id) : undefined

      // Skip filtering for the member's own record (resolved from the DB so the
      // self-check is correct even when `user` isn't in the projection).
      if (currentUser && gate && gate.user === currentUser) continue

      // Birthdate visibility — fail closed (hide) when the flag can't be resolved.
      const birthdateVisibility = gate ? gate.birthdate_visibility : 'hidden'
      if (birthdateVisibility === 'hidden') {
        if ('birthdate' in item) item.birthdate = null
      } else if (birthdateVisibility === 'year_only' && item.birthdate) {
        // Extract just the year (handles both '1990-01-01' and ISO datetime strings)
        item.birthdate = String(item.birthdate).substring(0, 4)
      }

      // Phone visibility — fail closed (hide) when the flag can't be resolved.
      if (!gate || gate.hide_phone === true) {
        if ('phone' in item) item.phone = null
      }

      // Email visibility — fail closed (hide) when the flag can't be resolved.
      if (!gate || gate.hide_email === true) {
        if ('email' in item) item.email = null
      }

      // AHV number — only visible to self and admins
      if ('ahv_nummer' in item) item.ahv_nummer = null
    }

    return Array.isArray(payload) ? items : items[0]
  })

  // ── 12. Cron: Error Log Cleanup (03:30 UTC) ─────────────────────
  // Delete error log files older than 30 days

  schedule('30 3 * * *', () => {
    try {
      cleanOldLogs()
      log.info('Error log cleanup completed')
    } catch (err) {
      log.error({ msg: `Error log cleanup: ${err.message}`, event: 'cron.error_log_cleanup', stack: err.stack })
    }
  })

  // ── 13. Registration Approval → CSV email ─────────────────────
  // When a registration status changes to 'approved', generate a CSV
  // and email it to the owner (luca.canepa@gmail.com)

  const OWNER_EMAIL = 'luca.canepa@gmail.com'
  const RADO_EMAIL = 'radomir.radovanovic.b@gmail.com'
  const VB_ADMIN_EMAIL = 'thamayanth.kanagalingam@uzh.ch'
  const BB_ADMIN_EMAIL = 'kscwiedikonbasketball@gmail.com'

  function getApprovalRecipients(membershipType) {
    switch (membershipType) {
      case 'basketball':
        return { to: [BB_ADMIN_EMAIL], cc: [OWNER_EMAIL] }
      case 'volleyball':
        return { to: [VB_ADMIN_EMAIL, RADO_EMAIL], cc: [OWNER_EMAIL] }
      default: // passive, unknown
        return { to: [OWNER_EMAIL], cc: [] }
    }
  }

  function csvEscapeHook(val) {
    const s = String(val ?? '')
    if (s.includes(';') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"'
    return s
  }

  function buildRegistrationCSV(item) {
    const headers = [
      'Nachname', 'Vorname', 'Firma', 'Adresse', 'PLZ', 'Ort',
      'Telefon Privat', 'Telefon Mobil', '[Gruppen]', 'Sektion', 'Gruppe', 'Gruppen',
      'Anrede', 'Titel', 'Briefanrede', 'Benutzer-Id', 'Adress-Zusatz', 'Land',
      'Nationalität', 'Telefon Geschäft', 'Fax', 'E-Mail', 'E-Mail Alternativ',
      'Status', '[Rolle]', 'Eintritt', 'Mitgliedsjahre', 'Austritt', 'Zivilstand',
      'Geschlecht', 'Geburtsdatum', 'Jahrgang', 'Alter', 'Bemerkungen',
      'Firmen-Webseite', 'Rechnungsversand', 'Nie mahnen', 'IBAN', 'BIC', 'Kontoinhaber',
      'Lizenznummer', 'Lizenzart', 'Lizenz bestellt', 'Beitragskategorie',
      'Betrag Bezahlt', 'Clubnummer', 'Mittelschule ZH', 'Offiziellen Lizenz',
      'Mitgliederbeitrag', 'AHV Nummer', 'Passivmitglied', 'Offiziellen 100er',
      'Funktion', 'Rolle'
    ]

    let dob = ''
    let jahrgang = ''
    if (item.geburtsdatum) {
      const parts = String(item.geburtsdatum).substring(0, 10).split('-')
      dob = parts[2] + '.' + parts[1] + '.' + parts[0]
      jahrgang = parts[0]
    }

    const now = new Date()
    const todayStr = String(now.getDate()).padStart(2, '0') + '.' +
      String(now.getMonth() + 1).padStart(2, '0') + '.' + now.getFullYear()

    const sektion = item.membership_type === 'volleyball' ? 'Volleyball'
      : item.membership_type === 'basketball' ? 'Basketball' : 'KSCW'
    const status = item.membership_type === 'passive' ? 'Passivmitglied' : 'Aktivmitglied'
    const isPassive = item.membership_type === 'passive' ? 'ja' : ''

    const row = [
      item.nachname || '', item.vorname || '', '',
      item.adresse || '', item.plz || '', item.ort || '',
      '', item.telefon_mobil || '',
      item.team || '', sektion, '', '',
      item.anrede || '', '', '', '', '', 'Schweiz',
      item.nationalitaet || '', '', '',
      item.email || '', '',
      status, '', todayStr, '', '', '',
      item.geschlecht || '', dob, jahrgang, '',
      item.bemerkungen || '',
      '', 'E-Mail', 'Nein', '', '', '',
      '', '', '',
      item.beitragskategorie || '',
      '', '',
      item.kantonsschule || '',
      item.lizenz || '',
      '',
      item.ahv_nummer || '',
      isPassive, '',
      item.rolle || '', '',
    ].map(csvEscapeHook)

    return '\uFEFF' + headers.join(';') + '\n' + row.join(';')
  }

  // ── i18n for registration status emails ───────────────────────
  const REG_T = {
    de: {
      approvedTitle: 'Anmeldung bestätigt',
      approvedSubtitle: 'Willkommen beim KSC Wiedikon!',
      approvedSubject: 'Anmeldung bestätigt — KSC Wiedikon',
      approvedGreeting: name => `Hallo ${name},`,
      approvedBody: `<p style="text-align:justify">Deine Anmeldung wurde geprüft und bestätigt. Willkommen beim KSC Wiedikon!</p>
        <p style="text-align:justify"><strong style="color:#e2e8f0">Nächster Schritt:</strong> Erstelle dein Konto auf unserer Vereinsplattform WiediSync, um Spielpläne, Trainings und Teaminfos zu sehen.</p>
        <p style="text-align:justify">Bei Fragen erreichst du uns unter <a href="mailto:kontakt@kscw.ch" style="color:#4A55A2">kontakt@kscw.ch</a>.</p>`,
      approvedCtaLabel: 'Konto erstellen',
      approvedFooter: 'Sportliche Grüsse — KSC Wiedikon',
      rejectedTitle: 'Anmeldung abgelehnt',
      rejectedSubtitle: 'KSC Wiedikon',
      rejectedSubject: 'Anmeldung abgelehnt — KSC Wiedikon',
      rejectedGreeting: name => `Hallo ${name},`,
      rejectedReasonLabel: 'Begründung',
      rejectedBody: `<p style="text-align:justify">Leider wurde deine Anmeldung abgelehnt.</p>`,
      rejectedContact: `<p style="text-align:justify">Falls du Fragen hast, melde dich bei <a href="mailto:kontakt@kscw.ch" style="color:#4A55A2">kontakt@kscw.ch</a>.</p>`,
      rejectedFooter: 'KSC Wiedikon',
      name: 'Name', team: 'Team', sport: 'Sportart', ref: 'Referenz',
    },
    en: {
      approvedTitle: 'Registration Approved',
      approvedSubtitle: 'Welcome to KSC Wiedikon!',
      approvedSubject: 'Registration Approved — KSC Wiedikon',
      approvedGreeting: name => `Hello ${name},`,
      approvedBody: `<p style="text-align:justify">Your registration has been reviewed and approved. Welcome to KSC Wiedikon!</p>
        <p style="text-align:justify"><strong style="color:#e2e8f0">Next step:</strong> Create your account on our club platform WiediSync to see schedules, trainings, and team info.</p>
        <p style="text-align:justify">For questions, reach us at <a href="mailto:kontakt@kscw.ch" style="color:#4A55A2">kontakt@kscw.ch</a>.</p>`,
      approvedCtaLabel: 'Create account',
      approvedFooter: 'Best regards — KSC Wiedikon',
      rejectedTitle: 'Registration Rejected',
      rejectedSubtitle: 'KSC Wiedikon',
      rejectedSubject: 'Registration Rejected — KSC Wiedikon',
      rejectedGreeting: name => `Hello ${name},`,
      rejectedReasonLabel: 'Reason',
      rejectedBody: `<p style="text-align:justify">Unfortunately, your registration has been rejected.</p>`,
      rejectedContact: `<p style="text-align:justify">If you have any questions, contact us at <a href="mailto:kontakt@kscw.ch" style="color:#4A55A2">kontakt@kscw.ch</a>.</p>`,
      rejectedFooter: 'KSC Wiedikon',
      name: 'Name', team: 'Team', sport: 'Sport', ref: 'Reference',
    },
  }
  function regT(locale) { return REG_T[locale] || REG_T.de }

  // ── Helper: season string (e.g. "2025/26") ─────────────────────
  // Season cutover is JUNE 1 (m=5), matching the canonical reader in
  // src/utils/dateHelpers.ts. Before June → previous autumn's season; June
  // onwards → this autumn's. (Was Sept/m<8, which disagreed with the frontend
  // and mis-stamped seasons for June–August writes.)
  function getCurrentSeason() {
    const now = new Date()
    const y = now.getFullYear()
    const m = now.getMonth() // 0-based, season starts June (m=5)
    return m < 5 ? `${y - 1}/${String(y).slice(2)}` : `${y}/${String(y + 1).slice(2)}`
  }

  // ── Normalize registration geschlecht to member sex (m/f) ───
  function normalizeSex(val) {
    if (!val) return null
    const v = val.toLowerCase()
    if (v === 'm' || v === 'männlich' || v === 'male') return 'm'
    if (v === 'f' || v === 'weiblich' || v === 'female') return 'f'
    return null
  }

  // ── Map registration licence strings to member licence codes ───
  function mapLicences(lizenzStr, membershipType) {
    if (!lizenzStr) return []
    const parts = lizenzStr.split(',').map(s => s.trim().toLowerCase())
    const mapped = []
    for (const p of parts) {
      if (membershipType === 'volleyball') {
        if (p.includes('schreiber') || p === 'scorer') mapped.push('scorer_vb')
        if (p.includes('schiedsrichter') || p === 'referee') mapped.push('referee_vb')
      } else if (membershipType === 'basketball') {
        if (p.includes('otr 1') || p === 'otr1') mapped.push('otr1_bb')
        if (p.includes('otr 2') || p === 'otr2') mapped.push('otr2_bb')
        if (p.includes('otn')) mapped.push('otn_bb')
        if (p.includes('schiedsrichter') || p === 'referee') mapped.push('referee_bb')
      }
    }
    return [...new Set(mapped)]
  }

  // ── Create or link member from approved registration ───────────
  async function createMemberFromRegistration(db, reg, log) {
    const email = reg.email.toLowerCase().trim()
    const rolle = (reg.rolle || '').toLowerCase()

    // 1. Check if member already exists
    const existingMember = await db('members').where('email', email).first()

    let memberId
    if (existingMember) {
      memberId = existingMember.id
      log.info({ msg: 'Member already exists, linking registration', memberId, email })
      // Update fields that might be missing
      const updates = {}
      if (!existingMember.phone && reg.telefon_mobil) updates.phone = reg.telefon_mobil
      if (!existingMember.adresse && reg.adresse) updates.adresse = reg.adresse
      if (!existingMember.plz && reg.plz) updates.plz = reg.plz
      if (!existingMember.ort && reg.ort) updates.ort = reg.ort
      if (!existingMember.nationalitaet && reg.nationalitaet) updates.nationalitaet = reg.nationalitaet
      if (!existingMember.sex && reg.geschlecht) updates.sex = normalizeSex(reg.geschlecht)
      if (!existingMember.ahv_nummer && reg.ahv_nummer) updates.ahv_nummer = reg.ahv_nummer
      if (!existingMember.beitragskategorie && reg.beitragskategorie) updates.beitragskategorie = reg.beitragskategorie
      // Merge licences. Migration 067 split licences into per-flag booleans;
      // we dual-write (booleans + legacy JSON) through the migration window
      // so reconciliation scripts still see consistent state. Migration 069
      // drops the JSON column and this `updates.licences = …` line with it.
      const existingLicences = existingMember.licences || []
      const newLicences = mapLicences(reg.lizenz, reg.membership_type)
      const mergedLicences = [...new Set([...existingLicences, ...newLicences])]
      if (mergedLicences.length > existingLicences.length) {
        updates.licences = JSON.stringify(mergedLicences)
        for (const lic of newLicences) {
          if (!existingMember[lic]) updates[lic] = true
        }
      }
      if (Object.keys(updates).length) {
        await db('members').where('id', memberId).update(updates)
      }
    } else {
      // 2. Create new shell member
      const shellExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      const licences = mapLicences(reg.lizenz, reg.membership_type)
      const lang = reg.locale === 'en' ? 'english' : 'german'

      const [member] = await db('members').insert({
        first_name: reg.vorname,
        last_name: reg.nachname,
        email,
        phone: reg.telefon_mobil || null,
        adresse: reg.adresse || null,
        plz: reg.plz || null,
        ort: reg.ort || null,
        birthdate: reg.geburtsdatum || null,
        nationalitaet: reg.nationalitaet || null,
        sex: normalizeSex(reg.geschlecht),
        ahv_nummer: reg.ahv_nummer || null,
        beitragskategorie: reg.beitragskategorie || null,
        // Dual-write through migration 067/069 cutover (see merge block above).
        licences: JSON.stringify(licences),
        scorer_vb: licences.includes('scorer_vb'),
        referee_vb: licences.includes('referee_vb'),
        otr1_bb: licences.includes('otr1_bb'),
        otr2_bb: licences.includes('otr2_bb'),
        otn_bb: licences.includes('otn_bb'),
        referee_bb: licences.includes('referee_bb'),
        shell: true,
        shell_expires: shellExpires,
        shell_reminder_sent: false,
        wiedisync_active: false,
        coach_approved_team: true,
        kscw_membership_active: true,
        birthdate_visibility: 'hidden',
        language: lang,
        role: JSON.stringify(['user']),
      }).returning('id')

      memberId = member.id || member
      log.info({ msg: 'Shell member created from registration', memberId, email })
    }

    // 3. Link to team(s) based on rolle
    if (reg.team && reg.membership_type !== 'passive') {
      const teamNames = reg.team.split(',').map(t => t.trim()).filter(Boolean)
      const teamRows = await db('teams')
        .whereIn('name', teamNames).andWhere('active', true).select('id', 'name')

      const season = getCurrentSeason()

      for (const team of teamRows) {
        if (rolle.includes('trainer') || rolle.includes('coach')) {
          // Coach → teams_coaches
          const exists = await db('teams_coaches')
            .where({ teams_id: team.id, members_id: memberId }).first()
          if (!exists) {
            await db('teams_coaches').insert({ teams_id: team.id, members_id: memberId })
            log.info({ msg: 'Added as coach', memberId, team: team.name })
          }
        } else if (rolle.includes('teamverantwortlich') || rolle.includes('team responsible')) {
          // Team Responsible → teams_responsibles
          const exists = await db('teams_responsibles')
            .where({ teams_id: team.id, members_id: memberId }).first()
          if (!exists) {
            await db('teams_responsibles').insert({ teams_id: team.id, members_id: memberId })
            log.info({ msg: 'Added as team responsible', memberId, team: team.name })
          }
        } else if (rolle.includes('spieler') || rolle.includes('player') || !rolle || rolle.includes('andere') || rolle.includes('other')) {
          // Player → member_teams
          const exists = await db('member_teams')
            .where({ member: memberId, team: team.id, season }).first()
          if (!exists) {
            await db('member_teams').insert({
              member: memberId, team: team.id, season, guest_level: 0,
            })
            log.info({ msg: 'Added to team roster', memberId, team: team.name, season })
          }
        }
      }
    }

    return memberId
  }

  action('items.update', async ({ collection, keys, payload }, { schema }) => {
    if (collection !== 'registrations') return
    if (payload.status !== 'approved' && payload.status !== 'rejected') return

    try {
      const { ItemsService, MailService } = services
      const itemsService = new ItemsService('registrations', { schema, knex: database })
      const mail = new MailService({ schema, knex: database })

      for (const id of keys) {
        const reg = await itemsService.readOne(id)
        const locale = reg.locale || 'de'
        const l = regT(locale)
        const sport = reg.membership_type === 'volleyball' ? 'volleyball'
          : reg.membership_type === 'basketball' ? 'basketball' : null

        const summaryCard = buildInfoCard([
          { label: l.name, value: `${reg.vorname} ${reg.nachname}`, halfWidth: true },
          { label: l.sport, value: reg.membership_type.charAt(0).toUpperCase() + reg.membership_type.slice(1), halfWidth: true },
          { label: l.team, value: reg.team || '-', halfWidth: true },
          { label: l.ref, value: reg.reference_number, halfWidth: true },
        ])

        if (payload.status === 'approved') {
          // ── 1. Gather coach/TR emails for CC ──
          let coachTrCc = []
          if (reg.team && reg.membership_type !== 'passive') {
            try {
              const teamNames = reg.team.split(',').map(t => t.trim()).filter(Boolean)
              const teamRows = await database('teams')
                .whereIn('name', teamNames).andWhere('active', true).select('id')
              if (teamRows.length) {
                const teamIds = teamRows.map(r => r.id)
                const coachRows = await database('teams_coaches')
                  .whereIn('teams_id', teamIds)
                  .join('members', 'teams_coaches.members_id', 'members.id')
                  .join('directus_users', 'members.user', 'directus_users.id')
                  .whereNotNull('directus_users.email').select('directus_users.email')
                const trRows = await database('teams_responsibles')
                  .whereIn('teams_id', teamIds)
                  .join('members', 'teams_responsibles.members_id', 'members.id')
                  .join('directus_users', 'members.user', 'directus_users.id')
                  .whereNotNull('directus_users.email').select('directus_users.email')
                coachTrCc = [...new Set([...coachRows, ...trRows].map(r => r.email.toLowerCase()))]
                  .filter(e => e !== reg.email.toLowerCase())
              }
            } catch (teamErr) {
              log.warn({ msg: `Coach/TR lookup failed: ${teamErr.message}`, id })
            }
          }

          // ── 2. Confirmation email to user (CC coach/TR) ──
          const approvalHtml = buildEmailLayout(
            summaryCard + `<div style="font-size:13px;color:#94a3b8;line-height:1.7;margin-top:12px">${l.approvedBody}</div>`,
            { title: l.approvedTitle, subtitle: l.approvedSubtitle, sport, greeting: l.approvedGreeting(reg.vorname), footerExtra: l.approvedFooter, ctaUrl: `${FRONTEND_URL}/signup`, ctaLabel: l.approvedCtaLabel }
          )
          await mail.send({
            to: reg.email,
            ...(coachTrCc.length ? { cc: coachTrCc } : {}),
            subject: l.approvedSubject,
            html: approvalHtml,
          })
          log.info({ msg: 'Approval confirmation sent', id, email: reg.email, cc: coachTrCc.length })

          // ── 3. Create or link member in Directus ──
          try {
            await createMemberFromRegistration(database, reg, log)
          } catch (memberErr) {
            log.error({ msg: `Member creation failed: ${memberErr.message}`, id, stack: memberErr.stack })
          }

          // ── 4. CSV email to sport-specific admins (per-recipient locale) ──
          const csv = buildRegistrationCSV(reg)
          const csvBuffer = Buffer.from(csv, 'utf-8')
          const filename = `anmeldung_${reg.nachname}_${reg.vorname}_${reg.reference_number}.csv`
          const recipients = getApprovalRecipients(reg.membership_type)
          const adminCsvCopy = {
            de: {
              name: 'Name', type: 'Typ', team: 'Team', email: 'E-Mail', ref: 'Referenz',
              intro: 'Die Anmeldung wurde bestätigt. Die CSV-Datei für den ClubDesk-Import ist im Anhang.',
              title: 'Anmeldung bestätigt', cta: 'Im Admin öffnen',
              subject: `[KSCW] Anmeldung bestätigt: ${reg.vorname} ${reg.nachname} (${reg.membership_type})`,
            },
            en: {
              name: 'Name', type: 'Type', team: 'Team', email: 'Email', ref: 'Reference',
              intro: 'The registration has been approved. The CSV file for the ClubDesk import is attached.',
              title: 'Registration approved', cta: 'Open in admin',
              subject: `[KSCW] Registration approved: ${reg.vorname} ${reg.nachname} (${reg.membership_type})`,
            },
          }
          const ccLower = (recipients.cc || []).map(e => e.toLowerCase())
          const toLower = (recipients.to || []).map(e => e.toLowerCase())
          const toBuckets = await bucketEmailsByLocale(database, toLower)
          const ccBuckets = await bucketEmailsByLocale(database, ccLower)
          // CC riders on the same locale bucket; if their bucket has no TO, promote them to TO
          for (const loc of ['de', 'en']) {
            let tos = toBuckets[loc]
            const ccs = ccBuckets[loc].filter(e => !tos.includes(e))
            if (!tos.length && !ccs.length) continue
            if (!tos.length) {
              tos = ccs
              ccBuckets[loc] = []
            }
            const c = adminCsvCopy[loc]
            const adminCsvBody = buildInfoCard([
              { label: c.name, value: `${reg.vorname} ${reg.nachname}`, halfWidth: true },
              { label: c.type, value: reg.membership_type, halfWidth: true },
              { label: c.team, value: reg.team || '-', halfWidth: true },
              { label: c.email, value: reg.email, halfWidth: true },
              { label: c.ref, value: reg.reference_number },
            ]) + `<div style="font-size:13px;color:#94a3b8;line-height:1.7;margin-top:12px;text-align:justify"><p>${c.intro}</p></div>`
            const adminCsvHtml = buildEmailLayout(adminCsvBody, {
              title: c.title,
              subtitle: `${reg.vorname} ${reg.nachname} — ${reg.membership_type}`,
              sport,
              ctaUrl: 'https://wiedisync.kscw.ch/admin/anmeldungen',
              ctaLabel: c.cta,
            })
            await mail.send({
              to: tos,
              ...(ccBuckets[loc].length ? { cc: ccBuckets[loc] } : {}),
              subject: c.subject,
              html: adminCsvHtml,
              attachments: [{ filename, content: csvBuffer, contentType: 'application/vnd.ms-excel' }],
            })
          }
          log.info({ msg: 'Approval CSV sent', id, ref: reg.reference_number })

        } else if (payload.status === 'rejected') {
          // ── Rejection email to user ──
          const reason = payload.rejection_reason || reg.rejection_reason || ''
          // Admin-supplied rejection reason ends up in the user's mailbox.
          // Escape HTML so an admin can't inject phishing markup or a tracking
          // pixel into the email body.
          const reasonBlock = reason
            ? `<div style="background:#450a0a;border:1px solid #7f1d1d;border-radius:8px;padding:12px 16px;margin:12px 0"><div style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#f87171;font-weight:700;margin-bottom:4px">${l.rejectedReasonLabel}</div><div style="font-size:13px;color:#fca5a5">${escapeEmailHtml(reason)}</div></div>`
            : ''
          const rejectionHtml = buildEmailLayout(
            summaryCard + `<div style="font-size:13px;color:#94a3b8;line-height:1.7;margin-top:12px">${l.rejectedBody}</div>` + reasonBlock + `<div style="font-size:13px;color:#94a3b8;line-height:1.7;margin-top:12px">${l.rejectedContact}</div>`,
            { title: l.rejectedTitle, subtitle: l.rejectedSubtitle, greeting: l.rejectedGreeting(reg.vorname), footerExtra: l.rejectedFooter }
          )
          await mail.send({ to: reg.email, subject: l.rejectedSubject, html: rejectionHtml })
          log.info({ msg: 'Rejection email sent to user', id, email: reg.email })
        }
      }
    } catch (err) {
      log.error({ msg: `Registration status email: ${err.message}`, event: 'registration.status', stack: err.stack })
    }
  })

  // Messaging retention (Plan 05 / spec §9)
  // Runs nightly at 03:00 UTC. Failures isolated via try/catch.
  schedule('0 3 * * *', async () => {
    try {
      const db = database
      const now = new Date()

      const r1 = await db('messages')
        .whereRaw(`created_at < NOW() - INTERVAL '12 months'`)
        .del()
      const r2 = await db('messages')
        .whereRaw(`deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '30 days'`)
        .del()
      const r3 = await db('message_requests')
        .where('status', 'declined')
        .andWhereRaw(`resolved_at < NOW() - INTERVAL '90 days'`)
        .del()

      logger.info({
        plan: 'messaging-05-retention',
        at: now.toISOString(),
        purged: { old_messages: r1, soft_deleted_messages: r2, declined_requests: r3 },
      }, 'messaging retention cron complete')
    } catch (err) {
      logger.error({ err: err?.message ?? String(err) }, 'messaging retention cron failed')
    }
  })

  // ── Spielplaner scope guard on games.create ──────────────────────────────
  // Directus permission filters on the CREATE action don't evaluate relational
  // conditions against the incoming payload (only scalar fields work, e.g.
  // "source == manual"). The KSCW Spielplaner policy relies on a relational
  // filter (kscw_team ∈ caller's spielplaner_assignments) which Directus
  // silently treats as satisfied at CREATE time. This hook enforces that check
  // server-side for non-admin callers creating manual games.
  //
  // Admins and service calls (no accountability.user) bypass.
  // Club-wide Spielplaners (members.is_spielplaner = true) bypass the team check.
  function kscwScopeError(message, status, code) {
    const err = new Error(message)
    err.status = status
    err.code = code
    err.extensions = { code }
    return err
  }
  filter('games.items.create', async (payload, _meta, { accountability, database: db }) => {
    if (!accountability?.user) return payload
    if (accountability.admin) return payload
    if (payload?.source !== 'manual') return payload

    const member = await db('members').where('user', accountability.user).first('id', 'is_spielplaner')
    if (!member) return payload // not a member — let Directus deny via its own check
    if (member.is_spielplaner === true) return payload // club-wide scope

    const team = payload?.kscw_team
    if (team == null) {
      throw kscwScopeError('Manual game requires kscw_team', 400, 'INVALID_PAYLOAD')
    }

    const assigned = await db('spielplaner_assignments')
      .where('member', member.id)
      .andWhere('kscw_team', team)
      .first('id')
    if (!assigned) {
      throw kscwScopeError('Team is not in your Spielplaner scope', 403, 'FORBIDDEN')
    }
    return payload
  })

  // ── Scheduling blocks create: stamp creator + enforce team scope ────────
  // The `scheduling_blocks.create` policy permission is unfiltered (Directus
  // can't validate a relational filter on a not-yet-existing row), so this
  // filter is the real gate: a coach/TR may only block a team they coach or are
  // responsible for. Club-wide Spielplaner + full admin may block any team
  // (mirrors games.items.create). created_by is stamped from accountability.
  filter('scheduling_blocks.items.create', async (payload, _meta, { accountability, database: db }) => {
    if (!accountability?.user) return payload
    const member = await db('members').where('user', accountability.user).first('id', 'is_spielplaner')
    const out = member?.id ? { ...payload, created_by: payload?.created_by ?? member.id } : payload
    if (accountability.admin) return out            // full admin — any team
    if (!member) return out                         // not a member — Directus denies via policy
    if (member.is_spielplaner === true) return out  // club-wide Spielplaner — any team
    const team = out.team
    if (team == null) {
      throw kscwScopeError('Team blocking requires a team', 400, 'INVALID_PAYLOAD')
    }
    const isCoach = await db('teams_coaches').where({ teams_id: team, members_id: member.id }).first('id')
    const isTR = await db('teams_responsibles').where({ teams_id: team, members_id: member.id }).first('id')
    if (!isCoach && !isTR) {
      throw kscwScopeError('You can only block teams you coach or are responsible for', 403, 'FORBIDDEN')
    }
    return out
  })

  // ── Participation create: absence-aware auto-decline ────────────────────
  // System-context creates (the cron writing a fresh declined row when an
  // absence is created) still get auto-flipped to declined. User-driven
  // creates DO NOT — a member's explicit "Yes" / "Maybe" click is the source
  // of truth, even if a covering absence still exists. Policy aligned with
  // the BEFORE UPDATE trigger from migration 038, which clears
  // `auto_declined_by` on any user-initiated status change for the same
  // reason: the user's last manual action wins.
  filter('participations.items.create', async (payload, _meta, { database: db, accountability }) => {
    try {
      if (!payload || !payload.activity_type || !payload.activity_id || !payload.member) return payload
      // If already declined, nothing to do.
      if (payload.status === 'declined') return payload
      // Skip when the request is user-driven — trust the explicit RSVP.
      // Cron writes have null accountability (system context), so
      // autoDeclineForAbsence's INSERT path still passes through this filter
      // and would no-op (it sets status=declined upfront).
      if (accountability?.user) return payload

      // Resolve activity date based on activity_type
      let activityDate = null
      let affectsKey = null
      if (payload.activity_type === 'training') {
        const row = await db('trainings').where('id', payload.activity_id).first('date', 'cancelled')
        if (!row || row.cancelled) return payload
        activityDate = row.date
        affectsKey = 'trainings'
      } else if (payload.activity_type === 'game') {
        const row = await db('games').where('id', payload.activity_id).first('date', 'status')
        if (!row) return payload
        if (['completed', 'postponed', 'cancelled'].includes(row.status || '')) return payload
        activityDate = row.date
        affectsKey = 'games'
      } else if (payload.activity_type === 'event') {
        const row = await db('events').where('id', payload.activity_id).first('start_date')
        if (!row) return payload
        activityDate = row.start_date
        affectsKey = 'events'
      } else {
        return payload
      }
      if (!activityDate) return payload

      const dateStr = activityDate.toISOString?.().split('T')[0] || String(activityDate).split('T')[0]
      const res = await db.raw(`
        SELECT a.id, COALESCE(a.reason, '') AS reason
        FROM absences a
        WHERE a.member = ?::integer
          AND a.start_date::date <= ?::date AND a.end_date::date >= ?::date
          AND (a.affects::jsonb @> '"all"' OR a.affects::jsonb @> ?::jsonb)
          AND (a.type IS DISTINCT FROM 'weekly' OR a.days_of_week::jsonb @> to_jsonb((EXTRACT(DOW FROM ?::date)::int + 6) % 7))
        ORDER BY a.id ASC
        LIMIT 1
      `, [payload.member, dateStr, dateStr, JSON.stringify(affectsKey), dateStr])

      const absence = res?.rows?.[0]
      if (!absence) return payload

      log.info(`[absence-auto-decline] participation create override: member=${payload.member} ${payload.activity_type}=${payload.activity_id} → declined (absence ${absence.id})`)
      return {
        ...payload,
        status: 'declined',
        note: payload.note || absence.reason,
        auto_declined_by: absence.id,
      }
    } catch (err) {
      log.error({ msg: `[absence-auto-decline] participation create filter: ${err.message}`, event: 'absence_auto_decline_part_create', stack: err.stack })
      return payload
    }
  })

  // ── Guest-level RSVP gate ───────────────────────────────────────────────
  // Trainings can configure `excluded_guest_levels` (jsonb array, e.g. [1,2,3])
  // to block guests at specific tiers from confirming/tentative. Games are a
  // hardcoded hard rule: guests of any level can't RSVP yes/maybe to a game.
  // Events stay open. Declined is always allowed (lets the user cleanly opt
  // out without an admin doing it for them).
  filter('participations.items.create', async (payload, _meta, { database: db }) => {
    try {
      if (!payload || !payload.activity_type || !payload.activity_id || !payload.member) return payload
      if (payload.status !== 'confirmed' && payload.status !== 'tentative') return payload

      let teamId = null
      let excluded = null  // null = "block any positive level" (games), array = explicit list
      if (payload.activity_type === 'training') {
        const row = await db('trainings').where('id', payload.activity_id).first('team', 'excluded_guest_levels')
        if (!row || !row.team) return payload
        teamId = row.team
        const raw = row.excluded_guest_levels
        const list = Array.isArray(raw) ? raw : (typeof raw === 'string' ? JSON.parse(raw) : [])
        if (!list.length) return payload
        excluded = list.map((v) => Number(v)).filter((n) => !Number.isNaN(n))
      } else if (payload.activity_type === 'game') {
        const row = await db('games').where('id', payload.activity_id).first('kscw_team')
        if (!row || !row.kscw_team) return payload
        teamId = row.kscw_team
        // null = block any positive guest_level
      } else {
        return payload
      }

      const mt = await db('member_teams')
        .where('member', payload.member)
        .andWhere('team', teamId)
        .first('guest_level')
      const level = Number(mt?.guest_level || 0)
      if (level === 0) return payload  // not a guest, always allowed

      const blocked = excluded === null ? level > 0 : excluded.includes(level)
      if (!blocked) return payload

      log.info(`[guest-rsvp-gate] block ${payload.activity_type}=${payload.activity_id} member=${payload.member} level=${level}`)
      throw kscwScopeError(
        payload.activity_type === 'game'
          ? 'Guests cannot participate in games'
          : 'Your guest level is excluded from this training',
        403,
        'GUEST_RSVP_BLOCKED',
      )
    } catch (err) {
      if (err?.extensions?.code === 'GUEST_RSVP_BLOCKED' || err?.status === 403) throw err
      log.error({ msg: `[guest-rsvp-gate] ${err.message}`, event: 'guest_rsvp_gate', stack: err.stack })
      return payload
    }
  })

  // ── Edit attribution (migration 047, replaces 046) ──────────────────────
  // Per-field trackers: `last_status_edited_*` and `last_note_edited_*`.
  // The roster modal renders "Edited to <status> by <name> on <date>" and
  // "Note edited by <name> on <date>" as INDEPENDENT lines, so a coach who
  // edits only the note doesn't reset the status attribution and vice
  // versa. Logic:
  //   • If `status` is in the payload → stamp last_status_edited_*
  //   • If `note`   is in the payload → stamp last_note_edited_*
  // System-context writes (null accountability — cron auto-decline,
  // hall-closure unwind) leave both pairs untouched so they remain
  // distinguishable from staff edits. Filters always overwrite the
  // client-supplied tracker fields so they can't be spoofed from the API.
  filter('participations.items.create', async (payload, _meta, { accountability }) => {
    if (!accountability?.user) return payload
    const now = new Date().toISOString()
    const out = { ...payload }
    if (Object.prototype.hasOwnProperty.call(payload, 'status')) {
      out.last_status_edited_by = accountability.user
      out.last_status_edited_at = now
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'note') && (payload.note ?? '') !== '') {
      out.last_note_edited_by = accountability.user
      out.last_note_edited_at = now
    }
    return out
  })
  filter('participations.items.update', async (payload, _meta, { accountability }) => {
    if (!accountability?.user) return payload
    const now = new Date().toISOString()
    const out = { ...payload }
    if (Object.prototype.hasOwnProperty.call(payload, 'status')) {
      out.last_status_edited_by = accountability.user
      out.last_status_edited_at = now
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'note')) {
      out.last_note_edited_by = accountability.user
      out.last_note_edited_at = now
    }
    return out
  })

  // ── Self-scoped CREATE ownership guard (security audit 2026-05-31) ────────
  // Directus enforces neither the `permissions` row-filter nor a relational
  // `validation` on CREATE (no existing row to match; a `member.user`
  // validation can't be resolved against the payload and rejects ALL creates),
  // so the self-scope filters in setup-permissions.mjs do NOT block a Member
  // from POSTing a participation/absence/vote/request/etc. with someone else's
  // owner id. Verified on dev: such a create returned 200. These filters enforce
  // ownership server-side. Pass-through: system writes (null accountability —
  // crons, auto-confirm/auto-decline, triggers) and admins. For participations/
  // absences a team coach/TR may also write for their own team members (roster
  // editing); the strictly-personal collections are self-only.
  async function assertCreateOwnership(accountability, db, affectedMemberId, { allowLeader }) {
    if (!accountability?.user) return          // system context
    if (accountability.admin) return           // admins bypass
    if (affectedMemberId == null) return        // owner omitted — NOT NULL / other filters handle it
    const editor = await db('members').where('user', accountability.user).select('id').first()
    if (editor && Number(editor.id) === Number(affectedMemberId)) return  // self
    if (allowLeader && editor) {
      const teamIds = (await db('member_teams').where('member', affectedMemberId).select('team'))
        .map((r) => r.team).filter(Boolean)
      if (teamIds.length) {
        const isCoach = await db('teams_coaches').whereIn('teams_id', teamIds).andWhere('members_id', editor.id).first()
        const isTR = isCoach || await db('teams_responsibles').whereIn('teams_id', teamIds).andWhere('members_id', editor.id).first()
        if (isCoach || isTR) return            // coach/TR of the member's team
      }
    }
    throw kscwScopeError('You can only create this for yourself', 403, 'NOT_OWNER')
  }

  // member-owned, coach/TR of the member's team may also create (roster editing)
  for (const coll of ['participations', 'absences']) {
    filter(`${coll}.items.create`, async (payload, _meta, { database: db, accountability }) => {
      await assertCreateOwnership(accountability, db, payload?.member, { allowLeader: true })
      return payload
    })
  }
  // strictly personal — self (or admin/system) only
  for (const [coll, field] of [
    ['poll_votes', 'member'], ['push_subscriptions', 'member'], ['team_requests', 'member'],
    ['scorer_delegations', 'from_member'], ['carpools', 'driver'], ['carpool_passengers', 'passenger'],
  ]) {
    filter(`${coll}.items.create`, async (payload, _meta, { database: db, accountability }) => {
      await assertCreateOwnership(accountability, db, payload?.[field], { allowLeader: false })
      return payload
    })
  }

  // member_teams delete scope — the policy grants the row-level delete filter,
  // but Directus delete filters key on the junction id, and a coach's delete
  // perm is NOT team-scoped here, so without this a coach could delete ANY
  // team's roster rows (cross-team roster tampering). A non-admin may delete a
  // member_teams row only when (a) it's their own membership, or (b) they
  // coach / are responsible for that row's team. System + admin pass.
  filter('member_teams.items.delete', async (keys, _meta, { database: db, accountability }) => {
    if (!accountability?.user) return keys   // system context (cron/hook/cascade)
    if (accountability.admin) return keys     // admins bypass
    const ids = Array.isArray(keys) ? keys : (keys != null ? [keys] : [])
    if (ids.length === 0) return keys
    const editor = await db('members').where('user', accountability.user).select('id').first()
    if (!editor) throw kscwScopeError('You cannot delete these team memberships', 403, 'NOT_OWNER')
    const rows = await db('member_teams').whereIn('id', ids).select('id', 'member', 'team')
    for (const row of rows) {
      if (Number(row.member) === Number(editor.id)) continue   // own membership
      if (row.team == null) {
        throw kscwScopeError('You cannot delete these team memberships', 403, 'NOT_OWNER')
      }
      const isCoach = await db('teams_coaches').where({ teams_id: row.team, members_id: editor.id }).first('id')
      const isTR = isCoach || await db('teams_responsibles').where({ teams_id: row.team, members_id: editor.id }).first('id')
      if (!isCoach && !isTR) {
        throw kscwScopeError('You can only remove members from teams you coach or are responsible for', 403, 'NOT_OWNER')
      }
    }
    return keys
  })

  // ── Hall-slot → trainings cascade ──────────────────────────────
  // Snapshot pre-state in a filter hook (Directus has already merged the
  // payload into `payload` here, but we need the BEFORE values to detect
  // what actually changed). The action then re-reads post-state and
  // applies the cascade. Map is keyed by slotId so concurrent updates
  // don't clobber each other's snapshots.
  const pendingSlotPreState = new Map()

  filter('hall_slots.items.update', async (payload, meta) => {
    try {
      const keys = Array.isArray(meta?.keys) ? meta.keys : (meta?.key != null ? [meta.key] : [])
      for (const k of keys) {
        if (!pendingSlotPreState.has(k)) {
          const pre = await snapshotSlot(database, k)
          if (pre) pendingSlotPreState.set(k, pre)
        }
      }
    } catch (err) {
      log.error({ msg: `[slot-cascade] snapshot failed: ${err.message}`, event: 'slot_cascade_snapshot_failed', stack: err.stack })
    }
    return payload
  })

  action('hall_slots.items.update', async ({ keys }) => {
    const ids = Array.isArray(keys) ? keys : (keys != null ? [keys] : [])
    for (const id of ids) {
      const pre = pendingSlotPreState.get(id)
      pendingSlotPreState.delete(id)
      try {
        const createdIds = await cascadeSlotUpdate(database, id, pre, log)
        for (const tid of createdIds || []) await applyTrainingAutoRSVP(tid)
      } catch (err) {
        log.error({ msg: `[slot-cascade] update cascade failed: ${err.message}`, event: 'slot_cascade_update_failed', slot: id, stack: err.stack })
      }
    }
  })

  action('hall_slots.items.create', async ({ key }) => {
    try {
      const createdIds = await generateInitialTrainings(database, key, log)
      for (const tid of createdIds || []) await applyTrainingAutoRSVP(tid)
    } catch (err) {
      log.error({ msg: `[slot-cascade] initial generation failed: ${err.message}`, event: 'slot_cascade_create_failed', slot: key, stack: err.stack })
    }
  })

  // Slot deletion → wipe future trainings derived from it. Historic trainings
  // (date < today) stay so attendance records aren't lost; future ones are
  // generator output and would otherwise dangle with a now-invalid hall_slot
  // FK. Participations are deleted in the same txn (no FK cascade — activity_id
  // is a polymorphic int, not a real FK).
  filter('hall_slots.items.delete', async (keys) => {
    const ids = Array.isArray(keys) ? keys : (keys != null ? [keys] : [])
    if (!ids.length) return keys
    try {
      const futureIds = await database('trainings')
        .whereIn('hall_slot', ids)
        .andWhere('date', '>=', database.raw("(now() AT TIME ZONE 'Europe/Zurich')::date"))
        .pluck('id')
      if (futureIds.length) {
        await database('participations')
          .where('activity_type', 'training')
          .whereIn(database.raw('activity_id::int'), futureIds)
          .delete()
        const deleted = await database('trainings').whereIn('id', futureIds).delete()
        log.info({ msg: `[slot-cascade] deleted ${deleted} future trainings for slot(s) ${ids.join(',')}`, event: 'slot_cascade_delete', slots: ids, count: deleted })
      }
    } catch (err) {
      log.error({ msg: `[slot-cascade] delete cascade failed: ${err.message}`, event: 'slot_cascade_delete_failed', slots: ids, stack: err.stack })
    }
    return keys
  })

  // Nightly rolling top-up for indefinite training slots — keeps ~12 weeks
  // of trainings always populated. `indefinite=true` slots have no upper
  // bound (the cascade never trims their tail), so we need a daily push to
  // keep the horizon advancing. Runs at 02:00 UTC (04:00 Zurich, after most
  // sync crons) to give a fresh batch each morning. logCronRun gives the
  // /status dashboard a heartbeat to confirm the cron is alive.
  schedule('0 2 * * *', async () => {
    const startedAt = Date.now()
    try {
      const created = await topUpIndefiniteSlots(database, log, async (ids) => {
        for (const tid of ids) await applyTrainingAutoRSVP(tid)
      })
      log.info({ msg: `[slot-cascade] nightly top-up: ${created} trainings created`, event: 'slot_topup_cron_done', count: created, duration_ms: Date.now() - startedAt })
    } catch (err) {
      log.error({ msg: `[slot-cascade] nightly top-up failed: ${err.message}`, event: 'slot_topup_cron_failed', stack: err.stack })
    }
  })

  // ── Fines (migration 069) — escalation engine + notifications ──
  //
  // filter('fines.items.create'):
  //   If the leader leaves `amount` null, compute it via the SQL helper
  //   kscw_compute_fine_amount(member,team,category) and snapshot
  //   tier_offense + reset_window_at_issue onto the row. If amount is
  //   non-null (leader override), still snapshot the tier metadata for
  //   audit but DON'T overwrite their amount. Auto-fill `issued_by` from
  //   accountability.user → members.id and force `auto_issued = false`
  //   (no silent server-issued path exists yet — defense-in-depth).
  //
  // filter('fines.items.update'):
  //   Block edits to amount / category / reason / member / team to enforce
  //   the "waive + reissue" audit model. Status flips + payment fields +
  //   waive metadata remain editable. Admins (accountability.admin) bypass.
  //
  // action('fines.items.create'):
  //   Push + email the member: "{team} • CHF X: {reason}".
  // action('fines.items.update'):
  //   Push the member on status → paid or waived.
  //
  // cron 'fines_reminder' (daily 09:00 UTC):
  //   For each member with ≥1 'open' fine, send a single rolled-up push
  //   ("You have N open fines — total CHF X"). Throttled by `notes`
  //   marker on the fine to avoid repeat-spam.
  const FINE_BLOCKED_UPDATE_FIELDS = ['amount', 'category', 'reason', 'member', 'team', 'tier_offense', 'reset_window_at_issue', 'auto_issued']

  function formatChf(amount, currency = 'CHF') {
    const n = Number(amount)
    if (!Number.isFinite(n)) return `${currency} ?`
    return `${currency} ${n.toFixed(2)}`
  }

  // Team-scope guard for fine writes — Directus enforces the team-scoped
  // update/delete filters but NOT create (no existing row to filter), so a
  // coach could otherwise POST a fine for ANY team. Passes for system context
  // + admins; a normal caller must coach / be responsible for `team`. Mirrors
  // scheduling_blocks.items.create. Throws the project scope-error on failure.
  async function assertFineTeamScope(accountability, db, teamId) {
    if (!accountability?.user) return   // system context (cron/hook)
    if (accountability.admin) return    // admins bypass
    if (teamId == null) {
      throw kscwScopeError('Fine requires a team', 400, 'INVALID_PAYLOAD')
    }
    const member = await db('members').where('user', accountability.user).first('id')
    if (!member) return // not a member — let Directus deny via its own policy
    const isCoach = await db('teams_coaches').where({ teams_id: teamId, members_id: member.id }).first('id')
    const isTR = isCoach || await db('teams_responsibles').where({ teams_id: teamId, members_id: member.id }).first('id')
    if (!isCoach && !isTR) {
      throw kscwScopeError('You can only manage fines for teams you coach or are responsible for', 403, 'FORBIDDEN')
    }
  }

  filter('fines.items.create', async (payload, _meta, { accountability, database: db }) => {
    try {
      if (!payload) return payload
      if (!payload.member || !payload.team || !payload.category) {
        throw kscwScopeError('fines.create requires member, team, category', 400, 'INVALID_PAYLOAD')
      }

      // 0. Team-scope gate — caller must coach / be TR of payload.team.
      await assertFineTeamScope(accountability, db, payload.team)

      // 1. Resolve leader's member id from accountability (skip for system/admin).
      let issuerId = payload.issued_by ?? null
      if (!issuerId && accountability?.user) {
        const issuer = await db('members').where('user', accountability.user).first('id')
        if (issuer?.id) issuerId = issuer.id
      }

      // 2. Engine snapshot — runs whether or not amount was provided. Caller's
      //    amount wins (leader override), but tier_offense + reset_window_at_issue
      //    always reflect the engine's view for audit.
      let computed = null
      try {
        const res = await db.raw(
          'SELECT amount, tier_offense, reset_window_at_issue FROM kscw_compute_fine_amount(?::int, ?::int, ?::text)',
          [Number(payload.member), Number(payload.team), String(payload.category)],
        )
        computed = res?.rows?.[0] || null
      } catch (err) {
        // Engine errors shouldn't block the insert — leaders can still issue
        // ad-hoc fines without a rule. Just log + skip snapshot.
        log.warn({ msg: `[fines] engine query failed: ${err.message}`, event: 'fines_engine_query_failed', payload: { member: payload.member, team: payload.team, category: payload.category } })
      }

      const filled = { ...payload }
      if (filled.amount == null) {
        if (!computed) {
          throw kscwScopeError(
            'No fine_rule for this team/category and no amount supplied — set an explicit amount or configure a rule first.',
            400, 'FINE_NO_RULE',
          )
        }
        filled.amount = computed.amount
      }
      if (computed) {
        filled.tier_offense = filled.tier_offense ?? computed.tier_offense
        filled.reset_window_at_issue = filled.reset_window_at_issue ?? computed.reset_window_at_issue
      }
      if (issuerId) filled.issued_by = issuerId
      filled.auto_issued = false // hard rule: no silent server-issued path exists yet
      return filled
    } catch (err) {
      // Security gates (scope + payload validation) must fail closed — never
      // swallow them and create the fine anyway.
      if (err?.code === 'INVALID_PAYLOAD' || err?.code === 'FINE_NO_RULE' || err?.code === 'FORBIDDEN') throw err
      log.error({ msg: `[fines] create filter: ${err.message}`, event: 'fines_create_filter_failed', stack: err.stack })
      return payload
    }
  })

  // Fine-rule creation is team-scoped the same way: a coach/TR may only
  // configure a fine_rule for a team they lead. The fine_rules update/delete
  // policy filters are team-scoped, but create isn't enforced by Directus —
  // this is the real gate.
  filter('fine_rules.items.create', async (payload, _meta, { accountability, database: db }) => {
    if (!payload) return payload
    await assertFineTeamScope(accountability, db, payload.team)
    return payload
  })

  filter('fines.items.update', async (payload, _meta, { accountability }) => {
    if (!payload) return payload
    if (accountability?.admin) return payload // admin bypass — manual fixups
    for (const f of FINE_BLOCKED_UPDATE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(payload, f)) {
        throw kscwScopeError(
          `Cannot edit ${f} on a fine — waive and reissue instead.`,
          403, 'FINE_IMMUTABLE_FIELD',
        )
      }
    }
    return payload
  })

  action('fines.items.create', async ({ key }) => {
    try {
      if (!key) return
      const fine = await database('fines').where('id', key).first(
        'id', 'member', 'team', 'category', 'amount', 'currency', 'reason',
      )
      if (!fine?.member) return
      const team = await database('teams').where('id', fine.team).first('name')
      const teamName = team?.name || `Team ${fine.team}`
      const amountStr = formatChf(fine.amount, fine.currency)
      const reasonStr = (fine.reason || '').trim().slice(0, 80) || ''

      // In-app notification (always)
      await database('notifications').insert({
        member: fine.member,
        type: 'fine_issued',
        title: 'fine_issued',
        body: JSON.stringify({ team: teamName, amount: amountStr, reason: reasonStr, fineId: fine.id, category: fine.category }),
        activity_type: 'fine',
        activity_id: String(fine.id),
        team: fine.team,
        read: false,
      })

      // Push to the recipient
      await sendLocalizedPush(
        database, [fine.member],
        (ids, title, body) => sendPushToMembers(database, ids, title, body, `${FRONTEND_URL}/fines`, `fine-${fine.id}`, log),
        'fineIssued.title', 'fineIssued.body',
        { team: teamName, amount: amountStr, reason: reasonStr },
      )
    } catch (err) {
      log.error({ msg: `[fines] create action: ${err.message}`, event: 'fines_create_action_failed', stack: err.stack })
    }
  })

  action('fines.items.update', async ({ keys, payload }) => {
    try {
      if (!Array.isArray(keys) || keys.length === 0) return
      const statusChanged = payload && Object.prototype.hasOwnProperty.call(payload, 'status')
      if (!statusChanged) return
      const newStatus = payload.status
      if (newStatus !== 'paid' && newStatus !== 'waived') return

      const rows = await database('fines').whereIn('id', keys).select(
        'id', 'member', 'team', 'amount', 'currency',
      )
      for (const fine of rows) {
        if (!fine?.member) continue
        const team = await database('teams').where('id', fine.team).first('name')
        const teamName = team?.name || `Team ${fine.team}`
        const amountStr = formatChf(fine.amount, fine.currency)
        const titleKey = newStatus === 'paid' ? 'finePaid.title' : 'fineWaived.title'
        const bodyKey  = newStatus === 'paid' ? 'finePaid.body'  : 'fineWaived.body'

        await database('notifications').insert({
          member: fine.member,
          type: newStatus === 'paid' ? 'fine_paid' : 'fine_waived',
          title: newStatus === 'paid' ? 'fine_paid' : 'fine_waived',
          body: JSON.stringify({ team: teamName, amount: amountStr, fineId: fine.id }),
          activity_type: 'fine',
          activity_id: String(fine.id),
          team: fine.team,
          read: false,
        })
        await sendLocalizedPush(
          database, [fine.member],
          (ids, title, body) => sendPushToMembers(database, ids, title, body, `${FRONTEND_URL}/fines`, `fine-${fine.id}-${newStatus}`, log),
          titleKey, bodyKey,
          { team: teamName, amount: amountStr },
        )
      }
    } catch (err) {
      log.error({ msg: `[fines] update action: ${err.message}`, event: 'fines_update_action_failed', stack: err.stack })
    }
  })

  // Daily reminder for open fines older than 14 days. Single rolled-up push
  // per member per day (kscw_fines_reminder_sent_at column is too heavy — use
  // notification dedupe via tag `fines-reminder-YYYY-MM-DD`).
  schedule('0 9 * * *', async () => {
    const startedAt = Date.now()
    let sent = 0
    try {
      const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
      const rows = await database('fines')
        .where('status', 'open')
        .where('issued_at', '<=', cutoff)
        .select('member', 'amount', 'currency')
      if (rows.length === 0) {
        log.info({ msg: '[fines] reminder cron: no overdue fines', event: 'fines_reminder_cron_noop', duration_ms: Date.now() - startedAt })
        await logCronRun(database, 'fines_reminder', { status: 'ok', durationMs: Date.now() - startedAt })
        return
      }
      // Aggregate per member: count + total amount (assume CHF — multi-currency
      // out of scope for v1).
      const agg = new Map()
      for (const r of rows) {
        const m = agg.get(r.member) || { count: 0, total: 0 }
        m.count += 1
        m.total += Number(r.amount) || 0
        agg.set(r.member, m)
      }
      const today = new Date().toISOString().slice(0, 10)
      for (const [memberId, info] of agg) {
        const amountStr = formatChf(info.total)
        await sendLocalizedPush(
          database, [memberId],
          (ids, title, body) => sendPushToMembers(database, ids, title, body, `${FRONTEND_URL}/fines`, `fines-reminder-${today}`, log),
          'fineReminder.title', 'fineReminder.body',
          { count: info.count, amount: amountStr },
        )
        sent += 1
      }
      log.info({ msg: `[fines] reminder cron: ${sent} member(s) reminded`, event: 'fines_reminder_cron_done', sent, duration_ms: Date.now() - startedAt })
      await logCronRun(database, 'fines_reminder', { status: 'ok', durationMs: Date.now() - startedAt })
    } catch (err) {
      log.error({ msg: `[fines] reminder cron failed: ${err.message}`, event: 'fines_reminder_cron_failed', stack: err.stack })
      logCronError('fines_reminder', err)
      await logCronRun(database, 'fines_reminder', { status: 'error', durationMs: Date.now() - startedAt, errorMessage: err.message })
    }
  })

  // ── Audit hook — server-authoritative user_logs writes ─────────
  registerAuditHook({ action, schedule }, { database, logger })

  log.info('KSCW hooks loaded: role-sync (5 actions, 2 filters), Turnstile, member privacy, registration approval, Spielplaner scope guard, participation absence-aware decline, guest-level RSVP gate, edit-attribution (migration 046), audit log, fines engine (migration 069), 12 crons (validations+notifications in Postgres)')
}
