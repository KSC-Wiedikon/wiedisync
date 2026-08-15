/**
 * The entitlement figure printed on a FREE member's CHF 0 dues invoice.
 *
 * A member in the 'Gratis' category owes nothing by CATEGORY — there is no rate
 * to bill and no fee to waive — so their invoice used to read a bare
 *
 *     Mitgliederbeitrag 2026/27 · Gratis        0.00
 *
 * which is indistinguishable from a mistake. Since 2026-08-15 (user) the
 * document states what the membership would have cost AND that it was granted:
 *
 *     Mitgliederbeitrag 2026/27               440.00
 *     Erlass — Gratismitgliedschaft          -440.00
 *     ─────────────────────────────────────────────
 *     Total                                     0.00
 *
 * ⚠ The reference is PRESENTATION ONLY and is never billed: the invoice amount
 * stays 0, the status stays 'paid', no QR part is generated, nothing reaches the
 * GL and no email goes out. `feeBreakdown()` remains the club's ONE fee engine —
 * this module answers a different question ("what would a membership like this
 * cost?"), never "what does this member owe?".
 *
 * ⚠ The number is resolved against the SAME rate schedule everybody else is
 * billed from, through the category the member would hold if they paid. Copying
 * the amounts into dedicated 'Gratis' rate rows was the alternative and it goes
 * stale silently — the club moved every basketball rate +10 in July 2026, and a
 * copy would still be printing the old figures. A treasurer who wants a
 * different number sets the 'Gratis' rate row (club-wide, or per sektion) to a
 * non-zero amount; that wins over everything here.
 *
 * ⚠ 'Kein Beitrag' is NOT exempt in this sense. It is the terminal non-member
 * bucket (ehemalige, sponsors, parents — see CD_BEITRAG_MAP), and telling a
 * sponsor what their membership "would have cost" is simply wrong.
 */

/** Pick the CHF dues rate for a member: a sektion-specific row wins over the
 *  category default (sektion NULL). Returns the matching rate row or null. */
export function pickRate(rates, category, sektion) {
  const cat = (category || '').toLowerCase()
  const inCat = (rates || []).filter((r) => r.active && (r.category || '').toLowerCase() === cat)
  return inCat.find((r) => r.sektion && sektion && r.sektion.toLowerCase() === String(sektion).toLowerCase())
      || inCat.find((r) => !r.sektion)
      || null
}

/** Fee categories that ARE the exemption — the member is a member, and the club
 *  decided the membership is free (coaches, staff, granted cases). */
export const EXEMPT_CATEGORIES = new Set(['gratis'])

export function isExemptCategory(category) {
  return EXEMPT_CATEGORIES.has(String(category ?? '').trim().toLowerCase())
}

/**
 * Which rate a free member would have been priced at, by age.
 *
 * ⚠ Not the surcharge gate. `isU16Plus()` answers "does this member owe scorer
 * duty" (birth-year band, U16-and-above); this is a coarser split matching the
 * shape of the club's own category ladder — and it never charges anybody, so an
 * off-by-a-year picks a slightly different reference, not a wrong bill.
 *
 * 'infant' exists because the real data demands it: the club's free basketball
 * children are 1, 4, 4, 4 and 6 years old (prod, 2026-08-15). Printing a
 * CHF 220 "Minis" entitlement on a four-year-old's invoice is noise, so they get
 * no reference at all and the exemption line stands alone.
 *
 * An unknown birthdate reads as 'adult' — the overwhelming majority of free
 * members are adults (86 of 94 on prod), and it is the only band that never
 * needs a birthdate to be right.
 */
export function feeAgeBand(member, refYear = new Date().getFullYear()) {
  const bd = member?.birthdate
  const iso = bd instanceof Date ? bd.toISOString().slice(0, 10) : bd ? String(bd) : ''
  const year = Number(iso.slice(0, 4))
  if (!Number.isInteger(year) || year < 1900) return 'adult'
  const age = refYear - year
  if (age < 10) return 'infant'
  if (age < 16) return 'youth'
  if (age < 20) return 'junior'
  return 'adult'
}

/**
 * (sektion, age band) → the category whose rate stands in as the reference.
 *
 * Deliberately the PLAIN tier of each ladder: the 1. Liga variants (BB 570/470)
 * would need a league the member row does not carry, and guessing high on a
 * document that goes to a member is the one direction that can offend. A sektion
 * outside this map (e.g. 'KSCW' — the club-level bucket that holds the
 * Ehrenmitglieder and has no sport at all) gets no reference: their invoice
 * carries the named exemption line at 0.00.
 */
const REFERENCE_CATEGORY = {
  volleyball: {
    youth: 'VB Schüler*in Meisterschaft',
    junior: 'VB Student*in Meisterschaft',
    adult: 'VB Erwerbstätige',
  },
  basketball: {
    youth: 'BB Jugend Meisterschaft',
    junior: 'BB Lernende/Studierende',
    adult: 'BB Erwerbstätige',
  },
}

/**
 * CHF the free member's membership would have cost, or 0 when the club has no
 * comparable rate (no sport, an infant, or the mapped category has no rate row
 * this season). Never negative, never billed.
 *
 * @param {Array} rates    this fiscal year's finance_dues_rates rows
 * @param {object} member  needs `sektion` + `birthdate`
 */
export function referenceBase(rates, member, refYear = new Date().getFullYear()) {
  // The treasurer's own figure, if they set one: a 'Gratis' rate row with a
  // non-zero amount is read as "this is what a free membership is worth",
  // because for an exempt category the row can never be a bill.
  const pinned = Number(pickRate(rates, 'Gratis', member?.sektion)?.amount_chf)
  if (Number.isFinite(pinned) && pinned > 0) return pinned

  const sport = String(member?.sektion ?? '').trim().toLowerCase()
  const category = REFERENCE_CATEGORY[sport]?.[feeAgeBand(member, refYear)]
  if (!category) return 0
  const amount = Number(pickRate(rates, category, member?.sektion)?.amount_chf)
  return Number.isFinite(amount) && amount > 0 ? amount : 0
}
