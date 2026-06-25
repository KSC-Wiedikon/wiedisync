/**
 * Native invoices (Scope C write-path) — see migrations 128 + 129.
 *
 * ClubDesk stays the source of truth for accounting; these endpoints add the
 * member-facing layer ClubDesk can't do: ad-hoc invoices billed to a member OR
 * a team (e.g. a Swiss Volley fine), payable in-app via the existing QR-bill.
 *
 * Lifecycle (native rows, source='native', on the shared `status` column):
 *   open ──member taps "I've paid"──▶ pending_confirmation
 *        ──treasurer confirms / next ClubDesk sync matches──▶ paid
 *   (cancelled is terminal; set by the treasurer)
 *
 * A member never flips an invoice straight to paid — they self-report, and the
 * treasurer (here) or the sync (Phase 2, import-clubdesk-finance.mjs) confirms.
 *
 * Routes (all under /kscw):
 *   POST   /finance/invoices                 Vorstand — create native invoice
 *   GET    /finance/my-invoices              authed   — own + team-responsible invoices
 *   POST   /finance/invoices/:id/report-paid authed   — recipient self-reports payment
 *   POST   /finance/invoices/:id/confirm     Vorstand — confirm payment (manual)
 *   POST   /finance/invoices/:id/cancel      Vorstand — void a native invoice
 *   POST   /finance/invoices/:id/link-member Vorstand — link an orphaned ClubDesk invoice to a member
 *   DELETE /finance/invoices/:id/link-member Vorstand — remove that link
 *
 * Raw-knex writes → every mutation calls writeUserLog (CLAUDE.md actor-capture).
 */
import { writeUserLog } from './activity-log.js'
import { buildEmailLayout, buildInfoCard, buildAlertBox, FRONTEND_URL } from './email-template.js'
import { renderInvoiceQrBillPdf } from './finance-qrbill.js'
import { recomputeInvoice } from './finance-recompute.js'

const PAY_METHODS = ['twint', 'bank', 'cash', 'other']

/**
 * ISO-11649 Creditor Reference (SCOR) — "RF" + 2 check digits + body. Valid on a
 * REGULAR IBAN (no QR-IBAN needed), and carried in the QR-bill so a later
 * camt.054 import can match the payment back to this invoice. Body = numeric
 * invoice id. Check via ISO 7064 mod-97-10 (append "RF00", letters→A=10…Z=35).
 */
function scorReference(idNum) {
  const body = String(idNum)
  let rem = 0
  for (const ch of body + 'RF00') {
    const token = /[0-9]/.test(ch) ? ch : String(ch.charCodeAt(0) - 55) // A=10 … Z=35
    for (const d of token) rem = (rem * 10 + (d.charCodeAt(0) - 48)) % 97
  }
  return `RF${String(98 - rem).padStart(2, '0')}${body}`
}

/** Pick the CHF dues rate for a member: a sektion-specific row wins over the
 *  category default (sektion NULL). Returns the matching rate row or null. */
function pickRate(rates, category, sektion) {
  const cat = (category || '').toLowerCase()
  const inCat = rates.filter((r) => r.active && (r.category || '').toLowerCase() === cat)
  return inCat.find((r) => r.sektion && sektion && r.sektion.toLowerCase() === String(sektion).toLowerCase())
      || inCat.find((r) => !r.sektion)
      || null
}

/** Reject after `ms` so one hung send can't stall a whole chunk. */
function withTimeout(promise, ms, label) {
  let t
  const timeout = new Promise((_, reject) => { t = setTimeout(() => reject(new Error(label || 'timeout')), ms) })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t))
}

/** Compose a dues-invoice notification email (German — the club's canonical
 *  language). In test mode a banner shows where it WOULD have gone. The body only
 *  promises a PDF when one is actually attached. */
