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
import { planYearEndClose } from './finance-close.js'
import { loadLedgerSettings, reconcileAllLedger } from './finance-autopost.js'

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
      // Show the native book AND the imported ClubDesk journal (read-only history).
      let q = database('finance_transactions').whereIn('source', ['native', 'clubdesk'])
        .orderBy([{ column: 'booking_date', order: 'desc' }, { column: 'id', order: 'desc' }])
        .select('id', 'beleg', 'booking_date', 'text', 'debit_account', 'debit_account_number', 'debit_account_name',
          'credit_account', 'credit_account_number', 'credit_account_name', 'amount_chf', 'fiscal_year', 'typ', 'reversal_of', 'created_by_name', 'source')
      if (Number.isInteger(fyId)) q = q.where('fiscal_year', fyId)
      return res.json({ entries: await q.limit(2000) })
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
      // Native book + imported ClubDesk journal, so the trial balance shows the real books.
      const txs = await database('finance_transactions').whereIn('source', ['native', 'clubdesk'])
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

  // ── Fiscal years + year-end close (Jahresabschluss) ─────────────────────
  router.get('/finance/ledger/fiscal-years', async (req, res) => {
    try {
      const a = await gate(req); if (!a.ok) return res.status(403).json({ error: 'Forbidden' })
      const years = await database('finance_fiscal_years').orderBy('starts_on', 'desc')
        .select('id', 'label', 'starts_on', 'ends_on', 'status', 'closed_on', 'closed_by_name')
      return res.json({ fiscal_years: years })
    } catch (e) { return err(res, req, 'fiscal-years', e) }
  })

  // Close = post Abschluss (nominal → equity) + Eröffnung (real balances → next year
  // via an opening clearing), then lock the year. dry_run returns the plan only.
  router.post('/finance/ledger/fiscal-years/:id/close', async (req, res) => {
    try {
      const a = await gate(req); if (!a.ok) return res.status(403).json({ error: 'Forbidden' })
      const id = Number(req.params.id)
      const b = req.body || {}
      const equityId = Number(b.equity_account), openingId = Number(b.opening_account)
      const dryRun = b.dry_run === true
      if (!Number.isInteger(equityId) || !Number.isInteger(openingId) || equityId === openingId)
        return res.status(400).json({ error: 'equity_account and opening_account are required and must differ' })
      const accts = await database('finance_accounts').select('id', 'number', 'name', 'type', 'active')
      const acctById = new Map(accts.map((x) => [Number(x.id), x]))
      const eq = acctById.get(equityId), op = acctById.get(openingId)
      if (!eq || eq.type !== 'equity' || !eq.active) return res.status(400).json({ error: 'equity_account must be an active equity account' })
      if (!op || op.type !== 'equity' || !op.active) return res.status(400).json({ error: 'opening_account (Eröffnungsbilanz) must be an active equity account' })

      const isoDate = (d) => { if (!d) return null; if (typeof d === 'string') return d.slice(0, 10); const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` }

      // Whole close in one transaction with a row lock on the year, so a double-submit
      // / concurrent close can't post two Abschluss+Eröffnung sets. dry_run rolls back.
      const out = await database.transaction(async (trx) => {
        const fy = await trx('finance_fiscal_years').where('id', id).forUpdate().first()
        if (!fy) return { code: 404, msg: 'Fiscal year not found' }
        if (fy.status === 'closed') return { code: 409, msg: 'Fiscal year is already closed' }
        const nextFy = await trx('finance_fiscal_years').where('starts_on', '>', fy.ends_on).orderBy('starts_on').first('id', 'label', 'starts_on', 'status')
        if (!nextFy) return { code: 400, msg: 'Create the next fiscal year before closing this one' }
        if (nextFy.status === 'closed') return { code: 409, msg: 'The next fiscal year is already closed — cannot carry opening balances into it' }
        const existingOpen = await trx('finance_transactions').where({ source: 'native', fiscal_year: nextFy.id, typ: 'Eroeffnung' }).first('id')
        if (existingOpen) return { code: 409, msg: 'The next fiscal year already has opening (Eröffnung) entries' }

        const txns = await trx('finance_transactions').where('source', 'native').andWhere('fiscal_year', id).select('debit_account', 'credit_account', 'amount_chf')
        const plan = planYearEndClose(txns, accts, { equityId, openingId })
        const summary = { fiscal_year: id, next_fiscal_year: nextFy.id, income: plan.income, expense: plan.expense, net: plan.net, closing_entries: plan.closing.length, opening_entries: plan.opening.length, balanced: plan.balanced }
        if (!plan.balanced) {
          const residue = Math.abs(plan.clearingResidue) >= 0.005 ? ` (the Eröffnungsbilanz account ${op.number} carries a non-zero balance of ${plan.clearingResidue} — reconcile it first)` : ''
          return { code: 409, msg: `Books do not balance — opening clearing nets to ${plan.clearingNet}${residue}.`, body: { ...summary, clearing_net: plan.clearingNet } }
        }
        if (dryRun) return { dryRun: true, summary }

        const mkBeleg = async (prefix, dateISO) => {
          const r = await trx.raw("SELECT nextval('finance_native_entry_seq')::int AS n")
          const n = (r.rows ? r.rows[0] : r[0]).n
          return `${prefix}-${dateISO.slice(0, 4)}-${String(n).padStart(4, '0')}`
        }
        const insLegs = async (legs, fyId, typ, dateISO, prefix, text) => {
          for (const l of legs) {
            const dr = acctById.get(Number(l.debit)), cr = acctById.get(Number(l.credit))
            await trx('finance_transactions').insert({
              source: 'native', typ, booking_date: dateISO, fiscal_year: fyId, beleg: await mkBeleg(prefix, dateISO), text,
              debit_account: Number(l.debit), debit_account_number: dr?.number || null, debit_account_name: dr?.name || null,
              credit_account: Number(l.credit), credit_account_number: cr?.number || null, credit_account_name: cr?.name || null,
              amount_chf: round2(l.amount), created_by_name: a.name, created_by_email: a.email,
            })
          }
        }
        // Abschluss legs go into the year being closed WHILE it's still open (the INSERT
        // trigger only blocks once status flips), then the status flip locks them.
        await insLegs(plan.closing, id, 'Abschluss', isoDate(fy.ends_on), 'A', `Abschluss ${fy.label || id}`)
        await insLegs(plan.opening, nextFy.id, 'Eroeffnung', isoDate(nextFy.starts_on), 'E', `Eröffnung ${nextFy.label || nextFy.id}`)
        await trx('finance_fiscal_years').where('id', id).update({ status: 'closed', closed_on: todayISO(), closed_by_name: a.name, closed_by_email: a.email })
        return { summary }
      })

      if (out.code) return res.status(out.code).json({ error: out.msg, ...(out.body || {}) })
      if (out.dryRun) return res.json({ dry_run: true, ...out.summary })
      await writeUserLog(database, log, { accountability: req.accountability, action: 'update', collection: 'finance_fiscal_years', recordId: id, data: { kind: 'year_end_close', ...out.summary } })
      return res.json(out.summary)
    } catch (e) { return err(res, req, 'close-year', e) }
  })

  // ── Auto-posting: settings, chart mirror, reconcile ─────────────────────
  const SETTINGS_ACCT_FIELDS = ['debitoren_account', 'bank_account', 'income_account', 'sponsoring_account', 'bad_debt_account', 'expense_account', 'prepayment_account']
  // Infer an account type from the Swiss Verein chart number range when ClubDesk left it null.
  // 28xx + 29xx → equity, matching import-clubdesk-finance.mjs accountType() so the
  // seed-chart fallback and the importer can't disagree (e.g. close picker eligibility).
  const inferType = (num) => { const n = String(num || ''); if (n.startsWith('28') || n.startsWith('29')) return 'equity'; const c = n[0]; return ({ 1: 'asset', 2: 'liability', 3: 'income', 4: 'expense', 5: 'expense', 6: 'expense', 7: 'expense', 8: 'expense', 9: 'close' })[c] || null }

  router.get('/finance/ledger/settings', async (req, res) => {
    try {
      const a = await gate(req); if (!a.ok) return res.status(403).json({ error: 'Forbidden' })
      const settings = await loadLedgerSettings(database)
      return res.json({ settings })
    } catch (e) { return err(res, req, 'settings', e) }
  })

  router.patch('/finance/ledger/settings', async (req, res) => {
    try {
      const a = await gate(req); if (!a.ok) return res.status(403).json({ error: 'Forbidden' })
      const b = req.body || {}
      const patch = { date_updated: new Date(), updated_by_name: a.name }
      patch.autopost_enabled = b.autopost_enabled === true
      // Validate every supplied account id exists; allow null to unset.
      const ids = SETTINGS_ACCT_FIELDS.map((f) => b[f]).filter((v) => v != null).map(Number)
      const known = ids.length ? new Set((await database('finance_accounts').whereIn('id', ids).select('id')).map((x) => Number(x.id))) : new Set()
      for (const f of SETTINGS_ACCT_FIELDS) {
        if (b[f] == null) { patch[f] = null; continue }
        if (!known.has(Number(b[f]))) return res.status(400).json({ error: `${f}: account not found` })
        patch[f] = Number(b[f])
      }
      if (patch.autopost_enabled && (!patch.debitoren_account || !patch.bank_account || !patch.income_account))
        return res.status(400).json({ error: 'Debitoren, Bank and Income accounts must be set before enabling auto-posting' })
      await database('finance_ledger_settings').where('id', 1).update(patch)
      await writeUserLog(database, log, { accountability: req.accountability, action: 'update', collection: 'finance_ledger_settings', recordId: 1, data: { kind: 'ledger_settings', autopost_enabled: patch.autopost_enabled } })
      return res.json({ settings: await loadLedgerSettings(database) })
    } catch (e) { return err(res, req, 'settings-save', e) }
  })

  // Mirror the ClubDesk chart into the native Kontenplan (copies accounts whose
  // number isn't already a native account). Lets the native book start from the
  // existing chart instead of blank.
  router.post('/finance/ledger/seed-chart', async (req, res) => {
    try {
      const a = await gate(req); if (!a.ok) return res.status(403).json({ error: 'Forbidden' })
      // The ledger shares the existing chart of accounts (account numbers are globally
      // unique). The ClubDesk-imported accounts ARE the chart — the journal posts to them
      // directly. So we only add NATIVE accounts for numbers that don't exist at all
      // (genuinely new), never a duplicate. Type inferred from the Swiss number range.
      const existingNums = new Set((await database('finance_accounts').select('number')).map((x) => x.number))
      const cd = await database('finance_accounts').where('source', 'clubdesk').select('number', 'name', 'type', 'division')
      const toAdd = []
      const seen = new Set()
      for (const c of cd) {
        if (!c.number || existingNums.has(c.number) || seen.has(c.number)) continue
        seen.add(c.number)
        toAdd.push({ number: c.number, name: c.name, type: c.type || inferType(c.number), division: c.division || null, active: true, source: 'native' })
      }
      if (toAdd.length) await database('finance_accounts').insert(toAdd)
      await writeUserLog(database, log, { accountability: req.accountability, action: 'create', collection: 'finance_accounts', recordId: 0, data: { kind: 'seed_chart_from_clubdesk', added: toAdd.length } })
      return res.json({ added: toAdd.length, available: existingNums.size })
    } catch (e) { return err(res, req, 'seed-chart', e) }
  })

  // Backfill/reconcile the whole native book from current A/R (idempotent).
  router.post('/finance/ledger/reconcile', async (req, res) => {
    try {
      const a = await gate(req); if (!a.ok) return res.status(403).json({ error: 'Forbidden' })
      const settings = await loadLedgerSettings(database)
      if (!settings.debitoren_account || !settings.bank_account || !settings.income_account)
        return res.status(400).json({ error: 'Map the Debitoren, Bank and Income accounts in settings first' })
      const fiscalYear = Number(req.body?.fiscal_year) || null
      const summary = await reconcileAllLedger(database, settings, { fiscalYear })
      await writeUserLog(database, log, { accountability: req.accountability, action: 'create', collection: 'finance_transactions', recordId: 0, data: { kind: 'ledger_reconcile', ...summary } })
      return res.json(summary)
    } catch (e) { return err(res, req, 'reconcile', e) }
  })

  // ── Per-category dues income mapping (migration 154) ────────────────────
  router.get('/finance/ledger/income-map', async (req, res) => {
    try {
      const a = await gate(req); if (!a.ok) return res.status(403).json({ error: 'Forbidden' })
      const map = await database('finance_income_account_map').select('fee_category', 'account')
      const fromMembers = await database('members').whereNotNull('beitragskategorie').distinct('beitragskategorie').pluck('beitragskategorie')
      const fromInvoices = await database('finance_invoices').where('source', 'native').whereNotNull('fee_category').distinct('fee_category').pluck('fee_category')
      const categories = [...new Set([...fromMembers, ...fromInvoices, ...map.map((m) => m.fee_category)])].filter(Boolean).sort()
      return res.json({ categories, map })
    } catch (e) { return err(res, req, 'income-map', e) }
  })

  router.patch('/finance/ledger/income-map', async (req, res) => {
    try {
      const a = await gate(req); if (!a.ok) return res.status(403).json({ error: 'Forbidden' })
      const entries = Array.isArray(req.body?.entries) ? req.body.entries : []
      const acctIds = entries.map((e) => e.account).filter((v) => v != null).map(Number)
      const known = acctIds.length ? new Set((await database('finance_accounts').whereIn('id', acctIds).select('id')).map((x) => Number(x.id))) : new Set()
      for (const e of entries) {
        const cat = (e.fee_category || '').toString().trim()
        if (!cat) continue
        if (e.account == null) { await database('finance_income_account_map').where('fee_category', cat).del(); continue }
        if (!known.has(Number(e.account))) return res.status(400).json({ error: `account not found for category "${cat}"` })
        await database('finance_income_account_map')
          .insert({ fee_category: cat, account: Number(e.account), updated_by_name: a.name, date_updated: new Date() })
          .onConflict('fee_category').merge(['account', 'updated_by_name', 'date_updated'])
      }
      await writeUserLog(database, log, { accountability: req.accountability, action: 'update', collection: 'finance_income_account_map', recordId: 0, data: { kind: 'income_map', count: entries.length } })
      return res.json({ map: await database('finance_income_account_map').select('fee_category', 'account') })
    } catch (e) { return err(res, req, 'income-map-save', e) }
  })

  // Auto-fill unmapped categories → income account by name match (Passiv→Passivmitglieder,
  // VB→Aktivmitglieder VB, BB→Aktivmitglieder BB). Never overwrites a manual mapping.
  router.post('/finance/ledger/income-map/auto', async (req, res) => {
    try {
      const a = await gate(req); if (!a.ok) return res.status(403).json({ error: 'Forbidden' })
      const income = await database('finance_accounts').where('type', 'income').andWhere('active', true).select('id', 'number', 'name')
      const fromMembers = await database('members').whereNotNull('beitragskategorie').distinct('beitragskategorie').pluck('beitragskategorie')
      const fromInvoices = await database('finance_invoices').where('source', 'native').whereNotNull('fee_category').distinct('fee_category').pluck('fee_category')
      const categories = [...new Set([...fromMembers, ...fromInvoices])].filter(Boolean)
      const existing = new Set((await database('finance_income_account_map').whereNotNull('account').pluck('fee_category')))
      const nameHas = (acc, ...kw) => kw.every((k) => acc.name.toLowerCase().includes(k))
      const match = (cat) => {
        const c = cat.toLowerCase()
        if (c.includes('passiv')) return income.find((x) => nameHas(x, 'passiv'))
        const sport = /(^|\W)bb(\W|$)|basketball/.test(c) ? 'bb' : (/(^|\W)vb(\W|$)|volleyball/.test(c) ? 'vb' : null)
        if (sport) return income.find((x) => nameHas(x, 'aktivmitglieder', sport)) || income.find((x) => x.name.toLowerCase().includes(sport))
        return null
      }
      const applied = []
      for (const cat of categories) {
        if (existing.has(cat)) continue
        const acc = match(cat)
        if (!acc) continue
        await database('finance_income_account_map')
          .insert({ fee_category: cat, account: acc.id, updated_by_name: `${a.name || ''} (auto)`.trim(), date_updated: new Date() })
          .onConflict('fee_category').merge(['account', 'updated_by_name', 'date_updated'])
        applied.push({ fee_category: cat, account: acc.id, account_label: `${acc.number} ${acc.name}` })
      }
      await writeUserLog(database, log, { accountability: req.accountability, action: 'update', collection: 'finance_income_account_map', recordId: 0, data: { kind: 'income_map_auto', matched: applied.length, total: categories.length } })
      return res.json({ matched: applied.length, total: categories.length, applied })
    } catch (e) { return err(res, req, 'income-map-auto', e) }
  })

  // ── On-demand ClubDesk finance sync ─────────────────────────────────────
  // POST sets a request flag; a host dispatcher cron runs the scrape+import and
  // writes back sync_state. GET is polled by the button.
  router.get('/finance/ledger/clubdesk-sync', async (req, res) => {
    try {
      const a = await gate(req); if (!a.ok) return res.status(403).json({ error: 'Forbidden' })
      const s = await database('finance_ledger_settings').where('id', 1).first('sync_state', 'sync_message', 'sync_requested_at', 'sync_finished_at')
      const li = await database('finance_imports').max('date_created as t').first()
      return res.json({ state: s?.sync_state || 'idle', message: s?.sync_message || null, requested_at: s?.sync_requested_at || null, finished_at: s?.sync_finished_at || null, last_import: li?.t || null })
    } catch (e) { return err(res, req, 'sync-status', e) }
  })
  router.post('/finance/ledger/clubdesk-sync', async (req, res) => {
    try {
      const a = await gate(req); if (!a.ok) return res.status(403).json({ error: 'Forbidden' })
      const s = await database('finance_ledger_settings').where('id', 1).first('sync_state')
      if (['queued', 'running'].includes(s?.sync_state)) return res.status(409).json({ error: 'A sync is already in progress', state: s.sync_state })
      await database('finance_ledger_settings').where('id', 1).update({ sync_requested_at: new Date(), sync_state: 'queued', sync_message: null, sync_finished_at: null })
      await writeUserLog(database, log, { accountability: req.accountability, action: 'update', collection: 'finance_ledger_settings', recordId: 1, data: { kind: 'clubdesk_sync_request' } })
      return res.json({ state: 'queued' })
    } catch (e) { return err(res, req, 'sync-trigger', e) }
  })
}
