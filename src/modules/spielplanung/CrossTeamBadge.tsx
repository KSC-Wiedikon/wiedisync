import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Users } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../../components/ui/popover'
import type { CrossTeamConflict } from './hooks/useCrossTeamConflicts'

interface CrossTeamBadgeProps {
  conflicts: CrossTeamConflict[]
}

/**
 * Sky count badge for a single day, listing the roster-sharing teams that play
 * that day (which block a home slot for the selected team). Opens on hover
 * (desktop) and click/tap (touch); stops propagation so it never triggers the day
 * cell's add-game affordance. Mirrors AbsenceBadge.
 */
export default function CrossTeamBadge({ conflicts }: CrossTeamBadgeProps) {
  const { t } = useTranslation('spielplanung')
  const [open, setOpen] = useState(false)
  if (conflicts.length === 0) return null

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
          aria-label={t('crossTeamBadge.aria', { count: conflicts.length })}
          className="inline-flex items-center gap-0.5 rounded-full bg-sky-100 px-1.5 py-px text-[10px] font-semibold leading-none text-sky-700 transition-colors hover:bg-sky-200 dark:bg-sky-900/40 dark:text-sky-300 dark:hover:bg-sky-900/60"
        >
          <Users className="h-2.5 w-2.5" aria-hidden />
          {conflicts.length}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-60 space-y-1.5 p-2 text-xs"
        side="right"
        align="start"
        onClick={(e) => e.stopPropagation()}
        onMouseLeave={() => setOpen(false)}
      >
        <div className="font-semibold text-foreground">
          {t('crossTeamBadge.title', { count: conflicts.length })}
        </div>
        <ul className="space-y-1">
          {conflicts.map((c) => (
            <li key={`${c.teamId}-${c.kind}`} className="text-muted-foreground">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate font-medium text-foreground">{c.teamName}</span>
                <span className="shrink-0 text-[10px] opacity-70">{t(`crossTeamBadge.kind.${c.kind}`)}</span>
              </div>
              {c.matchup && <div className="truncate opacity-80">{c.matchup}</div>}
            </li>
          ))}
        </ul>
        <div className="border-t border-border pt-1 text-[10px] opacity-70">
          {t('crossTeamBadge.hint')}
        </div>
      </PopoverContent>
    </Popover>
  )
}
