/**
 * Auto-posting — makes the native ledger SELF-FUNCTIONING by deriving the right
 * double-entry journal entries for each A/R event and posting them (idempotently) to
 * the native book. It tracks a running open-receivable balance per invoice so the
 * Debitoren (A/R control) account stays reconciled to the sub-ledger:
 *
 *   Invoice issued     Debit Debitoren        / Credit Income           (= amount)
 *   Payment            Debit Bank             / Credit Debitoren         (min(pay, open))
 *     overpayment      Debit Bank             / Credit Prepayment        (excess)
 *   Refund             Debit Debitoren        / Credit Bank              (re-open, ≤ amount)
 *     of a prepayment  Debit Prepayment       / Credit Bank              (excess)
 *   Credit note        Debit Income           / Credit Debitoren         (min, ≤ open)
 *   Write-off          Debit Bad-debt expense / Credit Debitoren         (min, ≤ open)
 *   Team sponsoring    Debit Bank             / Credit Sponsoring|Income
 *   Team expense       Debit Expense          / Credit Bank
 *
 * Idempotent on (ref_kind, ref_id) via a partial unique index. A cancelled invoice
 * has its auto-posts deleted (open year). The issue posting self-heals if the invoice
 * amount changes. Postings land only in OPEN fiscal years (closed → skipped, surfaced
 * in the reconcile summary). One invoice's postings are one transaction.
 */
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const isoDate = (d) => { if (!d) return null; if (typeof d === 'string') return d.slice(0, 10); const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` }

export async function loadLedgerSettings(database) {
  const s = await database('finance_ledger_settings').where('id', 1).first()
  return s || { id: 1, autopost_enabled: false }
}

async function acctMap(database) {
  const rows = await database('finance_accounts').select('id', 'number', 'name', 'active')
  return new Map(rows.map((r) => [Number(r.id), r]))
}

/** Insert one auto-posted native journal entry, idempotent on (ref_kind, ref_id).
 *  `db` may be a knex transaction. A unique-index race throws → caller rolls back. */
async function postAutoEntry(db, { kind, refId, dateISO, text, debitId, creditId, amount, actorName, acctById }) {
  const amt = round2(amount)
  if (!(amt > 0)) return { skipped: 'zero-amount' }
  if (debitId == null || creditId == null) return { skipped: 'account-unmapped' }
  if (Number(debitId) === Number(creditId)) return { skipped: 'same-account' }
  if (!dateISO) return { skipped: 'no-date' }
  const existing = await db('finance_transactions').where({ ref_kind: kind, ref_id: refId, auto: true, source: 'native' }).first('id')
  if (existing) return { skipped: 'exists', id: existing.id }
  const fy = await db('finance_fiscal_years').where('starts_on', '<=', dateISO).andWhere('ends_on', '>=', dateISO).orderBy('id').first('id', 'status')
  if (!fy) return { skipped: 'no-fiscal-year' }
  if (fy.status === 'closed') return { skipped: 'fiscal-year-closed' }
  const dr = acctById.get(Number(debitId)), cr = acctById.get(Number(creditId))
  if (!dr || !cr) return { skipped: 'account-missing' }
  const r = await db.raw("SELECT nextval('finance_native_entry_seq')::int AS n")
  const n = (r.rows ? r.rows[0] : r[0]).n
  const beleg = `AP-${dateISO.slice(0, 4)}-${String(n).padStart(4, '0')}`
  const ins = await db('finance_transactions').insert({
    source: 'native', typ: 'Standard', auto: true, ref_kind: kind, ref_id: refId, beleg, booking_date: dateISO, fiscal_year: fy.id,
    text: (text || '').slice(0, 250),
    debit_account: Number(debitId), debit_account_number: dr.number, debit_account_name: dr.name,
    credit_account: Number(creditId), credit_account_number: cr.number, credit_account_name: cr.name,
    amount_chf: amt, created_by_name: actorName || 'auto-posting',
  }).returning('id')
  return { posted: ins[0]?.id ?? ins[0] }
}

/** Delete an invoice's standing auto-posts (open fiscal year; closed-year rows are
 *  left for a manual reversal — the immutability trigger blocks the delete there). */
async function deleteInvoiceAutoposts(database, invoiceId, paymentIds) {
  try { await database('finance_transactions').where({ source: 'native', auto: true, ref_kind: 'issue', ref_id: invoiceId }).del() } catch { /* closed FY */ }
  if (paymentIds?.length) {
    try { await database('finance_transactions').where({ source: 'native', auto: true }).whereIn('ref_kind', ['settle', 'settle_over']).whereIn('ref_id', paymentIds).del() } catch { /* closed FY */ }
  }
}

/** Ensure a native invoice's journal entries exist + stay reconciled (atomic). */
export async function reconcileInvoiceLedger(database, invoiceId, settings, acctById) {
  acctById = acctById || (await acctMap(database))
  const inv = await database('finance_invoices').where('id', invoiceId).andWhere('source', 'native').first()
  if (!inv) return { skipped: 'not-native' }
  const pays = await database('finance_payments').where('invoice', invoiceId)
    .orderBy([{ column: 'payment_date', order: 'asc' }, { column: 'id', order: 'asc' }])
    .select('id', 'amount', 'entry_type', 'payment_date')

  if (inv.status === 'cancelled') {
    await deleteInvoiceAutoposts(database, inv.id, pays.map((p) => p.id))
    return { invoice: invoiceId, cancelled: true }
  }

  const total = round2(inv.amount)
  const issueDate = isoDate(inv.invoice_date || inv.date_created)
  const results = []
  const prepay = settings.prepayment_account || null

  await database.transaction(async (trx) => {
    // 1. Issue posting — create, or self-heal the amount if the invoice changed.
    const existingIssue = await trx('finance_transactions').where({ source: 'native', auto: true, ref_kind: 'issue', ref_id: inv.id }).first('id', 'amount_chf', 'fiscal_year')
    if (!existingIssue) {
      results.push(await postAutoEntry(trx, { kind: 'issue', refId: inv.id, dateISO: issueDate, text: `Rechnung ${inv.number || inv.id}`, debitId: settings.debitoren_account, creditId: settings.income_account, amount: total, acctById }))
    } else if (round2(existingIssue.amount_chf) !== total) {
      const fy = await trx('finance_fiscal_years').where('id', existingIssue.fiscal_year).first('status')
      if (fy?.status !== 'closed') { await trx('finance_transactions').where('id', existingIssue.id).update({ amount_chf: total, date_updated: new Date() }); results.push({ healed: existingIssue.id, to: total }) }
      else results.push({ skipped: 'issue-amount-locked' })
    }

    // 2. Settlements — process in date order, tracking the running open receivable.
    let open = total
    for (const p of pays) {
      const amt = round2(p.amount)
      const et = p.entry_type || 'payment'
      const date = isoDate(p.payment_date || inv.invoice_date || inv.date_created)
      const post = (kind, debitId, creditId, amount, label) => postAutoEntry(trx, { kind, refId: p.id, dateISO: date, text: `${label} ${inv.number || inv.id}`, debitId, creditId, amount, acctById })
      if (et === 'payment') {
        const applied = round2(Math.min(amt, Math.max(0, open))); const excess = round2(amt - applied); open = round2(open - applied)
        if (applied > 0) results.push(await post('settle', settings.bank_account, settings.debitoren_account, applied, 'payment'))
        if (excess > 0) results.push(await post('settle_over', settings.bank_account, prepay || settings.debitoren_account, excess, 'overpayment'))
      } else if (et === 'refund') {
        const room = round2(Math.max(0, total - open)); const reopened = round2(Math.min(amt, room)); const fromPrepay = round2(amt - reopened); open = round2(open + reopened)
        if (reopened > 0) results.push(await post('settle', settings.debitoren_account, settings.bank_account, reopened, 'refund'))
        if (fromPrepay > 0) results.push(await post('settle_over', prepay || settings.debitoren_account, settings.bank_account, fromPrepay, 'refund'))
      } else if (et === 'credit_note') {
        const applied = round2(Math.min(amt, Math.max(0, open))); open = round2(open - applied)
        if (applied > 0) results.push(await post('settle', settings.income_account, settings.debitoren_account, applied, 'credit note'))
      } else if (et === 'writeoff') {
        const applied = round2(Math.min(amt, Math.max(0, open))); open = round2(open - applied)
        if (applied > 0) results.push(await post('settle', settings.bad_debt_account, settings.debitoren_account, applied, 'write-off'))
      }
    }
  })
  return { invoice: invoiceId, results }
}

/** Ensure a per-team entry's journal entry exists. */
export async function reconcileTeamEntryLedger(database, entryId, settings, acctById) {
  acctById = acctById || (await acctMap(database))
  const e = await database('finance_team_entries').where('id', entryId).first()
  if (!e) return { skipped: 'not-found' }
  let debit, credit
  if (e.kind === 'expense') { debit = settings.expense_account; credit = settings.bank_account }
  else { debit = settings.bank_account; credit = e.kind === 'sponsoring' ? (settings.sponsoring_account || settings.income_account) : settings.income_account }
  const res = await postAutoEntry(database, {
    kind: 'team', refId: e.id, dateISO: isoDate(e.entry_date || e.date_created),
    text: `${e.kind} ${e.sponsor || e.label || ('team ' + e.team)}`, debitId: debit, creditId: credit, amount: e.amount, acctById,
  })
  return { team_entry: entryId, result: res }
}

/** Best-effort real-time hooks — never throw into the caller's A/R operation. */
export async function autopostInvoiceSafe(database, logger, invoiceId) {
  try {
    const s = await loadLedgerSettings(database)
    if (!s.autopost_enabled) return
    await reconcileInvoiceLedger(database, invoiceId, s)
  } catch (e) { logger?.warn?.({ msg: `autopost invoice ${invoiceId} failed: ${e.message}` }) }
}
export async function autopostTeamEntrySafe(database, logger, entryId) {
  try {
    const s = await loadLedgerSettings(database)
    if (!s.autopost_enabled) return
    await reconcileTeamEntryLedger(database, entryId, s)
  } catch (e) { logger?.warn?.({ msg: `autopost team-entry ${entryId} failed: ${e.message}` }) }
}
export async function autopostDuesRunSafe(database, logger, runId) {
  try {
    const s = await loadLedgerSettings(database)
    if (!s.autopost_enabled) return
    const acctById = await acctMap(database)
    const invs = await database('finance_invoices').where('dues_run', runId).andWhere('source', 'native').select('id')
    for (const inv of invs) await reconcileInvoiceLedger(database, inv.id, s, acctById)
  } catch (e) { logger?.warn?.({ msg: `autopost dues-run ${runId} failed: ${e.message}` }) }
}

/** Remove a deleted payment's auto-posted journal entries (open fiscal year only). */
export async function removeAutopostForPaymentSafe(database, logger, paymentId) {
  try {
    const s = await loadLedgerSettings(database)
    if (!s.autopost_enabled) return
    await database('finance_transactions').where({ ref_id: paymentId, auto: true, source: 'native' }).whereIn('ref_kind', ['settle', 'settle_over']).del()
  } catch (e) { logger?.warn?.({ msg: `autopost remove payment ${paymentId} failed: ${e.message}` }) }
}

/** Bulk backfill/reconcile — make the whole native book reflect current A/R. */
export async function reconcileAllLedger(database, settings, { fiscalYear } = {}) {
  const acctById = await acctMap(database)
  const summary = { invoices: 0, team_entries: 0, posted: 0, healed: 0, cancelled_cleaned: 0, skipped: {} }
  const bump = (res) => { for (const r of [].concat(res)) { if (r?.posted) summary.posted++; else if (r?.healed) summary.healed++; else if (r?.skipped) summary.skipped[r.skipped] = (summary.skipped[r.skipped] || 0) + 1 } }
  const invs = await database('finance_invoices').where('source', 'native').select('id', 'status')
  for (const inv of invs) {
    const r = await reconcileInvoiceLedger(database, inv.id, settings, acctById)
    if (r.cancelled) summary.cancelled_cleaned++
    else if (r.results) { summary.invoices++; bump(r.results) }
  }
  let teQ = database('finance_team_entries').select('id')
  if (fiscalYear) teQ = teQ.where('fiscal_year', fiscalYear)
  const tes = await teQ
  for (const e of tes) { const r = await reconcileTeamEntryLedger(database, e.id, settings, acctById); if (r.result) { summary.team_entries++; bump(r.result) } }
  return summary
}
