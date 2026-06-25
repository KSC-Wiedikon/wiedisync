import { useMemo } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../../hooks/useAuth'
import { useTeams } from '../../../hooks/useTeams'
import { useReportPageLoading } from '../../../hooks/usePageReady'
import { useGameSchedulingSeason } from '../hooks/useGameSchedulingSeason'
import { useAdminBookings } from '../hooks/useAdminBookings'
import { useMailbox, contactAddressSet, type MailboxSport, type OpponentContacts } from '../hooks/useMailbox'
import { isSchedulableTeam } from '../utils/schedulableTeams'
import MailboxPanel from '../components/MailboxPanel'
import type { GameSchedulingOpponent } from '../../../types'

/**
 * Standalone Mailbox tab for the Spielplanung shell. A Volleyball/Basketball
 * toggle (gated to the sports the user can access) switches between the two
 * Migadu mailboxes — volleyball@ and basketball@spielplanung.kscw.ch. The
 * volleyball view keeps the opponent-classification tooling (chips, per-opponent
 * thread, assign); the basketball view is a plain inbox (basketball has no
 * opponent scheduling). A `?opponent=<id>` deep-link (from the dashboard's
 * "N emails" button) opens that opponent's thread.
 */
export default function MailboxPage() {
  const { t } = useTranslation('gameScheduling')
  const { hasAdminAccessToSport, is_spielplaner } = useAuth()
  const canVB = hasAdminAccessToSport('volleyball') || is_spielplaner
  const canBB = hasAdminAccessToSport('basketball')

  const [searchParams, setSearchParams] = useSearchParams()
  // Active sport from the URL, clamped to what the user can access.
  const urlSport = searchParams.get('sport')
  const sport: MailboxSport =
    urlSport === 'basketball' && canBB ? 'basketball'
      : urlSport === 'volleyball' && canVB ? 'volleyball'
        : canVB ? 'volleyball' : 'basketball'

  const mailbox = useMailbox(canVB || canBB, sport)

  // Volleyball opponent context (chips / assign / per-opponent thread). Only
  // loaded for the volleyball account — basketball has no opponent rows.
  const { season } = useGameSchedulingSeason()
  const { data: teams } = useTeams()
  const { opponents } = useAdminBookings(sport === 'volleyball' ? season?.id : undefined)

  const schedulableTeams = useMemo(() => (teams || []).filter(isSchedulableTeam), [teams])

  const opponentContacts = useMemo<OpponentContacts[]>(() => {
    if (sport !== 'volleyball') return []
    return opponents.map((o) => {
      const team = schedulableTeams.find((tm) => String(tm.id) === String(o.kscw_team))
      return { opp: o, contacts: contactAddressSet(o), aliases: team?.name ? [team.name] : [] }
    })
  }, [sport, opponents, schedulableTeams])

  const kscwTeamLabelFor = (opp: GameSchedulingOpponent) => {
    const team = schedulableTeams.find((tm) => String(tm.id) === String(opp.kscw_team))
    return team?.full_name || (team?.name ? `KSC Wiedikon ${team.name}` : 'KSC Wiedikon')
  }

  // Per-opponent focus from a dashboard deep-link (?opponent=<id>).
  const focusId = searchParams.get('opponent')
  const focusOpponent = useMemo(
    () => (focusId ? opponents.find((o) => String(o.id) === focusId) ?? null : null),
    [focusId, opponents],
  )

  // First-paint gate: wait for the mailbox list's first response.
  useReportPageLoading(mailbox.configured === null)

  if (!canVB && !canBB) return <Navigate to="/" replace />

  const switchSport = (next: MailboxSport) => {
    // Opponent focus is volleyball-specific — drop it when changing account.
    setSearchParams({ sport: next })
  }

  const clearFocus = () => {
    const next = new URLSearchParams(searchParams)
    next.delete('opponent')
    setSearchParams(next)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-bold text-gray-900 sm:text-2xl dark:text-gray-100">{t('mailboxPageTitle')}</h1>
        {/* Volleyball / Basketball toggle — only when the user can access both. */}
        {canVB && canBB && (
          <div className="inline-flex self-start rounded-lg border border-gray-200 bg-gray-50 p-0.5 dark:border-gray-700 dark:bg-gray-800">
            {(['volleyball', 'basketball'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => switchSport(s)}
                className={`min-h-9 rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                  sport === s
                    ? 'bg-white text-brand-700 shadow-sm dark:bg-gray-900 dark:text-gold-400'
                    : 'text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100'
                }`}
                aria-pressed={sport === s}
              >
                {s === 'volleyball' ? t('mailboxSportVolleyball') : t('mailboxSportBasketball')}
              </button>
            ))}
          </div>
        )}
      </div>

      <MailboxPanel
        mailbox={mailbox}
        sport={sport}
        opponentContacts={opponentContacts}
        focusOpponent={focusOpponent}
        onClearFocus={clearFocus}
        seasonName={season?.season}
        kscwTeamLabelFor={kscwTeamLabelFor}
      />
    </div>
  )
}
