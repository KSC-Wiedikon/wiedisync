/**
 * KSCW Directus Role Backfill
 *
 * Assigns the correct Directus role to all existing members based on:
 *   1. members.role array (superuser, admin, vb_admin, bb_admin, vorstand)
 *   2. Coach/TR junction membership
 *
 * Priority: Superuser > Sport Admin > Vorstand+Coach → Team Responsible > Vorstand > Team Responsible > Member
 *
 * Usage:
 *   DIRECTUS_URL=https://directus-dev.kscw.ch ADMIN_EMAIL=admin@kscw.ch ADMIN_PASSWORD=<password> node directus/scripts/backfill-roles.mjs
 *   # Or with static token:
 *   DIRECTUS_URL=https://directus-dev.kscw.ch DIRECTUS_TOKEN=<token> node directus/scripts/backfill-roles.mjs
 */

const DIRECTUS_URL = process.env.DIRECTUS_URL || 'http://localhost:8055'
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@kscw.ch'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD
if (!ADMIN_PASSWORD) { console.error('Missing ADMIN_PASSWORD env var'); process.exit(1) }
const ADMIN_PASSWORD_CLEAN = ADMIN_PASSWORD.replace(/\\!/g, '!')
const STATIC_TOKEN = process.env.DIRECTUS_TOKEN || ''

let token = null

async function auth() {
  if (STATIC_TOKEN) {
    token = STATIC_TOKEN
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
  if (!res.ok) throw new Error(`Auth failed: ${res.status} ${await res.text()}`)
  const { data } = await res.json()
  token = data.access_token
}

async function api(method, path, body) {
  const res = await fetch(`${DIRECTUS_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 200)}`)
  return text ? JSON.parse(text).data : null
}

async function main() {
  console.log(`\n🔄 KSCW Directus Role Backfill → ${DIRECTUS_URL}\n`)
  await auth()

  // 1. Get role map
  const roles = await api('GET', '/roles?limit=-1')
  const roleMap = Object.fromEntries(roles.map(r => [r.name, r.id]))
  console.log('Roles:', Object.entries(roleMap).map(([n, id]) => `${n}=${id.slice(0, 8)}`).join(', '))

  const required = ['Superuser', 'Sport Admin', 'Vorstand', 'Team Responsible', 'Member']
  for (const r of required) {
    if (!roleMap[r]) {
      console.error(`❌ Missing role "${r}". Run setup-permissions.mjs first.`)
      process.exit(1)
    }
  }

  // 2. Get all members with linked users
  const members = await api('GET', '/items/members?fields=id,role,user&filter[user][_nnull]=true&limit=-1')
  console.log(`\nProcessing ${members.length} members with linked Directus users...\n`)

  // 3. Get coach/TR assignments
  const coaches = await api('GET', '/items/teams_coach?fields=members_id&limit=-1')
  const trs = await api('GET', '/items/teams_team_responsible?fields=members_id&limit=-1')
  const coachMemberIds = new Set(coaches.map(c => c.members_id))
  const trMemberIds = new Set(trs.map(t => t.members_id))

  // 4. Resolve and assign
  const counts = { Superuser: 0, 'Sport Admin': 0, Vorstand: 0, 'Team Responsible': 0, Member: 0 }
  let updated = 0, skipped = 0, errors = 0

  for (const m of members) {
    const appRoles = Array.isArray(m.role) ? m.role : []
    const isCoachOrTR = coachMemberIds.has(m.id) || trMemberIds.has(m.id)
    let targetRole

    if (appRoles.includes('superuser') || appRoles.includes('admin')) {
      targetRole = 'Superuser'
    } else if (appRoles.includes('vb_admin') || appRoles.includes('bb_admin')) {
      targetRole = 'Sport Admin'
    } else if (appRoles.includes('board') && isCoachOrTR) {
      targetRole = 'Team Responsible' // Vorstand+Coach → Team Responsible (more write access)
    } else if (appRoles.includes('board')) {
      targetRole = 'Vorstand'
    } else if (isCoachOrTR) {
      targetRole = 'Team Responsible'
    } else {
      targetRole = 'Member'
    }

    const targetRoleId = roleMap[targetRole]
    counts[targetRole]++

    try {
      await api('PATCH', `/users/${m.user}`, { role: targetRoleId })
      updated++
    } catch (err) {
      console.error(`  ✗ Member ${m.id} → ${targetRole}: ${err.message}`)
      errors++
    }
  }

  console.log(`\n${'═'.repeat(50)}`)
  console.log(`✅ Backfill complete: ${updated} updated, ${errors} errors`)
  console.log(`\nDistribution:`)
  for (const [role, count] of Object.entries(counts)) {
    console.log(`  ${role}: ${count}`)
  }
  console.log(`${'═'.repeat(50)}\n`)
}

main().catch(err => {
  console.error('💥', err.message)
  process.exit(1)
})
