import Modal from '@/components/Modal'
import type { CalendarEntry } from '../../../types/calendar'
import { formatDate } from '../../../utils/dateUtils'
import { entryIconColor, cancelledClasses } from '../entryStyle'
import CalendarTypeIcon from './CalendarTypeIcon'

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
      {entries.length > 0 && (
        <div className="space-y-2">
          {entries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => {
                onClose()
                onSelect(entry)
              }}
              className="flex w-full items-center gap-3 rounded-lg p-3 text-left transition-colors hover:bg-gray-50 active:bg-gray-100 dark:hover:bg-gray-700 dark:active:bg-gray-600"
            >
              <CalendarTypeIcon type={entry.type} sport={entry.sport} size="sm" filled className={entryIconColor(entry)} />
              <div className={`min-w-0 flex-1 ${cancelledClasses(entry)}`}>
                <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                  {entry.title}
                </p>
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  {entry.startTime ?? ''}{entry.location ? ` · ${entry.location}` : ''}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </Modal>
  )
}
