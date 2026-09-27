import { useTranslation } from 'react-i18next'
import type { Hall, HallSlot } from '../../../types'
import { FreedSlotsBar, SportFilterToggle } from './HallenplanNavControls'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import IconButton from '@/components/IconButton'
import type { FreedSlotInfo, SportFilter } from '../HallenplanPage'
import { dayHeaders } from '../../../utils/dateUtils'
import { currentLocale } from '../../../utils/dateHelpers'

interface DayNavigationProps {
  weekDays: Date[]
  selectedDayIndex: number
  onSelectDay: (index: number) => void
  onPrevWeek: () => void
  onNextWeek: () => void
  onToday: () => void
  halls: Hall[]
  selectedHallIds: string[]
  onSelectHalls: (hallIds: string[]) => void
  isAdmin: boolean
  onOpenClosureManager: () => void
  onOpenHallManager: () => void
  showSummary: boolean
  onToggleSummary: () => void
  sportFilter: SportFilter
  onSetSportFilter: (filter: SportFilter) => void
  freedSlots?: FreedSlotInfo[]
  onFreedSlotClick?: (slot: HallSlot) => void
}

export default function DayNavigation({
  weekDays,
  selectedDayIndex,
  onSelectDay,
  onPrevWeek,
  onNextWeek,
  onToday,
  halls: _halls,
  selectedHallIds: _selectedHallIds,
  onSelectHalls: _onSelectHalls,
  isAdmin,
  onOpenClosureManager,
  onOpenHallManager,
  showSummary,
  onToggleSummary,
  sportFilter,
  onSetSportFilter,
  freedSlots = [],
  onFreedSlotClick,
}: DayNavigationProps) {
  // Hall filter chips are rendered separately below content by HallenplanView
  void _halls; void _selectedHallIds; void _onSelectHalls
  const { t } = useTranslation('hallenplan')

  const DAY_FULL = [
    t('dayMonday'),
    t('dayTuesday'),
    t('dayWednesday'),
    t('dayThursday'),
    t('dayFriday'),
    t('daySaturday'),
    t('daySunday'),
  ] as const

  const selectedDay = weekDays[selectedDayIndex]
  const dateStr = selectedDay
    ? `${DAY_FULL[selectedDayIndex]}, ${selectedDay.getDate()} ${selectedDay.toLocaleString(currentLocale(), { month: 'short' })}`
    : ''

  const todayStr = new Date().toDateString()

  return (
    <div className="mb-4 space-y-3 rounded-xl bg-white p-3 shadow-card dark:bg-gray-800">
      {/* Week navigation row */}
      <div className="flex items-center justify-between">
        <IconButton label={t('prevWeek')} onClick={onPrevWeek} className="shrink-0">
          <ChevronLeft className="!size-5" />
        </IconButton>

        <div className="min-w-0 text-center">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {dateStr}
          </div>
        </div>

        <IconButton label={t('nextWeek')} onClick={onNextWeek} className="shrink-0">
          <ChevronRight className="!size-5" />
        </IconButton>
      </div>

      {/* Day dots */}
      <div className="flex justify-center gap-1">
        {weekDays.map((day, i) => {
          const isToday = day.toDateString() === todayStr
          const isSelected = i === selectedDayIndex
          return (
            <button
              key={i}
              onClick={() => onSelectDay(i)}
              className={`flex h-10 w-10 flex-col items-center justify-center rounded-lg text-xs font-medium transition-colors ${
                isSelected
                  ? 'bg-brand-500 text-white'
                  : isToday
                    ? 'bg-gold-100 text-gold-700 dark:bg-gold-900/30 dark:text-gold-400'
                    : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700'
              }`}
            >
              <span className="text-[10px] leading-none">{dayHeaders()[i]}</span>
              <span className="leading-tight">{day.getDate()}</span>
            </button>
          )
        })}
      </div>

      {/* Controls row */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={onToday}>
          {t('today')}
        </Button>

        <Button
          variant="outline"
          aria-pressed={showSummary}
          onClick={onToggleSummary}
          className={showSummary ? 'border-brand-400 bg-brand-100 text-brand-800 hover:bg-brand-100 hover:text-brand-800 dark:border-brand-400 dark:bg-brand-700 dark:text-white dark:hover:bg-brand-700 dark:hover:text-white' : undefined}
        >
          {t('summary')}
        </Button>

        <SportFilterToggle value={sportFilter} onChange={onSetSportFilter} allLabel={t('all')} />

        {isAdmin && (
          <>
            <Button variant="outline" onClick={onOpenClosureManager}>
              {t('closures')}
            </Button>
            <Button variant="outline" onClick={onOpenHallManager}>
              {t('hallsNav')}
            </Button>
          </>
        )}
      </div>

      {/* Available slots button + modal */}
      <FreedSlotsBar freedSlots={freedSlots} onFreedSlotClick={onFreedSlotClick} />

      {/* Hall filter chips — hidden, rendered separately below content by HallenplanView */}
    </div>
  )
}
