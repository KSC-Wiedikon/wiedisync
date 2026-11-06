import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import type { Game } from '../../../types'
import { formatDateTimeCompactZurich } from '../../../utils/dateHelpers'
import { nominationErrorText } from '../utils/nominationError'

/** Einsatzliste push journal (`games.vm_nomination_status`) → copy + colour.
 *  `filled` is NOT a failure: the players are saved in Volleymanager, which flags something
 *  fineable (too many or too few players, no coach) for the coach to fix. Hence amber, not red. */
export type NominationStatus = NonNullable<Game['vm_nomination_status']>

const STATUS_KEY: Record<NominationStatus, string> = {
  pending: 'nominationStatusPending',
  saved: 'nominationStatusSaved',
  filled: 'nominationStatusFilled',
  closed: 'nominationStatusClosed',
  skipped: 'nominationStatusSkipped',
  failed: 'nominationStatusFailed',
}

const STATUS_TONE: Record<NominationStatus, string> = {
  pending: 'border-border bg-surface-sunken text-foreground/85',
  saved: 'border-green-300 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-200',
  filled: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200',
  closed: 'border-border bg-surface-sunken text-foreground/85',
  skipped: 'border-border bg-surface-sunken text-muted-foreground',
  failed: 'border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200',
}

/** How the list in Volleymanager stands: in the game modal and on the match sheet. Read-only. */
export default function NominationStatusBox({ status, count, pushedAt, error, className = '' }: {
  status: NominationStatus
  count?: number | null
  pushedAt?: string | null
  error?: string | null
  className?: string
}) {
  const { t } = useTranslation('games')
  return (
    <div className={`space-y-1.5 rounded-lg border p-3 text-sm ${STATUS_TONE[status]} ${className}`}>
      <p className="flex items-start gap-2">
        {status === 'filled' && <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
        <span>{t(STATUS_KEY[status])}</span>
      </p>
      {(typeof count === 'number' || pushedAt) && (
        <p className="text-xs opacity-80">
          {[
            typeof count === 'number' ? t('nominationCount', { n: count }) : '',
            pushedAt ? t('nominationPushedAt', { when: formatDateTimeCompactZurich(pushedAt) }) : '',
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}
      {error && (
        <p className="text-xs break-words opacity-90">
          {t('nominationError', { error: nominationErrorText(error, t) })}
        </p>
      )}
    </div>
  )
}
