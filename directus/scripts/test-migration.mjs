/**
 * KSCW Directus Migration Validation Tests
 *
 * Validates data integrity after PB → Directus migration.
 * Run with: node scripts/test-migration.mjs
 */

const DIRECTUS_URL = process.env.DIRECTUS_URL || 'http://localhost:8055'
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@kscw.ch'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD
if (!ADMIN_PASSWORD) { console.error('Missing ADMIN_PASSWORD env var'); process.exit(1) }

let token = null
let passed = 0
let failed = 0
const failures = []

// ── Helpers ──────────────────────────────────────────────────────────

async function auth() {
  const res = await fetch(`${DIRECTUS_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  })
  const { data } = await res.json()
  token = data.access_token
}

async function query(path) {
  const res = await fetch(`${DIRECTUS_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`)
  return (await res.json()).data
}

async function count(collection) {
  const res = await fetch(`${DIRECTUS_URL}/items/${collection}?aggregate[count]=*`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const { data } = await res.json()
  return Number(data[0].count)
}

function test(name, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${name}`)
    passed++
  } else {
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
    failed++
    failures.push(name)
  }
}

// ── Test suites ─────────────────────────────────────────────────────

async function testRecordCounts() {
  console.log('\n═══ 1. Record Counts ═══')

  // Expected counts from migration output (3903 total)
  const expected = {
    halls: 12,
    teams: 33,
    members: 465,
    member_teams: 663,
    hall_slots: 54,
    hall_closures: 600,
    games: 400,
    trainings: 373,
    events: 4,
    rankings: 732,
    participations: 106,
    absences: 5,
    hall_events: 126,
    notifications: 245,
    user_logs: 310,
    app_settings: 1,
    event_sessions: 2,
  }

  for (const [collection, exp] of Object.entries(expected)) {
    const actual = await count(collection)
    test(`${collection}: ${actual} records`, actual === exp, `expected ${exp}, got ${actual}`)
  }
}

async function testRelations() {
  console.log('\n═══ 2. M2O Relations ═══')

  // Games should have kscw_team linked
  const games = await query('/items/games?filter[kscw_team][_nnull]=true&limit=1&fields=id,kscw_team,hall')
  test('games.kscw_team is set', games.length > 0 && games[0].kscw_team != null)

  // Games with hall relation
  const gamesWithHall = await query('/items/games?filter[hall][_nnull]=true&limit=1&fields=id,hall')
  test('games.hall is set', gamesWithHall.length > 0 && gamesWithHall[0].hall != null)

  // member_teams has member + team
  const mt = await query('/items/member_teams?limit=1&fields=id,member,team')
  test('member_teams.member is set', mt.length > 0 && mt[0].member != null)
  test('member_teams.team is set', mt.length > 0 && mt[0].team != null)

  // trainings has team + hall
  const tr = await query('/items/trainings?filter[team][_nnull]=true&limit=1&fields=id,team,hall')
  test('trainings.team is set', tr.length > 0 && tr[0].team != null)

  // rankings has team
  const rk = await query('/items/rankings?filter[team][_nnull]=true&limit=1&fields=id,team')
  test('rankings.team is set', rk.length > 0 && rk[0].team != null)

  // participations has member
  const pt = await query('/items/participations?filter[member][_nnull]=true&limit=1&fields=id,member')
  test('participations.member is set', pt.length > 0 && pt[0].member != null)

  // notifications has member
  const nt = await query('/items/notifications?filter[member][_nnull]=true&limit=1&fields=id,member')
  test('notifications.member is set', nt.length > 0 && nt[0].member != null)
}

async function testM2M() {
  console.log('\n═══ 3. M2M Relations ═══')

  // teams_coach junction
  const coachCount = await count('teams_coach')
  test(`teams_coach: ${coachCount} links`, coachCount === 16, `expected 16`)

  // teams_captain junction
  const captainCount = await count('teams_captain')
  test(`teams_captain: ${captainCount} links`, captainCount === 4, `expected 4`)

  // teams_team_responsible junction
  const trCount = await count('teams_team_responsible')
  test(`teams_team_responsible: ${trCount} links`, trCount === 8, `expected 8`)

  // events_teams junction
  const etCount = await count('events_teams')
  test(`events_teams: ${etCount} links`, etCount === 2, `expected 2`)
}

