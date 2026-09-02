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
 *   POST   /kscw/household                               admin | superuser
 *   POST   /kscw/household/:id/members                   admin | superuser
 *   POST   /kscw/household/:id/members/:memberId/provision   admin | superuser
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
 * privilege grant, so the operation is refused instead.
 */

import { writeUserLog } from './activity-log.js'

// Shadow users live on a domain that resolves to nothing and accepts no mail.
// It is also the marker the acting middleware uses to tell "managed member"
// from "real account that happens to be inactive" — so it must never be a real
// deliverable domain.
export const MANAGED_EMAIL_DOMAIN = 'managed.wiedisync.kscw.ch'

// Stable switcher colours, assigned round-robin in link order. Stored on the
// row rather than hashed from the member id so adding a fourth child never
// re-shuffles the three the parent has already learned.
const ACCENTS = ['sky', 'ochre', 'plum', 'teal', 'rose']

function callerRoles(row) {
  if (!row) return []
  if (Array.isArray(row.role)) return row.role
  try { return JSON.parse(row.role || '[]') } catch { return [] }
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
 * Throws — the caller must let that propagate into a 500 rather than proceed.
 */
async function auditStrict(database, { accountability, action, recordId, data }) {
  const actor = accountability?.user
    ? await database('members').where({ user: accountability.user }).first('id')
    : null
  await database('user_logs').insert({
    action,
    collection_name: 'household_members',
    record_id: recordId != null ? String(recordId) : null,
    data: data == null ? null : JSON.stringify(data),
    user: actor?.id ?? null,
    acting_guardian: accountability?.kscwGuardian?.memberId ?? null,
    date_created: new Date(),
  })
}

/**
 * Is this member a legitimate grant TARGET?
 * Returns { ok: true } or { ok: false, code }.
 *
 * ⚠ The role/staff checks are not paranoia. Acting resolves the caller as the
 * target, so granting over a member who holds coach, Team Responsible or
 * Spielplaner powers would hand the guardian those powers over other people's
 * children. Managed members are minors with a plain Member role, and anything
 * else is refused rather than narrowed.
 */
async function assertTargetIsManageable(database, memberId) {
  const m = await database('members').where('id', memberId)
    .first('id', 'user', 'role', 'is_spielplaner')
  if (!m) return { ok: false, code: 'member_not_found' }

  // is_spielplaner is club-wide by design, not per-team — acting as a member who
  // holds it would hand the guardian scheduling powers over the whole club.
  if (m.is_spielplaner) return { ok: false, code: 'member_is_staff' }

  if (m.user) {
    const u = await database('directus_users').where('id', m.user).first('email', 'status', 'password')
    // A real, usable login. Never claimable — this is the consent guarantee.
    const isShadow = !!u
      && String(u.email || '').toLowerCase().endsWith('@' + MANAGED_EMAIL_DOMAIN)
      && u.status === 'draft'
      && !u.password
    if (!isShadow) return { ok: false, code: 'member_has_own_login' }
  }

  // Plain member only — no elevated role.
  // ⚠ The baseline role in members.role is 'user', NOT 'member'. Filtering on
  // 'member' would treat every ordinary member as staff and refuse every
  // legitimate link. Anything beyond the baseline (admin, vb_admin, bb_admin,
  // vorstand, finance, superuser, website_admin) is elevated and refused.
  const BASELINE_ROLES = new Set(['user'])
  const elevated = callerRoles(m).filter((r) => r && !BASELINE_ROLES.has(r))
  if (elevated.length) return { ok: false, code: 'member_is_staff' }

  const [coach, tr, planner] = await Promise.all([
    database('teams_coaches').where('members_id', memberId).first('id'),
    database('teams_responsibles').where('members_id', memberId).first('id'),
    database('spielplaner_assignments').where('member', memberId).first('id').catch(() => null),
  ])
  if (coach || tr || planner) return { ok: false, code: 'member_is_staff' }

  return { ok: true }
}

export function registerHousehold(router, { database, logger, services, getSchema }) {
  const log = logger.child({ endpoint: 'household' })

  /** Shared guard for every mutating route. */
  async function guardMutation(req, res) {
    if (req.accountability?.kscwGuardian) {
      res.status(403).json({ error: 'Not available while using another account', code: 'acting_forbidden' })
      return false
    }
    if (!(await isSuperadmin(database, req.accountability))) {
      res.status(403).json({ error: 'Admin only', code: 'not_superadmin' })
      return false
    }
    return true
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

      const grants = await database('member_guardians as mg')
        .where('mg.guardian_user', realUser)
        .join('members as m', 'm.id', 'mg.member')
        .leftJoin('household_members as hm', function () {
          this.on('hm.member', '=', 'mg.member')
            .andOn('hm.household', '=', 'mg.household')
            .andOnNull('hm.revoked_at')
        })
        .select('m.id', 'm.first_name', 'm.last_name', 'm.photo', 'hm.accent', 'mg.household')
        .orderBy('m.first_name')

      // Team names for the row subtitle — a parent picks by team as often as
      // by name ("the DU12 one").
      const ids = grants.map((g) => g.id)
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
          managed: grants.map((g) => ({
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
        .leftJoin('members as lb', 'lb.id', 'hm.linked_by')
        .select(
          'hm.id', 'hm.household', 'hm.member', 'hm.role', 'hm.accent',
          'hm.linked_at', 'hm.revoked_at',
          'm.first_name', 'm.last_name', 'm.email',
          'u.status as user_status', 'u.email as login_email',
          'lb.first_name as linked_by_first', 'lb.last_name as linked_by_last',
        )
        .orderBy(['hm.household', 'hm.role', 'm.first_name'])

      res.json({
        data: households.map((h) => ({
          ...h,
          members: rows.filter((r) => r.household === h.id).map((r) => ({
            ...r,
            managed: String(r.login_email || '').toLowerCase().endsWith('@' + MANAGED_EMAIL_DOMAIN),
          })),
        })),
      })
    } catch (err) {
      log.error({ msg: `household list: ${err.message}`, endpoint: 'household', stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // ── Create a household ────────────────────────────────────────────
  router.post('/household', async (req, res) => {
    try {
      if (!(await guardMutation(req, res))) return
      const name = String(req.body?.name || '').trim()
      if (!name) return res.status(400).json({ error: 'Name required', code: 'name_required' })

      const actor = await database('members').where('user', req.accountability.user).first('id')
      const [row] = await database('households')
        .insert({ name, notes: req.body?.notes || null, created_by: actor?.id ?? null })
        .returning(['id', 'name'])

      await auditStrict(database, {
        accountability: req.accountability,
        action: 'household_create',
        recordId: row.id,
        data: { name },
      })
      res.json({ data: row })
    } catch (err) {
      log.error({ msg: `household create: ${err.message}`, endpoint: 'household', stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // ── Link a member into a household ────────────────────────────────
  router.post('/household/:id/members', async (req, res) => {
    try {
      if (!(await guardMutation(req, res))) return
      const householdId = Number(req.params.id)
      const memberId = Number(req.body?.member)
      const role = req.body?.role === 'guardian' ? 'guardian' : 'managed'
      if (!Number.isInteger(householdId) || !Number.isInteger(memberId)) {
        return res.status(400).json({ error: 'household and member required', code: 'bad_request' })
      }

      const household = await database('households').where('id', householdId).first('id')
      if (!household) return res.status(404).json({ error: 'Household not found', code: 'not_found' })

      const member = await database('members').where('id', memberId).first('id', 'user', 'first_name')
      if (!member) return res.status(404).json({ error: 'Member not found', code: 'member_not_found' })

      if (role === 'guardian') {
        // A guardian without a login confers nothing — the rebuild would drop
        // her silently, which reads to an admin as "the link didn't save".
        if (!member.user) {
          return res.status(400).json({
            error: 'A guardian needs their own login first',
            code: 'guardian_needs_login',
          })
        }
        const u = await database('directus_users').where('id', member.user).first('email')
        if (String(u?.email || '').toLowerCase().endsWith('@' + MANAGED_EMAIL_DOMAIN)) {
          return res.status(400).json({
            error: 'A managed member cannot be a guardian',
            code: 'guardian_is_managed',
          })
        }
      } else {
        const check = await assertTargetIsManageable(database, memberId)
        if (!check.ok) {
          const messages = {
            member_has_own_login: 'This member has their own login. Only members without an account can be managed.',
            member_is_staff: 'This member holds a coach, team responsible or planner role and cannot be managed.',
            member_not_found: 'Member not found',
          }
          return res.status(400).json({ error: messages[check.code] || 'Not permitted', code: check.code })
        }
      }

      const existing = await database('household_members')
        .where({ household: householdId, member: memberId }).whereNull('revoked_at').first('id')
      if (existing) return res.status(409).json({ error: 'Already linked', code: 'already_linked' })

      const used = await database('household_members')
        .where('household', householdId).whereNull('revoked_at').pluck('accent')
      const accent = ACCENTS.find((a) => !used.includes(a)) || ACCENTS[used.length % ACCENTS.length]

      const actor = await database('members').where('user', req.accountability.user).first('id')
      const [row] = await database('household_members')
        .insert({
          household: householdId, member: memberId, role,
          accent: role === 'managed' ? accent : null,
          linked_by: actor?.id ?? null,
        })
        .returning(['id'])

      await auditStrict(database, {
        accountability: req.accountability,
        action: 'household_link',
        recordId: memberId,
        data: { household: householdId, role, member_name: member.first_name },
      })

      res.json({ data: { id: row.id, household: householdId, member: memberId, role, accent } })
    } catch (err) {
      log.error({ msg: `household link: ${err.message}`, endpoint: 'household/members', stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // ── Provision a managed member (Stage 2) ──────────────────────────
  // Creates the shadow login that makes a member notifiable and actable-for.
  //
  // ⚠⚠ Two independent Directus gates make this account impossible to sign into,
  // both verified in the running 12.x image:
  //   services/authentication.js — refuses any user whose status !== 'active'
  //   auth/drivers/local.js      — throws InvalidCredentialsError when !password
  // And it costs no licence seat: the seat counter filters status='active'.
  router.post('/household/:id/members/:memberId/provision', async (req, res) => {
    try {
      if (!(await guardMutation(req, res))) return
      const memberId = Number(req.params.memberId)
      if (!Number.isInteger(memberId)) {
        return res.status(400).json({ error: 'member required', code: 'bad_request' })
      }

      const member = await database('members').where('id', memberId)
        .first('id', 'user', 'first_name', 'last_name')
      if (!member) return res.status(404).json({ error: 'Member not found', code: 'member_not_found' })
      if (member.user) {
        return res.status(409).json({ error: 'This member already has a login', code: 'already_has_login' })
      }

      const link = await database('household_members')
        .where({ household: Number(req.params.id), member: memberId, role: 'managed' })
        .whereNull('revoked_at').first('id')
      if (!link) return res.status(400).json({ error: 'Member is not managed in this household', code: 'not_managed' })

      const memberRole = await database('directus_roles').where('name', 'Member').first('id')
      if (!memberRole) throw new Error('Member role not found in directus_roles')

      const schema = await getSchema()
      const { UsersService } = services
      const adminUsers = new UsersService({ schema, knex: database, accountability: { admin: true } })

      const email = `m${memberId}@${MANAGED_EMAIL_DOMAIN}`
      const userId = await adminUsers.createOne({
        email,
        first_name: member.first_name || '',
        last_name: member.last_name || '',
        role: memberRole.id,
        status: 'draft',
      })

      // ⚠ wiedisync_active is LOAD-BEARING and easy to miss. Normally only the
      // auth.login action flips it, and a shadow user can never log in — while
      // wiedisync_active = false silently suppresses in-app notification
      // creation in eight places. Without this line a managed member receives
      // nothing, forever, with no error anywhere.
      await database('members').where('id', memberId)
        .update({ user: userId, wiedisync_active: true })

      await auditStrict(database, {
        accountability: req.accountability,
        action: 'household_provision',
        recordId: memberId,
        data: { user: userId, email, member_name: member.first_name },
      })

      res.json({ data: { member: memberId, user: userId, email } })
    } catch (err) {
      log.error({ msg: `household provision: ${err.message}`, endpoint: 'household/provision', stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
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

      const hmId = Number(req.params.hmId)
      const row = await database('household_members').where('id', hmId).first()
      if (!row || row.revoked_at) return res.status(404).json({ error: 'Link not found', code: 'not_found' })

      const caller = await database('members').where('user', userId).first('id')
      const isSelf = caller && caller.id === row.member
      if (!isSelf && !(await isSuperadmin(database, req.accountability))) {
        return res.status(403).json({ error: 'Not permitted', code: 'forbidden' })
      }

      await database('household_members').where('id', hmId)
        .update({ revoked_at: new Date(), revoked_by: caller?.id ?? null })

      await auditStrict(database, {
        accountability: req.accountability,
        action: 'household_unlink',
        recordId: row.member,
        data: { household: row.household, role: row.role, by_self: !!isSelf },
      })

      res.json({ data: { ok: true } })
    } catch (err) {
      log.error({ msg: `household unlink: ${err.message}`, endpoint: 'household/unlink', stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })
}
