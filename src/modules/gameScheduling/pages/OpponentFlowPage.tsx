import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAvailableSlots, type InviteGame } from '../hooks/useAvailableSlots'
import HomeSlotPicker from '../components/HomeSlotPicker'
import AwayProposalForm from '../components/AwayProposalForm'
import BookingStatusBadge from '../components/BookingStatusBadge'
import LoadingSpinner from '../../../components/LoadingSpinner'
import { Badge } from '../../../components/ui/badge'

const SUPPORT_EMAIL = 'volleyball@kscw.ch'

function formatGameDateTime(iso: string | null, locale: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  // Always Swiss dd.mm.yyyy. The weekday segment localizes to user's
  // language but the date numbers stay dotted day-first regardless.
  // See CLAUDE.md → Time & Date Formatting.
  void locale
  return d.toLocaleString('de-CH', {
    weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

function GameContextCard({
  games,
  opponentTeamName,
  kscwTeamName,
}: {
  games: InviteGame[]
  opponentTeamName: string
  kscwTeamName: string
}) {
  const { t, i18n } = useTranslation('gameScheduling')
  if (games.length === 0) return null
  return (
    <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
          {t('inviteGamesHeader', { count: games.length })}
        </h2>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {kscwTeamName} {opponentTeamName ? `vs. ${opponentTeamName}` : ''}
        </span>
      </div>
      <ul className="divide-y divide-gray-100 text-sm dark:divide-gray-700">
        {games.map((g) => (
          <li key={g.id} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <div className="font-medium text-gray-800 dark:text-gray-200">
                {formatGameDateTime(g.starting_date_time, i18n.language)}
              </div>
              <div className="truncate text-xs text-gray-500 dark:text-gray-400">
                {g.display_name}
                {g.league ? ` · ${g.league}` : ''}
              </div>
            </div>
            <Badge variant={g.is_home_kscw ? 'info' : 'neutral'} size="sm">
              {g.is_home_kscw ? t('inviteGameHome') : t('inviteGameAway')}
            </Badge>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function OpponentFlowPage() {
  const { token } = useParams<{ token: string }>()
  const { t } = useTranslation('gameScheduling')
  const { opponent, games, slots, bookings, blockedStrict, blockedLoose, seasonWindow, isLoading, error, bookHomeSlot, proposeAway } = useAvailableSlots(token)
  const [bookingError, setBookingError] = useState('')
  const [bookingSuccess, setBookingSuccess] = useState('')

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <LoadingSpinner />
      </div>
    )
  }

  if (error || !opponent) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 dark:bg-gray-900">
        <div className="text-center">
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t('invalidLink')}</h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">{error || t('tokenNotFound')}</p>
        </div>
      </div>
    )
  }

  const homeBooking = bookings.find((b) => b.type === 'home_slot_pick')
  const awayBooking = bookings.find((b) => b.type === 'away_proposal')
  const isInvited = opponent.source !== 'self_registration'
  const greeting = opponent.contact_name
    ? t('inviteGreeting', { name: opponent.contact_name })
    : t('inviteGreetingNoName')

  const handleBookSlot = async (slotId: string) => {
    setBookingError('')
    setBookingSuccess('')
    try {
      await bookHomeSlot(slotId)
      setBookingSuccess(t('slotBooked'))
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('slot_unavailable')) setBookingError(t('slotUnavailable'))
      else if (msg.includes('conflict_same_day')) setBookingError(t('conflictSameDay'))
      else if (msg.includes('conflict_gap_rule')) setBookingError(t('conflictGapRule'))
      else if (msg.includes('conflict_closure')) setBookingError(t('conflictClosure'))
      else if (msg.includes('conflict_cross_team')) setBookingError(t('conflictCrossTeam', { teams: '' }))
      else setBookingError(msg)
    }
  }

  const handleProposeAway = async (proposals: Array<{ date: string; start_time: string; location: string }>) => {
    setBookingError('')
    setBookingSuccess('')
    try {
      await proposeAway(proposals)
      setBookingSuccess(t('proposalsSubmitted'))
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setBookingError(msg)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8 dark:bg-gray-900">
      <div className="mx-auto max-w-4xl">
        {/* Header */}
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('publicTitle')}</h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            {opponent.club_name} vs. KSCW {opponent.kscw_team_name}
          </p>
        </div>

        {/* Invite welcome + contact confirmation (only for admin-issued invites) */}
        {isInvited && (
          <div className="mb-6 rounded-xl border border-brand-200 bg-brand-50 p-5 dark:border-brand-900 dark:bg-brand-900/20">
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{greeting}</p>
            <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
              {t('inviteWelcome', { team: opponent.kscw_team_name })}
            </p>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              {t('inviteContactHint', { email: opponent.contact_email })}{' '}
              <a href={`mailto:${SUPPORT_EMAIL}`} className="underline hover:text-gray-700 dark:hover:text-gray-200">
                {SUPPORT_EMAIL}
              </a>
              .
            </p>
          </div>
        )}

        {/* SVRZ games context card */}
        <GameContextCard
          games={games}
          opponentTeamName={opponent.team_name || opponent.club_name}
          kscwTeamName={opponent.kscw_team_name}
        />

        {/* Feedback messages */}
        {bookingError && (
          <div className="mb-4 rounded-md bg-red-50 p-4 text-sm text-red-800 dark:bg-red-900/30 dark:text-red-300">
            {bookingError}
          </div>
        )}
        {bookingSuccess && (
          <div className="mb-4 rounded-md bg-green-50 p-4 text-sm text-green-800 dark:bg-green-900/30 dark:text-green-300">
            {bookingSuccess}
          </div>
        )}

        {/* Two-column layout */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Home game — opponent picks a KSCW slot */}
          <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {t('homeGameTitle')}
              </h2>
              {homeBooking && <BookingStatusBadge status={homeBooking.status} />}
            </div>
            <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">{t('homeGameDesc')}</p>

            {homeBooking ? (
              <div className="rounded-md bg-green-50 p-4 dark:bg-green-900/20">
                <p className="text-sm font-medium text-green-800 dark:text-green-300">{t('slotBooked')}</p>
              </div>
            ) : (
              <HomeSlotPicker slots={slots} onPickSlot={handleBookSlot} />
            )}
          </div>

          {/* Away game — opponent proposes 3 slots */}
          <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {t('awayGameTitle')}
              </h2>
              {awayBooking && <BookingStatusBadge status={awayBooking.status} />}
            </div>
            <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">{t('awayGameDesc')}</p>

            {awayBooking?.status === 'confirmed' ? (
              <div className="rounded-md bg-green-50 p-4 dark:bg-green-900/20">
                <p className="text-sm font-medium text-green-800 dark:text-green-300">{t('confirmed')}</p>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                  {awayBooking[`proposed_datetime_${awayBooking.confirmed_proposal}` as keyof typeof awayBooking] as string}
                  {' — '}
                  {awayBooking[`proposed_place_${awayBooking.confirmed_proposal}` as keyof typeof awayBooking] as string}
                </p>
              </div>
            ) : (
              <AwayProposalForm
                existingProposal={awayBooking || undefined}
                blockedStrict={blockedStrict}
                blockedLoose={blockedLoose}
                seasonWindow={seasonWindow}
                onSubmit={handleProposeAway}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
