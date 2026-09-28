import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

interface ViewToggleOption {
  value: string
  label: string
}

interface ViewToggleProps {
  options: ViewToggleOption[]
  value: string
  onChange: (value: string) => void
}

export default function ViewToggle({ options, value, onChange }: ViewToggleProps) {
  const { t } = useTranslation('common')
  return (
    <>
      {/* Mobile: dropdown — the segmented chips don't fit on narrow screens */}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={t('view')}
        className="h-11 rounded-lg border border-input bg-card px-3 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-gray-800 sm:hidden"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>

      {/* Desktop: segmented control */}
      <div className="hidden h-8 items-center gap-0.5 rounded-lg border border-border bg-card p-0.5 sm:inline-flex">
        {options.map((option) => {
          const active = value === option.value
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              aria-pressed={active}
              className={cn(
                'h-full rounded-md px-2.5 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                active
                  ? 'bg-selected text-selected-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </>
  )
}
