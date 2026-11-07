import { useTranslation } from 'react-i18next'
import type { Hall, HallSlot } from '../../../types'
import { DayButtons, FreedSlotsBar, SportFilterToggle } from './HallenplanNavControls'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import IconButton from '@/components/IconButton'
import type { FreedSlotInfo, SportFilter } from '../HallenplanPage'
import { currentLocale } from '../../../utils/dateHelpers'

interface DayNavigationProps {
  weekDays: Date[]
  /** `null` = the whole week, shown as `weekLabel`. */
  selectedDayIndex: number | null
  onSelectDay: (index: number) => void
  weekLabel?: string
  /** When given, a day can be cleared again with a "Whole week" button. */
  onShowWholeWeek?: () => void
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
  weekLabel = '',
  onShowWholeWeek,
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

  const selectedDay = selectedDayIndex === null ? undefined : weekDays[selectedDayIndex]
  const dateStr = selectedDay
    ? `${DAY_FULL[selectedDayIndex!]}, ${selectedDay.getDate()} ${selectedDay.toLocaleString(currentLocale(), { month: 'short' })}`
    : weekLabel

  return (
    <div className="mb-4 space-y-3 rounded-2xl border border-hairline bg-card p-3 shadow-card">
      {/* Week navigation row */}
      <div className="flex items-center justify-between">
        <IconButton label={t('prevWeek')} onClick={onPrevWeek} className="shrink-0">
          <ChevronLeft className="!size-5" />
        </IconButton>

        <div className="min-w-0 text-center">
          <div className="text-sm font-semibold text-foreground">
            {dateStr}
          </div>
        </div>

        <IconButton label={t('nextWeek')} onClick={onNextWeek} className="shrink-0">
          <ChevronRight className="!size-5" />
        </IconButton>
      </div>

      <DayButtons weekDays={weekDays} selectedDayIndex={selectedDayIndex} onSelectDay={onSelectDay} />

      {/* Controls row */}
      <div className="flex flex-wrap items-center gap-2">
        {onShowWholeWeek && selectedDayIndex !== null && (
          <Button variant="outline" onClick={onShowWholeWeek}>
            {t('wholeWeek')}
          </Button>
        )}
        <Button variant="outline" onClick={onToday}>
          {t('today')}
        </Button>

        <Button
          variant="outline"
          aria-pressed={showSummary}
          onClick={onToggleSummary}
          className={showSummary ? 'border-selected bg-selected text-selected-foreground hover:bg-selected hover:text-selected-foreground' : undefined}
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
