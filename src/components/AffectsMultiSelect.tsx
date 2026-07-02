import { useTranslation } from 'react-i18next'

const AFFECTS_OPTIONS = ['trainings', 'games', 'events'] as const
const ALL_VALUE = 'all'

interface AffectsMultiSelectProps {
  selected: string[]
  onChange: (selected: string[]) => void
  label?: string
}

// Inactive pill styling is identical for every value — keep it in one place and
// only vary the active (selected) colour per value.
const INACTIVE_PILL = 'bg-transparent text-gray-500 dark:text-gray-400 border-gray-300 dark:border-gray-600'

const AFFECTS_ACTIVE: Record<string, string> = {
  trainings: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700',
  games: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 border-green-300 dark:border-green-700',
  events: 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 border-purple-300 dark:border-purple-700',
  all: 'bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-100 border-gray-400 dark:border-gray-500',
}

export default function AffectsMultiSelect({ selected, onChange, label }: AffectsMultiSelectProps) {
  const { t } = useTranslation('absences')

  const isAll = selected.includes(ALL_VALUE) || selected.length === 0

  function toggle(value: string) {
    if (value === ALL_VALUE) {
      onChange([ALL_VALUE])
      return
    }
    const without = selected.filter((a) => a !== ALL_VALUE)
    const toggled = without.includes(value)
      ? without.filter((a) => a !== value)
      : [...without, value]
    // All three selected → collapse to 'all'; none selected → default to 'all'.
    if (toggled.length === 0 || toggled.length === AFFECTS_OPTIONS.length) {
      onChange([ALL_VALUE])
    } else {
      onChange(toggled)
    }
  }

  const labelMap: Record<string, string> = {
    trainings: t('affectsTrainings'),
    games: t('affectsGames'),
    events: t('affectsEvents'),
    all: t('affectsAll'),
  }

  function pillClass(active: boolean, value: string) {
    const base = 'inline-flex min-h-[36px] items-center rounded-full border px-3 py-1 text-sm font-medium transition-colors'
    return active
      ? `${base} ${AFFECTS_ACTIVE[value]}`
      : `${base} ${INACTIVE_PILL} hover:bg-gray-50 dark:hover:bg-gray-700/50`
  }

  return (
    <div>
      {label && (
        <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">{label}</label>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => toggle(ALL_VALUE)}
          className={pillClass(isAll, ALL_VALUE)}
          aria-pressed={isAll}
        >
          {labelMap.all}
        </button>
        {AFFECTS_OPTIONS.map((value) => {
          const active = !isAll && selected.includes(value)
          return (
            <button
              key={value}
              type="button"
              onClick={() => toggle(value)}
              className={pillClass(active, value)}
              aria-pressed={active}
            >
              {labelMap[value]}
            </button>
          )
        })}
      </div>
    </div>
  )
}
