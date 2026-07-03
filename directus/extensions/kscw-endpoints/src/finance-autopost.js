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

/**
 * Shared advisory-lock namespace for fiscal-year serialization (#12, 2026-07-03 audit).
 * `pg_advisory_xact_lock(FISCAL_YEAR_LOCK_NS, fiscalYearId)` is taken by BOTH the year-end
 * close (finance-ledger.js) for its whole transaction AND by postAutoEntry before it posts,
 * so a leg can never slip into a year between the close's txn snapshot and its status flip.
 */
export const FISCAL_YEAR_LOCK_NS = 20260703

/**
 * PURE settlement allocator. Given an invoice total + its payments (date order),
 * produce the double-entry legs that keep Debitoren (A/R control) reconciled to
 * the sub-ledger. Extracted so the invariants are unit-testable without a DB
 * (2026-07-02 audit — #1 refund-vs-prepayment, #23 rounding residual). The
 * caller posts each returned leg idempotently. Also returns the final `open`
 * receivable and `prepaid` excess for assertions.
 *
 *   accounts: { debitoren, bank, income, prepay, badDebt } — account ids;
 *             prepay/badDebt may be null (fall back to debitoren/income).
 *   payments: [{ id, amount, entry_type, date }] in ('asc') order.
 */
export function planSettlementLegs({ total, payments, invoiceId, issueDate, accounts }) {
  const legs = []
  let open = round2(total)
  let prepaid = 0
  let sawPayment = false
  for (const p of payments || []) {
    const amt = round2(p.amount)
    const et = p.entry_type || 'payment'
    const push = (kind, debit, credit, amount, label) => {
      const a = round2(amount)
      if (a > 0 && debit != null && credit != null) legs.push({ kind, refId: p.id, debit, credit, amount: a, label, date: p.date })
    }
    if (et === 'payment') {
      sawPayment = true
      const applied = round2(Math.min(amt, Math.max(0, open))); const excess = round2(amt - applied)
      open = round2(open - applied); prepaid = round2(prepaid + excess)
      push('settle', accounts.bank, accounts.debitoren, applied, 'payment')
      push('settle_over', accounts.bank, accounts.prepay || accounts.debitoren, excess, 'overpayment')
    } else if (et === 'refund') {
      // Draw prepaid excess down FIRST (Debit Prepayment / Credit Bank), then
      // re-open the receivable for the part that was settled by real payments
      // (Debit Debitoren / Credit Bank). Any remainder is an OVER-refund (the
      // club paid out more than it net-received) → book it on the prepayment side
      // too (prepayment goes negative = "due to member"), so the FULL refund hits
      // Bank and the GL matches deriveSettlement's netCash<0 case. (2026-07-03
      // review: the earlier version dropped this leftover, understating Bank.)
      const fromPrepay = round2(Math.min(amt, Math.max(0, prepaid))); prepaid = round2(prepaid - fromPrepay)
      const reopened = round2(Math.min(round2(amt - fromPrepay), Math.max(0, round2(total - open)))); open = round2(open + reopened)
      const overRefund = round2(amt - fromPrepay - reopened) // beyond prepaid + receivable room
      prepaid = round2(prepaid - overRefund)
      push('settle_over', accounts.prepay || accounts.debitoren, accounts.bank, round2(fromPrepay + overRefund), 'refund')
      push('settle', accounts.debitoren, accounts.bank, reopened, 'refund')
    } else if (et === 'credit_note') {
      // Reduce the open receivable by what's still open (Debit Income / Credit Debitoren).
      // Any excess beyond the open bill is money the club now owes back (the invoice was
      // already covered) → book it as a prepayment (Debit Income / Credit Prepayment), so
      // Income is reduced by the FULL note and the GL matches deriveSettlement, which counts
      // the full non-cash amount toward coverage/overpaid (#18, 2026-07-03 review).
      const applied = round2(Math.min(amt, Math.max(0, open))); open = round2(open - applied)
      const excess = round2(amt - applied); prepaid = round2(prepaid + excess)
      push('settle', accounts.income, accounts.debitoren, applied, 'credit note')
      push('settle_over', accounts.income, accounts.prepay || accounts.debitoren, excess, 'credit note')
    } else if (et === 'writeoff') {
      // Same as credit_note but the debit is the bad-debt expense. Excess beyond the open
      // bill → prepayment, so the write-off's full amount hits the GL and agrees with
      // deriveSettlement's non-cash coverage (#18, 2026-07-03 review).
      const applied = round2(Math.min(amt, Math.max(0, open))); open = round2(open - applied)
      const excess = round2(amt - applied); prepaid = round2(prepaid + excess)
      push('settle', accounts.badDebt, accounts.debitoren, applied, 'write-off')
      push('settle_over', accounts.badDebt, accounts.prepay || accounts.debitoren, excess, 'write-off')
    }
  }
  // Rounding residual (#23): forgive a ≤1-rappen short-pay to match deriveSettlement.
  if (open > 0 && open <= 0.01 && sawPayment) {
    const roundAcct = accounts.badDebt || accounts.income
    if (roundAcct != null) {
      legs.push({ kind: 'round', refId: invoiceId, debit: roundAcct, credit: accounts.debitoren, amount: open, label: 'Rundung', date: issueDate })
      open = 0
    }
  }
  return { legs, open, prepaid }
}

