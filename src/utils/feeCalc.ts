/**
 * Client-side arithmetic for a live Mitgliederbeitrag preview, shared by the
 * member Data Explorer (`GET /finance/members/:id/fee`) and the registration
 * review screen (`GET /registration/:id/fee`) — both endpoints return the same
 * shape (see either route for the exact server rules).
 *
 * ⚠ This is arithmetic, NOT a second fee engine. Every decision — which base
 * applies, whether the surcharge is owed, whether the subject is a guest —
 * was made server-side by feeBreakdown() (kscw-endpoints/clubdesk-update.js)
 * and arrives in `fee.derived`. All that happens here is "the operator typed
 * a discount into the box, so show the sum with it in it" instead of waiting
 * for a save + round-trip to find out. Extracted from ExplorerMemberFields.tsx
 * so both callers share one implementation.
 */

export interface FeeParts {
  base: number
  surcharge: number
  guest_discount: number
  amount: number
}

export interface FeePreview {
  category: string | null
  is_guest: boolean
  base_source: 'schedule' | 'category_map' | null
  /** What the surcharge boolean is worth in CHF. Served, never hardcoded here. */
  surcharge_amount: number
  /** Federation licence contained IN the base (migration 323) — omitted by the
   *  registration endpoint, which has no invoice line to itemise it against. */
  licence?: number
  fiscal_year?: { id: number; label: string } | null
  sektion?: string | null
  derived: FeeParts | null
  effective: (FeeParts & { discount: number }) | null
}

/** A CHF cell: null/'' → null, so a blank override is "derive it", not zero. */
export function chfOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export const chf = (n: number) =>
  `CHF ${n.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * The live total, recomputed from what is currently in the draft.
 *
 * The discount cap mirrors withDiscount(): a discount may take a bill to
 * exactly zero, never below.
 */
export function liveFee(fee: FeePreview | null, draft: Record<string, unknown>) {
  if (!fee?.derived) return null
  const round2 = (n: number) => Math.round(n * 100) / 100
  const base = chfOrNull(draft.fee_base_override) ?? fee.derived.base
  // Nullable boolean since migration 300: on/off/derive. `=== true|false` on
  // purpose — undefined must not read as "waive".
  const surchargeFlag = draft.fee_surcharge_override
  const surcharge = surchargeFlag === true ? fee.surcharge_amount
    : surchargeFlag === false ? 0
    : fee.derived.surcharge
  const guestDiscount = fee.derived.guest_discount
  const owed = Math.max(0, round2(base + surcharge - guestDiscount))
  // CHF or percent, never both — the DB CHECK enforces it, and CHF wins here so
  // a row that somehow holds both still renders a number rather than NaN.
  const pct = chfOrNull(draft.fee_discount_pct)
  const flat = chfOrNull(draft.fee_discount)
  const wanted = flat !== null && flat > 0 ? round2(flat)
    : pct !== null && pct > 0 ? round2(owed * Math.min(pct, 100) / 100)
    : 0
  const discount = Math.min(Math.max(0, wanted), owed)
  // The federation's share of the base, shown beside it rather than added to it.
  // Zeroed the moment a base override is pinned or a guest reduction applies —
  // same rule the dues run applies, because nobody recorded what a hand-typed
  // amount is made of. Registration previews carry no `licence` at all, so this
  // is always 0 there (`fee.licence ?? 0`).
  const licence = chfOrNull(draft.fee_base_override) !== null || guestDiscount > 0
    ? 0 : Math.min(fee.licence ?? 0, base)
  return {
    base,
    licence,
    surcharge,
    guestDiscount,
    discount,
    discountPct: flat !== null && flat > 0 ? null : (pct !== null && pct > 0 ? pct : null),
    amount: round2(owed - discount),
    baseOverridden: chfOrNull(draft.fee_base_override) !== null,
    surchargeOverridden: surchargeFlag === true || surchargeFlag === false,
  }
}

export type LiveFee = ReturnType<typeof liveFee>
