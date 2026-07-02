import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import type { Warning } from '../utils/participationWarnings'

interface Props {
  warnings: Warning[]
  namespace?: string
}

// Severity order: lower rank sorts first (most severe on top).
const LEVEL_RANK: Record<string, number> = { red: 0, yellow: 1 }

export default function ParticipationWarningBadge({ warnings, namespace = 'participation' }: Props) {
  const { t } = useTranslation(namespace)

  const sorted = useMemo(
    () => [...warnings].sort((a, b) => (LEVEL_RANK[a.level] ?? 99) - (LEVEL_RANK[b.level] ?? 99)),
    [warnings],
  )

  if (sorted.length === 0) return null

  // Show the highest-severity icon
  const highestLevel = sorted[0].level

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-0.5 rounded p-0.5 hover:bg-muted/50 focus:outline-none"
          aria-label={t('warnings')}
        >
          <AlertTriangle
            className={`h-4 w-4 ${
              highestLevel === 'red'
                ? 'text-red-500 dark:text-red-400'
                : 'text-amber-500 dark:text-amber-400'
            }`}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto max-w-64 p-2" side="bottom" align="end">
        <ul className="space-y-1 text-xs">
          {sorted.map((w, i) => (
            <li key={i} className="flex items-start gap-1.5">
              <AlertTriangle
                className={`mt-0.5 h-3 w-3 shrink-0 ${
                  w.level === 'red'
                    ? 'text-red-500 dark:text-red-400'
                    : 'text-amber-500 dark:text-amber-400'
                }`}
              />
              <span className={w.level === 'red' ? 'font-medium text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-300'}>
                {t(w.key, w.params ?? {})}
              </span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
