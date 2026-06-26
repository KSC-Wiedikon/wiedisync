/**
 * Year-end close (Jahresabschluss) — pure planning math, no DB. Given a fiscal
 * year's native transactions + the account chart, produce:
 *   - the result (Erfolgsrechnung): total income, expense, net surplus/deficit
 *   - the Abschluss entries: zero each nominal (income/expense) account into equity
 *   - the Eröffnung entries: carry each real (asset/liability/equity) closing
 *     balance into the NEXT fiscal year via an opening-balance clearing account
 *
 * Each planned entry is one balanced leg { debit, credit, amount } (account ids).
 * The opening clearing nets to zero iff the books balance (assets = liab+equity
 * after the nominal close) — `balanced` surfaces that as an integrity gate, and
 * `clearingResidue` reports the clearing account's own pre-close balance (the
 * usual culprit when the books don't balance) for a clearer operator message.
 *
 * Sums accumulate RAW and round once per account net, so the result is robust to
 * sub-rappen inputs (doesn't depend on every caller pre-rounding amount_chf).
 */
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const EPS = 0.005

export function planYearEndClose(txns, accounts, { equityId, openingId }) {
  const eqId = Number(equityId), opId = Number(openingId)
  const typeById = new Map(accounts.map((a) => [Number(a.id), a.type]))
  const raw = new Map() // id → { dr, cr } accumulated raw
  const bump = (id, k, amt) => { if (id == null) return; const n = Number(id); const e = raw.get(n) || { dr: 0, cr: 0 }; e[k] += amt; raw.set(n, e) }
  for (const t of txns) { const a = Number(t.amount_chf) || 0; bump(t.debit_account, 'dr', a); bump(t.credit_account, 'cr', a) }

  // Per-account net, debit-positive, rounded once.
  const net = new Map()
  for (const [id, e] of raw) net.set(id, round2(e.dr - e.cr))

  // Erfolgsrechnung — income is credit-normal, expense debit-normal.
  let income = 0, expense = 0
  for (const [id, d] of net) {
    const ty = typeById.get(id)
    if (ty === 'income') income = round2(income - d)   // balance = cr - dr = -(dr-cr)
    else if (ty === 'expense') expense = round2(expense + d)
  }
  const result = round2(income - expense)

  // Abschluss — zero each nominal account into equity. Closing any nominal account
  // with net d moves +d onto the equity account's net in both directions, so the
  // equity carry-forward below sees the result.
  const finalNet = new Map()
  for (const [id, d] of net) { const ty = typeById.get(id); if (ty === 'asset' || ty === 'liability' || ty === 'equity') finalNet.set(id, d) }
  if (!finalNet.has(eqId)) finalNet.set(eqId, 0)
  const closing = []
  for (const [id, d] of net) {
    const ty = typeById.get(id)
    if (ty !== 'income' && ty !== 'expense') continue
    if (Math.abs(d) < EPS) continue
    if (d > 0) closing.push({ debit: eqId, credit: id, amount: round2(d) })       // net debit (expense)
    else closing.push({ debit: id, credit: eqId, amount: round2(-d) })            // net credit (income)
    finalNet.set(eqId, round2((finalNet.get(eqId) || 0) + d))
  }

  // Eröffnung — carry each real account's closing balance into the next year via
  // the opening clearing. The clearing itself isn't carried (it would be a self-leg);
  // on a balanced book its own net is 0, and any residue equals clearingNet.
  const opening = []
  let clearingNet = 0
  for (const [id, d] of finalNet) {
    if (id === opId) continue
    if (Math.abs(d) < EPS) continue
    if (d > 0) { opening.push({ debit: id, credit: opId, amount: round2(d) }); clearingNet = round2(clearingNet - d) }
    else { opening.push({ debit: opId, credit: id, amount: round2(-d) }); clearingNet = round2(clearingNet - d) }
  }
  const clearingResidue = round2(net.get(opId) || 0)

  return { income, expense, net: result, closing, opening, clearingNet, clearingResidue, balanced: Math.abs(clearingNet) < EPS }
}
