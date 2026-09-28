import { useTranslation } from 'react-i18next'
import { Check, X, HelpCircle, Hourglass, Award } from 'lucide-react'
import { useParticipationCounts } from '../hooks/useParticipationCounts'
import type { Participation } from '../types'

/** Same box metrics as the live `bars` counters — keep the two in step. */
const BAR_BOX = 'flex min-w-[3.25rem] items-center justify-center gap-1 rounded-md px-2 py-1'

/** Placeholder for the three RSVP rectangles while their fetch is in flight. */
function ParticipationBarsSkeleton() {
  return (
    <div className="flex animate-pulse flex-col items-start gap-0.5 lg:flex-row lg:items-center lg:gap-2" aria-hidden="true">
      <div className="flex items-center gap-1">
        {['bg-green-50 dark:bg-green-900/20', 'bg-yellow-50 dark:bg-yellow-900/20', 'bg-red-50 dark:bg-red-900/20'].map((tint) => (
          <div key={tint} className={`${BAR_BOX} ${tint}`}>
            <span className="h-3 w-3 rounded-full bg-stone-300 dark:bg-gray-600" />
            <span className="h-4 w-2 rounded-sm bg-stone-300 dark:bg-gray-600" />
          </div>
        ))}
      </div>
    </div>
  )
}

interface ParticipationSummaryProps {
  activityType: Participation['activity_type']
  activityId: string
  compact?: boolean
  stacked?: boolean
  /** 3 colored rectangles layout — use beneath card info rows */
  bars?: boolean
  /** Hide coach/guest breakdowns — show only raw counts */
  hideExtras?: boolean
  /** Pre-fetched participations — skips internal API call when provided */
  participations?: Participation[]
  /** Coach/captain/TR member IDs — used to detect "Coach present" for player-coaches */
  coachMemberIds?: string[]
  /** Render the counters even when there are no participations yet (shows 0/0/0 instead of hiding) */
  alwaysShow?: boolean
}