export async function loadLedgerSettings(database) {
  const s = await database('finance_ledger_settings').where('id', 1).first()
  return s || { id: 1, autopost_enabled: false }
}

async function acctMap(database) {
  const rows = await database('finance_accounts').select('id', 'number', 'name', 'active')
  return new Map(rows.map((r) => [Number(r.id), r]))
}

/** fee_category → income account, for per-category dues income (migration 154). */
async function incomeMapFor(database) {
  const rows = await database('finance_income_account_map').whereNotNull('account').select('fee_category', 'account')
  return new Map(rows.map((r) => [r.fee_category, Number(r.account)]))
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
  // #12 (2026-07-03 audit): serialize with the year-end close on a shared advisory lock
  // keyed on the fiscal year (the close holds the same lock for its whole txn). Re-read
  // status UNDER the lock so a close that committed while we were looking up can't let a
  // leg slip into the just-closed year between its snapshot and the status flip.
  await db.raw('SELECT pg_advisory_xact_lock(?::int, ?::int)', [FISCAL_YEAR_LOCK_NS, fy.id])
  const fyLocked = await db('finance_fiscal_years').where('id', fy.id).first('status')
  if ((fyLocked?.status ?? fy.status) === 'closed') return { skipped: 'fiscal-year-closed' }
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
  try { await database('finance_transactions').where({ source: 'native', auto: true, ref_id: invoiceId }).whereIn('ref_kind', ['issue', 'round']).del() } catch { /* closed FY */ }
  if (paymentIds?.length) {
    try { await database('finance_transactions').where({ source: 'native', auto: true }).whereIn('ref_kind', ['settle', 'settle_over']).whereIn('ref_id', paymentIds).del() } catch { /* closed FY */ }
  }
}

