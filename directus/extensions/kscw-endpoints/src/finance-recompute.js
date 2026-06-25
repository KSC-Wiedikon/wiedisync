/**
 * Shared invoice settlement — the SINGLE writer of a native invoice's
 * paid/open/overpaid/written-off/status, derived from the SUM of its
 * finance_payments ledger entries. Replaces the all-or-nothing UPDATE that
 * /confirm and the camt applyNative each used to do independently.
 */
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const todayISO = () => new Date().toISOString().slice(0, 10)
const EPS = 0.005

/**
 * Pure settlement math (no DB) — unit-tested. Given the ledger entries + the
 * invoice amount + its current status, derive the settlement fields and status.
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
  const total = Number(amount) || 0
  const received = round2(paid - refunded)            // net cash the club holds
  const coverage = round2(received + credited + writtenOff)
  const open = round2(Math.max(0, total - coverage))
  const overpaid = round2(Math.max(0, received - total))
  const settled = total > 0 && coverage + EPS >= total

  let status
  if (settled) status = 'paid'
  else if (received > EPS || credited > EPS || writtenOff > EPS) status = 'partial'
  else if (currentStatus === 'pending_confirmation') status = 'pending_confirmation'
  else status = 'open'

  return { status, amount_paid: received, open_amount: open, overpaid_amount: overpaid, written_off_amount: round2(writtenOff), settled }
}

/**
 * Recompute + persist a native invoice's settlement from its ledger. No-op for
 * ClubDesk-mirror rows (their state comes from the import) and cancelled rows.
 * When the invoice transitions to paid and wasn't confirmed yet, stamps the actor.
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
    patch.closed_on = null
  }

  const [row] = await database('finance_invoices').where('id', invoiceId).update(patch).returning('*')
  return row
}
