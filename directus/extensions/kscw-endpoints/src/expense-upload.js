/**
 * Expense reimbursement upload + OCR.
 *
 * Members who paid for something out of pocket upload the receipt/invoice; the
 * OCR endpoint extracts amount/date/vendor/description (so they don't retype it);
 * the submit endpoint emails the confirmed data + the file to finance. No in-app
 * review queue (email-only) — the file lives in directus_files, the audit trail
 * in user_logs (writeUserLog on submit, per CLAUDE.md actor-capture rule).
 *
 * POST /kscw/expenses/ocr     body { fileId }                → extracted fields
 * POST /kscw/expenses/submit  body { fileId, amount, ... }   → { success: true }
 *
 * Both require an authenticated member (session cookie). OCR reuses the existing
 * ANTHROPIC_API_KEY + the raw-fetch pattern from sql-ai.js; the file bytes are
 * read from the local uploads dir via directus_files.filename_disk.
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { writeErrorLog } from './error-log.js'
import { writeUserLog } from './activity-log.js'
import { buildEmailLayout, buildInfoCard, escHtml } from './email-template.js'

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || ''
const OCR_MODEL = process.env.EXPENSE_OCR_MODEL || 'claude-haiku-4-5'
const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET || ''
// Recipient for submitted reimbursements. Overridable per environment via env;
// the default is the club finance inbox so a missing env var never drops the mail.
const FINANCE_INBOX_EMAIL = process.env.FINANCE_INBOX_EMAIL || 'finance@mail.kscw.ch'
const UPLOAD_DIR = process.env.STORAGE_LOCAL_ROOT || '/directus/uploads'
// Abuse / cost guard: each member may scan (OCR) and submit at most 5 receipts
// per rolling hour. In-memory sliding window keyed by Directus user id — fine
// for the single-container deployment (resets on container restart, which is rare).
const RATE_LIMIT_MAX = 5
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000
const rateBuckets = new Map()

/** Verify a Cloudflare Turnstile token (same flow as contact-form.js). */
async function verifyTurnstile(token) {
  if (!TURNSTILE_SECRET) {
    // Fail closed — a missing secret must not silently disable bot protection.
    return false
  }
  if (!token) return false
  try {
    const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `secret=${encodeURIComponent(TURNSTILE_SECRET)}&response=${encodeURIComponent(token)}`,
    })
    return (await resp.json()).success === true
  } catch {
    return false
  }
}

/** Sliding-window rate limit. Throws a 429 Error when the cap is exceeded. */
function enforceRateLimit(bucket, userId) {
  const key = `${bucket}:${userId}`
  const now = Date.now()
  const hits = (rateBuckets.get(key) || []).filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS)
  if (hits.length >= RATE_LIMIT_MAX) {
    const err = new Error(`Rate limit reached — max ${RATE_LIMIT_MAX} per hour. Please try again later.`)
    err.status = 429
    err.code = 'rate_limited'
    throw err
  }
  hits.push(now)
  rateBuckets.set(key, hits)
}
// 32MB request cap on the Anthropic side; keep our own limit well under that
// once base64-expanded (~1.37x). 8MB of source bytes is plenty for a receipt.
const MAX_FILE_BYTES = 8 * 1024 * 1024
const ALLOWED_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])

const OCR_INSTRUCTIONS = `You are extracting structured data from a scanned expense receipt or invoice that a sports-club member paid out of pocket and wants reimbursed. Read the document and call the extract_expense tool with what you find.

Rules:
- amount: the TOTAL amount the member paid (the grand total / "Total" / "Betrag"), as a number. Use a dot decimal separator. Null if you genuinely cannot find it.
- currency: ISO 4217 code (CHF, EUR, …). Default to CHF for Swiss receipts.
- date: the document/purchase date as yyyy-mm-dd. Null if absent.
- vendor: the merchant / supplier / payee name.
- description: a short (max ~80 chars) human description of what was bought.
- reference: any invoice number / reference / QR-bill reference, else null.
- payee_iban: an IBAN printed on the document (e.g. on a QR-bill payment part), else null. This is the VENDOR's IBAN, not the member's.
- Do not invent values. Use null when a field is not present.`

const EXTRACT_TOOL = {
  name: 'extract_expense',
  description: 'Return the structured fields extracted from the expense document.',
  input_schema: {
    type: 'object',
    properties: {
      amount: { type: ['number', 'null'], description: 'Total amount paid' },
      currency: { type: 'string', description: 'ISO 4217 currency code, default CHF' },
      date: { type: ['string', 'null'], description: 'Document date as yyyy-mm-dd' },
      vendor: { type: ['string', 'null'], description: 'Merchant / payee name' },
      description: { type: ['string', 'null'], description: 'Short description of the purchase' },
      reference: { type: ['string', 'null'], description: 'Invoice/reference number or null' },
      payee_iban: { type: ['string', 'null'], description: "Vendor's IBAN if printed, else null" },
    },
    required: ['amount', 'currency', 'date', 'vendor', 'description', 'reference', 'payee_iban'],
  },
}

