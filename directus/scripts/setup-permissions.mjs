/**
 * KSCW Directus 11 Hybrid Permission Setup
 *
 * SOURCE OF TRUTH (read this before editing):
 *   The numbered SQL migrations in `directus/scripts/0NN-*.sql` are the source
 *   of truth for the LIVE permissions on dev + prod. This file is the
 *   fresh-install snapshot — it must reproduce the same end-state when
 *   bootstrapping a brand-new Directus instance from zero.
 *
 *   When you change permissions:
 *     1. Write a new SQL migration (NN+1) that mutates live perms idempotently.
 *     2. Apply it on dev, then prod.
 *     3. Update this file to match the new end-state. Otherwise the next
 *        run of `setup-permissions.mjs` (during a DR rebuild, fresh dev env,
 *        or onboarding) will silently roll back security hardening.
 *   That bidirectional contract is enforced by reviewers — see PERMISSIONS.md.
 *
 * Reflects state through migration 043 (2026-05-06). Audit history:
 *   023 messaging RBAC scoping        024 PII fields off cross-member read
 *   025 feedback status lock          026 coach team-scoped writes
 *   027 sport admin delete lock       028 auto-action markers
 *   029 messaging self-read fields    030 members.read field gaps
 *   031 spielplaner_assignments       032 trainings team-scoping
 *   033 member-read team-scoping      034 spielplaner_assignments.read
 *   035 second-pass audit             036 third-pass audit
 *   037 junction cascade pass 2       038-039 absence override
 *   040 excluded_guest_levels         041 team-dashboard prefs
 *   042 blocks + spielplaner perms    043 security hardening pass
 *
 * Directus 11 model: Roles → Policies → Permissions
 *   1. Ensure roles exist (rename old names if needed)
 *   2. Create/find access policies (one per role tier)
 *   3. Attach policies to roles
 *   4. Create permissions on each policy
 *
 * Roles: Administrator, Superuser (admin_access), Sport Admin, Vorstand, Team Responsible, Member, Public
 *
 * Usage:
 *   DIRECTUS_URL=https://directus-dev.kscw.ch ADMIN_EMAIL=admin@kscw.ch ADMIN_PASSWORD=<password> node directus/scripts/setup-permissions.mjs
 *   # Or with static token:
 *   DIRECTUS_URL=https://directus-dev.kscw.ch DIRECTUS_TOKEN=<token> node directus/scripts/setup-permissions.mjs
 */

// Auto-load .env.local (gitignored) so callers can keep dev/prod tokens
// out of the npm script string. Resolution order for the token:
//   1. DIRECTUS_TOKEN (explicit override)
//   2. DIRECTUS_DEV_TOKEN  (used when DIRECTUS_URL points at dev)
//   3. DIRECTUS_PROD_TOKEN (used when DIRECTUS_URL points at prod)
//   4. ADMIN_EMAIL + ADMIN_PASSWORD (fallback — login to obtain a token)
import { readFileSync as _readFileSync } from 'node:fs'
import { fileURLToPath as _fileURLToPath } from 'node:url'
import { dirname as _dirname, join as _join } from 'node:path'
const _here = _dirname(_fileURLToPath(import.meta.url))
try {
  const envText = _readFileSync(_join(_here, '../../.env.local'), 'utf-8')
  for (const line of envText.split('\n')) {
    // Accept optional `export ` prefix + whitespace around `=` so shell-style
    // .env files (`export DIRECTUS_DEV_TOKEN=…`) load correctly, not just bare KEY=value.
    const m = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '')
  }
} catch { /* file missing — fine */ }

const DIRECTUS_URL = process.env.DIRECTUS_URL || 'http://localhost:8055'
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@kscw.ch'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || ''
const ADMIN_PASSWORD_CLEAN = ADMIN_PASSWORD.replace(/\\!/g, '!')
const STATIC_TOKEN = process.env.DIRECTUS_TOKEN
  || (DIRECTUS_URL.includes('directus-dev') ? process.env.DIRECTUS_DEV_TOKEN : '')
  || (DIRECTUS_URL.includes('directus.kscw.ch') ? process.env.DIRECTUS_PROD_TOKEN : '')
  || ''
if (!STATIC_TOKEN && !ADMIN_PASSWORD) {
  console.error('Need DIRECTUS_TOKEN, DIRECTUS_DEV_TOKEN, DIRECTUS_PROD_TOKEN, or ADMIN_PASSWORD to authenticate')
  process.exit(1)
}

let token = null
let stats = { ok: 0, err: 0 }

