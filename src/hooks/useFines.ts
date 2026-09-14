import { useMemo } from 'react'
import { useCollection } from '../lib/query'
import { seasonRolloverDate } from '../utils/season'
import type { Fine, FineActivityType, FineCategory, FineResetWindow, FineRule, FineRuleTier } from '../types'

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

const FINE_RULE_FIELDS = ['id', 'team', 'category', 'activity_type', 'enabled', 'reset_window', 'tiers', 'currency'] as const

/** Fine rules for a team (or all teams the user can see, if teamId omitted). */
export function useFineRules(teamId?: string | number, options: { enabled?: boolean } = {}) {
  const { enabled = true } = options
  const filter = teamId != null ? { team: { _eq: teamId } } : undefined
  return useCollection<FineRule>('fine_rules', {
    filter,
    sort: ['category', 'activity_type'],
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
      const [y, m, d] = seasonRolloverDate(now).split('-').map(Number)
      return new Date(y, m - 1, d, 0, 0, 0)
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
 * The rule the engine applies to a fine of this category and activity type:
 * the team's ENABLED override for that type when there is one, else the
 * enabled general rule (`activity_type` null). A disabled override is no
 * override. Mirrors step 1 of `kscw_compute_fine_amount` (migration 361).
 */
export function pickFineRule(
  rules: FineRule[],
  teamId: string | number,
  category: FineCategory,
  activityType: FineActivityType | null | undefined,
): FineRule | null {
  const mine = rules.filter((r) => String(r.team) === String(teamId) && r.category === category && r.enabled)
  return (activityType && mine.find((r) => r.activity_type === activityType))
    || mine.find((r) => r.activity_type == null)
    || null
}

/**
 * Compute what amount + tier_offense the engine would assign for a hypothetical
 * fine NOW. Mirrors `kscw_compute_fine_amount` in migration 069 (+ the
 * per-activity-type rules of 361) so the leader sees the same number the
 * backend will snapshot.
 *
 * Inputs are arrays the caller already has (fine rules of the team, prior
 * non-waived fines for this member+team+category) — keeps the engine pure and
 * easy to memoize from a single useFines() + useFineRules() pair.
 *
 * Counters are per RULE: an override counts only fines of its own activity
 * type; the general rule counts only fines no enabled override claims. So the
 * first late game is "offense #1" on the Games ladder whatever the member's
 * training history.
 */
export function computeFineAmount(
  rules: FineRule[],
  priorFines: Fine[],
  memberId: string | number,
  teamId: string | number,
  category: FineCategory,
  now: Date = new Date(),
  activityType: FineActivityType | null = null,
): ComputeFineAmountResult | null {
  const rule = pickFineRule(rules, teamId, category, activityType)
  if (!rule || !rule.tiers?.length) return null

  const overriddenTypes = new Set(
    rules
      .filter((r) => String(r.team) === String(teamId) && r.category === category && r.enabled && r.activity_type != null)
      .map((r) => r.activity_type),
  )
  const inScope = (f: Fine) => rule.activity_type != null
    ? f.activity_type === rule.activity_type
    : (f.activity_type == null || !overriddenTypes.has(f.activity_type))

  const windowStart = fineWindowStart(rule.reset_window, now)
  const priorCount = priorFines.filter((f) =>
    String(f.member) === String(memberId)
    && String(f.team) === String(teamId)
    && f.category === category
    && f.status !== 'waived'
    && new Date(f.issued_at) >= windowStart
    && inScope(f),
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
  /** Activity the fine is for — selects the per-type override, if any. */
  activityType?: FineActivityType | null
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
  const { enabled = true, activityType = null } = options
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
    return computeFineAmount(rules.data, priors.data, memberId!, teamId!, category!, new Date(), activityType)
  }, [ready, rules.data, priors.data, memberId, teamId, category, activityType])

  return {
    data: result,
    isLoading: ready && (rules.isLoading || priors.isLoading),
    error: rules.error ?? priors.error ?? null,
    rule: ready && rules.data ? pickFineRule(rules.data, teamId!, category!, activityType) : null,
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Format a Fine amount as "CHF X.XX" (Swiss notation). */
export function formatFineAmount(amount: number, currency = 'CHF'): string {
  const n = Number(amount)
  if (!Number.isFinite(n)) return `${currency} ?`
  return `${currency} ${n.toFixed(2)}`
}
