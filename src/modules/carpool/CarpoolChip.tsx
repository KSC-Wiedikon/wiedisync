import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Car } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAuth } from '../../hooks/useAuth'
import { inCarpoolScope } from './carpoolFormat'
import CarpoolDialog from './CarpoolDialog'
import type { CarpoolActivityType } from './carpoolApi'

interface CarpoolChipProps {
  type: CarpoolActivityType
  id: string | number
  /** Icon only (dense rows); the label is still the accessible name. */
  iconOnly?: boolean
  className?: string
  /** The activity's `carpool_teams` (migration 379) — hides the chip for viewers outside it. */
  scope?: readonly (string | number)[] | null
}

/**
 * Car pooling entry point on an activity card. Opens the board in its own
 * dialog. The wrapper swallows clicks: React bubbles events out of a portal
 * through the component tree, so without it every click inside the dialog would
 * also hit the card's own onClick and open the detail modal underneath.
 */
export default function CarpoolChip({ type, id, iconOnly = false, className = '', scope }: CarpoolChipProps) {
  const { t } = useTranslation('carpool')
  const { memberTeamIds, coachTeamIds, isAdmin } = useAuth()
  const [open, setOpen] = useState(false)
  // Admins pass the server's scope check, so they keep the chip.
  if (!isAdmin && !inCarpoolScope(scope, [...memberTeamIds, ...coachTeamIds])) return null
  return (
    <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} className="contents">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label={t('chip')}
        title={t('chip')}
        className={cn(
          'gap-1 rounded-full bg-sky-100 px-2.5 font-semibold text-sky-800 hover:bg-sky-200 hover:text-sky-800 dark:bg-sky-900/50 dark:text-sky-200 dark:hover:bg-sky-900 dark:hover:text-sky-200 [&_svg]:size-3.5',
          className,
        )}
      >
        <Car aria-hidden />
        {!iconOnly && <span className="hidden sm:inline">{t('chip')}</span>}
      </Button>
      {open && <CarpoolDialog type={type} id={id} open={open} onOpenChange={setOpen} />}
    </span>
  )
}
