/**
 * Households — one adult login administering several members.
 *
 * Migration 348 owns the schema; this file owns every way it changes. See that
 * migration's header for the why (16 shared-email families, 20 members with no
 * reachable account).
 *
 * ROUTES
 *   GET    /kscw/household/me                            any session
 *   GET    /kscw/household                               admin | superuser | sport admin | vorstand
 *   GET    /kscw/household/candidates?role=&household=   admin | superuser
 *   POST   /kscw/household                               admin | superuser
 *   PATCH  /kscw/household/:id                           admin | superuser  (name + notes only)
 *   DELETE /kscw/household/:id                           admin | superuser  (ONLY if it never had a member)
 *   POST   /kscw/household/:id/members                   admin | superuser  (managed ⇒ provisions the shadow login in the same transaction)
 *   POST   /kscw/household/:id/members/:memberId/provision   admin | superuser  (repair path for older links)
 *   DELETE /kscw/household/:id/members/:hmId             admin | superuser, OR the linked member herself
 *
 * ⚠⚠ CONSENT IS STRUCTURAL, NOT PROCEDURAL. A grant may only ever target a
 * MANAGED member — one whose members."user" is NULL, or points at a shadow user
 * in MANAGED_EMAIL_DOMAIN with status='draft' and password IS NULL. A member
 * with her own real login can NEVER be the target of a grant. That is the whole
 * consent story and it needs no process discipline to hold: a parent cannot
 * claim a stranger's child, because doing so would first require an admin to
 * convert that child's real account into a shadow account — a destructive,
 * visible, audited act that no endpoint here offers.
 *
 * ⚠ Creation is admin/superuser ONLY. Not Sport Admin (who can already edit
 * members), not Vorstand, not self-service. A household link is privilege-
 * bearing: it hands one login write access to another member's record. The
 * as-designed version let any Sport Admin put herself in a household with any
 * member and become them — a larger privilege than the admin_access incident
 * already recorded in SECURITY.md.
 *
 * ⚠ Every mutation here REFUSES while acting for someone else
 * (accountability.kscwGuardian). This is what closes the co-guardian abuse
 * case: in a custody dispute, one guardian must not be able to slip into a
 * child's session and revoke the other guardian from inside it.
 *
 * ⚠ Audit writes here are STRICT, unlike writeUserLog's best-effort default.
 * A household link whose audit row silently failed is an unattributed
 * privilege grant, so the operation is refused instead. Every mutation runs in
 * ONE transaction with its audit row(s): both land, or neither does.
 *
 * ⚠ The "main account" (role 'guardian' in code, "Main account" in the UI) has
 * NO age rule, deliberately: the club wants a child's own login (e.g. an older
 * sibling) to be able to manage a sibling with no adult account in between.
 * Do not add one.
 *
 * ⚠ After every change that can grant or remove acting rights this file calls
 * globalThis.__kscwActingGrantBust (set by kscw-hooks/src/acting-member.js —
 * the two extensions are separate bundles, so a global is the only shared
 * handle). Without it a revoked guardian keeps acting until the grant cache
 * expires, and a freshly provisioned child stays refused for the same window.
 */
import { withActorStamp } from './activity-log.js'

// Shadow users live on a domain that resolves to nothing and accepts no mail.
// It is also the marker the acting middleware uses to tell "managed member"
// from "real account that happens to be inactive" — so it must never be a real
// deliverable domain. Mirrored in kscw-hooks/src/acting-member.js and in
// migration 377's is_managed_shadow(); change all three together.
export const MANAGED_EMAIL_DOMAIN = 'managed.wiedisync.kscw.ch'

/** The one shadow address a managed member can ever have. */
export function managedEmailFor(memberId) {
  return `m${memberId}@${MANAGED_EMAIL_DOMAIN}`
}

// Stable switcher colours, assigned round-robin in link order. Stored on the
// row rather than hashed from the member id so adding a fourth child never
// re-shuffles the three the parent has already learned.
const ACCENTS = ['sky', 'ochre', 'plum', 'teal', 'rose']

const NAME_MAX = 120
const NOTES_MAX = 2000

/** A refusal with an HTTP status and a stable machine code. */
export class HouseholdError extends Error {
  constructor(status, code, message) {
    super(message || code)
    this.status = status
    this.code = code
  }
}

const REFUSAL_MESSAGES = {
  member_has_own_login: 'This member has their own login. Only members without an account can be managed.',
  member_is_staff: 'This member holds a coach, team responsible or planner role and cannot be managed.',
  member_not_found: 'Member not found',
  guardian_needs_login: 'The main account needs its own login first',
  guardian_is_managed: 'A linked member cannot be the main account',
  already_linked: 'Already linked',
}