async function auth() {
  if (STATIC_TOKEN) {
    token = STATIC_TOKEN
    // Verify token works
    const res = await fetch(`${DIRECTUS_URL}/server/info`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) return
    console.log('  Static token invalid, falling back to password auth...')
  }
  const res = await fetch(`${DIRECTUS_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD_CLEAN }),
  })
  if (!res.ok) {
    throw new Error(`Auth failed: ${res.status} — check ADMIN_EMAIL and ADMIN_PASSWORD`)
  }
  const { data } = await res.json()
  token = data.access_token
}

async function api(method, path, body) {
  const res = await fetch(`${DIRECTUS_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await res.text()
  if (!res.ok) {
    if (text.includes('already exists') || text.includes('RECORD_NOT_UNIQUE')) return null
    throw new Error(`${method} ${path}: ${res.status} ${text.slice(0, 300)}`)
  }
  return text ? JSON.parse(text).data : null
}

// ── Role Definitions ───��─────────────────────────────────────────

const ROLE_DEFS = [
  { name: 'Administrator', icon: 'shield', description: 'Built-in Directus admin' },
  { name: 'Superuser', icon: 'security', description: 'Full system access (superuser + admin members)' },
  { name: 'Sport Admin', icon: 'sports', description: 'Sport-scoped admin (vb_admin / bb_admin)' },
  { name: 'Vorstand', icon: 'groups', description: 'Board member — read-all access' },
  { name: 'Team Responsible', icon: 'supervisor_account', description: 'Coach or team responsible' },
  { name: 'Member', icon: 'person', description: 'Default authenticated member' },
]

// Old role names → new names
const RENAME_MAP = { Coach: 'Team Responsible', 'Team Responsible': 'Team Responsible', Admin: 'Sport Admin' }

async function ensureRoles() {
  const existing = await api('GET', '/roles?limit=-1')

  for (const def of ROLE_DEFS) {
    const match = existing.find(r => r.name === def.name)
    if (match) {
      await api('PATCH', `/roles/${match.id}`, { icon: def.icon, description: def.description })
      console.log(`  ✓ "${def.name}" exists (${match.id})`)
    } else {
      const oldName = Object.entries(RENAME_MAP).find(([, v]) => v === def.name)?.[0]
      const oldMatch = oldName ? existing.find(r => r.name === oldName) : null
      if (oldMatch) {
        await api('PATCH', `/roles/${oldMatch.id}`, def)
        console.log(`  ✓ "${oldName}" → "${def.name}" (${oldMatch.id})`)
      } else {
        const created = await api('POST', '/roles', def)
        console.log(`  ��� "${def.name}" created (${created.id})`)
      }
    }
  }

  // Return fresh role map
  const roles = await api('GET', '/roles?limit=-1')
  return Object.fromEntries(roles.map(r => [r.name, r.id]))
}

// ── Policy Helpers ──────────���────────────────────────────────────

async function findOrCreatePolicy(name, opts = {}) {
  const existing = await api('GET', '/policies?limit=-1')
  const found = existing.find(p => p.name === name)
  if (found) return found.id

  const policy = await api('POST', '/policies', {
    name,
    icon: opts.icon || 'shield',
    admin_access: opts.admin_access || false,
    app_access: opts.app_access !== false,
  })
  return policy.id
}

async function attachPolicyToRole(roleId, policyId) {
  try {
    // Idempotent: directus_access has no unique (role,policy) constraint, so a
    // bare POST every run accreted duplicate role-access rows. Skip if present.
    const existing = await api('GET', `/access?filter[role][_eq]=${roleId}&filter[policy][_eq]=${policyId}&filter[user][_null]=true&fields=id&limit=1`)
    if (existing && existing.length > 0) return
    await api('POST', '/access', { role: roleId, policy: policyId })
  } catch (e) {
    if (!e.message.includes('RECORD_NOT_UNIQUE')) {
      console.warn(`  ⚠ attach policy: ${e.message.slice(0, 80)}`)
    }
  }
}

/**
 * Fully remove a legacy/orphan policy by name: detach it from every role/user
 * (directus_access), delete its permission rows, then delete the policy.
 * Idempotent — a no-op once the policy is gone. Used to retire the old
 * "KSCW Coach" policy after folding its unique grants into Team Responsible.
 */
async function deleteLegacyPolicy(name) {
  const policies = await api('GET', '/policies?limit=-1')
  const matches = (policies || []).filter(p => p.name === name)
  if (matches.length === 0) {
    console.log(`  (legacy policy "${name}" already absent — nothing to delete)`)
    return
  }
  for (const p of matches) {
    const access = await api('GET', `/access?filter[policy][_eq]=${p.id}&fields=id&limit=-1`)
    for (const a of (access || [])) await api('DELETE', `/access/${a.id}`)
    const perms = await api('GET', `/permissions?filter[policy][_eq]=${p.id}&fields=id&limit=-1`)
    for (const perm of (perms || [])) await api('DELETE', `/permissions/${perm.id}`)
    await api('DELETE', `/policies/${p.id}`)
    console.log(`  ✓ Deleted legacy policy "${name}" (${p.id}): ${(access || []).length} access row(s) + ${(perms || []).length} permission(s)`)
  }
}

// ── Permission Helpers ────────────��──────────────────────────────

async function setPerm(policyId, collection, action, filter = null, fields = null) {
  const body = {
    policy: policyId,
    collection,
    action,
    fields: fields || ['*'],
  }
  if (filter) body.permissions = filter
  // NOTE: Directus enforces neither `permissions` nor a relational `validation`
  // filter usefully on CREATE — `permissions` has no existing row to match, and
  // a relational `validation` (e.g. member.user == $CURRENT_USER) can't be
  // resolved against the payload, so it rejects ALL creates (verified on dev
  // 2026-05-31). Self-scoped CREATE ownership is therefore enforced in the
  // kscw-hooks `*.items.create` filter guard, not here. The `permissions`
  // filter above still scopes READ/UPDATE/DELETE for these collections.

  try {
    await api('POST', '/permissions', body)
    stats.ok++
  } catch (e) {
    if (e.message.includes('RECORD_NOT_UNIQUE')) {
      stats.ok++
    } else {
      console.error(`    ✗ ${collection}.${action}: ${e.message.slice(0, 120)}`)
      stats.err++
    }
  }
}

async function setPermRead(policyId, collection, filter = null, fields = null) {
  return setPerm(policyId, collection, 'read', filter, fields)
}

async function setPermCRUD(policyId, collection, filter = null) {
  await setPerm(policyId, collection, 'create', filter)
  await setPerm(policyId, collection, 'read', filter)
  await setPerm(policyId, collection, 'update', filter)
  await setPerm(policyId, collection, 'delete', filter)
}

/**
 * Delete all existing permissions for a policy (for idempotent re-runs)
 */
async function clearPolicyPermissions(policyId, policyName) {
  const perms = await api('GET', `/permissions?filter[policy][_eq]=${policyId}&limit=-1`)
  if (!perms || perms.length === 0) return
  for (const p of perms) {
    await api('DELETE', `/permissions/${p.id}`)
  }
  console.log(`  Cleared ${perms.length} old permissions from "${policyName}"`)
}

// ── Filter Shorthands ──────��─────────────────────────────────────

/** member.user = $CURRENT_USER */
const OWN_MEMBER = { member: { user: { _eq: '$CURRENT_USER' } } }

/** user = $CURRENT_USER (members table) */
const OWN_USER = { user: { _eq: '$CURRENT_USER' } }

/**
 * user_logs.user is an INTEGER FK to members.id, NOT a UUID FK to
 * directus_users. The naive `{ user: { _eq: '$CURRENT_USER' } }` filter
 * tries to compare an int to the caller's UUID and Postgres throws
 * "Invalid numeric value" (see CHANGELOG v4.4.8). The correct path
 * traverses one more level: user_logs → members → directus_users.
 */
const OWN_DU = { user: { user: { _eq: '$CURRENT_USER' } } }

/** from_member or to_member is current user */
const OWN_DELEGATION = {
  _or: [
    { from_member: { user: { _eq: '$CURRENT_USER' } } },
    { to_member: { user: { _eq: '$CURRENT_USER' } } },
  ],
}

/**
 * from_member is current user — used to scope scorer_delegations CREATE so a
 * member can only delegate their own duty (not fabricate a delegation FROM a
 * teammate). 2026-05-31 security audit.
 */
const OWN_DELEGATION_FROM = { from_member: { user: { _eq: '$CURRENT_USER' } } }

/** driver = current user */
const OWN_DRIVER = { driver: { user: { _eq: '$CURRENT_USER' } } }

/** passenger = current user */
const OWN_PASSENGER = { passenger: { user: { _eq: '$CURRENT_USER' } } }

/**
 * Fields visible to regular members when reading OTHER members.
 * Migration 024 explicitly removed `email` + `phone` from this set — they
 * leak across the whole club. Self-read covers them via MEMBER_OWN_READABLE.
 * Migration 030 added `kscw_membership_active`, `shell`, `shell_expires`.
 */
const MEMBER_VISIBLE_FIELDS = [
  'id', 'first_name', 'last_name', 'photo', 'number',
  'position', 'licences', 'user',
  // 2026-05-20 migration 067: licences (json) is being split into six booleans.
  // Both forms are listed during the dual-read window. Migration 069 drops
  // 'licences' (the json column) and this line should drop with it.
  'scorer_vb', 'referee_vb', 'otr1_bb', 'otr2_bb', 'otn_bb', 'referee_bb',
  'coach_approved_team', 'role', 'language',
  'requested_team', 'birthdate_visibility', 'hide_phone', 'hide_email',
  'license_nr', 'sex', 'licence_category', 'licence_activated', 'licence_validated',
  'kscw_membership_active', 'shell', 'shell_expires',
  // 2026-05-12: needed by /teams/* coach-approval queries (sort/filter on
  // date_created) and /absences (member_teams o2m used to scope absences).
  'date_created', 'member_teams',
]

/** Fields a member can update on their own profile */
const MEMBER_EDITABLE_FIELDS = [
  'first_name', 'last_name', 'phone', 'birthdate', 'email',
  'birthdate_visibility', 'hide_phone', 'hide_email', 'photo', 'language',
  'position', 'number', 'licences', 'website_visible',
  // 2026-05-20 migration 067: see MEMBER_VISIBLE_FIELDS comment above.
  'scorer_vb', 'referee_vb', 'otr1_bb', 'otr2_bb', 'otn_bb', 'referee_bb',
  'requested_team',
  // ClubDesk personal data fields
  'anrede', 'adresse', 'plz', 'ort', 'nationalitaet', 'sex', 'ahv_nummer',
  // 2026-06-01 migration 077: per-member auto-confirm RSVP opt-in (profile toggles)
  'auto_confirm_trainings', 'auto_confirm_games', 'auto_confirm_events',
]

/** Public fields for teams */
const PUBLIC_TEAM_FIELDS = [
  'id', 'name', 'full_name', 'sport', 'league', 'season', 'team_picture',
  'team_picture_pos', 'active', 'social_url', 'color', 'coach', 'captain',
  'team_responsible', 'sponsors',
  // Exposed so the kscw-website contact form can filter the team dropdown to
  // recruiting teams only. Boolean flag, no PII.
  'open_for_players',
  // Positions the team is recruiting for — shown next to the "Get in touch"
  // CTA on the public team page. Array of position keys, no PII.
  'recruiting_positions',
]

/** Coach Dashboard prefs — readable by Coach/Team Responsible/Admin via an explicit read row. NOT added to PUBLIC_TEAM_FIELDS. */
const LEADER_TEAM_DASHBOARD_FIELDS = [
  'dashboard_range_from',
  'dashboard_range_to',
  'dashboard_league_only',
]

/** Public fields for games */
const PUBLIC_GAME_FIELDS = [
  'id', 'date', 'time', 'home_team', 'away_team', 'home_score', 'away_score',
  'sets_json', 'league', 'round', 'season', 'kscw_team', 'status', 'source',
  'game_id', 'hall', 'type',
]

/**
 * Public fields for events — the kscw-website homepage + /weiteres/kalender
 * read these unauthenticated. Only the event record itself (non-PII).
 * The RSVP data (participations / events_teams) stays NON-public — migration
 * 035 locked those down for privacy and they remain removed below.
 */
const PUBLIC_EVENT_FIELDS = [
  'id', 'title', 'event_type', 'start_date', 'end_date', 'all_day',
  'location', 'description', 'signup_url', 'cancelled',
]

/** Public fields for news — kscw-website homepage + /news read these. */
const PUBLIC_NEWS_FIELDS = [
  'id', 'title', 'title_en', 'slug', 'excerpt', 'body', 'category',
  'author', 'published_at', 'image', 'date_created',
]

// ── Main ──────────────────────────────────��──────────────────────

async function main() {
  console.log(`\n🔐 KSCW Directus 11 Hybrid Permission Setup → ${DIRECTUS_URL}\n`)
  await auth()

  // ── 1. Ensure roles ────────────────────────────────────────────

  console.log('1. Ensuring roles...')
  const roleMap = await ensureRoles()
  console.log('   Roles:', JSON.stringify(roleMap, null, 2))

  // ── 2. Create policies ───────���─────────────────────────────────

  console.log('\n2. Creating policies...')

  // Find built-in public policy
  const allPolicies = await api('GET', '/policies?limit=-1')
  const publicPolicy = allPolicies.find(p => p.name === '$t:public_label')
  const PUBLIC_POLICY = publicPolicy?.id
  console.log(`  Public policy: ${PUBLIC_POLICY || 'NOT FOUND — will create'}`)

  const MEMBER_POLICY = await findOrCreatePolicy('KSCW Member', { icon: 'person', app_access: true })
  const LEADER_POLICY = await findOrCreatePolicy('KSCW Team Responsible', { icon: 'supervisor_account', app_access: true })
  const VORSTAND_POLICY = await findOrCreatePolicy('KSCW Vorstand', { icon: 'groups', app_access: true })
  const SPORT_ADMIN_POLICY = await findOrCreatePolicy('KSCW Sport Admin', { icon: 'sports', app_access: true })
  const ADMIN_POLICY = await findOrCreatePolicy('KSCW Admin', { icon: 'admin_panel_settings', admin_access: true, app_access: true })
  // Terminplanung (opponent game-scheduling) admin access for club-wide
  // Spielplaner members. Distinct from the Member-role-attached "KSCW Spielplaner"
  // policy (which grants scoped manual-game CRUD to every member): this one is
  // attached only to the directus users of members with is_spielplaner=true
  // (backfilled in section 12), so the unfiltered game_scheduling perms below are
  // gated purely by who holds the policy.
  const TERMINPLANUNG_POLICY = await findOrCreatePolicy('KSCW Terminplanung', { icon: 'event_available', app_access: true })

  console.log(`  Member policy: ${MEMBER_POLICY}`)
  console.log(`  Team Responsible policy: ${LEADER_POLICY}`)
  console.log(`  Vorstand policy: ${VORSTAND_POLICY}`)
  console.log(`  Sport Admin policy: ${SPORT_ADMIN_POLICY}`)
  console.log(`  Admin policy: ${ADMIN_POLICY}`)

  // ���─ 3. Attach policies to roles ──────���─────────────────────────

  console.log('\n3. Attaching policies to roles...')

  // Member role → member policy
  await attachPolicyToRole(roleMap['Member'], MEMBER_POLICY)

  // Team Responsible → leader + member (inherits member permissions)
  await attachPolicyToRole(roleMap['Team Responsible'], LEADER_POLICY)
  await attachPolicyToRole(roleMap['Team Responsible'], MEMBER_POLICY)

  // Vorstand → vorstand + member
  await attachPolicyToRole(roleMap['Vorstand'], VORSTAND_POLICY)
  await attachPolicyToRole(roleMap['Vorstand'], MEMBER_POLICY)

  // Sport Admin → sport admin + leader + member (full chain)
  await attachPolicyToRole(roleMap['Sport Admin'], SPORT_ADMIN_POLICY)
  await attachPolicyToRole(roleMap['Sport Admin'], LEADER_POLICY)
  await attachPolicyToRole(roleMap['Sport Admin'], MEMBER_POLICY)

  // Superuser → admin policy (admin_access=true bypasses everything, but attach for consistency)
  await attachPolicyToRole(roleMap['Superuser'], ADMIN_POLICY)

  // Administrator → already has admin_access=true built-in
  console.log('  ✓ Done')

  // ── 4. Clear old permissions for idempotent re-run ─────────────

  console.log('\n4. Clearing old permissions...')
  if (PUBLIC_POLICY) await clearPolicyPermissions(PUBLIC_POLICY, 'Public')
  await clearPolicyPermissions(MEMBER_POLICY, 'Member')
  await clearPolicyPermissions(LEADER_POLICY, 'Team Responsible')
  await clearPolicyPermissions(VORSTAND_POLICY, 'Vorstand')
  await clearPolicyPermissions(SPORT_ADMIN_POLICY, 'Sport Admin')
  await clearPolicyPermissions(ADMIN_POLICY, 'Admin')
  await clearPolicyPermissions(TERMINPLANUNG_POLICY, 'Terminplanung')

  // ── 5. Public permissions ──────────────────────────────────────

  if (PUBLIC_POLICY) {
    console.log('\n5. Public (unauthenticated) permissions...')

    await setPermRead(PUBLIC_POLICY, 'teams', { active: { _eq: true } }, PUBLIC_TEAM_FIELDS)
    await setPermRead(PUBLIC_POLICY, 'games', null, PUBLIC_GAME_FIELDS)
    await setPermRead(PUBLIC_POLICY, 'rankings')
    await setPermRead(PUBLIC_POLICY, 'sponsors', { active: { _eq: true } })
    await setPermRead(PUBLIC_POLICY, 'scorer_courses', { active: { _eq: true } })

    // Events + news — kscw-website homepage and /weiteres/kalender read these.
    // Migration 035 wrongly assumed the website didn't consume `events` and
    // dropped the public read, which silently emptied the homepage events and
    // calendar; `news` was never granted at all (homepage News showed
    // "no news"). Re-added field-scoped, non-PII only. RSVP junctions
    // (participations / events_teams) stay NON-public — see calendar note below.
    // News is limited to published posts (published_at set, not future-dated).
    await setPermRead(PUBLIC_POLICY, 'events', null, PUBLIC_EVENT_FIELDS)
    await setPermRead(
      PUBLIC_POLICY, 'news',
      { _and: [{ published_at: { _nnull: true } }, { published_at: { _lte: '$NOW' } }] },
      PUBLIC_NEWS_FIELDS,
    )

    // Junction tables for deep queries (website needs coach names, sponsor logos)
    await setPermRead(PUBLIC_POLICY, 'teams_sponsors')
    await setPermRead(PUBLIC_POLICY, 'teams_coaches')  // coach junction
    // 2026-05-31 security audit: public members read was unfiltered, exposing
    // every member's name + photo regardless of their `website_visible` opt-out
    // (the privacy flag was only honoured by the kscw-website frontend, not at
    // the permission layer — the whole roster was anonymously enumerable). Scope
    // the public read to opt-in members only and keep the minimal field set.
    await setPermRead(PUBLIC_POLICY, 'members', { website_visible: { _eq: true } }, ['id', 'first_name', 'last_name', 'photo'])

    // Calendar: hall slots, closures, hall events, halls.
    // Migration 035 removed `slot_claims` from Public — internal hall booking
    // strategy isn't public. It also removed `events_teams` / `participations`
    // (every RSVP across the club was anonymously readable) — those stay
    // removed; only the event record itself is public (granted above).
    // Migration 032 removed `trainings` (per-team schedule, members-only).
    await setPermRead(PUBLIC_POLICY, 'hall_slots')
    await setPermRead(PUBLIC_POLICY, 'hall_slots_teams')  // M2M junction
    await setPermRead(PUBLIC_POLICY, 'hall_closures')
    await setPermRead(PUBLIC_POLICY, 'hall_events')
    await setPermRead(PUBLIC_POLICY, 'hall_events_halls')  // M2M junction
    await setPermRead(PUBLIC_POLICY, 'halls')

    // Feedback — public create (kscw-website form, validated by Turnstile hook)
    await setPerm(PUBLIC_POLICY, 'feedback', 'create', null,
      ['type', 'title', 'description', 'source', 'source_url', 'status', 'name', 'email', 'screenshot'])

    // Mixed tournament signups — public create (kscw-website form, validated by Turnstile hook)
    await setPerm(PUBLIC_POLICY, 'mixed_tournament_signups', 'create', null,
      ['name', 'email', 'sex', 'position_1', 'position_2', 'position_3', 'teams', 'notes', 'is_member', 'member_id'])

    // Files. 2026-05-31 security audit: anon could fetch ANY uploaded asset via
    // GET /assets/:id (e.g. feedback screenshots, which can contain a member's
    // authenticated screen / PII). /assets applies the file's row-level read
    // filter, so scope the public read to FOLDER-LESS files only: the public
    // site's team/member/sponsor/news images live at the root (no folder), while
    // sensitive uploads (feedback screenshots) are relocated into a private
    // folder by migration 074 + the kscw-hooks feedback hook. A folder
    // assignment therefore === private, and new private folders are excluded by
    // default (fail-safe). NB: anon /items/directus_files LISTING is denied
    // regardless (system-collection listing isn't granted to Public) — this
    // scopes the /assets read path, which is what actually leaked.
    await setPermRead(PUBLIC_POLICY, 'directus_files', { folder: { _null: true } })
    await setPerm(PUBLIC_POLICY, 'directus_files', 'create')

    console.log(`  ✓ Public permissions set`)
  } else {
    console.log('\n5. ⚠ No public policy found — skipping public permissions')
  }

  // ── 6. Member permissions ──────────────────────────────────────

  console.log('\n6. Member permissions...')

  // ── Unfiltered cross-club reads ─────────────────────────────
  // Truly directory-level info: club-public schedules and venue data.
  // Per migration 036, the M2M junctions (teams_coaches/teams_responsibles/
  // teams_sponsors / member_teams) stay open so the whole-club app can show
  // cross-team rosters. Member-level fields they expose are bounded by the
  // members.read field whitelist below.
  const MEMBER_READ_ALL = [
    'teams', 'games', 'rankings', 'sponsors',
    'event_sessions',
    'hall_slots', 'hall_closures', 'hall_events', 'hall_events_halls', 'halls', 'hall_slots_teams',
    'news', 'app_settings',
    'referee_expenses', 'carpools', 'carpool_passengers', 'polls',
    // Junctions
    'teams_coaches', 'teams_responsibles', 'teams_sponsors', 'events_teams', 'events_members',
    // Files
    'directus_files',
  ]
  for (const col of MEMBER_READ_ALL) {
    await setPermRead(MEMBER_POLICY, col)
  }

  // ── Team-scoped reads (migration 032 / 033) ─────────────────
  // trainings: only my teams. events: own + club-wide + my-teams + invited.
  // participations + absences: own + same-team. polls + referee_expenses
  // already covered above for cross-club but fine — those are team-scoped
  // by app navigation; they don't carry PII.
  const MY_TEAMS_FILTER = { team: { members: { member: { user: { _eq: '$CURRENT_USER' } } } } }
  await setPermRead(MEMBER_POLICY, 'trainings', MY_TEAMS_FILTER)

  const EVENTS_VISIBLE = {
    _or: [
      { created_by: { user: { _eq: '$CURRENT_USER' } } },
      { event_type: { _in: ['verein', 'tournament'] } },
      { teams: { teams_id: { members: { member: { user: { _eq: '$CURRENT_USER' } } } } } },
      { invited_members: { members_id: { user: { _eq: '$CURRENT_USER' } } } },
    ],
  }
  await setPermRead(MEMBER_POLICY, 'events', EVENTS_VISIBLE)

  const SAME_TEAM_AS_ME = {
    _or: [
      { member: { user: { _eq: '$CURRENT_USER' } } },
      { member: { member_teams: { team: { members: { member: { user: { _eq: '$CURRENT_USER' } } } } } } },
    ],
  }
  // 2026-05-12 audit #12: participations.last_*_edited_by are directus_users
  // UUIDs (migrations 046/047) which let Members enumerate Directus user
  // UUIDs by cross-referencing. Members get the timestamps but not the
  // UUIDs; LEADER keeps full read so coach UI can resolve editor names.
  // Absences gained `last_edited_by/at` in migration 051 — same pattern.
  const MEMBER_PARTICIPATION_FIELDS = [
    'id', 'member', 'activity_type', 'activity_id', 'status', 'note',
    'guest_count', 'is_staff',
    'session_id', 'waitlisted_at',
    'auto_declined_by', 'auto_cancelled_by_closure',
    'last_status_edited_at', 'last_note_edited_at', 'last_edited_at',
    'date_created', 'date_updated',
  ]
  const MEMBER_ABSENCE_FIELDS = [
    'id', 'member', 'type', 'start_date', 'end_date', 'indefinite', 'blocking',
    'reason', 'reason_detail', 'affects', 'days_of_week',
    'last_edited_at', 'date_created', 'date_updated',
  ]
  await setPermRead(MEMBER_POLICY, 'participations', SAME_TEAM_AS_ME, MEMBER_PARTICIPATION_FIELDS)
  await setPermRead(MEMBER_POLICY, 'absences', SAME_TEAM_AS_ME, MEMBER_ABSENCE_FIELDS)

  // ── slot_claims — keep open for now (calendar UI relies on it),
  // public read removed in 035; member read still permissive per audit decision.
  await setPermRead(MEMBER_POLICY, 'slot_claims')

  // sv_vm_check — direct read REVOKED for KSCW Member (closes the audit's
  // last open Critical finding from 2026-05-06).
  //
  // Members access their own licence data through `GET /kscw/sv-licence/me`
  // which joins by license_nr → association_id and returns ONLY the 11
  // safe fields. Direct collection read would either leak every member's
  // licence row (no filter) or trigger Directus 11's `CASE WHEN 1` SQL bug
  // (with row filter). Custom endpoint side-steps both.
  //
  // No setPermRead call here — the absence is the point. Sport Admin and
  // higher tiers retain full CRUD via SPORT_ADMIN_FULL_CRUD below.

  // Members — limited fields for other members. PII (email/phone) excluded
  // (migration 024). Self-read row is added below with editable fields.
  await setPermRead(MEMBER_POLICY, 'members', null, MEMBER_VISIBLE_FIELDS)

  // Members — read own profile with expanded fields (editable fields must be readable).
  // `is_spielplaner` is read-only here (NOT in MEMBER_EDITABLE_FIELDS) so members
  // can see their own scheduling flag — the frontend nav gates the Spielplanung /
  // Terminplanung links on it (useAuth) — but cannot self-grant it.
  const MEMBER_OWN_READABLE = [...new Set([...MEMBER_VISIBLE_FIELDS, ...MEMBER_EDITABLE_FIELDS, 'is_spielplaner'])]
  await setPermRead(MEMBER_POLICY, 'members', OWN_USER, MEMBER_OWN_READABLE)

  // Members — update own profile (limited fields)
  await setPerm(MEMBER_POLICY, 'members', 'update', OWN_USER, MEMBER_EDITABLE_FIELDS)

  // Participations: read scope set above (SAME_TEAM_AS_ME); CRU below.
  // 2026-05-31 security audit: create was unfiltered, so any member could
  // POST a participation with `member` set to another member's id (mark a
  // teammate absent, vote/confirm as them, etc.). Self-scope create with
  // OWN_MEMBER so Directus validates `member` resolves to the caller.
  await setPerm(MEMBER_POLICY, 'participations', 'create', OWN_MEMBER)
  await setPerm(MEMBER_POLICY, 'participations', 'update', OWN_MEMBER)

  // Absences: read scope set above (SAME_TEAM_AS_ME); CUD below.
  // 2026-05-31 security audit: create was unfiltered — an unfiltered create
  // let any member POST a weekly/indefinite absence for a teammate, which
  // (via migration 038's auto-decline cascade) silently flipped all the
  // victim's confirmed RSVPs to declined. Self-scope create with OWN_MEMBER.
  await setPerm(MEMBER_POLICY, 'absences', 'create', OWN_MEMBER)
  await setPerm(MEMBER_POLICY, 'absences', 'update', OWN_MEMBER)
  await setPerm(MEMBER_POLICY, 'absences', 'delete', OWN_MEMBER)

  // Notifications — read/update/delete own
  await setPermRead(MEMBER_POLICY, 'notifications', OWN_MEMBER)
  await setPerm(MEMBER_POLICY, 'notifications', 'update', OWN_MEMBER)
  await setPerm(MEMBER_POLICY, 'notifications', 'delete', OWN_MEMBER)

  // ── Forms (migrations 086/087) ──────────────────────────────
  // Members see non-draft forms scoped to them (club-wide ∪ their teams) and
  // create/read their OWN submissions. Anonymous forms allow member = NULL.
  // The frontend resolves visibility via the two-step junction fetch
  // (useUserVisibleFormIds) — it must NOT deep-filter forms.teams while this
  // policy also walks it (the M2M-deep-filter + policy-walk silent-[] landmine).
  const FORMS_VISIBLE = {
    _and: [
      { status: { _in: ['open', 'closed'] } },
      {
        _or: [
          { audience: { _eq: 'club_wide' } },
          { teams: { teams_id: { members: { member: { user: { _eq: '$CURRENT_USER' } } } } } },
        ],
      },
    ],
  }
  await setPermRead(MEMBER_POLICY, 'forms', FORMS_VISIBLE)
  await setPermRead(MEMBER_POLICY, 'forms_teams')
  // Submissions: read own; create own OR anonymous (member = NULL). The _or
  // self-scope blocks posting a submission AS another member while still
  // allowing anonymous forms.
  const FORM_SUBMISSION_OWN = { member: { user: { _eq: '$CURRENT_USER' } } }
  await setPermRead(MEMBER_POLICY, 'form_submissions', FORM_SUBMISSION_OWN)
  await setPerm(MEMBER_POLICY, 'form_submissions', 'create', {
    _or: [{ member: { _null: true } }, { member: { user: { _eq: '$CURRENT_USER' } } }],
  })
  // Editable submissions (migration 088): a member may revise their own answers
  // while the form is open. Restricted to the `answers` field so they cannot
  // reassign a submission to another member or another form; the BEFORE UPDATE
  // guard additionally blocks edits once the form is closed / past deadline.
  await setPerm(MEMBER_POLICY, 'form_submissions', 'update', FORM_SUBMISSION_OWN, ['answers'])

  // Announcements (Vereinsnews) — read only published, non-expired posts.
  // Audience matching (sport / teams / roles) is enforced client-side in
  // useAnnouncements; the server-side filter just prevents draft leakage.
  // Field whitelist excludes internal admin state (notify_push, notify_email,
  // fanout_sent_at) which members shouldn't see.
  await setPermRead(MEMBER_POLICY, 'announcements', {
    _and: [
      { published_at: { _nnull: true } },
      { published_at: { _lte: '$NOW' } },
      { _or: [
        { expires_at: { _null: true } },
        { expires_at: { _gt: '$NOW' } },
      ] },
    ],
  }, [
    // Intentionally exclude audience_teams / audience_roles — once role/team
    // targeting (v2) lands, exposing those arrays to non-admins would reveal
    // targeting intent for posts that weren't meant to be widely visible.
    'id', 'image', 'link', 'pinned',
    'published_at', 'expires_at',
    'audience_type', 'audience_sport',
    'translations', 'created_by',
    'date_created', 'date_updated',
  ])

  // Push subscriptions — CRUD own. 2026-05-31 security audit: self-scope
  // create with OWN_MEMBER so a member can't register a push subscription
  // attributed to another member.
  await setPermRead(MEMBER_POLICY, 'push_subscriptions', OWN_MEMBER)
  await setPerm(MEMBER_POLICY, 'push_subscriptions', 'create', OWN_MEMBER)
  await setPerm(MEMBER_POLICY, 'push_subscriptions', 'update', OWN_MEMBER)
  await setPerm(MEMBER_POLICY, 'push_subscriptions', 'delete', OWN_MEMBER)

  // Member teams — directory-level cross-club read kept (migration 036).
  // `guest_level` stays readable: the FE's getGuestLevel() needs it on the
  // user's own rows, and cross-team visibility of guest_level is acceptable
  // (it's already implicit in roster cards). The 2026-05-06 audit raised it
  // as Low; we explicitly accept that read scope and document in SECURITY.md.
  await setPermRead(MEMBER_POLICY, 'member_teams')
  // Members may leave a team they're on (self-scoped delete of own row).
  // Joining still requires coach approval via team_requests; leaving is
  // self-service. Same op coaches already perform via RosterEditor.
  await setPerm(MEMBER_POLICY, 'member_teams', 'delete', OWN_MEMBER)

  // Blocks — see only my own outgoing blocks (incoming blocks stay opaque)
  // (migration 042).
  await setPermRead(MEMBER_POLICY, 'blocks', { blocker: { user: { _eq: '$CURRENT_USER' } } })

  // Message requests — read own (recipient or sender). Added 2026-05-19:
  // never granted when messaging went GA (v4.0.0), so every member's inbox
  // useMessageRequests() fetchAllItems + realtime sub 403'd silently
  // ("no permission to access collection message_requests"). Like `blocks`
  // this is the rare messaging collection read DIRECTLY by the FE (the rest
  // route through server-side /messaging/* endpoints). sender/recipient are
  // members FKs → walk `.user` to $CURRENT_USER, same shape as blocks.
  // accept/decline go via kscw endpoints, so read-only is sufficient.
  await setPermRead(MEMBER_POLICY, 'message_requests', {
    _or: [
      { recipient: { user: { _eq: '$CURRENT_USER' } } },
      { sender: { user: { _eq: '$CURRENT_USER' } } },
    ],
  }, ['id', 'conversation', 'sender', 'recipient', 'status', 'created_at', 'resolved_at'])

  // Spielplaner assignments — self-scoped (migrations 034, 042).
  await setPermRead(MEMBER_POLICY, 'spielplaner_assignments', OWN_MEMBER)

  // Scorer delegations — read/create/update own. 2026-05-31 security audit:
  // create was unfiltered, letting a member fabricate a delegation FROM a
  // teammate. Self-scope create on `from_member` (the delegating side).
  await setPermRead(MEMBER_POLICY, 'scorer_delegations', OWN_DELEGATION)
  await setPerm(MEMBER_POLICY, 'scorer_delegations', 'create', OWN_DELEGATION_FROM)
  await setPerm(MEMBER_POLICY, 'scorer_delegations', 'update', OWN_DELEGATION)

  // Team invites — read own
  await setPermRead(MEMBER_POLICY, 'team_invites', { member: { user: { _eq: '$CURRENT_USER' } } })

  // User logs — create + read own
  await setPerm(MEMBER_POLICY, 'user_logs', 'create')
  await setPermRead(MEMBER_POLICY, 'user_logs', OWN_DU)

  // Feedback — create + read own (migration 043 scoped read by submitter email).
  await setPerm(MEMBER_POLICY, 'feedback', 'create')
  await setPermRead(MEMBER_POLICY, 'feedback', { email: { _eq: '$CURRENT_USER.email' } })

  // Tasks — read scope mirrors update (migration 043).
  const OWN_TASK_FILTER = {
    _or: [
      { assigned_to: { user: { _eq: '$CURRENT_USER' } } },
      { claimed_by: { user: { _eq: '$CURRENT_USER' } } },
    ],
  }
  await setPermRead(MEMBER_POLICY, 'tasks', OWN_TASK_FILTER)
  await setPerm(MEMBER_POLICY, 'tasks', 'update', OWN_TASK_FILTER)

  // Carpools — create, update own. 2026-05-31 security audit: self-scope
  // create so a member can only offer a carpool as themselves (`driver`) and
  // only add themselves as a passenger (`passenger`), not impersonate others.
  await setPerm(MEMBER_POLICY, 'carpools', 'create', OWN_DRIVER)
  await setPerm(MEMBER_POLICY, 'carpools', 'update', OWN_DRIVER)
  await setPerm(MEMBER_POLICY, 'carpool_passengers', 'create', OWN_PASSENGER)
  await setPerm(MEMBER_POLICY, 'carpool_passengers', 'update', OWN_PASSENGER)

  // Polls — vote. 2026-05-31 security audit: create was unfiltered, letting a
  // member cast a vote attributed to another member. Self-scope with OWN_MEMBER.
  await setPermRead(MEMBER_POLICY, 'poll_votes', OWN_MEMBER)
  await setPerm(MEMBER_POLICY, 'poll_votes', 'create', OWN_MEMBER)
  await setPerm(MEMBER_POLICY, 'poll_votes', 'update', OWN_MEMBER)

  // Team requests — create, read own. 2026-05-31 security audit: create was
  // unfiltered, letting a member file a join request on behalf of another
  // member. Self-scope create on `member` so only own requests can be created.
  await setPerm(MEMBER_POLICY, 'team_requests', 'create', { member: { user: { _eq: '$CURRENT_USER' } } })
  await setPermRead(MEMBER_POLICY, 'team_requests', { member: { user: { _eq: '$CURRENT_USER' } } })

  // Fines (migration 069) — members see their own fines (across all teams) and
  // the fine rules of teams they're on (so they can see the upcoming amount
  // before getting fined). Read-only — only leaders may create/waive/mark-paid.
  // Filter walks: fines.member.user (own fines) — different alias from any
  // frontend filter (FE uses `{ member: { _eq: myId } }`) so the M2M
  // double-walk trap doesn't apply.
  await setPermRead(MEMBER_POLICY, 'fines', { member: { user: { _eq: '$CURRENT_USER' } } })
  await setPermRead(MEMBER_POLICY, 'fine_rules', {
    // `members` is the o2m alias on teams (each row is a member_teams junction);
    // `teams.member_teams` is NOT a relational field → "Invalid query" that
    // broke fine_rules reads on the home page + roster editor for everyone.
    team: { members: { member: { user: { _eq: '$CURRENT_USER' } } } },
  })

  // Scheduling blocks (migration 085) — team blackout dates. Read-only for
  // members so the team absence calendar can render them as overlays. UNFILTERED
  // on purpose: the frontend filters by `{ team: { _in: [...] } }`, and a member
  // read filter that ALSO walked `team.members` would hit the M2M double-walk
  // trap (silent empty for non-admin). Blackout dates aren't sensitive (no PII),
  // so club-wide read is acceptable. Create/update/delete stay coach/TR-only.
  await setPermRead(MEMBER_POLICY, 'scheduling_blocks')

  // Files — create (upload profile pics)
  await setPerm(MEMBER_POLICY, 'directus_files', 'create')

  console.log(`  ✓ Member permissions set`)

  // ── 7. Team Responsible permissions (additive to Member) ────────────

  console.log('\n7. Team Responsible permissions...')

  // Members — scoped full-field read for members on teams I coach or TR.
  // 2026-05-12 audit: replaced unfiltered `setPermRead(LEADER_POLICY, 'members')`
  // which exposed every member's `ahv_nummer`, `adresse`, `birthdate`, etc. to
  // every historical coach across the entire club. With the v4.8.1 per-user
  // policy backfill this was effectively a club-wide PII dump.
  //
  // Out-of-team members remain visible via the MEMBER policy's
  // `MEMBER_VISIBLE_FIELDS` whitelist (no email/phone/PII). In-team members
  // are visible via this LEADER row with the contact fields coaches need
  // (email/phone/address/birthdate) but explicitly NOT `ahv_nummer` (Swiss
  // social security — coaches have no operational need).
  const COACH_TEAM_MEMBERS = {
    member_teams: {
      team: {
        _or: [
          { coach: { members_id: { user: { _eq: '$CURRENT_USER' } } } },
          { team_responsible: { members_id: { user: { _eq: '$CURRENT_USER' } } } },
        ],
      },
    },
  }
  const LEADER_TEAM_MEMBER_FIELDS = [
    ...new Set([...MEMBER_VISIBLE_FIELDS, ...MEMBER_EDITABLE_FIELDS]),
  ].filter(f => f !== 'ahv_nummer')
  await setPermRead(LEADER_POLICY, 'members', COACH_TEAM_MEMBERS, LEADER_TEAM_MEMBER_FIELDS)
  // Members — update position + number (migration 036 scoped to my-team members).
  // `coach_approved_team` added 2026-05-19: migration 036 narrowed this list to
  // ['position','number'] and silently broke coach/TR join-request approval
  // (TeamDetail.handleApprove writes { coach_approved_team: true }). Row scope
  // (COACH_TEAM_MEMBERS) + the member_teams-must-exist-first PG trigger keep
  // this safe — a coach can only flip the flag for their own team's members.
  await setPerm(LEADER_POLICY, 'members', 'update', COACH_TEAM_MEMBERS, ['position', 'number', 'coach_approved_team'])

  // Reject a pending signup (TeamDetail.handleReject) writes
  // { kscw_membership_active:false, wiedisync_active:false, requested_team:null }
  // on a member who has NOT been approved yet — so they have no member_teams
  // row and COACH_TEAM_MEMBERS above can't match. Scope this second update row
  // by the signup's `requested_team` instead: a coach/TR may reject only
  // members who requested a team they lead. Directus unions update rows, so a
  // pending signup matches THIS row's fields while real roster members match
  // the COACH_TEAM_MEMBERS row's fields. (requested_team is M2O members→teams.)
  const COACH_REQUESTED_TEAM = {
    requested_team: {
      _or: [
        { coach: { members_id: { user: { _eq: '$CURRENT_USER' } } } },
        { team_responsible: { members_id: { user: { _eq: '$CURRENT_USER' } } } },
      ],
    },
  }
  await setPerm(LEADER_POLICY, 'members', 'update', COACH_REQUESTED_TEAM, ['kscw_membership_active', 'wiedisync_active', 'requested_team'])

  // Coach Dashboard prefs — explicit read for Leader (Coach/TR).
  // PUBLIC_TEAM_FIELDS doesn't include these, so KSCW Member never sees them.
  await setPermRead(LEADER_POLICY, 'teams', null, LEADER_TEAM_DASHBOARD_FIELDS)

  // Teams — update scoped (migration 043). Coach ↔ team via teams.coach M2M;
  // Team Responsible ↔ team via teams.team_responsible M2M.
  // active=true: a coach/TR keeps READ access to an archived team (history) but
  // cannot mutate it. Coach/TR junctions are cloned (not moved) on rollover, so
  // without this gate a coach retains write access to every past season's team.
  await setPerm(LEADER_POLICY, 'teams', 'update', {
    active: { _eq: true },
    _or: [
      { coach: { members_id: { user: { _eq: '$CURRENT_USER' } } } },
      { team_responsible: { members_id: { user: { _eq: '$CURRENT_USER' } } } },
    ],
  })

  // Games — update scoped to coach/TR of the game's `kscw_team`.
  // 2026-05-12 audit: previously unfiltered — every coach in the club could
  // PATCH any game (scores, duty assignments, `auto_confirm_rsvp`) including
  // for teams they had no relationship to.
  await setPerm(LEADER_POLICY, 'games', 'update', {
    kscw_team: {
      active: { _eq: true },
      _or: [
        { coach: { members_id: { user: { _eq: '$CURRENT_USER' } } } },
        { team_responsible: { members_id: { user: { _eq: '$CURRENT_USER' } } } },
      ],
    },
  })

  // Trainings — coach can read/CRU/delete trainings of teams they coach or TR.
  // Read scope is required because the Member fallback policy only grants
  // trainings.read to users present in `member_teams` of the team — a coach
  // who is not also a player on their own team (common: Vorstand coaches,
  // retired/parent coaches) would otherwise see no trainings at all.
  const COACH_OR_TR_OF_TEAM = {
    _or: [
      { team: { coach: { members_id: { user: { _eq: '$CURRENT_USER' } } } } },
      { team: { team_responsible: { members_id: { user: { _eq: '$CURRENT_USER' } } } } },
    ],
  }
  // Writes additionally require the team to be active. Reads stay unscoped so a
  // coach can still see an archived team's past trainings as history, but can't
  // mutate them (their coach/TR junction lingers on the archived team post-rollover).
  const COACH_OR_TR_OF_ACTIVE_TEAM = {
    _or: [
      { team: { active: { _eq: true }, coach: { members_id: { user: { _eq: '$CURRENT_USER' } } } } },
      { team: { active: { _eq: true }, team_responsible: { members_id: { user: { _eq: '$CURRENT_USER' } } } } },
    ],
  }
  await setPermRead(LEADER_POLICY, 'trainings', COACH_OR_TR_OF_TEAM)
  await setPerm(LEADER_POLICY, 'trainings', 'create')
  // 2026-05-12 audit: update was unfiltered; scope to coach/TR of the
  // training's team like read/delete already are. 2026-06-09: active-gated.
  await setPerm(LEADER_POLICY, 'trainings', 'update', COACH_OR_TR_OF_ACTIVE_TEAM)
  await setPerm(LEADER_POLICY, 'trainings', 'delete', COACH_OR_TR_OF_ACTIVE_TEAM)

  // Events — coach can read/CRU/delete events of teams they coach or TR,
  // plus club-wide events, plus events they created, plus events they were
  // personally invited to. Mirrors the Member read policy (migration 033)
  // but adds the coach/TR M2M traversal.
  await setPermRead(LEADER_POLICY, 'events', {
    _or: [
      { created_by: { user: { _eq: '$CURRENT_USER' } } },
      { event_type: { _in: ['verein', 'tournament'] } },
      { teams: { teams_id: { coach: { members_id: { user: { _eq: '$CURRENT_USER' } } } } } },
      { teams: { teams_id: { team_responsible: { members_id: { user: { _eq: '$CURRENT_USER' } } } } } },
      { teams: { teams_id: { members: { member: { user: { _eq: '$CURRENT_USER' } } } } } },
      { invited_members: { members_id: { user: { _eq: '$CURRENT_USER' } } } },
    ],
  })
  await setPerm(LEADER_POLICY, 'events', 'create')
  // 2026-05-12 audit: update was unfiltered; scope to creator OR coach/TR of
  // an invited team (mirrors the delete filter below).
  await setPerm(LEADER_POLICY, 'events', 'update', {
    _or: [
      { created_by: { user: { _eq: '$CURRENT_USER' } } },
      { teams: { teams_id: { coach: { members_id: { user: { _eq: '$CURRENT_USER' } } } } } },
      { teams: { teams_id: { team_responsible: { members_id: { user: { _eq: '$CURRENT_USER' } } } } } },
    ],
  })
  await setPerm(LEADER_POLICY, 'events', 'delete', {
    _or: [
      { created_by: { user: { _eq: '$CURRENT_USER' } } },
      { teams: { teams_id: { coach: { members_id: { user: { _eq: '$CURRENT_USER' } } } } } },
      { teams: { teams_id: { team_responsible: { members_id: { user: { _eq: '$CURRENT_USER' } } } } } },
    ],
  })
  await setPerm(LEADER_POLICY, 'event_sessions', 'create')
  await setPerm(LEADER_POLICY, 'event_sessions', 'update')
  await setPerm(LEADER_POLICY, 'events_teams', 'create')
  await setPerm(LEADER_POLICY, 'events_teams', 'update')
  await setPerm(LEADER_POLICY, 'events_teams', 'delete')

  // Forms (migrations 086/087) — coach/TR author forms for teams they coach/TR,
  // plus read club-wide forms + forms they created. Mirrors the events block
  // above with the coach/TR M2M traversal. update/delete scoped to creator or
  // coach/TR of an attached team. They read submissions of forms in their scope.
  const FORMS_LEADER_SCOPE = {
    _or: [
      { created_by: { user: { _eq: '$CURRENT_USER' } } },
      { teams: { teams_id: { coach: { members_id: { user: { _eq: '$CURRENT_USER' } } } } } },
      { teams: { teams_id: { team_responsible: { members_id: { user: { _eq: '$CURRENT_USER' } } } } } },
    ],
  }
  await setPermRead(LEADER_POLICY, 'forms', {
    _or: [{ audience: { _eq: 'club_wide' } }, ...FORMS_LEADER_SCOPE._or],
  })
  await setPerm(LEADER_POLICY, 'forms', 'create')
  await setPerm(LEADER_POLICY, 'forms', 'update', FORMS_LEADER_SCOPE)
  await setPerm(LEADER_POLICY, 'forms', 'delete', FORMS_LEADER_SCOPE)
  await setPermRead(LEADER_POLICY, 'forms_teams')
  await setPerm(LEADER_POLICY, 'forms_teams', 'create')
  await setPerm(LEADER_POLICY, 'forms_teams', 'update')
  await setPerm(LEADER_POLICY, 'forms_teams', 'delete')
  await setPermRead(LEADER_POLICY, 'form_submissions', { form: FORMS_LEADER_SCOPE })

  // Sponsors — coach/TR manage sponsors of teams they coach/TR (the sponsor
  // editor lives inside the roster editor, gated by isCoachOf). update/delete
  // scoped via the teams_sponsors M2M; create is unfiltered (Directus can't
  // enforce a relational filter on CREATE — see the setPerm note — and the UI
  // attaches the team). READ stays UNFILTERED on purpose: the editor's
  // fetchSponsors already filters by `teams.teams_id`, and a policy read filter
  // walking the same M2M would AND two expressions through one junction →
  // silent empty for non-admins (the M2M-deep-filter gotcha). Sponsors are
  // club-readable anyway (MEMBER_READ_ALL).
  const SPONSORS_LEADER_SCOPE = {
    _or: [
      { teams: { teams_id: { coach: { members_id: { user: { _eq: '$CURRENT_USER' } } } } } },
      { teams: { teams_id: { team_responsible: { members_id: { user: { _eq: '$CURRENT_USER' } } } } } },
    ],
  }
  await setPermRead(LEADER_POLICY, 'sponsors')
  await setPerm(LEADER_POLICY, 'sponsors', 'create')
  await setPerm(LEADER_POLICY, 'sponsors', 'update', SPONSORS_LEADER_SCOPE)
  await setPerm(LEADER_POLICY, 'sponsors', 'delete', SPONSORS_LEADER_SCOPE)
  await setPermRead(LEADER_POLICY, 'teams_sponsors')
  await setPerm(LEADER_POLICY, 'teams_sponsors', 'create')
  await setPerm(LEADER_POLICY, 'teams_sponsors', 'update')
  await setPerm(LEADER_POLICY, 'teams_sponsors', 'delete')

  // Participations — read + update scoped to members on teams I coach/TR
  // (plus own row). 2026-05-12 audit: was unfiltered full-club RSVP dump.
  // Filter walks: participation.member → member.member_teams.team.{coach|TR}.
  const COACH_OR_TR_OF_PARTICIPATION = {
    _or: [
      { member: { user: { _eq: '$CURRENT_USER' } } },
      { member: { member_teams: { team: { coach: { members_id: { user: { _eq: '$CURRENT_USER' } } } } } } },
      { member: { member_teams: { team: { team_responsible: { members_id: { user: { _eq: '$CURRENT_USER' } } } } } } },
    ],
  }
  await setPermRead(LEADER_POLICY, 'participations', COACH_OR_TR_OF_PARTICIPATION)
  await setPerm(LEADER_POLICY, 'participations', 'update', COACH_OR_TR_OF_PARTICIPATION)

  // Member teams — read all + CRUD
  await setPermRead(LEADER_POLICY, 'member_teams')
  await setPerm(LEADER_POLICY, 'member_teams', 'create')
  await setPerm(LEADER_POLICY, 'member_teams', 'update')
  await setPerm(LEADER_POLICY, 'member_teams', 'delete')

  // Hall slots — CU
  await setPerm(LEADER_POLICY, 'hall_slots', 'create')
  await setPerm(LEADER_POLICY, 'hall_slots', 'update')
  await setPerm(LEADER_POLICY, 'slot_claims', 'update')

  // Team invites — read all + CRUD
  await setPermRead(LEADER_POLICY, 'team_invites')
  await setPerm(LEADER_POLICY, 'team_invites', 'create')
  await setPerm(LEADER_POLICY, 'team_invites', 'update')
  await setPerm(LEADER_POLICY, 'team_invites', 'delete')

  // Scorer delegations — read all
  await setPermRead(LEADER_POLICY, 'scorer_delegations')

  // Referee expenses — CRU
  await setPerm(LEADER_POLICY, 'referee_expenses', 'create')
  await setPerm(LEADER_POLICY, 'referee_expenses', 'update')

  // Tasks — CRUD
  await setPerm(LEADER_POLICY, 'tasks', 'create')
  await setPerm(LEADER_POLICY, 'tasks', 'update')
  await setPerm(LEADER_POLICY, 'tasks', 'delete')

  // Task templates — CRU
  await setPermRead(LEADER_POLICY, 'task_templates')
  await setPerm(LEADER_POLICY, 'task_templates', 'create')
  await setPerm(LEADER_POLICY, 'task_templates', 'update')

  // Polls — CRUD
  await setPerm(LEADER_POLICY, 'polls', 'create')
  await setPerm(LEADER_POLICY, 'polls', 'update')
  await setPerm(LEADER_POLICY, 'polls', 'delete')

  // Team requests — read + update
  await setPermRead(LEADER_POLICY, 'team_requests')
  await setPerm(LEADER_POLICY, 'team_requests', 'update')

  // Absences — read + CUD scoped to members on teams I coach/TR.
  // 2026-05-12 audit: read was unfiltered → full-club absence dump including
  // notes (potentially health-related). Now uses the same coach/TR scope as
  // the CUD rows already had.
  const COACH_TEAM_ABSENCE_SCOPE = { member: COACH_TEAM_MEMBERS }
  await setPermRead(LEADER_POLICY, 'absences', {
    _or: [
      { member: { user: { _eq: '$CURRENT_USER' } } },
      { member: { member_teams: { team: { coach: { members_id: { user: { _eq: '$CURRENT_USER' } } } } } } },
      { member: { member_teams: { team: { team_responsible: { members_id: { user: { _eq: '$CURRENT_USER' } } } } } } },
    ],
  })
  await setPerm(LEADER_POLICY, 'absences', 'create')
  await setPerm(LEADER_POLICY, 'absences', 'update', COACH_TEAM_ABSENCE_SCOPE)
  await setPerm(LEADER_POLICY, 'absences', 'delete', COACH_TEAM_ABSENCE_SCOPE)

  // Notifications — create (coaches send notifications)
  await setPerm(LEADER_POLICY, 'notifications', 'create')

  // Announcements — restricted to same filter as members (no draft access).
  // F6 audit fix: coaches don't need to see admin's pre-publication drafts.
  // Vorstand keeps unrestricted access for their pipeline-visibility role.
  await setPermRead(LEADER_POLICY, 'announcements', {
    _and: [
      { published_at: { _nnull: true } },
      { published_at: { _lte: '$NOW' } },
      { _or: [
        { expires_at: { _null: true } },
        { expires_at: { _gt: '$NOW' } },
      ] },
    ],
  }, [
    // Intentionally exclude audience_teams / audience_roles — once role/team
    // targeting (v2) lands, exposing those arrays to non-admins would reveal
    // targeting intent for posts that weren't meant to be widely visible.
    'id', 'image', 'link', 'pinned',
    'published_at', 'expires_at',
    'audience_type', 'audience_sport',
    'translations', 'created_by',
    'date_created', 'date_updated',
  ])

  // User logs — REMOVED for LEADER (2026-05-12 audit). The audit log endpoint
  // at /kscw/admin/audit is the only sanctioned access path and is admin-only.
  // Direct `/items/user_logs` read previously exposed every member's action
  // payloads (incl. profile-update diffs with PII) to every coach.

  // Game scheduling — read
  await setPermRead(LEADER_POLICY, 'game_scheduling_seasons')
  await setPermRead(LEADER_POLICY, 'game_scheduling_slots')
  await setPermRead(LEADER_POLICY, 'game_scheduling_opponents')
  await setPermRead(LEADER_POLICY, 'game_scheduling_bookings')

  // Fines + fine_rules (migration 069) — full CRUD scoped to teams the user
  // coaches or is TR for. Row filter walks `team.coach.members_id.user` etc;
  // the frontend must filter by `{ team: { _eq: id } }` only, never by
  // `{ team: { coach: ... } }` (M2M double-walk trap — see CLAUDE.md).
  // Waive happens via UPDATE (status=waived, waived_by/_at/_reason filled);
  // the kscw-hooks `fines.items.update` filter blocks edits to
  // amount/category/reason so the "waive + reissue" audit model is enforced.
  const COACH_OR_TR_OF_FINE = {
    team: {
      _or: [
        { coach: { members_id: { user: { _eq: '$CURRENT_USER' } } } },
        { team_responsible: { members_id: { user: { _eq: '$CURRENT_USER' } } } },
      ],
    },
  }
  // Active-gated variant for writes — keep reads on the full (history) scope.
  const COACH_OR_TR_OF_ACTIVE_FINE = {
    team: {
      active: { _eq: true },
      _or: [
        { coach: { members_id: { user: { _eq: '$CURRENT_USER' } } } },
        { team_responsible: { members_id: { user: { _eq: '$CURRENT_USER' } } } },
      ],
    },
  }
  await setPermRead(LEADER_POLICY, 'fines', COACH_OR_TR_OF_FINE)
  await setPerm(LEADER_POLICY, 'fines', 'create')
  await setPerm(LEADER_POLICY, 'fines', 'update', COACH_OR_TR_OF_ACTIVE_FINE)
  await setPerm(LEADER_POLICY, 'fines', 'delete', COACH_OR_TR_OF_ACTIVE_FINE)
  await setPermRead(LEADER_POLICY, 'fine_rules', COACH_OR_TR_OF_FINE)
  await setPerm(LEADER_POLICY, 'fine_rules', 'create')
  await setPerm(LEADER_POLICY, 'fine_rules', 'update', COACH_OR_TR_OF_ACTIVE_FINE)
  await setPerm(LEADER_POLICY, 'fine_rules', 'delete', COACH_OR_TR_OF_ACTIVE_FINE)

  // Scheduling blocks (migration 085) — team-level game-scheduling blackouts.
  // Same team-scoping shape as fines (direct `team` FK → coach/TR walk). Create
  // is unfiltered at the policy layer (Directus can't validate a relational
  // filter on a not-yet-existing row) and enforced in the kscw-hooks
  // `scheduling_blocks.items.create` filter, which stamps created_by and rejects
  // teams the caller doesn't coach / isn't TR for (mirrors games.items.create).
  const COACH_OR_TR_OF_BLOCK = {
    team: {
      _or: [
        { coach: { members_id: { user: { _eq: '$CURRENT_USER' } } } },
        { team_responsible: { members_id: { user: { _eq: '$CURRENT_USER' } } } },
      ],
    },
  }
  // Active-gated variant for writes — reads stay on the full scope.
  const COACH_OR_TR_OF_ACTIVE_BLOCK = {
    team: {
      active: { _eq: true },
      _or: [
        { coach: { members_id: { user: { _eq: '$CURRENT_USER' } } } },
        { team_responsible: { members_id: { user: { _eq: '$CURRENT_USER' } } } },
      ],
    },
  }
  await setPermRead(LEADER_POLICY, 'scheduling_blocks', COACH_OR_TR_OF_BLOCK)
  await setPerm(LEADER_POLICY, 'scheduling_blocks', 'create')
  await setPerm(LEADER_POLICY, 'scheduling_blocks', 'update', COACH_OR_TR_OF_ACTIVE_BLOCK)
  await setPerm(LEADER_POLICY, 'scheduling_blocks', 'delete', COACH_OR_TR_OF_ACTIVE_BLOCK)

  // ── Consolidation 2026-06-09: folded the legacy "KSCW Coach" policy in here ──
  // The old un-managed "KSCW Coach" policy (from SQL migrations 026/034/036/042,
  // before permissions moved into this script) stayed attached to the Team
  // Responsible role and ADDITIVELY shadowed every scoped rule above — silently
  // re-granting the un-gated/looser writes this policy tightens. These are the
  // grants it held that the Member policy (which coaches also hold) does NOT
  // already cover, ported here so the legacy policy can be deleted
  // (deleteLegacyPolicy('KSCW Coach') below). Filters are preserved verbatim
  // except participations.delete, which was fully open and is now scoped like
  // participations.update. The overlapping looser rules (teams/games/trainings/
  // fines updates) are simply dropped with the legacy policy, so this policy's
  // active-gated versions finally take effect.
  const EVENT_SESSIONS_LEADER_SCOPE = {
    _or: [
      { event: { created_by: { user: { _eq: '$CURRENT_USER' } } } },
      { event: { teams: { teams_id: { coach: { members_id: { user: { _eq: '$CURRENT_USER' } } } } } } },
    ],
  }
  const EVENTS_MEMBERS_LEADER_SCOPE = {
    _or: [
      { events_id: { created_by: { user: { _eq: '$CURRENT_USER' } } } },
      { events_id: { teams: { teams_id: { coach: { members_id: { user: { _eq: '$CURRENT_USER' } } } } } } },
    ],
  }
  const COACH_OF_TEAM_FK = { team: { coach: { members_id: { user: { _eq: '$CURRENT_USER' } } } } }
  const COACH_OF_SLOT_CLAIM = { claimed_by_team: { coach: { members_id: { user: { _eq: '$CURRENT_USER' } } } } }
  await setPerm(LEADER_POLICY, 'event_sessions', 'delete', EVENT_SESSIONS_LEADER_SCOPE)
  await setPerm(LEADER_POLICY, 'events_members', 'create', EVENTS_MEMBERS_LEADER_SCOPE)
  await setPerm(LEADER_POLICY, 'events_members', 'update', EVENTS_MEMBERS_LEADER_SCOPE)
  await setPerm(LEADER_POLICY, 'events_members', 'delete', EVENTS_MEMBERS_LEADER_SCOPE)
  await setPerm(LEADER_POLICY, 'participations', 'delete', COACH_OR_TR_OF_PARTICIPATION)
  await setPerm(LEADER_POLICY, 'referee_expenses', 'delete', COACH_OF_TEAM_FK)
  await setPerm(LEADER_POLICY, 'scorer_delegations', 'delete', OWN_DELEGATION_FROM)
  await setPerm(LEADER_POLICY, 'slot_claims', 'create', COACH_OF_SLOT_CLAIM)
  await setPerm(LEADER_POLICY, 'slot_claims', 'delete', COACH_OF_SLOT_CLAIM)
  await setPerm(LEADER_POLICY, 'task_templates', 'delete', COACH_OF_TEAM_FK)
  // Junction + hall-plan CRUD — unfiltered, mirroring the sibling teams_sponsors
  // / events_teams junctions above (Directus can't relationally filter junction
  // writes; the roster/hallenplan editors + kscw-hooks gate them). carpools.delete
  // is kept open exactly as the legacy policy had it (lowest-stakes; flagged for a
  // later tightening pass with the remaining open junction writes).
  await setPerm(LEADER_POLICY, 'hall_slots_teams', 'create')
  await setPerm(LEADER_POLICY, 'hall_slots_teams', 'update')
  await setPerm(LEADER_POLICY, 'hall_slots_teams', 'delete')
  await setPerm(LEADER_POLICY, 'teams_coaches', 'create')
  await setPerm(LEADER_POLICY, 'teams_coaches', 'update')
  await setPerm(LEADER_POLICY, 'teams_coaches', 'delete')
  await setPerm(LEADER_POLICY, 'teams_responsibles', 'create')
  await setPerm(LEADER_POLICY, 'teams_responsibles', 'update')
  await setPerm(LEADER_POLICY, 'teams_responsibles', 'delete')
  await setPerm(LEADER_POLICY, 'carpools', 'delete')

  // Files — create (upload team photos)
  await setPerm(LEADER_POLICY, 'directus_files', 'create')

  console.log(`  ✓ Team Responsible permissions set`)

  // ��─ 8. Vorstand permissions (read-all + member write) ──────────

  console.log('\n8. Vorstand permissions...')

  // Vorstand gets read-all on everything (overrides member's filtered reads)
  const VORSTAND_READ_ALL = [
    'members', 'member_teams', 'participations', 'absences',
    'notifications', 'scorer_delegations', 'team_invites',
    'user_logs', 'feedback', 'tasks', 'task_templates',
    'poll_votes', 'team_requests', 'push_subscriptions',
    'game_scheduling_seasons', 'game_scheduling_slots',
    'game_scheduling_opponents', 'game_scheduling_bookings',
    'announcements',
    // Fines (migration 069) — Vorstand sees club-wide for oversight.
    'fines', 'fine_rules',
    // Scheduling blocks (migration 085) — club-wide read for oversight.
    'scheduling_blocks',
  ]
  for (const col of VORSTAND_READ_ALL) {
    await setPermRead(VORSTAND_POLICY, col)
  }

  // Forms (migrations 086/087) — Vorstand has FULL management (decision
  // 2026-06-05): create/edit/delete any form club-wide + read all submissions,
  // exactly like a global admin. (Sport Admins are sport-scoped in the FormsPage
  // UI; their policy keeps club-wide CRUD, matching every other collection.)
  for (const col of ['forms', 'forms_teams', 'form_submissions']) {
    await setPermCRUD(VORSTAND_POLICY, col)
  }

  console.log(`  ✓ Vorstand permissions set`)

  // ���─ 9. Sport Admin permissions ───��─────────────────────────────

  console.log('\n9. Sport Admin permissions...')

  // Sport Admin tier: club-wide CRU on operational collections, but NOT
  // members.delete or teams.delete (migration 027 — full admin only,
  // club-wide blast radius).
  const SPORT_ADMIN_FULL_CRUD = [
    'games', 'trainings', 'events', 'event_sessions', 'events_teams',
    'member_teams', 'participations', 'absences',
    'rankings', 'sponsors', 'teams_sponsors',
    'hall_slots', 'hall_closures', 'hall_events', 'hall_events_halls', 'halls', 'hall_slots_teams',
    'slot_claims', 'notifications', 'feedback', 'scorer_delegations', 'referee_expenses',
    'team_invites', 'news', 'app_settings', 'user_logs',
    'push_subscriptions', 'email_verifications',
    'teams_coaches', 'teams_responsibles', 'events_members',
    'volley_feedback',
    'tasks', 'task_templates', 'carpools', 'carpool_passengers',
    'polls', 'poll_votes', 'team_requests', 'registrations',
    'game_scheduling_seasons', 'game_scheduling_slots',
    'game_scheduling_opponents', 'game_scheduling_bookings',
    'query_templates', 'sv_vm_check',
    'announcements',
    // Fines (migration 069) — Sport Admin full CRUD (override coach-only scope
    // for cross-team rule edits + correction of bad fines).
    'fines', 'fine_rules',
    // Scheduling blocks (migration 085) — club-wide CRUD for any team's blackouts.
    'scheduling_blocks',
    // Forms (migrations 086/087) — club-wide CRUD at the policy layer; per-sport
    // scoping is enforced in the FormsPage UI (consistent with every other Sport
    // Admin collection, which are likewise club-wide CRUD + UI-scoped).
    'forms', 'form_submissions', 'forms_teams',
    'directus_files',
  ]
  for (const col of SPORT_ADMIN_FULL_CRUD) {
    await setPermCRUD(SPORT_ADMIN_POLICY, col)
  }
  // Restricted: read/create/update only on members + teams (delete blocked).
  for (const col of ['members', 'teams']) {
    await setPerm(SPORT_ADMIN_POLICY, col, 'create')
    await setPermRead(SPORT_ADMIN_POLICY, col)
    await setPerm(SPORT_ADMIN_POLICY, col, 'update')
    // No delete — migration 027.
  }

  console.log(`  ✓ Sport Admin permissions set`)

  // ── 9b. Terminplanung permissions ──────────────────────────────
  //
  // Club-wide Spielplaner members run the opponent game-scheduling flow. The
  // admin UI reads/writes these collections via the Directus items API
  // (useGameSchedulingSeason + useAdminBookings), so they need real policy
  // permissions — the custom /admin/terminplanung/* action endpoints (slot
  // generation, confirm, invites, SVRZ sync) run on the system DB connection and
  // are gated separately in the kscw-endpoints extension.
  //
  // No row-level filter: the policy is attached only to is_spielplaner users
  // (section 12), so holding it IS the gate. Season create/update is allowed
  // (open/close + config); structural ops (archive/rollover/restore) stay
  // admin-only at the endpoint layer.

  console.log('\n9b. Terminplanung permissions...')

  await setPerm(TERMINPLANUNG_POLICY, 'game_scheduling_seasons', 'create')
  await setPermRead(TERMINPLANUNG_POLICY, 'game_scheduling_seasons')
  await setPerm(TERMINPLANUNG_POLICY, 'game_scheduling_seasons', 'update')
  await setPermRead(TERMINPLANUNG_POLICY, 'game_scheduling_slots')
  await setPermRead(TERMINPLANUNG_POLICY, 'game_scheduling_opponents')
  await setPermRead(TERMINPLANUNG_POLICY, 'game_scheduling_bookings')
  // Scheduling blocks (migration 085) — club-wide Spielplaner can manage team
  // blackouts for any team (no row filter; holding the policy IS the gate, like
  // the season collections above). The create hook still stamps created_by.
  await setPermRead(TERMINPLANUNG_POLICY, 'scheduling_blocks')
  await setPerm(TERMINPLANUNG_POLICY, 'scheduling_blocks', 'create')
  await setPerm(TERMINPLANUNG_POLICY, 'scheduling_blocks', 'update')
  await setPerm(TERMINPLANUNG_POLICY, 'scheduling_blocks', 'delete')

  console.log(`  ✓ Terminplanung permissions set`)

  // ── 10. Backfill user-level LEADER access for every coach/TR ───
  //
  // Permission gating must not depend on Directus role assignment. The
  // role-sync hook only fires on data-change events; users whose
  // coach/TR junction predates the hook (or whose role got manually
  // changed to a custom tier like "Website Admin") end up with a stale
  // role that lacks LEADER policy → 403 on teams.update etc.
  //
  // Fix: attach LEADER_POLICY directly to the user via directus_access
  // for everyone present in teams_coaches or teams_responsibles. The
  // LEADER policy is already self-scoped on every write (teams.update,
  // members.update, member_teams.* via M2M filters) so attaching it
  // broadly is safe — non-coaches simply won't match the filters.
  //
  // Idempotent: skips users that already have the row.

  console.log('\n10. Backfilling user-level LEADER access for coaches/TRs...')

  const leaderUserIds = new Set()
  const coachJunctions = await api('GET', '/items/teams_coaches?fields=members_id.user&limit=-1')
  const trJunctions = await api('GET', '/items/teams_responsibles?fields=members_id.user&limit=-1')
  for (const j of [...coachJunctions, ...trJunctions]) {
    const uid = j?.members_id?.user
    if (uid) leaderUserIds.add(uid)
  }

  const existingAccess = await api('GET', `/access?filter[policy][_eq]=${LEADER_POLICY}&filter[user][_nnull]=true&fields=user&limit=-1`)
  const haveLeader = new Set(existingAccess.map(a => a.user).filter(Boolean))

  let attached = 0
  let skipped = 0
  for (const userId of leaderUserIds) {
    if (haveLeader.has(userId)) { skipped++; continue }
    try {
      await api('POST', '/access', { user: userId, policy: LEADER_POLICY })
      attached++
    } catch (e) {
      if (!e.message.includes('RECORD_NOT_UNIQUE')) {
        console.warn(`  ⚠ attach LEADER to ${userId}: ${e.message.slice(0, 100)}`)
      } else {
        skipped++
      }
    }
  }
  console.log(`  ✓ Attached LEADER policy to ${attached} user(s) (${skipped} already had it, ${leaderUserIds.size} total coaches/TRs)`)

  // Clean up stale user-level LEADER access for users no longer coach/TR.
  // Re-fetch with id so we can DELETE; the earlier query only requested `user`.
  const accessWithIds = await api('GET', `/access?filter[policy][_eq]=${LEADER_POLICY}&filter[user][_nnull]=true&fields=id,user&limit=-1`)
  const stale = accessWithIds.filter(a => a.user && !leaderUserIds.has(a.user))
  for (const row of stale) {
    try {
      await api('DELETE', `/access/${row.id}`)
    } catch (e) {
      console.warn(`  ⚠ revoke LEADER from ${row.user}: ${e.message.slice(0, 100)}`)
    }
  }
  if (stale.length > 0) console.log(`  ✓ Revoked LEADER policy from ${stale.length} ex-coach/TR user(s)`)

  // ── 10b. Retire the legacy "KSCW Coach" policy ────────────────
  // Its unique grants were folded into Team Responsible above; the LEADER
  // backfill (10) guarantees every coach/TR now holds the TR policy directly,
  // so removing the legacy one loses no access — it only removes the
  // additive shadow + its fully-open writes. Idempotent.
  console.log('\n10b. Retiring legacy "KSCW Coach" policy...')
  await deleteLegacyPolicy('KSCW Coach')

  // ── 12. Backfill user-level TERMINPLANUNG access for is_spielplaner ───
  //
  // Attach the Terminplanung policy directly to the directus user of every
  // member with is_spielplaner=true (club-wide schedulers). Same idempotent
  // sync + stale-cleanup pattern as the LEADER backfill above. A newly-flagged
  // member gets access on the next perms deploy.

  console.log('\n12. Backfilling user-level TERMINPLANUNG access for is_spielplaner members...')

  const spielplanerMembers = await api('GET', '/items/members?filter[is_spielplaner][_eq]=true&fields=user&limit=-1')
  const spielplanerUserIds = new Set(spielplanerMembers.map(m => m.user).filter(Boolean))

  const existingTp = await api('GET', `/access?filter[policy][_eq]=${TERMINPLANUNG_POLICY}&filter[user][_nnull]=true&fields=user&limit=-1`)
  const haveTp = new Set(existingTp.map(a => a.user).filter(Boolean))

  let tpAttached = 0
  let tpSkipped = 0
  for (const userId of spielplanerUserIds) {
    if (haveTp.has(userId)) { tpSkipped++; continue }
    try {
      await api('POST', '/access', { user: userId, policy: TERMINPLANUNG_POLICY })
      tpAttached++
    } catch (e) {
      if (!e.message.includes('RECORD_NOT_UNIQUE')) {
        console.warn(`  ⚠ attach TERMINPLANUNG to ${userId}: ${e.message.slice(0, 100)}`)
      } else {
        tpSkipped++
      }
    }
  }
  console.log(`  ✓ Attached TERMINPLANUNG policy to ${tpAttached} user(s) (${tpSkipped} already had it, ${spielplanerUserIds.size} total is_spielplaner)`)

  const tpAccessWithIds = await api('GET', `/access?filter[policy][_eq]=${TERMINPLANUNG_POLICY}&filter[user][_nnull]=true&fields=id,user&limit=-1`)
  const tpStale = tpAccessWithIds.filter(a => a.user && !spielplanerUserIds.has(a.user))
  for (const row of tpStale) {
    try {
      await api('DELETE', `/access/${row.id}`)
    } catch (e) {
      console.warn(`  ⚠ revoke TERMINPLANUNG from ${row.user}: ${e.message.slice(0, 100)}`)
    }
  }
  if (tpStale.length > 0) console.log(`  ✓ Revoked TERMINPLANUNG policy from ${tpStale.length} ex-is_spielplaner user(s)`)

  // ── 11. Admin policy (admin_access=true — bypasses all) ────────

  console.log('\n11. Admin/Superuser — admin_access=true, bypasses all permissions')

  // ── Summary ──────���─────────────────────────────────────────────

  console.log(`\n${'═'.repeat(50)}`)
  console.log(`✅ Permission setup complete!`)
  console.log(`   ${stats.ok} permissions granted`)
  console.log(`   ${stats.err} errors`)
  console.log(`${'═'.repeat(50)}`)
  console.log(`\nRoles: ${Object.keys(roleMap).join(', ')}`)
  console.log(`Admin/Superuser: admin_access=true → bypass all permissions`)
  console.log(`Public: permissions on null-role policy "$t:public_label"\n`)
}

main().catch(err => {
  console.error('💥 Fatal error:', err)
  process.exit(1)
})
