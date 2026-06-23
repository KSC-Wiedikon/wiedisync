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

const PAY_METHODS = ['twint', 'bank', 'cash', 'other']

export function registerFinance(router, { database, logger }) {
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
  const isVorstand = (req, mem) =>
    !!req.accountability?.admin || (!!mem && ['vorstand', 'admin', 'superuser'].some((r) => mem.roles.includes(r)))

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
      if (!isVorstand(req, mem)) return res.status(403).json({ error: 'Forbidden' })

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

      await writeUserLog(database, log, { accountability: req.accountability, action: 'create', collection: 'finance_invoices', recordId: row.id, data: { kind: 'native_invoice', recipient_type: recipientType, member: memberId, team: teamId, amount, number } })
      return res.json({ invoice: row })
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
          'fi.overpaid_amount', 'fi.written_off_amount', 'fi.payment_method', 'fi.reference',
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
      if (!isVorstand(req, mem)) return res.status(403).json({ error: 'Forbidden' })
      const id = Number(req.params.id)
      const inv = await database('finance_invoices').where('id', id).andWhere('source', 'native').first()
      if (!inv) return res.status(404).json({ error: 'Not found' })
      if (!['open', 'pending_confirmation'].includes(inv.status)) return res.status(409).json({ error: `Invoice is ${inv.status}` })
      const [row] = await database('finance_invoices').where('id', id).update({
        status: 'paid',
        amount_paid: inv.amount,
        open_amount: 0,
        closed_on: todayISO(),
        confirmed_at: new Date(),
        confirmed_by_name: mem?.name || null,
        confirmed_by_email: mem?.email || null,
        confirmed_via: 'manual',
        date_updated: new Date(),
      }).returning('*')
      await writeUserLog(database, log, { accountability: req.accountability, action: 'update', collection: 'finance_invoices', recordId: id, data: { kind: 'confirm_payment', via: 'manual' } })
      return res.json({ invoice: row })
    } catch (e) { return err(res, req, 'confirm', e) }
  })

  // ── POST /finance/invoices/:id/cancel — void a native invoice ───────────
  router.post('/finance/invoices/:id/cancel', async (req, res) => {
    try {
      const mem = await actingMember(req)
      if (!isVorstand(req, mem)) return res.status(403).json({ error: 'Forbidden' })
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
      if (!isVorstand(req, mem)) return res.status(403).json({ error: 'Forbidden' })
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
      if (!isVorstand(req, mem)) return res.status(403).json({ error: 'Forbidden' })
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
}
