import { useTranslation } from 'react-i18next'
import { cn } from '../../../../lib/utils'
import { badgeVariants } from '../../../../components/ui/badge'
import { formatDateTimeCompact } from '../../../../utils/dateHelpers'
import { HintPopover } from './HintPopover'
import {
  ROW_STATE_BADGE_VARIANT, ROW_STATE_HINT_KEY, ROW_STATE_LABEL_KEY, ROW_STATE_ORDER,
} from '../utils/rowState'
import type { RowState } from '../types'

/**
 * The numbers, as filters.
 *
 * ⚠ Every figure here is scoped to the WORKLIST cohort and says so once, in the
 * leading `trNumbersScope` label. The pills this replaces ("14 in VIS · 3 not
 * found · 1 not checked") were scoped the same way and stated it nowhere, so
 * they read as a tally over the whole club and never matched the per-federation
 * splits below them.
 *
 * The states are mutually exclusive and `rowStateOf` is total, so the chips sum
 * to `needsCount` exactly — a member cannot fall out of the numbers bar
 * unnoticed. Chips at 0 are omitted (they add nothing to the sum).
 */
export function TransferNumbersBar({ stateCounts, needsCount, stateFilter, onStateFilterChange, lastVisCheck }: {
  stateCounts: Record<RowState, number>
  needsCount: number
  stateFilter: RowState | null
  onStateFilterChange: (next: RowState | null) => void
  lastVisCheck: string | null
}) {
  const { t } = useTranslation('admin')
  if (needsCount === 0) return null

  /**
   * ⚠ `trStateInProgress` carries VIS's own per-row progress figure
   * (`In progress {{percent}}%`). A chip counts ROWS, so there is no single
   * percentage to state — the interpolation is fed an empty string and the
   * stray `%` dropped, rather than inventing a `0%` that VIS never reported.
   * The key stays shared with the State column so the two can never drift.
   */
  const chipLabel = (state: RowState) => (
    state === 'inProgress'
      ? t(ROW_STATE_LABEL_KEY[state], { percent: '' }).replace(/\s*%/, '').trim()
      : t(ROW_STATE_LABEL_KEY[state])
  )

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-800/30">
      {/* ONE stated scope for every number on this row. */}
      <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">
        {t('trNumbersScope')}
      </span>

      <div className="flex flex-wrap items-center gap-1.5">
        {ROW_STATE_ORDER.filter((state) => stateCounts[state] > 0).map((state) => {
          const active = stateFilter === state
          return (
            <button
              key={state}
              type="button"
              aria-pressed={active}
              // Same sentence as the State column's badge — one key, so the chip
              // and the column can never explain the state differently.
              title={t(ROW_STATE_HINT_KEY[state])}
              // Clicking the ACTIVE chip clears the filter: the chip is the only
              // control that set it, so it has to be the one that undoes it.
              onClick={() => { onStateFilterChange(active ? null : state) }}
              className={cn(
                badgeVariants({ variant: ROW_STATE_BADGE_VARIANT[state] }),
                'min-h-[44px] gap-1.5 whitespace-normal break-words sm:min-h-0',
                active
                  ? 'ring-2 ring-brand-500 ring-offset-1 dark:ring-offset-gray-900'
                  : 'opacity-90 hover:opacity-100',
              )}
            >
              <span className="tabular-nums">{stateCounts[state]}</span>
              <span>{chipLabel(state)}</span>
            </button>
          )
        })}
      </div>

      {/* Dating the numbers where they are read. Without it the chips look live,
          and the page silently asserts a month-old answer as today's. */}
      <span className="ml-auto flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
        {lastVisCheck
          ? t('trVisLastChecked', { date: formatDateTimeCompact(lastVisCheck) })
          : t('trVisNeverChecked')}
        {/* "Not found in VIS" is a lead, not a verdict — the caveat the figures
            above cannot be read correctly without. */}
        <HintPopover text={t('trVisSummaryHint')} />
      </span>
    </div>
  )
}
