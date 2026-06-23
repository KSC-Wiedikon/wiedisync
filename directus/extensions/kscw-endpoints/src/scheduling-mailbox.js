/**
 * Scheduling Mailbox (Terminplanung)
 *
 * Embedded email client for the Spielplanung dashboard. The "server" is the
 * existing dedicated Migadu mailbox volleyball@spielplanung.kscw.ch (incoming)
 * + SES SMTP (outgoing, DKIM-aligned for spielplanung.kscw.ch). This module:
 *
 *  - syncs INBOX + Sent over IMAP (imapflow) into `scheduling_emails`,
 *    parsing MIME with mailparser and deduping by Message-ID
 *  - serves the message list / detail to the admin dashboard
 *  - sends replies as raw MIME (nodemailer MailComposer over the container's
 *    EMAIL_SMTP_* transport) so Message-ID + In-Reply-To/References are under
 *    our control, then appends the same bytes to the Migadu Sent folder so
 *    webmail stays consistent
 *  - streams attachment bytes on demand from IMAP (content is never stored)
 *
 * Opponent matching is computed CLIENT-side by address intersection with
 * game_scheduling_opponents.contact_email — no FK, nothing goes stale.
 *
 * Env (feature is dormant without the password — endpoints report
 * configured:false and the cron no-ops):
 *   SCHEDULING_IMAP_HOST      default imap.migadu.com
 *   SCHEDULING_IMAP_PORT      default 993
 *   SCHEDULING_IMAP_USER      default volleyball@spielplanung.kscw.ch
 *   SCHEDULING_IMAP_PASSWORD  required to activate
 *   SCHEDULING_MAILBOX_SYNC_DAYS  IMAP search window, default 60
 */

import crypto from 'crypto'
import Busboy from 'busboy'
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import nodemailer from 'nodemailer'
import MailComposer from 'nodemailer/lib/mail-composer/index.js'
import { escHtml } from './email-template.js'
import { writeUserLog } from './activity-log.js'
import { SCHEDULING_SIGNATURE_LIGHT_HTML, SCHEDULING_SIGNATURE_TEXT } from './scheduling-signature.js'

const IMAP_HOST = process.env.SCHEDULING_IMAP_HOST || 'imap.migadu.com'
const IMAP_PORT = Number(process.env.SCHEDULING_IMAP_PORT || 993)
const IMAP_USER = process.env.SCHEDULING_IMAP_USER || 'volleyball@spielplanung.kscw.ch'
const IMAP_PASSWORD = process.env.SCHEDULING_IMAP_PASSWORD || ''
const SYNC_DAYS = Number(process.env.SCHEDULING_MAILBOX_SYNC_DAYS || 60)

const SCHEDULING_FROM = 'volleyball@spielplanung.kscw.ch'
// Keep in sync with SCHEDULING_FROM_NAME in game-scheduling.js.
const FROM_NAME = 'KSCW VB Spielplanung'

// Body columns are text; cap to keep pathological messages from bloating rows.
const MAX_BODY_CHARS = 500_000
const LIST_LIMIT = 500

// Outgoing-attachment limits. SES accepts large messages but many receiving
// servers cap at ~25 MB, so 10 MB total is a safe, generous ceiling for the
// PDFs/schedules opponents actually exchange. Enforced server-side regardless
// of what the frontend allows.
const ATTACH_MAX_FILES = 10
const ATTACH_MAX_PER_FILE = 10 * 1024 * 1024
const ATTACH_MAX_TOTAL = 10 * 1024 * 1024

const isConfigured = () => Boolean(IMAP_PASSWORD)

/**
 * Parse a multipart/form-data reply (text fields + attachment files) with
 * busboy. We parse it here rather than letting attachments ride in a JSON body
 * because Directus caps the JSON body parser at MAX_PAYLOAD_SIZE (1 MB default).
 * Resolves { fields, files:[{filename, contentType, content:Buffer}] }; rejects
 * on any limit breach so the route can answer 413.
 */
