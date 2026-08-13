// src/modules/admin/utils/clubdeskFindings.ts
//
// Shapes and helpers shared across the merged Data health page. They live here
// rather than next to the components that render them for two reasons: the page
// and its cards must agree on ONE definition of a finding (the "Fix groups" button
// acts on the same list the table shows), and a component file that also exports
// constants breaks fast refresh.

/** One allocation the ADD scraper would create: Gruppe + Funktion as two combos. */
export interface Allocation { group: string; funktion: string; label: string }

export interface NoGroupRow {
  member_id: number; member_name: string; clubdesk_id: string
  teams: string; kat: string; sport: string; has_team: boolean
}
export interface MissingRow {
  member_id: number; member_name: string; clubdesk_name?: string; clubdesk_id: string
  uuid?: string; groups: string[]; allocations?: Allocation[]; sport: string
}
export interface FeeRow {
  member_id: number; member_name: string; clubdesk_id: string; kat: string; sport: string
  last_season: string | null; coach_of: string; tr_of: string
  severity: 'never' | 'lapsed' | 'older'
}
export interface StrayRow {
  member_id: number; member_name: string; clubdesk_id: string; uuid?: string
  group: string; sport: string; active: boolean; is_official: boolean
  coach_of: string; tr_of: string
  /**
   * Inside the envelope "Fix groups" (and the Sunday cleanup cron) may act on
   * unattended: the member has LEFT the club, or still belongs but staffs a team
   * rather than playing on one. Everything else is ambiguous — usually a missing
   * wiedisync roster row rather than a wrong ClubDesk group — and removing those
   * is what wiped 29 DU20 girls out of the register on 2026-07-16.
   */
  auto_removable?: boolean
}
export interface NoTeamGroupRow { group: string; count: number }
export interface UnmappedTeamRow { team_id: number; name: string; sport: string }
export interface StaleFunktionRow {
  member_id: number; member_name: string; clubdesk_name: string; clubdesk_id: string
  uuid: string; group: string; expected: string; sport: string
  is_guest: boolean
  /** The correct token already sits alongside, so removing this one is a pure fix. */
  has_correct: boolean
}

/** GET /kscw/clubdesk-group-sync */
export interface GroupCheckResp {
  no_group?: NoGroupRow[]
  missing?: MissingRow[]
  stale_funktion?: StaleFunktionRow[]
  coach_no_group?: MissingRow[]
  fee_no_roster?: FeeRow[]
  strays?: StrayRow[]
  no_team_groups?: NoTeamGroupRow[]
  unmapped_teams?: UnmappedTeamRow[]
}

export const EMPTY_GROUP_CHECK: Required<GroupCheckResp> = {
  no_group: [], missing: [], stale_funktion: [], coach_no_group: [], fee_no_roster: [],
  strays: [], no_team_groups: [], unmapped_teams: [],
}

/**
 * The four finding classes "Fix groups" can act on. Mirrors GROUP_FIX_CLASSES in
 * clubdesk-update.js — the server validates against its own copy and rebuilds the
 * worklist itself, so this list only decides what the dialog offers.
 */
export const FIX_CLASSES = ['missing', 'coach_no_group', 'stale_funktion', 'strays'] as const
export type FixClass = typeof FIX_CLASSES[number]

/**
 * Most recent invoice for a member, from EVERY source. Not filtered to the
 * ClubDesk mirror: dues are mid-migration onto native wiedisync invoices, so a
 * source filter would report a freshly-billed member as "never billed".
 */
export interface LastBill {
  date: string | null
  status: string | null
  amount: number | null
  open: number | null
  source: string | null
  number: string | null
}

/** The three export columns for a bill, in the order LastBillCell renders them. */
export function lastBillExport(bill: LastBill | null): string[] {
  if (!bill) return ['', 'never billed', '']
  return [
    bill.date || '',
    bill.status || '',
    typeof bill.open === 'number' ? String(bill.open) : '',
  ]
}
