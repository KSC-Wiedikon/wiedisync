/**
 * Delete impact preview + member hard delete — backs the Data Explorer's
 * danger zone (`/admin/explore` → member detail → "Delete permanently").
 *
 * Two routes:
 *
 *   GET  /kscw/admin/delete-impact/:collection/:id   — READ ONLY, no actor log
 *   POST /kscw/admin/delete-member  { member_id }    — MUTATING, writeUserLog
 *
 * Why a custom endpoint at all:
 *
 *  1. The preview. Before an operator destroys a member the UI must be able to
 *     say exactly what goes with them — 149 RSVPs, 12 invoices unlinked, and
 *     "3 expense rows will block this". Directus has no such API, and the
 *     counts span ~70 tables, so it is one server round trip here instead of
 *     70 items-API calls from the browser.
 *
 *  2. The guard rails. A member delete destroys ~29 CASCADE tables and the
 *     person's login. THIS ROUTE IS THE ONLY WAY A NON-DIRECTUS-ADMIN CAN DO
 *     IT: `members.delete` is deliberately NOT granted to the KSCW Sport Admin
 *     policy (setup-permissions.mjs §9 / PERMISSIONS.md), so a plain
 *     `DELETE /items/members/:id` answers 403 and there is no detour around the
 *     three checks below — sport scope, privileged target, and self.
 *
 *  3. The linked login. The `members.items.delete` hook (kscw-hooks §0c) also
 *     removes it, but it is an ACTION hook: it is fired without being awaited,
 *     so its success is not knowable to the caller. This route re-checks the
 *     row and, if it is somehow still there, removes it and REPORTS a failure
 *     (`user_deleted: false` + `warning`) instead of swallowing it the way
 *     `/kscw/delete-account` does. An account that can still authenticate after
 *     its member row is gone must never be a silent outcome.
 *
 * The `members` row is deleted through ItemsService with the caller's identity
 * but escalated permissions (`{ ...req.accountability, admin: true }`) — the
 * checks in this file ARE the enforcement point, and the escalation is what
 * lets the grant stay withheld at the policy layer. `accountability.user` is
 * preserved, so Directus still writes its own activity + revision trail against
 * the real actor, on top of our `user_logs` entry.
 */

import { writeUserLog } from './activity-log.js'

// ── FK map ───────────────────────────────────────────────────────────────
//
// Static literal derived from `pg_constraint` on PROD, 2026-08-06:
//
//   select c.conrelid::regclass, conkey-cols, c.confrelid::regclass, confdeltype
//   from pg_constraint c
//   where c.contype = 'f'
//     and c.confrelid::regclass::text in ('members','events','games','trainings')
//
// It is a literal ON PURPOSE. Table and column identifiers used to build SQL
// come from here and NOWHERE else — never from `req` — which is what keeps the
// knex identifier interpolation injection-free. Re-run the query above and
// update this block after any migration that adds an inbound FK.
//
// Counts as of 2026-08-06: members 70 edges (4 RESTRICT / 29 CASCADE / 37 SET
// NULL), events 4, games 4, trainings 0 (trainings genuinely has no inbound FK
// — its dependents are all polymorphic, handled below).

