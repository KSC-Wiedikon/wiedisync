import { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAvailableSlots } from '../hooks/useAvailableSlots'
import HomeProposalForm from '../components/HomeProposalForm'
import AwayProposalForm from '../components/AwayProposalForm'
import LoadingSpinner from '../../../components/LoadingSpinner'
import { Badge } from '../../../components/ui/badge'
import LanguageDropdown from '../../../components/LanguageDropdown'

const SUPPORT_EMAIL = 'volleyball@spielplanung.kscw.ch'

// Always Swiss formatting regardless of UI language (CLAUDE.md → date format).
function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleString('de-CH', {
    weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

function fmtDate(ymd: string | undefined): string {
  if (!ymd) return ''
  const d = new Date(`${ymd}T00:00:00`)
  if (Number.isNaN(d.getTime())) return String(ymd)
  return d.toLocaleDateString('de-CH', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
}

type LegStatus = 'open' | 'proposed' | 'confirmed'

export default function OpponentFlowPage() {
  const { token } = useParams<{ token: string }>()
  const { t, i18n } = useTranslation('gameScheduling')
  const { opponent, slots, bookings, blockedStrict, blockedLoose, seasonWindow, isLoading, error, proposeHome, proposeAway, setLanguage } =
    useAvailableSlots(token)
  const [bookingError, setBookingError] = useState('')
  const [bookingSuccess, setBookingSuccess] = useState('')

  // Language memory: restore the opponent's saved language once their record
  // loads, then persist whenever they flip the switcher so emails match.
  const didInitLang = useRef(false)
  useEffect(() => {
    if (didInitLang.current || !opponent) return
    didInitLang.current = true
    if (opponent.language && opponent.language !== i18n.language) {
      i18n.changeLanguage(opponent.language)
    }
  }, [opponent, i18n])
  useEffect(() => {
    if (!didInitLang.current) return
    setLanguage((i18n.language || '').split('-')[0].toLowerCase())
  }, [i18n.language, setLanguage])

  // Only blank to a spinner on the very first load. Booking / proposing refetch
  // the slots (isLoading flips back to true) — without the `!opponent` guard the
  // whole page flashed to a spinner on every submit, reading as a page reload.
  if (isLoading && !opponent) {
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

  const oppName = opponent.club_name || opponent.team_name || ''
  const kscwName = `KSCW ${opponent.kscw_team_name}`
  const homeMatch = `${kscwName} – ${oppName}` // KSCW hosts
  const awayMatch = `${oppName} – ${kscwName}` // opponent hosts

  const homeStatus: LegStatus = !homeBooking ? 'open' : homeBooking.status === 'confirmed' ? 'confirmed' : 'proposed'
  const awayStatus: LegStatus = !awayBooking ? 'open' : awayBooking.status === 'confirmed' ? 'confirmed' : 'proposed'

  const statusBadge = (s: LegStatus) => {
    const map: Record<LegStatus, { v: 'neutral' | 'warning' | 'success'; l: string }> = {
      open: { v: 'neutral', l: t('legOpen', { defaultValue: 'Open' }) },
      proposed: { v: 'warning', l: t('legProposed', { defaultValue: 'Proposed' }) },
      confirmed: { v: 'success', l: t('legConfirmed', { defaultValue: 'Confirmed' }) },
    }
    const m = map[s]
    return (
      <Badge variant={m.v} size="sm">
        {m.l}
      </Badge>
    )
  }

  // Map a scheduling API error to a localized message. kscwApi attaches the
  // parsed JSON body as err.body; the backend puts a stable code in body.error
  // (e.g. 'conflict_sat_cap') plus optional body.teams for cross-team conflicts.
  const schedErrorMessage = (err: unknown): string => {
    const body = (err as { body?: { error?: string; teams?: string } })?.body
    const code = body?.error || ''
    switch (code) {
      case 'conflict_sat_cap': return t('conflictSatCap')
      case 'conflict_cross_team': return t('conflictCrossTeam', { teams: body?.teams || '' })
      case 'away_no_sunday': return t('awayNoSunday')
      case 'away_max_one_saturday': return t('awayMaxOneSaturday')
      case 'slot_unavailable': return t('slotUnavailable')
      case 'conflict_same_day': return t('conflictSameDay')
      case 'conflict_gap_rule': return t('conflictGapRule')
      case 'conflict_closure': return t('conflictClosure')
      // Otherwise show the backend's human message if present, else a generic one.
      default: return body?.error || (err instanceof Error ? err.message : String(err))
    }
  }

  const handleProposeHome = async (slotIds: string[]) => {
    setBookingError('')
    setBookingSuccess('')
    try {
      await proposeHome(slotIds)
      setBookingSuccess(t('homeProposalsSubmitted'))
    } catch (err: unknown) {
      setBookingError(schedErrorMessage(err))
    }
  }

  const handleProposeAway = async (proposals: Array<{ date: string; start_time: string; location: string }>) => {
    setBookingError('')
    setBookingSuccess('')
    try {
      await proposeAway(proposals)
      setBookingSuccess(t('proposalsSubmitted'))
    } catch (err: unknown) {
      setBookingError(schedErrorMessage(err))
    }
  }

  const decidedAway = awayBooking?.confirmed_proposal
    ? (awayBooking[`proposed_datetime_${awayBooking.confirmed_proposal}` as keyof typeof awayBooking] as string)
    : ''

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8 dark:bg-gray-900">
      <div className="mx-auto max-w-4xl">
        <div className="mb-2 flex justify-end">
          <LanguageDropdown size="sm" />
        </div>
        {/* Header */}
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('publicTitle')}</h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            {oppName} · KSCW {opponent.kscw_team_name}
          </p>
        </div>

        {/* Invite welcome (admin-issued invites only) */}
        {isInvited && (
          <div className="mb-6 rounded-xl border border-brand-200 bg-brand-50 p-5 dark:border-brand-900 dark:bg-brand-900/20">
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{greeting}</p>
            <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">{t('inviteWelcome', { team: opponent.kscw_team_name })}</p>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              {t('inviteContactHint', { email: opponent.contact_email })}{' '}
              <a href={`mailto:${SUPPORT_EMAIL}`} className="underline hover:text-gray-700 dark:hover:text-gray-200">
                {SUPPORT_EMAIL}
              </a>
              .
            </p>
          </div>
        )}

        {bookingError && (
          <div className="mb-4 rounded-md bg-red-50 p-4 text-sm text-red-800 dark:bg-red-900/30 dark:text-red-300">{bookingError}</div>
        )}
        {bookingSuccess && (
          <div className="mb-4 rounded-md bg-green-50 p-4 text-sm text-green-800 dark:bg-green-900/30 dark:text-green-300">{bookingSuccess}</div>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Home leg — KSCW hosts; opponent picks a slot in our hall */}
          <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
            <div className="mb-1 flex items-start justify-between gap-2">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{homeMatch}</h2>
              {statusBadge(homeStatus)}
            </div>
            <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">{t('homeGameDesc')}</p>

            {homeBooking?.status === 'confirmed' ? (
              <div className="rounded-md bg-green-50 p-4 dark:bg-green-900/20">
                <p className="text-sm font-medium text-green-800 dark:text-green-300">{t('slotBooked')}</p>
                <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
                  {fmtDate(homeBooking.slot_date)} · {homeBooking.slot_start}–{homeBooking.slot_end}
                  {homeBooking.slot_hall_name ? ` · ${homeBooking.slot_hall_name}` : ''}
                </p>
              </div>
            ) : (
              <>
                {homeBooking?.status === 'pending' && homeBooking.proposed_slots && (
                  <div className="mb-4 rounded-md bg-yellow-50 p-3 dark:bg-yellow-900/20">
                    <p className="text-sm font-medium text-yellow-800 dark:text-yellow-300">{t('homeProposalsPending')}</p>
                    <ul className="mt-1 space-y-0.5">
                      {homeBooking.proposed_slots.map((p, idx) => (
                        <li key={idx} className="text-sm text-gray-700 dark:text-gray-300">
                          {p.date ? `${fmtDate(p.date)} · ${p.start}–${p.end}${p.hall_name ? ` · ${p.hall_name}` : ''}` : t('slotN', { number: idx + 1 })}
                          {!p.available && <span className="ml-2 text-xs text-red-600 dark:text-red-400">⚠ {t('slotMaybeTaken')}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <HomeProposalForm
                  slots={slots}
                  existing={homeBooking?.status === 'pending' ? homeBooking : undefined}
                  onSubmit={handleProposeHome}
                />
              </>
            )}
          </div>

          {/* Away leg — opponent hosts; opponent proposes 3 dates in their hall */}
          <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
            <div className="mb-1 flex items-start justify-between gap-2">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{awayMatch}</h2>
              {statusBadge(awayStatus)}
            </div>
            <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">{t('awayGameDesc')}</p>

            {awayBooking?.status === 'confirmed' ? (
              <div className="rounded-md bg-green-50 p-4 dark:bg-green-900/20">
                <p className="text-sm font-medium text-green-800 dark:text-green-300">{t('confirmed')}</p>
                <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">{fmtDateTime(decidedAway)}</p>
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
