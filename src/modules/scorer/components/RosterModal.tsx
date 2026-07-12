import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '@/components/Modal'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import LoadingSpinner from '../../../components/LoadingSpinner'
import { kscwApi } from '../../../lib/api'
import { formatDateZurich } from '../../../utils/dateHelpers'

interface RosterRow {
  number: number | null
  last_name: string
  first_initial: string
  birthdate: string | null
  is_captain?: boolean
}

interface CoachRow {
  last_name: string
  first_initial: string
  birthdate: string | null
}

interface RosterResponse {
  data: {
    game: { home_team: string; away_team: string; date: string; time: string | null }
    roster: RosterRow[]
    coaches?: CoachRow[]
  }
}

interface RosterModalProps {
  /** DB id of the game whose home roster to show. */
  gameId: string
  onClose: () => void
}

/**
 * Home-team match sheet for the assigned scorer (Schreiber): CONFIRMED players
 * only (captain flagged) plus the team's coaches, shown from 40 min before the
 * game until it ends. Data comes from the time-gated /kscw/scorer/game/:id/roster
 * endpoint — the only place full DoB (incl. minors) is exposed, for match-sheet
 * eligibility checks. The component never holds roster data outside this modal.
 */
export default function RosterModal({ gameId, onClose }: RosterModalProps) {
  const { t } = useTranslation('scorer')
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<RosterResponse['data'] | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setErrorCode(null)
    setData(null)
    kscwApi<RosterResponse>(`/scorer/game/${gameId}/roster`)
      .then((res) => { if (!cancelled) setData(res.data) })
      .catch((err: Error & { code?: string }) => {
        if (!cancelled) setErrorCode(err.code || 'error')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [gameId])

  const errorMessage = (code: string): string => {
    switch (code) {
      case 'outside_window': return t('rosterOutsideWindow')
      case 'not_scorer': return t('rosterNotScorer')
      case 'not_home': return t('rosterNotHome')
      case 'no_time': return t('rosterNoTime')
      default: return t('rosterError')
    }
  }

  return (
    <Modal open onClose={onClose} title={t('rosterTitle')} size="md" disableAutoFocus>
      {data && (
        <>
          <p className="mb-1 text-sm font-medium text-gray-700 dark:text-gray-300">
            {data.game.home_team} – {data.game.away_team}
          </p>
          <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">{t('rosterConfirmedOnly')}</p>
        </>
      )}

      {loading && <div className="py-8"><LoadingSpinner /></div>}

      {!loading && errorCode && (
        <p className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">
          {errorMessage(errorCode)}
        </p>
      )}

      {!loading && data && (() => {
        const coaches = data.coaches ?? []
        if (data.roster.length === 0 && coaches.length === 0) {
          return <p className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">{t('rosterEmpty')}</p>
        }
        return (
          <div className="space-y-5">
            {data.roster.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">{t('rosterColNumber')}</TableHead>
                    <TableHead>{t('rosterColName')}</TableHead>
                    <TableHead className="text-right">{t('rosterColDob')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.roster.map((r, i) => (
                    <TableRow key={`p-${r.last_name}-${r.number ?? 'x'}-${i}`}>
                      <TableCell className="font-semibold tabular-nums">{r.number ?? '—'}</TableCell>
                      <TableCell className="whitespace-normal break-words">
                        {r.last_name}{r.first_initial ? `, ${r.first_initial}` : ''}
                        {r.is_captain && (
                          <span
                            title={t('rosterCaptain')}
                            className="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-brand-600 align-middle text-[10px] font-bold text-white dark:bg-brand-500"
                          >
                            {t('rosterCaptainShort')}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.birthdate ? formatDateZurich(r.birthdate) : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-center text-sm text-gray-500 dark:text-gray-400">{t('rosterNoConfirmed')}</p>
            )}

            {coaches.length > 0 && (
              <div>
                <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  {t('rosterCoaches')}
                </h4>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('rosterColName')}</TableHead>
                      <TableHead className="text-right">{t('rosterColDob')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {coaches.map((c, i) => (
                      <TableRow key={`c-${c.last_name}-${i}`}>
                        <TableCell className="whitespace-normal break-words">
                          {c.last_name}{c.first_initial ? `, ${c.first_initial}` : ''}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {c.birthdate ? formatDateZurich(c.birthdate) : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )
      })()}
    </Modal>
  )
}
