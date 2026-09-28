import Modal from '@/components/Modal'
import type { CalendarEntry } from '../../../types/calendar'
import { formatDate } from '../../../utils/dateUtils'
import { entryIconColor, cancelledClasses } from '../entryStyle'
import CalendarTypeIcon from './CalendarTypeIcon'
import { ActivityRow, DateRail, RowList } from '@/components/ActivityRow'
import TruncatedText from '@/components/TruncatedText'

/**
 * The day list behind a month cell's "+N more".
 *
 * ⚠ Despite the name and the "+N" that opens it, this shows EVERY entry overlapping
 * the day, not the hidden remainder — `MonthGrid` hands over the full day. Keep it
 * that way: a list that showed only the overflow would disagree with the day the
 * user just looked at.
 *
 * The Modal stays mounted with an `open` prop rather than being conditionally
 * rendered, because that is what drives its open/close transition.
 */
export default function DayOverflowModal({
  open,
  date,
  entries,
  onClose,
  onSelect,
}: {
  open: boolean
  date: Date | null
  entries: CalendarEntry[]
  onClose: () => void
  onSelect: (entry: CalendarEntry) => void
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      // A weekday/month label, not a numeric date — the Swiss dd.mm.yyyy rule does
      // not apply here, and this pattern is locale-aware via date-fns.
      title={date ? formatDate(date, 'EEEE, d MMMM') : ''}
      size="sm"
    >
      {/* One row per entry on the shared row vocabulary: time on the rail,
          title WRAPS (it is the primary text — a truncated "VBC Limmattal - D…"
          is useless in a day list), location truncates with a title. */}
      {entries.length > 0 && (
        <RowList>
          {entries.map((entry) => (
            <ActivityRow
              key={entry.id}
              rail={<DateRail main={entry.startTime || '–'} />}
              onClick={() => {
                onClose()
                onSelect(entry)
              }}
              title={
                <div className={`flex min-w-0 items-start gap-2 ${cancelledClasses(entry)}`}>
                  <span className="mt-0.5 shrink-0">
                    <CalendarTypeIcon type={entry.type} sport={entry.sport} size="sm" filled className={entryIconColor(entry)} />
                  </span>
                  <p className="min-w-0 break-words text-sm font-medium leading-snug text-foreground">
                    {entry.title}
                  </p>
                </div>
              }
            >
              {entry.location && (
                <TruncatedText
                  text={entry.location}
                  className={`mt-0.5 text-xs text-muted-foreground ${cancelledClasses(entry)}`}
                />
              )}
            </ActivityRow>
          ))}
        </RowList>
      )}
    </Modal>
  )
}