function callerRoles(row) {
  if (!row) return []
  if (Array.isArray(row.role)) return row.role
  try { return JSON.parse(row.role || '[]') } catch { return [] }
}

/** 'guardian' | 'managed' | null. Anything else is a typo, never a default. */
export function parseRole(raw) {
  return raw === 'guardian' || raw === 'managed' ? raw : null
}

/**
 * Is this directus_users row a managed shadow — unloginnable by construction?
 * Accepts either the raw `password` column or a `has_password` boolean, so the
 * batch loaders never have to select the hash itself.
 */
export function isShadowUser(u) {
  if (!u) return false
  const hasPassword = u.has_password === true || (u.password != null && u.password !== '')
  return String(u.email || '').toLowerCase().endsWith('@' + MANAGED_EMAIL_DOMAIN)
    && u.status === 'draft'
    && !hasPassword
}

/**
 * Why this member cannot be a MANAGED target, or null when she can.
 *
 * ⚠ The role/staff checks are not paranoia. Acting resolves the caller as the
 * target, so granting over a member who holds coach, Team Responsible or
 * Spielplaner powers would hand the guardian those powers over other people's
 * children. Anything beyond a plain member is refused rather than narrowed.
 */
export function manageableReason({ member, user, isStaffLinked }) {
  if (!member) return 'member_not_found'
  // is_spielplaner is club-wide by design, not per-team — acting as a member who
  // holds it would hand the guardian scheduling powers over the whole club.
  if (member.is_spielplaner) return 'member_is_staff'
  // A real, usable login. Never claimable — this is the consent guarantee.
  if (member.user && !isShadowUser(user)) return 'member_has_own_login'
  // ⚠ The baseline role in members.role is 'user', NOT 'member'. Anything
  // beyond it (admin, vb_admin, bb_admin, vorstand, finance, superuser,
  // website_admin) is elevated and refused.
  const elevated = callerRoles(member).filter((r) => r && r !== 'user')
  if (elevated.length) return 'member_is_staff'
  if (isStaffLinked) return 'member_is_staff'
  return null
}

/**
 * Why the middleware would refuse to act as this LINKED member, or null when it
 * would accept her. The one predicate behind the switcher (GET /household/me)
 * and the admin list's `actable` flag, so neither ever offers a switch the
 * request path then refuses. Mirrored in kscw-hooks/src/acting-member.js
 * (resolveGrant + targetIsStaff) — change both together.
 *
 *   'not_provisioned' — no draft, password-less shadow login ("Set up" / broken)
 *   'member_is_staff' — any staff marker: a Directus role other than Member, a
 *                       user-level directus_access row (Finance, Terminplanung…),
 *                       or anything manageableReason() refuses
 */
export function actableReason({ member, user, roleName, isStaffLinked, hasUserAccess }) {
  if (!member) return 'member_not_found'
  if (!isShadowUser(user)) return 'not_provisioned'
  if (roleName !== 'Member' || hasUserAccess) return 'member_is_staff'
  return manageableReason({ member, user, isStaffLinked })
}

/**
 * Why this member cannot be a household's MAIN account, or null when she can.
 * ⚠ No age rule — see the header. A sibling's own login may be the main account.
 */
export function guardianReason({ member, user }) {
  if (!member) return 'member_not_found'
  // A main account without a login confers nothing — the rebuild would drop
  // her silently, which reads to an admin as "the link didn't save".
  if (!member.user || !user) return 'guardian_needs_login'
  if (String(user.email || '').toLowerCase().endsWith('@' + MANAGED_EMAIL_DOMAIN)) return 'guardian_is_managed'
  return null
}

/**
 * One switcher row per member. A member linked in two households (two homes)
 * comes back twice from the join; keep the row that carries an accent.
 */
export function dedupeManaged(rows) {
  const byId = new Map()
  for (const r of rows) {
    const prev = byId.get(r.id)
    if (!prev || (!prev.accent && r.accent)) byId.set(r.id, r)
  }
  return [...byId.values()]
}

/** Admin (Directus) or a member holding the 'superuser' role. */
async function isSuperadmin(database, accountability) {
  if (accountability?.admin === true) return true
  const userId = accountability?.user
  if (!userId) return false
  const caller = await database('members').where('user', userId).first('role')
  return callerRoles(caller).includes('superuser')
}

/** Sport Admin / Vorstand may READ households; they may not create links. */
async function mayReadHouseholds(database, accountability) {
  if (await isSuperadmin(database, accountability)) return true
  const userId = accountability?.user
  if (!userId) return false
  const caller = await database('members').where('user', userId).first('role')
  const roles = callerRoles(caller)
  return roles.includes('vorstand') || roles.includes('vb_admin') || roles.includes('bb_admin')
}

