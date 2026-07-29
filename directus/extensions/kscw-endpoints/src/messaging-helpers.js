/**
 * KSCW Messaging — shared helpers for endpoints.
 * Plan 02 scope: just the helpers needed by the 4 team-chat endpoints.
 * Plan 03+ will add DM/request-specific helpers here.
 */

import { tPush } from './push-i18n.js'
import { currentSeasonShort } from './season.js'

export class MessagingError extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

/**
 * Ensure the request is authenticated and return the accountability user id
 * (which is the directus_users.id — NOT the members.id).
 */
export function requireAuth(req) {
  const userId = req.accountability?.user
  if (!userId) {
    throw new MessagingError(401, 'messaging/unauthenticated', 'Authentication required')
  }
  return userId
}

/**
 * Resolve a directus_users.id to the corresponding members.id.
 * Throws if the user has no linked member.
 * Returns the full row we need for opt-in / ban checks.
 *
 * NOTE: the FK column on `members` pointing at `directus_users.id` is named
 * `members.user` (not `members.directus_user`). Every existing endpoint
 * confirms this — grep for `where('user'` in directus/extensions/kscw-endpoints/src/
 * (e.g. clubdesk-update.js:84, index.js:250,520,836,1174). Do NOT "fix" this
 * to `directus_user` — it is the real column name.
 */
export async function requireMember(db, directusUserId) {
  const row = await db('members')
    .where('user', directusUserId)
    .select(
      'id', 'first_name', 'last_name',
      'communications_team_chat_enabled',
      'communications_dm_enabled',
      'communications_banned',
      'push_preview_content',
    )
    .first()
  if (!row) {
    throw new MessagingError(403, 'messaging/no_member_profile',
      'No member profile linked to this user')
  }
  if (row.communications_banned) {
    throw new MessagingError(403, 'messaging/banned', 'Your messaging access is disabled')
  }
  return row
}

/**
 * Load the conversation + the caller's conversation_members row in one shot.
 * Returns { conv, membership } or throws 403 `messaging/not_a_member` if the
 * caller is not a member (or the conversation doesn't exist).
 *
 * Deliberately merges "not found" and "not a member" into one 403 (per spec §4
 * error table) so non-members cannot enumerate conversation ids via 404/403 drift.
 */
export async function loadConversationMembership(db, conversationId, memberId) {
  const conv = await db('conversations').where('id', conversationId).first()
  if (!conv) {
    throw new MessagingError(403, 'messaging/not_a_member', 'Conversation not found or no access')
  }
  const membership = await db('conversation_members')
    .where({ conversation: conversationId, member: memberId })
    .first()
  if (!membership || membership.archived === true) {
    throw new MessagingError(403, 'messaging/not_a_member', 'Conversation not found or no access')
  }
  return { conv, membership }
}

/**
 * For team conversations, require the caller has team chat enabled.
 * (For DM conversations, Plan 03 adds a similar check on dm_enabled.)
 */
export function requireTeamChatEnabled(member) {
  if (member.communications_team_chat_enabled !== true) {
    throw new MessagingError(403, 'messaging/comms_disabled',
      'Team chat is disabled in your settings')
  }
}

/**
 * Shape a conversation row + the caller's membership + an unread count
 * into the ConversationSummary contract expected by the frontend.
 */
export function shapeConversationSummary({ conv, membership, unread_count }) {
  return {
    id: conv.id,
    type: conv.type,
    team: conv.team ?? null,
    title: conv.title ?? null,
    last_message_at: conv.last_message_at ?? null,
    last_message_preview: conv.last_message_preview ?? null,
    unread_count: Number.isFinite(unread_count) ? unread_count : 0,
    muted: membership.muted === true,
    request_status: null, // Plan 03 fills this for dm_request conversations
    other_member: null,   // Plan 03 fills this for dm / dm_request conversations
    // Broadcast Plan 02 — activity_chat metadata (null for team/dm/dm_request).
    activity_type: conv.activity_type ?? null,
    activity_id: conv.activity_id ?? null,
  }
}

/**
 * Convert a thrown MessagingError (or unexpected error) into an Express response.
 * Use inside try/catch in each route handler.
 */
export function sendError(res, logger, err) {
  if (err instanceof MessagingError) {
    return res.status(err.status).json({ code: err.code, message: err.message, details: err.details })
  }
  logger.error({ err: err?.message ?? String(err), stack: err?.stack }, 'messaging endpoint crash')
  return res.status(500).json({
    code: 'messaging/internal', message: 'Internal server error',
  })
}

