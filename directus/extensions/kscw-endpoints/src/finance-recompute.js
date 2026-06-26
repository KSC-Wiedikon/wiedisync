/**
 * Shared invoice settlement — the SINGLE writer of a native invoice's
 * paid/open/overpaid/written-off/status, derived from the SUM of its
 * finance_payments ledger entries. Replaces the all-or-nothing UPDATE that
 * /confirm and the camt applyNative each used to do independently.
 */
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const todayISO = () => new Date().toISOString().slice(0, 10)
const EPS = 0.01 // one-rappen settle tolerance (a fair 3-way split of 100 must close)

/**
 * Pure settlement math (no DB) — unit-tested. Invariants it must hold:
 *   amount_paid >= 0, 0 <= open_amount <= amount, settled ⇒ net cash >= 0,
 *   and a refund/write-off mix can NEVER false-settle to 'paid' on negative cash.
 *
 * Entry kinds: payment (cash in) | refund (cash out) | credit_note (non-cash
 * reduction of what's owed) | writeoff (uncollectable, non-cash).
 *
 * @param {Array<{amount:number|string, entry_type?:string}>} entries
 * @param {number} amount  invoice total
 * @param {string} currentStatus
 * @returns {{status, amount_paid, open_amount, overpaid_amount, written_off_amount, settled}}
 */
export function deriveSettlement(entries, amount, currentStatus) {
  let paid = 0, refunded = 0, credited = 0, writtenOff = 0
  for (const p of entries || []) {
    const a = Number(p.amount) || 0
    switch (p.entry_type || 'payment') {
      case 'refund': refunded += a; break
      case 'credit_note': credited += a; break
      case 'writeoff': writtenOff += a; break
      default: paid += a // 'payment'
    }
  }
  const total = round2(amount)
  const netCash = round2(paid - refunded)        // true cash position — may be negative
  const cashHeld = Math.max(0, netCash)          // cash actually available to cover the bill
  const nonCash = round2(credited + writtenOff)  // credit notes + write-offs
  const coverage = round2(cashHeld + nonCash)
  // A bill is settled only when coverage meets it AND net cash is not an outflow:
  // a refund/write-off mix can never settle on negative cash. Zero/credit invoices auto-close.
  const settled = total <= 0 ? true : (coverage + EPS >= total && netCash >= -EPS)

  let status, open_amount, overpaid_amount
  if (settled) {
    status = 'paid'
    open_amount = 0
    // Overpaid = cash beyond what cash had to cover (total minus non-cash forgiveness).
    overpaid_amount = round2(Math.max(0, cashHeld - Math.max(0, total - nonCash)))
    if (overpaid_amount < EPS) overpaid_amount = 0
  } else if (netCash < -EPS) {
    // Net cash outflow (refunds exceed payments): the bill is fully open again;
    // the club separately owes the payer the difference (visible in the ledger).
    status = 'open'
    open_amount = total
    overpaid_amount = 0
  } else {
    open_amount = round2(Math.max(0, total - coverage))
    overpaid_amount = 0
    if (coverage > EPS) status = 'partial'
    else if (currentStatus === 'pending_confirmation') status = 'pending_confirmation'
    else status = 'open'
  }

  return { status, amount_paid: cashHeld, open_amount, overpaid_amount, written_off_amount: round2(writtenOff), settled }
}

/**
 * Recompute + persist a native invoice's settlement from its ledger. No-op for
 * ClubDesk-mirror rows and cancelled rows. Pass a knex transaction as `database`
 * to make the caller's insert+recompute atomic. On the first transition to paid
 * it stamps the actor; when an invoice falls BACK out of paid (refund / deleted
 * payment) it clears the settlement stamp so the audit trail matches reality.
 * @returns the updated invoice row, or null.
 */
export async function recomputeInvoice(database, invoiceId, { actorName = null, actorEmail = null, via = 'manual' } = {}) {
  const inv = await database('finance_invoices').where('id', invoiceId).andWhere('source', 'native').first()
  if (!inv || inv.status === 'cancelled') return inv || null

  const entries = await database('finance_payments').where('invoice', invoiceId).select('amount', 'entry_type')
  const s = deriveSettlement(entries, inv.amount, inv.status)

  const patch = {
    status: s.status,
    amount_paid: s.amount_paid,
    open_amount: s.open_amount,
    overpaid_amount: s.overpaid_amount,
    written_off_amount: s.written_off_amount,
    date_updated: new Date(),
  }
  if (s.status === 'paid') {
    patch.closed_on = todayISO()
    if (!inv.confirmed_at) {
      patch.confirmed_at = new Date()
      patch.confirmed_by_name = actorName
      patch.confirmed_by_email = actorEmail
      patch.confirmed_via = via
    }
  } else {
    // Reopened — clear the settlement stamp so it isn't shown as confirmed-paid and
    // the next genuine settlement re-stamps the correct actor.
    patch.closed_on = null
    patch.confirmed_at = null
    patch.confirmed_by_name = null
    patch.confirmed_by_email = null
    patch.confirmed_via = null
  }

  const [row] = await database('finance_invoices').where('id', invoiceId).update(patch).returning('*')
  return row
}
