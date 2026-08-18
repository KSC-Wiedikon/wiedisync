/**
 * Every piece of view state `/admin/transfers` holds — which tab is open, what
 * is filtered, and which groups and rows are expanded.
 *
 * One hook so the page stays thin and so switching tabs never resets somebody's
 * disclosure state. Deliberately NOT in the URL: two people use this page and a
 * shareable link is not worth a second source of truth for the tab.
 */

import { useCallback, useState } from 'react'
import { memberName } from '../../../../utils/relations'
import type { CohortTab, GroupBy, RowState, TransferMember } from '../types'

export interface TransferUiState {
  activeTab: CohortTab
  setActiveTab: (t: CohortTab) => void
  search: string
  setSearch: (v: string) => void
  stateFilter: RowState | null
  setStateFilter: (s: RowState | null) => void
  groupBy: GroupBy
  setGroupBy: (g: GroupBy) => void
  openGroups: ReadonlySet<string>
  setGroupOpen: (key: string, open: boolean) => void
  openRows: ReadonlySet<string>
  setRowOpen: (memberId: string, open: boolean) => void
  showBlocked: () => void
  showConflicts: () => void
  showMemberInWorklist: (m: TransferMember) => void
}

export function useTransferUiState(): TransferUiState {
  const [activeTab, setActiveTab] = useState<CohortTab>('worklist')
  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState<RowState | null>(null)
  const [groupBy, setGroupBy] = useState<GroupBy>('federation')

  /**
   * Which collapsible groups are expanded, keyed `mode:groupKey`.
   *
   * ⚠ Per GROUP, not per cohort. The Swiss cohort is always exactly one group
   * so a single boolean used to be enough; the cleared cohort is one group per
   * federation, and a shared boolean made them open and close each other —
   * clicking the second one closed the first.
   *
   * Everything starts CLOSED on purpose. The Swiss group is the largest cohort
   * by far (migration 239 seeded ~483 members to CH) and is a reference list,
   * not work — open by default it would push the handful of actual transfers
   * off the screen. The cleared cohort starts closed for the opposite reason:
   * it is SMALL, and it is a record of decisions already taken. Both keep their
   * count and VIS split in the group header, which is the part that has to be
   * visible — a worklist that got shorter without saying so is the failure mode
   * this page exists to prevent.
   */
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set())
  const setGroupOpen = useCallback((key: string, open: boolean) => {
    setOpenGroups((prev) => {
      if (prev.has(key) === open) return prev
      const next = new Set(prev)
      if (open) next.add(key)
      else next.delete(key)
      return next
    })
  }, [])

  /** Which rows have their evidence detail row expanded. Same identity bail-out
   *  as `openGroups`, so a no-op toggle never re-renders the table. */
  const [openRows, setOpenRows] = useState<ReadonlySet<string>>(new Set())
  const setRowOpen = useCallback((memberId: string, open: boolean) => {
    setOpenRows((prev) => {
      if (prev.has(memberId) === open) return prev
      const next = new Set(prev)
      if (open) next.add(memberId)
      else next.delete(memberId)
      return next
    })
  }, [])

  /** The red eligibility alarm's "Show these players" — the banner names a
   *  count, this is what turns it into the rows it counted. */
  const showBlocked = useCallback(() => {
    setStateFilter('blocked')
    setActiveTab('worklist')
  }, [])

  const showConflicts = useCallback(() => { setActiveTab('diagnostics') }, [])

  /** From a diagnostics row back to the member's worklist row. The legal name,
   *  not the display name: it is what `matchesSearch` reads (`last_name` /
   *  `first_name`), and a nickname would find nothing. The state filter is
   *  cleared because the member may well be in a state the filter excludes. */
  const showMemberInWorklist = useCallback((m: TransferMember) => {
    setSearch(memberName(m))
    setStateFilter(null)
    setActiveTab('worklist')
  }, [])

  return {
    activeTab,
    setActiveTab,
    search,
    setSearch,
    stateFilter,
    setStateFilter,
    groupBy,
    setGroupBy,
    openGroups,
    setGroupOpen,
    openRows,
    setRowOpen,
    showBlocked,
    showConflicts,
    showMemberInWorklist,
  }
}