async function testDeepQueries() {
  console.log('\n═══ 4. Deep Relation Queries ═══')

  // Fetch a team with its coaches (M2M through junction — query junction directly)
  try {
    const junctions = await query('/items/teams_coach?fields=teams_id.name,members_id.first_name,members_id.last_name&limit=1')
    test('teams_coach junction → team + member deep query works',
      junctions.length > 0 && junctions[0].teams_id?.name && junctions[0].members_id?.first_name)
  } catch (e) {
    test('teams_coach junction → team + member deep query works', false, e.message.slice(0, 80))
  }

  // Fetch a game with kscw_team name (M2O deep)
  try {
    const gamesDeep = await query('/items/games?fields=id,game_id,kscw_team.name&filter[kscw_team][_nnull]=true&limit=1')
    test('game → kscw_team.name deep query works',
      gamesDeep.length > 0 && typeof gamesDeep[0].kscw_team?.name === 'string')
  } catch (e) {
    test('game → kscw_team.name deep query works', false, e.message.slice(0, 80))
  }

  // Fetch member_teams with member + team expanded
  try {
    const mtDeep = await query('/items/member_teams?fields=id,member.first_name,member.last_name,team.name&limit=1')
    test('member_teams → member + team deep query works',
      mtDeep.length > 0 && mtDeep[0].member?.first_name && mtDeep[0].team?.name)
  } catch (e) {
    test('member_teams → member + team deep query works', false, e.message.slice(0, 80))
  }

  // Fetch training with team expanded
  try {
    const trDeep = await query('/items/trainings?fields=id,date,team.name&filter[team][_nnull]=true&limit=1')
    test('training → team.name deep query works',
      trDeep.length > 0 && typeof trDeep[0].team?.name === 'string')
  } catch (e) {
    test('training → team.name deep query works', false, e.message.slice(0, 80))
  }
}

async function testFiles() {
  console.log('\n═══ 5. File Uploads ═══')

  // Members with photos
  const membersWithPhoto = await query('/items/members?filter[photo][_nnull]=true&limit=3&fields=id,first_name,photo')
  test('members have photo files', membersWithPhoto.length > 0)

  if (membersWithPhoto.length > 0) {
    // Verify file is accessible
    const fileId = membersWithPhoto[0].photo
    const fileRes = await fetch(`${DIRECTUS_URL}/assets/${fileId}`, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: 'manual',
    })
    test('photo file is accessible', fileRes.status === 200 || fileRes.status === 302)
  }

  // Teams with team_picture
  const teamsWithPic = await query('/items/teams?filter[team_picture][_nnull]=true&limit=1&fields=id,name,team_picture')
  test('teams have team_picture files', teamsWithPic.length > 0)
}

