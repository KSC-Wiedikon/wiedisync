import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Award, Check, HelpCircle, Hourglass, Lock, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useRsvpLabels } from '../hooks/useRsvpLabels'
import { useParticipationCounts } from '../hooks/useParticipationCounts'
import type { RsvpStatus } from '../utils/participationColors'
import type { Participation } from '../types'

const ICON: Record<RsvpStatus, typeof Check> = { confirmed: Check, tentative: HelpCircle, declined: X }

const TINT: Record<RsvpStatus, string> = {
  confirmed: 'bg-green-50 text-green-700 hover:bg-green-100 dark:bg-green-900/25 dark:text-green-300 dark:hover:bg-green-900/40',
  tentative: 'bg-yellow-50 text-yellow-700 hover:bg-yellow-100 dark:bg-yellow-900/25 dark:text-yellow-300 dark:hover:bg-yellow-900/40',
  declined: 'bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-900/25 dark:text-red-300 dark:hover:bg-red-900/40',
}
// Selected = solid fill + a ring offset from the card, so the choice reads
// without relying on colour alone (plus aria-checked).
const FILL: Record<RsvpStatus, string> = {
  confirmed: 'bg-green-600 text-white ring-2 ring-green-400 ring-offset-2 ring-offset-background dark:bg-green-600',
  tentative: 'bg-yellow-600 text-white ring-2 ring-yellow-400 ring-offset-2 ring-offset-background dark:bg-yellow-600',
  declined: 'bg-red-600 text-white ring-2 ring-red-400 ring-offset-2 ring-offset-background dark:bg-red-600',
}

export interface RsvpAnswerButtonsProps {
  activityType: Participation['activity_type']
  activityId: string
  /** Prefetched rows (the modal already has them) — no second fetch. */
  participations?: Participation[]
  coachMemberIds?: string[]
  /** The viewer's current answer. */
  value: string | null | undefined
  onSelect: (status: RsvpStatus) => void
  /** Deadline passed: every option stays visible (with its total) but can't be tapped. */
  locked?: boolean
  /** The viewer's own answer is still loading. */
  loading?: boolean
  /** Which answers exist here (default all three). */
  options?: RsvpStatus[]
  /** Replaces "Your status" (e.g. the household "Answering for …"). */
  label?: ReactNode
  /** Right side of the label line — the roster button. */
  trailing?: ReactNode
  /** Show the green "Saved" flash above the buttons. */
  saved?: boolean
  hideCoachPresent?: boolean
  /**
   * Card mode: no label line above the buttons. The household "Answering for …"
   * caption, "Coach present", the waitlist count and `trailing` go on ONE small
   * line under the buttons instead, so the buttons sit right under the card's
   * details. Everything else (grid, container queries, locked/loading/saved,
   * household one-column mode) is unchanged.
   */
  compact?: boolean
  className?: string
}

/**
 * Yes / Maybe / No with the team totals inside the buttons — replaces the
 * pills + separate `ParticipationSummary bars` row in the detail modals.
 * Totals come from `useParticipationCounts`, the SAME numbers as the card
 * counters and the roster modal (staff excluded, guests on their host's row).
 *
 * Layout: three equal columns (`minmax(0,1fr)`), 44px. A container query
 * drops the icons on unselected buttons below 20rem, and below 16rem the
 * count moves above the label — labels are never truncated. While a household
 * member is being answered for, the labels carry their name ("Léon is
 * coming"), so the grid becomes one full-width button per answer instead.
 */