function parseMultipartReply(req) {
  return new Promise((resolve, reject) => {
    let bb
    try {
      bb = Busboy({ headers: req.headers, limits: { files: ATTACH_MAX_FILES, fileSize: ATTACH_MAX_PER_FILE } })
    } catch (err) { return reject(err) }
    const fields = {}
    const files = []
    let total = 0
    let done = false
    const fail = (err) => { if (!done) { done = true; reject(err); req.unpipe(bb); req.resume() } }
    bb.on('field', (name, val) => { fields[name] = val })
    bb.on('file', (_name, stream, info) => {
      const chunks = []
      let truncated = false
      stream.on('data', (d) => { total += d.length; chunks.push(d) })
      stream.on('limit', () => { truncated = true })
      stream.on('error', fail)
      stream.on('close', () => {
        if (done) return
        if (truncated) return fail(new Error('Attachment too large'))
        if (total > ATTACH_MAX_TOTAL) return fail(new Error('Attachments exceed total size limit'))
        files.push({
          filename: String(info?.filename || 'attachment').replace(/[\r\n"]/g, '').slice(0, 200),
          contentType: info?.mimeType || 'application/octet-stream',
          content: Buffer.concat(chunks),
        })
      })
    })
    bb.on('filesLimit', () => fail(new Error('Too many attachments')))
    bb.on('error', fail)
    bb.on('close', () => { if (!done) { done = true; resolve({ fields, files }) } })
    req.pipe(bb)
  })
}

/**
 * Defence-in-depth scrub of admin-authored reply HTML (the TipTap editor already
 * emits a constrained whitelist; this guards the raw endpoint). Drops scripts/
 * styles/frames, inline event handlers, and javascript:/data: URLs.
 */
function sanitizeOutgoingHtml(html) {
  if (!html) return ''
  return String(html)
    .replace(/<(script|style|iframe|object|embed|link|meta|base)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(script|style|iframe|object|embed|link|meta|base)\b[^>]*\/?>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*("|')\s*(?:javascript|data|vbscript):[^"']*\2/gi, '$1=$2#$2')
}

/** Best-effort HTML → plain text for the text/plain MIME part + search/storage. */
function htmlToPlain(html) {
  if (!html) return ''
  return String(html)
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<blockquote[^>]*>/gi, '> ')
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&(?:#0*39|#x0*27|apos);/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function imapClient() {
  return new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: true,
    auth: { user: IMAP_USER, pass: IMAP_PASSWORD },
    logger: false,
  })
}

// Same sanitiser as game-scheduling.js parseRecipients: bare plausible
// addresses only, CR/LF stripped (header-injection defence).
const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/
function cleanAddresses(v) {
  const clean = (s) => String(s).replace(/[\r\n]+/g, '').trim()
  const raw = Array.isArray(v) ? v.map(clean) : clean(v || '').split(/[,;]+/).map((s) => s.trim())
  return raw.filter((s) => s && EMAIL_RE.test(s))
}

// mailparser AddressObject (or array of them) -> flat [{address, name}].
function flattenAddresses(obj) {
  if (!obj) return []
  const list = Array.isArray(obj) ? obj : [obj]
  return list.flatMap((o) => o?.value || []).filter((a) => a?.address)
}

const stripBrackets = (id) => String(id || '').replace(/^<|>$/g, '').trim()

function parsedToRow(parsed, { folder, uid, uidValidity, internalDate, direction }) {
  const from = flattenAddresses(parsed.from)[0] || null
  const to = flattenAddresses(parsed.to).map((a) => a.address)
  const cc = flattenAddresses(parsed.cc).map((a) => a.address)
  const refs = Array.isArray(parsed.references) ? parsed.references.join(' ') : (parsed.references || null)
  const attachments = (parsed.attachments || []).map((a, i) => ({
    filename: a.filename || `attachment-${i + 1}`,
    contentType: a.contentType || 'application/octet-stream',
    size: a.size || 0,
  }))
  const messageId = stripBrackets(parsed.messageId) || `${folder}-${uidValidity || 0}-${uid}@sync.local`
  return {
    message_id: messageId,
    in_reply_to: stripBrackets(parsed.inReplyTo) || null,
    references_ids: refs,
    direction,
    folder,
    imap_uid: uid,
    from_address: from?.address?.toLowerCase() || null,
    from_name: from?.name || null,
    to_addresses: to.map((a) => a.toLowerCase()).join(',') || null,
    cc_addresses: cc.map((a) => a.toLowerCase()).join(',') || null,
    subject: parsed.subject || null,
    body_text: (parsed.text || '').slice(0, MAX_BODY_CHARS) || null,
    body_html: (typeof parsed.html === 'string' ? parsed.html : '').slice(0, MAX_BODY_CHARS) || null,
    has_attachments: attachments.length > 0,
    attachments: attachments.length ? JSON.stringify(attachments) : null,
    date_sent: parsed.date || internalDate || null,
  }
}

async function findSentFolder(client) {
  const folders = await client.list()
  const byUse = folders.find((f) => f.specialUse === '\\Sent')
  if (byUse) return byUse.path
  const byName = folders.find((f) => /^sent/i.test(f.path))
  return byName?.path || 'Sent'
}

async function syncFolder(client, database, log, folder, direction, since) {
  const lock = await client.getMailboxLock(folder)
  let processed = 0
  try {
    const uidValidity = client.mailbox?.uidValidity ? String(client.mailbox.uidValidity) : null
    const uids = await client.search({ since }, { uid: true })
    if (!uids || uids.length === 0) return 0
    // Cheap delta: skip UIDs we already hold for this folder, so the 10-min
    // cron doesn't re-download the whole window every run. Message-ID conflict
    // handling below stays the actual dedupe (covers moves + app-sent copies).
    const existing = await database('scheduling_emails')
      .where({ folder })
      .whereIn('imap_uid', uids)
      .pluck('imap_uid')
    const existingSet = new Set(existing.map(Number))
    const todo = uids.filter((u) => !existingSet.has(Number(u)))
    for (const uid of todo) {
      try {
        const msg = await client.fetchOne(String(uid), { source: true, internalDate: true }, { uid: true })
        if (!msg || !msg.source) continue
        const parsed = await simpleParser(msg.source)
        const row = parsedToRow(parsed, { folder, uid, uidValidity, internalDate: msg.internalDate, direction })
        // App-sent replies are inserted at send time with folder=null; when the
        // Sent sync later sees the appended copy, merge folder/uid back in so
        // attachments stay streamable. Everything else: first writer wins.
        await database('scheduling_emails')
          .insert(row)
          .onConflict('message_id')
          .merge(['folder', 'imap_uid'])
        processed++
      } catch (err) {
        log.warn(`Mailbox sync: failed to ingest ${folder} uid ${uid}: ${err.message}`)
      }
    }
    return processed
  } finally {
    lock.release()
  }
}

let syncRunning = false

export async function runMailboxSync(database, log) {
  if (!isConfigured()) return { configured: false, processed: 0 }
  if (syncRunning) return { configured: true, processed: 0, skipped: 'already_running' }
  syncRunning = true
  const client = imapClient()
  try {
    await client.connect()
    const since = new Date(Date.now() - SYNC_DAYS * 86400000)
    const sentFolder = await findSentFolder(client)
    const inbox = await syncFolder(client, database, log, 'INBOX', 'in', since)
    const sent = await syncFolder(client, database, log, sentFolder, 'out', since)
    return { configured: true, processed: inbox + sent }
  } finally {
    syncRunning = false
    await client.logout().catch(() => {})
  }
}

export function registerSchedulingMailbox(router, { database, logger }) {
  const log = logger.child({ endpoint: 'scheduling-mailbox' })

  // Same gate as the other operational /admin/terminplanung/* endpoints: full
  // admin OR club-wide Spielplaner. The mailbox is the club's shared
  // scheduling identity, so no per-team scoping.
  async function isAdminOrSpielplaner(req) {
    if (req.accountability?.admin) return true
    const userId = req.accountability?.user
    if (!userId) return false
    const member = await database('members').where('user', userId).select('is_spielplaner').first()
    return member?.is_spielplaner === true
  }

  const fail = (res, route, err, req) => {
    log.error({ msg: `${route}: ${err.message}`, endpoint: route, userId: req.accountability?.user || null, method: req.method, stack: err.stack })
    res.status(500).json({ error: 'Internal error' })
  }

  // GET /kscw/admin/terminplanung/mailbox — message list (no bodies) + unread
  // count + last sync heartbeat. Opponent matching happens in the frontend.
  router.get('/admin/terminplanung/mailbox', async (req, res) => {
    if (!(await isAdminOrSpielplaner(req))) return res.status(403).json({ error: 'Admin only' })
    try {
      if (!isConfigured()) return res.json({ configured: false, unread: 0, messages: [], last_sync: null })
      // Optional full-text search: subject + sender/recipient AND body_text.
      // ≥2 chars to avoid scanning the whole table on a single keystroke; LIKE
      // wildcards in the term are escaped so they're matched literally.
      const search = String(req.query.search || '').trim().slice(0, 100)
      let q = database('scheduling_emails')
        .select('id', 'direction', 'from_address', 'from_name', 'to_addresses', 'cc_addresses', 'subject', 'date_sent', 'read_at', 'has_attachments', 'in_reply_to', 'message_id', 'assigned_opponent',
          database.raw('left(coalesce(body_text, \'\'), 160) as snippet'))
      if (search.length >= 2) {
        const like = `%${search.replace(/[\\%_]/g, '\\$&')}%`
        q = q.where((b) => {
          b.whereRaw("coalesce(body_text, '') ilike ?", [like])
            .orWhereRaw("coalesce(subject, '') ilike ?", [like])
            .orWhereRaw("coalesce(from_name, '') ilike ?", [like])
            .orWhereRaw("coalesce(from_address, '') ilike ?", [like])
            .orWhereRaw("coalesce(to_addresses, '') ilike ?", [like])
        })
      }
      const rows = await q
        .orderBy([{ column: 'date_sent', order: 'desc', nulls: 'last' }])
        .limit(LIST_LIMIT)
      const [{ count }] = await database('scheduling_emails').where({ direction: 'in' }).whereNull('read_at').count('id as count')
      const sync = await database('sync_runs').where({ source: 'mailbox_sync' }).first().catch(() => null)
      res.json({ configured: true, unread: Number(count), messages: rows, last_sync: sync?.last_run_at || null })
    } catch (err) { fail(res, 'admin/terminplanung/mailbox', err, req) }
  })

  // GET /kscw/admin/terminplanung/mailbox/message/:id — full body; opening an
  // inbound message IS the read action, so it stamps read_at.
  router.get('/admin/terminplanung/mailbox/message/:id', async (req, res) => {
    if (!(await isAdminOrSpielplaner(req))) return res.status(403).json({ error: 'Admin only' })
    try {
      const row = await database('scheduling_emails').where('id', Number(req.params.id)).first()
      if (!row) return res.status(404).json({ error: 'Message not found' })
      if (row.direction === 'in' && !row.read_at) {
        row.read_at = new Date().toISOString()
        await database('scheduling_emails').where('id', row.id).update({ read_at: row.read_at })
      }
      res.json({ message: row })
    } catch (err) { fail(res, 'admin/terminplanung/mailbox/message', err, req) }
  })

  // POST /kscw/admin/terminplanung/mailbox/assign — manual opponent override.
  // Body: { ids: number[], opponent_id: number|null }. Pins a whole email chain
  // to one opponent row (the frontend computes the thread's message ids); pass
  // opponent_id:null to clear back to auto-classification. Actor-logged per the
  // audit rule (raw-knex write bypasses the items-API audit hook).
  router.post('/admin/terminplanung/mailbox/assign', async (req, res) => {
    if (!(await isAdminOrSpielplaner(req))) return res.status(403).json({ error: 'Admin only' })
    try {
      const body = req.body || {}
      const ids = Array.isArray(body.ids)
        ? [...new Set(body.ids.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 500)
        : []
      if (ids.length === 0) return res.status(400).json({ error: 'No message ids' })

      // null / 0 / '' → clear the override. Otherwise the opponent must exist
      // (soft reference, so we validate here instead of via an FK).
      let opponentId = null
      if (body.opponent_id != null && String(body.opponent_id) !== '') {
        opponentId = Number(body.opponent_id)
        if (!Number.isInteger(opponentId) || opponentId <= 0) return res.status(400).json({ error: 'Invalid opponent_id' })
        const opp = await database('game_scheduling_opponents').where('id', opponentId).first('id')
        if (!opp) return res.status(404).json({ error: 'Opponent not found' })
      }

      const updated = await database('scheduling_emails').whereIn('id', ids).update({ assigned_opponent: opponentId })
      await writeUserLog(database, log, {
        accountability: req.accountability,
        action: 'update',
        collection: 'scheduling_emails',
        recordId: ids.join(','),
        data: { kind: 'mailbox_assign', opponent: opponentId, count: updated },
      })
      res.json({ success: true, updated })
    } catch (err) { fail(res, 'admin/terminplanung/mailbox/assign', err, req) }
  })

  // POST /kscw/admin/terminplanung/mailbox/sync — pull now (also the cron's
  // entry point, called via localhost with the cron service token).
  router.post('/admin/terminplanung/mailbox/sync', async (req, res) => {
    if (!(await isAdminOrSpielplaner(req))) return res.status(403).json({ error: 'Admin only' })
    try {
      const result = await runMailboxSync(database, log)
      res.json(result)
    } catch (err) { fail(res, 'admin/terminplanung/mailbox/sync', err, req) }
  })

  // POST /kscw/admin/terminplanung/mailbox/reply — compose + send.
  // Body: { to, cc?, subject, text, reply_to_id? }. Raw MIME via MailComposer
  // so we own Message-ID + threading headers; sent over the container's SES
  // SMTP (DKIM-aligned for spielplanung.kscw.ch), then appended to Migadu Sent.
  router.post('/admin/terminplanung/mailbox/reply', async (req, res) => {
    if (!(await isAdminOrSpielplaner(req))) return res.status(403).json({ error: 'Admin only' })
    try {
      if (!isConfigured()) return res.status(409).json({ error: 'Mailbox not configured' })

      // The compose dialog now posts multipart/form-data (rich-text HTML body +
      // file attachments). A plain JSON body is still accepted for callers that
      // send a text-only reply.
      let body = req.body || {}
      let uploads = []
      if (String(req.headers['content-type'] || '').includes('multipart/form-data')) {
        try {
          const parsed = await parseMultipartReply(req)
          body = parsed.fields
          uploads = parsed.files
        } catch (err) {
          return res.status(413).json({ error: err.message || 'Attachment upload failed' })
        }
      }

      const to = cleanAddresses(body.to)
      const cc = cleanAddresses(body.cc)
      const subject = String(body.subject || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 300)

      // Body: rich-text HTML (TipTap) is primary; fall back to a plain-text body
      // (legacy/JSON callers) wrapped to HTML. Plain text is always derived for
      // the text/plain MIME part + storage/search.
      const rawHtml = String(body.html || '').slice(0, 200_000)
      const legacyText = String(body.text || '').slice(0, 50_000)
      let bodyContentHtml = ''
      let plainContent = ''
      if (rawHtml.trim()) {
        bodyContentHtml = sanitizeOutgoingHtml(rawHtml)
        plainContent = htmlToPlain(bodyContentHtml)
      } else if (legacyText.trim()) {
        bodyContentHtml = escHtml(legacyText).replace(/\n/g, '<br>')
        plainContent = legacyText
      }
      if (!to.length) return res.status(400).json({ error: 'No valid recipient' })
      if (!subject || !bodyContentHtml.trim()) return res.status(400).json({ error: 'subject and body required' })

      // Threading: chain References from the replied-to message.
      let inReplyTo, references
      if (body.reply_to_id) {
        const parent = await database('scheduling_emails').where('id', Number(body.reply_to_id)).first()
        if (parent?.message_id && !parent.message_id.endsWith('@sync.local')) {
          inReplyTo = `<${parent.message_id}>`
          references = [parent.references_ids, `<${parent.message_id}>`].filter(Boolean).join(' ')
        }
      }

      // Append the Spielplanung signature: plain-text version on the text part,
      // and a light HTML part (rich body → HTML + branded signature card) so the
      // crest/contacts render.
      const textWithSig = `${plainContent}\n\n${SCHEDULING_SIGNATURE_TEXT}`
      const htmlBody =
        `<div style="font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;font-size:14px;line-height:1.5">` +
        `${bodyContentHtml}` +
        `</div><br>` +
        SCHEDULING_SIGNATURE_LIGHT_HTML

      const attachments = uploads.map((u) => ({ filename: u.filename, content: u.content, contentType: u.contentType }))

      const messageId = `<${crypto.randomUUID()}@spielplanung.kscw.ch>`
      const composer = new MailComposer({
        from: { name: FROM_NAME, address: SCHEDULING_FROM },
        to, cc: cc.length ? cc : undefined, subject, text: textWithSig, html: htmlBody,
        attachments: attachments.length ? attachments : undefined,
        messageId, inReplyTo, references,
      })
      const raw = await composer.compile().build()

      const transport = nodemailer.createTransport({
        host: process.env.EMAIL_SMTP_HOST,
        port: Number(process.env.EMAIL_SMTP_PORT || 587),
        secure: String(process.env.EMAIL_SMTP_SECURE) === 'true',
        auth: { user: process.env.EMAIL_SMTP_USER, pass: process.env.EMAIL_SMTP_PASSWORD },
      })
      await transport.sendMail({ envelope: { from: SCHEDULING_FROM, to: [...to, ...cc] }, raw })

      // Best-effort: mirror into the Migadu Sent folder so webmail stays the
      // full record. UIDPLUS gives us folder/uid for attachment streaming;
      // failure here never fails the send (the row below still logs it).
      let folder = null
      let imapUid = null
      try {
        const client = imapClient()
        await client.connect()
        try {
          const sentFolder = await findSentFolder(client)
          const appended = await client.append(sentFolder, raw, ['\\Seen'])
          folder = sentFolder
          imapUid = appended?.uid || null
        } finally {
          await client.logout().catch(() => {})
        }
      } catch (err) {
        log.warn(`Mailbox reply: sent OK but Sent-folder append failed: ${err.message}`)
      }

      const [inserted] = await database('scheduling_emails')
        .insert({
          message_id: stripBrackets(messageId),
          in_reply_to: stripBrackets(inReplyTo) || null,
          references_ids: references || null,
          direction: 'out',
          folder,
          imap_uid: imapUid,
          from_address: SCHEDULING_FROM,
          from_name: FROM_NAME,
          to_addresses: to.join(','),
          cc_addresses: cc.join(',') || null,
          subject,
          body_text: textWithSig,
          body_html: htmlBody,
          has_attachments: attachments.length > 0,
          attachments: attachments.length
            ? JSON.stringify(attachments.map((a) => ({ filename: a.filename, contentType: a.contentType, size: a.content.length })))
            : null,
          date_sent: new Date().toISOString(),
          read_at: new Date().toISOString(),
        })
        .onConflict('message_id')
        .ignore()
        .returning('id')
      res.json({ success: true, id: inserted?.id ?? inserted ?? null })
    } catch (err) { fail(res, 'admin/terminplanung/mailbox/reply', err, req) }
  })

  // GET /kscw/admin/terminplanung/mailbox/attachment/:id/:index — stream one
  // attachment live from IMAP (content is never stored locally). 410 when the
  // stored folder/uid no longer resolves to the same message — a fresh sync
  // re-points it.
  router.get('/admin/terminplanung/mailbox/attachment/:id/:index', async (req, res) => {
    if (!(await isAdminOrSpielplaner(req))) return res.status(403).json({ error: 'Admin only' })
    try {
      if (!isConfigured()) return res.status(409).json({ error: 'Mailbox not configured' })
      const row = await database('scheduling_emails').where('id', Number(req.params.id)).first()
      if (!row) return res.status(404).json({ error: 'Message not found' })
      if (!row.folder || !row.imap_uid) return res.status(410).json({ error: 'No IMAP source for this message' })
      const index = Number(req.params.index)
      const client = imapClient()
      await client.connect()
      try {
        const lock = await client.getMailboxLock(row.folder)
        let msg
        try {
          msg = await client.fetchOne(String(row.imap_uid), { source: true }, { uid: true })
        } finally {
          lock.release()
        }
        if (!msg || !msg.source) return res.status(410).json({ error: 'Message no longer at stored IMAP location' })
        const parsed = await simpleParser(msg.source)
        // UID reuse safety: make sure we fetched the same message we stored.
        if (stripBrackets(parsed.messageId) !== row.message_id) {
          return res.status(410).json({ error: 'Message no longer at stored IMAP location' })
        }
        const att = (parsed.attachments || [])[index]
        if (!att) return res.status(404).json({ error: 'Attachment not found' })
        const filename = (att.filename || `attachment-${index + 1}`).replace(/[\r\n"]/g, '')
        res.setHeader('Content-Type', att.contentType || 'application/octet-stream')
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
        res.send(att.content)
      } finally {
        await client.logout().catch(() => {})
      }
    } catch (err) { fail(res, 'admin/terminplanung/mailbox/attachment', err, req) }
  })
}
