/**
 * Acting-member swap — one login administering several members.
 *
 * A guardian (Nina) sends `X-KSCW-Acting-Member: 564` on a request that is
 * ALREADY authenticated as herself. If migration 348 records a live grant, this
 * middleware replaces `req.accountability` with the target member's identity for
 * the lifetime of that one request. Nothing else changes: the session cookie is
 * never touched, no token is minted, no directus_sessions row is created.
 *
 * WHY THIS SHAPE
 * --------------
 * Because the server genuinely resolves the caller as the child, every existing
 * `$CURRENT_USER` policy filter and every server-side `where('user', …)` lookup
 * keeps working verbatim — zero new permission rules. That matters more than it
 * sounds: dev has been keyless since 2026-07-15, so filtered permissions are
 * neither writable nor evaluated there. A design whose safety rested on two
 * dozen NEW filters could not be tested before it reached production.
 *
 * It also fails safe. If the app believes it is Mila but the server resolved
 * Elin, the write is REFUSED (assertCreateOwnership and the OWN_MEMBER filter
 * both compare the target against the server-resolved identity) rather than
 * silently landing on the wrong child.
 *
 * ⚠⚠ THIS IS AUTHORIZATION CODE ON EVERY REQUEST IN THE SYSTEM. Three structural
 * rules keep that safe, and none may be relaxed:
 *   1. It only ever NARROWS an identity that Directus has already authenticated.
 *      It never bypasses `authenticate`, never reads a credential, never
 *      elevates. A caller who is nobody stays nobody.
 *   2. It cross-checks the identity it built with Directus's OWN resolver and
 *      refuses unless the result is exactly { admin: false, app: true }.
 *   3. ⚠ ANY throw returns 503 and NEVER calls next(). Falling through would run
 *      the request as the GUARDIAN while the UI believes it is the child — a
 *      mis-attributed write, the one genuinely dangerous outcome here.
 *
 * ⚠ MOUNT POINT IS LOAD-BEARING. Verified in the running directus:12.x image
 * (@directus/api/dist/app.js): authenticate at :220, cache at :226,
 * emitInit('middlewares.after') at :227, endpoint router at :273. So we run
 * after authentication and before every route — and Directus's response cache
 * runs BEFORE us and keys on the PRE-swap user, which is why CACHE_ENABLED must
 * stay false. Re-verify both on any Directus upgrade.
 *
 * ⚠ THE IMPORTS BELOW ARE INTERNAL PATHS, NOT A PUBLIC API. `@directus/utils/node`
 * does NOT exist in the container (`@directus/` holds only `api` and
 * `update-check`); these three specifiers were verified importable by running
 * them inside directus-kscw. They resolve through the package's `./*` exports
 * map. If an upgrade moves them the import throws — which refuses every acting
 * request rather than over-granting. Failure direction is the safe one, but it
 * belongs on the upgrade checklist in SECURITY.md.
 */

import { fetchRolesTree } from '@directus/api/permissions/lib/fetch-roles-tree'
import { fetchGlobalAccess } from '@directus/api/permissions/modules/fetch-global-access/fetch-global-access'
import { createDefaultAccountability } from '@directus/api/permissions/utils/create-default-accountability'

export const ACTING_HEADER = 'x-kscw-acting-member'
const MANAGED_EMAIL_DOMAIN = 'managed.wiedisync.kscw.ch'

// Never swap on these — auth (login/refresh/logout must always be the real
// session owner), the admin app, static assets, and server health.
const SKIP_PREFIXES = ['/auth', '/admin', '/assets', '/server', '/graphql']

// ⚠ Messaging is blocked while acting — a club decision, 01.09.2026: a parent
// administering a 12-year-old's RSVPs must not thereby read that child's private
// conversations with teammates and coaches.
// This prefix list is a coarse net and is only RELIABLE for /items/*, where
// Directus matches collection names exactly. Express routes `/kscw/*`
// case-insensitively, so `/kscw/Messaging/...` would slip past a naive match —
// hence lowercasing here AND an authoritative guard inside messaging.js.
const DENY_PREFIXES = [
  '/items/messages',
  '/items/message_reactions',
  '/items/message_requests',
  '/items/conversations',
  '/items/conversation_members',
  '/items/directus_users',
  '/kscw/messaging',
]