async function testAuth() {
  console.log('\n═══ 6. Auth & Users ═══')

  // Count directus_users (excluding admin)
  const users = await query('/users?limit=1&aggregate[count]=*')
  // users endpoint returns differently
  const usersRes = await fetch(`${DIRECTUS_URL}/users?aggregate[count]=*`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const usersData = await usersRes.json()
  const userCount = Number(usersData.data[0].count)
  test(`directus_users count: ${userCount}`, userCount >= 464, `expected ≥464 (464 members + admin)`)

  // Members have user field linked
  const linkedMembers = await fetch(
    `${DIRECTUS_URL}/items/members?filter[user][_nnull]=true&aggregate[count]=*`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  const linkedData = await linkedMembers.json()
  const linkedCount = Number(linkedData.data[0].count)
  test(`members linked to users: ${linkedCount}`, linkedCount >= 460, `expected ≥460`)

  // Roles exist
  const roles = await query('/roles')
  const roleNames = roles.map(r => r.name)
  test('Member role exists', roleNames.includes('Member'))
  test('Coach role exists', roleNames.includes('Coach'))
  test('Admin role exists', roleNames.includes('Admin'))
  test('Superuser role exists', roleNames.includes('Superuser'))

  // Test login as a member
  const aMember = await query('/items/members?filter[email][_nempty]=true&filter[shell][_eq]=false&limit=1&fields=email')
  if (aMember.length > 0) {
    const loginRes = await fetch(`${DIRECTUS_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: aMember[0].email, password: process.env.TEMP_PASSWORD || '' }),
    })
    test(`member login works (${aMember[0].email})`, loginRes.ok, `status: ${loginRes.status}`)
  }
}

async function testDataIntegrity() {
  console.log('\n═══ 7. Data Integrity ═══')

  // All games have game_id
  const gamesNoId = await fetch(
    `${DIRECTUS_URL}/items/games?filter[game_id][_null]=true&aggregate[count]=*`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  const noIdData = await gamesNoId.json()
  const noIdCount = Number(noIdData.data[0].count)
  test('all games have game_id', noIdCount === 0, `${noIdCount} games missing game_id`)

  // All members have email
  const noEmail = await fetch(
    `${DIRECTUS_URL}/items/members?filter[email][_null]=true&aggregate[count]=*`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  const noEmailData = await noEmail.json()
  const noEmailCount = Number(noEmailData.data[0].count)
  test('all members have email', noEmailCount === 0, `${noEmailCount} members missing email`)

  // Rankings have team_name
  const rkNoName = await fetch(
    `${DIRECTUS_URL}/items/rankings?filter[team_name][_null]=true&aggregate[count]=*`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  const rkData = await rkNoName.json()
  const rkNoNameCount = Number(rkData.data[0].count)
  test('all rankings have team_name', rkNoNameCount === 0, `${rkNoNameCount} missing`)

  // No orphan member_teams (member exists)
  const orphanMt = await fetch(
    `${DIRECTUS_URL}/items/member_teams?filter[member][_null]=true&aggregate[count]=*`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  const orphanData = await orphanMt.json()
  const orphanCount = Number(orphanData.data[0].count)
  test('no orphan member_teams (member null)', orphanCount === 0, `${orphanCount} orphans`)

  // Hall_closures have hall
  const closuresNoHall = await fetch(
    `${DIRECTUS_URL}/items/hall_closures?filter[hall][_null]=true&aggregate[count]=*`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  const closuresData = await closuresNoHall.json()
  const closuresCount = Number(closuresData.data[0].count)
  test('all hall_closures have hall', closuresCount === 0, `${closuresCount} missing`)

  // Spot check: a specific team name exists
  const h1 = await query('/items/teams?filter[name][_contains]=H1&limit=1&fields=id,name,sport')
  test('team "H1" exists', h1.length > 0 && h1[0].sport === 'volleyball')
}

async function testSchemaGaps() {
  console.log('\n═══ 8. Schema Gap Fixes ═══')

  // members.requested_team field exists
  const memberFields = await query('/fields/members')
  const hasRequestedTeam = memberFields.some(f => f.field === 'requested_team')
  test('members.requested_team field exists', hasRequestedTeam)

  // members.user field exists
  const hasUser = memberFields.some(f => f.field === 'user')
  test('members.user field exists', hasUser)

  // hall_events_halls was dropped in migration 252 (never populated) —
  // assert it stays gone.
  try {
    const heh = await fetch(`${DIRECTUS_URL}/items/hall_events_halls?limit=0`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    test('hall_events_halls junction stays dropped (252)', !heh.ok)
  } catch {
    test('hall_events_halls junction stays dropped (252)', true)
  }

  // hall_slots_teams junction exists
  try {
    const hst = await fetch(`${DIRECTUS_URL}/items/hall_slots_teams?limit=0`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    test('hall_slots_teams junction table exists', hst.ok)
  } catch {
    test('hall_slots_teams junction table exists', false)
  }
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log('🧪 KSCW Directus Migration Tests\n')

  await auth()

  await testRecordCounts()
  await testRelations()
  await testM2M()
  await testDeepQueries()
  await testFiles()
  await testAuth()
  await testDataIntegrity()
  await testSchemaGaps()

  console.log('\n═══════════════════════════════════════')
  console.log(`   Passed: ${passed}`)
  console.log(`   Failed: ${failed}`)
  if (failures.length > 0) {
    console.log(`\n   Failures:`)
    failures.forEach(f => console.log(`     - ${f}`))
  }
  console.log('═══════════════════════════════════════\n')

  process.exit(failed > 0 ? 1 : 0)
}

main().catch(err => {
  console.error('💥 Test error:', err)
  process.exit(1)
})
