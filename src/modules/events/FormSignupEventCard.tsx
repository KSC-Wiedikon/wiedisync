import { useTranslation } from 'react-i18next'
import { CheckCircle2, MapPin, Pin } from 'lucide-react'
import type { Event } from '../../types'
import { formatDate, formatDayMonthZurich, formatTime, formatWeekday } from '../../utils/dateHelpers'
import { DateRail, RowStripe, RowChip } from '../../components/ActivityRow'

/**
 * Pinned card above the event list on Home, like DutyEventCard: an event the member
 * signed up for through its form (migration 434, `signedUp`) or one an admin pinned
 * (migration 435). A tap opens the event.
 */
export default function FormSignupEventCard({ event, onClick, signedUp = true }: { event: Event; onClick: () => void; signedUp?: boolean }) {
  const { t } = useTranslation('events')
  const day = event.start_date?.split(/[T ]/)[0]

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full flex-col overflow-hidden rounded-2xl border border-hairline bg-card text-left shadow-card transition-colors hover:bg-surface-sunken"
    >
      <div className="flex flex-1 items-stretch gap-2.5 p-3 sm:gap-3">
        <DateRail
          eyebrow={day ? formatWeekday(day) : undefined}
          main={day ? <span title={formatDate(day)}>{formatDayMonthZurich(day)}</span> : '–'}
          sub={!event.all_day && event.start_date ? formatTime(event.start_date) : undefined}
        />
        <RowStripe tone={signedUp ? 'green' : 'brand'} />
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-semibold leading-snug text-foreground sm:text-[15px]">
            {event.title}
          </p>
          <div className="mt-1.5 flex flex-wrap items-stretch gap-1.5">
            {signedUp ? (
              <RowChip tone="green">
                <CheckCircle2 aria-hidden />
                {t('formSignupPinned')}
              </RowChip>
            ) : (
              <RowChip tone="brand">
                <Pin aria-hidden />
                {t('pinnedChip')}
              </RowChip>
            )}
            {event.location && (
              <RowChip title={event.location}>
                <MapPin aria-hidden />
                {event.location}
              </RowChip>
            )}
          </div>
        </div>
      </div>
    </button>
  )
}