/** Ensure a native invoice's journal entries exist + stay reconciled (atomic). */
export async function reconcileInvoiceLedger(database, invoiceId, settings, acctById, incomeMap) {
  acctById = acctById || (await acctMap(database))
  incomeMap = incomeMap || (await incomeMapFor(database))
  const inv = await database('finance_invoices').where('id', invoiceId).andWhere('source', 'native').first()
  if (!inv) return { skipped: 'not-native' }
  // Per-category dues income → the mapped account; everything else → the default.
  const incomeAcct = (inv.fee_category && incomeMap.get(inv.fee_category)) || settings.income_account
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
      results.push(await postAutoEntry(trx, { kind: 'issue', refId: inv.id, dateISO: issueDate, text: `Rechnung ${inv.number || inv.id}`, debitId: settings.debitoren_account, creditId: incomeAcct, amount: total, acctById }))
    } else if (round2(existingIssue.amount_chf) !== total) {
      const fy = await trx('finance_fiscal_years').where('id', existingIssue.fiscal_year).first('status')
      if (fy?.status !== 'closed') { await trx('finance_transactions').where('id', existingIssue.id).update({ amount_chf: total, date_updated: new Date() }); results.push({ healed: existingIssue.id, to: total }) }
      else results.push({ skipped: 'issue-amount-locked' })
    }

    // 2. Settlements + rounding residual — allocation is PURE (planSettlementLegs)
    //    so the ledger invariants are unit-tested (2026-07-02 audit: #1 refund vs
    //    prepayment, #23 rounding). Post each leg idempotently on (ref_kind, ref_id).
    // #6 (2026-07-03 review): the rounding leg's amount depends on the running
    // residual, so drop any prior one before recomputing — postAutoEntry is
    // idempotent by (ref_kind, ref_id) and would otherwise keep a stale ≤1-rappen
    // leg after a later payment. Open FY only (the trigger blocks closed-year del).
    try { await trx('finance_transactions').where({ source: 'native', auto: true, ref_kind: 'round', ref_id: inv.id }).del() } catch { /* closed FY */ }
    // #5 (2026-07-03 audit): also purge the current payments' settlement legs so a shifted
    // allocation (e.g. a later overpayment/refund/credit-note re-splitting how an earlier
    // payment divides between Bank/Debitoren/Prepayment) recomputes from scratch. Without
    // this, postAutoEntry's (ref_kind, ref_id) idempotency keeps the STALE settle/settle_over
    // leg and GL Bank stays permanently overstated. Open FY only (trigger blocks closed-year del).
    if (pays.length) { try { await trx('finance_transactions').where({ source: 'native', auto: true }).whereIn('ref_kind', ['settle', 'settle_over']).whereIn('ref_id', pays.map((p) => p.id)).del() } catch { /* closed FY */ } }
    const paysForPlan = pays.map((p) => ({ id: p.id, amount: p.amount, entry_type: p.entry_type, date: isoDate(p.payment_date || inv.invoice_date || inv.date_created) }))
    const { legs } = planSettlementLegs({
      total, payments: paysForPlan, invoiceId: inv.id, issueDate,
      accounts: { debitoren: settings.debitoren_account, bank: settings.bank_account, income: incomeAcct, prepay, badDebt: settings.bad_debt_account },
    })
    for (const leg of legs) {
      results.push(await postAutoEntry(trx, { kind: leg.kind, refId: leg.refId, dateISO: leg.date, text: `${leg.label} ${inv.number || inv.id}`, debitId: leg.debit, creditId: leg.credit, amount: leg.amount, acctById }))
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
    const incomeMap = await incomeMapFor(database)
    const invs = await database('finance_invoices').where('dues_run', runId).andWhere('source', 'native').select('id')
    for (const inv of invs) await reconcileInvoiceLedger(database, inv.id, s, acctById, incomeMap)
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

/** Remove a deleted team-entry's auto-posted journal entry (open fiscal year only).
 *  2026-07-02 audit (#9): the team-entry DELETE handler removed the row but not its
 *  auto-posted GL entry, leaving phantom income/expense that drifts the native book
 *  from the teams sub-ledger. Mirrors removeAutopostForPaymentSafe. */
export async function removeAutopostForTeamEntrySafe(database, logger, entryId) {
  try {
    const s = await loadLedgerSettings(database)
    if (!s.autopost_enabled) return
    await database('finance_transactions').where({ ref_kind: 'team', ref_id: entryId, auto: true, source: 'native' }).del()
  } catch (e) { logger?.warn?.({ msg: `autopost remove team-entry ${entryId} failed: ${e.message}` }) }
}

/** Bulk backfill/reconcile — make the whole native book reflect current A/R. */
export async function reconcileAllLedger(database, settings, { fiscalYear } = {}) {
  const acctById = await acctMap(database)
  const incomeMap = await incomeMapFor(database)
  const summary = { invoices: 0, team_entries: 0, posted: 0, healed: 0, cancelled_cleaned: 0, skipped: {} }
  const bump = (res) => { for (const r of [].concat(res)) { if (r?.posted) summary.posted++; else if (r?.healed) summary.healed++; else if (r?.skipped) summary.skipped[r.skipped] = (summary.skipped[r.skipped] || 0) + 1 } }
  const invs = await database('finance_invoices').where('source', 'native').select('id', 'status')
  for (const inv of invs) {
    const r = await reconcileInvoiceLedger(database, inv.id, settings, acctById, incomeMap)
    if (r.cancelled) summary.cancelled_cleaned++
    else if (r.results) { summary.invoices++; bump(r.results) }
  }
  let teQ = database('finance_team_entries').select('id')
  if (fiscalYear) teQ = teQ.where('fiscal_year', fiscalYear)
  const tes = await teQ
  for (const e of tes) { const r = await reconcileTeamEntryLedger(database, e.id, settings, acctById); if (r.result) { summary.team_entries++; bump(r.result) } }
  return summary
}
