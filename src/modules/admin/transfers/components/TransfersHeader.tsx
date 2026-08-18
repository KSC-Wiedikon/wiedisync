import { useTranslation } from 'react-i18next'
import { RefreshCcw } from 'lucide-react'
import { Button } from '../../../../components/ui/button'
import { HintPopover } from './HintPopover'
import type { HiddenCounts } from '../types'

/**
 * The page header: title, one-line description, ONE action — and the line that
 * says who is missing from the page.
 *
 * ⚠ Refresh is the only control here. "Check VIS now" lives in the Diagnostics
 * tab, next to the `trVisLastChecked` timestamp it changes. The two are NOT the
 * same thing and the labels have to say so — Refresh re-reads what the database
 * already holds, "Check VIS now" goes and asks FIVB — and the surest way to keep
 * that distinction is to stop rendering them side by side. `trRefreshHint`
 * carries the sentence ("It does not query VIS — use 'Check VIS now' for that"),
 * so an admin pressing Refresh and seeing a month-old date is still told where
 * the other button is.
 */
export function TransfersHeader({ isFetching, onRefresh, hidden, u20Count }: {
  isFetching: boolean
  onRefresh: () => void
  hidden: HiddenCounts
  u20Count: number
}) {
  const { t } = useTranslation('admin')

  /**
   * Say what the filters drop. A worklist that quietly omits people is worse
   * than one that is a little longer — so the four cohorts this page does not
   * render are summed into one line, and the four reasons stay READABLE behind
   * a tap.
   *
   * ⚠ The reasons stay four separate sentences, never one merged tally: "on no
   * team" is a data gap to fix (give them a team and they reappear), "guest
   * only" is the correct answer (no licence, so no transfer), "basketball" is a
   * whole sport this page does not cover, and the U20 exemption is per team.
   * The full tallies are also a Diagnostics card, and their total is on the
   * Diagnostics tab label.
   */
  const hiddenTotal = hidden.noTeam + hidden.guestOnly + hidden.basketball + u20Count
  const hiddenReasons = [
    hidden.noTeam > 0 ? t('trHiddenNoTeam', { count: hidden.noTeam }) : null,
    hidden.guestOnly > 0 ? t('trHiddenGuests', { count: hidden.guestOnly }) : null,
    hidden.basketball > 0 ? t('trHiddenBasketball', { count: hidden.basketball }) : null,
    u20Count > 0 ? t('trHiddenU20', { count: u20Count }) : null,
  ]
    .filter((line): line is string => line !== null)
    .join(' ')

  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('trTitle')}</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t('trDescription')}</p>
        {hiddenTotal > 0 && (
          <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
            {t('trHiddenSummary', { count: hiddenTotal })}
            <HintPopover text={hiddenReasons} />
          </p>
        )}
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          // size="sm" is 32px tall; the floor is lifted back to 44px on touch
          // and released from `sm` up, the way every other control on this page
          // sizes itself.
          className="min-h-[44px] sm:min-h-0"
          onClick={onRefresh}
          loading={isFetching}
          icon={<RefreshCcw aria-hidden="true" />}
          title={t('trRefreshHint')}
        >
          {t('trRefresh')}
        </Button>
        {/* The title= above is a desktop-only extra — this is the same sentence
            reachable by tap, and it is the one that explains why pressing
            Refresh does not move the VIS date. */}
        <HintPopover text={t('trRefreshHint')} />
      </div>
    </div>
  )
}
