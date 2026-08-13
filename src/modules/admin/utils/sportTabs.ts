// src/modules/admin/utils/sportTabs.ts
//
// Which tab a finding belongs under on the merged Data Health page.
//
// ⚠ 'both' and 'unassigned' are DIFFERENT and must never be collapsed. The
// server-side resolver (member-sport.js) answers 'both' for a member on a VB *and*
// a BB team AND for a member whose section simply cannot be derived — a passive
// member with no roster row and no VB/BB fee prefix. Permission gates are right to
// treat those alike (permissive), but a worklist that files the unresolvable ones
// under "plays both sports" hides them: nobody scanning the Volleyball tab is
// looking for a member who has no sport at all. Hence `sport_source: 'unknown'`
// travels next to `sport`, and lands in its own tab.

import type { LastBill } from './clubdeskFindings'

export const SPORT_TABS = ['all', 'volleyball', 'basketball', 'unassigned', 'club'] as const
export type SportTab = typeof SPORT_TABS[number]

/** A member's section as the merged page buckets it. */
export type SportBucket = 'volleyball' | 'basketball' | 'both' | 'unassigned'

/** What /clubdesk-member-facets returns, keyed by String(member_id). */
export interface MemberFacets {
  bills: Record<string, LastBill>
  sports: Record<string, { sport: 'volleyball' | 'basketball' | 'both'; source: 'teams' | 'sektion' | 'fee' | 'unknown' }>
}

export const EMPTY_FACETS: MemberFacets = { bills: {}, sports: {} }

/**
 * Resolve a finding's bucket.
 *
 * `rowSport` is the comma-joined `teams.sport` list the group-check SQL already
 * derives per row ('volleyball', 'basketball', 'volleyball, basketball', or ''),
 * and it is preferred because it describes THIS finding — a member who coaches BB
 * and plays VB has a VB roster finding and a BB coach finding, and each belongs in
 * its own tab. The club-wide facets map is the fallback for findings that carry no
 * sport of their own (drift, departed, unlinked).
 */
export function bucketOf(
  rowSport: string | null | undefined,
  memberId: number | string | null | undefined,
  facets: MemberFacets,
): SportBucket {
  const tokens = String(rowSport || '').split(', ').map((s) => s.trim()).filter(Boolean)
  if (tokens.length > 1) return 'both'
  if (tokens[0] === 'volleyball' || tokens[0] === 'basketball') return tokens[0]

  const f = memberId === null || memberId === undefined
    ? undefined
    : facets.sports[String(memberId)]
  if (!f || f.source === 'unknown') return 'unassigned'
  return f.sport
}

/** Does a bucket show under the given tab? 'both' shows under BOTH sport tabs. */
export function inTab(bucket: SportBucket, tab: SportTab): boolean {
  if (tab === 'all') return true
  if (tab === 'club') return false
  if (tab === 'unassigned') return bucket === 'unassigned'
  return bucket === tab || bucket === 'both'
}

/** Filter helper for a row list whose rows carry `sport` and `member_id`. */
export function filterBySport<T extends { sport?: string; member_id?: number }>(
  rows: T[],
  tab: SportTab,
  facets: MemberFacets,
): T[] {
  if (tab === 'all') return rows
  return rows.filter((r) => inTab(bucketOf(r.sport, r.member_id, facets), tab))
}
