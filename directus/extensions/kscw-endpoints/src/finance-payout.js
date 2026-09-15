/**
 * Payout plumbing shared by every "the club owes a member money" flow.
 *
 * Extracted from expense-upload.js (the PATCH → 'paid' auto-payout) so the
 * season-end referee reimbursement run (finance.js → POST
 * /finance/referee-payout-run) resolves the payee and mints the
 * finance_payouts row through the SAME code — one IBAN precedence, one
 * address rule, one skip vocabulary. expense-upload.js imports from here and
 * behaves exactly as before.
 *
 *   isValidIban / cleanIban / isChLiIban   — ISO 13616 + the CH/LI-only rule
 *                                             the QR-bill needs
 *   PAYOUT_SKIP                             — machine skip codes; the frontend
 *                                             maps them to prose per locale
 *   resolvePayee(member, preferredIban)     — pure: which IBAN + creditor
 *                                             address a payout goes to
 *   insertPayout(trx, …)                    — the finance_payouts insert
 *   planRefereePayouts(rows)                — pure: group referee fee rows per
 *                                             paying member + skip decisions
 */

/** ISO 13616 mod-97 IBAN check (server-side mirror of src/utils/iban.ts). */
export function isValidIban(raw) {
  const iban = String(raw || '').replace(/\s+/g, '').toUpperCase()
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban)) return false
  const rearranged = iban.slice(4) + iban.slice(0, 4)
  let remainder = 0
  for (const ch of rearranged) {
    const val = ch >= 'A' ? String(ch.charCodeAt(0) - 55) : ch
    for (const d of val) remainder = (remainder * 10 + Number(d)) % 97
  }
  return remainder === 1
}

export const cleanIban = (s) => String(s || '').replace(/\s+/g, '').toUpperCase()
export const isChLiIban = (i) => /^(CH|LI)/.test(i) && isValidIban(i)

