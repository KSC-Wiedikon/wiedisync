/**
 * The parallel books — bank statements, receipts, opening balance, the monthly
 * ClubDesk comparison, the yearly archive and the switch checklist
 * (accounting.wiedisync.kscw.ch; plan: .planning/bookkeeping-plan.md, migration 411).
 *
 * Every route checks finance-access.js: GET = read (board, finance, revisor),
 * everything else = write (board, finance). Writes are actor-logged (writeUserLog).
 * Pure logic lives in finance-books-core.js; the ledger write path itself
 * (finance_transactions, source='native') is shared with finance-ledger.js.
 *
 *   POST   /finance/bank/import                   upload a camt.053 statement (JSON { xml, filename })
 *   GET    /finance/bank/lines                     statement lines (?status=open|posted|ignored|all&fiscal_year=)
 *   POST   /finance/bank/lines/:id/post            book a line ({ account?, text? } — defaults to the proposal)
 *   POST   /finance/bank/post-proposed             book every open line that has a proposal ({ ids? })
 *   POST   /finance/bank/lines/:id/ignore          leave a line out of the books ({ note })
 *   POST   /finance/bank/lines/:id/reopen          undo post / ignore (open year only)
 *   GET|POST /finance/bank/rules, PATCH|DELETE /finance/bank/rules/:id, POST /finance/bank/reapply
 *   GET    /finance/ledger/entries/:id/documents   receipts of a native entry
 *   POST   /finance/ledger/entries/:id/documents   attach a receipt (raw body, ?filename=&kind=&note=)
 *   GET    /finance/documents/:id/file             stream a receipt
 *   DELETE /finance/documents/:id                  remove a receipt (open year only)
 *   GET    /finance/ledger/receipts                receipt coverage of a year (?fiscal_year=)
 *   GET|POST /finance/opening                      opening balance from ClubDesk's own Eröffnung
 *   GET    /finance/parallel                       ClubDesk vs native, per month and per account
 *   POST   /finance/parallel/signoff               sign a month off ({ fiscal_year, month, note })
 *   GET    /finance/annual-accounts.pdf            Jahresrechnung (?fiscal_year=&book=native|clubdesk)
 *   POST   /finance/archive                        build the yearly archive ({ fiscal_year })
 *   GET    /finance/archives, GET /finance/archives/:id/file
 *   GET    /finance/switch/readiness               the switch criteria
 */
import { createHash, randomUUID } from 'node:crypto'
import { Readable, Transform } from 'node:stream'
import { writeUserLog } from './activity-log.js'
import { financeActor, parseRoles } from './finance-access.js'
import { parseStatement, invoiceIdFromScor, invoiceNumbersFromMessage } from './camt.js'
import { loadLedgerSettings, FISCAL_YEAR_LOCK_NS } from './finance-autopost.js'
import {
  round2, bankLineText, bankPostingLegs, proposeForLine, statementBalanceCheck,
  compareBooks, monthlyComparison, monthsOfYear, monthEnd, openingLegsFromClubdesk, openingEntries,
  needsReceipt, RECEIPT_EXEMPT_TYPES, evaluateReadiness,
} from './finance-books-core.js'
import { renderAnnualAccountsPdf } from './finance-annual-pdf.js'
import { buildZip } from './zip-store.js'
import { readManagedFile, streamManagedFile } from './storage-read.js'
import { sniffUpload, safeFilename } from './public-upload.js'

/** Private folder for statements, receipts and archives (migration 411). */
export const FINANCE_BOOKS_FOLDER = 'f1a0d0c5-0000-4000-8000-000000000002'
const RECEIPT_MAX_BYTES = 15 * 1024 * 1024
const RECEIPT_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
const DOC_KINDS = ['receipt', 'invoice', 'statement', 'contract', 'other']
const STATEMENT_MAX_CHARS = 8 * 1024 * 1024
const ARCHIVE_MAX_BYTES = 400 * 1024 * 1024

const iso = (d) => (d ? (typeof d === 'string' ? d.slice(0, 10) : new Date(d).toISOString().slice(0, 10)) : null)
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const normRef = (s) => (s ? String(s).replace(/\s+/g, '').toUpperCase() : null)

