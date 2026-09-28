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
    <div className={cn('inline-flex h-11 items-center gap-0.5 rounded-lg border border-border bg-card p-0.5 sm:h-8', className)}>
      {items.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          aria-label={opt.value === 'all' ? t('allSports') : opt.label}
          className={cn(
            'flex h-full min-w-11 items-center justify-center rounded-md px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-w-9',
            value === opt.value
              ? 'bg-selected text-selected-foreground'
              : 'text-muted-foreground hover:text-foreground',
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
