import { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAvailableSlots } from '../hooks/useAvailableSlots'
import { gameStartForDate } from '../utils/slotTime'
import type { BookingData, InviteGame } from '../hooks/useAvailableSlots'
import HomeProposalForm from '../components/HomeProposalForm'
import AwayProposalForm from '../components/AwayProposalForm'
import Modal from '../../../components/Modal'
import { useReportPageLoading } from '../../../hooks/usePageReady'
import { Badge } from '../../../components/ui/badge'
import LanguageDropdown from '../../../components/LanguageDropdown'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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

/** One schedulable game = one card. A pairing can be played 2-3× per season
 *  (junior triple round-robin), so each side (home/away) may carry several
 *  fixtures; bookings are matched per fixture via booking.svrz_game_id. */
interface LegCard {
  key: string
  isHome: boolean
  /** Fixture to pass to propose-* (null = legacy/non-SVRZ single-game flow). */
  svrzGameId: string | null
  /** SVRZ fixture number (official game number) shown on the card; null if unknown. */
  number: number | null
  /** 1-based position within its side, and how many games that side has. */
  seq: number
  sideCount: number
  booking?: BookingData
}

// Cards for one side: one per fixture (a NULL-keyed legacy booking belongs to
// the FIRST fixture — mirrors the backend), plus bookings whose fixture is no
// longer in the feed (re-synced/finalized) so a confirmed game never vanishes.
// No fixtures and no bookings → the single legacy card (pre-multi-game flow).
function buildLegCards(games: InviteGame[], bookings: BookingData[], isHome: boolean): LegCard[] {
  const side = games.filter((g) => g.is_home_kscw === isHome)
  const sideBookings = bookings.filter((b) => b.type === (isHome ? 'home_slot_pick' : 'away_proposal'))
  const used = new Set<string>()
  const cards: LegCard[] = side.map((g, i) => {
    let bk = sideBookings.find((b) => String(b.svrz_game_id || '') === String(g.id))
    if (!bk && i === 0) bk = sideBookings.find((b) => b.svrz_game_id == null && !used.has(b.id))
    if (bk) used.add(bk.id)
    return { key: String(g.id), isHome, svrzGameId: g.id, number: g.number ?? null, seq: i + 1, sideCount: side.length, booking: bk }
  })
  for (const b of sideBookings) {
    if (used.has(b.id)) continue
    cards.push({ key: `bk-${b.id}`, isHome, svrzGameId: b.svrz_game_id ?? null, number: null, seq: cards.length + 1, sideCount: side.length, booking: b })
  }
  if (cards.length === 0) {
    cards.push({ key: isHome ? 'legacy-home' : 'legacy-away', isHome, svrzGameId: null, number: null, seq: 1, sideCount: 1 })
  }
  // sideCount drives the "Game N" suffix — recompute after orphans were added.
  return cards.map((c) => ({ ...c, sideCount: cards.length }))
}

