import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import { formatDateZurich } from '../../../../utils/dateHelpers'
import { HintPopover } from './HintPopover'
import type { TransferMember } from '../types'

/**
 * Last name on line 1, first name on line 2 — the mobile name-wrap rule.
 *
 * Carries the whole identity a federation is asked to match on (name, birthdate,
 * email), which is why the birthdate lives here rather than in a column of its
 * own: it is not an attribute of the transfer, it is how the player is found.
 */
export function NameCell({ m, teamNames, unrostered }: {
  m: TransferMember; teamNames?: string[]; unrostered?: boolean
}) {
  const { t } = useTranslation('admin')
  const display = (m.nickname && m.nickname.trim()) || m.first_name || ''
  const dob = formatDateZurich(m.birthdate)
  return (
    // min-h keeps the row itself ≥44px on mobile even for a one-word name.
    // ⚠ It lives on THIS div and not on the <td>: min-height on a
    // `display: table-cell` box is unreliable, the row box governs the height.
    <div className="flex min-h-[44px] min-w-0 flex-col justify-center">
      <span className="block text-sm font-medium whitespace-normal break-words text-gray-900 dark:text-white">
        {m.last_name}
      </span>
      <span className="block text-sm whitespace-normal break-words text-gray-700 dark:text-gray-300">
        {display}
      </span>
      {dob && (
        <span className="text-xs text-gray-500 dark:text-gray-400" title={t('trColBirthdate')}>
          {dob}
        </span>
      )}
      {teamNames && teamNames.length > 0 && (
        <span
          className="text-xs whitespace-normal text-brand-600 dark:text-brand-400"
          title={t('trColTeams')}
        >
          {teamNames.join(', ')}
        </span>
      )}
      {/* Here only because Volleymanager licenses them — the club roster has no
          volleyball row. The transfer still gets worked; the missing roster row
          stays visible so somebody fixes it. */}
      {unrostered && (
        <span className="mt-0.5 flex w-fit items-center gap-1">
          <span
            className="inline-flex w-fit items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium whitespace-normal text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
            title={t('trUnrosteredHint')}
          >
            <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
            {t('trUnrostered')}
          </span>
          {/* The title= above is a desktop-only extra; this is the same sentence
              reachable by tap. */}
          <HintPopover text={t('trUnrosteredHint')} />
        </span>
      )}
      {m.email && (
        <span className="hidden text-xs break-all text-gray-400 sm:block dark:text-gray-500">
          {m.email}
        </span>
      )}
      {m.kscw_membership_active === false && (
        <span className="mt-0.5 block text-xs text-amber-600 dark:text-amber-400">
          {t('trInactive')}
        </span>
      )}
    </div>
  )
}
