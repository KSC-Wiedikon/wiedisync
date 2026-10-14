/**
 * Pure logic of the parallel books (accounting.wiedisync.kscw.ch) — no DB, no I/O,
 * unit-tested in __tests__/finance-books-core.test.js. The routes live in
 * finance-books.js.
 *
 * Booking method: ClubDesk books KSCW's dues CASH-basis — a payment is
 * "1000 Bank / 3300 Aktivmitglieder", an open invoice is not booked (checked
 * 14.10.2026). The native book follows the same method while the two run in
 * parallel, or every month would differ by the open receivables.
 */

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const lower = (s) => String(s ?? '').toLowerCase()
const normIban = (s) => String(s ?? '').replace(/\s+/g, '').toUpperCase()

// ── Bank posting rules ───────────────────────────────────────────────────────

/** Does one rule match one bank line? Every condition the rule sets must hold,
 *  and a rule with no condition never matches (the DB check forbids it too). */
export function ruleMatches(rule, line) {
  if (!rule || rule.active === false) return false
  const dir = Number(line.amount) >= 0 ? 'in' : 'out'
  if (rule.direction && rule.direction !== 'any' && rule.direction !== dir) return false
  let conditions = 0
  if (rule.match_iban) {
    conditions++
    if (normIban(rule.match_iban) !== normIban(line.counterparty_iban)) return false
  }
  if (rule.match_name) {
    conditions++
    if (!lower(line.counterparty_name).includes(lower(rule.match_name).trim())) return false
  }
  if (rule.match_text) {
    conditions++
    const hay = lower(`${line.remittance ?? ''} ${line.reference ?? ''}`)
    if (!hay.includes(lower(rule.match_text).trim())) return false
  }
  return conditions > 0
}

/** The first active rule that matches, by priority (lower first) then id. */
export function firstMatchingRule(rules, line) {
  const sorted = [...rules].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100) || a.id - b.id)
  return sorted.find((r) => ruleMatches(r, line)) || null
}

/** Booking text of a bank posting: the rule's template ({name} {text} {date}), or
 *  counterparty · message. Capped at the column's 250 chars. */
export function bankLineText(line, template) {
  const name = line.counterparty_name || ''
  const text = line.remittance || line.reference || ''
  const date = String(line.booking_date || '').slice(0, 10)
  const out = template
    ? template.replace(/\{name\}/g, name).replace(/\{text\}/g, text).replace(/\{date\}/g, date)
    : [name, text].filter(Boolean).join(' · ')
  return (out.trim() || `Bank ${date}`).slice(0, 250)
}

/**
 * Debit / credit of the journal entry that books one bank line.
 * Money in:  Bank / account.   Money out: account / Bank.
 */
export function bankPostingLegs(line, bankAccountId, accountId) {
  const amount = round2(Math.abs(Number(line.amount)))
  return Number(line.amount) >= 0
    ? { debit: bankAccountId, credit: accountId, amount }
    : { debit: accountId, credit: bankAccountId, amount }
}

/**
 * Proposal for an open bank line. A matched invoice wins over a rule (it names the
 * income account of that member's fee category); a rule wins over nothing.
 *   invoice: { number, subject, recipient_name, fee_category, source } | null
 *   incomeAccountFor(invoice) → account id
 *   arAccountId: Debitoren — used only for a native invoice while auto-posting is on
 *                (that invoice was already booked to Debitoren when issued)
 */
export function proposeForLine(line, { invoice, rules, incomeAccountFor, arAccountId, autopost }) {
  if (invoice && Number(line.amount) > 0) {
    const account = invoice.source === 'native' && autopost && arAccountId ? arAccountId : incomeAccountFor(invoice)
    if (account) {
      const who = invoice.recipient_name ? ` (${invoice.recipient_name})` : ''
      return {
        account,
        text: `${invoice.subject || `Rechnung ${invoice.number}`}${who}`.slice(0, 250),
        by: `invoice:${invoice.number}`.slice(0, 48),
        invoiceNumber: invoice.number,
      }
    }
  }
  const rule = firstMatchingRule(rules, line)
  if (rule) return { account: rule.account, text: bankLineText(line, rule.text_template), by: `rule:${rule.id}`, invoiceNumber: null }
  return null
}

/**
 * The statement proves nothing was dropped: opening + Σ lines = closing.
 * Returns { ok, expected, actual } or { ok: null } when the bank sent no balances.
 */
