import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import Modal from '@/components/Modal'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { HallSlot } from '../../../types'
import type { FreedSlotInfo, SportFilter } from '../HallenplanPage'

/** VB / BB / All segmented toggle — shared by Week- and DayNavigation. */
export function SportFilterToggle({
  value,
  onChange,
  allLabel,
}: {
  value: SportFilter
  onChange: (filter: SportFilter) => void
  allLabel: string
}) {
  return (
    <div className="flex shrink-0 overflow-hidden rounded-md border border-gray-300 dark:border-gray-600">
      {(['vb', 'bb', 'all'] as const).map((f) => (
        <Button
          key={f}
          variant="ghost"
          aria-pressed={value === f}
          onClick={() => onChange(f)}
          className={cn(
            'rounded-none shadow-none',
            value === f
              ? 'bg-brand-100 text-brand-800 hover:bg-brand-100 dark:bg-brand-700 dark:text-white dark:hover:bg-brand-700'
              : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700',
            f !== 'vb' && 'border-l border-gray-300 dark:border-gray-600',
          )}
        >
          {f === 'vb' ? 'VB' : f === 'bb' ? 'BB' : allLabel}
        </Button>
      ))}
    </div>
  )
}

/** "N slots available" pill + the picker modal listing them. */
export function FreedSlotsBar({
  freedSlots,
  onFreedSlotClick,
}: {
  freedSlots: FreedSlotInfo[]
  onFreedSlotClick?: (slot: HallSlot) => void
}) {
  const { t } = useTranslation('hallenplan')
  const [open, setOpen] = useState(false)
  if (freedSlots.length === 0) return null
  return (
    <>
      <div className="border-t border-gray-200 pt-3 dark:border-gray-700">
        <Button
          size="sm"
          variant="ghost"
          icon={<Plus />}
          onClick={() => setOpen(true)}
          className="rounded-full bg-emerald-100 font-semibold text-emerald-800 hover:bg-emerald-200 hover:text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300 dark:hover:bg-emerald-900/50 dark:hover:text-emerald-300"
        >
          {t('slotsAvailable', { count: freedSlots.length })}
        </Button>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title={t('slotsAvailableTitle')} size="sm">
        <div className="space-y-1.5">
          {freedSlots.map((fs, i) => (
            <button
              key={i}
              type="button"
              onClick={() => { onFreedSlotClick?.(fs.slot); setOpen(false) }}
              className="flex min-h-11 w-full items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-left text-sm text-emerald-700 transition-colors hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300 dark:hover:bg-emerald-900/40"
            >
              <span className="min-w-0 flex-1 font-medium">{fs.dayLabel} {fs.dateStr} {fs.startTime}–{fs.endTime}</span>
              <span className="shrink-0 text-xs text-emerald-600 dark:text-emerald-400">{fs.hallName}</span>
            </button>
          ))}
        </div>
      </Modal>
    </>
  )
}
