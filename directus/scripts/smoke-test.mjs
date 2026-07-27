#!/usr/bin/env node
/**
 * smoke-test.mjs — Post-deploy permission smoke test.
 *
 * Logs in as a non-admin Member and exercises the same critical reads that
 * `loadTeamContext` + the home page kick off. Asserts no 403/400/500. The
 * point is to catch the silent-Promise.all-failure pattern — when a single
 * collection lacks its KSCW Member read row, the whole `loadTeamContext`
 * resolves empty and the user sees nothing, but no UI surface breaks
 * loudly.
 *
 * Required env vars (loaded from `.env.test` if present):
 *   SMOKE_TEST_URL       Directus base URL (https://directus-dev.kscw.ch)
 *   SMOKE_TEST_EMAIL     test member email
 *   SMOKE_TEST_PASSWORD  test member password
 *
 * Usage:
 *   node directus/scripts/smoke-test.mjs
 *   node directus/scripts/smoke-test.mjs --url=https://directus.kscw.ch --email=… --password=…
 *
 * Exits 0 on success, non-zero on any 4xx or 5xx encountered.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── Lightweight .env.test loader ──────────────────────────────────
function loadDotEnv(path) {
  try {
    const text = readFileSync(path, 'utf-8')
    for (const line of text.split('\n')) {
      // Accept optional `export ` prefix + whitespace around `=` so shell-style
      // .env files (`export DIRECTUS_DEV_TOKEN=…`) load correctly, not just bare KEY=value.
      const m = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
      if (m && !(m[1] in process.env)) {
        process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '')
      }
    }
  } catch { /* missing file is fine */ }
}
loadDotEnv(join(__dirname, '../../.env.test'))
loadDotEnv(join(__dirname, '../../.env.local'))

// ── Args ──────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => { const [k, ...rest] = a.slice(2).split('='); return [k, rest.join('=') || true] })
)

const URL = args.url || process.env.SMOKE_TEST_URL || 'https://directus-dev.kscw.ch'
// Prefer a long-lived Member token from .env.local. Resolution order:
//   1. --token flag / SMOKE_TEST_TOKEN
//   2. DIRECTUS_DEV_USER_TOKEN_MEMBER  (when URL targets dev)
//   3. DIRECTUS_PROD_USER_TOKEN_MEMBER (when URL targets prod)
// Email/password path retired — .env.test is PocketBase-era and unreliable.
const PRESET_TOKEN = args.token
  || process.env.SMOKE_TEST_TOKEN
  || (URL.includes('directus-dev') ? process.env.DIRECTUS_DEV_USER_TOKEN_MEMBER : '')
  || (URL.includes('directus.kscw.ch') ? process.env.DIRECTUS_PROD_USER_TOKEN_MEMBER : '')
  || ''

if (!PRESET_TOKEN) {
  console.error(`Missing token. Set SMOKE_TEST_TOKEN or DIRECTUS_${URL.includes('directus-dev') ? 'DEV' : 'PROD'}_USER_TOKEN_MEMBER in .env.local.`)
  process.exit(1)
}

let token = null
const failures = []
const checks = []