export default function OpponentFlowPage() {
  const { token } = useParams<{ token: string }>()
  const { t, i18n } = useTranslation('gameScheduling')
  const { opponent, games, slots, bookings, blockedStrict, blockedLoose, seasonWindow, isLoading, error, proposeHome, proposeAway, saveNote, setLanguage } =
    useAvailableSlots(token)
  const [bookingError, setBookingError] = useState('')
  const [bookingSuccess, setBookingSuccess] = useState('')
  const [submittingSide, setSubmittingSide] = useState<'home' | 'away' | null>(null)
  const [savingRemark, setSavingRemark] = useState(false)
  // "Who is confirming" modal — opened by the side confirm buttons, collects the
  // opponent-club person's name + email so KSCW knows who to follow up with. Kept
  // across home/away within the visit so the 2nd submit is pre-filled.
  const [confirmerSide, setConfirmerSide] = useState<'home' | 'away' | null>(null)
  const [confirmerName, setConfirmerName] = useState('')
  const [confirmerEmail, setConfirmerEmail] = useState('')
  const [confirmerError, setConfirmerError] = useState('')
  // Current proposals reported by each card's form, keyed by card key (null
  // while incomplete) — submitted per side by the buttons below. The
  // per-card onChange handlers are memoised in refs: the forms' report-upward
  // effects depend on the callback identity, so a fresh inline closure per
  // render would re-fire them every render (set-state loop).
  const [homePicksByCard, setHomePicksByCard] = useState<Record<string, string[] | null>>({})
  const [awayProposalsByCard, setAwayProposalsByCard] = useState<Record<string, Array<{ date: string; start_time: string; location: string }> | null>>({})
  const homeChangeHandlers = useRef<Record<string, (picks: string[] | null) => void>>({})
  const homeChangeFor = (key: string) => {
    if (!homeChangeHandlers.current[key]) {
      homeChangeHandlers.current[key] = (picks) =>
        setHomePicksByCard((prev) => (prev[key] === picks ? prev : { ...prev, [key]: picks }))
    }
    return homeChangeHandlers.current[key]
  }
  const awayChangeHandlers = useRef<Record<string, (proposals: Array<{ date: string; start_time: string; location: string }> | null) => void>>({})
  const awayChangeFor = (key: string) => {
    if (!awayChangeHandlers.current[key]) {
      awayChangeHandlers.current[key] = (proposals) =>
        setAwayProposalsByCard((prev) => ({ ...prev, [key]: proposals }))
    }
    return awayChangeHandlers.current[key]
  }
  // Opponent remark box. Seed from the loaded record once, then it's user-owned.
  const [remark, setRemark] = useState('')
  const didInitRemark = useRef(false)
  useEffect(() => {
    if (didInitRemark.current || !opponent) return
    didInitRemark.current = true
    setRemark(opponent.opponent_note || '')
  }, [opponent])

  // Language memory: restore the opponent's saved language once their record
  // loads, then persist whenever they flip the switcher so emails match.
  const didInitLang = useRef(false)
  useEffect(() => {
    if (didInitLang.current || !opponent) return
    didInitLang.current = true
    // The opponent page defaults to German (recipients are Swiss clubs); a
    // previously-saved language choice still wins.
    const lang = opponent.language || 'de'
    if (lang !== i18n.language) i18n.changeLanguage(lang)
  }, [opponent, i18n])
  useEffect(() => {
    if (!didInitLang.current) return
    setLanguage((i18n.language || '').split('-')[0].toLowerCase())
  }, [i18n.language, setLanguage])

  // Only blank the page on the very first load. Booking / proposing refetch
  // the slots (isLoading flips back to true) — without the `!opponent` guard the
  // whole page flashed on every submit, reading as a page reload.
  const isInitialLoading = isLoading && !opponent
  // Report to the app boot gate — see usePageReady.tsx. Runs on every render
  // (before the early returns below) so the hook order stays stable.
  useReportPageLoading(isInitialLoading)

  if (isInitialLoading) return null

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

  // One card per game (multi-game pairings). Home and away are rendered as
  // separate sections, each with its own confirm button beneath.
  const homeCards = buildLegCards(games, bookings, true)
  const awayCards = buildLegCards(games, bookings, false)

  const isInvited = opponent.source !== 'self_registration'
  // Always a generic greeting — an invite's contact_name may list several club
  // contacts, so addressing one (or all) by name reads wrong.
  const greeting = t('inviteGreetingNoName')

  const oppName = opponent.club_name || opponent.team_name || ''
  const kscwName = `KSCW ${opponent.kscw_team_name}`

  const cardTitle = (card: LegCard) => {
    const match = card.isHome ? `${kscwName} – ${oppName}` : `${oppName} – ${kscwName}`
    return card.sideCount > 1 ? `${match} · ${t('gameN', { number: card.seq })}` : match
  }

  const legStatus = (card: LegCard): LegStatus =>
    !card.booking ? 'open' : card.booking.status === 'confirmed' ? 'confirmed' : 'proposed'

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
      case 'away_no_saturday': return t('awayNoSaturday')
      case 'away_max_one_saturday': return t('awayMaxOneSaturday')
      case 'away_before_derby': return t('awayBeforeDerby')
      case 'slot_unavailable': return t('slotUnavailable')
      case 'proposer_required': return t('proposerRequired')
      case 'invalid_email': return t('invalidEmail')
      case 'conflict_same_day': return t('conflictSameDay')
      case 'conflict_gap_rule': return t('conflictGapRule')
      case 'conflict_closure': return t('conflictClosure')
      // Otherwise show the backend's human message if present, else a generic one.
      default: return body?.error || (err instanceof Error ? err.message : String(err))
    }
  }

  // Home and away submit independently — each side has its own button so the
  // opponent can confirm one now and the other later. A confirmed card isn't
  // shown and isn't required; every shown card on a side must be complete before
  // that side's button enables. The remark rides along with whichever side is
  // submitted, and has its own button for note-only edits.
  const isShown = (card: LegCard) => card.booking?.status !== 'confirmed'
  const shownHome = homeCards.filter(isShown)
  const shownAway = awayCards.filter(isShown)
  const remarkChanged = remark.trim() !== (opponent.opponent_note || '').trim()
  const busy = submittingSide !== null || savingRemark
  const canConfirmHome = shownHome.length > 0 && shownHome.every((c) => !!homePicksByCard[c.key])
  const canConfirmAway = shownAway.length > 0 && shownAway.every((c) => !!awayProposalsByCard[c.key])

  // Step 1: the confirm button opens the "who is confirming" modal. The home
  // cross-card duplicate-slot precheck runs here so we don't ask for a name/email
  // and then fail mid-submit.
  const openConfirmer = (side: 'home' | 'away') => {
    setBookingError('')
    setBookingSuccess('')
    if (side === 'home') {
      // Spell out WHAT is missing rather than leaving the button inertly disabled
      // — a greyed-out button with no message reads as "I clicked and nothing
      // happened" (which is exactly how this surfaced for an opponent).
      if (!canConfirmHome) {
        setBookingError(t('homeIncomplete'))
        return
      }
      // Each game needs its own slots — catch cross-card duplicates before
      // submitting (the backend rejects them too, but mid-loop is messier).
      const allHomePicks = shownHome.flatMap((c) => homePicksByCard[c.key] || [])
      if (new Set(allHomePicks).size !== allHomePicks.length) {
        setBookingError(t('duplicateSlotAcrossGames'))
        return
      }
    } else if (!canConfirmAway) {
      // Most common away trap: a date picked but no time set (two separate
      // fields) — tell them instead of silently disabling the button.
      setBookingError(t('awayIncomplete'))
      return
    }
    setConfirmerError('')
    setConfirmerSide(side)
  }

  const handleConfirmSide = async (side: 'home' | 'away', proposer: { name: string; email: string }) => {
    setBookingError('')
    setBookingSuccess('')
    setSubmittingSide(side)
    try {
      if (side === 'home') {
        for (const c of shownHome) {
          const picks = homePicksByCard[c.key]
          if (picks) await proposeHome(picks, c.svrzGameId, proposer)
        }
      } else {
        for (const c of shownAway) {
          const proposals = awayProposalsByCard[c.key]
          if (proposals) await proposeAway(proposals, c.svrzGameId, proposer)
        }
      }
      // Carry the remark along if the opponent edited it while filling this side.
      if (remarkChanged) await saveNote(remark.trim())
      setBookingSuccess(t('proposalsSubmitted'))
    } catch (err: unknown) {
      setBookingError(schedErrorMessage(err))
    } finally {
      setSubmittingSide(null)
    }
  }

  // Step 2: validate the modal's name + email, then submit that side.
  const submitConfirmer = async () => {
    const name = confirmerName.trim()
    const email = confirmerEmail.trim()
    if (!name || !email) { setConfirmerError(t('proposerRequired')); return }
    if (!EMAIL_RE.test(email)) { setConfirmerError(t('invalidEmail')); return }
    const side = confirmerSide
    if (!side) return
    setConfirmerSide(null)
    await handleConfirmSide(side, { name, email })
  }

  const handleSaveRemark = async () => {
    setBookingError('')
    setBookingSuccess('')
    setSavingRemark(true)
    try {
      await saveNote(remark.trim())
      setBookingSuccess(t('remarksSaved'))
    } catch (err: unknown) {
      setBookingError(schedErrorMessage(err))
    } finally {
      setSavingRemark(false)
    }
  }

  const decidedAway = (booking: BookingData) =>
    booking.confirmed_proposal
      ? (booking[`proposed_datetime_${booking.confirmed_proposal}` as keyof BookingData] as string)
      : ''

  // One opponent card (home or away). Confirmed cards render read-only; open
  // cards render the proposal form (submitted by the section's button below).
  const renderCard = (card: LegCard) => (
    <div key={card.key} className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-1 flex items-start justify-between gap-2">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
          {cardTitle(card)}
          {card.number != null && (
            <span className="ml-2 text-sm font-normal text-gray-400 dark:text-gray-500">#{card.number}</span>
          )}
        </h2>
        {statusBadge(legStatus(card))}
      </div>
      <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
        {card.isHome ? t('homeGameDesc') : t('awayGameDesc')}
      </p>

      {card.isHome ? (
        card.booking?.status === 'confirmed' ? (
          <div className="rounded-md bg-green-50 p-4 dark:bg-green-900/20">
            <p className="text-sm font-medium text-green-800 dark:text-green-300">{t('slotBooked')}</p>
            <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
              {fmtDate(card.booking.slot_date)} · {gameStartForDate(card.booking.slot_date, card.booking.slot_start)}
              {card.booking.slot_hall_name ? ` · ${card.booking.slot_hall_name}` : ''}
            </p>
          </div>
        ) : (
          <>
            {card.booking?.status === 'pending' && card.booking.proposed_slots && (
              <div className="mb-4 rounded-md bg-yellow-50 p-3 dark:bg-yellow-900/20">
                <p className="text-sm font-medium text-yellow-800 dark:text-yellow-300">{t('homeProposalsPending')}</p>
                <ul className="mt-1 space-y-0.5">
                  {card.booking.proposed_slots.map((p, idx) => (
                    <li key={idx} className="text-sm text-gray-700 dark:text-gray-300">
                      {p.date ? `${fmtDate(p.date)} · ${gameStartForDate(p.date, p.start)}${p.hall_name ? ` · ${p.hall_name}` : ''}` : t('slotN', { number: idx + 1 })}
                      {!p.available && <span className="ml-2 text-xs text-red-600 dark:text-red-400">⚠ {t('slotMaybeTaken')}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <HomeProposalForm
              slots={slots}
              existing={card.booking?.status === 'pending' ? card.booking : undefined}
              seasonWindow={seasonWindow}
              onChange={homeChangeFor(card.key)}
              hideSubmit
            />
          </>
        )
      ) : card.booking?.status === 'confirmed' ? (
        <div className="rounded-md bg-green-50 p-4 dark:bg-green-900/20">
          <p className="text-sm font-medium text-green-800 dark:text-green-300">{t('confirmed')}</p>
          <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">{fmtDateTime(decidedAway(card.booking))}</p>
        </div>
      ) : (
        <AwayProposalForm
          existingProposal={card.booking || undefined}
          blockedStrict={blockedStrict}
          blockedLoose={blockedLoose}
          seasonWindow={seasonWindow}
          onChange={awayChangeFor(card.key)}
          hideSubmit
        />
      )}
    </div>
  )

  const sideButtonClass =
    'mt-4 w-full rounded-md bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 sm:w-auto sm:px-8'

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
            <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">{t('inviteWelcome', { club: oppName, team: opponent.kscw_team_name })}</p>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              {t('inviteContactHint', { email: opponent.contact_email })}
            </p>
          </div>
        )}

        {/* Note from KSCW (set by the spielplaner) — shown to the opponent. */}
        {opponent.kscw_note && (
          <div className="mb-6 rounded-xl border border-gold-300 bg-gold-50 p-4 dark:border-gold-700 dark:bg-gold-900/20">
            <p className="text-xs font-semibold uppercase tracking-wide text-gold-700 dark:text-gold-300">{t('noteFromKscw')}</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800 dark:text-gray-200">{opponent.kscw_note}</p>
          </div>
        )}

        {bookingError && (
          <div className="mb-4 rounded-md bg-red-50 p-4 text-sm text-red-800 dark:bg-red-900/30 dark:text-red-300">{bookingError}</div>
        )}
        {bookingSuccess && (
          <div className="mb-4 rounded-md bg-green-50 p-4 text-sm text-green-800 dark:bg-green-900/30 dark:text-green-300">{bookingSuccess}</div>
        )}

        {/* Home and away as two columns (side by side on lg, stacked on mobile).
            Each side has its own confirm button right beneath its cards. */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {homeCards.length > 0 && (
            <section className="mb-2">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('homeGamesTitle')}</h2>
              <div className="space-y-6">{homeCards.map(renderCard)}</div>
              {shownHome.length > 0 && (
                <button
                  type="button"
                  onClick={() => openConfirmer('home')}
                  disabled={busy}
                  className={sideButtonClass}
                >
                  {submittingSide === 'home' ? t('submitting') : t('confirmHomeGames')}
                </button>
              )}
            </section>
          )}

          {awayCards.length > 0 && (
            <section className="mb-2">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('awayGamesTitle')}</h2>
              <div className="space-y-6">{awayCards.map(renderCard)}</div>
              {shownAway.length > 0 && (
                <button
                  type="button"
                  onClick={() => openConfirmer('away')}
                  disabled={busy}
                  className={sideButtonClass}
                >
                  {submittingSide === 'away' ? t('submitting') : t('confirmAwayGames')}
                </button>
              )}
            </section>
          )}
        </div>

        <div className="mb-6" />

        {/* Slot-availability explainer — why only certain dates are offered.
            Sits right above the remarks box so the opponent understands the
            constraints before leaving a note. */}
        <div className="mb-6 rounded-xl border border-gray-200 bg-gray-50 p-6 dark:border-gray-700 dark:bg-gray-800/50">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{t('slotRulesTitle')}</h2>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{t('slotRulesIntro')}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-600 dark:text-gray-400">
            <li>{t('slotRulesHall')}</li>
            <li>{t('slotRulesSaturday')}</li>
            <li>{t('slotRulesGap')}</li>
            <li>{t('slotRulesVenue')}</li>
            <li>{t('slotRulesSunday')}</li>
          </ul>
          <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">{t('slotRulesAway')}</p>
          <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">{t('slotRulesOutro')}</p>
        </div>

        {/* Opponent's remark to KSCW (free text, independent of proposing) — its
            own save button so a note-only update doesn't ride a game submit. */}
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
          <label htmlFor="opp-remark" className="block text-base font-semibold text-gray-900 dark:text-gray-100">
            {t('yourRemarks')}
          </label>
          <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">{t('yourRemarksHint')}</p>
          <textarea
            id="opp-remark"
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder={t('yourRemarksPlaceholder')}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
          />
          {remarkChanged && (
            <button
              type="button"
              onClick={handleSaveRemark}
              disabled={busy}
              className="mt-3 w-full rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 sm:w-auto dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              {savingRemark ? t('submitting') : t('saveRemarks')}
            </button>
          )}
        </div>

        {/* "Who is confirming" — captured on submit so KSCW knows the contact. */}
        <Modal
          open={confirmerSide !== null}
          onClose={() => setConfirmerSide(null)}
          title={t('confirmerTitle')}
          size="sm"
        >
          <div className="space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {confirmerSide === 'home' ? t('confirmerHintHome') : t('confirmerHintAway')}
            </p>
            <div>
              <label htmlFor="confirmer-name" className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
                {t('confirmerName')}
              </label>
              <input
                id="confirmer-name"
                type="text"
                value={confirmerName}
                onChange={(e) => setConfirmerName(e.target.value)}
                autoComplete="name"
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
              />
            </div>
            <div>
              <label htmlFor="confirmer-email" className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
                {t('confirmerEmail')}
              </label>
              <input
                id="confirmer-email"
                type="email"
                value={confirmerEmail}
                onChange={(e) => setConfirmerEmail(e.target.value)}
                autoComplete="email"
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
              />
            </div>
            {confirmerError && (
              <p className="text-sm text-red-600 dark:text-red-400">{confirmerError}</p>
            )}
            <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setConfirmerSide(null)}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                onClick={submitConfirmer}
                disabled={busy}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {t('confirmAndSend')}
              </button>
            </div>
          </div>
        </Modal>

        {/* Help line — for anything else, the club's scheduling mailbox. */}
        <p className="mt-8 text-center text-xs text-gray-400 dark:text-gray-500">
          {t('inviteHelpHint')}{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="underline hover:text-gray-600 dark:hover:text-gray-300">
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </div>
    </div>
  )
}