/** @type {Record<string, Array<{ table: string, column: string, rule: 'RESTRICT'|'CASCADE'|'SET NULL' }>>} */
const FK_MAP = {
  members: [
    // — RESTRICT: money and accountability rows that must be re-homed first —
    { table: 'finance_expenses', column: 'member', rule: 'RESTRICT' },
    { table: 'finance_payouts', column: 'member', rule: 'RESTRICT' },
    { table: 'fines', column: 'member', rule: 'RESTRICT' },
    { table: 'referee_expenses', column: 'paid_by_member', rule: 'RESTRICT' },
    // — CASCADE: rows that are meaningless without the member —
    { table: 'absences', column: 'member', rule: 'CASCADE' },
    { table: 'announcement_recipients', column: 'member', rule: 'CASCADE' },
    { table: 'blocks', column: 'blocked', rule: 'CASCADE' },
    { table: 'blocks', column: 'blocker', rule: 'CASCADE' },
    { table: 'conversation_members', column: 'member', rule: 'CASCADE' },
    { table: 'events_members', column: 'members_id', rule: 'CASCADE' },
    { table: 'finance_invoice_member_overrides', column: 'member', rule: 'CASCADE' },
    { table: 'game_guests', column: 'member', rule: 'CASCADE' },
    { table: 'identity_document_keys', column: 'recipient', rule: 'CASCADE' },
    { table: 'identity_documents', column: 'member', rule: 'CASCADE' },
    { table: 'member_teams', column: 'member', rule: 'CASCADE' },
    { table: 'message_reactions', column: 'member', rule: 'CASCADE' },
    { table: 'message_requests', column: 'recipient', rule: 'CASCADE' },
    { table: 'message_requests', column: 'sender', rule: 'CASCADE' },
    { table: 'messages', column: 'sender', rule: 'CASCADE' },
    { table: 'notifications', column: 'member', rule: 'CASCADE' },
    { table: 'participations', column: 'member', rule: 'CASCADE' },
    { table: 'poll_votes', column: 'member', rule: 'CASCADE' },
    { table: 'push_subscriptions', column: 'member', rule: 'CASCADE' },
    { table: 'scheduling_email_reads', column: 'member', rule: 'CASCADE' },
    { table: 'scorer_delegations', column: 'from_member', rule: 'CASCADE' },
    { table: 'scorer_delegations', column: 'to_member', rule: 'CASCADE' },
    { table: 'signup_tokens', column: 'member', rule: 'CASCADE' },
    { table: 'slot_claims', column: 'claimed_by_member', rule: 'CASCADE' },
    { table: 'spielplaner_assignments', column: 'member', rule: 'CASCADE' },
    { table: 'team_requests', column: 'member', rule: 'CASCADE' },
    { table: 'teams_coaches', column: 'members_id', rule: 'CASCADE' },
    { table: 'teams_responsibles', column: 'members_id', rule: 'CASCADE' },
    { table: 'vb_referee_duty', column: 'referee', rule: 'CASCADE' },
    // — SET NULL: the row survives, the link to this person is erased —
    { table: 'announcements', column: 'created_by', rule: 'SET NULL' },
    { table: 'basketball_hall_availability', column: 'created_by', rule: 'SET NULL' },
    { table: 'basketball_slot_plan', column: 'created_by', rule: 'SET NULL' },
    { table: 'basketball_slots', column: 'created_by', rule: 'SET NULL' },
    { table: 'basketball_team_rules', column: 'created_by', rule: 'SET NULL' },
    { table: 'broadcasts', column: 'sender', rule: 'SET NULL' },
    { table: 'conversations', column: 'created_by', rule: 'SET NULL' },
    { table: 'email_suppressions', column: 'released_by', rule: 'SET NULL' },
    { table: 'event_signups', column: 'member', rule: 'SET NULL' },
    { table: 'finance_invoices', column: 'member', rule: 'SET NULL' },
    { table: 'finance_invoices', column: 'reported_paid_by', rule: 'SET NULL' },
    { table: 'fine_rules', column: 'updated_by', rule: 'SET NULL' },
    { table: 'fines', column: 'issued_by', rule: 'SET NULL' },
    { table: 'fines', column: 'paid_received_by', rule: 'SET NULL' },
    { table: 'fines', column: 'waived_by', rule: 'SET NULL' },
    { table: 'forms', column: 'created_by', rule: 'SET NULL' },
    { table: 'form_submissions', column: 'member', rule: 'SET NULL' },
    { table: 'game_rosters', column: 'member', rule: 'SET NULL' },
    { table: 'games', column: 'bb_24s_official', rule: 'SET NULL' },
    { table: 'games', column: 'bb_scorer_member', rule: 'SET NULL' },
    { table: 'games', column: 'bb_timekeeper_member', rule: 'SET NULL' },
    { table: 'games', column: 'referee_member', rule: 'SET NULL' },
    { table: 'games', column: 'scoreboard_member', rule: 'SET NULL' },
    { table: 'games', column: 'scorer_member', rule: 'SET NULL' },
    { table: 'games', column: 'scorer_scoreboard_member', rule: 'SET NULL' },
    { table: 'identity_documents', column: 'uploaded_by', rule: 'SET NULL' },
    { table: 'referee_expenses', column: 'recorded_by', rule: 'SET NULL' },
    { table: 'registrations', column: 'member', rule: 'SET NULL' },
    { table: 'reports', column: 'reported_member', rule: 'SET NULL' },
    { table: 'reports', column: 'reporter', rule: 'SET NULL' },
    { table: 'reports', column: 'resolved_by', rule: 'SET NULL' },
    { table: 'scheduling_blocks', column: 'created_by', rule: 'SET NULL' },
    { table: 'scheduling_global_blocks', column: 'created_by', rule: 'SET NULL' },
    { table: 'signup_tokens', column: 'minted_by', rule: 'SET NULL' },
    { table: 'team_links', column: 'created_by', rule: 'SET NULL' },
    { table: 'teams', column: 'captain', rule: 'SET NULL' },
    { table: 'user_logs', column: 'user', rule: 'SET NULL' },
  ],
  events: [
    { table: 'event_sessions', column: 'event', rule: 'CASCADE' },
    { table: 'event_signups', column: 'event', rule: 'CASCADE' },
    { table: 'events_members', column: 'events_id', rule: 'CASCADE' },
    { table: 'events_teams', column: 'events_id', rule: 'CASCADE' },
  ],
  games: [
    { table: 'game_guests', column: 'game', rule: 'CASCADE' },
    { table: 'game_guest_teams', column: 'game', rule: 'CASCADE' },
    { table: 'game_rosters', column: 'game', rule: 'CASCADE' },
    { table: 'referee_expenses', column: 'game', rule: 'SET NULL' },
  ],
  // No inbound FKs at all. That is correct, not an omission — everything that
  // depends on a training is polymorphic (participations / notifications /
  // activity chat), handled by the block below.
  trainings: [],
}