/**
 * Strict audit. Resolves the acting member itself so a failure is visible,
 * where writeUserLog swallows everything by design.
 * Throws — the caller must let that propagate (and roll back its transaction)
 * rather than proceed. An actor-less row is refused outright: the ten
 * unattributed prod rows of 18.09.2026 are what that looks like.
 */
async function auditStrict(database, { accountability, action, recordId, data, collection = 'household_members' }) {
  if (!accountability?.user) throw new Error(`auditStrict(${action}): no accountability.user`)
  const actor = await database('members').where({ user: accountability.user }).first('id')
  await database('user_logs').insert({
    action,
    collection_name: collection,
    record_id: recordId != null ? String(recordId) : null,
    data: JSON.stringify(withActorStamp(data, accountability)),
    user: actor?.id ?? null,
    acting_guardian: accountability?.kscwGuardian?.memberId ?? null,
    date_created: new Date(),
  })
}

/** Drop every cached acting decision (see header). Never throws. */
function bustGrantCache() {
  try { globalThis.__kscwActingGrantBust?.() } catch { /* the TTL backstop still applies */ }
}

/** Member ids that hold a coach / TR / planner seat. */
async function loadStaffSet(database, memberIds) {
  const ids = [...new Set(memberIds.map(Number).filter(Number.isInteger))]
  if (!ids.length) return new Set()
  const [coach, tr, planner] = await Promise.all([
    database('teams_coaches').whereIn('members_id', ids).pluck('members_id'),
    database('teams_responsibles').whereIn('members_id', ids).pluck('members_id'),
    // ⚠ No .catch() here: this also runs inside the link transaction, where a
    // swallowed Postgres error leaves the transaction aborted and the NEXT
    // statement fails with a misleading message.
    database('spielplaner_assignments').whereIn('member', ids).pluck('member'),
  ])
  return new Set([...coach, ...tr, ...planner].map(Number))
}

/** Login ids that hold ANY user-level directus_access row (see actableReason). */
async function loadUserAccessSet(database, userIds) {
  const ids = [...new Set(userIds.filter(Boolean))]
  if (!ids.length) return new Set()
  const rows = await database('directus_access').whereIn('user', ids).pluck('user')
  return new Set(rows)
}

/** Login rows by id, WITHOUT the password hash. */
async function loadUsers(database, userIds) {
  const ids = [...new Set(userIds.filter(Boolean))]
  if (!ids.length) return new Map()
  const rows = await database('directus_users').whereIn('id', ids)
    .select('id', 'email', 'status', 'role', database.raw('(password IS NOT NULL) AS has_password'))
  return new Map(rows.map((u) => [u.id, u]))
}

async function assertTargetIsManageable(database, memberId) {
  const member = await database('members').where('id', memberId)
    .first('id', 'user', 'role', 'is_spielplaner')
  if (!member) return { ok: false, code: 'member_not_found' }
  const users = await loadUsers(database, [member.user])
  const staff = await loadStaffSet(database, [memberId])
  const code = manageableReason({ member, user: users.get(member.user), isStaffLinked: staff.has(Number(memberId)) })
  return code ? { ok: false, code } : { ok: true }
}

async function assertCanBeGuardian(database, memberId) {
  const member = await database('members').where('id', memberId).first('id', 'user')
  const users = await loadUsers(database, [member?.user])
  const code = guardianReason({ member, user: member ? users.get(member.user) : null })
  return code ? { ok: false, code } : { ok: true }
}

/**
 * Give a managed member her shadow login, inside the caller's transaction.
 *
 * ⚠⚠ Two independent Directus gates make this account impossible to sign into,
 * both verified in the running 12.x image:
 *   services/authentication.js — refuses any user whose status !== 'active'
 *   auth/drivers/local.js      — throws InvalidCredentialsError when !password
 * And it costs no licence seat: the seat counter filters status='active'.
 *
 * Idempotent and self-healing:
 *   - member already on a shadow login        → 'existing', nothing created
 *   - m<id>@managed… exists but is unlinked   → 'relinked' (a half-failed older
 *                                               run created the user and died
 *                                               before members."user" was set)
 *   - otherwise                               → 'created'
 * A member holding a REAL login is refused (409) — never converted.
 */
