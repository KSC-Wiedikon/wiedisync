import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import { Button } from '../../../../components/ui/button'

/**
 * At most two strips above the tabs, and every one of them JUMPS somewhere.
 *
 * A banner that only restates a count is a dead end — the admin still has to
 * find the rows it counted. So each strip carries the control that filters the
 * page down to exactly those rows.
 *
 * ⚠ The blue "already validated, probably done" banner is deliberately NOT here
 * any more: it is a nudge about work in progress, not a safety alarm, and it
 * became the `awaitingConfirmation` chip in the numbers bar — which says the
 * same thing AND filters to the rows.
 */
export function TransferAlerts({ blockedCount, dangerousConflictCount, onShowBlocked, onShowConflicts }: {
  blockedCount: number
  dangerousConflictCount: number
  onShowBlocked: () => void
  onShowConflicts: () => void
}) {
  const { t } = useTranslation('admin')
  if (blockedCount === 0 && dangerousConflictCount === 0) return null

  return (
    <div className="mb-3 space-y-2">
      {/* Eligibility alarm — the highest-value thing on this page. A transfer we
          recorded as done whose Swiss Volley licence is NOT validated means the
          ITC has not arrived and the player must not be fielded. It stays above
          everything, and it is counted over the worklist AND the ruled-out
          cohort: somebody cleared off the worklist who still carries
          `transfer_status = 'done'` and an unvalidated licence is exactly the
          person nobody is looking at. */}
      {blockedCount > 0 && (
        /* ⚠ Stacks below sm. Side-by-side, the button's `shrink-0` wins against
           the message's `min-w-0 flex-1`, so on a 375px screen the heading
           squeezed into a ~170px column six lines tall and the strip alone was
           most of the viewport. `flex-wrap` does not save it — a flex-1 child
           shrinks instead of wrapping. */
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-lg border border-red-300 bg-red-50 px-4 py-3 sm:flex-row sm:items-start dark:border-red-800 dark:bg-red-900/30"
        >
          <div className="flex min-w-0 flex-1 items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-red-800 dark:text-red-200">
                {t('trBlockedBanner', { count: blockedCount })}
              </p>
              <p className="mt-0.5 text-xs text-red-700 dark:text-red-300">
                {t('trBlockedBannerDescription')}
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="min-h-[44px] w-full shrink-0 border-red-300 text-red-800 hover:bg-red-100 sm:min-h-0 sm:w-auto dark:border-red-700 dark:text-red-200 dark:hover:bg-red-900/50"
            onClick={onShowBlocked}
          >
            {t('trShowThese')}
          </Button>
        </div>
      )}

      {/* Where Swiss Volley's own federation of origin disagrees with ours, in
          the DANGEROUS direction only: we record CH and they record a foreign
          federation, so nobody is chasing a transfer that may be
          required. Swiss Volley works from THEIR value.

          ⚠ It stays above the fold even though the full table moved behind the
          Diagnostics tab — this is the only place that direction surfaces at
          all. The other two kinds are not alarms and are counted in the table. */}
      {dangerousConflictCount > 0 && (
        /* Same stacking rule as the red strip above. */
        <div className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 sm:flex-row sm:items-start dark:border-amber-800 dark:bg-amber-900/20">
          <div className="flex min-w-0 flex-1 items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
            <p className="min-w-0 text-sm font-semibold text-amber-900 dark:text-amber-100">
              {/* ⚠ NOT `trFooConflictBanner` — that one is the Diagnostics
                  table's heading and counts all three conflict kinds. This strip
                  counts the dangerous direction only, so it needs wording that
                  says so; the same sentence with a smaller number would read as
                  the page contradicting itself. */}
              {t('trFooConflictAlert', { count: dangerousConflictCount })}
            </p>
          </div>
          <Button
            size="sm"
            className="min-h-[44px] w-full shrink-0 sm:min-h-0 sm:w-auto"
            onClick={onShowConflicts}
          >
            {t('trShowInDiagnostics')}
          </Button>
        </div>
      )}
    </div>
  )
}