export function statementBalanceCheck(statement) {
  if (!statement.opening || !statement.closing) return { ok: null }
  const sum = statement.lines.reduce((s, l) => s + Number(l.amount || 0), 0)
  const expected = round2(statement.opening.amount + sum)
  return { ok: Math.abs(expected - statement.closing.amount) < 0.005, expected, actual: statement.closing.amount }
}

// ── Comparing the two books ──────────────────────────────────────────────────

/** Natural-sign balance per account id from journal rows (one leg may be null —
 *  ClubDesk's opening rows carry one side only). */
export function balancesByAccount(rows, typeById) {
  const sums = new Map()
  const bump = (id, key, amt) => {
    if (id == null) return
    const k = Number(id)
    const e = sums.get(k) || { debit: 0, credit: 0 }
    e[key] += amt
    sums.set(k, e)
  }
  for (const r of rows) {
    const amt = Number(r.amount_chf) || 0
    bump(r.debit_account, 'debit', amt)
    bump(r.credit_account, 'credit', amt)
  }
  const out = new Map()
  for (const [id, s] of sums) {
    const t = typeById.get(id)
    out.set(id, round2(t === 'asset' || t === 'expense' ? s.debit - s.credit : s.credit - s.debit))
  }
  return out
}

const isoOf = (d) => (d ? (typeof d === 'string' ? d.slice(0, 10) : new Date(d).toISOString().slice(0, 10)) : '')

/**
 * Per-account comparison of the ClubDesk mirror and the native book, everything
 * booked up to and including `throughISO`. Only accounts that are non-zero in
 * either book come back. diff = native − ClubDesk.
 *
 * `ignore` = account ids only one book can have — the native opening clearing
 * account (ClubDesk books its opening one-sided, without a counter-account).
 */
export function compareBooks({ clubdesk, native, accounts, throughISO, ignore = [] }) {
  const typeById = new Map(accounts.map((a) => [Number(a.id), a.type]))
  const byId = new Map(accounts.map((a) => [Number(a.id), a]))
  const upTo = (rows) => rows.filter((r) => !throughISO || isoOf(r.booking_date) <= throughISO)
  const cd = balancesByAccount(upTo(clubdesk), typeById)
  const nv = balancesByAccount(upTo(native), typeById)
  const skip = new Set(ignore.map(Number))
  const ids = new Set([...cd.keys(), ...nv.keys()])
  const rows = []
  for (const id of ids) {
    if (skip.has(id)) continue
    const c = cd.get(id) ?? 0
    const n = nv.get(id) ?? 0
    if (Math.abs(c) < 0.005 && Math.abs(n) < 0.005) continue
    const a = byId.get(id) || {}
    rows.push({ account: id, number: a.number ?? '?', name: a.name ?? '', type: a.type ?? null, clubdesk: c, native: n, diff: round2(n - c) })
  }
  rows.sort((x, y) => String(x.number).localeCompare(String(y.number)))
  const different = rows.filter((r) => Math.abs(r.diff) >= 0.005)
  return {
    rows,
    accountsCompared: rows.length,
    accountsDifferent: different.length,
    differenceTotal: round2(different.reduce((s, r) => s + Math.abs(r.diff), 0)),
  }
}

/** Last calendar day of the month of an ISO date. */
export function monthEnd(iso) {
  const [y, m] = iso.slice(0, 7).split('-').map(Number)
  const d = new Date(Date.UTC(y, m, 0))
  return d.toISOString().slice(0, 10)
}

/** 'YYYY-MM' of every month from the fiscal year's start through `untilISO`
 *  (clamped to the year's end). */
export function monthsOfYear(startsOn, endsOn, untilISO) {
  const end = untilISO && untilISO < endsOn ? untilISO : endsOn
  const out = []
  let [y, m] = startsOn.slice(0, 7).split('-').map(Number)
  for (;;) {
    const key = `${y}-${String(m).padStart(2, '0')}`
    if (`${key}-01` > end) break
    out.push(key)
    m++
    if (m > 12) { m = 1; y++ }
  }
  return out
}

/** One comparison per month end — the parallel-run table. */
export function monthlyComparison({ clubdesk, native, accounts, startsOn, endsOn, untilISO, ignore = [] }) {
  return monthsOfYear(startsOn, endsOn, untilISO).map((month) => {
    const through = monthEnd(`${month}-01`)
    const c = compareBooks({ clubdesk, native, accounts, throughISO: through, ignore })
    return { month, through, accountsCompared: c.accountsCompared, accountsDifferent: c.accountsDifferent, differenceTotal: c.differenceTotal }
  })
}