export async function provisionManagedMember(trx, { memberId, schema, services }) {
  const member = await trx('members').where('id', memberId).forUpdate()
    .first('id', 'user', 'first_name', 'last_name', 'wiedisync_active')
  if (!member) throw new HouseholdError(404, 'member_not_found', 'Member not found')

  if (member.user) {
    const users = await loadUsers(trx, [member.user])
    const u = users.get(member.user)
    if (!isShadowUser(u)) throw new HouseholdError(409, 'already_has_login', 'This member already has a login')
    if (!member.wiedisync_active) {
      await trx('members').where('id', memberId).update({ wiedisync_active: true })
    }
    return { user: u.id, email: u.email, outcome: 'existing' }
  }

  const memberRole = await trx('directus_roles').where('name', 'Member').first('id')
  if (!memberRole) throw new Error('Member role not found in directus_roles')

  const email = managedEmailFor(memberId)
  const stale = await trx('directus_users').whereRaw('lower(email) = ?', [email])
    .first('id', 'email', 'status', 'role', trx.raw('(password IS NOT NULL) AS has_password'))

  let userId
  let outcome
  if (stale) {
    const holder = await trx('members').where('user', stale.id).whereNot('id', memberId).first('id')
    if (!isShadowUser(stale) || holder) {
      throw new HouseholdError(409, 'shadow_email_taken', 'The managed login address for this member is already in use')
    }
    if (stale.role !== memberRole.id) {
      await trx('directus_users').where('id', stale.id).update({ role: memberRole.id })
    }
    userId = stale.id
    outcome = 'relinked'
  } else {
    const { UsersService } = services
    const adminUsers = new UsersService({ schema, knex: trx, accountability: { admin: true } })
    userId = await adminUsers.createOne({
      email,
      first_name: member.first_name || '',
      last_name: member.last_name || '',
      role: memberRole.id,
      status: 'draft',
    })
    outcome = 'created'
  }

  // ⚠ wiedisync_active is LOAD-BEARING and easy to miss. Normally only the
  // auth.login action flips it, and a shadow user can never log in — while
  // wiedisync_active = false silently suppresses in-app notification
  // creation in eight places. Without this line a managed member receives
  // nothing, forever, with no error anywhere.
  await trx('members').where('id', memberId).update({ user: userId, wiedisync_active: true })
  return { user: userId, email, outcome }
}

function isPairConflict(err) {
  return err?.code === '23505'
    && (err.constraint === 'household_members_pair_uq' || String(err.message || '').includes('household_members_pair_uq'))
}

