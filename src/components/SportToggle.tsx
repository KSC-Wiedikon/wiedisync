import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import VolleyballIcon from './VolleyballIcon'
import BasketballIcon from './BasketballIcon'
import type { SportView } from '../hooks/useSportPreference'

interface SportToggleProps {
  value: SportView
  onChange: (value: SportView) => void
  showAll?: boolean
  className?: string
}

export { VolleyballIcon, BasketballIcon }

const OPTIONS: { value: SportView; label: string }[] = [
  { value: 'vb', label: 'Volleyball' },
  { value: 'bb', label: 'Basketball' },
  { value: 'all', label: 'All sports' },
]

function SportIcon({ sport }: { sport: SportView }) {
  if (sport === 'vb') return <VolleyballIcon />
  if (sport === 'bb') return <BasketballIcon />
  return null
}

export default function SportToggle({ value, onChange, showAll = true, className = '' }: SportToggleProps) {
  const { t } = useTranslation('common')
  const items = showAll ? OPTIONS : OPTIONS.filter((o) => o.value !== 'all')

  return (
    <div className={cn('flex overflow-hidden rounded-md border border-gray-300 dark:border-gray-600', className)}>
      {items.map((opt, i) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          aria-label={opt.value === 'all' ? t('allSports') : opt.label}
          className={cn(
            'flex items-center justify-center px-3 py-3.5 text-sm font-medium transition-colors',
            value === opt.value
              ? 'bg-brand-100 text-brand-800 dark:bg-brand-700 dark:text-white'
              : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700',
            i > 0 && 'border-l border-gray-300 dark:border-gray-600',
          )}
        >
          {opt.value === 'all' ? (
            <span className="flex items-center gap-1">
              <VolleyballIcon className="h-4 w-4" />
              <BasketballIcon className="h-4 w-4" />
            </span>
          ) : <SportIcon sport={opt.value} />}
        </button>
      ))}
    </div>
  )
}