// ─── Plan 03: DM / request / block helpers ───────────────────────────────────

/**
 * For DM conversations, require the caller has DM enabled.
 * Symmetric to requireTeamChatEnabled.
 */
export function requireDmEnabled(member) {
  if (member.communications_dm_enabled !== true) {
    throw new MessagingError(403, 'messaging/comms_disabled',
      'Direct messages are disabled in your settings')
  }
}

/**
 * Load blocks relevant to `memberId`: who I've blocked + who has blocked me.
 * Plan 03 uses this for:
 *   • GET /conversations — hide DMs where a block exists in either direction.
 *   • POST /messages — 403 `messaging/blocked` when DM is blocked.
 *   • GET /conversations/:id/messages — filter out blocker's messages in shared team chats.
 *
 * Returns two Sets of string member ids for O(1) lookups.
 */
export async function loadBlocks(db, memberId) {
  const rows = await db('blocks')
    .where('blocker', memberId).orWhere('blocked', memberId)
    .select('blocker', 'blocked')
  const outgoing = new Set()   // members *I* have blocked
  const incoming = new Set()   // members who have blocked *me*
  for (const r of rows) {
    if (String(r.blocker) === String(memberId)) outgoing.add(String(r.blocked))
    else if (String(r.blocked) === String(memberId)) incoming.add(String(r.blocker))
  }
  const either = new Set([...outgoing, ...incoming])
  return { outgoing, incoming, either }
}

/**
 * Do members A and B share at least one active team this season?
 * member_teams.season is filtered to the current season — matches the frontend
 * `loadTeamContext` convention (see src/hooks/useAuth.tsx:106).
 *
 * ⚠ This used to inline its own **Aug 1 UTC** cutover while the rest of the app
 * rolled over on Jun 1 — so from Jun 1 to Jul 31 it queried the PREVIOUS
 * season's rosters. Teammates whose shared team only existed on the new-season
 * roster came back as "no shared team" and had their DM downgraded to an
 * approval-gated `dm_request`. Found 2026-07-29 with 82 members and 29 teams on
 * a 2026/27 roster and no 2025/26 counterpart. The cutover now comes from
 * season.js, and season-parity.test.ts stops it drifting again.
 */
export async function shareTeam(db, memberIdA, memberIdB) {
  const season = currentSeasonShort()
  const row = await db('member_teams as mt1')
    .join('member_teams as mt2', function () {
      this.on('mt1.team', '=', 'mt2.team').andOn('mt1.season', '=', 'mt2.season')
    })
    .where('mt1.member', memberIdA)
    .andWhere('mt2.member', memberIdB)
    .andWhere('mt1.season', season)
    .select('mt1.team').first()
  return !!row
}

/**
 * Find an existing (dm|dm_request) conversation between two members.
 * Returns the conversations row (incl. type) or null.
 * Uses conversation_members as the join predicate; DMs have no `team` FK.
 */
export async function findExistingDmConversation(db, memberIdA, memberIdB) {
  const row = await db('conversations as c')
    .join('conversation_members as cm1', 'cm1.conversation', 'c.id')
    .join('conversation_members as cm2', 'cm2.conversation', 'c.id')
    .whereIn('c.type', ['dm', 'dm_request'])
    .andWhere('cm1.member', memberIdA)
    .andWhere('cm2.member', memberIdB)
    .select('c.id', 'c.type', 'c.last_message_at', 'c.last_message_preview')
    .first()
  return row ?? null
}

/**
 * Per spec §7: after a decline, the sender cannot re-request for 30 days.
 * Throws 429 messaging/request_cooldown if a declined request exists from
 * `senderId` → `recipientId` with `resolved_at` within the last 30 days.
 */
export async function checkDeclineCooldown(db, senderId, recipientId) {
  const cutoffMs = Date.now() - 30 * 24 * 3600 * 1000
  const row = await db('message_requests')
    .where('sender', senderId).andWhere('recipient', recipientId)
    .andWhere('status', 'declined')
    .andWhere('resolved_at', '>', new Date(cutoffMs).toISOString())
    .select('resolved_at').first()
  if (row) {
    throw new MessagingError(429, 'messaging/request_cooldown',
      'You must wait 30 days before sending another request to this member',
      { resolved_at: row.resolved_at })
  }
}

/**
 * Verify the caller is the **recipient** of a message_requests row.
 * Only the recipient can accept/decline. Returns { req, conv }.
 * Throws 403 not_a_member if anything doesn't line up.
 */
