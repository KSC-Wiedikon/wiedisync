/**
 * Native double-entry ledger (migration 150) — the WRITE path on the existing
 * finance_transactions table. A journal entry is one balanced source='native' row
 * (debit_account / credit_account / amount_chf; debit=credit by construction).
 *
 * Routes (under /kscw, all canManageFinance-gated, writeUserLog actor capture):
 *   GET    /finance/ledger/accounts            list the Kontenplan (for pickers)
 *   POST   /finance/ledger/accounts            create a native account
 *   PATCH  /finance/ledger/accounts/:id        edit a native account (name/active)
 *   GET    /finance/ledger/entries?fiscal_year= list native journal entries
 *   POST   /finance/ledger/entries             post a journal entry
 *   POST   /finance/ledger/entries/:id/reverse post a reversal (Storno)
 *   DELETE /finance/ledger/entries/:id         delete (open period only — trigger locks closed)
 *   GET    /finance/ledger/trial-balance?fiscal_year=  Saldenbilanz (native)
 *
 * Corrections in a CLOSED year are reversal-only (DB trigger enforces immutability).
 */
import { writeUserLog } from './activity-log.js'

const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'income', 'expense', 'close']
const DIVISIONS = ['club', 'vb', 'bb']

export function registerFinanceLedger(router, { database, logger }) {
  const log = logger.child({ extension: 'kscw-endpoints', module: 'finance-ledger' })
  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100
  const todayISO = () => new Date().toISOString().slice(0, 10)
  function err(res, req, endpoint, e, code = 500) {
    log.error({ msg: `finance-ledger/${endpoint}: ${e.message}`, endpoint: `finance-ledger/${endpoint}`, userId: req.accountability?.user || null, stack: e.stack })
    return res.status(code).json({ error: 'Internal error' })
  }

  async function gate(req) {
    if (req.accountability?.admin) return { ok: true, name: null, email: null }
    const userId = req.accountability?.user
    if (!userId) return { ok: false }
    const m = await database('members').where('user', userId).first('first_name', 'last_name', 'email', 'role')
    if (!m) return { ok: false }
    const roles = Array.isArray(m.role) ? m.role : (m.role ? (() => { try { return JSON.parse(m.role) } catch { return [] } })() : [])
    return {
      ok: ['vorstand', 'admin', 'superuser', 'finance'].some((r) => roles.includes(r)),
      name: [m.first_name, m.last_name].filter(Boolean).join(' ').trim() || null,
      email: m.email || null,
    }
  }

  async function fiscalYearForDate(iso) {
    return database('finance_fiscal_years').where('starts_on', '<=', iso).andWhere('ends_on', '>=', iso).orderBy('id').first('id', 'status')
  }

  // ── Accounts (Kontenplan) ───────────────────────────────────────────────
  router.get('/finance/ledger/accounts', async (req, res) => {
    try {
      const a = await gate(req); if (!a.ok) return res.status(403).json({ error: 'Forbidden' })
      const accounts = await database('finance_accounts')
        .modify((qb) => { if (req.query.active !== 'all') qb.where('active', true) })
        .orderBy('number').select('id', 'number', 'name', 'type', 'division', 'active', 'source')
      return res.json({ accounts })
    } catch (e) { return err(res, req, 'accounts', e) }
  })

  router.post('/finance/ledger/accounts', async (req, res) => {
    try {
      const a = await gate(req); if (!a.ok) return res.status(403).json({ error: 'Forbidden' })
      const b = req.body || {}
      const number = (b.number || '').toString().trim()
      const name = (b.name || '').toString().trim()
      const type = ACCOUNT_TYPES.includes(b.type) ? b.type : null
      const division = DIVISIONS.includes(b.division) ? b.division : null
      if (!number || !name) return res.status(400).json({ error: 'number and name are required' })
      if (!type) return res.status(400).json({ error: 'type must be asset|liability|equity|income|expense|close' })
      const dup = await database('finance_accounts').where('number', number).first('id')
      if (dup) return res.status(409).json({ error: `Account ${number} already exists` })
      const ins = await database('finance_accounts').insert({ number, name, type, division, active: true, source: 'native' }).returning('*')
      const row = ins[0]
      await writeUserLog(database, log, { accountability: req.accountability, action: 'create', collection: 'finance_accounts', recordId: row.id, data: { kind: 'native_account', number, type } })
      return res.json({ account: row })
    } catch (e) { return err(res, req, 'account-create', e) }
  })

  router.patch('/finance/ledger/accounts/:id', async (req, res) => {
    try {
      const a = await gate(req); if (!a.ok) return res.status(403).json({ error: 'Forbidden' })
      const id = Number(req.params.id)
      const acct = await database('finance_accounts').where('id', id).first('id', 'source')
      if (!acct) return res.status(404).json({ error: 'Not found' })
      if (acct.source !== 'native') return res.status(409).json({ error: 'Only native accounts are editable here' })
      const patch = { date_updated: new Date() }
      if (req.body?.name != null) patch.name = String(req.body.name).trim()
      if (req.body?.active != null) patch.active = req.body.active === true
      const upd = await database('finance_accounts').where('id', id).update(patch).returning('*')
      await writeUserLog(database, log, { accountability: req.accountability, action: 'update', collection: 'finance_accounts', recordId: id, data: { kind: 'native_account_edit' } })
      return res.json({ account: upd[0] })
    } catch (e) { return err(res, req, 'account-edit', e) }
  })

  // ── Journal entries ─────────────────────────────────────────────────────
  router.get('/finance/ledger/entries', async (req, res) => {
    try {
      const a = await gate(req); if (!a.ok) return res.status(403).json({ error: 'Forbidden' })
      const fyId = Number(req.query.fiscal_year)
      let q = database('finance_transactions').where('source', 'native')
        .orderBy([{ column: 'booking_date', order: 'desc' }, { column: 'id', order: 'desc' }])
        .select('id', 'beleg', 'booking_date', 'text', 'debit_account', 'debit_account_number', 'debit_account_name',
          'credit_account', 'credit_account_number', 'credit_account_name', 'amount_chf', 'fiscal_year', 'typ', 'reversal_of', 'created_by_name')
      if (Number.isInteger(fyId)) q = q.where('fiscal_year', fyId)
      return res.json({ entries: await q.limit(1000) })
    } catch (e) { return err(res, req, 'entries', e) }
  })

  router.post('/finance/ledger/entries', async (req, res) => {
    try {
      const a = await gate(req); if (!a.ok) return res.status(403).json({ error: 'Forbidden' })
      const b = req.body || {}
      const debitId = Number(b.debit_account), creditId = Number(b.credit_account)
      const amount = round2(b.amount)
      const text = (b.text || '').toString().trim() || null
      if (!Number.isInteger(debitId) || !Number.isInteger(creditId)) return res.status(400).json({ error: 'debit_account and credit_account required' })
      if (debitId === creditId) return res.status(400).json({ error: 'debit and credit account must differ' })
      if (!(amount > 0)) return res.status(400).json({ error: 'amount must be greater than 0' })
      const accts = await database('finance_accounts').whereIn('id', [debitId, creditId]).where('active', true).select('id', 'number', 'name')
      const dr = accts.find((x) => x.id === debitId), cr = accts.find((x) => x.id === creditId)
      if (!dr || !cr) return res.status(400).json({ error: 'debit/credit account not found or inactive' })
      const bookingDate = /^\d{4}-\d{2}-\d{2}$/.test(b.booking_date || '') ? b.booking_date : todayISO()
      const fy = Number.isInteger(Number(b.fiscal_year))
        ? await database('finance_fiscal_years').where('id', Number(b.fiscal_year)).first('id', 'status')
        : await fiscalYearForDate(bookingDate)
      if (!fy) return res.status(400).json({ error: 'no fiscal year for that date' })
      if (fy.status === 'closed') return res.status(409).json({ error: 'fiscal year is closed' })

      const seqRow = await database.raw("SELECT nextval('finance_native_entry_seq')::int AS n")
      const seq = (seqRow.rows ? seqRow.rows[0] : seqRow[0]).n
      const beleg = `J-${bookingDate.slice(0, 4)}-${String(seq).padStart(4, '0')}`
      const ins = await database('finance_transactions').insert({
        source: 'native', typ: 'Standard', beleg, booking_date: bookingDate, text,
        debit_account: debitId, debit_account_number: dr.number, debit_account_name: dr.name,
        credit_account: creditId, credit_account_number: cr.number, credit_account_name: cr.name,
        amount_chf: amount, fiscal_year: fy.id, created_by_name: a.name, created_by_email: a.email,
      }).returning('*')
      const row = ins[0]
      await writeUserLog(database, log, { accountability: req.accountability, action: 'create', collection: 'finance_transactions', recordId: row.id, data: { kind: 'journal_entry', beleg, debit: dr.number, credit: cr.number, amount } })
      return res.json({ entry: row })
    } catch (e) { return err(res, req, 'entry-create', e) }
  })

  router.post('/finance/ledger/entries/:id/reverse', async (req, res) => {
    try {
      const a = await gate(req); if (!a.ok) return res.status(403).json({ error: 'Forbidden' })
      const id = Number(req.params.id)
      const o = await database('finance_transactions').where('id', id).andWhere('source', 'native').first()
      if (!o) return res.status(404).json({ error: 'Not found (native entry expected)' })
      const fy = await database('finance_fiscal_years').where('id', o.fiscal_year).first('status')
      if (fy?.status === 'closed') return res.status(409).json({ error: 'fiscal year is closed — reverse in an open year' })
      const bookingDate = todayISO()
      const seqRow = await database.raw("SELECT nextval('finance_native_entry_seq')::int AS n")
      const seq = (seqRow.rows ? seqRow.rows[0] : seqRow[0]).n
      const beleg = `J-${bookingDate.slice(0, 4)}-${String(seq).padStart(4, '0')}`
      // Reversal swaps debit ⇄ credit, same amount.
      const ins = await database('finance_transactions').insert({
        source: 'native', typ: 'Storno', beleg, booking_date: bookingDate, text: `Storno: ${o.text || o.beleg || ''}`.slice(0, 250),
        debit_account: o.credit_account, debit_account_number: o.credit_account_number, debit_account_name: o.credit_account_name,
        credit_account: o.debit_account, credit_account_number: o.debit_account_number, credit_account_name: o.debit_account_name,
        amount_chf: o.amount_chf, fiscal_year: o.fiscal_year, reversal_of: o.id, created_by_name: a.name, created_by_email: a.email,
      }).returning('*')
      const row = ins[0]
      await writeUserLog(database, log, { accountability: req.accountability, action: 'create', collection: 'finance_transactions', recordId: row.id, data: { kind: 'journal_reversal', reversal_of: o.id, beleg } })
      return res.json({ entry: row })
    } catch (e) { return err(res, req, 'entry-reverse', e) }
  })

  router.delete('/finance/ledger/entries/:id', async (req, res) => {
    try {
      const a = await gate(req); if (!a.ok) return res.status(403).json({ error: 'Forbidden' })
      const id = Number(req.params.id)
      const o = await database('finance_transactions').where('id', id).andWhere('source', 'native').first('id')
      if (!o) return res.status(404).json({ error: 'Not found' })
      try {
        await database('finance_transactions').where('id', id).del() // trigger blocks closed-year native rows
      } catch (e) {
        if (/closed fiscal year/i.test(e.message)) return res.status(409).json({ error: 'Entry is in a closed fiscal year — post a reversal instead' })
        throw e
      }
      await writeUserLog(database, log, { accountability: req.accountability, action: 'delete', collection: 'finance_transactions', recordId: id, data: { kind: 'journal_delete' } })
      return res.json({ ok: true })
    } catch (e) { return err(res, req, 'entry-delete', e) }
  })

  // ── Trial balance (Saldenbilanz) — native postings for a fiscal year ─────
  router.get('/finance/ledger/trial-balance', async (req, res) => {
    try {
      const a = await gate(req); if (!a.ok) return res.status(403).json({ error: 'Forbidden' })
      const fyId = Number(req.query.fiscal_year)
      const txs = await database('finance_transactions').where('source', 'native')
        .modify((qb) => { if (Number.isInteger(fyId)) qb.where('fiscal_year', fyId) })
        .select('debit_account', 'credit_account', 'amount_chf')
      const sums = new Map() // acctId → { debit, credit }
      const bump = (id, key, amt) => { if (id == null) return; const k = Number(id); const e = sums.get(k) || { debit: 0, credit: 0 }; e[key] += amt; sums.set(k, e) }
      for (const t of txs) { const amt = Number(t.amount_chf) || 0; bump(t.debit_account, 'debit', amt); bump(t.credit_account, 'credit', amt) }
      const ids = [...sums.keys()]
      const accts = ids.length ? await database('finance_accounts').whereIn('id', ids).select('id', 'number', 'name', 'type', 'division') : []
      const byId = new Map(accts.map((x) => [Number(x.id), x]))
      let totalDebit = 0, totalCredit = 0
      const rows = ids.map((id) => {
        const s = sums.get(id), acc = byId.get(id) || {}
        const debit = round2(s.debit), credit = round2(s.credit)
        totalDebit = round2(totalDebit + debit); totalCredit = round2(totalCredit + credit)
        const nominal = acc.type === 'income' || acc.type === 'expense'
        const balance = (acc.type === 'asset' || acc.type === 'expense') ? round2(debit - credit) : round2(credit - debit)
        return { account: id, number: acc.number || '?', name: acc.name || '', type: acc.type || null, division: acc.division || null, nominal, debit, credit, balance }
      }).sort((x, y) => String(x.number).localeCompare(String(y.number)))
      return res.json({ rows, totals: { debit: totalDebit, credit: totalCredit, balanced: Math.abs(totalDebit - totalCredit) < 0.005 } })
    } catch (e) { return err(res, req, 'trial-balance', e) }
  })
}
