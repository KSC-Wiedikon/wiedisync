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
    ? 'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-all'
    : 'inline-flex items-center gap-1.5 min-h-[44px] rounded-full border px-3 py-2 text-sm font-medium transition-all active:scale-95 sm:min-h-0 sm:py-1.5 sm:text-xs'

  const unselectedClasses = 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50 hover:shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-gray-600 dark:hover:bg-gray-700/70'
  const dotSize = compact ? 'h-1.5 w-1.5' : 'h-2 w-2'

  const allSelected = options.every((o) => selected.includes(o.value))
  const noneSelected = selected.length === 0

  return (
    <div className={cn('flex flex-wrap items-center', compact ? 'gap-1' : 'gap-2 sm:gap-1.5')}>
      {showBulkToggle && (
        <button
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
                ? 'border-red-200 bg-red-50 text-red-600 dark:border-red-700 dark:bg-red-900/30 dark:text-red-400'
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
              onClick={() => handleClick(option.value)}
              aria-pressed={isSelected}
              className={cn(sizeClasses, isSelected ? cn(option.colorClasses, 'shadow-sm') : unselectedClasses)}
            >
              {option.label}
            </button>
          )
        }

        const teamColor = getTeamColor(option.label)
        return (
          <button
            key={option.value}
            onClick={() => handleClick(option.value)}
            aria-pressed={isSelected}
            className={cn(sizeClasses, isSelected ? 'shadow-sm ring-1 ring-inset ring-white/25' : unselectedClasses)}
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