function requireMember(req) {
  if (!req.accountability?.user) {
    const err = new Error('Authentication required')
    err.status = 401
    throw err
  }
}

/** Load a directus_files row + its raw bytes from local storage. */
async function loadFile(database, fileId) {
  const row = await database('directus_files')
    .where({ id: fileId })
    .first('id', 'filename_disk', 'filename_download', 'type', 'filesize')
  if (!row || !row.filename_disk) {
    const err = new Error('File not found')
    err.status = 404
    throw err
  }
  if (!ALLOWED_MIME.has(row.type)) {
    const err = new Error('Unsupported file type — upload a PDF or image (JPG/PNG)')
    err.status = 400
    throw err
  }
  // Resolve within UPLOAD_DIR and guard against path traversal via filename_disk.
  const filePath = path.resolve(UPLOAD_DIR, row.filename_disk)
  if (!filePath.startsWith(path.resolve(UPLOAD_DIR) + path.sep)) {
    const err = new Error('Invalid file path')
    err.status = 400
    throw err
  }
  const bytes = await readFile(filePath)
  if (bytes.length > MAX_FILE_BYTES) {
    const err = new Error('File too large (max 8 MB)')
    err.status = 413
    throw err
  }
  return { row, bytes }
}

export function registerExpenseUpload(router, { database, logger, services, getSchema }) {
  const log = logger.child({ endpoint: 'expense-upload' })

  // ── OCR: extract structured fields from an uploaded receipt/invoice ─────────
  router.post('/expenses/ocr', async (req, res) => {
    const started = Date.now()
    let userId = null
    try {
      requireMember(req)
      userId = req.accountability.user

      if (!ANTHROPIC_API_KEY) {
        const err = new Error('OCR is not configured on the backend')
        err.status = 503
        throw err
      }
      // Bot protection (Cloudflare Turnstile) — gates the costly vision call.
      if (!(await verifyTurnstile(req.body?.turnstile_token))) {
        const err = new Error('Security check failed — please try again')
        err.status = 400
        err.code = 'turnstile'
        throw err
      }
      // Cost guard: max 5 OCR scans per member per hour.
      enforceRateLimit('ocr', userId)

      const fileId = String(req.body?.fileId ?? '').trim()
      if (!fileId) return res.status(400).json({ error: 'fileId required' })

      const { row, bytes } = await loadFile(database, fileId)
      const b64 = bytes.toString('base64')
      const isPdf = row.type === 'application/pdf'
      const fileBlock = isPdf
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
        : { type: 'image', source: { type: 'base64', media_type: row.type, data: b64 } }

      const anthropicResp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: OCR_MODEL,
          max_tokens: 1024,
          tools: [EXTRACT_TOOL],
          tool_choice: { type: 'tool', name: 'extract_expense' },
          messages: [{
            role: 'user',
            content: [fileBlock, { type: 'text', text: OCR_INSTRUCTIONS }],
          }],
        }),
      })

      const data = await anthropicResp.json()
      if (!anthropicResp.ok || data.error) {
        const errMsg = data?.error?.message || `Anthropic API ${anthropicResp.status}`
        const err = new Error(errMsg)
        err.status = 502
        err.code = 'anthropic_error'
        throw err
      }

      const toolUse = (data.content || []).find((b) => b.type === 'tool_use' && b.name === 'extract_expense')
      const raw = toolUse?.input || {}
      // Defensive coercion — the model is forced to call the tool but we never
      // trust the shape blindly.
      const amountNum = typeof raw.amount === 'number' ? raw.amount
        : (raw.amount != null && !Number.isNaN(Number(raw.amount)) ? Number(raw.amount) : null)
      const extracted = {
        amount: amountNum,
        currency: typeof raw.currency === 'string' && raw.currency.trim() ? raw.currency.trim().toUpperCase().slice(0, 3) : 'CHF',
        date: typeof raw.date === 'string' ? raw.date.slice(0, 10) : null,
        vendor: typeof raw.vendor === 'string' ? raw.vendor.slice(0, 200) : null,
        description: typeof raw.description === 'string' ? raw.description.slice(0, 300) : null,
        reference: typeof raw.reference === 'string' ? raw.reference.slice(0, 140) : null,
        payee_iban: typeof raw.payee_iban === 'string' ? raw.payee_iban.replace(/\s+/g, '').toUpperCase().slice(0, 34) : null,
      }

      const usage = data.usage || {}
      writeErrorLog({
        level: 'info', source: 'backend', project: 'wiedisync', event: 'expense_ocr',
        endpoint: '/expenses/ocr', userId, action: 'ocr', status: 200,
        durationMs: Date.now() - started, model: OCR_MODEL,
        tokensIn: usage.input_tokens ?? null, tokensOut: usage.output_tokens ?? null,
      })
      res.json({ extracted })
    } catch (err) {
      writeErrorLog({
        level: 'error', source: 'backend', project: 'wiedisync', event: 'expense_ocr',
        endpoint: '/expenses/ocr', userId, action: 'ocr', status: err.status || 500,
        durationMs: Date.now() - started, error: err.message?.slice(0, 1000) ?? null,
      })
      res.status(err.status || 500).json({ error: err.status ? err.message : 'Internal error' })
    }
  })

  // ── Submit: email the confirmed reimbursement + the file to finance ─────────
  router.post('/expenses/submit', async (req, res) => {
    try {
      requireMember(req)
      const userId = req.accountability.user
      // Cost/spam guard: max 5 reimbursement submissions per member per hour.
      enforceRateLimit('submit', userId)

      const fileId = String(req.body?.fileId ?? '').trim()
      if (!fileId) return res.status(400).json({ error: 'fileId required' })

      const amount = req.body?.amount
      if (amount == null || Number.isNaN(Number(amount)) || Number(amount) <= 0) {
        return res.status(400).json({ error: 'A positive amount is required' })
      }
      const currency = String(req.body?.currency || 'CHF').trim().toUpperCase().slice(0, 3)
      const date = req.body?.date ? String(req.body.date).slice(0, 10) : ''
      const vendor = String(req.body?.vendor || '').replace(/[\r\n]/g, ' ').slice(0, 200)
      const description = String(req.body?.description || '').replace(/[\r\n]/g, ' ').slice(0, 300)
      const reference = String(req.body?.reference || '').replace(/[\r\n]/g, ' ').slice(0, 140)
      const note = String(req.body?.note || '').slice(0, 1000)
      const payToIban = String(req.body?.payToIban || '').replace(/\s+/g, '').toUpperCase().slice(0, 34)

      // Submitter identity for the finance email.
      const member = await database('members')
        .where({ user: userId })
        .first('id', 'first_name', 'last_name', 'email')
      const submitterName = member ? `${member.first_name || ''} ${member.last_name || ''}`.trim() : 'Unknown member'
      const submitterEmail = member?.email || null

      const { row, bytes } = await loadFile(database, fileId)

      const fmtAmount = `${currency} ${Number(amount).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      const rows = [
        { label: 'Member', value: submitterName },
        ...(submitterEmail ? [{ label: 'Email', value: submitterEmail }] : []),
        { label: 'Amount', value: fmtAmount, halfWidth: true },
        { label: 'Date', value: date || '—', halfWidth: true },
        { label: 'Vendor', value: vendor || '—' },
        { label: 'Description', value: description || '—' },
        ...(reference ? [{ label: 'Reference', value: reference }] : []),
        { label: 'Pay to IBAN', value: payToIban || '—' },
      ]
      let bodyHtml = buildInfoCard(rows)
      if (note) {
        bodyHtml += `<div style="margin-top:14px;font-size:14px;color:#e2e8f0"><div style="font-size:11px;text-transform:uppercase;color:#64748b;letter-spacing:0.5px;margin-bottom:4px">Note</div>${escHtml(note)}</div>`
      }
      const html = buildEmailLayout(bodyHtml, {
        title: 'Expense reimbursement',
        subtitle: submitterName,
        greeting: 'A member submitted an expense for reimbursement. The original document is attached.',
      })

      const schema = await getSchema()
      const { MailService } = services
      const mail = new MailService({ schema, knex: database })
      await mail.send({
        to: FINANCE_INBOX_EMAIL,
        ...(submitterEmail ? { cc: submitterEmail } : {}),
        subject: `Spesen / expense — ${submitterName} — ${fmtAmount}`,
        html,
        attachments: [{
          filename: row.filename_download || 'receipt',
          content: bytes,
          contentType: row.type,
        }],
      })

      // Actor capture: this is a "send" mutation (CLAUDE.md audit rule).
      await writeUserLog(database, log, {
        accountability: req.accountability,
        action: 'submit_expense',
        collection: 'directus_files',
        recordId: fileId,
        data: { amount: Number(amount), currency, date, vendor },
      })

      log.info(`Expense submitted by member ${member?.id ?? '?'} (${fmtAmount})`)
      res.json({ success: true })
    } catch (err) {
      log.error({ msg: `expense submit: ${err.message}`, stack: err.stack })
      res.status(err.status || 500).json({ error: err.status ? err.message : 'Internal error' })
    }
  })

  log.info('[expense-upload] routes registered')
}
