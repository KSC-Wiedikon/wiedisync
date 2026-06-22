import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { UserX } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../../components/ui/popover'
import type { AbsentMember } from './utils/absencesByDate'

interface AbsenceBadgeProps {
  absent: AbsentMember[]
}

/**
 * Amber count badge for a single day, listing who is unavailable for games on
 * open. Opens on hover (desktop) and click/tap (touch); stops propagation so it
 * never triggers the day cell's add-game affordance.
 */
export default function AbsenceBadge({ absent }: AbsenceBadgeProps) {
  const { t } = useTranslation('spielplanung')
  const [open, setOpen] = useState(false)
  if (absent.length === 0) return null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setOpen((o) => !o)
          }}
          onMouseEnter={() => setOpen(true)}
          aria-label={t('absenceBadge.aria', { count: absent.length })}
          className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-px text-[10px] font-semibold leading-none text-amber-700 transition-colors hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:hover:bg-amber-900/60"
        >
          <UserX className="h-2.5 w-2.5" aria-hidden />
          {absent.length}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-56 space-y-1.5 p-2 text-xs"
        side="right"
        align="start"
        onClick={(e) => e.stopPropagation()}
        onMouseLeave={() => setOpen(false)}
      >
        <div className="font-semibold text-foreground">
          {t('absenceBadge.title', { count: absent.length })}
        </div>
        <ul className="space-y-0.5">
          {absent.map((m) => (
            <li
              key={m.memberId}
              className="flex items-center justify-between gap-2 text-muted-foreground"
            >
              <span className="min-w-0 truncate">{m.name}</span>
              {m.teams.length > 0 && (
                <span className="shrink-0 text-[10px] opacity-70">{m.teams.join(', ')}</span>
              )}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