export function registerHousehold(router, { database, logger, services, getSchema }) {
  const log = logger.child({ endpoint: 'household' })

  /** Shared guard for every mutating route. */
  async function guardMutation(req, res) {
    if (req.accountability?.kscwGuardian) {
      res.status(403).json({ error: 'Not available while using another account', code: 'acting_forbidden' })
      return false
    }
    if (!req.accountability?.user) {
      res.status(401).json({ error: 'Authentication required', code: 'unauthenticated' })
      return false
    }
    if (!(await isSuperadmin(database, req.accountability))) {
      res.status(403).json({ error: 'Admin only', code: 'not_superadmin' })
      return false
    }
    return true
  }

  /** Shared error tail: typed refusals keep their status, the rest is a 500. */
  function fail(res, err, where) {
    if (err instanceof HouseholdError) {
      return res.status(err.status).json({ error: err.message, code: err.code })
    }
    if (isPairConflict(err)) {
      return res.status(409).json({ error: REFUSAL_MESSAGES.already_linked, code: 'already_linked' })
    }
    log.error({ msg: `${where}: ${err.message}`, endpoint: where, stack: err.stack })
    return res.status(500).json({ error: 'Internal error' })
  }

  // ── The switcher's only data source ───────────────────────────────
  // Deliberately an endpoint rather than an /items read: the Member policy then
  // needs ZERO new filtered permission rows. That matters because dev has been
  // keyless since 2026-07-15, so filtered permissions are neither writable nor
  // evaluated there — a design whose safety rests on new filters cannot be
  // tested before it reaches prod.
  router.get('/household/me', async (req, res) => {
    try {
      const userId = req.accountability?.user
      if (!userId) return res.status(401).json({ error: 'Authentication required' })

      // Always resolve from the REAL session owner, never the acted-as identity —
      // otherwise switching into a child would show that child her own siblings
      // as if she could act for them.
      const realUser = req.accountability?.kscwGuardian?.user || userId
      const self = await database('members').where('user', realUser)
        .first('id', 'first_name', 'last_name', 'photo')
      if (!self) return res.json({ data: { self: null, managed: [] } })

      // ⚠ Only members the middleware would ACTUALLY let her act as — the same
      // test as resolveGrant: a draft shadow on the managed domain with no
      // password and exactly the Member role. Listing a linked child who was
      // never provisioned offered a switch that then failed with a desync
      // reload (Aliyah 763, prod, 09.2026).
      const grants = await database('member_guardians as mg')
        .where('mg.guardian_user', realUser)
        .join('members as m', 'm.id', 'mg.member')
        .join('directus_users as u', 'u.id', 'm.user')
        .join('directus_roles as r', 'r.id', 'u.role')
        .where('u.status', 'draft')
        .whereNull('u.password')
        .whereRaw('lower(u.email) LIKE ?', ['%@' + MANAGED_EMAIL_DOMAIN])
        .where('r.name', 'Member')
        .leftJoin('household_members as hm', function () {
          this.on('hm.member', '=', 'mg.member')
            .andOn('hm.household', '=', 'mg.household')
            .andOnNull('hm.revoked_at')
        })
        .select('m.id', 'm.first_name', 'm.last_name', 'm.photo', 'hm.accent', 'mg.household',
          'm.user', 'm.role', 'm.is_spielplaner',
          'u.email as login_email', 'u.status as login_status', 'r.name as role_name')
        .orderBy('m.first_name')
      // ⚠ ...and the same staff re-check the middleware runs on every grant
      // (acting-member.js targetIsStaff). Without it a linked member who later
      // became a coach / finance / planner stayed in the switcher and every tap
      // on her ended in a grant refusal.
      const [staff, withAccess] = await Promise.all([
        loadStaffSet(database, grants.map((g) => g.id)),
        loadUserAccessSet(database, grants.map((g) => g.user)),
      ])
      const managed = dedupeManaged(grants.filter((g) => !actableReason({
        member: g,
        // The query above already required password IS NULL.
        user: { email: g.login_email, status: g.login_status, has_password: false },
        roleName: g.role_name,
        isStaffLinked: staff.has(Number(g.id)),
        hasUserAccess: withAccess.has(g.user),
      })))

      // Team names for the row subtitle — a parent picks by team as often as
      // by name ("the DU12 one").
      const ids = managed.map((g) => g.id)
      const teamRows = ids.length
        ? await database('member_teams as mt')
          .whereIn('mt.member', ids)
          .join('teams as t', 't.id', 'mt.team')
          .where('t.active', true)
          .select('mt.member', 't.name')
        : []
      const teamsByMember = new Map()
      for (const r of teamRows) {
        if (!teamsByMember.has(r.member)) teamsByMember.set(r.member, [])
        teamsByMember.get(r.member).push(r.name)
      }

      res.json({
        data: {
          self: { id: self.id, first_name: self.first_name, last_name: self.last_name, photo: self.photo },
          managed: managed.map((g) => ({
            id: g.id,
            first_name: g.first_name,
            last_name: g.last_name,
            photo: g.photo,
            accent: g.accent || 'sky',
            household: g.household,
            teams: teamsByMember.get(g.id) || [],
          })),
        },
      })
    } catch (err) {
      log.error({ msg: `household/me: ${err.message}`, endpoint: 'household/me', stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // ── Admin listing ─────────────────────────────────────────────────
  router.get('/household', async (req, res) => {
    try {
      if (!(await mayReadHouseholds(database, req.accountability))) {
        return res.status(403).json({ error: 'Not permitted', code: 'forbidden' })
      }
      const households = await database('households').select('*').orderBy('name')
      const rows = await database('household_members as hm')
        .join('members as m', 'm.id', 'hm.member')
        .leftJoin('directus_users as u', 'u.id', 'm.user')
        .leftJoin('directus_roles as dr', 'dr.id', 'u.role')
        .leftJoin('members as lb', 'lb.id', 'hm.linked_by')
        .select(
          'hm.id', 'hm.household', 'hm.member', 'hm.role', 'hm.accent',
          'hm.linked_at', 'hm.revoked_at',
          'm.first_name', 'm.last_name', 'm.email', 'm.birthdate',
          'm.user as member_user', 'm.role as member_roles', 'm.is_spielplaner',
          'u.status as user_status', 'u.email as login_email', 'dr.name as login_role',
          database.raw('(u.password IS NOT NULL) AS login_has_password'),
          'lb.first_name as linked_by_first', 'lb.last_name as linked_by_last',
        )
        .orderBy(['hm.household', 'hm.role', 'm.first_name'])

      const managedRows = rows.filter((r) => r.role === 'managed' && !r.revoked_at)
      const [staff, withAccess] = await Promise.all([
        loadStaffSet(database, managedRows.map((r) => r.member)),
        loadUserAccessSet(database, managedRows.map((r) => r.member_user)),
      ])

      res.json({
        data: households.map((h) => ({
          ...h,
          members: rows.filter((r) => r.household === h.id).map((raw) => {
            const {
              login_has_password, member_user, member_roles, is_spielplaner, login_role, ...r
            } = raw
            const user = { email: r.login_email, status: r.user_status, has_password: login_has_password === true }
            // What the switcher and the middleware will accept — the same
            // predicate both use. A live managed row with a reason needs "Set
            // up" ('not_provisioned', no login), had a real login attached
            // (migration 377 then revokes it), or its member became staff
            // after the link ('member_is_staff').
            const reason = r.role === 'managed'
              ? actableReason({
                member: { id: r.member, user: member_user, role: member_roles, is_spielplaner },
                user,
                roleName: login_role,
                isStaffLinked: staff.has(Number(r.member)),
                hasUserAccess: withAccess.has(member_user),
              })
              : null
            return {
              ...r,
              managed: String(r.login_email || '').toLowerCase().endsWith('@' + MANAGED_EMAIL_DOMAIN),
              actable: r.role === 'managed' && !reason,
              not_actable_reason: reason,
            }
          }),
        })),
      })
    } catch (err) {
      log.error({ msg: `household list: ${err.message}`, endpoint: 'household', stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // ── Member picker ─────────────────────────────────────────────────
  // Every candidate with the verdict the link route would give, so the picker
  // can disable a row and say why instead of failing after the click.
  //   role=managed   — active club members (a managed child has no login).
  //   role=guardian  — active members PLUS anyone holding a login, so a parent
  //                    registered as "Kein Mitglied" can be found.
  // ?household=<id> additionally marks members already live in that household.
  router.get('/household/candidates', async (req, res) => {
    try {
      if (req.accountability?.kscwGuardian) {
        return res.status(403).json({ error: 'Not available while using another account', code: 'acting_forbidden' })
      }
      if (!(await isSuperadmin(database, req.accountability))) {
        return res.status(403).json({ error: 'Admin only', code: 'not_superadmin' })
      }
      const role = parseRole(req.query?.role)
      if (!role) return res.status(400).json({ error: 'role must be guardian or managed', code: 'bad_role' })
      const householdRaw = req.query?.household
      const householdId = householdRaw == null || householdRaw === '' ? null : Number(householdRaw)
      if (householdId !== null && !Number.isInteger(householdId)) {
        return res.status(400).json({ error: 'household must be an id', code: 'bad_request' })
      }

      const q = database('members')
        .select('id', 'first_name', 'last_name', 'email', 'birthdate', 'register_status',
          'kscw_membership_active', 'user', 'role', 'is_spielplaner')
        .orderBy(['last_name', 'first_name', 'id'])
      if (role === 'managed') q.where('kscw_membership_active', true)
      else q.where((b) => b.where('kscw_membership_active', true).orWhereNotNull('user'))
      const members = await q

      const [users, staff, linkedIds] = await Promise.all([
        loadUsers(database, members.map((m) => m.user)),
        role === 'managed' ? loadStaffSet(database, members.map((m) => m.id)) : Promise.resolve(new Set()),
        householdId !== null
          ? database('household_members').where('household', householdId).whereNull('revoked_at').pluck('member')
          : Promise.resolve([]),
      ])
      const linked = new Set(linkedIds.map(Number))

      res.json({
        data: members.map((m) => {
          const user = m.user ? users.get(m.user) : null
          const shadow = isShadowUser(user)
          const reason = linked.has(Number(m.id))
            ? 'already_linked'
            : role === 'managed'
              ? manageableReason({ member: m, user, isStaffLinked: staff.has(Number(m.id)) })
              : guardianReason({ member: m, user })
          return {
            id: m.id,
            first_name: m.first_name,
            last_name: m.last_name,
            email: m.email,
            birthdate: m.birthdate,
            register_status: m.register_status,
            kscw_membership_active: m.kscw_membership_active,
            has_login: !!user && !shadow,
            managed_login: shadow,
            eligible: !reason,
            reason: reason || null,
          }
        }),
      })
    } catch (err) {
      log.error({ msg: `household candidates: ${err.message}`, endpoint: 'household/candidates', stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // ── Create a household ────────────────────────────────────────────
  router.post('/household', async (req, res) => {
    try {
      if (!(await guardMutation(req, res))) return
      const name = String(req.body?.name || '').trim()
      if (!name) return res.status(400).json({ error: 'Name required', code: 'name_required' })
      if (name.length > NAME_MAX) return res.status(400).json({ error: 'Name too long', code: 'name_too_long' })

      const row = await database.transaction(async (trx) => {
        const actor = await trx('members').where('user', req.accountability.user).first('id')
        const [created] = await trx('households')
          .insert({ name, notes: req.body?.notes || null, created_by: actor?.id ?? null })
          .returning(['id', 'name'])
        await auditStrict(trx, {
          accountability: req.accountability,
          action: 'household_create',
          collection: 'households',
          recordId: created.id,
          data: { name },
        })
        return created
      })
      res.json({ data: row })
    } catch (err) {
      fail(res, err, 'household')
    }
  })

  // ── Rename / edit notes ───────────────────────────────────────────
  router.patch('/household/:id', async (req, res) => {
    try {
      if (!(await guardMutation(req, res))) return
      const householdId = Number(req.params.id)
      if (!Number.isInteger(householdId)) {
        return res.status(400).json({ error: 'household required', code: 'bad_request' })
      }
      const patch = {}
      if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'name')) {
        const name = String(req.body.name ?? '').trim()
        if (!name) return res.status(400).json({ error: 'Name required', code: 'name_required' })
        if (name.length > NAME_MAX) return res.status(400).json({ error: 'Name too long', code: 'name_too_long' })
        patch.name = name
      }
      if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'notes')) {
        const notes = req.body.notes == null ? '' : String(req.body.notes).trim()
        if (notes.length > NOTES_MAX) return res.status(400).json({ error: 'Notes too long', code: 'notes_too_long' })
        patch.notes = notes || null
      }
      if (!Object.keys(patch).length) {
        return res.status(400).json({ error: 'Nothing to change', code: 'bad_request' })
      }

      const row = await database.transaction(async (trx) => {
        const before = await trx('households').where('id', householdId).forUpdate().first('id', 'name', 'notes')
        if (!before) throw new HouseholdError(404, 'not_found', 'Household not found')
        const [updated] = await trx('households').where('id', householdId)
          .update({ ...patch, date_updated: new Date() })
          .returning(['id', 'name', 'notes', 'date_updated'])
        await auditStrict(trx, {
          accountability: req.accountability,
          action: 'household_update',
          collection: 'households',
          recordId: householdId,
          data: {
            before: Object.fromEntries(Object.keys(patch).map((k) => [k, before[k]])),
            after: patch,
          },
        })
        return updated
      })
      res.json({ data: row })
    } catch (err) {
      fail(res, err, 'household/update')
    }
  })

  // ── Delete an EMPTY household ─────────────────────────────────────
  // ⚠ Only a household that never had a single household_members row, revoked
  // ones included. The FK is ON DELETE CASCADE, so deleting anything else would
  // silently destroy the record of who could act for a minor — which IS the
  // audit trail. A household created by mistake (typo, duplicate) is the only
  // intended use.
  router.delete('/household/:id', async (req, res) => {
    try {
      if (!(await guardMutation(req, res))) return
      const householdId = Number(req.params.id)
      if (!Number.isInteger(householdId)) {
        return res.status(400).json({ error: 'household required', code: 'bad_request' })
      }
      await database.transaction(async (trx) => {
        // FOR UPDATE conflicts with the FK key-share lock a concurrent link
        // insert takes, so "empty" cannot change between the count and the delete.
        const h = await trx('households').where('id', householdId).forUpdate().first('id', 'name', 'notes')
        if (!h) throw new HouseholdError(404, 'not_found', 'Household not found')
        const [{ n }] = await trx('household_members').where('household', householdId).count({ n: '*' })
        if (Number(n) > 0) {
          throw new HouseholdError(409, 'household_has_history', 'This household has linked members (or had some) and cannot be deleted')
        }
        await auditStrict(trx, {
          accountability: req.accountability,
          action: 'household_delete',
          collection: 'households',
          recordId: householdId,
          data: { name: h.name, notes: h.notes },
        })
        await trx('households').where('id', householdId).delete()
      })
      res.json({ data: { ok: true } })
    } catch (err) {
      fail(res, err, 'household/delete')
    }
  })

  // ── Link a member into a household ────────────────────────────────
  // A MANAGED link provisions the shadow login in the same transaction: a link
  // without a login is a child the parent can see in the admin page but never
  // switch to, which is exactly the state that broke on prod.
  router.post('/household/:id/members', async (req, res) => {
    try {
      if (!(await guardMutation(req, res))) return
      const householdId = Number(req.params.id)
      const memberId = Number(req.body?.member)
      if (!Number.isInteger(householdId) || !Number.isInteger(memberId)) {
        return res.status(400).json({ error: 'household and member required', code: 'bad_request' })
      }
      const role = parseRole(req.body?.role)
      if (!role) return res.status(400).json({ error: 'role must be guardian or managed', code: 'bad_role' })

      // Fetched before the transaction: getSchema takes its own connection.
      const schema = role === 'managed' ? await getSchema() : null

      const result = await database.transaction(async (trx) => {
        const household = await trx('households').where('id', householdId).first('id')
        if (!household) throw new HouseholdError(404, 'not_found', 'Household not found')

        const member = await trx('members').where('id', memberId).first('id', 'first_name')
        if (!member) throw new HouseholdError(404, 'member_not_found', 'Member not found')

        const check = role === 'guardian'
          ? await assertCanBeGuardian(trx, memberId)
          : await assertTargetIsManageable(trx, memberId)
        if (!check.ok) throw new HouseholdError(400, check.code, REFUSAL_MESSAGES[check.code] || 'Not permitted')

        const existing = await trx('household_members')
          .where({ household: householdId, member: memberId }).whereNull('revoked_at').first('id')
        if (existing) throw new HouseholdError(409, 'already_linked', REFUSAL_MESSAGES.already_linked)

        const used = await trx('household_members')
          .where('household', householdId).whereNull('revoked_at').pluck('accent')
        const accent = ACCENTS.find((a) => !used.includes(a)) || ACCENTS[used.length % ACCENTS.length]

        const actor = await trx('members').where('user', req.accountability.user).first('id')
        const [row] = await trx('household_members')
          .insert({
            household: householdId, member: memberId, role,
            accent: role === 'managed' ? accent : null,
            linked_by: actor?.id ?? null,
          })
          .returning(['id'])

        await auditStrict(trx, {
          accountability: req.accountability,
          action: 'household_link',
          recordId: memberId,
          data: { household: householdId, role, member_name: member.first_name },
        })

        let provision = null
        if (role === 'managed') {
          provision = await provisionManagedMember(trx, { memberId, schema, services })
          if (provision.outcome !== 'existing') {
            await auditStrict(trx, {
              accountability: req.accountability,
              action: 'household_provision',
              recordId: memberId,
              data: { user: provision.user, email: provision.email, outcome: provision.outcome, member_name: member.first_name, via: 'link' },
            })
          }
        }

        return {
          id: row.id, household: householdId, member: memberId, role,
          accent: role === 'managed' ? accent : null,
          provisioned: provision ? provision.outcome : null,
        }
      })

      bustGrantCache()
      res.json({ data: result })
    } catch (err) {
      fail(res, err, 'household/members')
    }
  })

  // ── Provision a managed member (repair path) ──────────────────────
  // New managed links provision themselves (above). This stays for links made
  // before that, and for healing a half-failed older run.
  router.post('/household/:id/members/:memberId/provision', async (req, res) => {
    try {
      if (!(await guardMutation(req, res))) return
      const householdId = Number(req.params.id)
      const memberId = Number(req.params.memberId)
      if (!Number.isInteger(householdId) || !Number.isInteger(memberId)) {
        return res.status(400).json({ error: 'household and member required', code: 'bad_request' })
      }

      const schema = await getSchema()
      const result = await database.transaction(async (trx) => {
        const link = await trx('household_members')
          .where({ household: householdId, member: memberId, role: 'managed' })
          .whereNull('revoked_at').first('id')
        if (!link) throw new HouseholdError(400, 'not_managed', 'Member is not managed in this household')

        const member = await trx('members').where('id', memberId).first('first_name')
        const provision = await provisionManagedMember(trx, { memberId, schema, services })
        if (provision.outcome !== 'existing') {
          await auditStrict(trx, {
            accountability: req.accountability,
            action: 'household_provision',
            recordId: memberId,
            data: { user: provision.user, email: provision.email, outcome: provision.outcome, member_name: member?.first_name ?? null },
          })
        }
        return { member: memberId, user: provision.user, email: provision.email, outcome: provision.outcome }
      })

      bustGrantCache()
      res.json({ data: result })
    } catch (err) {
      fail(res, err, 'household/provision')
    }
  })

  // ── Revoke a link ─────────────────────────────────────────────────
  // Admin/superuser, OR the linked member herself if she holds a real login.
  // That second path is deliberate: a 16-year-old who has her own account must
  // be able to end a parent's access without having to ask anyone.
  router.delete('/household/:id/members/:hmId', async (req, res) => {
    try {
      if (req.accountability?.kscwGuardian) {
        return res.status(403).json({ error: 'Not available while using another account', code: 'acting_forbidden' })
      }
      const userId = req.accountability?.user
      if (!userId) return res.status(401).json({ error: 'Authentication required' })

      const householdId = Number(req.params.id)
      const hmId = Number(req.params.hmId)
      if (!Number.isInteger(householdId) || !Number.isInteger(hmId)) {
        return res.status(400).json({ error: 'household and link required', code: 'bad_request' })
      }

      await database.transaction(async (trx) => {
        // ⚠ Scoped to the household in the URL: a link id from another
        // household must 404, not silently revoke something else.
        const row = await trx('household_members').where({ id: hmId, household: householdId }).forUpdate().first()
        if (!row || row.revoked_at) throw new HouseholdError(404, 'not_found', 'Link not found')

        const caller = await trx('members').where('user', userId).first('id')
        const isSelf = !!caller && caller.id === row.member
        if (!isSelf && !(await isSuperadmin(trx, req.accountability))) {
          throw new HouseholdError(403, 'forbidden', 'Not permitted')
        }

        await trx('household_members').where('id', hmId)
          .update({ revoked_at: new Date(), revoked_by: caller?.id ?? null })

        await auditStrict(trx, {
          accountability: req.accountability,
          action: 'household_unlink',
          recordId: row.member,
          data: { household: row.household, role: row.role, link: hmId, by_self: isSelf },
        })
      })

      // After COMMIT: a bust before it could be refilled from the old grant.
      bustGrantCache()
      res.json({ data: { ok: true } })
    } catch (err) {
      fail(res, err, 'household/unlink')
    }
  })
}