export async function requireRequestRecipient(db, requestId, memberId) {
  const req = await db('message_requests').where('id', requestId).first()
  if (!req || String(req.recipient) !== String(memberId)) {
    throw new MessagingError(403, 'messaging/not_a_member', 'Request not found or access denied')
  }
  if (req.status !== 'pending') {
    throw new MessagingError(409, 'messaging/request_already_resolved', 'This request was already resolved',
      { status: req.status })
  }
  const conv = await db('conversations').where('id', req.conversation).first()
  if (!conv) throw new MessagingError(403, 'messaging/not_a_member', 'Conversation not found')
  return { req, conv }
}

// ─── Plan 04: message-action + moderation helpers ────────────────────────────

/**
 * Fail fast if caller isn't the sender. Used by PATCH /messages/:id and by
 * DELETE /messages/:id's self-delete path.
 */
export async function requireMessageOwner(db, messageId, memberId) {
  const msg = await db('messages').where('id', messageId).first()
  if (!msg) throw new MessagingError(404, 'messaging/not_found', 'Message not found')
  if (String(msg.sender) !== String(memberId)) {
    throw new MessagingError(403, 'messaging/forbidden', 'You can only modify your own messages')
  }
  return msg
}

/**
 * For DELETE /messages/:id — allow coach OR team_responsible of the team
 * that owns the conversation. DM conversations never have moderators (spec §8:
 * admin via report flow only). Returns { msg, conv } on allow, throws on deny.
 *
 * The caller is allowed if:
 *   - conversation is type='team' AND caller is in teams_coaches OR teams_responsibles
 *     for that team.
 * DM / dm_request → moderator path is disallowed. Reports handle DM moderation.
 */
export async function requireTeamModerator(db, messageId, memberId) {
  const msg = await db('messages').where('id', messageId).first()
  if (!msg) throw new MessagingError(404, 'messaging/not_found', 'Message not found')
  const conv = await db('conversations').where('id', msg.conversation).first()
  if (!conv) throw new MessagingError(404, 'messaging/not_found', 'Conversation not found')

  if (conv.type !== 'team' || !conv.team) {
    throw new MessagingError(403, 'messaging/forbidden', 'Moderator delete is only available in team chats')
  }
  const isCoach = await db('teams_coaches')
    .where({ teams_id: conv.team, members_id: memberId }).first()
  const isTR = await db('teams_responsibles')
    .where({ teams_id: conv.team, members_id: memberId }).first()
  if (!isCoach && !isTR) {
    throw new MessagingError(403, 'messaging/forbidden', 'You must be a coach or team responsible')
  }
  return { msg, conv }
}

/**
 * Snapshot a message body for audit retention in a report.
 * Returns the stored body verbatim (may be null for poll messages).
 *
 * Called at report-file time (POST /reports), not at resolution time.
 * The snapshot is stored on reports.message_snapshot and survives later
 * message purge (Plan 05's retention cron hard-deletes messages but leaves
 * report.message_snapshot intact per spec §9).
 *
 * If the message is already soft-deleted when the report is filed, body
 * is still non-null (soft-delete only sets deleted_at, doesn't clear body).
 * The hard-purge in Plan 05 is what ultimately removes messages.body.
 */
export async function snapshotMessage(db, messageId) {
  const row = await db('messages').where('id', messageId).select('body', 'type', 'poll').first()
  if (!row) return null
  // For poll messages, snapshot the question instead of null.
  if (row.type === 'poll' && row.poll != null) {
    const poll = await db('polls').where('id', row.poll).select('question').first()
    return poll?.question ?? null
  }
  return row.body ?? null
}

/**
 * Admin gate — passes if:
 *   (a) req.accountability.admin === true  (Directus system-admin token with no member row), OR
 *   (b) the caller's members.role JSONB array contains 'admin' or 'superuser'.
 *
 * Pass `accountability` from `req.accountability` so system admins bypass the member-role lookup.
 * `memberId` may be null when the caller has no members row but is a Directus admin.
 */
export async function requireAdmin(db, memberId, accountability) {
  if (accountability?.admin === true) return   // Directus system-admin short-circuit
  if (!memberId) throw new MessagingError(403, 'messaging/forbidden', 'Admin access required')
  const row = await db('members').where('id', memberId).select('role').first()
  const roles = Array.isArray(row?.role) ? row.role : (typeof row?.role === 'string' ? JSON.parse(row.role) : [])
  if (!roles.includes('admin') && !roles.includes('superuser')) {
    throw new MessagingError(403, 'messaging/forbidden', 'Admin access required')
  }
}

// ─── Plan 05: push recipients, preview, export rate-limit ────────────────────

