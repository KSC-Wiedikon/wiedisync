/**
 * What the home team owes the referees under the regional rules (SVRZ GBO
 * Art. 20, the svrz_rc summary in server/gboSummary.ts), and the arithmetic of
 * sharing that amount between the people who paid it. Pure, no React.
 */

/** "Reisespesen pauschal, pro Tag und SR". */
export const GBO_TRAVEL_CHF = 20

/** The prefill assumes a pair of referees (owner, 07.11.2026). The amount stays editable. */
export const GBO_REFEREES = 2

export interface GboRefereeFee {
  referees: number
  feePerReferee: number
  travelPerReferee: number
  total: number
}

/**
 * The fee per referee for a `games.league` value ("Frauen 3. Liga Gruppe A",
 * "Männer U23 1. Stärkeklasse") or a team's short code ("2L"), without travel.
 *
 * `null` for what the table does not price: 1. Liga and up (Swiss Volley's
 * rules), cup rounds, junior leagues, and a U23 league that names no level
 * ("Männer U23 Gruppe A"), where 40 and 50 are both possible. A wrong prefill
 * reads as a fact, so these stay empty.
 */
export function gboFeePerReferee(league: string | null | undefined): number | null {
  if (!league || /\bcup\b/i.test(league)) return null

  const age = league.match(/\bU\s?(\d{2})\b/i)?.[1]
  if (age && age !== '23') return null

  if (age === '23') {
    const level = league.match(/\b(\d)\.?\s*(?:Liga|L|Stärkeklasse)\b/i)?.[1]
    if (!level) return null
    return level === '1' ? 50 : 40
  }

  const level = Number(league.match(/\b(\d)\.?\s*(?:Liga|L)\b/i)?.[1])
  if (level === 2) return 60
  if (level === 3) return 50
  if (level >= 4) return 40
  return null
}

/** Fee + travel for the whole referee pair, or `null` when the table has no price. */
export function gboRefereeFee(league: string | null | undefined): GboRefereeFee | null {
  const feePerReferee = gboFeePerReferee(league)
  if (feePerReferee == null) return null
  return {
    referees: GBO_REFEREES,
    feePerReferee,
    travelPerReferee: GBO_TRAVEL_CHF,
    total: GBO_REFEREES * (feePerReferee + GBO_TRAVEL_CHF),
  }
}

/**
 * `total` shared between `people` in 5-Rappen steps. The sum is always exactly
 * `total`: the first people carry what does not divide (160 / 3 → 53.35, 53.35, 53.30).
 */
export function splitEvenly(total: number, people: number): number[] {
  if (people < 1) return []
  const cents = Math.round(total * 100)
  const shares: number[] = Array(people).fill(Math.floor(cents / people / 5) * 5)
  let left = cents - shares[0] * people
  for (let i = 0; left > 0; i = (i + 1) % people) {
    const step = Math.min(left, 5)
    shares[i] += step
    left -= step
  }
  return shares.map((c) => c / 100)
}

/** Sum in whole cents, so adding CHF amounts does not drift. */
export function sumChf(amounts: readonly (number | string | null | undefined)[]): number {
  const cents = amounts.reduce<number>((sum, a) => sum + Math.round((Number(a) || 0) * 100), 0)
  return cents / 100
}

/** An amount as the form shows it: empty for 0, `160`, `53.30`. */
export function formatAmountInput(amount: number): string {
  if (!amount) return ''
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2)
}

/** One person's part of the fee: a member, or a free-text name when `member` is null. */
export interface RefereeShare {
  member: string | null
  other: string | null
  amount: number
}

/** The payer columns of a stored `referee_expenses` row. */
export interface RefereeRowRef {
  id: string
  member: string | null
  other: string | null
}

export interface RefereeSavePlan {
  update: { id: string; share: RefereeShare }[]
  create: RefereeShare[]
  remove: string[]
}

const payerKey = (p: { member: string | null; other: string | null }) =>
  p.member ? `m:${p.member}` : `o:${(p.other ?? '').trim().toLowerCase()}`

/**
 * The writes that turn a game's stored rows into `shares`, one row per payer.
 *
 * A payer who stays keeps their row. A row whose payer left is reused for a new
 * payer before anything is created, so changing who paid stays an UPDATE on the
 * same id, and no step can trip the one-row-per-payer index. Only then are rows
 * created or removed.
 */
export function planRefereeExpenseSave(
  rows: readonly RefereeRowRef[],
  shares: readonly RefereeShare[],
): RefereeSavePlan {
  const byPayer = new Map(rows.map((r) => [payerKey(r), r]))
  const update: RefereeSavePlan['update'] = []
  const newPayers: RefereeShare[] = []

  for (const share of shares) {
    const row = byPayer.get(payerKey(share))
    if (row) {
      update.push({ id: row.id, share })
      byPayer.delete(payerKey(share))
    } else {
      newPayers.push(share)
    }
  }

  const free = [...byPayer.values()]
  const create: RefereeShare[] = []
  for (const share of newPayers) {
    const row = free.shift()
    if (row) update.push({ id: row.id, share })
    else create.push(share)
  }

  return { update, create, remove: free.map((r) => r.id) }
}
