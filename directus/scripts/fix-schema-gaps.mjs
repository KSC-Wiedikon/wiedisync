/**
 * Fix 3 missing schema gaps in Directus:
 * 1. members.requested_team — M2O → teams
 * 2. hall_events.hall — M2M ↔ halls via hall_events_halls
 * 3. hall_slots.teams — M2M ↔ teams via hall_slots_teams (new field alongside existing M2O team)
 *
 * Run: node directus/scripts/fix-schema-gaps.mjs
 */

const DIRECTUS_URL = process.env.DIRECTUS_URL || 'http://localhost:8055'
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@kscw.ch'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD
if (!ADMIN_PASSWORD) { console.error('Missing ADMIN_PASSWORD env var'); process.exit(1) }

// ── Helpers ──────────────────────────────────────────────────────────

async function getToken() {
  const res = await fetch(`${DIRECTUS_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  })
  if (!res.ok) throw new Error(`Auth failed: ${res.status} ${await res.text()}`)
  const { data } = await res.json()
  return data.access_token
}

async function api(token, method, path, body) {
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
    if (text.includes('already exists')) {
      console.log(`  ⤳ already exists, skipping`)
      return null
    }
    throw new Error(`${method} ${path}: ${res.status} ${text}`)
  }
  return text ? JSON.parse(text) : null
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log('🔑 Authenticating...')
  const token = await getToken()
  console.log('✓ Authenticated\n')

  // ── 1. members.requested_team (M2O → teams) ───────────────────────
  console.log('━━━ Gap 1: members.requested_team (M2O → teams) ━━━')
  try {
    console.log('  Creating field members.requested_team...')
    await api(token, 'POST', '/fields/members', {
      field: 'requested_team',
      type: 'integer',
      schema: { is_nullable: true },
      meta: { interface: 'select-dropdown-m2o', special: ['m2o'] },
    })
    console.log('  Creating relation members.requested_team → teams...')
    await api(token, 'POST', '/relations', {
      collection: 'members',
      field: 'requested_team',
      related_collection: 'teams',
      schema: { on_delete: 'SET NULL' },
      meta: { one_field: null, sort_field: null, one_deselect_action: 'nullify' },
    })
    console.log('  ✓ members.requested_team done\n')
  } catch (err) {
    console.log(`  ✗ ${err.message}\n`)
  }

  // ── 2. hall_events.hall — REMOVED (migration 252) ──────────────────
  // The hall_events_halls M2M was dropped 2026-07-27: the junction never
  // held a row (gcal-sync's writer targeted a nonexistent scalar column and
  // never fired) and hall resolution is regex on title/location. Do NOT
  // re-create it — re-adding the alias against the dropped PG table breaks
  // hall_events expansion.
  console.log('━━━ Gap 2: hall_events.hall — obsolete (junction dropped in migration 252), skipped ━━━\n')

  // ── 3. hall_slots.teams (M2M ↔ teams via hall_slots_teams) ─────────
  console.log('━━━ Gap 3: hall_slots.teams (M2M ↔ teams via hall_slots_teams) ━━━')
  try {
    // Step 1: Create junction collection
    console.log('  Creating junction collection hall_slots_teams...')
    await api(token, 'POST', '/collections', {
      collection: 'hall_slots_teams',
      schema: {},
      meta: { icon: 'link', hidden: true },
    })

    // Step 2: Create FK fields on junction
    console.log('  Creating field hall_slots_teams.hall_slots_id...')
    await api(token, 'POST', '/fields/hall_slots_teams', {
      field: 'hall_slots_id',
      type: 'integer',
      schema: { is_nullable: true },
      meta: { hidden: true },
    })
    console.log('  Creating field hall_slots_teams.teams_id...')
    await api(token, 'POST', '/fields/hall_slots_teams', {
      field: 'teams_id',
      type: 'integer',
      schema: { is_nullable: true },
      meta: { hidden: true },
    })

    // Step 3: Create M2O from junction → hall_slots (with one_field = 'teams' on hall_slots)
    console.log('  Creating relation hall_slots_teams.hall_slots_id → hall_slots...')
    await api(token, 'POST', '/relations', {
      collection: 'hall_slots_teams',
      field: 'hall_slots_id',
      related_collection: 'hall_slots',
      meta: { one_field: 'teams', junction_field: 'teams_id' },
      schema: { on_delete: 'CASCADE' },
    })

    // Step 4: Create M2O from junction → teams
    console.log('  Creating relation hall_slots_teams.teams_id → teams...')
    await api(token, 'POST', '/relations', {
      collection: 'hall_slots_teams',
      field: 'teams_id',
      related_collection: 'teams',
      schema: { on_delete: 'CASCADE' },
    })
    console.log('  ✓ hall_slots.teams M2M done\n')
  } catch (err) {
    console.log(`  ✗ ${err.message}\n`)
  }

  console.log('✅ Schema gap fix complete!')
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
