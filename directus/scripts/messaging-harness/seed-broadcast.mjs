#!/usr/bin/env node
// Idempotent seed for the Broadcast Plan-01 / B7 integration harness.
//
// Provisions (only if missing):
//   - Test team (`__broadcast_test_team__`, volleyball, 2025/26)
//   - Test event (`__broadcast_test_event__`) linked to the team
//   - Test training tied to the team (today + 14d, 19:00–20:30)
//   - Rate-limit training (separate, also tied to the team) — used only by
//     assertion 7 so its `broadcasts` audit slot doesn't collide with the
//     happy-path send.
//   - 5 test members on the team:
//        broadcast-test-a@kscw.test  (confirmed)
//        broadcast-test-b@kscw.test  (tentative)
//        broadcast-test-c@kscw.test  (declined)
//        broadcast-test-d@kscw.test  (confirmed)
//        broadcast-test-e@kscw.test  (confirmed)
//     All emails use the RFC-2606 reserved `.test` TLD so no real inbox is
//     ever spammed when assertions trigger fan-out — the SMTP relay accepts
//     submission but the addresses bounce silently downstream.
//   - Participations on the test training: 3 confirmed, 1 tentative, 1 declined.
//     Lets assertion 1 see recipientCount=3, assertion 3 see =4 (statuses
//     ['confirmed','tentative']), and assertion 13 see =0 (status 'waitlist'
//     — note the DB stores 'waitlisted' so the audience filter matches nothing).
//   - 1 row in `event_signups`: form_slug='broadcast-test', external (is_member=false).
//
// Re-runnable without duplicating rows. Resets all `broadcasts` audit rows for
// both test trainings + the test event so rate-limit + happy-path assertions
// start from a clean slate every run.
//
// Writes the resolved ids to stdout as a single JSON line that the harness reads.

import pg from 'pg'

const DB_URL = process.env.DIRECTUS_DEV_DB_URL
if (!DB_URL) { console.error('DIRECTUS_DEV_DB_URL not set'); process.exit(2) }

const TEAM_NAME      = '__broadcast_test_team__'
const EVENT_TITLE    = '__broadcast_test_event__'
const EMAIL_A        = 'broadcast-test-a@kscw.test'   // confirmed
const EMAIL_B        = 'broadcast-test-b@kscw.test'   // tentative
const EMAIL_C        = 'broadcast-test-c@kscw.test'   // declined
const EMAIL_D        = 'broadcast-test-d@kscw.test'   // confirmed
const EMAIL_E        = 'broadcast-test-e@kscw.test'   // confirmed
const EXT_EMAIL      = 'broadcast-ext@example.com'
const EXT_FORM_SLUG  = 'broadcast-test'

const c = new pg.Client({ connectionString: DB_URL })
await c.connect()