// Per-locale mapping of a machine payout-skip reason to member-facing prose is
// on the FRONTEND (expensePayoutSkipped_*). Endpoints return only the CODE.
export const PAYOUT_SKIP = {
  NON_CHF: 'NON_CHF',
  NO_IBAN: 'NO_IBAN',
  ADDRESS_INCOMPLETE: 'ADDRESS_INCOMPLETE',
  FAILED: 'FAILED',
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

/**
 * Where a payout to this member goes — IBAN and the creditor address the
 * QR-bill snapshot needs. Precedence, unchanged from the expense flow:
 *
 *   1. `preferredIban` (what the member asked to be paid on), when CH/LI-valid
 *      — the PROFILE address rides with it
 *   2. billing_iban when `billing_different` is set and that IBAN is CH/LI-valid
 *      — the BILLING name + address ride with it (name falls back to the
 *      member's own when billing_name is blank)
 *   3. members.iban when CH/LI-valid — profile address
 *
 * `skip` is null when payable, else NO_IBAN (no usable IBAN at any level) or
 * ADDRESS_INCOMPLETE (IBAN found but name / zip / city missing — the QR-bill
 * creditor block cannot be rendered).
 *
 * @param {object} payee members row: first_name, last_name, iban, adresse, plz,
 *   ort, billing_different, billing_iban, billing_name, billing_address,
 *   billing_plz, billing_ort
 * @param {string|null} [preferredIban]
 * @returns {{ iban: string|null, name: string, street: string|null, zip: string|null, city: string|null, skip: string|null }}
 */
export function resolvePayee(payee, preferredIban = null) {
  const p = payee || {}
  const memberName = [p.first_name, p.last_name].filter(Boolean).join(' ').trim()
  const useBilling = !!p.billing_different && isChLiIban(cleanIban(p.billing_iban))
  let iban = null
  let name = memberName
  let street = p.adresse
  let zip = p.plz
  let city = p.ort
  const preferred = cleanIban(preferredIban)
  if (isChLiIban(preferred)) {
    iban = preferred
  } else if (useBilling) {
    iban = cleanIban(p.billing_iban)
    name = (p.billing_name || '').trim() || memberName
    street = p.billing_address
    zip = p.billing_plz
    city = p.billing_ort
  } else if (isChLiIban(cleanIban(p.iban))) {
    iban = cleanIban(p.iban)
  }
  let skip = null
  if (!iban) skip = PAYOUT_SKIP.NO_IBAN
  else if (!name || !zip || !city) skip = PAYOUT_SKIP.ADDRESS_INCOMPLETE
  return { iban, name, street: street || null, zip: zip || null, city: city || null, skip }
}

/**
 * Insert one finance_payouts row (the QR-bill snapshot, migration 137) and
 * return its id. Runs on the caller's transaction so the link back to the
 * source rows commits with it.
 *
 * `status` defaults to 'paid': both callers record a transfer the treasurer
 * has already made (or is making in the same sitting), not a request.
 *
 * @param {import('knex').Knex.Transaction} trx
 * @param {object} p
 * @param {number} p.member
 * @param {number|string} p.amount
 * @param {string} p.message ≤140 chars (caller slices)
 * @param {{ iban: string, name: string, street?: string|null, zip?: string|null, city?: string|null }} p.payee
 * @param {{ name?: string|null, email?: string|null, user?: string|null }} p.createdBy
 * @param {'open'|'paid'|'cancelled'} [p.status]
 * @returns {Promise<number>} payout id
 */
export async function insertPayout(trx, { member, amount, message, payee, createdBy = {}, status = 'paid' }) {
  const [ins] = await trx('finance_payouts')
    .insert({
      member,
      amount: Number(amount),
      currency: 'CHF',
      message,
      iban: payee.iban,
      payee_name: payee.name,
      payee_address: payee.street || null,
      payee_zip: payee.zip || null,
      payee_ort: payee.city || null,
      status,
      created_by_name: createdBy.name || null,
      created_by_email: createdBy.email || null,
      user_created: createdBy.user || null,
    })
    .returning('id')
  return typeof ins === 'object' && ins !== null ? ins.id : ins
}

/**
 * Group unpaid referee fee rows per paying member and decide, per member,
 * whether a payout can be minted. Pure — the route feeds it the locked
 * candidate rows and writes what comes back.
 *
 * Each input row is one referee_expenses row joined to its payer:
 *   { expense_id, amount, currency, member, first_name, last_name, iban,
 *     adresse, plz, ort, billing_* }
 *
 * Skip precedence: NON_CHF (any of the member's fees is in another currency —
 * the QR-bill is CHF-only and a mixed sum would be meaningless) beats the
 * payee-resolution skips (NO_IBAN, ADDRESS_INCOMPLETE).
 *
 * Returns one row per member, sorted by name, in the RefereePayoutPlanRow
 * shape plus a `payee` block the route needs for the insert (and strips from
 * the response).
 */
export function planRefereePayouts(rows) {
  const byMember = new Map()
  for (const r of rows || []) {
    const mid = r?.member == null ? NaN : Number(r.member)
    if (!Number.isInteger(mid)) continue
    if (!byMember.has(mid)) byMember.set(mid, { member: mid, payee: r, expenses: [] })
    byMember.get(mid).expenses.push(r)
  }
  const plan = []
  for (const g of byMember.values()) {
    const resolved = resolvePayee(g.payee)
    const nonChf = g.expenses.some((e) => String(e.currency || 'CHF').toUpperCase() !== 'CHF')
    const total = round2(g.expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0))
    plan.push({
      member: g.member,
      member_name: [g.payee.first_name, g.payee.last_name].filter(Boolean).join(' ').trim(),
      games: g.expenses.length,
      total,
      iban: resolved.iban,
      skip: nonChf ? PAYOUT_SKIP.NON_CHF : resolved.skip,
      expense_ids: g.expenses.map((e) => Number(e.expense_id)),
      payee: resolved,
      // Sort key only (last name first, the way a treasurer reads a list);
      // stripped below so the row is exactly the response shape + `payee`.
      _sort: `${g.payee.last_name || ''} ${g.payee.first_name || ''}`.trim().toLowerCase(),
    })
  }
  plan.sort((a, b) => a._sort.localeCompare(b._sort, 'de-CH') || a.member - b.member)
  for (const p of plan) delete p._sort
  return plan
}