function composeDuesEmail(inv, amount, runLabel, { testMode, realRecipient, hasAttachment }) {
  const amountStr = `CHF ${Number(amount).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const rows = [
    { label: 'Rechnung', value: inv.number || '–', halfWidth: true },
    { label: 'Betrag', value: amountStr, halfWidth: true },
    { label: 'Betreff', value: inv.subject || '–' },
  ]
  if (inv.reference_type === 'SCOR' && inv.reference) rows.push({ label: 'Referenz', value: inv.reference })
  const payLine = hasAttachment
    ? 'Die QR-Rechnung ist als PDF angehängt. Du kannst sie auch direkt in der App mit QR-Rechnung oder TWINT bezahlen.'
    : 'Du kannst diese Rechnung direkt in der App mit QR-Rechnung oder TWINT bezahlen.'
  let body = buildInfoCard(rows)
    + `<div style="font-size:14px;color:#cbd5e1;margin-top:12px">${payLine}</div>`
  if (testMode) body = buildAlertBox('warning', 'Testmodus', `Diese E-Mail wäre an ${realRecipient || 'das Mitglied'} gegangen.`) + body
  const firstName = (inv.recipient_name || '').trim().split(/\s+/)[0]
  return buildEmailLayout(body, {
    title: 'Mitgliederbeitrag',
    subtitle: runLabel || '',
    greeting: firstName ? `Hallo ${firstName}` : 'Hallo',
    ctaUrl: `${FRONTEND_URL}/finance/dues`,
    ctaLabel: 'Rechnung ansehen',
  })
}

export function registerFinance(router, { database, logger, services, getSchema }) {
  const log = logger.child({ extension: 'kscw-endpoints', module: 'finance' })

  function err(res, req, endpoint, e, code = 500) {
    log.error({ msg: `finance/${endpoint}: ${e.message}`, endpoint: `finance/${endpoint}`, userId: req.accountability?.user || null, method: req.method, stack: e.stack })
    return res.status(code).json({ error: 'Internal error' })
  }

  /** Resolve the calling Directus user to a member row + parsed roles. */
  async function actingMember(req) {
    const userId = req.accountability?.user
    if (!userId) return null
    const m = await database('members').where('user', userId).first('id', 'first_name', 'last_name', 'email', 'role')
    if (!m) return null
    const roles = Array.isArray(m.role) ? m.role : (m.role ? (() => { try { return JSON.parse(m.role) } catch { return [] } })() : [])
    return {
      id: m.id,
      name: [m.first_name, m.last_name].filter(Boolean).join(' ').trim() || null,
      email: m.email || null,
      roles,
    }
  }
  // Finance management = board (Vorstand/admin/superuser) OR the dedicated
  // 'finance' role (treasurer / finance team). All finance WRITE endpoints gate
  // on this; the orthogonal 'finance' role grants the same finance powers without
  // the rest of board-wide access. admin_access bypasses via accountability.admin.
  const canManageFinance = (req, mem) =>
    !!req.accountability?.admin || (!!mem && ['vorstand', 'admin', 'superuser', 'finance'].some((r) => mem.roles.includes(r)))

  /** Team ids the member leads (coach / captain / team-responsible). */
  async function ledTeamIds(memberId) {
    const [coach, tr, cap] = await Promise.all([
      database('teams_coaches').where('members_id', memberId).pluck('teams_id'),
      database('teams_responsibles').where('members_id', memberId).pluck('teams_id'),
      database('teams').where('captain', memberId).pluck('id'),
    ])
    return [...new Set([...coach, ...tr, ...cap].map(Number))]
  }

  const todayISO = () => new Date().toISOString().slice(0, 10)
  const round2 = (n) => Math.round(Number(n) * 100) / 100

  async function fiscalYearIdForDate(iso) {
    const fy = await database('finance_fiscal_years')
      .where('starts_on', '<=', iso).andWhere('ends_on', '>=', iso)
      .orderBy('id').first('id')
    return fy?.id ?? null
  }

  // ── POST /finance/invoices — create a native invoice ────────────────────
  router.post('/finance/invoices', async (req, res) => {
    try {
      const mem = await actingMember(req)
      if (!canManageFinance(req, mem)) return res.status(403).json({ error: 'Forbidden' })

      const b = req.body || {}
      const recipientType = b.recipient_type === 'team' ? 'team' : 'member'
      const amount = round2(b.amount)
      const subject = (b.subject || '').toString().trim()
      const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(b.due_date || '') ? b.due_date : null
      const feeCategory = (b.fee_category || '').toString().trim() || null
      if (!(amount > 0)) return res.status(400).json({ error: 'amount must be greater than 0' })
      if (!subject) return res.status(400).json({ error: 'subject is required' })

      let memberId = null, teamId = null, recipientName = null, recipientEmail = null
      if (recipientType === 'member') {
        memberId = Number(b.member)
        const tgt = Number.isInteger(memberId) ? await database('members').where('id', memberId).first('id', 'first_name', 'last_name', 'email') : null
        if (!tgt) return res.status(400).json({ error: 'member not found' })
        recipientName = [tgt.first_name, tgt.last_name].filter(Boolean).join(' ').trim() || null
        recipientEmail = tgt.email || null
      } else {
        teamId = Number(b.team)
        const tgt = Number.isInteger(teamId) ? await database('teams').where('id', teamId).first('id', 'name') : null
        if (!tgt) return res.status(400).json({ error: 'team not found' })
        recipientName = tgt.name || null
      }

      const invoiceDate = todayISO()
      const seqRow = await database.raw("SELECT nextval('finance_native_invoice_seq')::int AS n")
      const seq = (seqRow.rows ? seqRow.rows[0] : seqRow[0]).n
      const number = `N-${invoiceDate.slice(0, 4)}-${String(seq).padStart(4, '0')}`

      const [row] = await database('finance_invoices').insert({
        clubdesk_id: null,
        number,
        invoice_date: invoiceDate,
        subject,
        amount,
        status: 'open',
        due_date: dueDate,
        amount_paid: 0,
        open_amount: amount,
        fee_category: feeCategory,
        recipient_name: recipientName,
        recipient_email: recipientEmail,
        member: memberId,
        team: teamId,
        fiscal_year: await fiscalYearIdForDate(invoiceDate),
        source: 'native',
        created_by_name: mem?.name || null,
        created_by_email: mem?.email || null,
      }).returning('*')

      // Stamp a SCOR reference (id-derived) for camt reconciliation. Best-effort:
      // a generation hiccup must not fail invoice creation.
      let invoice = row
      try {
        const reference = scorReference(row.id)
        const [updated] = await database('finance_invoices').where('id', row.id)
          .update({ reference, reference_type: 'SCOR', date_updated: new Date() }).returning('*')
        if (updated) invoice = updated
      } catch (e) { log.warn?.({ msg: `scor reference gen failed: ${e.message}`, id: row.id }) }

      await writeUserLog(database, log, { accountability: req.accountability, action: 'create', collection: 'finance_invoices', recordId: invoice.id, data: { kind: 'native_invoice', recipient_type: recipientType, member: memberId, team: teamId, amount, number } })
      return res.json({ invoice })
    } catch (e) { return err(res, req, 'create', e) }
  })

  // ── GET /finance/my-invoices — own + team-responsible invoices ──────────
  // Server-side union (system db access) — deliberately NOT a Directus policy
  // filter that walks teams_coaches/responsibles, which silently returns []
  // for non-admins (CLAUDE.md → "M2M deep filter + policy walk").
  router.get('/finance/my-invoices', async (req, res) => {
    try {
      const mem = await actingMember(req)
      if (!mem) return res.status(401).json({ error: 'Unauthenticated' })
      const teamIds = await ledTeamIds(mem.id)

      const rows = await database('finance_invoices as fi')
        .leftJoin('teams as t', 't.id', 'fi.team')
        .where((qb) => {
          qb.where('fi.member', mem.id)
          if (teamIds.length) qb.orWhereIn('fi.team', teamIds)
        })
        .select(
          'fi.id', 'fi.clubdesk_id', 'fi.number', 'fi.invoice_date', 'fi.subject', 'fi.amount',
          'fi.status', 'fi.dunning_status', 'fi.due_date', 'fi.amount_paid', 'fi.open_amount',
          'fi.overpaid_amount', 'fi.written_off_amount', 'fi.payment_method', 'fi.reference', 'fi.reference_type',
          'fi.fee_category', 'fi.closed_on', 'fi.recipient_name', 'fi.member', 'fi.team',
          'fi.source', 'fi.reported_paid_at', 'fi.reported_paid_method', 'fi.reported_paid_by',
          'fi.confirmed_at', 'fi.confirmed_via', 'fi.cancelled_at', 't.name as team_name',
        )
        .orderBy([{ column: 'fi.invoice_date', order: 'desc' }, { column: 'fi.id', order: 'desc' }])
      return res.json({ invoices: rows, member_id: mem.id })
    } catch (e) { return err(res, req, 'my-invoices', e) }
  })

  /** Load a native invoice the caller is the recipient of (member or team lead). */
  async function loadOwnNative(req, id) {
    const mem = await actingMember(req)
    if (!mem) return { code: 401 }
    const inv = await database('finance_invoices').where('id', id).andWhere('source', 'native').first()
    if (!inv) return { code: 404 }
    let isRecipient = inv.member != null && Number(inv.member) === mem.id
    if (!isRecipient && inv.team != null) {
      const teamIds = await ledTeamIds(mem.id)
      isRecipient = teamIds.includes(Number(inv.team))
    }
    if (!isRecipient) return { code: 403 }
    return { mem, inv }
  }

  // ── POST /finance/invoices/:id/report-paid — recipient self-reports ─────
  router.post('/finance/invoices/:id/report-paid', async (req, res) => {
    try {
      const id = Number(req.params.id)
      const r = await loadOwnNative(req, id)
      if (r.code) return res.status(r.code).json({ error: r.code === 403 ? 'Forbidden' : r.code === 404 ? 'Not found' : 'Unauthenticated' })
      if (r.inv.status !== 'open') return res.status(409).json({ error: `Invoice is ${r.inv.status}, not open` })
      const method = PAY_METHODS.includes(req.body?.method) ? req.body.method : null
      const [row] = await database('finance_invoices').where('id', id).update({
        status: 'pending_confirmation',
        reported_paid_at: new Date(),
        reported_paid_method: method,
        reported_paid_by: r.mem.id,
        date_updated: new Date(),
      }).returning('*')
      await writeUserLog(database, log, { accountability: req.accountability, action: 'update', collection: 'finance_invoices', recordId: id, data: { kind: 'report_paid', method } })
      return res.json({ invoice: row })
    } catch (e) { return err(res, req, 'report-paid', e) }
  })

  // ── POST /finance/invoices/:id/confirm — treasurer confirms payment ─────
  router.post('/finance/invoices/:id/confirm', async (req, res) => {
    try {
      const mem = await actingMember(req)
      if (!canManageFinance(req, mem)) return res.status(403).json({ error: 'Forbidden' })
      const id = Number(req.params.id)
      const inv = await database('finance_invoices').where('id', id).andWhere('source', 'native').first()
      if (!inv) return res.status(404).json({ error: 'Not found' })
      if (!['open', 'pending_confirmation', 'partial'].includes(inv.status)) return res.status(409).json({ error: `Invoice is ${inv.status}` })
      // Confirm = record a payment for whatever is still open, then recompute. Keeps
      // the settlement ledger the single source of truth (vs an all-or-nothing flip).
      const remaining = round2(Number(inv.open_amount) > 0 ? Number(inv.open_amount) : Number(inv.amount))
      if (remaining > 0.005) {
        await database('finance_payments').insert({
          invoice: id, amount: remaining, entry_type: 'payment',
          method: inv.reported_paid_method || 'manual', payment_date: todayISO(),
          source: 'native', created_by_name: mem?.name || null, created_by_email: mem?.email || null,
        })
      }
      const row = await recomputeInvoice(database, id, { actorName: mem?.name || null, actorEmail: mem?.email || null, via: 'manual' })
      await writeUserLog(database, log, { accountability: req.accountability, action: 'update', collection: 'finance_invoices', recordId: id, data: { kind: 'confirm_payment', via: 'manual', amount: remaining } })
      return res.json({ invoice: row })
    } catch (e) { return err(res, req, 'confirm', e) }
  })

  // ── Settlement ledger entries — partial payments, cash, credit notes, refunds, write-offs ──
  const ENTRY_TYPES = ['payment', 'credit_note', 'refund', 'writeoff']

  // POST /finance/invoices/:id/payments — record one entry, then recompute settlement
  router.post('/finance/invoices/:id/payments', async (req, res) => {
    try {
      const mem = await actingMember(req)
      if (!canManageFinance(req, mem)) return res.status(403).json({ error: 'Forbidden' })
      const id = Number(req.params.id)
      const inv = await database('finance_invoices').where('id', id).andWhere('source', 'native').first()
      if (!inv) return res.status(404).json({ error: 'Not found (native invoice expected)' })
      if (inv.status === 'cancelled') return res.status(409).json({ error: 'Invoice is cancelled' })
      const b = req.body || {}
      const entryType = ENTRY_TYPES.includes(b.entry_type) ? b.entry_type : 'payment'
      const amount = round2(b.amount)
      if (!(amount > 0)) return res.status(400).json({ error: 'amount must be greater than 0' })
      const method = (entryType === 'payment' || entryType === 'refund') ? (PAY_METHODS.includes(b.method) ? b.method : 'other') : null
      const paymentDate = /^\d{4}-\d{2}-\d{2}$/.test(b.payment_date || '') ? b.payment_date : todayISO()
      const note = (b.note || '').toString().trim().slice(0, 255) || null

      const ins = await database('finance_payments').insert({
        invoice: id, amount, entry_type: entryType, method, payment_date: paymentDate, note,
        source: 'native', created_by_name: mem?.name || null, created_by_email: mem?.email || null,
      }).returning('id')
      const paymentId = ins[0]?.id ?? ins[0]
      const row = await recomputeInvoice(database, id, { actorName: mem?.name || null, actorEmail: mem?.email || null, via: 'manual' })
      await writeUserLog(database, log, { accountability: req.accountability, action: 'create', collection: 'finance_payments', recordId: paymentId, data: { kind: 'manual_payment', entry_type: entryType, invoice: id, amount } })
      return res.json({ invoice: row, payment_id: paymentId })
    } catch (e) { return err(res, req, 'record-payment', e) }
  })

  // DELETE /finance/invoices/:id/payments/:pid — undo a manual entry (camt rows excluded)
  router.delete('/finance/invoices/:id/payments/:pid', async (req, res) => {
    try {
      const mem = await actingMember(req)
      if (!canManageFinance(req, mem)) return res.status(403).json({ error: 'Forbidden' })
      const id = Number(req.params.id)
      const pid = Number(req.params.pid)
      const p = await database('finance_payments').where('id', pid).andWhere('invoice', id).first('id', 'method')
      if (!p) return res.status(404).json({ error: 'Not found' })
      if (p.method === 'camt') return res.status(409).json({ error: 'camt entries are not deletable here (re-import is idempotent)' })
      await database('finance_payments').where('id', pid).del()
      const row = await recomputeInvoice(database, id, { actorName: mem?.name || null, actorEmail: mem?.email || null, via: 'manual' })
      await writeUserLog(database, log, { accountability: req.accountability, action: 'delete', collection: 'finance_payments', recordId: pid, data: { kind: 'delete_payment', invoice: id } })
      return res.json({ invoice: row })
    } catch (e) { return err(res, req, 'delete-payment', e) }
  })

  // GET /finance/invoices/:id/payments — the settlement ledger for one invoice
  router.get('/finance/invoices/:id/payments', async (req, res) => {
    try {
      const mem = await actingMember(req)
      if (!canManageFinance(req, mem)) return res.status(403).json({ error: 'Forbidden' })
      const id = Number(req.params.id)
      const rows = await database('finance_payments').where('invoice', id)
        .orderBy([{ column: 'payment_date', order: 'asc' }, { column: 'id', order: 'asc' }])
        .select('id', 'payment_date', 'amount', 'entry_type', 'method', 'note', 'created_by_name', 'camt_reference', 'source')
      return res.json({ payments: rows })
    } catch (e) { return err(res, req, 'list-payments', e) }
  })

  // ── POST /finance/invoices/:id/cancel — void a native invoice ───────────
  router.post('/finance/invoices/:id/cancel', async (req, res) => {
    try {
      const mem = await actingMember(req)
      if (!canManageFinance(req, mem)) return res.status(403).json({ error: 'Forbidden' })
      const id = Number(req.params.id)
      const inv = await database('finance_invoices').where('id', id).andWhere('source', 'native').first()
      if (!inv) return res.status(404).json({ error: 'Not found' })
      if (inv.status === 'paid') return res.status(409).json({ error: 'Cannot cancel a paid invoice' })
      const [row] = await database('finance_invoices').where('id', id).update({
        status: 'cancelled', open_amount: 0, cancelled_at: new Date(), date_updated: new Date(),
      }).returning('*')
      await writeUserLog(database, log, { accountability: req.accountability, action: 'update', collection: 'finance_invoices', recordId: id, data: { kind: 'cancel_native_invoice' } })
      return res.json({ invoice: row })
    } catch (e) { return err(res, req, 'cancel', e) }
  })

  // ── POST /finance/invoices/:id/link-member — attach an orphan to a member ─
  // Writes a persistent override (survives the sync's delete+reinsert) AND
  // applies it to the current rows. Default scope = by recipient email (links
  // all that recipient's invoices); falls back to this one invoice if no email.
  router.post('/finance/invoices/:id/link-member', async (req, res) => {
    try {
      const mem = await actingMember(req)
      if (!canManageFinance(req, mem)) return res.status(403).json({ error: 'Forbidden' })
      const id = Number(req.params.id)
      const inv = await database('finance_invoices').where('id', id).andWhere('source', 'clubdesk').first()
      if (!inv) return res.status(404).json({ error: 'Not found (ClubDesk invoice expected)' })
      const memberId = Number(req.body?.member)
      const target = Number.isInteger(memberId) ? await database('members').where('id', memberId).first('id') : null
      if (!target) return res.status(400).json({ error: 'member not found' })

      const email = (inv.recipient_email || '').trim().toLowerCase()
      const wantEmail = req.body?.scope !== 'invoice' && !!email
      const reason = (req.body?.reason || '').toString().trim() || null

      let affected
      if (wantEmail) {
        await database('finance_invoice_member_overrides').whereRaw('lower(match_email) = ?', [email]).del()
        await database('finance_invoice_member_overrides').insert({
          match_email: email, member: memberId, reason,
          created_by_name: mem?.name || null, created_by_email: mem?.email || null,
        })
        affected = await database('finance_invoices').where('source', 'clubdesk').whereRaw('lower(recipient_email) = ?', [email]).update({ member: memberId, date_updated: new Date() })
      } else {
        await database('finance_invoice_member_overrides').where('match_clubdesk_id', inv.clubdesk_id).del()
        await database('finance_invoice_member_overrides').insert({
          match_clubdesk_id: inv.clubdesk_id, member: memberId, reason,
          created_by_name: mem?.name || null, created_by_email: mem?.email || null,
        })
        affected = await database('finance_invoices').where('clubdesk_id', inv.clubdesk_id).update({ member: memberId, date_updated: new Date() })
      }
      await writeUserLog(database, log, { accountability: req.accountability, action: 'update', collection: 'finance_invoices', recordId: id, data: { kind: 'link_member', member: memberId, scope: wantEmail ? 'email' : 'invoice', affected } })
      return res.json({ ok: true, scope: wantEmail ? 'email' : 'invoice', affected })
    } catch (e) { return err(res, req, 'link-member', e) }
  })

  // ── DELETE /finance/invoices/:id/link-member — remove the override ──────
  router.delete('/finance/invoices/:id/link-member', async (req, res) => {
    try {
      const mem = await actingMember(req)
      if (!canManageFinance(req, mem)) return res.status(403).json({ error: 'Forbidden' })
      const id = Number(req.params.id)
      const inv = await database('finance_invoices').where('id', id).andWhere('source', 'clubdesk').first()
      if (!inv) return res.status(404).json({ error: 'Not found' })
      const email = (inv.recipient_email || '').trim().toLowerCase()
      let removed = 0
      if (email) removed += await database('finance_invoice_member_overrides').whereRaw('lower(match_email) = ?', [email]).del()
      if (inv.clubdesk_id) removed += await database('finance_invoice_member_overrides').where('match_clubdesk_id', inv.clubdesk_id).del()
      // Clear the member link the override had pinned so the next sync leaves it orphaned.
      let cleared = 0
      if (email) cleared += await database('finance_invoices').where('source', 'clubdesk').whereRaw('lower(recipient_email) = ?', [email]).update({ member: null, date_updated: new Date() })
      else if (inv.clubdesk_id) cleared += await database('finance_invoices').where('clubdesk_id', inv.clubdesk_id).update({ member: null, date_updated: new Date() })
      await writeUserLog(database, log, { accountability: req.accountability, action: 'update', collection: 'finance_invoices', recordId: id, data: { kind: 'unlink_member', removed, cleared } })
      return res.json({ ok: true, removed, cleared })
    } catch (e) { return err(res, req, 'unlink-member', e) }
  })

  // ── Dues runs — recurring / batch membership-dues billing (migration 138) ─
  // Mints ordinary native invoices for a cohort from a per-category rate
  // schedule. Preview is a pure dry-run; issue is idempotent (skips members who
  // already hold a non-cancelled dues invoice this fiscal year).

  /** Resolve the cohort + per-member billing decision. Shared by preview + issue. */
  async function resolveDuesCohort(body) {
    const fiscalYear = Number(body.fiscal_year)
    const fy = Number.isInteger(fiscalYear)
      ? await database('finance_fiscal_years').where('id', fiscalYear).first('id', 'label') : null
    if (!fy) return { error: 'fiscal_year not found' }
    const categories = Array.isArray(body.categories) ? body.categories.map((c) => String(c)).filter(Boolean) : []
    if (!categories.length) return { error: 'categories[] required' }
    const sektion = (body.sektion || '').toString().trim() || null
    const onlyActive = body.only_active !== false // default true

    const rates = await database('finance_dues_rates').where('fiscal_year', fy.id)
      .select('id', 'category', 'sektion', 'amount_chf', 'subject_template', 'active')

    let mq = database('members').whereIn('beitragskategorie', categories)
      .select('id', 'first_name', 'last_name', 'email', 'beitragskategorie', 'sektion')
    if (onlyActive) mq = mq.where('kscw_membership_active', true)
    if (sektion) mq = mq.where('sektion', sektion)
    const members = await mq.orderBy(['last_name', 'first_name'])

    // Members already holding a non-cancelled dues invoice this fiscal year.
    const billed = new Set((await database('finance_invoices')
      .where('fiscal_year', fy.id).whereNotNull('dues_run').whereNotNull('member')
      .whereNot('status', 'cancelled').pluck('member')).map(Number))

    const rows = members.map((m) => {
      const rate = pickRate(rates, m.beitragskategorie, m.sektion)
      return {
        member: m.id,
        name: [m.first_name, m.last_name].filter(Boolean).join(' ').trim() || null,
        email: m.email || null,
        category: m.beitragskategorie || null,
        sektion: m.sektion || null,
        amount: rate ? round2(rate.amount_chf) : null,
        subject_template: rate?.subject_template || null,
        already_billed: billed.has(Number(m.id)),
        missing_rate: !rate,
        missing_email: !m.email,
      }
    })
    return { fy, sektion, onlyActive, categories, rows }
  }

  const duesTotals = (rows) => {
    const billable = rows.filter((x) => !x.missing_rate && !x.already_billed)
    return {
      members: rows.length,
      billable: billable.length,
      billable_amount: round2(billable.reduce((s, x) => s + (x.amount || 0), 0)),
      already_billed: rows.filter((x) => x.already_billed).length,
      missing_rate: rows.filter((x) => x.missing_rate).length,
      no_email: billable.filter((x) => x.missing_email).length,
    }
  }

  // GET /finance/dues-rates?fiscal_year= — rate schedule + real category/sektion values
  router.get('/finance/dues-rates', async (req, res) => {
    try {
      const mem = await actingMember(req)
      if (!canManageFinance(req, mem)) return res.status(403).json({ error: 'Forbidden' })
      const fyId = Number(req.query.fiscal_year)
      const rates = Number.isInteger(fyId)
        ? await database('finance_dues_rates').where('fiscal_year', fyId).orderBy(['category', 'sektion'])
            .select('id', 'fiscal_year', 'category', 'sektion', 'amount_chf', 'subject_template', 'active')
        : []
      // Free-text columns synced from ClubDesk — offer only real live values.
      const categories = await database('members').whereNotNull('beitragskategorie')
        .where('kscw_membership_active', true).distinct('beitragskategorie').orderBy('beitragskategorie').pluck('beitragskategorie')
      const sektionen = await database('members').whereNotNull('sektion')
        .where('kscw_membership_active', true).distinct('sektion').orderBy('sektion').pluck('sektion')
      return res.json({ rates, categories, sektionen })
    } catch (e) { return err(res, req, 'dues-rates', e) }
  })

  // POST /finance/dues-rates — upsert a (fiscal_year, category, sektion) rate
  router.post('/finance/dues-rates', async (req, res) => {
    try {
      const mem = await actingMember(req)
      if (!canManageFinance(req, mem)) return res.status(403).json({ error: 'Forbidden' })
      const b = req.body || {}
      const fiscalYear = Number(b.fiscal_year)
      const category = (b.category || '').toString().trim()
      const sektion = (b.sektion || '').toString().trim() || null
      const amount = round2(b.amount_chf)
      const subjectTemplate = (b.subject_template || '').toString().trim() || null
      const active = b.active !== false
      if (!Number.isInteger(fiscalYear)) return res.status(400).json({ error: 'fiscal_year required' })
      if (!category) return res.status(400).json({ error: 'category required' })
      if (!(amount >= 0)) return res.status(400).json({ error: 'amount_chf must be >= 0' })

      const existing = await database('finance_dues_rates').where('fiscal_year', fiscalYear)
        .whereRaw('lower(category) = lower(?)', [category])
        .whereRaw("coalesce(sektion, '') = coalesce(?, '')", [sektion])
        .first('id')
      let row
      if (existing) {
        const upd = await database('finance_dues_rates').where('id', existing.id)
          .update({ category, sektion, amount_chf: amount, subject_template: subjectTemplate, active, date_updated: new Date() }).returning('*')
        row = upd[0]
      } else {
        const ins = await database('finance_dues_rates').insert({
          fiscal_year: fiscalYear, category, sektion, amount_chf: amount, subject_template: subjectTemplate, active,
          created_by_name: mem?.name || null, created_by_email: mem?.email || null,
        }).returning('*')
        row = ins[0]
      }
      await writeUserLog(database, log, { accountability: req.accountability, action: existing ? 'update' : 'create', collection: 'finance_dues_rates', recordId: row.id, data: { fiscal_year: fiscalYear, category, sektion, amount } })
      return res.json({ rate: row })
    } catch (e) { return err(res, req, 'dues-rate-save', e) }
  })

  // DELETE /finance/dues-rates/:id
  router.delete('/finance/dues-rates/:id', async (req, res) => {
    try {
      const mem = await actingMember(req)
      if (!canManageFinance(req, mem)) return res.status(403).json({ error: 'Forbidden' })
      const id = Number(req.params.id)
      const removed = await database('finance_dues_rates').where('id', id).del()
      await writeUserLog(database, log, { accountability: req.accountability, action: 'delete', collection: 'finance_dues_rates', recordId: id, data: { removed } })
      return res.json({ ok: true, removed })
    } catch (e) { return err(res, req, 'dues-rate-delete', e) }
  })

  // POST /finance/dues-runs/preview — dry-run, no writes
  router.post('/finance/dues-runs/preview', async (req, res) => {
    try {
      const mem = await actingMember(req)
      if (!canManageFinance(req, mem)) return res.status(403).json({ error: 'Forbidden' })
      const r = await resolveDuesCohort(req.body || {})
      if (r.error) return res.status(400).json({ error: r.error })
      return res.json({ fiscal_year: r.fy, rows: r.rows, totals: duesTotals(r.rows) })
    } catch (e) { return err(res, req, 'dues-preview', e) }
  })

  // POST /finance/dues-runs/issue — mint native invoices for the billable cohort
  router.post('/finance/dues-runs/issue', async (req, res) => {
    try {
      const mem = await actingMember(req)
      if (!canManageFinance(req, mem)) return res.status(403).json({ error: 'Forbidden' })
      const body = req.body || {}
      const r = await resolveDuesCohort(body)
      if (r.error) return res.status(400).json({ error: r.error })
      const billable = r.rows.filter((x) => !x.missing_rate && !x.already_billed)
      if (!billable.length) return res.status(409).json({ error: 'Nothing to bill (no members with a rate that are not already billed)' })

      const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(body.due_date || '') ? body.due_date : null
      const invoiceDate = todayISO()
      const fyLabel = r.fy.label
      const label = (body.label || '').toString().trim() || `Dues ${fyLabel}`

      const result = await database.transaction(async (trx) => {
        const runIns = await trx('finance_dues_runs').insert({
          fiscal_year: r.fy.id, label,
          filter_json: JSON.stringify({ categories: r.categories, sektion: r.sektion, only_active: r.onlyActive, due_date: dueDate }),
          status: 'issued', created_by_name: mem?.name || null, created_by_email: mem?.email || null,
        }).returning('id')
        const runId = runIns[0]?.id ?? runIns[0]

        const created = []
        let total = 0
        for (const x of billable) {
          const seqRow = await trx.raw("SELECT nextval('finance_native_invoice_seq')::int AS n")
          const seq = (seqRow.rows ? seqRow.rows[0] : seqRow[0]).n
          const number = `N-${invoiceDate.slice(0, 4)}-${String(seq).padStart(4, '0')}`
          const subject = (x.subject_template || `Mitgliederbeitrag ${fyLabel}`)
            .replace(/\{fy\}/g, fyLabel).replace(/\{category\}/g, x.category || '')
          const ins = await trx('finance_invoices').insert({
            clubdesk_id: null, number, invoice_date: invoiceDate, subject,
            amount: x.amount, status: 'open', due_date: dueDate,
            amount_paid: 0, open_amount: x.amount, fee_category: x.category,
            recipient_name: x.name, recipient_email: x.email,
            member: x.member, team: null, dues_run: runId, fiscal_year: r.fy.id,
            source: 'native', created_by_name: mem?.name || null, created_by_email: mem?.email || null,
          }).returning('id')
          const invId = ins[0]?.id ?? ins[0]
          try {
            await trx('finance_invoices').where('id', invId)
              .update({ reference: scorReference(invId), reference_type: 'SCOR', date_updated: new Date() })
          } catch (e) { log.warn?.({ msg: `dues scor gen failed: ${e.message}`, id: invId }) }
          created.push({ member: x.member, invoice: number, amount: x.amount })
          total = round2(total + x.amount)
        }
        await trx('finance_dues_runs').where('id', runId).update({ total_count: created.length, total_amount: total })
        return { runId, created, total }
      })

      await writeUserLog(database, log, { accountability: req.accountability, action: 'create', collection: 'finance_dues_runs', recordId: result.runId, data: { kind: 'dues_run_issue', fiscal_year: r.fy.id, count: result.created.length, total: result.total } })
      return res.json({
        run: { id: result.runId, label, fiscal_year: r.fy.id, total_count: result.created.length, total_amount: result.total },
        summary: { created: result.created.length, skipped_already_billed: r.rows.filter((x) => x.already_billed).length, skipped_no_rate: r.rows.filter((x) => x.missing_rate).length },
        details: result.created,
      })
    } catch (e) { return err(res, req, 'dues-issue', e) }
  })

  // POST /finance/dues-runs/:id/cancel — bulk-void a run's still-open invoices
  router.post('/finance/dues-runs/:id/cancel', async (req, res) => {
    try {
      const mem = await actingMember(req)
      if (!canManageFinance(req, mem)) return res.status(403).json({ error: 'Forbidden' })
      const id = Number(req.params.id)
      const run = await database('finance_dues_runs').where('id', id).first()
      if (!run) return res.status(404).json({ error: 'Not found' })
      const cancelled = await database('finance_invoices')
        .where('dues_run', id).whereNotIn('status', ['paid', 'cancelled'])
        .update({ status: 'cancelled', open_amount: 0, cancelled_at: new Date(), date_updated: new Date() })
      await database('finance_dues_runs').where('id', id).update({ status: 'cancelled' })
      await writeUserLog(database, log, { accountability: req.accountability, action: 'update', collection: 'finance_dues_runs', recordId: id, data: { kind: 'dues_run_cancel', cancelled } })
      return res.json({ ok: true, cancelled })
    } catch (e) { return err(res, req, 'dues-cancel', e) }
  })

  // GET /finance/dues-runs?fiscal_year= — past runs for the console
  router.get('/finance/dues-runs', async (req, res) => {
    try {
      const mem = await actingMember(req)
      if (!canManageFinance(req, mem)) return res.status(403).json({ error: 'Forbidden' })
      const fyId = Number(req.query.fiscal_year)
      let q = database('finance_dues_runs as r')
        .leftJoin('finance_fiscal_years as fy', 'fy.id', 'r.fiscal_year')
        .select('r.id', 'r.fiscal_year', 'fy.label as fiscal_year_label', 'r.label', 'r.status',
          'r.total_count', 'r.total_amount', 'r.created_by_name', 'r.date_created')
        .orderBy([{ column: 'r.date_created', order: 'desc' }, { column: 'r.id', order: 'desc' }])
      if (Number.isInteger(fyId)) q = q.where('r.fiscal_year', fyId)
      const runs = await q.limit(200)
      return res.json({ runs })
    } catch (e) { return err(res, req, 'dues-runs', e) }
  })

  // GET /finance/dues-runs/:id/invoices — a run's (non-cancelled) invoices, for the
  // bulk QR-bill PDF the treasurer prints/posts. Read-only.
  router.get('/finance/dues-runs/:id/invoices', async (req, res) => {
    try {
      const mem = await actingMember(req)
      if (!canManageFinance(req, mem)) return res.status(403).json({ error: 'Forbidden' })
      const id = Number(req.params.id)
      const run = await database('finance_dues_runs').where('id', id).first('id', 'label')
      if (!run) return res.status(404).json({ error: 'Not found' })
      const invoices = await database('finance_invoices')
        .where('dues_run', id).whereNot('status', 'cancelled').orderBy('id')
        .select('id', 'number', 'recipient_name', 'subject', 'amount', 'open_amount', 'status', 'reference', 'reference_type')
      return res.json({ run, invoices })
    } catch (e) { return err(res, req, 'dues-run-invoices', e) }
  })

  // ── Dues-run email send + the global TEST MODE switch (migration 140) ────
  // test_mode (default ON) redirects EVERY send to test_recipient, so no member
  // is ever emailed until an admin turns it off. Layered guards: dry_run preview
  // (default) → test-mode redirect → explicit confirm for a live send.

  const emailSettings = async () => {
    const s = await database('finance_email_settings').where('id', 1).first()
    return { test_mode: s ? s.test_mode !== false : true, test_recipient: s?.test_recipient || null }
  }

  // GET /finance/email-settings — current test-mode + recipient
  router.get('/finance/email-settings', async (req, res) => {
    try {
      const mem = await actingMember(req)
      if (!canManageFinance(req, mem)) return res.status(403).json({ error: 'Forbidden' })
      return res.json(await emailSettings())
    } catch (e) { return err(res, req, 'email-settings', e) }
  })

  // PUT /finance/email-settings — flip test mode / set the test recipient (logged)
  router.put('/finance/email-settings', async (req, res) => {
    try {
      const mem = await actingMember(req)
      if (!canManageFinance(req, mem)) return res.status(403).json({ error: 'Forbidden' })
      const testMode = req.body?.test_mode !== false // default ON; only explicit false disables
      const testRecipient = (req.body?.test_recipient || '').toString().trim() || null
      await database('finance_email_settings')
        .insert({ id: 1, test_mode: testMode, test_recipient: testRecipient, updated_by_name: mem?.name || null, updated_by_email: mem?.email || null, date_updated: new Date() })
        .onConflict('id').merge()
      await writeUserLog(database, log, { accountability: req.accountability, action: 'update', collection: 'finance_email_settings', recordId: 1, data: { kind: 'finance_email_test_mode', test_mode: testMode, test_recipient: testRecipient } })
      return res.json(await emailSettings())
    } catch (e) { return err(res, req, 'email-settings-save', e) }
  })

  // POST /finance/dues-runs/:id/send-emails — preview (default) or send.
  router.post('/finance/dues-runs/:id/send-emails', async (req, res) => {
    try {
      const mem = await actingMember(req)
      if (!canManageFinance(req, mem)) return res.status(403).json({ error: 'Forbidden' })
      const id = Number(req.params.id)
      const run = await database('finance_dues_runs').where('id', id).first('id', 'label')
      if (!run) return res.status(404).json({ error: 'Not found' })
      const dryRun = req.body?.dry_run !== false // default true = preview, no send
      const confirm = req.body?.confirm === true
      const settings = await emailSettings()

      const invoices = await database('finance_invoices')
        .where('dues_run', id).whereNot('status', 'cancelled')
        .select('id', 'number', 'recipient_name', 'recipient_email', 'subject', 'amount', 'open_amount', 'reference', 'reference_type', 'email_sent_at')
      const emailable = invoices.filter((i) => (i.recipient_email || '').trim())
      const noEmail = invoices.length - emailable.length
      // Live sends skip invoices already emailed (idempotent resume after a crash);
      // test mode re-sends all so it stays repeatable.
      const withEmail = settings.test_mode ? emailable : emailable.filter((i) => !i.email_sent_at)

      if (dryRun) {
        return res.json({
          mode: 'dry_run', test_mode: settings.test_mode, test_recipient: settings.test_recipient,
          would_send: withEmail.length, no_email: noEmail, total: invoices.length,
          recipients: withEmail.slice(0, 300).map((i) => ({ invoice: i.number, name: i.recipient_name, email: i.recipient_email })),
        })
      }
      if (!confirm) return res.status(400).json({ error: 'confirm required for a real send' })
      if (settings.test_mode && !settings.test_recipient) return res.status(400).json({ error: 'Set a test recipient first (test mode is on)' })
      if (!withEmail.length) return res.status(409).json({ error: 'No recipients with an email' })

      // At-most-one running send per run. Reap a stuck 'running' row (crashed
      // worker; its date_updated/created is older than the staleness window) so the
      // partial-unique index can't lock sending forever — then let the DB index
      // enforce atomicity (TOCTOU-proof, unlike a check-then-insert).
      const staleBefore = new Date(Date.now() - 15 * 60 * 1000)
      await database('finance_email_jobs').where('dues_run', id).where('status', 'running')
        .whereRaw('coalesce(date_updated, date_created) < ?', [staleBefore])
        .update({ status: 'failed', error: 'worker_lost', date_updated: new Date() })

      let jobId
      try {
        const jobIns = await database('finance_email_jobs').insert({
          dues_run: id, status: 'running', test_mode: settings.test_mode, total: withEmail.length,
          sent: 0, failed: 0, created_by_name: mem?.name || null, created_by_email: mem?.email || null,
        }).returning('id')
        jobId = jobIns[0]?.id ?? jobIns[0]
      } catch (e) {
        if (e?.code === '23505') return res.status(409).json({ error: 'A send is already running for this run' })
        throw e
      }
      await writeUserLog(database, log, { accountability: req.accountability, action: 'create', collection: 'finance_email_jobs', recordId: jobId, data: { kind: 'dues_email_send', run: id, test_mode: settings.test_mode, total: withEmail.length } })

      // Respond immediately; send in the background, chunked, updating job progress.
      res.status(202).json({ job_id: jobId, total: withEmail.length, test_mode: settings.test_mode, mode: settings.test_mode ? 'test' : 'live' })

      const CHUNK = 20
      void (async () => {
        const schema = await getSchema()
        const { MailService } = services
        const mail = new MailService({ schema, knex: database })
        let sent = 0, failed = 0, lastError = null
        for (let i = 0; i < withEmail.length; i += CHUNK) {
          for (const inv of withEmail.slice(i, i + CHUNK)) {
            const amount = Number(inv.open_amount) > 0 ? Number(inv.open_amount) : Number(inv.amount)
            const to = settings.test_mode ? settings.test_recipient : inv.recipient_email
            try {
              // Render the QR-bill first so the body only promises a PDF when one attaches.
              const attachments = []
              try {
                const message = [inv.number ? `Rechnungsnummer: ${inv.number}` : null, inv.subject].filter(Boolean).join('\n')
                const pdf = await renderInvoiceQrBillPdf({
                  amount, number: inv.number, recipientName: inv.recipient_name, subject: inv.subject,
                  message, reference: inv.reference_type === 'SCOR' ? inv.reference : null,
                })
                attachments.push({ filename: `${inv.number || 'Rechnung'}.pdf`, content: pdf, contentType: 'application/pdf' })
              } catch (pe) { log.warn?.({ msg: `dues qr-bill render failed: ${pe.message}`, invoice: inv.number }) }
              const html = composeDuesEmail(inv, amount, run.label, { testMode: settings.test_mode, realRecipient: inv.recipient_email, hasAttachment: attachments.length > 0 })
              await withTimeout(mail.send({ to, subject: `${settings.test_mode ? '[TEST] ' : ''}Mitgliederbeitrag${run.label ? ` ${run.label}` : ''} — ${inv.number}`, html, ...(attachments.length ? { attachments } : {}) }), 60000, 'mail.send timeout')
              // Mark LIVE sends so a resumed/retried run skips them (no double-email). Test sends don't mark.
              if (!settings.test_mode) { try { await database('finance_invoices').where('id', inv.id).update({ email_sent_at: new Date() }) } catch { /* noop */ } }
              sent++
            } catch (e) { failed++; lastError = e?.message || String(e); log.warn?.({ msg: `dues email failed: ${e?.message}`, invoice: inv.number }) }
          }
          await database('finance_email_jobs').where('id', jobId).update({ sent, failed, date_updated: new Date() })
        }
        // All-failed is a terminal failure the operator must see, not a green 'done'.
        const finalStatus = sent === 0 && failed > 0 ? 'failed' : 'done'
        const finalError = sent === 0 && failed > 0 ? `Alle ${failed} Sendungen fehlgeschlagen${lastError ? `: ${lastError}` : ''}`.slice(0, 500) : null
        await database('finance_email_jobs').where('id', jobId).update({ status: finalStatus, sent, failed, error: finalError, date_updated: new Date() })
      })().catch(async (e) => {
        log.error?.({ msg: `dues email job ${jobId} crashed: ${e.message}`, stack: e.stack })
        try { await database('finance_email_jobs').where('id', jobId).update({ status: 'failed', error: String(e.message || e).slice(0, 500), date_updated: new Date() }) } catch { /* noop */ }
      })
    } catch (e) { return err(res, req, 'dues-send-emails', e) }
  })

  // GET /finance/dues-runs/:id/email-job — latest send job for progress polling
  router.get('/finance/dues-runs/:id/email-job', async (req, res) => {
    try {
      const mem = await actingMember(req)
      if (!canManageFinance(req, mem)) return res.status(403).json({ error: 'Forbidden' })
      const id = Number(req.params.id)
      const job = await database('finance_email_jobs').where('dues_run', id)
        .orderBy('id', 'desc').first('id', 'status', 'test_mode', 'total', 'sent', 'failed', 'error', 'date_created', 'date_updated')
      // A crashed worker can't update its own row; surface a long-idle 'running' job
      // as failed so the UI poller terminates instead of spinning forever.
      if (job && job.status === 'running') {
        const last = job.date_updated || job.date_created
        if (last && Date.now() - new Date(last).getTime() > 15 * 60 * 1000) { job.status = 'failed'; job.error = job.error || 'worker_lost' }
      }
      return res.json({ job: job || null })
    } catch (e) { return err(res, req, 'dues-email-job', e) }
  })

  // ── Per-team finance entries + summary (sponsoring + bills, migration 145) ──
  const TEAM_KINDS = ['sponsoring', 'income', 'expense']

  // GET /finance/team-entries?team=&fiscal_year=
  router.get('/finance/team-entries', async (req, res) => {
    try {
      const mem = await actingMember(req)
      if (!canManageFinance(req, mem)) return res.status(403).json({ error: 'Forbidden' })
      const teamId = Number(req.query.team)
      const fyId = Number(req.query.fiscal_year)
      let q = database('finance_team_entries')
        .orderBy([{ column: 'entry_date', order: 'desc' }, { column: 'id', order: 'desc' }])
        .select('id', 'team', 'fiscal_year', 'kind', 'amount', 'label', 'sponsor', 'entry_date', 'note', 'created_by_name')
      if (Number.isInteger(teamId)) q = q.where('team', teamId)
      if (Number.isInteger(fyId)) q = q.where('fiscal_year', fyId)
      return res.json({ entries: await q.limit(500) })
    } catch (e) { return err(res, req, 'team-entries', e) }
  })

  // POST /finance/team-entries — record a sponsoring/income/expense entry
  router.post('/finance/team-entries', async (req, res) => {
    try {
      const mem = await actingMember(req)
      if (!canManageFinance(req, mem)) return res.status(403).json({ error: 'Forbidden' })
      const b = req.body || {}
      const teamId = Number(b.team)
      const tgt = Number.isInteger(teamId) ? await database('teams').where('id', teamId).first('id') : null
      if (!tgt) return res.status(400).json({ error: 'team not found' })
      const kind = TEAM_KINDS.includes(b.kind) ? b.kind : 'sponsoring'
      const amount = round2(b.amount)
      if (!(amount >= 0)) return res.status(400).json({ error: 'amount must be >= 0' })
      const fyId = Number.isInteger(Number(b.fiscal_year)) ? Number(b.fiscal_year) : await fiscalYearIdForDate(todayISO())
      const entryDate = /^\d{4}-\d{2}-\d{2}$/.test(b.entry_date || '') ? b.entry_date : todayISO()
      const ins = await database('finance_team_entries').insert({
        team: teamId, fiscal_year: fyId, kind, amount,
        label: (b.label || '').toString().trim().slice(0, 255) || null,
        sponsor: (b.sponsor || '').toString().trim().slice(0, 255) || null,
        entry_date: entryDate, note: (b.note || '').toString().trim().slice(0, 255) || null,
        created_by_name: mem?.name || null, created_by_email: mem?.email || null,
      }).returning('id')
      const entryId = ins[0]?.id ?? ins[0]
      await writeUserLog(database, log, { accountability: req.accountability, action: 'create', collection: 'finance_team_entries', recordId: entryId, data: { kind: 'team_entry', team: teamId, entry_kind: kind, amount } })
      return res.json({ id: entryId })
    } catch (e) { return err(res, req, 'team-entry-save', e) }
  })

  // DELETE /finance/team-entries/:id
  router.delete('/finance/team-entries/:id', async (req, res) => {
    try {
      const mem = await actingMember(req)
      if (!canManageFinance(req, mem)) return res.status(403).json({ error: 'Forbidden' })
      const id = Number(req.params.id)
      const removed = await database('finance_team_entries').where('id', id).del()
      await writeUserLog(database, log, { accountability: req.accountability, action: 'delete', collection: 'finance_team_entries', recordId: id, data: { removed } })
      return res.json({ ok: true, removed })
    } catch (e) { return err(res, req, 'team-entry-delete', e) }
  })

  // GET /finance/teams-summary?fiscal_year= — per-team income/expense/net + open bills
  router.get('/finance/teams-summary', async (req, res) => {
    try {
      const mem = await actingMember(req)
      if (!canManageFinance(req, mem)) return res.status(403).json({ error: 'Forbidden' })
      const fyId = Number(req.query.fiscal_year)
      const hasFy = Number.isInteger(fyId)
      const entries = await database('finance_team_entries')
        .modify((qb) => { if (hasFy) qb.where('fiscal_year', fyId) }).select('team', 'kind', 'amount')
      const invs = await database('finance_invoices')
        .where('source', 'native').whereNotNull('team').whereNot('status', 'cancelled')
        .modify((qb) => { if (hasFy) qb.where('fiscal_year', fyId) }).select('team', 'amount', 'open_amount')
      const map = new Map()
      const bump = (tid) => { const k = Number(tid); if (!map.has(k)) map.set(k, { team: k, income: 0, expense: 0, invoice_total: 0, invoice_open: 0 }); return map.get(k) }
      for (const e of entries) { const m = bump(e.team); const a = Number(e.amount) || 0; if (e.kind === 'expense') m.expense += a; else m.income += a }
      for (const i of invs) { const m = bump(i.team); m.invoice_total += Number(i.amount) || 0; m.invoice_open += Number(i.open_amount) || 0 }
      const ids = [...map.keys()]
      const teams = ids.length ? await database('teams').whereIn('id', ids).select('id', 'name') : []
      const nameById = new Map(teams.map((t) => [Number(t.id), t.name]))
      const rows = [...map.values()].map((m) => ({
        team: m.team, team_name: nameById.get(m.team) || `#${m.team}`,
        income: round2(m.income), expense: round2(m.expense), net: round2(m.income - m.expense),
        invoice_total: round2(m.invoice_total), invoice_open: round2(m.invoice_open),
      })).sort((a, b) => a.team_name.localeCompare(b.team_name))
      return res.json({ teams: rows })
    } catch (e) { return err(res, req, 'teams-summary', e) }
  })
}
