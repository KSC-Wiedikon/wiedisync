import { useCallback, useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useClubSlots, type ClubPairing } from '../hooks/useClubSlots'
import { gameStartForDate } from '../utils/slotTime'
import type { BookingData } from '../hooks/useAvailableSlots'
import { buildLegCards, fmtDate, fmtDateTime, type LegCard, type LegStatus } from '../components/pairingCards'
import { HomeProposalFormForCard, AwayProposalFormForCard } from '../components/pairingForms'
import Modal from '../../../components/Modal'
import { useReportPageLoading } from '../../../hooks/usePageReady'
import { Badge } from '../../../components/ui/badge'
import LanguageDropdown from '../../../components/LanguageDropdown'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const SUPPORT_EMAIL = 'volleyball@spielplanung.kscw.ch'

type ConfirmTarget = { oppId: string; side: 'home' | 'away' }

export default function ClubFlowPage() {
  const { token } = useParams<{ token: string }>()
  const { t, i18n } = useTranslation('gameScheduling')
  const { portal, pairings, isLoading, error, proposeHome, proposeAway, saveNote, setLanguage } = useClubSlots(token)

  const [bookingError, setBookingError] = useState('')
  const [bookingSuccess, setBookingSuccess] = useState('')
  // Collapse-by-default accordion: opponent-row ids currently expanded (empty = all collapsed).
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggleExpanded = (id: string) => setExpanded((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  // Which pairing+side is currently submitting (per-pairing confirm buttons).
  const [submitting, setSubmitting] = useState<ConfirmTarget | null>(null)
  const [savingRemark, setSavingRemark] = useState(false)
  // "Who is confirming" modal — shared across pairings, remembers name/email.
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(null)
  const [confirmerName, setConfirmerName] = useState('')
  const [confirmerEmail, setConfirmerEmail] = useState('')
  const [confirmerError, setConfirmerError] = useState('')
  // Card picks, keyed by globally-unique card key (namespaced per pairing).
  const [homePicksByCard, setHomePicksByCard] = useState<Record<string, string[] | null>>({})
  const [awayProposalsByCard, setAwayProposalsByCard] = useState<Record<string, Array<{ date: string; start_time: string; location: string }> | null>>({})
  const handleHomePick = useCallback((key: string, picks: string[] | null) => {
    setHomePicksByCard((prev) => (prev[key] === picks ? prev : { ...prev, [key]: picks }))
  }, [])
  const handleAwayPick = useCallback((key: string, proposals: Array<{ date: string; start_time: string; location: string }> | null) => {
    setAwayProposalsByCard((prev) => ({ ...prev, [key]: proposals }))
  }, [])

  // Shared remark box — seeded once from the portal's club note, then user-owned.
  const [remark, setRemark] = useState('')
  const didInitRemark = useRef(false)
  useEffect(() => {
    if (didInitRemark.current || !portal) return
    didInitRemark.current = true
    setRemark(portal.club_note || '')
  }, [portal])

  // Language memory: restore the portal's saved language once loaded, then
  // persist on every switch so per-opponent receipt emails match.
  const didInitLang = useRef(false)
  useEffect(() => {
    if (didInitLang.current || !portal) return
    didInitLang.current = true
    const lang = portal.language || 'de'
    if (lang !== i18n.language) i18n.changeLanguage(lang)
  }, [portal, i18n])
  useEffect(() => {
    if (!didInitLang.current) return
    setLanguage((i18n.language || '').split('-')[0].toLowerCase())
  }, [i18n.language, setLanguage])

  const isInitialLoading = isLoading && !portal
  useReportPageLoading(isInitialLoading)

  if (isInitialLoading) return null

  if (error || !portal) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 dark:bg-gray-900">
        <div className="text-center">
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t('invalidLink')}</h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">{error || t('tokenNotFound')}</p>
        </div>
      </div>
    )
  }

  const clubName = portal.club_name || ''
  // Group pairings by the KSCW team's gender (m → Herren, f → Damen, mixed, then
  // any unknown), rendered as collapse-by-default accordion sections.
  const GENDER_ORDER = ['m', 'f', 'mixed']
  const genderLabel = (g: string) => t(`gender_${g}`, { defaultValue: g })
  const genderGroups = [
    ...GENDER_ORDER.map((g) => ({ gender: g, items: pairings.filter((p) => (p.opponent.kscw_team_gender || '') === g) })),
    { gender: '', items: pairings.filter((p) => !GENDER_ORDER.includes(p.opponent.kscw_team_gender || '')) },
  ].filter((grp) => grp.items.length > 0)

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
      default: return body?.error || (err instanceof Error ? err.message : String(err))
    }
  }

  const statusBadge = (s: LegStatus) => {
    const map: Record<LegStatus, { v: 'neutral' | 'warning' | 'success'; l: string }> = {
      open: { v: 'neutral', l: t('legOpen', { defaultValue: 'Open' }) },
      proposed: { v: 'warning', l: t('legProposed', { defaultValue: 'Proposed' }) },
      confirmed: { v: 'success', l: t('legConfirmed', { defaultValue: 'Confirmed' }) },
    }
    const m = map[s]
    return <Badge variant={m.v} size="sm">{m.l}</Badge>
  }

  const legStatus = (card: LegCard): LegStatus =>
    !card.booking ? 'open' : card.booking.status === 'confirmed' ? 'confirmed' : 'proposed'

  const decidedAway = (booking: BookingData) =>
    booking.confirmed_proposal
      ? (booking[`proposed_datetime_${booking.confirmed_proposal}` as keyof BookingData] as string)
      : ''

  const remarkChanged = remark.trim() !== (portal.club_note || '').trim()
  const busy = submitting !== null || savingRemark

  const isShown = (card: LegCard) => card.booking?.status !== 'confirmed'

  // Per-pairing card renderer (mirrors OpponentFlowPage.renderCard but scoped to
  // one pairing's slots / away-blocks / season window and opponent labels).
  const renderCard = (pairing: ClubPairing, card: LegCard) => {
    const oppTeam = pairing.opponent.team_name || pairing.opponent.club_name || ''
    const kscwName = `KSCW ${pairing.opponent.kscw_team_name}`
    const match = card.isHome ? `${kscwName} – ${oppTeam}` : `${oppTeam} – ${kscwName}`
    const title = card.sideCount > 1 ? `${match} · ${t('gameN', { number: card.seq })}` : match
    return (
      <div key={card.key} className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-1 flex items-start justify-between gap-2">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {title}
            {card.number != null && (
              <span className="ml-2 text-sm font-normal text-gray-400 dark:text-gray-500">#{card.number}</span>
            )}
          </h3>
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
              <HomeProposalFormForCard
                cardKey={card.key}
                onPick={handleHomePick}
                slots={pairing.slots}
                existing={card.booking?.status === 'pending' ? card.booking : undefined}
                seasonWindow={pairing.season_window}
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
          <AwayProposalFormForCard
            cardKey={card.key}
            onPick={handleAwayPick}
            existingProposal={card.booking || undefined}
            blockedStrict={pairing.blocked_away_strict}
            blockedLoose={pairing.blocked_away_loose}
            seasonWindow={pairing.season_window}
            hideSubmit
          />
        )}
      </div>
    )
  }

  // Step 1: confirm button → validate this pairing+side, then open the modal.
  const openConfirmer = (pairing: ClubPairing, side: 'home' | 'away', homeCards: LegCard[], awayCards: LegCard[]) => {
    setBookingError('')
    setBookingSuccess('')
    if (side === 'home') {
      const shown = homeCards.filter(isShown)
      if (!(shown.length > 0 && shown.every((c) => !!homePicksByCard[c.key]))) {
        setBookingError(t('homeIncomplete'))
        return
      }
      const allPicks = shown.flatMap((c) => homePicksByCard[c.key] || [])
      if (new Set(allPicks).size !== allPicks.length) {
        setBookingError(t('duplicateSlotAcrossGames'))
        return
      }
    } else {
      const shown = awayCards.filter(isShown)
      if (!(shown.length > 0 && shown.every((c) => !!awayProposalsByCard[c.key]))) {
        setBookingError(t('awayIncomplete'))
        return
      }
    }
    setConfirmerError('')
    setConfirmTarget({ oppId: String(pairing.opponent.id), side })
  }

  const handleConfirmSide = async (target: ConfirmTarget, proposer: { name: string; email: string }) => {
    const pairing = pairings.find((p) => String(p.opponent.id) === target.oppId)
    if (!pairing) return
    setBookingError('')
    setBookingSuccess('')
    setSubmitting(target)
    try {
      if (target.side === 'home') {
        const shown = buildLegCards(pairing.games, pairing.bookings, true, `${pairing.opponent.id}:`).filter(isShown)
        for (const c of shown) {
          const picks = homePicksByCard[c.key]
          if (picks) await proposeHome(picks, c.svrzGameId, proposer)
        }
      } else {
        const shown = buildLegCards(pairing.games, pairing.bookings, false, `${pairing.opponent.id}:`).filter(isShown)
        for (const c of shown) {
          const proposals = awayProposalsByCard[c.key]
          if (proposals) await proposeAway(proposals, c.svrzGameId, proposer)
        }
      }
      if (remarkChanged) await saveNote(remark.trim())
      setBookingSuccess(t('proposalsSubmitted'))
    } catch (err: unknown) {
      setBookingError(schedErrorMessage(err))
    } finally {
      setSubmitting(null)
    }
  }

  const submitConfirmer = async () => {
    const name = confirmerName.trim()
    const email = confirmerEmail.trim()
    if (!name || !email) { setConfirmerError(t('proposerRequired')); return }
    if (!EMAIL_RE.test(email)) { setConfirmerError(t('invalidEmail')); return }
    const target = confirmTarget
    if (!target) return
    setConfirmTarget(null)
    await handleConfirmSide(target, { name, email })
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

  const sideButtonClass =
    'mt-4 w-full rounded-md bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 sm:w-auto sm:px-8'

  // One accordion item per pairing — collapsed by default; the header shows the
  // matchup + league + a to-do/confirmed badge; expanded shows the home/away cards.
  const renderPairingItem = (pairing: ClubPairing) => {
    const id = String(pairing.opponent.id)
    const homeCards = buildLegCards(pairing.games, pairing.bookings, true, `${id}:`)
    const awayCards = buildLegCards(pairing.games, pairing.bookings, false, `${id}:`)
    const shownHome = homeCards.filter(isShown)
    const shownAway = awayCards.filter(isShown)
    const league = pairing.games.find((g) => g.league)?.league || ''
    const submittingHome = submitting?.oppId === id && submitting?.side === 'home'
    const submittingAway = submitting?.oppId === id && submitting?.side === 'away'
    const isOpen = expanded.has(id)
    const allCards = [...homeCards, ...awayCards]
    const todo = allCards.filter((c) => legStatus(c) !== 'confirmed').length
    return (
      <div key={id} className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <button
          type="button"
          onClick={() => toggleExpanded(id)}
          aria-expanded={isOpen}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700/40"
        >
          <span className="flex min-w-0 items-center gap-2">
            <svg className={`h-4 w-4 flex-none text-gray-400 transition-transform ${isOpen ? 'rotate-90' : ''}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.168 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02Z" clipRule="evenodd" />
            </svg>
            <span className="min-w-0 text-sm sm:text-base">
              <span className="font-semibold text-gray-900 dark:text-gray-100">KSCW {pairing.opponent.kscw_team_name} <span className="font-normal text-gray-400">·</span> {pairing.opponent.team_name}</span>
              {league && <span className="ml-2 text-xs font-medium text-gray-400">{league}</span>}
            </span>
          </span>
          {todo === 0
            ? <Badge variant="success" size="sm">{t('legConfirmed')}</Badge>
            : <Badge variant="warning" size="sm">{t('pairingOpenBadge', { count: todo })}</Badge>}
        </button>
        {isOpen && (
          <div className="border-t border-gray-100 p-4 dark:border-gray-700">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {homeCards.length > 0 && (
                <div>
                  <h4 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('homeGamesTitle')}</h4>
                  <div className="space-y-6">{homeCards.map((c) => renderCard(pairing, c))}</div>
                  {shownHome.length > 0 && (
                    <button type="button" onClick={() => openConfirmer(pairing, 'home', homeCards, awayCards)} disabled={busy} className={sideButtonClass}>
                      {submittingHome ? t('submitting') : t('confirmHomeGames')}
                    </button>
                  )}
                </div>
              )}
              {awayCards.length > 0 && (
                <div>
                  <h4 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('awayGamesTitle')}</h4>
                  <div className="space-y-6">{awayCards.map((c) => renderCard(pairing, c))}</div>
                  {shownAway.length > 0 && (
                    <button type="button" onClick={() => openConfirmer(pairing, 'away', homeCards, awayCards)} disabled={busy} className={sideButtonClass}>
                      {submittingAway ? t('submitting') : t('confirmAwayGames')}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

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
            {clubName} · KSC Wiedikon
          </p>
        </div>

        {/* Club welcome — one link covers every one of the club's teams. */}
        <div className="mb-6 rounded-xl border border-brand-200 bg-brand-50 p-5 dark:border-brand-900 dark:bg-brand-900/20">
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{t('inviteGreetingNoName')}</p>
          <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">{t('clubInviteWelcome', { club: clubName })}</p>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{t('clubAllTeamsHint', { club: clubName })}</p>
        </div>

        {bookingError && (
          <div className="mb-4 rounded-md bg-red-50 p-4 text-sm text-red-800 dark:bg-red-900/30 dark:text-red-300">{bookingError}</div>
        )}
        {bookingSuccess && (
          <div className="mb-4 rounded-md bg-green-50 p-4 text-sm text-green-800 dark:bg-green-900/30 dark:text-green-300">{bookingSuccess}</div>
        )}

        {pairings.length === 0 && (
          <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
            {t('clubNoFixtures')}
          </div>
        )}

        {/* Teams grouped by gender; each pairing collapsed by default. */}
        {genderGroups.map((grp) => (
          <div key={grp.gender || 'other'} className="mb-8">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {grp.gender ? genderLabel(grp.gender) : t('otherTeams')}
            </h2>
            <div className="space-y-2">
              {grp.items.map((pairing) => renderPairingItem(pairing))}
            </div>
          </div>
        ))}

        {/* Slot-availability explainer. */}
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

        {/* Shared remark to KSCW (one note for the whole club). */}
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
          <label htmlFor="club-remark" className="block text-base font-semibold text-gray-900 dark:text-gray-100">
            {t('yourRemarks')}
          </label>
          <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">{t('yourRemarksHint')}</p>
          <textarea
            id="club-remark"
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder={t('yourRemarksPlaceholder')}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
          />
          {remarkChanged && (
            <button type="button" onClick={handleSaveRemark} disabled={busy} className="mt-3 w-full rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 sm:w-auto dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700">
              {savingRemark ? t('submitting') : t('saveRemarks')}
            </button>
          )}
        </div>

        {/* "Who is confirming" modal — shared across pairings. */}
        <Modal open={confirmTarget !== null} onClose={() => setConfirmTarget(null)} title={t('confirmerTitle')} size="sm">
          <div className="space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {confirmTarget?.side === 'home' ? t('confirmerHintHome') : t('confirmerHintAway')}
            </p>
            <div>
              <label htmlFor="club-confirmer-name" className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">{t('confirmerName')}</label>
              <input id="club-confirmer-name" type="text" value={confirmerName} onChange={(e) => setConfirmerName(e.target.value)} autoComplete="name"
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100" />
            </div>
            <div>
              <label htmlFor="club-confirmer-email" className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">{t('confirmerEmail')}</label>
              <input id="club-confirmer-email" type="email" value={confirmerEmail} onChange={(e) => setConfirmerEmail(e.target.value)} autoComplete="email"
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100" />
            </div>
            {confirmerError && <p className="text-sm text-red-600 dark:text-red-400">{confirmerError}</p>}
            <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setConfirmTarget(null)} className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700">
                {t('cancel')}
              </button>
              <button type="button" onClick={submitConfirmer} disabled={busy} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                {t('confirmAndSend')}
              </button>
            </div>
          </div>
        </Modal>

        <p className="mt-8 text-center text-xs text-gray-400 dark:text-gray-500">
          {t('inviteHelpHint')}{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="underline hover:text-gray-600 dark:hover:text-gray-300">{SUPPORT_EMAIL}</a>.
        </p>
      </div>
    </div>
  )
}
