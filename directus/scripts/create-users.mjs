/**
 * KSCW Directus User Creation
 *
 * Reads all members from Directus, creates corresponding directus_users records,
 * and links them via a `user` M2O field on the members collection.
 *
 * Steps:
 *   1. Create `user` field on members (uuid M2O -> directus_users)
 *   2. Create 4 KSCW roles (Member, Coach, Admin, Superuser)
 *   3. Read all members
 *   4. For each member with email (non-shell): create user, link to member
 *
 * Run with: node scripts/create-users.mjs
 */

const DIRECTUS_URL = process.env.DIRECTUS_URL || 'http://localhost:8055'
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@kscw.ch'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD
if (!ADMIN_PASSWORD) { console.error('Missing ADMIN_PASSWORD env var'); process.exit(1) }
const TEMP_PASSWORD = process.env.TEMP_PASSWORD
if (!TEMP_PASSWORD) { console.error('Missing TEMP_PASSWORD env var'); process.exit(1) }

// ── Helpers ──────────────────────────────────────────────────────────

let token = null

async function auth() {
  const res = await fetch(`${DIRECTUS_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  })
  if (!res.ok) throw new Error(`Auth failed: ${res.status} ${await res.text()}`)
  const { data } = await res.json()
  token = data.access_token
  console.log('Authenticated with Directus')
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
    const alreadyExists = text.includes('already exists') || text.includes('has to be unique')
    return { ok: false, alreadyExists, status: res.status, text }
  }
  return { ok: true, data: text ? JSON.parse(text) : null }
}

// ── Step 1: Create user field on members ────────────────────────────

async function createUserField() {
  console.log('\n--- Step 1: Create user field on members ---')

  // Create the field
  const fieldResult = await api('POST', '/fields/members', {
    field: 'user',
    type: 'uuid',
    schema: { is_nullable: true },
    meta: {
      interface: 'select-dropdown-m2o',
      special: ['m2o'],
      display: 'related-values',
      display_options: { template: '{{first_name}} {{last_name}}' },
    },
  })

  if (fieldResult.ok) {
    console.log('  Created field: members.user')
  } else if (fieldResult.alreadyExists) {
    console.log('  Field members.user already exists, skipping')
  } else {
    console.log(`  Warning creating field: ${fieldResult.status} ${fieldResult.text}`)
  }

  // Create the relation
  const relResult = await api('POST', '/relations', {
    collection: 'members',
    field: 'user',
    related_collection: 'directus_users',
    schema: { on_delete: 'SET NULL' },
  })

  if (relResult.ok) {
    console.log('  Created relation: members.user -> directus_users')
  } else if (relResult.alreadyExists) {
    console.log('  Relation already exists, skipping')
  } else {
    console.log(`  Warning creating relation: ${relResult.status} ${relResult.text}`)
  }
}

// ── Step 2: Create roles ────────────────────────────────────────────

const ROLE_DEFS = [
  { name: 'Member', icon: 'person', admin_access: false },
  { name: 'Coach', icon: 'sports', admin_access: false },
  { name: 'Admin', icon: 'admin_panel_settings', admin_access: false },
  { name: 'Superuser', icon: 'security', admin_access: true },
]

// name -> UUID
const roleIds = {}

async function createRoles() {
  console.log('\n--- Step 2: Create KSCW roles ---')

  for (const def of ROLE_DEFS) {
    const result = await api('POST', '/roles', def)
    if (result.ok) {
      roleIds[def.name] = result.data.data.id
      console.log(`  Created role: ${def.name} (${roleIds[def.name]})`)
    } else if (result.alreadyExists) {
      // Fetch existing role by name
      const listResult = await api('GET', `/roles?filter[name][_eq]=${encodeURIComponent(def.name)}`)
      if (listResult.ok && listResult.data?.data?.length > 0) {
        roleIds[def.name] = listResult.data.data[0].id
        console.log(`  Role exists: ${def.name} (${roleIds[def.name]})`)
      } else {
        console.log(`  Warning: could not find existing role ${def.name}`)
      }
    } else {
      // Try to find existing role anyway
      const listResult = await api('GET', `/roles?filter[name][_eq]=${encodeURIComponent(def.name)}`)
      if (listResult.ok && listResult.data?.data?.length > 0) {
        roleIds[def.name] = listResult.data.data[0].id
        console.log(`  Role found: ${def.name} (${roleIds[def.name]})`)
      } else {
        console.log(`  Error creating role ${def.name}: ${result.status} ${result.text}`)
      }
    }
  }
}

// ── Step 3 & 4: Read members, create users, link ───────────────────

function mapRole(pbRoles) {
  // pbRoles is a JSON array like ["user", "admin"]
  const roles = Array.isArray(pbRoles) ? pbRoles : []

  if (roles.includes('superuser')) return 'Superuser'
  if (roles.includes('admin')) return 'Admin'
  if (roles.includes('vb_admin') || roles.includes('bb_admin')) return 'Admin'
  if (roles.includes('board')) return 'Coach'
  return 'Member'
}

async function fetchAllMembers() {
  const members = []
  let page = 1
  const limit = 100

  while (true) {
    const result = await api('GET', `/items/members?limit=${limit}&page=${page}&fields=*`)
    if (!result.ok) {
      throw new Error(`Failed to fetch members: ${result.status} ${result.text}`)
    }
    const items = result.data?.data || []
    members.push(...items)
    if (items.length < limit) break
    page++
  }

  return members
}

async function createUsers() {
  console.log('\n--- Step 3: Read members ---')
  const members = await fetchAllMembers()
  console.log(`  Found ${members.length} members`)

  console.log('\n--- Step 4: Create users and link to members ---')

  let created = 0
  let skipped = 0
  let errors = 0
  let linked = 0

  for (const member of members) {
    const label = `${member.first_name || ''} ${member.last_name || ''}`.trim() || `ID:${member.id}`

    // Skip shell members
    if (member.shell) {
      skipped++
      continue
    }

    // Skip members without email
    if (!member.email) {
      skipped++
      continue
    }

    // Already linked?
    if (member.user) {
      console.log(`  [skip] ${label} - already linked to user ${member.user}`)
      skipped++
      continue
    }

    // Determine role
    const roleName = mapRole(member.role)
    const roleId = roleIds[roleName]
    if (!roleId) {
      console.log(`  [error] ${label} - no role ID for ${roleName}`)
      errors++
      continue
    }

    // Create Directus user
    const userResult = await api('POST', '/users', {
      email: member.email,
      first_name: member.first_name || '',
      last_name: member.last_name || '',
      password: TEMP_PASSWORD,
      role: roleId,
    })

    let userId = null
    if (userResult.ok) {
      userId = userResult.data.data.id
      console.log(`  [created] ${label} (${member.email}) -> ${userId} [${roleName}]`)
      created++
    } else if (userResult.text?.includes('unique') || userResult.text?.includes('already')) {
      // Duplicate email - try to find existing user
      const findResult = await api('GET', `/users?filter[email][_eq]=${encodeURIComponent(member.email)}`)
      if (findResult.ok && findResult.data?.data?.length > 0) {
        userId = findResult.data.data[0].id
        console.log(`  [exists] ${label} (${member.email}) -> ${userId}`)
      } else {
        console.log(`  [error] ${label} - duplicate email but could not find user: ${member.email}`)
        errors++
        continue
      }
    } else {
      console.log(`  [error] ${label} - ${userResult.status}: ${userResult.text}`)
      errors++
      continue
    }

    // Link member to user
    const linkResult = await api('PATCH', `/items/members/${member.id}`, { user: userId })
    if (linkResult.ok) {
      linked++
    } else {
      console.log(`  [error] linking ${label}: ${linkResult.status} ${linkResult.text}`)
      errors++
    }
  }

  console.log('\n=== Summary ===')
  console.log(`  Total members:  ${members.length}`)
  console.log(`  Users created:  ${created}`)
  console.log(`  Skipped:        ${skipped} (shell, no email, or already linked)`)
  console.log(`  Linked:         ${linked}`)
  console.log(`  Errors:         ${errors}`)
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  await auth()
  await createUserField()
  await createRoles()
  await createUsers()
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