/** CSV with ';' and a UTF-8 BOM — opens cleanly in Swiss Excel. */
function csv(header, rows) {
  const cell = (v) => {
    if (v == null) return ''
    const s = String(v)
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return '﻿' + [header, ...rows].map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n'
}
const asciiName = (s) => String(s || '').normalize('NFKD').replace(/[^\w.\-]+/g, '_').replace(/_+/g, '_').slice(0, 80)

export function registerFinanceBooks(router, { database, logger, services, getSchema }) {
  const log = logger.child({ extension: 'kscw-endpoints', module: 'finance-books' })
  const gate = (req) => financeActor(database, req)
  function fail(res, req, endpoint, e) {
    if (e?.status && e.status < 500) return res.status(e.status).json({ error: e.message })
    log.error({ msg: `finance-books/${endpoint}: ${e.message}`, endpoint: `finance-books/${endpoint}`, userId: req.accountability?.user || null, stack: e.stack })
    return res.status(500).json({ error: 'Internal error' })
  }
  const forbidden = (res) => res.status(403).json({ error: 'Forbidden' })
  const storage = () => (process.env.STORAGE_LOCATIONS || 'local').split(',')[0].trim()

  async function storeBuffer(buf, { filename, type }) {
    const { FilesService } = services
    const files = new FilesService({ schema: await getSchema(), knex: database })
    // One chunk — Readable.from(<Buffer>) would emit it byte by byte.
    return files.uploadOne(Readable.from([buf]), { storage: storage(), filename_download: filename, type, folder: FINANCE_BOOKS_FOLDER })
  }

  async function fiscalYearFor(trx, dateISO) {
    return trx('finance_fiscal_years').where('starts_on', '<=', dateISO).andWhere('ends_on', '>=', dateISO).orderBy('id').first('id', 'status', 'label')
  }
  async function nextBeleg(trx, prefix, dateISO) {
    const r = await trx.raw("SELECT nextval('finance_native_entry_seq')::int AS n")
    const n = (r.rows ? r.rows[0] : r[0]).n
    return `${prefix}-${dateISO.slice(0, 4)}-${String(n).padStart(4, '0')}`
  }

  // ════════════════════════════════════════════════════════════════════════
  // Bank statements (camt.053) → proposals → native postings
  // ════════════════════════════════════════════════════════════════════════

  /** The invoice an incoming line pays, if any: structured reference first, then an
   *  invoice number in the message with a matching amount. */
  async function findInvoice(line) {
    const sel = ['id', 'number', 'subject', 'recipient_name', 'fee_category', 'source', 'amount', 'open_amount', 'reference', 'status']
    const ref = normRef(line.reference)
    if (ref) {
      const scorId = invoiceIdFromScor(ref)
      if (scorId) {
        const inv = await database('finance_invoices').where({ id: scorId, source: 'native' }).first(sel)
        if (inv) return inv
      }
      const byRef = await database('finance_invoices').whereRaw("upper(replace(coalesce(reference, ''), ' ', '')) = ?", [ref]).orderBy('id', 'desc').first(sel)
      if (byRef) return byRef
    }
    const nums = invoiceNumbersFromMessage(line.remittance).slice(0, 12)
    if (nums.length) {
      const cands = await database('finance_invoices').whereIn('number', nums)
        .whereNotIn('status', ['Storniert', 'cancelled']).select(sel)
      const amt = Number(line.amount)
      return cands.find((c) => Math.abs(Number(c.amount) - amt) < 0.005)
        || cands.find((c) => Math.abs(Number(c.open_amount) - amt) < 0.005)
        || null
    }
    return null
  }

  async function refreshProposals(ids = null) {
    const settings = await loadLedgerSettings(database)
    const rules = await database('finance_bank_rules').where('active', true).select('*')
    const map = new Map((await database('finance_income_account_map').whereNotNull('account').select('fee_category', 'account'))
      .map((m) => [m.fee_category, Number(m.account)]))
    const incomeAccountFor = (inv) => map.get(inv.fee_category) ?? (settings.income_account ? Number(settings.income_account) : null)
    let q = database('finance_bank_lines').where('status', 'open')
    if (ids) q = q.whereIn('id', ids)
    const lines = await q.select('*')
    let proposed = 0
    for (const line of lines) {
      const invoice = Number(line.amount) > 0 ? await findInvoice(line) : null
      const p = proposeForLine(line, {
        invoice, rules, incomeAccountFor,
        arAccountId: settings.debitoren_account ? Number(settings.debitoren_account) : null,
        autopost: !!settings.autopost_enabled,
      })
      await database('finance_bank_lines').where({ id: line.id, status: 'open' }).update({
        proposed_account: p?.account ?? null,
        proposed_text: p?.text ?? null,
        proposed_by: p?.by ?? null,
        matched_invoice_number: p?.invoiceNumber ?? null,
      })
      if (p) proposed++
    }
    return { lines: lines.length, proposed }
  }

  router.post('/finance/bank/import', async (req, res) => {
    try {
      const a = await gate(req); if (!a.write) return forbidden(res)
      const xml = typeof req.body?.xml === 'string' ? req.body.xml : ''
      if (!xml.trim()) return res.status(400).json({ error: 'Statement file (camt.053 XML) is required' })
      if (xml.length > STATEMENT_MAX_CHARS) return res.status(413).json({ error: 'Statement file too large' })
      let parsed
      try { parsed = parseStatement(xml) } catch (e) { return res.status(400).json({ error: e.message }) }
      const allLines = parsed.statements.flatMap((s) => s.lines)
      if (!allLines.length) return res.status(400).json({ error: 'The statement holds no booked entries' })

      const already = new Set(await database('finance_bank_lines').whereIn('bank_ref', allLines.map((l) => l.bankRef)).pluck('bank_ref'))
      const fresh = allLines.filter((l) => !already.has(l.bankRef))
      const buf = Buffer.from(xml, 'utf8')
      const fileSha = sha256(buf)
      let fileId = null
      if (fresh.length) {
        const first = parsed.statements[0]
        const dates = allLines.map((l) => l.bookingDate).filter(Boolean).sort()
        const name = `camt053_${asciiName(first.iban || 'account')}_${dates[0] || 'x'}_${dates[dates.length - 1] || 'x'}.xml`
        fileId = await storeBuffer(buf, { filename: name, type: 'application/xml' })
      }
      const years = await database('finance_fiscal_years').select('id', 'starts_on', 'ends_on')
      const fyFor = (d) => years.find((y) => iso(y.starts_on) <= d && iso(y.ends_on) >= d)?.id ?? null
      const batch = randomUUID()
      const rows = []
      for (const st of parsed.statements) {
        for (const l of st.lines) {
          if (already.has(l.bankRef)) continue
          const date = l.bookingDate || l.valueDate
          if (!date) continue
          rows.push({
            bank_ref: l.bankRef.slice(0, 160), statement_id: st.id ? String(st.id).slice(0, 140) : null,
            account_iban: st.iban, booking_date: date, value_date: l.valueDate, amount: l.amount,
            currency: (l.currency || 'CHF').slice(0, 3), counterparty_name: l.counterpartyName ? l.counterpartyName.slice(0, 255) : null,
            counterparty_iban: l.counterpartyIban ? l.counterpartyIban.slice(0, 34) : null,
            reference: l.reference ? l.reference.slice(0, 64) : null, remittance: l.remittance,
            fiscal_year: fyFor(date), import_batch: batch, imported_by_name: a.name,
            statement_file: fileId, statement_sha256: fileId ? fileSha : null,
          })
        }
      }
      const inserted = rows.length
        ? (await database('finance_bank_lines').insert(rows).onConflict('bank_ref').ignore().returning('id')).map((r) => r.id ?? r)
        : []
      const proposals = inserted.length ? await refreshProposals(inserted) : { lines: 0, proposed: 0 }
      const statements = parsed.statements.map((s) => {
        const dates = s.lines.map((l) => l.bookingDate).filter(Boolean).sort()
        return { id: s.id, iban: s.iban, from: dates[0] || null, to: dates[dates.length - 1] || null, lines: s.lines.length, opening: s.opening, closing: s.closing, balance: statementBalanceCheck(s) }
      })
      await writeUserLog(database, log, { accountability: req.accountability, action: 'create', collection: 'finance_bank_lines', recordId: 0, data: { kind: 'bank_statement_import', inserted: inserted.length, skipped: allLines.length - inserted.length, file: fileId } })
      return res.json({ statements, inserted: inserted.length, skipped: allLines.length - inserted.length, proposed: proposals.proposed })
    } catch (e) { return fail(res, req, 'bank-import', e) }
  })

  router.get('/finance/bank/lines', async (req, res) => {
    try {
      const a = await gate(req); if (!a.read) return forbidden(res)
      const status = ['open', 'posted', 'ignored'].includes(req.query.status) ? req.query.status : null
      const fyId = Number(req.query.fiscal_year)
      const q = database('finance_bank_lines as l')
        .leftJoin('finance_accounts as pa', 'pa.id', 'l.proposed_account')
        .leftJoin('finance_transactions as t', 't.id', 'l.entry')
        .select('l.id', 'l.booking_date', 'l.value_date', 'l.amount', 'l.currency', 'l.counterparty_name', 'l.counterparty_iban',
          'l.reference', 'l.remittance', 'l.status', 'l.proposed_account', 'l.proposed_text', 'l.proposed_by', 'l.matched_invoice_number',
          'l.entry', 'l.note', 'l.posted_by_name', 'l.posted_at', 'l.fiscal_year', 'l.account_iban', 'l.statement_id',
          'pa.number as proposed_account_number', 'pa.name as proposed_account_name',
          't.beleg as entry_beleg', 't.debit_account_number as entry_debit', 't.credit_account_number as entry_credit')
        .orderBy([{ column: 'l.booking_date', order: 'desc' }, { column: 'l.id', order: 'desc' }])
        .limit(3000)
      if (status) q.where('l.status', status)
      if (Number.isInteger(fyId)) q.where('l.fiscal_year', fyId)
      const counts = await database('finance_bank_lines').modify((qb) => { if (Number.isInteger(fyId)) qb.where('fiscal_year', fyId) })
        .groupBy('status').select('status').count('* as n')
      const summary = Object.fromEntries(counts.map((c) => [c.status, Number(c.n)]))
      return res.json({ lines: await q, summary })
    } catch (e) { return fail(res, req, 'bank-lines', e) }
  })

  async function postBankLine(lineId, { account, text }, actor) {
    return database.transaction(async (trx) => {
      const line = await trx('finance_bank_lines').where('id', lineId).forUpdate().first()
      if (!line) return { code: 404, error: 'Not found' }
      if (line.status !== 'open') return { code: 409, error: `This line is already ${line.status}` }
      const settings = await trx('finance_ledger_settings').where('id', 1).first('bank_account')
      const bankId = Number(settings?.bank_account)
      if (!Number.isInteger(bankId)) return { code: 400, error: 'Choose the bank account in the ledger settings first' }
      const acctId = Number(account ?? line.proposed_account)
      if (!Number.isInteger(acctId)) return { code: 400, error: 'Choose the account to book this line to' }
      if (acctId === bankId) return { code: 400, error: 'Choose the counter-account, not the bank account itself' }
      const accts = await trx('finance_accounts').whereIn('id', [acctId, bankId]).where('active', true).select('id', 'number', 'name')
      const byId = new Map(accts.map((x) => [Number(x.id), x]))
      if (!byId.get(acctId) || !byId.get(bankId)) return { code: 400, error: 'Account not found or inactive' }
      const date = iso(line.booking_date)
      const fy = await fiscalYearFor(trx, date)
      if (!fy) return { code: 400, error: 'No fiscal year covers this date' }
      if (fy.status === 'closed') return { code: 409, error: 'The fiscal year is closed' }
      await trx.raw('SELECT pg_advisory_xact_lock(?::int, ?::int)', [FISCAL_YEAR_LOCK_NS, fy.id])
      const legs = bankPostingLegs(line, bankId, acctId)
      if (!(legs.amount > 0)) return { code: 400, error: 'A zero line cannot be booked — ignore it instead' }
      const dr = byId.get(legs.debit), cr = byId.get(legs.credit)
      const body = String(text ?? line.proposed_text ?? bankLineText(line)).trim().slice(0, 250) || bankLineText(line)
      const [entry] = await trx('finance_transactions').insert({
        source: 'native', typ: 'Standard', beleg: await nextBeleg(trx, 'J', date), booking_date: date, text: body,
        debit_account: dr.id, debit_account_number: dr.number, debit_account_name: dr.name,
        credit_account: cr.id, credit_account_number: cr.number, credit_account_name: cr.name,
        amount_chf: legs.amount, fiscal_year: fy.id, created_by_name: actor.name, created_by_email: actor.email,
        ref_kind: 'bank_line', ref_id: line.id, auto: false,
      }).returning('*')
      await trx('finance_bank_lines').where('id', line.id).update({
        status: 'posted', entry: entry.id, fiscal_year: fy.id,
        posted_by_name: actor.name, posted_by_email: actor.email, posted_at: new Date(),
      })
      // The statement is the Beleg of a bank posting.
      if (line.statement_file && line.statement_sha256) {
        await trx('finance_transaction_documents').insert({
          entry: entry.id, file: line.statement_file, sha256: line.statement_sha256, kind: 'statement',
          note: 'Bank statement (camt.053)', uploaded_by_name: actor.name, uploaded_by_email: actor.email,
        }).onConflict(['entry', 'file']).ignore()
      }
      return { entry }
    })
  }

  router.post('/finance/bank/lines/:id/post', async (req, res) => {
    try {
      const a = await gate(req); if (!a.write) return forbidden(res)
      const out = await postBankLine(Number(req.params.id), { account: req.body?.account, text: req.body?.text }, a)
      if (out.code) return res.status(out.code).json({ error: out.error })
      await writeUserLog(database, log, { accountability: req.accountability, action: 'create', collection: 'finance_transactions', recordId: out.entry.id, data: { kind: 'bank_line_post', line: Number(req.params.id), beleg: out.entry.beleg, amount: out.entry.amount_chf } })
      return res.json({ entry: out.entry })
    } catch (e) { return fail(res, req, 'bank-post', e) }
  })

  router.post('/finance/bank/post-proposed', async (req, res) => {
    try {
      const a = await gate(req); if (!a.write) return forbidden(res)
      const only = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : null
      const q = database('finance_bank_lines').where('status', 'open').whereNotNull('proposed_account').orderBy('booking_date').orderBy('id')
      if (only) q.whereIn('id', only)
      const ids = await q.pluck('id')
      let posted = 0
      const failed = []
      for (const id of ids) {
        const out = await postBankLine(id, {}, a)
        if (out.code) failed.push({ id, error: out.error }); else posted++
      }
      await writeUserLog(database, log, { accountability: req.accountability, action: 'create', collection: 'finance_transactions', recordId: 0, data: { kind: 'bank_post_proposed', posted, failed: failed.length } })
      return res.json({ posted, failed })
    } catch (e) { return fail(res, req, 'bank-post-proposed', e) }
  })

  router.post('/finance/bank/lines/:id/ignore', async (req, res) => {
    try {
      const a = await gate(req); if (!a.write) return forbidden(res)
      const id = Number(req.params.id)
      const note = String(req.body?.note || '').trim().slice(0, 500) || null
      const n = await database('finance_bank_lines').where({ id, status: 'open' }).update({ status: 'ignored', note, posted_by_name: a.name, posted_by_email: a.email, posted_at: new Date() })
      if (!n) return res.status(409).json({ error: 'Only an open line can be ignored' })
      await writeUserLog(database, log, { accountability: req.accountability, action: 'update', collection: 'finance_bank_lines', recordId: id, data: { kind: 'bank_line_ignore', note } })
      return res.json({ ok: true })
    } catch (e) { return fail(res, req, 'bank-ignore', e) }
  })

  router.post('/finance/bank/lines/:id/reopen', async (req, res) => {
    try {
      const a = await gate(req); if (!a.write) return forbidden(res)
      const id = Number(req.params.id)
      const out = await database.transaction(async (trx) => {
        const line = await trx('finance_bank_lines').where('id', id).forUpdate().first()
        if (!line) return { code: 404, error: 'Not found' }
        if (line.status === 'open') return { code: 409, error: 'The line is already open' }
        const reset = { status: 'open', entry: null, posted_by_name: null, posted_by_email: null, posted_at: null }
        if (line.status === 'ignored') { await trx('finance_bank_lines').where('id', id).update({ ...reset, note: null }); return {} }
        const entry = await trx('finance_transactions').where({ id: line.entry, source: 'native' }).first('id', 'fiscal_year')
        const fy = entry ? await trx('finance_fiscal_years').where('id', entry.fiscal_year).first('status') : null
        if (fy?.status === 'closed') return { code: 409, error: 'The entry is in a closed fiscal year — post a reversal in an open year instead' }
        await trx('finance_bank_lines').where('id', id).update(reset)
        if (entry) await trx('finance_transactions').where('id', entry.id).del()
        return { deletedEntry: entry?.id ?? null }
      })
      if (out.code) return res.status(out.code).json({ error: out.error })
      await writeUserLog(database, log, { accountability: req.accountability, action: 'update', collection: 'finance_bank_lines', recordId: id, data: { kind: 'bank_line_reopen', deleted_entry: out.deletedEntry ?? null } })
      await refreshProposals([id])
      return res.json({ ok: true })
    } catch (e) { return fail(res, req, 'bank-reopen', e) }
  })

  // ── Rules ───────────────────────────────────────────────────────────────
  const RULE_FIELDS = ['name', 'priority', 'direction', 'match_iban', 'match_name', 'match_text', 'account', 'text_template', 'active']
  function cleanRule(b) {
    const r = {}
    for (const f of RULE_FIELDS) if (b[f] !== undefined) r[f] = b[f]
    if (r.name != null) r.name = String(r.name).trim().slice(0, 120)
    if (r.priority != null) r.priority = Number.isInteger(Number(r.priority)) ? Number(r.priority) : 100
    if (r.direction != null && !['in', 'out', 'any'].includes(r.direction)) r.direction = 'any'
    for (const f of ['match_iban', 'match_name', 'match_text', 'text_template']) {
      if (r[f] != null) r[f] = String(r[f]).trim().slice(0, f === 'text_template' ? 255 : 120) || null
    }
    if (r.match_iban) r.match_iban = r.match_iban.replace(/\s+/g, '').toUpperCase().slice(0, 34)
    if (r.account != null) r.account = Number(r.account)
    if (r.active != null) r.active = r.active === true
    return r
  }
  router.get('/finance/bank/rules', async (req, res) => {
    try {
      const a = await gate(req); if (!a.read) return forbidden(res)
      const rules = await database('finance_bank_rules as r').leftJoin('finance_accounts as acc', 'acc.id', 'r.account')
        .select('r.*', 'acc.number as account_number', 'acc.name as account_name').orderBy([{ column: 'r.priority' }, { column: 'r.id' }])
      return res.json({ rules })
    } catch (e) { return fail(res, req, 'rules', e) }
  })
  router.post('/finance/bank/rules', async (req, res) => {
    try {
      const a = await gate(req); if (!a.write) return forbidden(res)
      const r = cleanRule(req.body || {})
      if (!r.name || !Number.isInteger(r.account)) return res.status(400).json({ error: 'Name and account are required' })
      if (!r.match_iban && !r.match_name && !r.match_text) return res.status(400).json({ error: 'Set at least one condition (IBAN, name or text)' })
      const acct = await database('finance_accounts').where({ id: r.account, active: true }).first('id')
      if (!acct) return res.status(400).json({ error: 'Account not found or inactive' })
      const [row] = await database('finance_bank_rules').insert({ ...r, created_by_name: a.name }).returning('*')
      await writeUserLog(database, log, { accountability: req.accountability, action: 'create', collection: 'finance_bank_rules', recordId: row.id, data: { kind: 'bank_rule', name: row.name } })
      const refreshed = await refreshProposals()
      return res.json({ rule: row, refreshed })
    } catch (e) { return fail(res, req, 'rule-create', e) }
  })
  router.patch('/finance/bank/rules/:id', async (req, res) => {
    try {
      const a = await gate(req); if (!a.write) return forbidden(res)
      const id = Number(req.params.id)
      const r = cleanRule(req.body || {})
      if (r.account != null) {
        const acct = await database('finance_accounts').where({ id: r.account, active: true }).first('id')
        if (!acct) return res.status(400).json({ error: 'Account not found or inactive' })
      }
      let row
      try {
        [row] = await database('finance_bank_rules').where('id', id).update({ ...r, date_updated: new Date() }).returning('*')
      } catch (e) {
        if (/has_condition/.test(e.message)) return res.status(400).json({ error: 'Set at least one condition (IBAN, name or text)' })
        throw e
      }
      if (!row) return res.status(404).json({ error: 'Not found' })
      await writeUserLog(database, log, { accountability: req.accountability, action: 'update', collection: 'finance_bank_rules', recordId: id, data: { kind: 'bank_rule' } })
      const refreshed = await refreshProposals()
      return res.json({ rule: row, refreshed })
    } catch (e) { return fail(res, req, 'rule-edit', e) }
  })
  router.delete('/finance/bank/rules/:id', async (req, res) => {
    try {
      const a = await gate(req); if (!a.write) return forbidden(res)
      const id = Number(req.params.id)
      const n = await database('finance_bank_rules').where('id', id).del()
      if (!n) return res.status(404).json({ error: 'Not found' })
      await writeUserLog(database, log, { accountability: req.accountability, action: 'delete', collection: 'finance_bank_rules', recordId: id, data: { kind: 'bank_rule' } })
      const refreshed = await refreshProposals()
      return res.json({ ok: true, refreshed })
    } catch (e) { return fail(res, req, 'rule-delete', e) }
  })
  router.post('/finance/bank/reapply', async (req, res) => {
    try {
      const a = await gate(req); if (!a.write) return forbidden(res)
      return res.json(await refreshProposals())
    } catch (e) { return fail(res, req, 'reapply', e) }
  })

  // ════════════════════════════════════════════════════════════════════════
  // Receipts (Belege) on native journal entries
  // ════════════════════════════════════════════════════════════════════════

  router.get('/finance/ledger/entries/:id/documents', async (req, res) => {
    try {
      const a = await gate(req); if (!a.read) return forbidden(res)
      const docs = await database('finance_transaction_documents as d').join('directus_files as f', 'f.id', 'd.file')
        .where('d.entry', Number(req.params.id))
        .select('d.id', 'd.kind', 'd.note', 'd.sha256', 'd.uploaded_by_name', 'd.date_created', 'f.filename_download as filename', 'f.type', 'f.filesize')
        .orderBy('d.id')
      return res.json({ documents: docs })
    } catch (e) { return fail(res, req, 'documents', e) }
  })

  router.post('/finance/ledger/entries/:id/documents', async (req, res) => {
    try {
      const a = await gate(req); if (!a.write) return forbidden(res)
      const entryId = Number(req.params.id)
      const entry = await database('finance_transactions').where({ id: entryId, source: 'native' }).first('id', 'beleg')
      if (!entry) return res.status(404).json({ error: 'Native journal entry not found' })
      if (Number(req.headers['content-length'] || 0) > RECEIPT_MAX_BYTES) return res.status(413).json({ error: 'File too large (max 15 MB).' })
      const kind = DOC_KINDS.includes(req.query.kind) ? req.query.kind : 'receipt'
      const note = String(req.query.note || '').trim().slice(0, 255) || null

      // Same streaming discipline as /registration/upload: every await BEFORE the
      // pipe, the counter INSIDE the pipeline, an error listener at creation.
      const { FilesService } = services
      const files = new FilesService({ schema: await getSchema(), knex: database })
      const hash = createHash('sha256')
      let bytes = 0
      let head = Buffer.alloc(0)
      let sniffed = null
      const capped = new Transform({
        transform(chunk, _enc, cb) {
          bytes += chunk.length
          if (bytes > RECEIPT_MAX_BYTES) return cb(Object.assign(new Error('File too large (max 15 MB).'), { status: 413 }))
          hash.update(chunk)
          if (head.length < 1024) head = Buffer.concat([head, chunk]).subarray(0, 1024)
          cb(null, chunk)
        },
        flush(cb) {
          sniffed = sniffUpload(head)
          if (!sniffed || !RECEIPT_TYPES.has(sniffed)) return cb(Object.assign(new Error('Only PDF, JPEG, PNG or WebP files'), { status: 415 }))
          cb()
        },
      })
      let streamError = null
      capped.on('error', (err) => { streamError = err })
      req.on('error', (err) => capped.destroy(err))
      req.pipe(capped)
      let fileId
      try {
        fileId = await files.uploadOne(capped, {
          storage: storage(), filename_download: safeFilename(req.query.filename, null, 'beleg'),
          type: 'application/octet-stream', folder: FINANCE_BOOKS_FOLDER,
        })
      } catch (err) { throw streamError || err }
      if (streamError) {
        try { await files.deleteOne(fileId) } catch { /* best effort */ }
        throw streamError
      }
      if (!bytes) {
        try { await files.deleteOne(fileId) } catch { /* best effort */ }
        return res.status(400).json({ error: 'Empty file' })
      }
      await database('directus_files').where('id', fileId).update({ type: sniffed, filename_download: safeFilename(req.query.filename, sniffed, 'beleg') })
      const [doc] = await database('finance_transaction_documents').insert({
        entry: entryId, file: fileId, sha256: hash.digest('hex'), kind, note, uploaded_by_name: a.name, uploaded_by_email: a.email,
      }).returning('*')
      await writeUserLog(database, log, { accountability: req.accountability, action: 'create', collection: 'finance_transaction_documents', recordId: doc.id, data: { kind: 'receipt', entry: entryId, beleg: entry.beleg, bytes } })
      return res.json({ document: doc })
    } catch (e) { return fail(res, req, 'document-upload', e) }
  })

  router.get('/finance/documents/:id/file', async (req, res) => {
    try {
      const a = await gate(req); if (!a.read) return forbidden(res)
      const doc = await database('finance_transaction_documents as d').join('directus_files as f', 'f.id', 'd.file')
        .where('d.id', Number(req.params.id)).first('d.file', 'f.filename_download', 'f.type')
      if (!doc) return res.status(404).json({ error: 'Not found' })
      await streamManagedFile(doc.file, { services, getSchema, database }, res, { filename: doc.filename_download, type: doc.type })
    } catch (e) { return fail(res, req, 'document-file', e) }
  })

  router.delete('/finance/documents/:id', async (req, res) => {
    try {
      const a = await gate(req); if (!a.write) return forbidden(res)
      const id = Number(req.params.id)
      const doc = await database('finance_transaction_documents as d').join('finance_transactions as t', 't.id', 'd.entry')
        .leftJoin('finance_fiscal_years as fy', 'fy.id', 't.fiscal_year')
        .where('d.id', id).first('d.id', 'd.file', 'd.kind', 'd.entry', 'fy.status')
      if (!doc) return res.status(404).json({ error: 'Not found' })
      if (doc.status === 'closed') return res.status(409).json({ error: 'Receipts of a closed fiscal year are kept' })
      await database('finance_transaction_documents').where('id', id).del()
      // A statement file backs many entries and its bank lines — never delete it here.
      const stillUsed = await database('finance_transaction_documents').where('file', doc.file).first('id')
        || await database('finance_bank_lines').where('statement_file', doc.file).first('id')
      if (!stillUsed) {
        try { await new services.FilesService({ schema: await getSchema(), knex: database }).deleteOne(doc.file) } catch (e) { log.warn({ msg: `receipt file delete: ${e.message}` }) }
      }
      await writeUserLog(database, log, { accountability: req.accountability, action: 'delete', collection: 'finance_transaction_documents', recordId: id, data: { kind: 'receipt', entry: doc.entry } })
      return res.json({ ok: true })
    } catch (e) { return fail(res, req, 'document-delete', e) }
  })

  router.get('/finance/ledger/receipts', async (req, res) => {
    try {
      const a = await gate(req); if (!a.read) return forbidden(res)
      const fyId = Number(req.query.fiscal_year)
      if (!Number.isInteger(fyId)) return res.status(400).json({ error: 'fiscal_year required' })
      const entries = await database('finance_transactions').where({ source: 'native', fiscal_year: fyId }).select('id', 'typ')
      const counts = new Map((await database('finance_transaction_documents as d').join('finance_transactions as t', 't.id', 'd.entry')
        .where({ 't.source': 'native', 't.fiscal_year': fyId }).groupBy('d.entry').select('d.entry').count('* as n'))
        .map((r) => [Number(r.entry), Number(r.n)]))
      const needing = entries.filter(needsReceipt)
      const missing = needing.filter((e) => !counts.get(Number(e.id)))
      return res.json({
        entries: entries.length, needing: needing.length, withReceipt: needing.length - missing.length,
        missing: missing.length, missingIds: missing.slice(0, 500).map((e) => e.id),
        counts: Object.fromEntries(counts), exemptTypes: RECEIPT_EXEMPT_TYPES,
      })
    } catch (e) { return fail(res, req, 'receipts', e) }
  })

  // ════════════════════════════════════════════════════════════════════════
  // Opening balance — from ClubDesk's own Eröffnung bookings
  // ════════════════════════════════════════════════════════════════════════

  async function openingFacts(fyId) {
    const fy = await database('finance_fiscal_years').where('id', fyId).first('id', 'label', 'starts_on', 'ends_on', 'status')
    if (!fy) return null
    const rows = await database('finance_transactions').where({ source: 'clubdesk', fiscal_year: fyId })
      .whereRaw("typ ILIKE 'Er_ffnung'").select('debit_account', 'credit_account', 'amount_chf')
    const plan = openingLegsFromClubdesk(rows)
    const ids = plan.legs.map((l) => l.account)
    const accts = ids.length ? await database('finance_accounts').whereIn('id', ids).select('id', 'number', 'name', 'type') : []
    const byId = new Map(accts.map((x) => [Number(x.id), x]))
    const native = await database('finance_transactions').where({ source: 'native', fiscal_year: fyId, typ: 'Eroeffnung' }).count('* as n').first()
    return { fy, plan: { ...plan, legs: plan.legs.map((l) => ({ ...l, number: byId.get(l.account)?.number, name: byId.get(l.account)?.name })) }, nativeOpenings: Number(native?.n || 0) }
  }

  router.get('/finance/opening', async (req, res) => {
    try {
      const a = await gate(req); if (!a.read) return forbidden(res)
      const f = await openingFacts(Number(req.query.fiscal_year))
      if (!f) return res.status(404).json({ error: 'Fiscal year not found' })
      const settings = await loadLedgerSettings(database)
      const clearing = await database('finance_accounts').where('active', true).whereIn('type', ['equity', 'close'])
        .select('id', 'number', 'name', 'type').orderBy('number')
      return res.json({ fiscal_year: f.fy, proposal: f.plan, native_posted: f.nativeOpenings > 0, opening_account: settings.opening_account ?? null, parallel_start_fy: settings.parallel_start_fy ?? null, clearing_candidates: clearing })
    } catch (e) { return fail(res, req, 'opening', e) }
  })

  router.post('/finance/opening', async (req, res) => {
    try {
      const a = await gate(req); if (!a.write) return forbidden(res)
      const fyId = Number(req.body?.fiscal_year)
      const clearingId = Number(req.body?.opening_account)
      const clearing = await database('finance_accounts').where({ id: clearingId, active: true }).whereIn('type', ['equity', 'close']).first('id', 'number', 'name')
      if (!clearing) return res.status(400).json({ error: 'Choose the opening-balance account (Eröffnungsbilanz, an equity or closing account)' })
      const out = await database.transaction(async (trx) => {
        await trx.raw('SELECT pg_advisory_xact_lock(?::int, ?::int)', [FISCAL_YEAR_LOCK_NS, fyId])
        const f = await openingFacts(fyId)
        if (!f) return { code: 404, error: 'Fiscal year not found' }
        if (f.fy.status === 'closed') return { code: 409, error: 'The fiscal year is closed' }
        if (f.nativeOpenings > 0) return { code: 409, error: 'This year already has native opening entries' }
        if (!f.plan.legs.length) return { code: 409, error: 'ClubDesk has no opening (Eröffnung) bookings for this year yet' }
        if (!f.plan.balanced) return { code: 409, error: `ClubDesk's opening does not balance (debit ${f.plan.debit}, credit ${f.plan.credit})` }
        if (f.plan.legs.some((l) => l.account === clearingId)) return { code: 400, error: 'The opening-balance account already carries an opening balance — choose a separate clearing account' }
        const entries = openingEntries(f.plan.legs, clearingId)
        const accts = await trx('finance_accounts').whereIn('id', [...new Set(entries.flatMap((e) => [e.debit, e.credit]))]).select('id', 'number', 'name')
        const byId = new Map(accts.map((x) => [Number(x.id), x]))
        const date = iso(f.fy.starts_on)
        for (const e of entries) {
          const dr = byId.get(Number(e.debit)), cr = byId.get(Number(e.credit))
          await trx('finance_transactions').insert({
            source: 'native', typ: 'Eroeffnung', beleg: await nextBeleg(trx, 'E', date), booking_date: date,
            text: `Eröffnung ${f.fy.label} (aus ClubDesk)`, fiscal_year: fyId,
            debit_account: dr.id, debit_account_number: dr.number, debit_account_name: dr.name,
            credit_account: cr.id, credit_account_number: cr.number, credit_account_name: cr.name,
            amount_chf: round2(e.amount), created_by_name: a.name, created_by_email: a.email,
          })
        }
        const s = await trx('finance_ledger_settings').where('id', 1).first('parallel_start_fy')
        await trx('finance_ledger_settings').where('id', 1).update({ opening_account: clearingId, ...(s?.parallel_start_fy ? {} : { parallel_start_fy: fyId }), date_updated: new Date(), updated_by_name: a.name })
        return { posted: entries.length, total: f.plan.debit }
      })
      if (out.code) return res.status(out.code).json({ error: out.error })
      await writeUserLog(database, log, { accountability: req.accountability, action: 'create', collection: 'finance_transactions', recordId: 0, data: { kind: 'opening_balance', fiscal_year: fyId, ...out } })
      return res.json(out)
    } catch (e) { return fail(res, req, 'opening-post', e) }
  })

  // ════════════════════════════════════════════════════════════════════════
  // Parallel run — ClubDesk mirror vs native book
  // ════════════════════════════════════════════════════════════════════════

  async function booksOf(fyId) {
    const cols = ['debit_account', 'credit_account', 'amount_chf', 'booking_date']
    const [clubdesk, native, accounts, settings] = await Promise.all([
      database('finance_transactions').where({ source: 'clubdesk', fiscal_year: fyId }).select(cols),
      database('finance_transactions').where({ source: 'native', fiscal_year: fyId }).select(cols),
      database('finance_accounts').select('id', 'number', 'name', 'type'),
      loadLedgerSettings(database),
    ])
    const ignore = settings.opening_account ? [Number(settings.opening_account)] : []
    return { clubdesk, native, accounts, ignore }
  }

  router.get('/finance/parallel', async (req, res) => {
    try {
      const a = await gate(req); if (!a.read) return forbidden(res)
      const fyId = Number(req.query.fiscal_year)
      const fy = await database('finance_fiscal_years').where('id', fyId).first('id', 'label', 'starts_on', 'ends_on', 'status')
      if (!fy) return res.status(404).json({ error: 'Fiscal year not found' })
      const books = await booksOf(fyId)
      const today = new Date().toISOString().slice(0, 10)
      const months = monthlyComparison({ ...books, startsOn: iso(fy.starts_on), endsOn: iso(fy.ends_on), untilISO: today })
      const signoffs = await database('finance_parallel_signoffs').where('fiscal_year', fyId)
        .select('id', 'month', 'difference_total', 'accounts_different', 'note', 'signed_by_name', 'signed_at')
      const byMonth = new Map(signoffs.map((s) => [iso(s.month).slice(0, 7), s]))
      const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : (months[months.length - 1]?.month ?? null)
      const detail = month ? compareBooks({ ...books, throughISO: monthEnd(`${month}-01`) }) : null
      return res.json({
        fiscal_year: fy,
        months: months.map((m) => ({ ...m, signoff: byMonth.get(m.month) ?? null })),
        month, detail,
        counts: { clubdesk: books.clubdesk.length, native: books.native.length },
      })
    } catch (e) { return fail(res, req, 'parallel', e) }
  })

  router.post('/finance/parallel/signoff', async (req, res) => {
    try {
      const a = await gate(req); if (!a.write) return forbidden(res)
      const fyId = Number(req.body?.fiscal_year)
      const month = String(req.body?.month || '')
      const note = String(req.body?.note || '').trim().slice(0, 2000) || null
      if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'month must be YYYY-MM' })
      const fy = await database('finance_fiscal_years').where('id', fyId).first('id', 'starts_on', 'ends_on')
      if (!fy) return res.status(404).json({ error: 'Fiscal year not found' })
      const through = monthEnd(`${month}-01`)
      if (`${month}-01` < iso(fy.starts_on) || `${month}-01` > iso(fy.ends_on)) return res.status(400).json({ error: 'That month is not in this fiscal year' })
      if (through >= new Date().toISOString().slice(0, 10)) return res.status(400).json({ error: 'A month can be signed off once it is over' })
      const books = await booksOf(fyId)
      const c = compareBooks({ ...books, throughISO: through })
      if (c.accountsDifferent > 0 && !note) return res.status(400).json({ error: 'The books differ — explain the differences in a note to sign off' })
      let row
      try {
        [row] = await database('finance_parallel_signoffs').insert({
          fiscal_year: fyId, month: `${month}-01`, difference_total: c.differenceTotal, accounts_compared: c.accountsCompared,
          accounts_different: c.accountsDifferent, snapshot: JSON.stringify(c.rows), note,
          signed_by_name: a.name, signed_by_email: a.email,
        }).returning('*')
      } catch (e) {
        if (e.code === '23505') return res.status(409).json({ error: 'This month is already signed off' })
        throw e
      }
      await writeUserLog(database, log, { accountability: req.accountability, action: 'create', collection: 'finance_parallel_signoffs', recordId: row.id, data: { kind: 'parallel_signoff', month, difference_total: c.differenceTotal } })
      return res.json({ signoff: row })
    } catch (e) { return fail(res, req, 'signoff', e) }
  })

  // ════════════════════════════════════════════════════════════════════════
  // Annual accounts + yearly archive
  // ════════════════════════════════════════════════════════════════════════

  async function trialBalance(fyId, book) {
    const rows = await database('finance_transactions').where({ source: book, fiscal_year: fyId }).select('debit_account', 'credit_account', 'amount_chf', 'typ')
    const accts = await database('finance_accounts').select('id', 'number', 'name', 'type')
    const byId = new Map(accts.map((x) => [Number(x.id), x]))
    const sums = new Map()
    const bump = (id, k, amt, pl) => {
      if (id == null) return
      const e = sums.get(Number(id)) || { debit: 0, credit: 0, plDebit: 0, plCredit: 0 }
      e[k] += amt
      if (pl) e[k === 'debit' ? 'plDebit' : 'plCredit'] += amt
      sums.set(Number(id), e)
    }
    for (const r of rows) {
      const amt = Number(r.amount_chf) || 0
      // The income statement leaves out the year-end close, or a closed year reads 0.
      const pl = r.typ !== 'Abschluss' && r.typ !== 'Eroeffnung' && !/^Er.ffnung$/.test(r.typ || '')
      bump(r.debit_account, 'debit', amt, pl)
      bump(r.credit_account, 'credit', amt, pl)
    }
    return [...sums.entries()].map(([id, s]) => {
      const acc = byId.get(id) || {}
      const nominal = acc.type === 'income' || acc.type === 'expense'
      const d = nominal ? s.plDebit : s.debit, c = nominal ? s.plCredit : s.credit
      const balance = round2(acc.type === 'asset' || acc.type === 'expense' ? d - c : c - d)
      return { account: id, number: acc.number || '?', name: acc.name || '', type: acc.type || null, debit: round2(s.debit), credit: round2(s.credit), balance }
    }).sort((x, y) => String(x.number).localeCompare(String(y.number)))
  }

  router.get('/finance/annual-accounts.pdf', async (req, res) => {
    try {
      const a = await gate(req); if (!a.read) return forbidden(res)
      const fyId = Number(req.query.fiscal_year)
      const book = req.query.book === 'clubdesk' ? 'clubdesk' : 'native'
      const fy = await database('finance_fiscal_years').where('id', fyId).first('id', 'label', 'starts_on', 'ends_on')
      if (!fy) return res.status(404).json({ error: 'Fiscal year not found' })
      const pdf = await renderAnnualAccountsPdf({
        fyLabel: fy.label, startsOn: iso(fy.starts_on), endsOn: iso(fy.ends_on),
        book: book === 'native' ? 'Wiedisync' : 'ClubDesk (Spiegel)', rows: await trialBalance(fyId, book),
      })
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Disposition', `inline; filename="jahresrechnung_${asciiName(fy.label)}_${book}.pdf"`)
      return res.end(pdf)
    } catch (e) { return fail(res, req, 'annual-pdf', e) }
  })

  router.post('/finance/archive', async (req, res) => {
    try {
      const a = await gate(req); if (!a.write) return forbidden(res)
      const fyId = Number(req.body?.fiscal_year)
      const fy = await database('finance_fiscal_years').where('id', fyId).first('id', 'label', 'starts_on', 'ends_on', 'status')
      if (!fy) return res.status(404).json({ error: 'Fiscal year not found' })
      const label = asciiName(fy.label)
      const files = []
      const contents = {}
      const journalCols = ['beleg', 'booking_date', 'typ', 'text', 'debit_account_number', 'debit_account_name', 'credit_account_number', 'credit_account_name', 'amount_chf', 'created_by_name']
      const accounts = await database('finance_accounts').orderBy('number').select('number', 'name', 'type', 'division', 'active', 'source')
      files.push({ name: 'konten.csv', data: csv(['Nummer', 'Name', 'Typ', 'Bereich', 'Aktiv', 'Quelle'], accounts.map((x) => [x.number, x.name, x.type, x.division, x.active ? 'ja' : 'nein', x.source])) })
      for (const book of ['native', 'clubdesk']) {
        const rows = await database('finance_transactions').where({ source: book, fiscal_year: fyId })
          .orderBy([{ column: 'booking_date' }, { column: 'id' }]).select(['id', ...journalCols])
        contents[book] = rows.length
        if (!rows.length) continue
        files.push({ name: `${book}/journal.csv`, data: csv(['ID', 'Beleg', 'Datum', 'Typ', 'Text', 'Soll', 'Soll Name', 'Haben', 'Haben Name', 'Betrag CHF', 'Erfasst von'], rows.map((r) => [r.id, r.beleg, iso(r.booking_date), r.typ, r.text, r.debit_account_number, r.debit_account_name, r.credit_account_number, r.credit_account_name, r.amount_chf, r.created_by_name])) })
        const tb = await trialBalance(fyId, book)
        files.push({ name: `${book}/kontensalden.csv`, data: csv(['Konto', 'Name', 'Typ', 'Soll', 'Haben', 'Saldo'], tb.map((r) => [r.number, r.name, r.type, r.debit, r.credit, r.balance])) })
        files.push({ name: `${book}/jahresrechnung.pdf`, data: await renderAnnualAccountsPdf({ fyLabel: fy.label, startsOn: iso(fy.starts_on), endsOn: iso(fy.ends_on), book: book === 'native' ? 'Wiedisync' : 'ClubDesk (Spiegel)', rows: tb }) })
      }
      const lines = await database('finance_bank_lines as l').leftJoin('finance_transactions as t', 't.id', 'l.entry').where('l.fiscal_year', fyId)
        .orderBy([{ column: 'l.booking_date' }, { column: 'l.id' }])
        .select('l.booking_date', 'l.amount', 'l.counterparty_name', 'l.counterparty_iban', 'l.reference', 'l.remittance', 'l.status', 't.beleg', 'l.note', 'l.statement_file', 'l.statement_sha256')
      contents.bank_lines = lines.length
      if (lines.length) files.push({ name: 'bank/bankbewegungen.csv', data: csv(['Datum', 'Betrag CHF', 'Gegenpartei', 'IBAN', 'Referenz', 'Mitteilung', 'Status', 'Beleg', 'Notiz'], lines.map((l) => [iso(l.booking_date), l.amount, l.counterparty_name, l.counterparty_iban, l.reference, l.remittance, l.status, l.beleg, l.note])) })
      const signoffs = await database('finance_parallel_signoffs').where('fiscal_year', fyId).orderBy('month').select('month', 'difference_total', 'accounts_compared', 'accounts_different', 'note', 'signed_by_name', 'signed_at', 'snapshot')
      contents.signoffs = signoffs.length
      if (signoffs.length) files.push({ name: 'parallel/monatsabschluesse.json', data: JSON.stringify(signoffs, null, 2) })

      // Receipts of the year's native entries + every statement file, each once.
      const docs = await database('finance_transaction_documents as d').join('finance_transactions as t', 't.id', 'd.entry')
        .join('directus_files as f', 'f.id', 'd.file').where({ 't.fiscal_year': fyId, 't.source': 'native' })
        .select('d.id', 'd.file', 'd.kind', 'd.sha256', 't.beleg', 'f.filename_download')
      const stmtFiles = [...new Set(lines.map((l) => l.statement_file).filter(Boolean))]
      const wanted = new Map()
      for (const d of docs) {
        if (wanted.has(d.file)) continue
        const dir = d.kind === 'statement' ? 'bank/auszuege' : 'belege'
        wanted.set(d.file, { name: `${dir}/${d.kind === 'statement' ? '' : `${asciiName(d.beleg)}_`}${d.id}_${asciiName(d.filename_download)}`, sha256: d.sha256 })
      }
      const stmtNames = stmtFiles.length ? await database('directus_files').whereIn('id', stmtFiles).select('id', 'filename_download') : []
      for (const f of stmtNames) if (!wanted.has(f.id)) wanted.set(f.id, { name: `bank/auszuege/${asciiName(f.filename_download)}`, sha256: lines.find((l) => l.statement_file === f.id)?.statement_sha256 || null })
      let total = files.reduce((s, f) => s + Buffer.byteLength(f.data), 0)
      const mismatched = []
      for (const [fileId, w] of wanted) {
        const { bytes } = await readManagedFile(fileId, { services, getSchema, database }, { maxBytes: RECEIPT_MAX_BYTES * 2 })
        total += bytes.length
        if (total > ARCHIVE_MAX_BYTES) return res.status(413).json({ error: 'The archive would exceed 400 MB' })
        if (w.sha256 && sha256(bytes) !== w.sha256) mismatched.push(w.name)
        files.push({ name: w.name, data: bytes })
      }
      contents.documents = wanted.size
      contents.documents_changed = mismatched
      const manifest = {
        organisation: 'KSC Wiedikon', fiscal_year: fy.label, starts_on: iso(fy.starts_on), ends_on: iso(fy.ends_on), status: fy.status,
        generated_at: new Date().toISOString(), generated_by: a.name, generator: 'Wiedisync finance-books.js (accounting.wiedisync.kscw.ch)',
        retention: 'Keep 10 years after the end of the fiscal year (Art. 958f OR).',
        contents,
        files: files.map((f) => ({ name: f.name, bytes: Buffer.byteLength(f.data), sha256: sha256(Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data)) })),
      }
      files.push({ name: 'manifest.json', data: JSON.stringify(manifest, null, 2) })
      files.push({ name: 'LIESMICH.txt', data: [
        `KSC Wiedikon — Buchhaltungsarchiv ${fy.label}`, '',
        'Inhalt: Kontenplan, Journal und Kontensalden beider Bücher (native = Wiedisync, clubdesk = Spiegel der ClubDesk-Buchhaltung),',
        'Jahresrechnung als PDF, Bankbewegungen mit Kontoauszügen (camt.053), Belege und die Monatsabschlüsse des Parallelbetriebs.',
        'manifest.json enthält für jede Datei die SHA-256-Prüfsumme. Aufbewahrung: 10 Jahre (Art. 958f OR).', '',
      ].join('\r\n') })
      const zip = buildZip(files)
      const zipSha = sha256(zip)
      const fileId = await storeBuffer(zip, { filename: `kscw_finanzarchiv_${label}_${new Date().toISOString().slice(0, 10)}.zip`, type: 'application/zip' })
      const [row] = await database('finance_archives').insert({
        fiscal_year: fyId, file: fileId, sha256: zipSha, size_bytes: zip.length, contents: JSON.stringify(contents),
        created_by_name: a.name, created_by_email: a.email,
      }).returning('*')
      await writeUserLog(database, log, { accountability: req.accountability, action: 'create', collection: 'finance_archives', recordId: row.id, data: { kind: 'finance_archive', fiscal_year: fyId, bytes: zip.length, documents: wanted.size, changed: mismatched.length } })
      return res.json({ archive: row, contents })
    } catch (e) { return fail(res, req, 'archive', e) }
  })

  router.get('/finance/archives', async (req, res) => {
    try {
      const a = await gate(req); if (!a.read) return forbidden(res)
      const q = database('finance_archives as a').leftJoin('finance_fiscal_years as fy', 'fy.id', 'a.fiscal_year')
        .select('a.id', 'a.fiscal_year', 'fy.label as fiscal_year_label', 'a.sha256', 'a.size_bytes', 'a.contents', 'a.offsite', 'a.offsite_at', 'a.created_by_name', 'a.date_created')
        .orderBy('a.id', 'desc')
      if (Number.isInteger(Number(req.query.fiscal_year))) q.where('a.fiscal_year', Number(req.query.fiscal_year))
      return res.json({ archives: await q })
    } catch (e) { return fail(res, req, 'archives', e) }
  })

  router.get('/finance/archives/:id/file', async (req, res) => {
    try {
      const a = await gate(req); if (!a.read) return forbidden(res)
      const row = await database('finance_archives as a').join('directus_files as f', 'f.id', 'a.file')
        .where('a.id', Number(req.params.id)).first('a.file', 'f.filename_download')
      if (!row) return res.status(404).json({ error: 'Not found' })
      await streamManagedFile(row.file, { services, getSchema, database }, res, { filename: row.filename_download, type: 'application/zip', disposition: 'attachment' })
    } catch (e) { return fail(res, req, 'archive-file', e) }
  })

  // ════════════════════════════════════════════════════════════════════════
  // Switch readiness (the board decides; this only says whether the criteria hold)
  // ════════════════════════════════════════════════════════════════════════

  router.get('/finance/switch/readiness', async (req, res) => {
    try {
      const a = await gate(req); if (!a.read) return forbidden(res)
      const settings = await loadLedgerSettings(database)
      const years = await database('finance_fiscal_years').orderBy('starts_on').select('id', 'label', 'starts_on', 'ends_on', 'status')
      const start = years.find((y) => y.id === Number(settings.parallel_start_fy)) || null
      const inRun = start ? years.filter((y) => iso(y.starts_on) >= iso(start.starts_on)) : []
      const runIds = inRun.map((y) => y.id)
      const today = new Date().toISOString().slice(0, 10)

      const mirrorYears = Number((await database('finance_transactions').where('source', 'clubdesk').countDistinct('fiscal_year as n').first())?.n || 0)
      const clubdeskYears = years.filter((y) => iso(y.starts_on) <= today).length
      const hb = await database('sync_runs').where('source', 'clubdesk_finance').first('status', 'last_run_at')
      const syncHealthy = !!hb && hb.status === 'ok' && (Date.now() - new Date(hb.last_run_at).getTime()) < 30 * 3600 * 1000
      const openingPosted = !!(start && await database('finance_transactions').where({ source: 'native', fiscal_year: start.id, typ: 'Eroeffnung' }).first('id'))

      const lineCounts = runIds.length ? await database('finance_bank_lines').whereIn('fiscal_year', runIds).groupBy('status').select('status').count('* as n') : []
      const bankLines = lineCounts.reduce((s, c) => s + Number(c.n), 0)
      const openBankLines = Number(lineCounts.find((c) => c.status === 'open')?.n || 0)

      // Months due: every finished month from the run's first day.
      const due = []
      for (const y of inRun) {
        for (const month of monthsOfYear(iso(y.starts_on), iso(y.ends_on), today)) {
          if (monthEnd(`${month}-01`) < today) due.push({ fy: y.id, month })
        }
      }
      const signed = runIds.length ? await database('finance_parallel_signoffs').whereIn('fiscal_year', runIds).select('fiscal_year', 'month', 'difference_total') : []
      const signedKeys = new Set(signed.map((s) => `${s.fiscal_year}:${iso(s.month).slice(0, 7)}`))
      const monthsSigned = due.filter((d) => signedKeys.has(`${d.fy}:${d.month}`)).length
      let lastDifferenceTotal = null
      if (due.length) {
        const last = due[due.length - 1]
        lastDifferenceTotal = compareBooks({ ...(await booksOf(last.fy)), throughISO: monthEnd(`${last.month}-01`) }).differenceTotal
      }
      let closedYearsMatching = 0
      for (const y of inRun.filter((x) => x.status === 'closed')) {
        const c = compareBooks({ ...(await booksOf(y.id)), throughISO: iso(y.ends_on) })
        if (c.accountsDifferent === 0) closedYearsMatching++
      }
      const nativeRows = runIds.length ? await database('finance_transactions').where('source', 'native').whereIn('fiscal_year', runIds).select('id', 'typ') : []
      const withDocs = new Set(runIds.length ? (await database('finance_transaction_documents as d').join('finance_transactions as t', 't.id', 'd.entry')
        .where('t.source', 'native').whereIn('t.fiscal_year', runIds).distinct('d.entry').pluck('d.entry')).map(Number) : [])
      const needing = nativeRows.filter(needsReceipt)
      const closedIds = inRun.filter((y) => y.status === 'closed').map((y) => y.id)
      const archives = closedIds.length ? await database('finance_archives').whereIn('fiscal_year', closedIds).select('fiscal_year', 'offsite_at') : []
      const members = await database('members').where('kscw_membership_active', true).select('role')
      const roleCount = (r) => members.filter((m) => parseRoles(m.role).includes(r)).length

      const facts = {
        mirrorYears, clubdeskYears, syncHealthy, openingPosted, parallelStartLabel: start?.label ?? null,
        openBankLines, bankLines, monthsSigned, monthsDue: due.length, lastDifferenceTotal,
        closedYearsMatching, nativeEntries: nativeRows.length, entriesNeedingReceipt: needing.length,
        entriesMissingReceipt: needing.filter((e) => !withDocs.has(Number(e.id))).length,
        archives: archives.length, archivedOffsite: archives.filter((x) => x.offsite_at).length,
        revisors: roleCount('revisor'), treasurers: roleCount('finance'),
      }
      return res.json({ ...evaluateReadiness(facts), facts })
    } catch (e) { return fail(res, req, 'readiness', e) }
  })
}
