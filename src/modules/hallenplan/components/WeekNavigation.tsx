import { useTranslation } from 'react-i18next'
import type { Hall, HallSlot } from '../../../types'
import { FreedSlotsBar, SportFilterToggle } from './HallenplanNavControls'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import IconButton from '@/components/IconButton'
import type { FreedSlotInfo, SportFilter } from '../HallenplanPage'

interface WeekNavigationProps {
  weekLabel: string
  onPrev: () => void
  onNext: () => void
  onToday: () => void
  halls: Hall[]
  selectedHallIds: string[]
  onSelectHalls: (hallIds: string[]) => void
  isAdmin: boolean
  onOpenClosureManager: () => void
  onOpenHallManager: () => void
  sportFilter?: SportFilter
  onSetSportFilter?: (filter: SportFilter) => void
  freedSlots?: FreedSlotInfo[]
  onFreedSlotClick?: (slot: HallSlot) => void
}

export default function WeekNavigation({
  weekLabel,
  onPrev,
  onNext,
  onToday,
  halls: _halls,
  selectedHallIds: _selectedHallIds,
  onSelectHalls: _onSelectHalls,
  isAdmin,
  onOpenClosureManager,
  onOpenHallManager,
  sportFilter = 'all',
  onSetSportFilter,
  freedSlots = [],
  onFreedSlotClick,
}: WeekNavigationProps) {
  // Hall filter chips are rendered separately below content by HallenplanView
  void _halls; void _selectedHallIds; void _onSelectHalls
  const { t } = useTranslation('hallenplan')

  return (
    <div className="mb-4 space-y-3 rounded-2xl border border-hairline bg-card p-4 shadow-card">
      {/* Top row: week nav + actions */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <IconButton label={t('prevWeek')} onClick={onPrev} className="shrink-0">
            <ChevronLeft className="!size-5" />
          </IconButton>
          <span className="min-w-0 text-center text-sm font-semibold text-foreground sm:min-w-[220px] lg:text-base">
            {weekLabel}
          </span>
          <IconButton label={t('nextWeek')} onClick={onNext} className="shrink-0">
            <ChevronRight className="!size-5" />
          </IconButton>
          <Button variant="outline" onClick={onToday} className="shrink-0">
            {t('today')}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          {onSetSportFilter && (
            <SportFilterToggle value={sportFilter} onChange={onSetSportFilter} allLabel={t('all')} />
          )}

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
      </div>

      {/* Available slots button + modal */}
      <FreedSlotsBar freedSlots={freedSlots} onFreedSlotClick={onFreedSlotClick} />

      {/* Hall filter chips — hidden, rendered separately below content by HallenplanView */}
    </div>
  )
}