/**
 * Recipients who should get a push when `sender` posts in `conv`.
 * Excludes:
 *   - sender themselves
 *   - conversation_members where muted=true or archived=true
 *   - For DM/dm_request conv types: any pair where blocks exists either direction
 *     (team conversations never skip pushes on block — block only filters READS)
 *
 * Returns an array of numeric member ids.
 */
export async function resolveRecipientsForPush(db, conv, senderMemberId) {
  const members = await db('conversation_members')
    .where('conversation', conv.id)
    .andWhere('archived', false)
    .andWhere('muted', false)
    .andWhere('member', '<>', senderMemberId)
    .select('member')

  let ids = members.map(m => m.member)

  if ((conv.type === 'dm' || conv.type === 'dm_request') && ids.length > 0) {
    const blockRows = await db('blocks')
      .where(function () {
        this.whereIn('blocker', ids).andWhere('blocked', senderMemberId)
      })
      .orWhere(function () {
        this.where('blocker', senderMemberId).whereIn('blocked', ids)
      })
      .select('blocker', 'blocked')
    const blockedIds = new Set()
    for (const b of blockRows) {
      if (String(b.blocker) === String(senderMemberId)) blockedIds.add(String(b.blocked))
      else blockedIds.add(String(b.blocker))
    }
    ids = ids.filter(id => !blockedIds.has(String(id)))
  }

  return ids
}

/**
 * Build the push preview string per the recipient's push_preview_content flag.
 * Falls back to generic copy when body is missing or preview is disabled.
 *
 * @param {{push_preview_content?: boolean}} recipient
 * @param {string} senderName
 * @param {string} body
 * @param {string} [locale] - short code: de | gsw | en | fr | it (defaults to de)
 */
export function buildPushPreview(recipient, senderName, body, locale = 'de') {
  const generic = tPush(locale, 'message.generic')
  const showContent = recipient?.push_preview_content === true
  if (!showContent) return generic
  if (!body || typeof body !== 'string' || body.length === 0) return generic
  const truncated = body.length > 80 ? body.slice(0, 77) + '…' : body
  return `${senderName}: ${truncated}`
}

/**
 * 1/day export rate-limit on members.last_export_at.
 * Returns the existing timestamp (for `cached` responses) or null when fresh.
 */
export async function checkExportRateLimit(db, memberId) {
  const row = await db('members').where('id', memberId).select('last_export_at').first()
  if (!row?.last_export_at) return null
  const elapsedMs = Date.now() - new Date(row.last_export_at).getTime()
  if (elapsedMs < 24 * 3600 * 1000) {
    return row.last_export_at
  }
  return null
}

export async function markExportDone(db, memberId) {
  await db('members').where('id', memberId).update({ last_export_at: new Date().toISOString() })
}

// ─── Member search for "Neue Nachricht" (DM / group DM pickers) ──────────────

/**
 * Search members the caller can DM: `dm_enabled=true`, `wiedisync_active=true`,
 * not banned, not self, not in a block relationship with the caller (either
 * direction).
 *
 * `q` is a trimmed query string (first_name / last_name / email `ILIKE %q%`).
 * Empty `q` returns an empty result set — we don't leak the entire directory
 * on an empty query.
 *
 * Returns `{id, first_name, last_name, photo}` tuples. `photo` is the
 * directus_files uuid — frontend resolves to an image URL via its helper.
 */
export async function searchMembersForDm(db, callerMemberId, q, limit = 20) {
  const trimmed = (q ?? '').trim()
  if (trimmed.length < 1) return []
  const needle = `%${trimmed.replace(/[%_]/g, '\\$&')}%`
  const cap = Math.min(Math.max(Number(limit) || 20, 1), 50)

  // Pre-compute block ids to exclude
  const { either } = await loadBlocks(db, callerMemberId)
  const blockedIds = [...either].map(Number).filter(Number.isFinite)

  let qry = db('members')
    .where('wiedisync_active', true)
    .andWhere('communications_dm_enabled', true)
    .andWhere('communications_banned', false)
    .andWhere('id', '<>', callerMemberId)
    .andWhere(function () {
      this.whereILike('first_name', needle)
        .orWhereILike('last_name', needle)
        .orWhereILike('nickname', needle)
        .orWhereILike('email', needle)
    })
    .orderBy('last_name', 'asc')
    .orderBy('first_name', 'asc')
    .limit(cap)
    .select('id', 'first_name', 'last_name', 'nickname', 'photo')

  if (blockedIds.length > 0) qry = qry.whereNotIn('id', blockedIds)

  return qry
}
