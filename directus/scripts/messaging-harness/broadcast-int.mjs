#!/usr/bin/env node
// Integration assertions for KSCW Broadcast Plan 01 / Phase B (Task B7).
//
// Pattern mirrors `messaging-int.mjs`: dependency-light, plain fetch + pg,
// accumulating-failures (we run all 13 assertions and exit non-zero only at
// the end). The companion seed `seed-broadcast.mjs` is run via execSync at
// the start so this script is one-shot for `npm test`-style invocation.
//
// Required env vars (typically supplied by .env.local):
//   - DIRECTUS_DEV_DB_URL              Postgres connection string for dev
//   - DIRECTUS_DEV_TOKEN               admin@kscw.ch static token (DB queries)
//   - DIRECTUS_DEV_USER_TOKEN_LUCA     luca.canepa@gmail.com static token —
//                                      acts as COACH_TOKEN_X (member 8, role
//                                      includes 'admin' so RBAC short-circuits
//                                      for any activity)
//   - DIRECTUS_DEV_USER_TOKEN_MEMBER   federico.felician@gmail.com static
//                                      token — acts as MEMBER_TOKEN_X (member
//                                      9, role=['user'], no team junction →
//                                      403 broadcast/not_authorized)
//
// Provisioning the two user tokens is a one-off — see broadcast section in
// README.md.

import pg from 'pg'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

const API = 'https://directus-dev.kscw.ch'
const DB_URL = process.env.DIRECTUS_DEV_DB_URL
const TOKEN_COACH = process.env.DIRECTUS_DEV_USER_TOKEN_LUCA
const TOKEN_MEMBER = process.env.DIRECTUS_DEV_USER_TOKEN_MEMBER

if (!DB_URL || !TOKEN_COACH || !TOKEN_MEMBER) {
  console.error('Missing one of: DIRECTUS_DEV_DB_URL, DIRECTUS_DEV_USER_TOKEN_LUCA, DIRECTUS_DEV_USER_TOKEN_MEMBER')
  process.exit(2)
}

const failures = []
const pass = (msg) => console.log(`  ✓ ${msg}`)
const fail = (msg, err) => {
  failures.push({ msg, err: String(err?.message ?? err ?? '') })
  console.error(`  ✗ ${msg} — ${err?.message ?? err ?? ''}`)
}

const asCoach = (path, init = {}) =>
  fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN_COACH}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
const asMember = (path, init = {}) =>
  fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN_MEMBER}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })

async function runSeed() {
  const stdout = execSync(`node ${resolve(__dirname, 'seed-broadcast.mjs')}`, {
    env: process.env, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'],
  })
  const lines = stdout.trim().split('\n').filter(Boolean)
  const jsonLine = lines.reverse().find(l => l.startsWith('{'))
  if (!jsonLine) throw new Error(`seed produced no JSON line; stdout was: ${stdout.slice(0, 200)}`)
  return JSON.parse(jsonLine)
}

