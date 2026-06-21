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
  return (
    <div className="inline-flex items-center gap-0.5 rounded-full border border-gray-200/80 bg-gray-100/80 p-1 shadow-inner dark:border-gray-700 dark:bg-gray-800/70">
      {options.map((option) => {
        const active = value === option.value
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={cn(
              'min-h-[44px] rounded-full px-3.5 py-2 text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/60 sm:min-h-0 sm:py-1.5',
              active
                ? 'bg-gold-400 font-semibold text-brand-950 shadow-sm'
                : 'text-gray-500 hover:bg-white hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-white',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