async function api(method, path, body) {
  const res = await fetch(`${URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* */ }
  return { status: res.status, ok: res.ok, json, text }
}

async function check(label, fn) {
  process.stdout.write(`  ${label} … `)
  try {
    const result = await fn()
    if (result?.status && (result.status >= 400)) {
      console.log(`✗ ${result.status}`)
      failures.push({ label, status: result.status, body: (result.text || '').slice(0, 200) })
      checks.push({ label, ok: false, status: result.status })
      return result
    }
    console.log(`✓`)
    checks.push({ label, ok: true, status: result?.status })
    return result
  } catch (err) {
    console.log(`✗ ${err.message}`)
    failures.push({ label, error: err.message })
    checks.push({ label, ok: false, error: err.message })
  }
}

async function main() {
  console.log(`[smoke] Target: ${URL}`)
  console.log(`[smoke] Auth:   preset token\n`)
  token = PRESET_TOKEN

  // 2. Resolve self
  const me = await check('users/me', () => api('GET', '/users/me?fields=id,role'))

  const memberRow = await check('members/self', async () => {
    const r = await api('GET', `/items/members?filter[user][_eq]=${me.json.data.id}&fields=id,first_name,role`)
    return r
  })
  const memberId = memberRow?.json?.data?.[0]?.id

  // 3. The reads that loadTeamContext + Layout fire on every page load.
  // If any of these returns 4xx for a Member role, the silent Promise.all
  // failure pattern is back.
  await check('member_teams (own)', () => api('GET', `/items/member_teams?filter[member][_eq]=${memberId}&fields=team.id,team.name,guest_level`))
  // loadTeamContext fans these two junctions out in the SAME Promise.all as
  // member_teams — a lost read row on either silently empties the entire team
  // context (coach/TR scoping) without any loud surface error (4.4.4 class).
  await check('teams_coaches (own)', () => api('GET', `/items/teams_coaches?filter[members_id][_eq]=${memberId}&fields=teams_id&limit=10`))
  await check('teams_responsibles (own)', () => api('GET', `/items/teams_responsibles?filter[members_id][_eq]=${memberId}&fields=teams_id&limit=10`))
  await check('teams (active)', () => api('GET', '/items/teams?filter[active][_eq]=true&limit=10'))
  await check('games (10)', () => api('GET', '/items/games?limit=10&fields=id,date,kscw_team'))
  await check('trainings (my-teams)', () => api('GET', '/items/trainings?limit=10&fields=id,date,team'))
  await check('events (visible)', () => api('GET', '/items/events?limit=10&fields=id,title,event_type'))
  await check('participations (own)', () => api('GET', `/items/participations?filter[member][_eq]=${memberId}&limit=10`))
  await check('absences (own)', () => api('GET', `/items/absences?filter[member][_eq]=${memberId}&limit=10`))
  await check('notifications (own)', () => api('GET', `/items/notifications?filter[member][_eq]=${memberId}&limit=10`))
  await check('blocks (own)', () => api('GET', `/items/blocks?filter[blocker][user][_eq]=${me.json.data.id}&limit=10`))
  await check('spielplaner_assignments (own)', () => api('GET', `/items/spielplaner_assignments?filter[member][_eq]=${memberId}&limit=10`))
  // HomePage / Layout reads. A lost read row on any of these silently empties a
  // home surface (the same class as the 2026-06-07 fine_rules incident, where a
  // bad fine_rules.read filter `Invalid query`'d every member's home + roster
  // editor with no console error). Each must not 4xx/5xx for a Member.
  await check('rankings', () => api('GET', '/items/rankings?limit=10'))
  await check('fine_rules (visible)', () => api('GET', '/items/fine_rules?limit=10'))
  await check('forms (open)', () => api('GET', `/items/forms?filter[status][_eq]=open&limit=10&fields=id,title,status`))
  // Conversations back the inbox unread badge (Layout) + the inbox list, but the
  // app reads them via the /kscw/messaging/conversations custom endpoint — there
  // is deliberately NO Member direct /items/conversations read grant — so probe
  // the real path (mirrors the sv_vm_check endpoint check above).
  await check('kscw/messaging/conversations', () => api('GET', '/kscw/messaging/conversations'))
  // Direct sv_vm_check.read REVOKED for KSCW Member; access goes through
  // the /kscw/sv-licence/me custom endpoint instead. Confirm direct read
  // 403s AND the endpoint responds.
  await check('sv_vm_check direct (must 403)', async () => {
    const r = await api('GET', '/items/sv_vm_check?limit=1')
    // Treat 403 as the expected outcome: rewrite to {ok: true} for the harness.
    return r.status === 403 ? { ...r, status: 200, ok: true } : { ...r, status: 500 /* anything other than 403 is a failure */ }
  })
  await check('kscw/sv-licence/me', () => api('GET', '/kscw/sv-licence/me'))
  // tasks check removed — collection retired in migration 257 (2026-07-27).
  // Expense submissions (migration 177) — member reads OWN rows on /finance/expense
  // ("My submissions"); policy scopes to own, so an unfiltered read must not 4xx.
  await check('finance_expenses (own)', () => api('GET', '/items/finance_expenses?limit=10&fields=id,amount,status'))
  await check('feedback (own)', () => api('GET', `/items/feedback?limit=10`))
  await check('announcements (published)', () => api('GET', '/items/announcements?limit=10'))
  await check('user_logs (own)', () => api('GET', `/items/user_logs?limit=10`))

  // 4. Custom endpoint sanity
  await check('kscw/web-push/vapid-public-key', () => api('GET', '/kscw/web-push/vapid-public-key'))

  // 4b. Negative LEADER assertions — runs only if a coach token is present
  // in .env.local. Catches the v4.8.1 LEADER-per-user regression class where
  // an unfiltered LEADER policy lets coaches read/write across the whole club.
  // Resolution order mirrors the Member token:
  //   1. --coach-token / SMOKE_TEST_COACH_TOKEN
  //   2. DIRECTUS_DEV_USER_TOKEN_COACH (dev URL)
  //   3. DIRECTUS_PROD_USER_TOKEN_COACH (prod URL)
  const COACH_TOKEN = args['coach-token']
    || process.env.SMOKE_TEST_COACH_TOKEN
    || (URL.includes('directus-dev') ? process.env.DIRECTUS_DEV_USER_TOKEN_COACH : '')
    || (URL.includes('directus.kscw.ch') ? process.env.DIRECTUS_PROD_USER_TOKEN_COACH : '')
    || ''

  if (COACH_TOKEN) {
    console.log('\n[smoke] Coach-token negative checks:')
    token = COACH_TOKEN
    // Identify the coach's teams so we can construct cross-team probes.
    const cme = await api('GET', '/users/me?fields=id')
    const coachMemberRow = await api('GET', `/items/members?filter[user][_eq]=${cme.json?.data?.id}&fields=id`)
    const coachMemberId = coachMemberRow.json?.data?.[0]?.id
    // The coach's FULL read scope = teams they COACH ∪ are TR for ∪ PLAY on. A
    // Team Responsible/coach is frequently ALSO a rostered player, and the MEMBER
    // policy legitimately lets them see their PLAYER-teammates' participations
    // (SAME_TEAM_AS_ME). Computing scope from coached teams ALONE produced a
    // false-positive "leak" (2026-07-06: TR 155 coaches 6/81 but plays on 11/82,
    // so seeing teammates 27/467 on 11/82 is correct, not a leak). Union all three.
    const coachTeamIds = []
    if (coachMemberId) {
      const [coached, tred, played] = await Promise.all([
        api('GET', `/items/teams?filter[coach][members_id][_eq]=${coachMemberId}&fields=id&limit=-1`),
        api('GET', `/items/teams?filter[team_responsible][members_id][_eq]=${coachMemberId}&fields=id&limit=-1`),
        api('GET', `/items/member_teams?filter[member][_eq]=${coachMemberId}&fields=team&limit=-1`),
      ])
      const s = new Set()
      for (const t of coached.json?.data || []) if (t.id != null) s.add(t.id)
      for (const t of tred.json?.data || []) if (t.id != null) s.add(t.id)
      for (const mt of played.json?.data || []) if (mt.team != null) s.add(mt.team)
      coachTeamIds.push(...s)
    }

    // 4b.1 — participations.read must NOT return rows whose member is on
    // zero teams in the coach's FULL scope (coached ∪ TR ∪ played). We probe by
    // reading participations and asserting every row's member is reachable.
    await check('participations.read scoped to coach teams', async () => {
      const r = await api('GET', '/items/participations?fields=id,member.id&limit=50')
      if (r.status >= 400) return r
      const rows = r.json?.data || []
      if (rows.length === 0 || coachTeamIds.length === 0) return { ...r, status: 200, ok: true }
      // Sample membership map for the returned members
      const memberIds = [...new Set(rows.map(p => p.member?.id).filter(Boolean))]
      if (memberIds.length === 0) return { ...r, status: 200, ok: true }
      const mtRes = await api('GET', `/items/member_teams?filter[member][_in]=${memberIds.join(',')}&fields=member,team&limit=-1`)
      const teamsByMember = new Map()
      for (const mt of mtRes.json?.data || []) {
        const m = String(mt.member); const t = mt.team
        if (!teamsByMember.has(m)) teamsByMember.set(m, new Set())
        teamsByMember.get(m).add(t)
      }
      const leaked = rows.some(p => {
        if (!p.member?.id) return false
        const ts = teamsByMember.get(String(p.member.id)) || new Set()
        return ![...ts].some(t => coachTeamIds.includes(t))
      })
      return leaked
        ? { status: 500, ok: false, json: null, text: 'participations leaked from outside coach teams' }
        : { ...r, status: 200, ok: true }
    })

    // 4b.2 — user_logs.read is REVOKED on the LEADER policy (2026-05-12), but a
    // coach also holds the MEMBER policy, which grants an OWN-scoped read (OWN_DU,
    // setup-permissions.mjs). So the correct contract is NOT "403" but "scoped to
    // the caller's own member id" — a coach must never see ANOTHER member's audit
    // rows (2026-07-06: the old "must 403" expectation was a false positive).
    await check('user_logs read scoped to own (coach)', async () => {
      const r = await api('GET', `/items/user_logs?fields=user&limit=200`)
      if (r.status === 403) return { ...r, status: 200, ok: true }   // fully revoked is also acceptable
      if (r.status >= 400) return r
      const rows = r.json?.data || []
      const foreign = rows.filter(x => x.user != null && String(x.user) !== String(coachMemberId))
      return foreign.length
        ? { status: 500, ok: false, json: null, text: `user_logs leaked ${foreign.length} foreign-member rows` }
        : { ...r, status: 200, ok: true }
    })

    // Restore Member token for any subsequent checks.
    token = PRESET_TOKEN
  } else {
    console.log('\n[smoke] (skipping coach-token negative checks — no DIRECTUS_*_USER_TOKEN_COACH set)')
  }

  // 5. Result
  console.log('\n' + '─'.repeat(50))
  console.log(`[smoke] ${checks.filter(c => c.ok).length}/${checks.length} passed`)
  if (failures.length) {
    console.log(`[smoke] FAIL — ${failures.length} failure(s):`)
    for (const f of failures) console.log(`  • ${f.label}: ${f.status || ''} ${f.error || ''} ${f.body || ''}`)
    process.exit(3)
  }
  console.log(`[smoke] ✓ All checks passed.`)
}

main().catch(err => {
  console.error(`[smoke] ✗ Fatal: ${err.message}`)
  process.exit(1)
})