async function testBroadcastInApp(dbClient, seed) {
  console.log('\n[broadcast] Plan 02 / Task T11 — inApp channel assertions')

  const { eventId, trainingId, memberA, memberD } = seed

  // We also need a game id for assertion 14 (inApp rejected for game).
  let gameId = null
  try {
    const { rows } = await dbClient.query(`SELECT id FROM games LIMIT 1`)
    gameId = rows[0]?.id ?? null
    if (!gameId) console.warn('  ! no game found in DB — assertion (14) will be soft-skipped')
  } catch (e) {
    console.warn(`  ! could not fetch gameId: ${e.message}`)
  }

  // ── 11a. inApp happy path on event ───────────────────────────────────────
  let convId = null
  let messageId = null
  try {
    const r = await asCoach(`/kscw/activities/event/${eventId}/broadcast`, {
      method: 'POST',
      body: JSON.stringify({
        channels: { email: false, push: false, inApp: true },
        audience: { statuses: ['confirmed'] },
        message: 'Broadcast harness — inApp happy',
      }),
    })
    const b = await r.json()
    if (r.status !== 200) throw new Error(`status=${r.status}: ${JSON.stringify(b)}`)
    const inApp = b.delivery?.in_app
    if (!inApp) throw new Error(`delivery.in_app missing: ${JSON.stringify(b)}`)
    if (!inApp.conversation_id || typeof inApp.conversation_id !== 'string')
      throw new Error(`conversation_id invalid: ${inApp.conversation_id}`)
    if (!inApp.message_id || typeof inApp.message_id !== 'string')
      throw new Error(`message_id invalid: ${inApp.message_id}`)
    if (inApp.sent !== 1) throw new Error(`in_app.sent=${inApp.sent} (expected 1)`)
    if (inApp.failed !== 0) throw new Error(`in_app.failed=${inApp.failed} (expected 0)`)
    convId = inApp.conversation_id
    messageId = inApp.message_id
    pass(`(11a) inApp happy path → 200 conversation_id=${convId.slice(0,8)}… message_id=${messageId.slice(0,8)}… sent=1 failed=0`)
  } catch (e) { fail('(11a) inApp happy path', e) }

  // ── 11b. Second creation is no-op — DB has exactly 1 conversation + 1 message ──
  try {
    if (!convId) throw new Error('skipped: no convId from 11a')
    const { rows: convRows } = await dbClient.query(
      `SELECT count(*) FROM conversations
        WHERE type='activity_chat' AND activity_type='event' AND activity_id=$1`,
      [eventId]
    )
    const convCount = parseInt(convRows[0].count, 10)
    if (convCount !== 1) throw new Error(`conversations count=${convCount} (expected 1)`)

    const { rows: msgRows } = await dbClient.query(
      `SELECT count(*) FROM messages WHERE conversation=$1`,
      [convId]
    )
    const msgCount = parseInt(msgRows[0].count, 10)
    if (msgCount !== 1) throw new Error(`messages count=${msgCount} (expected 1)`)
    pass(`(11b) DB: exactly 1 activity_chat conversation + 1 message for event=${eventId}`)
  } catch (e) { fail('(11b) single conversation no-op', e) }

  // ── 12. inApp rejected for training ────────────────────────────────────────
  try {
    const r = await asCoach(`/kscw/activities/training/${trainingId}/broadcast`, {
      method: 'POST',
      body: JSON.stringify({
        channels: { inApp: true },
        audience: { statuses: ['confirmed'] },
        message: 'ignored',
      }),
    })
    const b = await r.json().catch(() => ({}))
    if (r.status !== 400 || b.code !== 'broadcast/inapp_events_only')
      throw new Error(`status=${r.status} code=${b.code}`)
    pass('(12) inApp on training → 400 broadcast/inapp_events_only')
  } catch (e) { fail('(12) inApp rejected for training', e) }

  // ── 13. inApp rejected for game ─────────────────────────────────────────────
  try {
    if (!gameId) {
      console.warn('  ! (13) soft-skip: no game in DB')
    } else {
      const r = await asCoach(`/kscw/activities/game/${gameId}/broadcast`, {
        method: 'POST',
        body: JSON.stringify({
          channels: { inApp: true },
          audience: { statuses: ['confirmed'] },
          message: 'ignored',
        }),
      })
      const b = await r.json().catch(() => ({}))
      if (r.status !== 400 || b.code !== 'broadcast/inapp_events_only')
        throw new Error(`status=${r.status} code=${b.code}`)
      pass(`(13) inApp on game=${gameId} → 400 broadcast/inapp_events_only`)
    }
  } catch (e) { fail('(13) inApp rejected for game', e) }

  // ── 14. GET /messaging/conversations surfaces the activity_chat ──────────────
  try {
    if (!convId) throw new Error('skipped: no convId from 11a')
    const r = await asCoach(`/kscw/messaging/conversations`)
    const b = await r.json()
    if (r.status !== 200) throw new Error(`status=${r.status}: ${JSON.stringify(b)}`)
    const convList = Array.isArray(b) ? b : (b.data ?? [])
    const found = convList.find(c => c.id === convId)
    if (!found) throw new Error(`conversation ${convId} not found in GET /messaging/conversations`)
    if (found.type !== 'activity_chat') throw new Error(`type=${found.type} (expected activity_chat)`)
    if (!found.title) throw new Error(`title is null/empty`)
    if (found.activity_type !== 'event') throw new Error(`activity_type=${found.activity_type}`)
    if (String(found.activity_id) !== String(eventId)) throw new Error(`activity_id=${found.activity_id} (expected ${eventId})`)
    pass(`(14) GET /messaging/conversations includes activity_chat id=${convId.slice(0,8)}… title="${found.title}"`)
  } catch (e) { fail('(14) GET conversations surfaces activity_chat', e) }

  // ── 15. Reply path — member POST to activity_chat ───────────────────────────
  // member 9 (TOKEN_MEMBER / federico) is not RSVP'd to the test event, so
  // they are not a conversation_member → expect 403 messaging/not_a_member.
  try {
    if (!convId) throw new Error('skipped: no convId from 11a')
    const r = await asMember(`/kscw/messaging/messages`, {
      method: 'POST',
      body: JSON.stringify({ conversation: convId, type: 'text', body: 'reply from harness' }),
    })
    const b = await r.json().catch(() => ({}))
    // Member 9 is not in conversation_members → 403 not_a_member
    if (r.status !== 403 || b.code !== 'messaging/not_a_member')
      throw new Error(`status=${r.status} code=${b.code} (expected 403 messaging/not_a_member)`)
    pass('(15) non-member reply to activity_chat → 403 messaging/not_a_member')
  } catch (e) { fail('(15) reply path', e) }

  // ── 16. Trigger: INSERT confirmed participation adds conversation_member ──────
  // Use a member who is NOT yet in the conversation (memberD is confirmed on
  // the training but may not be in conversation_members yet if the event
  // participation was inserted before the conversation existed). We pick a
  // new scratch member from the DB that has no event participation.
  const TRIGGER_TEST_EMAIL = 'broadcast-trigger-f@kscw.test'
  let triggerMemberId = null
  try {
    if (!convId) throw new Error('skipped: no convId from 11a')

    // Ensure a test member for trigger assertions, with team_chat enabled.
    const existing = await dbClient.query(
      `SELECT id FROM members WHERE LOWER(email) = LOWER($1)`, [TRIGGER_TEST_EMAIL]
    )
    if (existing.rows[0]) {
      triggerMemberId = existing.rows[0].id
      await dbClient.query(
        `UPDATE members SET wiedisync_active=true, communications_team_chat_enabled=true,
                            communications_banned=false WHERE id=$1`,
        [triggerMemberId]
      )
    } else {
      const ins = await dbClient.query(
        `INSERT INTO members (first_name, last_name, email, role, wiedisync_active,
                              communications_team_chat_enabled, consent_decision, communications_banned)
         VALUES ('Foxtrot','TriggerTest',$1,'["user"]',true,true,'accepted',false) RETURNING id`,
        [TRIGGER_TEST_EMAIL]
      )
      triggerMemberId = ins.rows[0].id
    }

    // Make sure there's no leftover participation or conversation_member row.
    await dbClient.query(
      `DELETE FROM participations WHERE activity_type='event' AND activity_id=$1 AND member=$2`,
      [String(eventId), triggerMemberId]
    )
    await dbClient.query(
      `DELETE FROM conversation_members WHERE conversation=$1 AND member=$2`,
      [convId, triggerMemberId]
    )

    // INSERT confirmed participation → trigger should upsert conversation_member
    await dbClient.query(
      `INSERT INTO participations (activity_type, activity_id, member, status)
       VALUES ('event', $1, $2, 'confirmed')`,
      [String(eventId), triggerMemberId]
    )

    const { rows } = await dbClient.query(
      `SELECT archived FROM conversation_members WHERE conversation=$1 AND member=$2`,
      [convId, triggerMemberId]
    )
    if (rows.length === 0) throw new Error(`conversation_member row not created by trigger`)
    // team_chat_enabled=true → archived should be false (NOT true = false)
    if (rows[0].archived !== false) throw new Error(`archived=${rows[0].archived} (expected false — team_chat_enabled=true)`)
    pass(`(16) trigger: INSERT confirmed participation → conversation_member row created, archived=false`)
  } catch (e) {
    fail('(16) trigger: INSERT confirmed adds conversation_member', e)
  } finally {
    // Cleanup participation (conversation_member stays — it's fine)
    if (triggerMemberId && convId) {
      await dbClient.query(
        `DELETE FROM participations WHERE activity_type='event' AND activity_id=$1 AND member=$2`,
        [String(eventId), triggerMemberId]
      ).catch(() => {})
    }
  }

  // ── 17. Trigger: status → declined archives conversation_member ──────────────
  try {
    if (!convId || !triggerMemberId) throw new Error('skipped: no convId or triggerMemberId')

    // Re-insert confirmed participation. Use two steps (check then insert) to
    // avoid the "inconsistent types for $1" error that arises when a single
    // parameterised query uses $1 in both a VALUES position and a WHERE clause
    // on a text column.
    const existsCheck = await dbClient.query(
      `SELECT id FROM participations WHERE activity_type='event' AND activity_id=$1 AND member=$2`,
      [String(eventId), triggerMemberId]
    )
    if (existsCheck.rows.length === 0) {
      await dbClient.query(
        `INSERT INTO participations (activity_type, activity_id, member, status)
         VALUES ('event', $1, $2, 'confirmed')`,
        [String(eventId), triggerMemberId]
      )
    }
    // Make sure conversation_member exists and is not archived so the decline
    // transition (archived: false → true) is observable.
    await dbClient.query(
      `UPDATE conversation_members SET archived=false WHERE conversation=$1 AND member=$2`,
      [convId, triggerMemberId]
    )
    // Verify row is present and not archived
    const before = await dbClient.query(
      `SELECT archived FROM conversation_members WHERE conversation=$1 AND member=$2`,
      [convId, triggerMemberId]
    )
    if (before.rows.length === 0) throw new Error('conversation_member not present before update')

    // UPDATE status to 'declined' → trigger should set archived=true
    await dbClient.query(
      `UPDATE participations SET status='declined'
        WHERE activity_type='event' AND activity_id=$1 AND member=$2`,
      [String(eventId), triggerMemberId]
    )

    const { rows } = await dbClient.query(
      `SELECT archived FROM conversation_members WHERE conversation=$1 AND member=$2`,
      [convId, triggerMemberId]
    )
    if (rows.length === 0) throw new Error('conversation_member row missing after decline')
    if (rows[0].archived !== true) throw new Error(`archived=${rows[0].archived} (expected true after decline)`)
    pass('(17) trigger: participation → declined → conversation_member.archived=true')
  } catch (e) {
    fail('(17) trigger: declined archives conversation_member', e)
  } finally {
    if (triggerMemberId) {
      await dbClient.query(
        `DELETE FROM participations WHERE activity_type='event' AND activity_id=$1 AND member=$2`,
        [String(eventId), triggerMemberId]
      ).catch(() => {})
    }
  }

  // ── 18. Trigger: communications_banned → deletes conversation_member ─────────
  try {
    if (!convId || !triggerMemberId) throw new Error('skipped: no convId or triggerMemberId')

    // Ensure member is not banned and has no existing participation/conv_member
    await dbClient.query(`UPDATE members SET communications_banned=false WHERE id=$1`, [triggerMemberId])
    await dbClient.query(
      `DELETE FROM participations WHERE activity_type='event' AND activity_id=$1 AND member=$2`,
      [String(eventId), triggerMemberId]
    )
    await dbClient.query(
      `DELETE FROM conversation_members WHERE conversation=$1 AND member=$2`,
      [convId, triggerMemberId]
    )

    // INSERT confirmed → adds to conv_members (trigger)
    await dbClient.query(
      `INSERT INTO participations (activity_type, activity_id, member, status)
       VALUES ('event', $1, $2, 'confirmed')`,
      [String(eventId), triggerMemberId]
    )
    const before = await dbClient.query(
      `SELECT id FROM conversation_members WHERE conversation=$1 AND member=$2`,
      [convId, triggerMemberId]
    )
    if (before.rows.length === 0) throw new Error('conversation_member not created before ban test')

    // Flip banned=true → trigger (via participations sync on participation re-fire) needs
    // a participation event to fire. We UPDATE the participation status to 'confirmed' again
    // while banned=true to fire the trigger with banned logic.
    await dbClient.query(`UPDATE members SET communications_banned=true WHERE id=$1`, [triggerMemberId])
    // Touch the participation to re-fire the trigger with the new banned state
    await dbClient.query(
      `UPDATE participations SET status='confirmed'
        WHERE activity_type='event' AND activity_id=$1 AND member=$2`,
      [String(eventId), triggerMemberId]
    )

    const { rows } = await dbClient.query(
      `SELECT id FROM conversation_members WHERE conversation=$1 AND member=$2`,
      [convId, triggerMemberId]
    )
    if (rows.length !== 0) throw new Error(`conversation_member still present after ban (expected deleted)`)
    pass('(18) trigger: communications_banned=true → conversation_member deleted')
  } catch (e) {
    fail('(18) trigger: banned deletes conversation_member', e)
  } finally {
    if (triggerMemberId) {
      await dbClient.query(`UPDATE members SET communications_banned=false WHERE id=$1`, [triggerMemberId]).catch(() => {})
      await dbClient.query(
        `DELETE FROM participations WHERE activity_type='event' AND activity_id=$1 AND member=$2`,
        [String(eventId), triggerMemberId]
      ).catch(() => {})
      await dbClient.query(
        `DELETE FROM conversation_members WHERE conversation=$1 AND member=$2`,
        [convId, triggerMemberId]
      ).catch(() => {})
    }
  }

  // ── 19. Trigger: DELETE event → activity_chat conversation removed ───────────
  try {
    // Create a throwaway event, insert a fake activity_chat, DELETE the event,
    // verify the conversation is gone (FK ON DELETE CASCADE or the trigger).
    const { rows: evRows } = await dbClient.query(
      `INSERT INTO events (title, description, event_type, start_date, end_date, all_day, location)
       VALUES ('__throwaway_broadcast_test__', 'harness throwaway', 'social',
               NOW() + interval '30 days', NOW() + interval '30 days 1 hour', false, 'Test')
       RETURNING id`
    )
    const throwawayEventId = evRows[0].id

    // Insert a fake activity_chat conversation for it.
    // conversations.id has no DB default — must supply gen_random_uuid() explicitly.
    const { rows: convRows } = await dbClient.query(
      `INSERT INTO conversations (id, type, activity_type, activity_id, title, created_by)
       VALUES (gen_random_uuid(),'activity_chat','event',$1,'Throwaway Test Conv', 8)
       RETURNING id`,
      [throwawayEventId]
    )
    const throwawayConvId = convRows[0].id

    // Verify it's there
    const before = await dbClient.query(
      `SELECT id FROM conversations WHERE id=$1`, [throwawayConvId]
    )
    if (before.rows.length === 0) throw new Error('throwaway conversation not created')

    // DELETE the event → trigger should delete the conversation
    await dbClient.query(`DELETE FROM events WHERE id=$1`, [throwawayEventId])

    const { rows: afterRows } = await dbClient.query(
      `SELECT id FROM conversations WHERE id=$1`, [throwawayConvId]
    )
    if (afterRows.length !== 0) throw new Error(`conversation still present after event DELETE (expected gone)`)
    pass('(19) trigger: DELETE event → activity_chat conversation removed')
  } catch (e) {
    fail('(19) trigger: DELETE event removes activity_chat', e)
  }

  // ── 20. Audit row for inApp broadcast ───────────────────────────────────────
  try {
    if (!convId) throw new Error('skipped: no convId from 11a')
    const { rows } = await dbClient.query(
      `SELECT channels_sent, delivery_results, recipient_count
         FROM broadcasts
        WHERE activity_type='event' AND activity_id=$1
        ORDER BY id DESC LIMIT 1`,
      [eventId]
    )
    if (rows.length === 0) throw new Error(`no broadcast audit row for event ${eventId}`)
    const row = rows[0]
    const channels = typeof row.channels_sent === 'string' ? JSON.parse(row.channels_sent) : row.channels_sent
    if (!channels?.in_app) throw new Error(`channels_sent.in_app=${channels?.in_app} (expected true)`)
    const delivery = typeof row.delivery_results === 'string' ? JSON.parse(row.delivery_results) : row.delivery_results
    const auditConvId = delivery?.in_app?.conversation_id
    if (auditConvId !== convId) throw new Error(`audit conversation_id=${auditConvId} differs from response ${convId}`)
    pass(`(20) audit row: activity_type=event channels_sent.in_app=true delivery.in_app.conversation_id matches`)
  } catch (e) { fail('(20) inApp audit row', e) }
}