/** The only `:collection` values the routes accept. Anything else → 400. */
const ALLOWED_COLLECTIONS = Object.freeze(['members', 'events', 'games', 'trainings'])

/** `:collection` → the `activity_type` discriminator on the polymorphic tables. */
const ACTIVITY_TYPE = Object.freeze({ events: 'event', games: 'game', trainings: 'training' })

/**
 * Deletion notices are excluded from the notification purge by
 * `trg_activity_purge_polymorphic` (migration 246) — their body is
 * self-contained by design, so they survive the activity they describe.
 */
const NOTIFICATION_KEEP_TITLES = Object.freeze(['training_deleted', 'game_deleted', 'event_deleted'])

/**
 * The messaging system account (member 470, system@kscw.ch) is protected by the
 * BEFORE DELETE trigger `trg_messaging_protect_sentinel`. No FK scan can see
 * that, so it is checked explicitly or the delete would look permitted and then
 * fail at the database.
 */
const SENTINEL_EMAIL = 'system@kscw.ch'

/** Roles that may preview an impact / delete a member. Mirrors stats.js. */
const ADMIN_ROLES = Object.freeze(['admin', 'superuser', 'vb_admin', 'bb_admin'])

/**
 * Roles that make the TARGET off limits to anyone below a full admin.
 *
 * A sport admin deleting a board member or another admin is privilege
 * inversion: the deleted person's login goes with the row, so it is an account
 * takedown of someone who outranks the caller. Only a real Directus admin
 * (`accountability.admin`) or an app `admin`/`superuser` may do it, and even
 * they cannot delete themselves (below) — a self-delete logs the operator out
 * mid-flight and leaves the club one administrator short with no undo.
 */
