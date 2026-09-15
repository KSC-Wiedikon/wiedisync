#!/usr/bin/env node
// Idempotent seed for Plan 02 harness.
// Creates (or reuses) a throwaway team + 2 members + their conversation_members rows.
// Writes the ids to stdout as JSON, the harness reads them via env or by re-running this.

import pg from 'pg'

const DB_URL = process.env.DIRECTUS_DEV_DB_URL
if (!DB_URL) { console.error('DIRECTUS_DEV_DB_URL not set'); process.exit(2) }

const TEAM_NAME = '__messaging_plan02_test__'
const EMAIL_A = 'plan02-a@kscw.test'
const EMAIL_B = 'plan02-b@kscw.test'

const c = new pg.Client({ connectionString: DB_URL })
await c.connect()

async function ensureMember(email, firstName) {
  const existing = await c.query(`SELECT id FROM members WHERE LOWER(email) = LOWER($1)`, [email])
  if (existing.rows[0]) return existing.rows[0].id
  const ins = await c.query(
    `INSERT INTO members (first_name, last_name, email, role, communications_team_chat_enabled, consent_decision)
     VALUES ($1, 'Plan02', $2, '["user"]', true, 'accepted') RETURNING id`,
    [firstName, email]
  )
  return ins.rows[0].id
}

async function ensureTeam() {
  const existing = await c.query(`SELECT id FROM teams WHERE name = $1`, [TEAM_NAME])
  if (existing.rows[0]) return existing.rows[0].id
  const ins = await c.query(
    `INSERT INTO teams (name, sport, season) VALUES ($1, 'volleyball', '2025/26') RETURNING id`,
    [TEAM_NAME]
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

async function getConversationId(teamId) {
  const r = await c.query(
    `SELECT id FROM conversations WHERE team = $1 AND type = 'team' LIMIT 1`,
    [teamId]
  )
  return r.rows[0]?.id
}

async function unarchiveConvMember(convId, memberId) {
  await c.query(
    `UPDATE conversation_members SET archived = false, muted = false
     WHERE conversation = $1 AND member = $2`,
    [convId, memberId]
  )
}

try {
  const memberA = await ensureMember(EMAIL_A, 'Alpha')
  const memberB = await ensureMember(EMAIL_B, 'Bravo')
  const teamId = await ensureTeam()
  await ensureMemberTeam(memberA, teamId)  // triggers Plan 01 Trigger 1
  await ensureMemberTeam(memberB, teamId)
  const convId = await getConversationId(teamId)
  if (!convId) throw new Error('Team conversation row not created — Plan 01 Trigger 6 may not be active')
  await unarchiveConvMember(convId, memberA)
  await unarchiveConvMember(convId, memberB)
  // Clear any leftover messages from prior harness runs
  await c.query(`DELETE FROM messages WHERE conversation = $1`, [convId])
  console.log(JSON.stringify({ teamId, convId, memberA, memberB }))
} finally {
  await c.end()
}
