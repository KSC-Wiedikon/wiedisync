import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { getTeamColor } from '../utils/teamColors'

interface FilterChipOption {
  value: string
  label: string
  /** Tailwind classes for selected state (e.g. "bg-brand-100 text-brand-800 border-brand-200") */
  colorClasses?: string
}

interface FilterChipsProps {
  options: FilterChipOption[]
  selected: string[]
  onChange: (selected: string[]) => void
  multiple?: boolean
  /** Compact mode: smaller chips for use below calendar */
  compact?: boolean
  /** Show All/None toggle buttons */
  showBulkToggle?: boolean
}

export default function FilterChips({
  options,
  selected,
  onChange,
  multiple = true,
  compact = false,
  showBulkToggle = false,
}: FilterChipsProps) {
  const { t } = useTranslation('common')

  function handleClick(value: string) {
    if (multiple) {
      if (selected.includes(value)) {
        onChange(selected.filter((v) => v !== value))
      } else {
        onChange([...selected, value])
      }
    } else {
      onChange(selected.includes(value) ? [] : [value])
    }
  }

  const sizeClasses = compact
    ? 'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
    // Tool tier of the control scale: 44px touch on a phone, 32px from sm.
    : 'inline-flex h-11 items-center gap-1.5 rounded-lg border px-2.5 text-sm font-medium transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-8 sm:text-xs'

  const unselectedClasses = 'border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground dark:bg-transparent'
  const dotSize = compact ? 'h-1.5 w-1.5' : 'h-2 w-2'

  const allSelected = options.every((o) => selected.includes(o.value))
  const noneSelected = selected.length === 0

  return (
    <div className={cn('flex flex-wrap items-center', compact ? 'gap-1' : 'gap-2 sm:gap-1.5')}>
      {showBulkToggle && (
        <button
          type="button"
          onClick={() => {
            if (allSelected) {
              onChange([])
            } else {
              onChange(options.map((o) => o.value))
            }
          }}
          aria-pressed={allSelected}
          className={cn(
            sizeClasses,
            allSelected
              ? 'border-gold-400 bg-gold-100 text-gold-900 dark:border-gold-400/50 dark:bg-gold-400/20 dark:text-gold-300'
              : noneSelected
                ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300'
                : unselectedClasses,
          )}
          title={allSelected ? t('selectNone') : t('selectAll')}
        >
          {allSelected ? t('all') : noneSelected ? t('none') : `${selected.length}/${options.length}`}
        </button>
      )}
      {options.map((option) => {
        const isSelected = selected.includes(option.value)

        if (option.colorClasses) {
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => handleClick(option.value)}
              aria-pressed={isSelected}
              className={cn(sizeClasses, isSelected ? option.colorClasses : unselectedClasses)}
            >
              {option.label}
            </button>
          )
        }

        const teamColor = getTeamColor(option.label)
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => handleClick(option.value)}
            aria-pressed={isSelected}
            className={cn(sizeClasses, isSelected ? 'ring-1 ring-inset ring-white/25' : unselectedClasses)}
            style={
              isSelected
                ? {
                    backgroundColor: teamColor.bg,
                    color: teamColor.text,
                    borderColor: teamColor.border,
                  }
                : undefined
            }
          >
            {/* Team-colour dot keeps every team distinguishable even when unselected. */}
            {!isSelected && (
              <span
                className={cn(dotSize, 'shrink-0 rounded-full ring-1 ring-black/5')}
                style={{ backgroundColor: teamColor.bg }}
                aria-hidden
              />
            )}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