const GRANT_TTL_MS = 30_000
const AUDIT_TTL_MS = 60 * 60 * 1000

export function createActingMemberMiddleware(database, logger) {
  const log = logger.child({ middleware: 'acting-member' })

  /** guardianUser:targetId → { bundle, expires } | { denied: true, expires } */
  const grantCache = new Map()
  /** guardianMemberId:targetId → expires — throttles the read audit. */
  const auditSeen = new Map()

  function sweep(map) {
    if (map.size < 500) return
    const now = Date.now()
    for (const [k, v] of map) if ((v?.expires ?? v) <= now) map.delete(k)
  }

  /** Bust every cached decision for one guardian — called after a revoke. */
  function invalidateGuardian(guardianUser) {
    for (const k of grantCache.keys()) {
      if (k.startsWith(`${guardianUser}:`)) grantCache.delete(k)
    }
  }

  async function resolveGrant(guardianUser, targetId) {
    const key = `${guardianUser}:${targetId}`
    const hit = grantCache.get(key)
    if (hit && hit.expires > Date.now()) return hit.denied ? null : hit.bundle

    const deny = () => {
      grantCache.set(key, { denied: true, expires: Date.now() + GRANT_TTL_MS })
      return null
    }

    const row = await database('member_guardians as mg')
      .where({ 'mg.guardian_user': guardianUser, 'mg.member': targetId })
      .join('members as tm', 'tm.id', 'mg.member')
      .join('directus_users as tu', 'tu.id', 'tm.user')
      .leftJoin('members as gm', 'gm.user', 'mg.guardian_user')
      .first(
        'tm.id as target_member', 'tm.user as target_user',
        'tu.role as target_role', 'tu.status as target_status', 'tu.email as target_email',
        'gm.id as guardian_member',
      )

    // No grant, or the target has no login row to resolve as.
    if (!row || !row.target_user || !row.target_role) return deny()

    // Status: 'active' normally; 'draft' ONLY for a managed shadow user, which
    // is the entire point of the feature — that account is deliberately
    // un-loginnable and would otherwise be un-actable too.
    const isManagedShadow = String(row.target_email || '').toLowerCase()
      .endsWith('@' + MANAGED_EMAIL_DOMAIN)
    const statusOk = row.target_status === 'active'
      || (row.target_status === 'draft' && isManagedShadow)
    if (!statusOk) return deny()

    // The target must hold exactly the plain Member role. Acting resolves the
    // caller AS the target, so a target holding coach/TR/planner powers would
    // hand the guardian those powers over other people's children.
    const memberRole = await database('directus_roles').where('name', 'Member').first('id')
    if (!memberRole || row.target_role !== memberRole.id) return deny()

    const roles = await fetchRolesTree(row.target_role, { knex: database })
    const bundle = {
      user: row.target_user,
      role: row.target_role,
      roles,
      targetMember: row.target_member,
      guardianMember: row.guardian_member ?? null,
    }
    grantCache.set(key, { bundle, expires: Date.now() + GRANT_TTL_MS })
    return bundle
  }

  /** One audit row per (guardian, target) per hour, regardless of method. */
  async function auditActingSession(guardianMember, targetId) {
    const key = `${guardianMember}:${targetId}`
    const seen = auditSeen.get(key)
    if (seen && seen > Date.now()) return
    auditSeen.set(key, Date.now() + AUDIT_TTL_MS)
    sweep(auditSeen)
    try {
      await database('user_logs').insert({
        action: 'acting_session',
        collection_name: 'members',
        record_id: String(targetId),
        data: JSON.stringify({ mode: 'guardian_acting' }),
        user: targetId,
        acting_guardian: guardianMember,
        date_created: new Date(),
      })
    } catch (err) {
      // Best-effort by design: this row records a READ session, and failing the
      // whole request because an audit insert hiccuped would be worse than the
      // gap. Mutations are audited separately and strictly.
      log.warn({ msg: `acting_session audit failed: ${err.message}`, targetId })
    }
  }

  const middleware = async function actingMemberMiddleware(req, res, next) {
    // ── Fast skip: the overwhelming majority of requests ──
    const raw = req.headers[ACTING_HEADER]
    if (!raw) return next()

    try {
      const acc = req.accountability
      if (!acc?.user) return next()          // unauthenticated — nothing to narrow
      if (acc.share) return next()           // share links are their own identity
      // ⚠ Admins are NOT refused, and that is deliberate. The swap REPLACES the
      // accountability wholesale, so an admin acting for a child genuinely
      // becomes that child for the request — admin:false, the child's policies,
      // the child's row filters. It narrows, exactly like it does for anyone
      // else, and the {admin:false, app:true} assertion below still has to pass.
      // Refusing them bought no safety (a stolen admin session can already do
      // anything, including changing passwords) while blocking the club's own
      // admins who are also parents, and making the feature untestable by the
      // people most likely to test it. A grant row is still required.

      const path = String(req.path || req.url || '').toLowerCase()
      if (SKIP_PREFIXES.some((p) => path.startsWith(p))) return next()
      if (DENY_PREFIXES.some((p) => path.startsWith(p))) {
        return res.status(403).json({ error: 'Not available while using another account', code: 'KSCW_ACTING_DENIED' })
      }

      const targetId = Number(Array.isArray(raw) ? raw[0] : raw)
      if (!Number.isInteger(targetId) || targetId <= 0) {
        return res.status(400).json({ error: 'Invalid acting member', code: 'KSCW_ACTING_DENIED' })
      }

      const bundle = await resolveGrant(acc.user, targetId)
      // ⚠ ONE opaque code for every refusal. Distinct codes ("not linked" vs
      // "target is staff") would be an enumeration oracle letting any member map
      // who in the club holds an elevated role.
      if (!bundle) {
        return res.status(403).json({ error: 'Not permitted', code: 'KSCW_ACTING_DENIED' })
      }

      const next_ = createDefaultAccountability({
        ...acc,
        user: bundle.user,
        role: bundle.role,
        roles: bundle.roles,
        ip: acc.ip ?? null,
      })
      // Preserve the real session — the cookie still belongs to the guardian and
      // nothing about her session changes.
      next_.session = acc.session
      next_.kscwGuardian = { user: acc.user, memberId: bundle.guardianMember }
      next_.kscwActingMember = bundle.targetMember

      // ⚠ Fail-closed cross-check with Directus's own resolver. If this identity
      // resolves to anything other than a plain app user, refuse — never accept
      // an accountability we assembled without Directus agreeing on what it means.
      const { admin, app } = await fetchGlobalAccess(
        { user: next_.user, roles: next_.roles, ip: next_.ip },
        { knex: database },
      )
      if (admin !== false || app !== true) {
        log.warn({ msg: 'acting refused: unexpected global access', targetId, admin, app })
        return res.status(403).json({ error: 'Not permitted', code: 'KSCW_ACTING_DENIED' })
      }
      next_.admin = admin
      next_.app = app

      req.accountability = next_
      res.setHeader('X-KSCW-Acting-Member', String(bundle.targetMember))

      // Fire-and-forget: never make a read wait on an audit insert.
      if (bundle.guardianMember) {
        auditActingSession(bundle.guardianMember, targetId).catch(() => {})
      }
      sweep(grantCache)
      return next()
    } catch (err) {
      // ⚠⚠ NEVER next() HERE. See rule 3 in the header: falling through runs the
      // request as the guardian while the client believes it is the child.
      log.error({ msg: `acting-member middleware: ${err.message}`, stack: err.stack })
      return res.status(503).json({ error: 'Account switching temporarily unavailable', code: 'KSCW_ACTING_UNAVAILABLE' })
    }
  }

  middleware.invalidateGuardian = invalidateGuardian
  return middleware
}
