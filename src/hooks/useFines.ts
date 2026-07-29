import { useMemo } from 'react'
import { useCollection } from '../lib/query'
import { getCurrentSeason } from '../utils/dateHelpers'
import type { Fine, FineCategory, FineResetWindow, FineRule, FineRuleTier } from '../types'

// ── Reads ────────────────────────────────────────────────────────────

const FINE_FIELDS = [
  'id', 'member', 'team', 'category', 'amount', 'currency', 'status',
  'activity_type', 'activity_id', 'activity_date',
  'tier_offense', 'reset_window_at_issue',
  'reason', 'issued_by', 'issued_at',
  'paid_at', 'paid_method', 'paid_to', 'paid_received_by',
  'waived_at', 'waived_by', 'waived_reason',
  'auto_issued', 'notes',
] as const

interface UseFinesOptions {
  filter?: Record<string, unknown>
  sort?: string | string[]
  enabled?: boolean
  /** Optional override of the default field set (e.g. lighter for dashboards). */
  fields?: string[]
}

/** List fines. By default sorted newest-first. Use `filter` for status / team / member scoping. */
export function useFines(options: UseFinesOptions = {}) {
  const { filter, sort = '-issued_at', enabled = true, fields } = options
  return useCollection<Fine>('fines', {
    filter,
    sort,
    fields: fields ?? Array.from(FINE_FIELDS),
    enabled,
    all: true,
  })
}

const FINE_RULE_FIELDS = ['id', 'team', 'category', 'enabled', 'reset_window', 'tiers', 'currency'] as const

/** Fine rules for a team (or all teams the user can see, if teamId omitted). */
export function useFineRules(teamId?: string | number, options: { enabled?: boolean } = {}) {
  const { enabled = true } = options
  const filter = teamId != null ? { team: { _eq: teamId } } : undefined
  return useCollection<FineRule>('fine_rules', {
    filter,
    sort: 'category',
    fields: Array.from(FINE_RULE_FIELDS),
    enabled,
    all: true,
  })
}

// ── Local escalation engine (mirrors kscw_compute_fine_amount in PG) ──

/** Start of the offense-counter window for a given reset_window enum. */
export function fineWindowStart(window: FineResetWindow, now: Date = new Date()): Date {
  switch (window) {
    case 'calendar_month': {
      // First-of-month in Zurich wall clock. Use UTC subtraction approximation —
      // member fines are issued throughout the day and the engine is permissive
      // (>= boundary). Per-second boundary precision isn't needed.
      return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0)
    }
    case 'rolling_30d':
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    case 'rolling_90d':
      return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
    case 'season': {
      // The counter resets on the **Jun 1 season rollover**, not the Sep 1
      // fixture start — this mirrors kscw_fine_window_start in Postgres
      // (migration 268), which is the authority when a fine is actually
      // written. Anchoring on Sep 1 (getSeasonDateRange().start) puts the
      // window start in the FUTURE from Jun 1 to Aug 31, so every offense
      // issued over the summer sorts before it and is never counted.
      // Local midnight, for the same permissive-boundary reason as
      // calendar_month.
      const startYear = Number(getCurrentSeason().split('/')[0])
      return new Date(startYear, 5, 1, 0, 0, 0) // month 5 = June
    }
    case 'never':
      return new Date(0)
  }
}

interface ComputeFineAmountResult {
  amount: number
  tier_offense: number
  reset_window_at_issue: FineResetWindow
}

/** Pick the right tier amount given the rule and the resolved offense number. */
function pickTierAmount(tiers: FineRuleTier[], offenseNo: number): number | null {
  // 1. Exact match
  const exact = tiers.find((t) => t.offense === offenseNo)
  if (exact != null) return exact.amount

  // 2. Highest offense_min <= offenseNo
  const ranged = tiers
    .filter((t) => t.offense_min != null && t.offense_min <= offenseNo)
    .sort((a, b) => (b.offense_min ?? 0) - (a.offense_min ?? 0))[0]
  if (ranged) return ranged.amount

  // 3. Fallback — last tier
  return tiers[tiers.length - 1]?.amount ?? null
}

/**
 * Compute what amount + tier_offense the engine would assign for a hypothetical
 * fine NOW. Mirrors `kscw_compute_fine_amount` in migration 069 so the leader
 * sees the same number the backend will snapshot.
 *
 * Inputs are arrays the caller already has (fine rules of the team, prior
 * non-waived fines for this member+team+category) — keeps the engine pure and
 * easy to memoize from a single useFines() + useFineRules() pair.
 */
export function computeFineAmount(
  rules: FineRule[],
  priorFines: Fine[],
  memberId: string | number,
  teamId: string | number,
  category: FineCategory,
  now: Date = new Date(),
): ComputeFineAmountResult | null {
  const rule = rules.find((r) =>
    String(r.team) === String(teamId) && r.category === category && r.enabled,
  )
  if (!rule || !rule.tiers?.length) return null

  const windowStart = fineWindowStart(rule.reset_window, now)
  const priorCount = priorFines.filter((f) =>
    String(f.member) === String(memberId)
    && String(f.team) === String(teamId)
    && f.category === category
    && f.status !== 'waived'
    && new Date(f.issued_at) >= windowStart,
  ).length

  const offenseNo = priorCount + 1
  const amount = pickTierAmount(rule.tiers, offenseNo)
  if (amount == null) return null

  return {
    amount,
    tier_offense: offenseNo,
    reset_window_at_issue: rule.reset_window,
  }
}

interface UseFineQuoteOptions {
  enabled?: boolean
}

/**
 * Live engine quote: fetches the team's rules + the member's prior fines and
 * runs the local engine. Returns `{ data: null, isLoading: true }` while loading,
 * then `{ data: ComputeFineAmountResult | null }`. `null` means no rule
 * configured — caller should fall back to manual amount entry.
 */
export function useFineQuote(
  memberId: string | number | null | undefined,
  teamId: string | number | null | undefined,
  category: FineCategory | null | undefined,
  options: UseFineQuoteOptions = {},
) {
  const { enabled = true } = options
  const ready = enabled && memberId != null && teamId != null && category != null
  const rules = useFineRules(teamId ?? undefined, { enabled: ready })
  const priors = useFines({
    filter: ready
      ? { member: { _eq: memberId }, team: { _eq: teamId }, category: { _eq: category } }
      : undefined,
    enabled: ready,
  })

  const result = useMemo<ComputeFineAmountResult | null>(() => {
    if (!ready) return null
    if (!rules.data || !priors.data) return null
    return computeFineAmount(rules.data, priors.data, memberId!, teamId!, category!)
  }, [ready, rules.data, priors.data, memberId, teamId, category])

  return {
    data: result,
    isLoading: ready && (rules.isLoading || priors.isLoading),
    error: rules.error ?? priors.error ?? null,
    rule: rules.data?.find((r) => String(r.team) === String(teamId) && r.category === category) ?? null,
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Format a Fine amount as "CHF X.XX" (Swiss notation). */
export function formatFineAmount(amount: number, currency = 'CHF'): string {
  const n = Number(amount)
  if (!Number.isFinite(n)) return `${currency} ?`
  return `${currency} ${n.toFixed(2)}`
}
