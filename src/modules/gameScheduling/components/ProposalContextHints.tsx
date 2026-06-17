import { useTranslation } from 'react-i18next'
import { formatDateCompactZurich } from '../../../utils/dateHelpers'
import type { ProposalHealthProposal } from '../../../types'

interface Props {
  hp?: ProposalHealthProposal
  /** Show the absent-players line. Home picks 1 & 2 are strict (0 absences), so
   *  the caller suppresses it there; away + home pick 3 show it. */
  showAbsences?: boolean
}

/**
 * Spielplaner decision aids shown under a proposed slot/date: who would be
 * absent that day, and how the date spaces against the team's nearest already-
 * scheduled games (days since the previous, days until the next). Admin-only —
 * fed by /admin/terminplanung/proposal-health.
 */
export default function ProposalContextHints({ hp, showAbsences = true }: Props) {
  const { t } = useTranslation('gameScheduling')
  if (!hp) return null

  const names = hp.absent_names ?? []
  const count = hp.absences ?? 0
  const gap: string[] = []
  if (hp.prev_game) gap.push(t('gapAfterPrev', { days: hp.prev_game.days, date: formatDateCompactZurich(hp.prev_game.date) }))
  if (hp.next_game) gap.push(t('gapBeforeNext', { days: hp.next_game.days, date: formatDateCompactZurich(hp.next_game.date) }))

  const absenceLine = !showAbsences
    ? null
    : names.length > 0
      ? <p className="text-xs text-amber-600 dark:text-amber-400">{t('absentPlayers', { names: names.join(', ') })}</p>
      : count > 0
        ? <p className="text-xs text-amber-600 dark:text-amber-400">{t('absentCount', { count })}</p>
        : null

  if (!absenceLine && gap.length === 0) return null

  return (
    <>
      {absenceLine}
      {gap.length > 0 && <p className="text-xs text-gray-500 dark:text-gray-400">{gap.join(' · ')}</p>}
    </>
  )
}
