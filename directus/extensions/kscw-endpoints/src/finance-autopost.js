/**
 * Auto-posting — makes the native ledger SELF-FUNCTIONING by deriving the right
 * double-entry journal entry for each A/R event and posting it (idempotently) to the
 * native book. Accrual model:
 *
 *   Invoice issued        Debit Debitoren        / Credit Income
 *   Payment received      Debit Bank             / Credit Debitoren
 *   Refund                Debit Debitoren        / Credit Bank
 *   Credit note           Debit Income           / Credit Debitoren
 *   Write-off             Debit Bad-debt expense / Credit Debitoren
 *   Team sponsoring/income Debit Bank            / Credit Sponsoring (or Income)
 *   Team expense          Debit Expense          / Credit Bank
 *
 * Every posting carries (auto=true, ref_kind, ref_id) and is guarded by a partial
 * unique index, so reconcile is idempotent + re-runnable. Postings land only in OPEN
 * fiscal years (a closed period is skipped — reconcile before closing). Account ids
 * come from finance_ledger_settings; a missing mapping skips that posting (reported).
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

/** Insert one auto-posted native journal entry, idempotent on (ref_kind, ref_id). */
async function postAutoEntry(database, { kind, refId, dateISO, text, debitId, creditId, amount, actorName, acctById }) {
  const amt = round2(amount)
  if (!(amt > 0)) return { skipped: 'zero-amount' }
  if (debitId == null || creditId == null) return { skipped: 'account-unmapped' }
  if (Number(debitId) === Number(creditId)) return { skipped: 'same-account' }
  if (!dateISO) return { skipped: 'no-date' }
  const existing = await database('finance_transactions').where({ ref_kind: kind, ref_id: refId, auto: true, source: 'native' }).first('id')
  if (existing) return { skipped: 'exists', id: existing.id }
  const fy = await database('finance_fiscal_years').where('starts_on', '<=', dateISO).andWhere('ends_on', '>=', dateISO).orderBy('id').first('id', 'status')
  if (!fy) return { skipped: 'no-fiscal-year' }
  if (fy.status === 'closed') return { skipped: 'fiscal-year-closed' }
  const dr = acctById.get(Number(debitId)), cr = acctById.get(Number(creditId))
  if (!dr || !cr) return { skipped: 'account-missing' }
  const r = await database.raw("SELECT nextval('finance_native_entry_seq')::int AS n")
  const n = (r.rows ? r.rows[0] : r[0]).n
  const beleg = `AP-${dateISO.slice(0, 4)}-${String(n).padStart(4, '0')}`
  try {
    const ins = await database('finance_transactions').insert({
      source: 'native', typ: 'Standard', auto: true, ref_kind: kind, ref_id: refId, beleg, booking_date: dateISO, fiscal_year: fy.id,
      text: (text || '').slice(0, 250),
      debit_account: Number(debitId), debit_account_number: dr.number, debit_account_name: dr.name,
      credit_account: Number(creditId), credit_account_number: cr.number, credit_account_name: cr.name,
      amount_chf: amt, created_by_name: actorName || 'auto-posting',
    }).returning('id')
    return { posted: ins[0]?.id ?? ins[0] }
  } catch (e) {
    if (/finance_tx_autopost_uidx/.test(e.message)) return { skipped: 'exists-race' } // lost a concurrent insert
    throw e
  }
}

const settleLegs = (entryType, s) => {
  switch (entryType) {
    case 'refund': return { debit: s.debitoren_account, credit: s.bank_account }
    case 'credit_note': return { debit: s.income_account, credit: s.debitoren_account }
    case 'writeoff': return { debit: s.bad_debt_account, credit: s.debitoren_account }
    default: return { debit: s.bank_account, credit: s.debitoren_account } // payment
  }
}

/** Ensure a native invoice's issue + per-payment journal entries exist. */
export async function reconcileInvoiceLedger(database, invoiceId, settings, acctById) {
  acctById = acctById || (await acctMap(database))
  const inv = await database('finance_invoices').where('id', invoiceId).andWhere('source', 'native').first()
  if (!inv) return { skipped: 'not-native' }
  const results = []
  if (inv.status !== 'cancelled') {
    results.push(await postAutoEntry(database, {
      kind: 'issue', refId: inv.id, dateISO: isoDate(inv.invoice_date || inv.date_created),
      text: `Rechnung ${inv.number || inv.id}`, debitId: settings.debitoren_account, creditId: settings.income_account,
      amount: inv.amount, acctById,
    }))
  }
  const pays = await database('finance_payments').where('invoice', invoiceId).select('id', 'amount', 'entry_type', 'payment_date')
  for (const p of pays) {
    const legs = settleLegs(p.entry_type || 'payment', settings)
    results.push(await postAutoEntry(database, {
      kind: 'settle', refId: p.id, dateISO: isoDate(p.payment_date || inv.invoice_date),
      text: `${p.entry_type || 'payment'} ${inv.number || inv.id}`, debitId: legs.debit, creditId: legs.credit, amount: p.amount, acctById,
    }))
  }
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

/** Best-effort real-time hook — never throws into the caller's A/R operation. */
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

/** Remove a deleted payment's auto-posted journal entry (open fiscal year only;
 *  the immutability trigger blocks it in a closed year — reverse there instead). */
export async function removeAutopostForPaymentSafe(database, logger, paymentId) {
  try {
    const s = await loadLedgerSettings(database)
    if (!s.autopost_enabled) return
    await database('finance_transactions').where({ ref_kind: 'settle', ref_id: paymentId, auto: true, source: 'native' }).del()
  } catch (e) { logger?.warn?.({ msg: `autopost remove payment ${paymentId} failed: ${e.message}` }) }
}

/** Bulk backfill/reconcile — make the whole native book reflect current A/R. */
export async function reconcileAllLedger(database, settings, { fiscalYear } = {}) {
  const acctById = await acctMap(database)
  const summary = { invoices: 0, team_entries: 0, posted: 0, skipped: {} }
  const bump = (res) => { for (const r of [].concat(res)) { if (r?.posted) summary.posted++; else if (r?.skipped) summary.skipped[r.skipped] = (summary.skipped[r.skipped] || 0) + 1 } }
  let invQ = database('finance_invoices').where('source', 'native').whereNot('status', 'cancelled').select('id')
  const invs = await invQ
  for (const inv of invs) { const r = await reconcileInvoiceLedger(database, inv.id, settings, acctById); if (r.results) { summary.invoices++; bump(r.results) } }
  let teQ = database('finance_team_entries').select('id')
  if (fiscalYear) teQ = teQ.where('fiscal_year', fiscalYear)
  const tes = await teQ
  for (const e of tes) { const r = await reconcileTeamEntryLedger(database, e.id, settings, acctById); if (r.result) { summary.team_entries++; bump(r.result) } }
  return summary
}
