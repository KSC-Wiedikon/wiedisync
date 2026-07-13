/**
 * Calendar filter helpers (pure, no React).
 *
 * Lives apart from `CalendarFilters.tsx` so that file only exports the modal
 * component — react-refresh/only-export-components (Fast Refresh) requires a
 * module to export either components or non-components, not both.
 */

import type { CalendarFilterState } from '../../types/calendar'

/** Count active filters (deselected sources + selected teams) */
export function getActiveFilterCount(
  filters: CalendarFilterState,
  totalSources: number,
): number {
  let count = 0
  if (filters.sources.length < totalSources) count += 1
  if (filters.selectedTeamIds.length > 0) count += 1
  return count
}