export default function RsvpAnswerButtons({
  activityType, activityId, participations, coachMemberIds,
  value, onSelect, locked, loading, options = ['confirmed', 'tentative', 'declined'],
  label, trailing, saved, hideCoachPresent, compact, className,
}: RsvpAnswerButtonsProps) {
  const { t } = useTranslation('participation')
  const { answer, actingName, answeringFor } = useRsvpLabels()
  const counts = useParticipationCounts({ activityType, activityId, participations, coachMemberIds })
  const total: Record<RsvpStatus, number> = {
    confirmed: counts.confirmedTotal,
    tentative: counts.tentative,
    declined: counts.declined,
  }
  const stacked = !!actingName
  const disabled = !!locked || !!loading

  const labelId = `rsvp-label-${activityType}-${activityId}`
  const coachPresent = !hideCoachPresent && !counts.pending && counts.staffConfirmed > 0 ? (
    <span className="flex items-center gap-1 text-[11px] text-brand-600 dark:text-brand-400">
      <Award className="h-3 w-3" aria-hidden />
      {t('coachPresent')}
    </span>
  ) : null
  const waitlist = !counts.pending && counts.waitlisted > 0 ? (
    <span className="flex items-center gap-1 rounded-md bg-orange-50 px-2 py-1 text-xs font-semibold tabular-nums text-orange-700 dark:bg-orange-900/20 dark:text-orange-300" title={t('waitlisted')}>
      <Hourglass className="h-3 w-3" aria-hidden />
      {counts.waitlisted}
    </span>
  ) : null
  // Compact: the caption is only rendered when there is something to say —
  // a household caption / custom label; "Your status" alone is noise on a card.
  const compactCaption = label ?? answeringFor

  return (
    <div className={cn('space-y-1.5', className)}>
      {!compact && (
        <div className="flex min-h-11 items-center justify-between gap-2">
          <span id={labelId} className="min-w-0 break-words text-sm font-medium text-gray-700 dark:text-gray-300">
            {label ?? (answeringFor || t('yourStatus'))}
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {coachPresent}
            {waitlist}
            {trailing}
          </span>
        </div>
      )}

      <div className="relative @container">
        <div
          role="radiogroup"
          aria-labelledby={compact ? undefined : labelId}
          aria-label={compact ? (typeof compactCaption === 'string' && compactCaption ? compactCaption : t('yourStatus')) : undefined}
          aria-busy={loading || counts.pending || undefined}
          className={cn('grid gap-1.5', stacked ? 'grid-cols-1' : 'grid-cols-[repeat(var(--n),minmax(0,1fr))]')}
          style={{ ['--n' as string]: options.length }}
        >
          {options.map((status) => {
            const on = value === status
            const Icon = ICON[status]
            return (
              <button
                key={status}
                type="button"
                role="radio"
                aria-checked={on}
                aria-disabled={disabled || undefined}
                title={`${answer[status]}: ${counts.pending ? '…' : total[status]}`}
                onClick={() => { if (!disabled && !on) onSelect(status) }}
                className={cn(
                  'flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none',
                  !stacked && '@max-3xs:min-h-[52px] @max-3xs:flex-col @max-3xs:gap-0 @max-3xs:px-1',
                  on ? FILL[status] : TINT[status],
                  stacked && 'justify-start px-3',
                  locked && 'cursor-not-allowed',
                  locked && !on && 'opacity-50',
                  loading && 'opacity-50',
                )}
              >
                <Icon className={cn('h-4 w-4 shrink-0', !stacked && '@max-3xs:hidden', !on && !stacked && '@max-xs:hidden')} aria-hidden />
                <span className={cn('min-w-0', stacked ? 'whitespace-normal text-left' : '@max-3xs:text-[11.5px] @max-3xs:leading-tight')}>{answer[status]}</span>
                <span
                  className={cn(
                    'min-w-[1ch] text-center font-bold tabular-nums',
                    !stacked && '@max-3xs:order-first @max-3xs:text-base @max-3xs:leading-tight',
                    on && 'rounded-md bg-white/20 px-1.5',
                    counts.pending && 'inline-block h-[0.9em] w-[1ch] animate-pulse rounded-sm bg-current opacity-30 motion-reduce:animate-none',
                    stacked && 'ml-auto',
                  )}
                >
                  {counts.pending ? '' : total[status]}
                </span>
              </button>
            )
          })}
        </div>
        {saved && (
          <span role="status" className="pointer-events-none absolute -top-7 left-1/2 flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-md bg-green-600 px-2 py-0.5 text-[11px] font-medium text-white shadow-lg animate-fade-in">
            <Check className="h-3 w-3" aria-hidden />
            {t('saved')}
          </span>
        )}
      </div>

      {compact && (compactCaption || coachPresent || waitlist || trailing) && (
        // One small line under the buttons; the caption wraps, the indicators
        // never do (shrink-0) — no justify-between around anything tappable.
        <div className="flex items-center gap-2">
          {compactCaption && (
            <span className="min-w-0 flex-1 break-words text-[11px] font-medium leading-tight text-gray-600 dark:text-gray-300">{compactCaption}</span>
          )}
          <span className={cn('flex shrink-0 items-center gap-2', !compactCaption && 'flex-1')}>
            {coachPresent}
            {waitlist}
            {trailing && <span className="ml-auto flex items-center">{trailing}</span>}
          </span>
        </div>
      )}

      {locked && (
        <p className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
          <Lock className="h-3 w-3 shrink-0" aria-hidden />
          {t('deadlinePassed')}
        </p>
      )}
    </div>
  )
}