async function ensureMember(email, firstName) {
  const existing = await c.query(`SELECT id FROM members WHERE LOWER(email) = LOWER($1)`, [email])
  if (existing.rows[0]) {
    // make sure they're active so resolveAudience picks them up
    await c.query(`UPDATE members SET wiedisync_active = true WHERE id = $1`, [existing.rows[0].id])
    return existing.rows[0].id
  }
  const ins = await c.query(
    `INSERT INTO members (first_name, last_name, email, role, wiedisync_active, communications_team_chat_enabled, consent_decision)
     VALUES ($1, 'BroadcastTest', $2, '["user"]', true, true, 'accepted') RETURNING id`,
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

async function ensureEvent(teamId) {
  const existing = await c.query(`SELECT id FROM events WHERE title = $1 LIMIT 1`, [EVENT_TITLE])
  let eventId
  if (existing.rows[0]) {
    eventId = existing.rows[0].id
  } else {
    // 14 days out, 1h slot
    const ins = await c.query(
      `INSERT INTO events (title, description, event_type, start_date, end_date, all_day, location)
         VALUES ($1, 'broadcast harness event', 'social', NOW() + interval '14 days', NOW() + interval '14 days 1 hour', false, 'Test Hall')
         RETURNING id`,
      [EVENT_TITLE]
    )
    eventId = ins.rows[0].id
  }
  // Make sure the team is linked (events_teams junction)
  const link = await c.query(
    `SELECT id FROM events_teams WHERE events_id = $1 AND teams_id = $2`, [eventId, teamId]
  )
  if (!link.rows[0]) {
    await c.query(
      `INSERT INTO events_teams (events_id, teams_id) VALUES ($1, $2)`, [eventId, teamId]
    )
  }
  return eventId
}

async function ensureTraining(teamId, marker) {
  // Idempotent on (team, notes) — reuse if a row exists with the same marker note.
  const existing = await c.query(
    `SELECT id FROM trainings WHERE team = $1 AND notes = $2 LIMIT 1`,
    [teamId, marker]
  )
  if (existing.rows[0]) return existing.rows[0].id
  const ins = await c.query(
    `INSERT INTO trainings (team, date, start_time, end_time, hall_name, notes)
       VALUES ($1, (CURRENT_DATE + interval '14 days')::date, '19:00:00', '20:30:00', 'Test Hall', $2)
       RETURNING id`,
    [teamId, marker]
  )
  return ins.rows[0].id
}

async function ensureParticipation(activityType, activityId, memberId, status) {
  // participations.activity_id is text — see resolveAudience() join cast.
  const existing = await c.query(
    `SELECT id FROM participations
       WHERE activity_type = $1 AND activity_id = $2 AND member = $3`,
    [activityType, String(activityId), memberId]
  )
  if (existing.rows[0]) {
    await c.query(`UPDATE participations SET status = $1 WHERE id = $2`,
      [status, existing.rows[0].id])
    return existing.rows[0].id
  }
  const ins = await c.query(
    `INSERT INTO participations (activity_type, activity_id, member, status)
       VALUES ($1, $2, $3, $4) RETURNING id`,
    [activityType, String(activityId), memberId, status]
  )
  return ins.rows[0].id
}

async function ensureExternalSignup(eventId) {
  const existing = await c.query(
    `SELECT id FROM event_signups WHERE event = $1 AND form_slug = $2 AND LOWER(email) = LOWER($3) LIMIT 1`,
    [eventId, EXT_FORM_SLUG, EXT_EMAIL]
  )
  if (existing.rows[0]) return existing.rows[0].id
  const ins = await c.query(
    `INSERT INTO event_signups (event, form_slug, name, email, is_member)
       VALUES ($1, $2, 'Test External', $3, false) RETURNING id`,
    [eventId, EXT_FORM_SLUG, EXT_EMAIL]
  )
  return ins.rows[0].id
}

async function clearBroadcastAudit(activityType, activityIds) {
  if (!activityIds.length) return
  await c.query(
    `DELETE FROM broadcasts WHERE activity_type = $1 AND activity_id = ANY($2::int[])`,
    [activityType, activityIds]
  )
}

async function clearActivityChat(activityType, activityId) {
  // Delete any existing activity_chat conversation for this activity.
  // Messages are FK ON DELETE CASCADE from conversations, so this also
  // removes all messages and conversation_members for the conversation.
  await c.query(
    `DELETE FROM conversations
      WHERE type = 'activity_chat'
        AND activity_type = $1
        AND activity_id   = $2`,
    [activityType, activityId]
  )
}

async function ensureEventParticipations(eventId, memberIds) {
  // Ensure each memberId has a confirmed participation on the event.
  for (const memberId of memberIds) {
    await ensureParticipation('event', eventId, memberId, 'confirmed')
  }
}

try {
  const memberA = await ensureMember(EMAIL_A, 'Alpha')
  const memberB = await ensureMember(EMAIL_B, 'Bravo')
  const memberC = await ensureMember(EMAIL_C, 'Charlie')
  const memberD = await ensureMember(EMAIL_D, 'Delta')
  const memberE = await ensureMember(EMAIL_E, 'Echo')
  const teamId  = await ensureTeam()
  await ensureMemberTeam(memberA, teamId)
  await ensureMemberTeam(memberB, teamId)
  await ensureMemberTeam(memberC, teamId)
  await ensureMemberTeam(memberD, teamId)
  await ensureMemberTeam(memberE, teamId)

  const eventId          = await ensureEvent(teamId)
  const trainingId       = await ensureTraining(teamId, '__broadcast_test_training__')
  const rateLimitTraining = await ensureTraining(teamId, '__broadcast_ratelimit_training__')

  await ensureParticipation('training', trainingId, memberA, 'confirmed')
  await ensureParticipation('training', trainingId, memberB, 'tentative')
  await ensureParticipation('training', trainingId, memberC, 'declined')
  await ensureParticipation('training', trainingId, memberD, 'confirmed')
  await ensureParticipation('training', trainingId, memberE, 'confirmed')

  // External signup on the test event
  const externalId = await ensureExternalSignup(eventId)

  // Ensure the event has ≥2 confirmed participations (for inApp assertions).
  // Members A and D are already confirmed on the training; add them to the
  // event as well. This is idempotent — ensureParticipation UPSERTs.
  await ensureEventParticipations(eventId, [memberA, memberD])

  // Wipe audit history on the three test activities so prior runs don't leak
  // into rate-limit assertions.
  await clearBroadcastAudit('training', [trainingId, rateLimitTraining])
  await clearBroadcastAudit('event',    [eventId])

  // Wipe any prior activity_chat conversation for the test event so the
  // inApp happy-path assertion always starts from a clean state and doesn't
  // hit the 20-min rate-limit gap from a previous run.
  await clearActivityChat('event', eventId)

  console.log(JSON.stringify({
    teamId,
    eventId,
    trainingId,
    rateLimitTraining,
    memberA, memberB, memberC, memberD, memberE,
    externalSignupId: externalId,
  }))
} finally {
  await c.end()
}
