/**
 * Team finance totals — ONE definition, shared by the treasurer's
 * /finance/teams-summary (per team) and the team's own /finance/team/:id page,
 * so the two can never disagree about what a team's `net` is.
 *
 * Inputs are raw rows straight from knex (numeric columns arrive as strings —
 * every figure goes through `Number(x) || 0`):
 *   entries          finance_team_entries rows  { kind, amount }
 *   invoices         finance_invoices rows       { status, amount, open_amount }
 *   refereeExpenses  referee_expenses rows       { amount }
 *   teamFinesOpen    Σ open team-level fines (already summed by the caller)
 *
 * Rules:
 *   income   = sponsoring + income entries
 *   expense  = expense entries only
 *   net      = income − expense
 *   invoice_total / invoice_open  over every invoice that is not cancelled
 *   referee_total  = Σ referee fee amounts — club-reimbursed money that passes
 *                    THROUGH the team and is deliberately NOT part of `net`.
 *                    The Teamkasse never carries referee fees; the season-end
 *                    payout run settles them from the club account.
 *   team_fines_open  passed through, rounded.
 *
 * Pure: no I/O, no dates, unit-tested in __tests__/finance-team-summary.test.js.
 */

const num = (x) => Number(x) || 0
const round2 = (n) => Math.round(num(n) * 100) / 100

/**
 * @param {object} p
 * @param {Array<{kind?: string, amount?: unknown}>} [p.entries]
 * @param {Array<{status?: string|null, amount?: unknown, open_amount?: unknown}>} [p.invoices]
 * @param {Array<{amount?: unknown}>} [p.refereeExpenses]
 * @param {unknown} [p.teamFinesOpen]
 * @returns {{ income: number, expense: number, net: number, invoice_total: number, invoice_open: number, referee_total: number, team_fines_open: number }}
 */
export function teamTotals({ entries = [], invoices = [], refereeExpenses = [], teamFinesOpen = 0 } = {}) {
  let income = 0
  let expense = 0
  for (const e of entries || []) {
    const a = num(e?.amount)
    if (e?.kind === 'expense') expense += a
    else income += a
  }
  let invoiceTotal = 0
  let invoiceOpen = 0
  for (const i of invoices || []) {
    if (i?.status === 'cancelled') continue
    invoiceTotal += num(i?.amount)
    invoiceOpen += num(i?.open_amount)
  }
  let refereeTotal = 0
  for (const r of refereeExpenses || []) refereeTotal += num(r?.amount)

  return {
    income: round2(income),
    expense: round2(expense),
    net: round2(income - expense),
    invoice_total: round2(invoiceTotal),
    invoice_open: round2(invoiceOpen),
    referee_total: round2(refereeTotal),
    team_fines_open: round2(teamFinesOpen),
  }
}