// ── Opening balance ──────────────────────────────────────────────────────────

/**
 * Opening legs from ClubDesk's own Eröffnung bookings of the year: each row books
 * one side of one account (no counter-leg). Aggregated per account and side.
 * Returns { legs: [{ account, side, amount }], debit, credit, balanced }.
 */
export function openingLegsFromClubdesk(rows) {
  const agg = new Map()
  for (const r of rows) {
    const amt = round2(r.amount_chf)
    if (!(amt > 0)) continue
    if (r.debit_account != null) {
      const k = `${r.debit_account}:debit`
      agg.set(k, round2((agg.get(k) || 0) + amt))
    }
    if (r.credit_account != null) {
      const k = `${r.credit_account}:credit`
      agg.set(k, round2((agg.get(k) || 0) + amt))
    }
  }
  const legs = [...agg.entries()].map(([k, amount]) => {
    const [account, side] = k.split(':')
    return { account: Number(account), side, amount }
  }).sort((a, b) => a.account - b.account || a.side.localeCompare(b.side))
  const debit = round2(legs.filter((l) => l.side === 'debit').reduce((s, l) => s + l.amount, 0))
  const credit = round2(legs.filter((l) => l.side === 'credit').reduce((s, l) => s + l.amount, 0))
  return { legs, debit, credit, balanced: Math.abs(debit - credit) < 0.005 }
}

/** Journal entries for opening legs against the opening clearing account: a debit
 *  leg is "account / clearing", a credit leg "clearing / account". */
export function openingEntries(legs, clearingId) {
  return legs.map((l) => (l.side === 'debit'
    ? { debit: l.account, credit: clearingId, amount: l.amount }
    : { debit: clearingId, credit: l.account, amount: l.amount }))
}

// ── Receipts ─────────────────────────────────────────────────────────────────

/** Entries a receipt is NOT expected for: generated by the year-end close
 *  (Eröffnung / Abschluss) or a Storno, whose receipt is its original's. */
export const RECEIPT_EXEMPT_TYPES = ['Eroeffnung', 'Abschluss', 'Storno']
export const needsReceipt = (entry) => !RECEIPT_EXEMPT_TYPES.includes(entry.typ)

// ── Switch readiness ─────────────────────────────────────────────────────────

/**
 * The switch criteria of .planning/bookkeeping-plan.md, evaluated from facts the
 * route gathers. Each check: { key, status: 'pass' | 'fail' | 'pending', detail }.
 * `ready` only when every check passes — the switch itself stays a board decision.
 */
export function evaluateReadiness(f) {
  const checks = []
  const add = (key, ok, detail, pending = false) => checks.push({ key, status: ok ? 'pass' : pending ? 'pending' : 'fail', detail })
  add('mirror', f.mirrorYears >= f.clubdeskYears && f.clubdeskYears > 0 && f.syncHealthy,
    { years: f.mirrorYears, clubdeskYears: f.clubdeskYears, syncHealthy: f.syncHealthy })
  add('opening', f.openingPosted, { fiscalYear: f.parallelStartLabel || null })
  add('bank', f.openBankLines === 0 && f.bankLines > 0, { open: f.openBankLines, total: f.bankLines }, f.bankLines === 0)
  add('signoffs', f.monthsDue > 0 && f.monthsSigned >= f.monthsDue, { signed: f.monthsSigned, due: f.monthsDue }, f.monthsDue === 0)
  add('match', f.monthsDue > 0 && f.lastDifferenceTotal != null && f.lastDifferenceTotal < 0.005, { differenceTotal: f.lastDifferenceTotal }, f.monthsDue === 0)
  add('fullYear', f.closedYearsMatching > 0, { closedYearsMatching: f.closedYearsMatching }, true)
  add('receipts', f.entriesNeedingReceipt > 0 ? f.entriesMissingReceipt === 0 : f.nativeEntries > 0,
    { missing: f.entriesMissingReceipt, needing: f.entriesNeedingReceipt }, f.nativeEntries === 0)
  add('archive', f.archivedOffsite > 0, { archives: f.archives, offsite: f.archivedOffsite }, f.archives === 0)
  add('auditors', f.revisors > 0, { revisors: f.revisors })
  add('treasurer', f.treasurers > 0, { treasurers: f.treasurers })
  return { ready: checks.every((c) => c.status === 'pass'), checks }
}