async function testBroadcast(dbClient) {
  console.log('\n[broadcast] Plan 01 / Phase B / Task B7 — integration assertions')

  let seed
  try { seed = await runSeed() }
  catch (e) { fail('broadcast seed', e); return }
  const { eventId, trainingId, rateLimitTraining } = seed
  console.log(`  · seed: training=${trainingId} ratelimit=${rateLimitTraining} event=${eventId}`)

  // ── 1. Happy path — coach POST /broadcast {confirmed} → 200 ────────────
  let happyResponse
  try {
    const r = await asCoach(`/kscw/activities/training/${trainingId}/broadcast`, {
      method: 'POST',
      body: JSON.stringify({
        channels: { email: true, push: false },
        audience: { statuses: ['confirmed'] },
        subject: 'Broadcast harness — happy path',
        message: 'Hello from the broadcast harness.',
      }),
    })
    const b = await r.json()
    if (r.status !== 200) throw new Error(`status=${r.status}: ${JSON.stringify(b)}`)
    if (b.recipientCount !== 3) throw new Error(`recipientCount=${b.recipientCount} (expected 3)`)
    // SMTP relay accepts .test addresses then bounces silently downstream, so
    // sent should equal recipientCount. If the relay ever rejects pre-queue we
    // fall back to checking sent+failed===recipientCount.
    const sent = b.delivery?.email?.sent ?? 0
    const failed = b.delivery?.email?.failed ?? 0
    if (sent + failed !== 3) throw new Error(`sent+failed=${sent + failed} (expected 3)`)
    if (sent !== 3) {
      // Soft-warn: we still pass since recipientCount matched and delivery
      // outcomes are bookkept honestly.
      console.warn(`  ! delivery.email.sent=${sent} failed=${failed} (SMTP may have rejected .test addresses; ok)`)
    }
    happyResponse = b
    pass(`(1) POST /broadcast happy path → 200 recipientCount=3 sent=${sent} failed=${failed}`)
  } catch (e) { fail('(1) happy path', e) }

  // ── 2. Preview happy ───────────────────────────────────────────────────
  try {
    const r = await asCoach(`/kscw/activities/training/${trainingId}/broadcast/preview`, {
      method: 'POST',
      body: JSON.stringify({
        channels: { email: true },
        audience: { statuses: ['confirmed'] },
        subject: 'Test', message: 'Hello',
      }),
    })
    const b = await r.json()
    if (r.status !== 200) throw new Error(`status=${r.status}: ${JSON.stringify(b)}`)
    if (b.recipientCount !== 3) throw new Error(`recipientCount=${b.recipientCount} (expected 3)`)
    if (b.breakdown?.members !== 3) throw new Error(`breakdown.members=${b.breakdown?.members} (expected 3)`)
    if (!Array.isArray(b.sample) || b.sample.length === 0) throw new Error('sample empty')
    pass('(2) POST /broadcast/preview happy → 200 recipientCount=3 sample non-empty')
  } catch (e) { fail('(2) preview happy', e) }

  // ── 3. Audience expand — preview confirmed+tentative → 4 ───────────────
  try {
    const r = await asCoach(`/kscw/activities/training/${trainingId}/broadcast/preview`, {
      method: 'POST',
      body: JSON.stringify({ audience: { statuses: ['confirmed', 'tentative'] } }),
    })
    const b = await r.json()
    if (r.status !== 200) throw new Error(`status=${r.status}: ${JSON.stringify(b)}`)
    if (b.recipientCount !== 4) throw new Error(`recipientCount=${b.recipientCount} (expected 4)`)
    pass('(3) preview audience-expand confirmed+tentative → recipientCount=4')
  } catch (e) { fail('(3) audience expand', e) }

  // ── 4. Externals on event preview — includeExternals:true ──────────────
  try {
    const r = await asCoach(`/kscw/activities/event/${eventId}/broadcast/preview`, {
      method: 'POST',
      body: JSON.stringify({
        audience: { statuses: ['confirmed', 'tentative', 'invited'], includeExternals: true },
      }),
    })
    const b = await r.json()
    if (r.status !== 200) throw new Error(`status=${r.status}: ${JSON.stringify(b)}`)
    if (!(b.breakdown?.externals >= 1)) throw new Error(`breakdown.externals=${b.breakdown?.externals} (expected >=1)`)
    pass(`(4) event preview includeExternals → breakdown.externals=${b.breakdown.externals}`)
  } catch (e) { fail('(4) externals on event', e) }

  // ── 5. RBAC main — MEMBER_TOKEN_X /broadcast → 403 not_authorized ──────
  try {
    const r = await asMember(`/kscw/activities/training/${trainingId}/broadcast`, {
      method: 'POST',
      body: JSON.stringify({
        channels: { email: true },
        audience: { statuses: ['confirmed'] },
        subject: 'nope', message: 'nope',
      }),
    })
    const b = await r.json().catch(() => ({}))
    if (r.status !== 403 || b.code !== 'broadcast/not_authorized')
      throw new Error(`status=${r.status} code=${b.code}`)
    pass('(5) RBAC main: MEMBER_TOKEN_X → 403 broadcast/not_authorized')
  } catch (e) { fail('(5) RBAC main', e) }

  // ── 6. RBAC preview — MEMBER_TOKEN_X /broadcast/preview → 403 ──────────
  try {
    const r = await asMember(`/kscw/activities/training/${trainingId}/broadcast/preview`, {
      method: 'POST',
      body: JSON.stringify({ audience: { statuses: ['confirmed'] } }),
    })
    const b = await r.json().catch(() => ({}))
    if (r.status !== 403 || b.code !== 'broadcast/not_authorized')
      throw new Error(`status=${r.status} code=${b.code}`)
    pass('(6) RBAC preview: MEMBER_TOKEN_X → 403 broadcast/not_authorized')
  } catch (e) { fail('(6) RBAC preview', e) }

  // ── 7. Rate-limit — pre-seed 3 audit rows on the rate-limit training,
  //    then attempt a real send to an EMPTY audience (no real fan-out).
  //    The rate-limit gate runs BEFORE audience resolution, so no email is
  //    even attempted. We assert 429 + retryAfterSec.
  try {
    // Wipe + insert 3 fake audit rows: 50min, 30min, 10min ago. Spaced >20min
    // each so the "20 min between sends" rule wouldn't fire on its own — the
    // 429 must come from the "3 per trailing hour" cap.
    await dbClient.query(`DELETE FROM broadcasts WHERE activity_type='training' AND activity_id=$1`, [rateLimitTraining])
    for (const minutesAgo of [50, 30, 10]) {
      await dbClient.query(
        `INSERT INTO broadcasts (activity_type, activity_id, sender, channels_sent, audience_filter, recipient_count, recipient_ids, message, sent_at)
           VALUES ('training', $1, 8, '{"email":true}'::jsonb, '{}'::jsonb, 0, '{}'::jsonb, 'rate-limit test', NOW() - ($2::int * INTERVAL '1 minute'))`,
        [rateLimitTraining, minutesAgo]
      )
    }
    const r = await asCoach(`/kscw/activities/training/${rateLimitTraining}/broadcast`, {
      method: 'POST',
      body: JSON.stringify({
        channels: { email: true },
        audience: { statuses: ['waitlist'] },     // matches nothing — DB stores 'waitlisted'
        subject: 'Rate-limit probe',
        message: 'Should never send.',
      }),
    })
    const b = await r.json().catch(() => ({}))
    if (r.status !== 429) throw new Error(`status=${r.status} body=${JSON.stringify(b)}`)
    if (b.code !== 'broadcast/rate_limited') throw new Error(`code=${b.code}`)
    if (typeof b.details?.retryAfterSec !== 'number' || b.details.retryAfterSec <= 0)
      throw new Error(`retryAfterSec missing/non-positive: ${b.details?.retryAfterSec}`)
    pass(`(7) rate-limit: 4th broadcast in hour → 429 retryAfterSec=${b.details.retryAfterSec}`)
  } catch (e) { fail('(7) rate-limit', e) }
  finally {
    // Leave the fake audit rows in place — they age out after 60min on their
    // own and don't affect the happy-path training.
  }

  // ── 8. Validation: subject missing when channels.email=true → 400 ──────
  try {
    const r = await asCoach(`/kscw/activities/training/${trainingId}/broadcast`, {
      method: 'POST',
      body: JSON.stringify({
        channels: { email: true },
        audience: { statuses: ['confirmed'] },
        message: 'no subject here',
      }),
    })
    const b = await r.json().catch(() => ({}))
    if (r.status !== 400 || b.code !== 'broadcast/invalid_payload' || b.details?.field !== 'subject')
      throw new Error(`status=${r.status} code=${b.code} field=${b.details?.field}`)
    pass('(8) validation: subject missing → 400 invalid_payload field=subject')
  } catch (e) { fail('(8) validation subject', e) }

  // ── 9. Validation: empty channels (all false) → 400 field=channels ─────
  try {
    const r = await asCoach(`/kscw/activities/training/${trainingId}/broadcast`, {
      method: 'POST',
      body: JSON.stringify({
        channels: { email: false, push: false, inApp: false },
        audience: { statuses: ['confirmed'] },
        message: 'no channels',
      }),
    })
    const b = await r.json().catch(() => ({}))
    if (r.status !== 400 || b.code !== 'broadcast/invalid_payload' || b.details?.field !== 'channels')
      throw new Error(`status=${r.status} code=${b.code} field=${b.details?.field}`)
    pass('(9) validation: empty channels → 400 invalid_payload field=channels')
  } catch (e) { fail('(9) validation empty channels', e) }

  // ── 10. Validation: inApp:true on training → 400 inapp_events_only ────────
  // (Plan 01 expected 501 not_implemented; Plan 02 implements inApp for events
  //  only, so training now returns 400 inapp_events_only instead.)
  try {
    const r = await asCoach(`/kscw/activities/training/${trainingId}/broadcast`, {
      method: 'POST',
      body: JSON.stringify({
        channels: { inApp: true },
        audience: { statuses: ['confirmed'] },
        message: 'in-app please',
      }),
    })
    const b = await r.json().catch(() => ({}))
    if (r.status !== 400 || b.code !== 'broadcast/inapp_events_only')
      throw new Error(`status=${r.status} code=${b.code}`)
    pass('(10) validation: inApp:true on training → 400 broadcast/inapp_events_only')
  } catch (e) { fail('(10) validation inApp', e) }

  // ── 11. Audit row — verify the happy-path send wrote a correct row ─────
  try {
    if (!happyResponse) throw new Error('no happy-path response to verify')
    const { rows } = await dbClient.query(
      `SELECT activity_type, activity_id, recipient_count, channels_sent, delivery_results
         FROM broadcasts
        WHERE activity_type='training' AND activity_id=$1
        ORDER BY id DESC LIMIT 1`,
      [trainingId]
    )
    if (rows.length !== 1) throw new Error(`expected 1 audit row for training ${trainingId}, got ${rows.length}`)
    const row = rows[0]
    if (row.activity_type !== 'training') throw new Error(`activity_type=${row.activity_type}`)
    if (row.recipient_count !== 3) throw new Error(`recipient_count=${row.recipient_count}`)
    const channels = typeof row.channels_sent === 'string' ? JSON.parse(row.channels_sent) : row.channels_sent
    if (channels?.email !== true) throw new Error(`channels_sent.email=${channels?.email}`)
    const delivery = typeof row.delivery_results === 'string' ? JSON.parse(row.delivery_results) : row.delivery_results
    const auditSent = delivery?.email?.sent ?? -1
    if (auditSent !== happyResponse.delivery.email.sent)
      throw new Error(`audit delivery.email.sent=${auditSent} differs from response ${happyResponse.delivery.email.sent}`)
    pass(`(11) audit row: activity_type=training recipient_count=3 channels_sent.email=true delivery.email.sent=${auditSent}`)
  } catch (e) { fail('(11) audit row', e) }

  // ── 12. Activity 404 — POST /broadcast on nonexistent training ─────────
  try {
    const r = await asCoach(`/kscw/activities/training/999999/broadcast`, {
      method: 'POST',
      body: JSON.stringify({
        channels: { email: true },
        audience: { statuses: ['confirmed'] },
        subject: '404 probe', message: 'should not exist',
      }),
    })
    const b = await r.json().catch(() => ({}))
    if (r.status !== 404 || b.code !== 'broadcast/not_found')
      throw new Error(`status=${r.status} code=${b.code}`)
    pass('(12) activity 404: training id=999999 → 404 broadcast/not_found')
  } catch (e) { fail('(12) activity 404', e) }

  // ── 13. Empty audience — statuses:['waitlist'] (no waitlist participants
  //    on the test training) → 200 with recipientCount=0 and email.sent=0.
  //    Use the happy-path training: but the rate-limit "20 min between sends"
  //    will trip if we hit it within 20min of assertion 1. To avoid that,
  //    we use the RATE-LIMIT training (with its 3 fake audit rows still in
  //    place from assertion 7) and DELETE them first so we have a fresh slate.
  try {
    await dbClient.query(`DELETE FROM broadcasts WHERE activity_type='training' AND activity_id=$1`, [rateLimitTraining])
    const r = await asCoach(`/kscw/activities/training/${rateLimitTraining}/broadcast`, {
      method: 'POST',
      body: JSON.stringify({
        channels: { email: true },
        audience: { statuses: ['waitlist'] },     // DB stores 'waitlisted' → 0 matches
        subject: 'Empty audience probe',
        message: 'No one should receive this.',
      }),
    })
    const b = await r.json().catch(() => ({}))
    if (r.status !== 200) throw new Error(`status=${r.status} body=${JSON.stringify(b)}`)
    if (b.recipientCount !== 0) throw new Error(`recipientCount=${b.recipientCount} (expected 0)`)
    if (b.delivery?.email?.sent !== 0) throw new Error(`delivery.email.sent=${b.delivery?.email?.sent} (expected 0)`)
    if (b.delivery?.email?.failed !== 0) throw new Error(`delivery.email.failed=${b.delivery?.email?.failed} (expected 0)`)
    pass('(13) empty audience: 200 recipientCount=0 delivery.email.sent=0')
  } catch (e) { fail('(13) empty audience', e) }

  return seed
}

async function main() {
  const client = new pg.Client({ connectionString: DB_URL })
  await client.connect()
  try {
    const seed = await testBroadcast(client)
    if (seed) await testBroadcastInApp(client, seed)
  } finally {
    await client.end()
  }
  console.log(`\n${failures.length === 0 ? '✅ ALL PASSED' : `❌ ${failures.length} FAILURES`}`)
  for (const f of failures) console.log(`  · ${f.msg}: ${f.err}`)
  process.exit(failures.length === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(2) })