export default function ParticipationSummary({
  activityType,
  activityId,
  compact = false,
  stacked = false,
  bars = false,
  hideExtras = false,
  participations: prefetched,
  coachMemberIds,
  alwaysShow = false,
}: ParticipationSummaryProps) {
  const { t } = useTranslation('participation')

  const {
    pending: countsPending, rowCount, confirmedTotal, confirmed, allGuests, hasGuestBreakdown,
    tentative, tentativeGuests, declined, waitlisted, staffConfirmed, extraConfirmed,
  } = useParticipationCounts({ activityType, activityId, participations: prefetched, coachMemberIds })

  // "Not loaded" must not be paintable as "these are the numbers". `bars` sits in the
  // middle of a layout (under the RSVP buttons in the game detail panel, in the card's
  // footer row), so its placeholder has to occupy the same footprint as the real
  // counters — swapping a one-character "…" for three rectangles reflows everything
  // below it once the fetch lands. The inline variants have no such footprint to hold,
  // so they keep this component's existing pending idiom.
  if (countsPending) {
    return bars ? <ParticipationBarsSkeleton /> : <span className="text-xs text-muted-foreground/80">…</span>
  }

  // Everything resolved with nothing to show. `alwaysShow` keeps the counters
  // visible (0/0/0) even for empty activities.
  if (!alwaysShow && rowCount === 0 && extraConfirmed === 0) return null

  if (bars) {
    return (
      <div className="flex flex-col items-start gap-0.5 lg:flex-row lg:items-center lg:gap-2">
        <div className="flex items-center gap-1">
          <div className="flex min-w-[3.25rem] items-center justify-center gap-1 rounded-md bg-green-50 px-2 py-1 dark:bg-green-900/20">
            <Check className="h-3 w-3 text-green-600 dark:text-green-400" />
            <span className="text-xs font-semibold tabular-nums text-green-700 dark:text-green-300">{confirmedTotal}</span>
          </div>
          <div className="flex min-w-[3.25rem] items-center justify-center gap-1 rounded-md bg-yellow-50 px-2 py-1 dark:bg-yellow-900/20">
            <HelpCircle className="h-3 w-3 text-yellow-600 dark:text-yellow-400" />
            <span className="text-xs font-semibold tabular-nums text-yellow-700 dark:text-yellow-300">{tentative}</span>
          </div>
          <div className="flex min-w-[3.25rem] items-center justify-center gap-1 rounded-md bg-red-50 px-2 py-1 dark:bg-red-900/20">
            <X className="h-3 w-3 text-red-600 dark:text-red-400" />
            <span className="text-xs font-semibold tabular-nums text-red-700 dark:text-red-300">{declined}</span>
          </div>
          {waitlisted > 0 && (
            <div className="flex min-w-[3.25rem] items-center justify-center gap-1 rounded-md bg-orange-50 px-2 py-1 dark:bg-orange-900/20">
              <Hourglass className="h-3 w-3 text-orange-600 dark:text-orange-400" />
              <span className="text-xs font-semibold tabular-nums text-orange-700 dark:text-orange-300">{waitlisted}</span>
            </div>
          )}
        </div>
        {!hideExtras && staffConfirmed > 0 && (
          <span className="flex items-center gap-1 text-[10px] text-primary dark:text-brand-300">
            <Award className="h-3 w-3" />
            {t('coachPresent')}
          </span>
        )}
      </div>
    )
  }

  if (stacked) {
    return (
      <div className="flex flex-col items-end gap-0.5 text-xs">
        <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400">
          {!hideExtras && staffConfirmed > 0 && (
            <span className="text-[10px] text-muted-foreground">{t('coachPresent')}</span>
          )}
          {confirmedTotal}
          <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-green-600 text-white dark:bg-green-500"><Check className="h-2.5 w-2.5" /></span>
          {!hideExtras && hasGuestBreakdown && (
            <span className="text-[10px] text-muted-foreground">
              ({confirmed}P {allGuests}G)
            </span>
          )}
        </span>
        {tentative > 0 && (
          <span className="inline-flex items-center gap-1 text-yellow-600 dark:text-yellow-400">
            {tentative}{!hideExtras && tentativeGuests > 0 && <span className="text-[10px] opacity-75">+{tentativeGuests}</span>}
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-yellow-500 text-white"><HelpCircle className="h-2.5 w-2.5" /></span>
          </span>
        )}
        {declined > 0 && (
          <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400">
            {declined}
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-white dark:bg-red-500"><X className="h-2.5 w-2.5" /></span>
          </span>
        )}
      </div>
    )
  }

  if (compact) {
    return (
      <div className="flex flex-col items-end gap-0.5">
        <span className="inline-flex items-center gap-1.5 text-xs">
          {confirmedTotal > 0 && (
            <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400">
              {confirmedTotal}
              <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-green-600 text-white dark:bg-green-500"><Check className="h-2.5 w-2.5" /></span>
              {!hideExtras && hasGuestBreakdown && (
                <span className="text-[10px] text-muted-foreground">
                  ({confirmed}P {allGuests}G)
                </span>
              )}
            </span>
          )}
          {tentative > 0 && (
            <span className="inline-flex items-center gap-1 text-yellow-600 dark:text-yellow-400">
              {tentative}{!hideExtras && tentativeGuests > 0 && <span className="text-[10px] opacity-75">+{tentativeGuests}</span>}
              <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-yellow-500 text-white"><HelpCircle className="h-2.5 w-2.5" /></span>
            </span>
          )}
          {declined > 0 && (
            <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400">
              {declined}
              <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-white dark:bg-red-500"><X className="h-2.5 w-2.5" /></span>
            </span>
          )}
          {waitlisted > 0 && (
            <span className="inline-flex items-center gap-1 text-orange-600 dark:text-orange-400">
              {waitlisted}
              <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-orange-500 text-white"><Hourglass className="h-2.5 w-2.5" /></span>
            </span>
          )}
        </span>
        {!hideExtras && staffConfirmed > 0 && (
          <span className="text-[10px] text-muted-foreground">{t('coachPresent')}</span>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col items-start gap-0.5">
      <div className="inline-flex items-center gap-2 text-xs">
        <span className="text-green-600 dark:text-green-400">
          {confirmedTotal}{!hideExtras && hasGuestBreakdown && ` (${confirmed}P ${allGuests}G)`} {t('confirmed')}
        </span>
        <span className="text-yellow-600 dark:text-yellow-400">
          {tentative}{!hideExtras && tentativeGuests > 0 && `+${tentativeGuests}`} {t('tentative')}
        </span>
        <span className="text-red-600 dark:text-red-400">{declined} {t('declined')}</span>
        {waitlisted > 0 && (
          <span className="text-orange-600 dark:text-orange-400">{waitlisted} {t('waitlisted')}</span>
        )}
      </div>
      {!hideExtras && staffConfirmed > 0 && (
        <span className="text-[10px] text-muted-foreground">{t('coachPresent')}</span>
      )}
    </div>
  )
}
