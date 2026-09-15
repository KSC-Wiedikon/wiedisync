#!/usr/bin/env node
// Idempotent Plan 03 seed — third test member on a non-shared team, plus
// teardown of any DM/request/block state between (plan02-a, plan02-b, plan03-c).
// Writes the three member ids + their two team ids to stdout as JSON.

import pg from 'pg'

const DB_URL = process.env.DIRECTUS_DEV_DB_URL
if (!DB_URL) { console.error('DIRECTUS_DEV_DB_URL not set'); process.exit(2) }

const TEAM_AB_NAME = '__messaging_plan02_test__'     // plan02-a, plan02-b
const TEAM_C_NAME  = '__messaging_plan03_test__'     // plan03-c only
const EMAIL_A = 'plan02-a@kscw.test'
const EMAIL_B = 'plan02-b@kscw.test'
const EMAIL_C = 'plan03-c@kscw.test'

const c = new pg.Client({ connectionString: DB_URL })
await c.connect()

async function ensureMember(email, firstName) {
  const existing = await c.query(`SELECT id FROM members WHERE LOWER(email) = LOWER($1)`, [email])
  if (existing.rows[0]) return existing.rows[0].id
  const ins = await c.query(
    `INSERT INTO members (first_name, last_name, email, role, communications_team_chat_enabled, communications_dm_enabled, consent_decision)
     VALUES ($1, 'Plan03', $2, '["user"]', true, true, 'accepted') RETURNING id`,
    [firstName, email]
  )
  return ins.rows[0].id
}

async function ensureTeam(name) {
  const existing = await c.query(`SELECT id FROM teams WHERE name = $1`, [name])
  if (existing.rows[0]) return existing.rows[0].id
  const ins = await c.query(
    `INSERT INTO teams (name, sport, season) VALUES ($1, 'volleyball', '2025/26') RETURNING id`,
    [name]
  )
  return ins.rows[0].id
}

async function ensureMemberTeam(memberId, teamId) {
  const existing = await c.query(
    `SELECT id FROM member_teams WHERE member = $1 AND team = $2 AND season = '2025/26'`,
    [memberId, teamId]
  )
  if (existing.rows[0]) return
  await c.query(
    `INSERT INTO member_teams (member, team, season) VALUES ($1, $2, '2025/26')`,
    [memberId, teamId]
  )
}

try {
  const memberA = await ensureMember(EMAIL_A, 'Alpha')
  const memberB = await ensureMember(EMAIL_B, 'Bravo')
  const memberC = await ensureMember(EMAIL_C, 'Charlie')
  const teamAB = await ensureTeam(TEAM_AB_NAME)
  const teamC  = await ensureTeam(TEAM_C_NAME)
  await ensureMemberTeam(memberA, teamAB)
  await ensureMemberTeam(memberB, teamAB)
  await ensureMemberTeam(memberC, teamC)

  // Re-enable DM opt-in for all three (Plan 02's opt-out test leaves a=false
  // unless its `finally` ran).
  await c.query(
    `UPDATE members SET communications_team_chat_enabled = true,
                         communications_dm_enabled = true
       WHERE id = ANY($1::int[])`,
    [[memberA, memberB, memberC]]
  )

  // Teardown: any DM/request conversations between any pair of (A, B, C), plus
  // any blocks between them. Harness tests assume a clean slate.
  await c.query(
    `DELETE FROM conversations
      WHERE type IN ('dm','dm_request')
        AND id IN (
          SELECT cm1.conversation
            FROM conversation_members cm1
            JOIN conversation_members cm2 ON cm1.conversation = cm2.conversation
           WHERE cm1.member = ANY($1::int[])
             AND cm2.member = ANY($1::int[])
             AND cm1.member <> cm2.member
        )`,
    [[memberA, memberB, memberC]]
  )
  await c.query(
    `DELETE FROM blocks
       WHERE blocker = ANY($1::int[])
          OR blocked = ANY($1::int[])`,
    [[memberA, memberB, memberC]]
  )

  console.log(JSON.stringify({ teamAB, teamC, memberA, memberB, memberC }))
} finally {
  await c.end()
}