const PRIVILEGED_TARGET_ROLES = Object.freeze([
  'admin', 'superuser', 'vorstand', 'vb_admin', 'bb_admin', 'finance',
])

export function registerDeleteImpact(router, { database, logger, services, getSchema }) {
  const log = logger.child({ endpoint: 'delete-impact' })

  // ── Auth ───────────────────────────────────────────────────────────────
  // Verbatim the gate from stats.js (admin | superuser | vb_admin | bb_admin),
  // NOT audit.js's superuser-only gate: sport admins run the Data Explorer.
  // Also stashes the resolved member + roles on the request so the mutating
  // route can re-check sport scope without a second lookup.
  async function requireAdmin(req, res, next) {
    if (!req.accountability?.user) {
      return res.status(401).json({ error: 'Authentication required' })
    }
    try {
      if (req.accountability.admin === true) {
        req.kscwActor = { member: null, roles: [], directusAdmin: true }
        return next()
      }

      const member = await database('members')
        .where({ user: req.accountability.user })
        .first()

      const roles = parseRoles(member?.role)
      if (!roles.some((r) => ADMIN_ROLES.includes(r))) {
        return res.status(403).json({ error: 'Admin access required' })
      }
      req.kscwActor = { member, roles, directusAdmin: false }
      next()
    } catch (err) {
      log.error(`delete-impact auth check failed: ${err.message}`)
      return res.status(500).json({ error: 'Auth check failed' })
    }
  }

  function parseRoles(raw) {
    if (!raw) return []
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
      return Array.isArray(parsed) ? parsed.map(String) : []
    } catch {
      return []
    }
  }

  /** Positive-integer id parse. Returns null for anything else. */
  function parseId(raw) {
    if (typeof raw !== 'string' && typeof raw !== 'number') return null
    const s = String(raw).trim()
    if (!/^\d+$/.test(s)) return null
    const n = Number(s)
    if (!Number.isSafeInteger(n) || n <= 0) return null
    return n
  }

  /**
   * Which of the FK-map tables actually exist on this database.
   *
   * dev/prod can drift by a migration, and one missing table would otherwise
   * fail the whole UNION ALL and turn the preview into a 500 — which, because
   * the UI blocks deleting on a failed preview, would look like "delete is
   * broken" rather than "one count is unavailable".
   */
  async function existingTables(names) {
    if (names.length === 0) return new Set()
    const rows = await database('information_schema.tables')
      .where('table_schema', 'public')
      .whereIn('table_name', names)
      .select('table_name')
    return new Set(rows.map((r) => r.table_name))
  }

  /**
   * Count every FK edge in ONE round trip.
   *
   * `members` fans out to ~70 counts; issuing them separately is 70 round
   * trips against a database where `user_logs` alone holds 400k+ rows. The
   * identifiers are bound with knex's `??` placeholder and originate from
   * FK_MAP only, never from the request.
   */
  async function countEdges(edges, id) {
    if (edges.length === 0) return []
    const present = await existingTables([...new Set(edges.map((e) => e.table))])
    const live = edges.filter((e) => present.has(e.table))
    if (live.length === 0) return []

    const sql = live
      .map(() => 'SELECT CAST(? AS text) AS tbl, CAST(? AS text) AS col, COUNT(*)::int AS n FROM ?? WHERE ?? = ?')
      .join(' UNION ALL ')
    const bindings = []
    for (const e of live) bindings.push(e.table, e.column, e.table, e.column, id)

    const result = await database.raw(sql, bindings)
    const rows = result?.rows ?? []
    const byKey = new Map(rows.map((r) => [`${r.tbl}.${r.col}`, Number(r.n) || 0]))
    return live.map((e) => ({ ...e, count: byKey.get(`${e.table}.${e.column}`) ?? 0 }))
  }

  /**
   * Rows that hang off an activity by (activity_type, activity_id) instead of a
   * foreign key — invisible to any FK scan.
   *
   * `participations` + `notifications` are removed by
   * `trg_{events,games,trainings}_0_purge_polymorphic` (migration 246).
   * The activity chat is NOT: `fn_activity_chat_event_delete` (migration 017)
   * only exists on `events`, so a game's or training's chat is left ORPHANED.
   */
  async function countPolymorphic(collection, id) {
    const type = ACTIVITY_TYPE[collection]
    if (!type) return []
    const idText = String(id)

    const [participations, notifications, conversations] = await Promise.all([
      database('participations')
        .where({ activity_type: type, activity_id: idText })
        .count({ n: '*' })
        .first(),
      database('notifications')
        .where({ activity_type: type, activity_id: idText })
        .whereNotIn('title', NOTIFICATION_KEEP_TITLES)
        .count({ n: '*' })
        .first(),
      // conversations.activity_id is an INTEGER column (participations and
      // notifications hold it as text) — bind the number, not the string.
      database('conversations')
        .where({ type: 'activity_chat', activity_type: type, activity_id: id })
        .count({ n: '*' })
        .first(),
    ])

    return [
      { table: 'participations', column: null, rule: 'TRIGGER_DELETE', count: Number(participations?.n) || 0 },
      { table: 'notifications', column: null, rule: 'TRIGGER_DELETE', count: Number(notifications?.n) || 0 },
      {
        table: 'conversations',
        column: null,
        rule: collection === 'events' ? 'TRIGGER_DELETE' : 'ORPHANED',
        count: Number(conversations?.n) || 0,
      },
    ]
  }

  // ── GET /kscw/admin/delete-impact/:collection/:id ───────────────────────

  router.get('/admin/delete-impact/:collection/:id', requireAdmin, async (req, res) => {
    // Allow-listed BEFORE anything touches SQL. `collection` never reaches a
    // query builder as an identifier — it only selects a static FK_MAP entry.
    const collection = String(req.params.collection || '')
    if (!ALLOWED_COLLECTIONS.includes(collection)) {
      return res.status(400).json({ error: 'Unsupported collection' })
    }
    const id = parseId(req.params.id)
    if (id === null) {
      return res.status(400).json({ error: 'Invalid id' })
    }

    try {
      const record = await database(collection).where({ id }).first('id')
      if (!record) return res.status(404).json({ error: 'Record not found' })

      // Same sport boundary as the delete. The preview is not "read only" in
      // the harmless sense — it names the target's linked login account — so a
      // vb_admin must not be able to run it against a basketball member.
      if (collection === 'members' && (await sportScopeError(req.kscwActor, id))) {
        return res.status(403).json({ error: 'scope' })
      }

      const [edgeCounts, polymorphic] = await Promise.all([
        countEdges(FK_MAP[collection], id),
        countPolymorphic(collection, id),
      ])

      const blockers = []
      const cascade = []
      const setNull = []

      for (const e of edgeCounts) {
        if (e.count <= 0) continue
        const row = { table: e.table, column: e.column, rule: e.rule, count: e.count }
        if (e.rule === 'RESTRICT') blockers.push({ kind: 'restrict', table: e.table, column: e.column, count: e.count })
        else if (e.rule === 'CASCADE') cascade.push(row)
        else setNull.push(row)
      }

      // members-only extras: the protected sentinel + the linked login.
      let linkedUser = null
      if (collection === 'members') {
        const member = await database('members').where({ id }).first('id', 'user', 'email')
        if (String(member?.email || '').trim().toLowerCase() === SENTINEL_EMAIL) {
          blockers.push({ kind: 'sentinel', table: 'members' })
        }
        if (member?.user) {
          const u = await database('directus_users').where({ id: member.user }).first('id', 'email', 'status')
          if (u) linkedUser = { id: String(u.id), email: u.email ?? null, status: u.status ?? null }
        }
      }

      // A derby is stored as TWO `games` rows sharing one `game_id` (one per
      // club team). Deleting one row deletes half the fixture — the sibling
      // survives, and the operator has to be told.
      let derbySiblings = 0
      if (collection === 'games') {
        const g = await database('games').where({ id }).first('game_id')
        if (g?.game_id) {
          const sib = await database('games')
            .where({ game_id: g.game_id })
            .whereNot({ id })
            .count({ n: '*' })
            .first()
          derbySiblings = Number(sib?.n) || 0
        }
      }

      const visible = [...cascade, ...setNull, ...polymorphic.filter((p) => p.count > 0)]
      const total =
        visible.reduce((sum, r) => sum + r.count, 0) +
        blockers.reduce((sum, b) => sum + (b.count || 0), 0)

      return res.json({
        collection,
        id,
        blockers,
        cascade,
        setNull,
        polymorphic: polymorphic.filter((p) => p.count > 0),
        linkedUser,
        derbySiblings,
        total,
      })
    } catch (err) {
      log.error(`delete-impact ${collection}/${id} failed: ${err.message}`)
      return res.status(500).json({ error: 'Internal error' })
    }
  })

  // ── Sport scope (server side) ──────────────────────────────────────────
  //
  // Mirrors the client-side resolver in src/modules/admin/components/
  // memberSport.ts exactly: teams first (a coach has NO roster row, so a
  // player-only join wrongly reports "no team"), then sektion, then the fee
  // category prefix. Anything club-level or unknown resolves to 'both' and is
  // allowed — hiding a real member behind an unknowable scope is worse than
  // letting a sport admin see a club-level record.
  async function resolveMemberSport(memberId) {
    const [playerRows, coachRows, trRows] = await Promise.all([
      database('member_teams').where({ member: memberId }).select('team'),
      database('teams_coaches').where({ members_id: memberId }).select('teams_id'),
      database('teams_responsibles').where({ members_id: memberId }).select('teams_id'),
    ])
    const teamIds = [
      ...playerRows.map((r) => r.team),
      ...coachRows.map((r) => r.teams_id),
      ...trRows.map((r) => r.teams_id),
    ].filter((v) => v !== null && v !== undefined)

    if (teamIds.length > 0) {
      // ⚠ Team NAMES lie ("Herren 2 H3" is basketball). Only teams.sport counts.
      const teams = await database('teams').whereIn('id', [...new Set(teamIds)]).select('sport')
      const sports = new Set(
        teams.map((t) => String(t.sport || '').toLowerCase()).filter((s) => s === 'volleyball' || s === 'basketball'),
      )
      if (sports.size > 1) return 'both'
      if (sports.size === 1) return [...sports][0]
    }

    const member = await database('members').where({ id: memberId }).first('sektion', 'beitragskategorie')
    const sektion = String(member?.sektion || '').trim().toLowerCase()
    if (sektion === 'volleyball') return 'volleyball'
    if (sektion === 'basketball') return 'basketball'
    // 'kscw' and everything else falls through.

    const kat = String(member?.beitragskategorie || '').trim().toLowerCase()
    if (kat.startsWith('vb ')) return 'volleyball'
    if (kat.startsWith('bb ')) return 'basketball'

    return 'both'
  }

  /** A full app admin: bypasses sport scope and may act on privileged targets. */
  function isFullAdmin(actor) {
    const roles = actor?.roles || []
    return actor?.directusAdmin === true || roles.includes('admin') || roles.includes('superuser')
  }

  /**
   * Sport scope for a `members` target — `'scope'` when the caller is confined
   * to the other section, otherwise null.
   *
   * A pure vb_admin / bb_admin may only touch members inside their own section.
   * A dual sport admin (both flags) and every full admin are unconfined. Used by
   * BOTH routes: a preview leaks the target's linked login email, so it needs
   * the same boundary as the delete.
   */
  async function sportScopeError(actor, memberId) {
    if (isFullAdmin(actor)) return null
    const roles = actor?.roles || []
    const vb = roles.includes('vb_admin')
    const bb = roles.includes('bb_admin')
    if (vb === bb) return null
    const mine = vb ? 'volleyball' : 'basketball'
    const targetSport = await resolveMemberSport(memberId)
    if (targetSport !== 'both' && targetSport !== mine) return 'scope'
    return null
  }

  /**
   * Rank guard — `'self'`, `'privileged'`, or null.
   *
   * Self is matched on the LINKED DIRECTUS USER, not on the member id: that is
   * the one identity every caller has, including a Directus admin who has no
   * `members` row of their own.
   */
  function rankError(req, actor, member) {
    if (member?.user && String(member.user) === String(req.accountability?.user)) return 'self'
    const targetRoles = parseRoles(member?.role)
    if (targetRoles.some((r) => PRIVILEGED_TARGET_ROLES.includes(r)) && !isFullAdmin(actor)) {
      return 'privileged'
    }
    return null
  }

  /** The referencing table out of a Postgres FK-violation message, or null. */
  function parseRestrictTable(message) {
    const text = String(message || '')
    // 'update or delete on table "members" violates foreign key constraint
    //  "finance_expenses_member_foreign" on table "finance_expenses"'
    // The LAST `on table "X"` is the referencing (blocking) table.
    const matches = [...text.matchAll(/on table "([^"]+)"/g)]
    if (matches.length > 0) return matches[matches.length - 1][1]
    return null
  }

  function isRestrictViolation(err) {
    const text = [err?.message, err?.cause?.message, err?.parent?.message, err?.detail]
      .filter(Boolean)
      .join(' | ')
    return /violates foreign key constraint|update or delete on table/i.test(text) || err?.code === '23503'
  }

  function pgMessage(err) {
    return String(err?.parent?.message || err?.cause?.message || err?.message || '')
  }

  /**
   * How many rows in `table` still point at this member across its RESTRICT
   * columns. Returns null when the table is unknown.
   *
   * The table name arrives from a Postgres error string, so it is resolved
   * against FK_MAP before touching SQL — an unmatched name is dropped rather
   * than interpolated. Same rule as everywhere else in this file: identifiers
   * come from the static map only.
   */
  async function countRestrictRows(table, memberId) {
    if (!table) return null
    const columns = FK_MAP.members
      .filter((e) => e.rule === 'RESTRICT' && e.table === table)
      .map((e) => e.column)
    if (columns.length === 0) return null
    try {
      const rows = await countEdges(columns.map((column) => ({ table, column, rule: 'RESTRICT' })), memberId)
      return rows.reduce((sum, r) => sum + r.count, 0)
    } catch (err) {
      log.warn(`delete-member: blocking-row count for ${table} failed: ${err.message}`)
      return null
    }
  }

  // ── POST /kscw/admin/delete-member ─────────────────────────────────────

  router.post('/admin/delete-member', requireAdmin, async (req, res) => {
    const memberId = parseId(req.body?.member_id)
    if (memberId === null) {
      return res.status(400).json({ error: 'Invalid id' })
    }

    try {
      const member = await database('members').where({ id: memberId }).first('id', 'user', 'email', 'role')
      if (!member) return res.status(404).json({ error: 'Record not found' })

      // ── The boundaries. `requireAdmin` has already checked the ROLE; these
      // two check the TARGET. There is no policy row behind either of them —
      // the items API refuses `members.delete` for everyone below a Directus
      // admin — so this is the whole gate, and it runs before anything is
      // destroyed.
      const actor = req.kscwActor || {}

      // 1. Sport scope — a pure vb_admin / bb_admin stays in their own section.
      if (await sportScopeError(actor, memberId)) {
        return res.status(403).json({ error: 'scope' })
      }
      // 2. Rank — nobody deletes themselves, and only a full admin may delete a
      //    board member or another admin (their login goes with the row).
      const rank = rankError(req, actor, member)
      if (rank) return res.status(403).json({ error: rank })

      const linkedUserId = member.user || null
      const schema = await getSchema()
      const { ItemsService, UsersService } = services

      // Caller's identity, escalated permissions. `members.delete` is withheld
      // from the KSCW Sport Admin policy on purpose — that is what stops a bare
      // `DELETE /items/members/:id` from skipping the three checks above — so
      // the service has to be told to bypass it here. `accountability.user` is
      // kept, so Directus still files its revision/activity against the real
      // actor rather than "system".
      const membersService = new ItemsService('members', {
        schema,
        knex: database,
        accountability: { ...req.accountability, admin: true },
      })

      try {
        await membersService.deleteOne(memberId)
      } catch (err) {
        if (isRestrictViolation(err)) {
          const message = pgMessage(err)
          const table = parseRestrictTable(message)
          log.warn(`delete-member ${memberId} blocked by RESTRICT: ${message}`)
          // Count the blocking rows here rather than leaving the UI to guess.
          // This path is reached when a row was created BETWEEN the preview and
          // the delete, so the client's cached preview has a stale count (zero)
          // for this table — and "0 rows must be removed first" is worse than
          // no number at all. `table` is matched against FK_MAP, never used as
          // an identifier straight off the error string.
          const count = await countRestrictRows(table, memberId)
          return res.status(409).json({ error: 'restrict', message, table, count })
        }
        throw err
      }

      // Not FK-linked, so nothing cascades it — this path is the only cleanup.
      // Run it AFTER the delete lands: on a RESTRICT block above the member is
      // still alive and must keep any pending email verification.
      //
      // ⚠ The table is keyed on the ADDRESS, not on the member, and siblings
      // share one family address all over this club. Deleting the row blind
      // would cancel the brother's pending verification, so it only runs once
      // no other member holds that address.
      if (member.email) {
        try {
          const sibling = await database('members').where('email', member.email).first('id')
          if (sibling) {
            log.info(`delete-member ${memberId}: email_verifications kept — ${sibling.id} shares the address`)
          } else {
            await database('email_verifications').where('email', member.email).delete()
          }
        } catch (err) {
          log.warn(`delete-member ${memberId}: email_verifications cleanup failed: ${err.message}`)
        }
      }

      // The linked login. The `members.items.delete` hook (kscw-hooks §0c)
      // normally has it already — but that is an un-awaited action hook, so
      // "normally" is not a guarantee. Re-read the row: gone means done, still
      // there means delete it here, and a FAILURE is reported rather than
      // swallowed, because an account that can still authenticate after its
      // member row is gone must never be a silent outcome.
      let userDeleted = false
      let warning = null
      if (linkedUserId) {
        try {
          const stillThere = await database('directus_users').where({ id: linkedUserId }).first('id')
          if (!stillThere) {
            userDeleted = true
          } else {
            const adminUsersService = new UsersService({
              schema,
              knex: database,
              accountability: { admin: true },
            })
            await adminUsersService.deleteOne(linkedUserId)
            userDeleted = true
          }
        } catch (userErr) {
          warning = `The member was deleted but the login account could not be removed (${linkedUserId}). Delete it in Directus.`
          log.warn(`delete-member ${memberId}: user delete failed for ${linkedUserId}: ${userErr.message}`)
        }
      }

      await writeUserLog(database, log, {
        accountability: req.accountability,
        action: 'delete',
        collection: 'members',
        recordId: String(memberId),
        data: { email: member.email ?? null, user: linkedUserId },
      })

      log.info(`Member ${memberId} deleted${linkedUserId ? ` (user ${linkedUserId}, removed: ${userDeleted})` : ''}`)

      const payload = { success: true, deleted_member: memberId, user_deleted: userDeleted }
      if (warning) payload.warning = warning
      return res.json(payload)
    } catch (err) {
      log.error(`delete-member ${memberId} failed: ${err.message}`)
      // Directus surfaces its own policy denial as a 403 — pass that through so
      // the operator sees "not allowed" instead of a generic server error.
      const status = err?.status === 403 ? 403 : 500
      return res.status(status).json({ error: status === 403 ? 'Forbidden' : 'Internal error' })
    }
  })
}
