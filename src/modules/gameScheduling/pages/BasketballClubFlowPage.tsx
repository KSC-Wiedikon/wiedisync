import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  useBbClubPortal,
  groupSlotsByDate,
  type BbDecision,
  type BbPortalGame,
  type BbPortalFreeDate,
} from '../hooks/useBbClubPortal'
import Modal from '../../../components/Modal'
import { Badge } from '../../../components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table'
import LanguageDropdown from '../../../components/LanguageDropdown'
import { useReportPageLoading } from '../../../hooks/usePageReady'
import { formatDateZurich } from '../../../utils/dateHelpers'

/**
 * PUBLIC opponent-club portal for basketball — /terminplanung/bb/:token.
 *
 * One page per opponent CLUB, listing every KSCW home game placed against that
 * club's teams before the ProBasket Spielplansitzung. The club confirms, declines
 * or counter-proposes; agreeing here is what removes the obligation to attend the
 * Spielplansitzung for those games (WSR Art. 18).
 *
 * Why this is not `ClubFlowPage` parameterised by sport: that page drives the
 * volleyball SVRZ engine — per-opponent fixture pairings, free-slot pickers, away
 * proposals, gap/derby/Saturday-cap rules. Basketball has no fixture feed at all
 * before the Spielplansitzung, so there is nothing to pair and no slot to pick:
 * the placed game IS the proposal and the club's whole vocabulary is
 * accept / decline / counter. The two pages share no field of payload, so
 * "parameterise by sport" would have meant two disjoint branches in one file.
 *
 * Cards, not a <Table>: each row here is a proposal the reader ACTS on — a
 * decision control plus a conditional counter-proposal form — which is the
 * event-card exception in CLAUDE.md's list rule, not a record you scan.
 *
 * Unauthenticated: every call goes out with `anonymous: true` and is authorised by
 * the 32-hex token alone.
 */

const SUPPORT_EMAIL = 'basketball@spielplanung.kscw.ch'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_ALTERNATIVES = 3

type Response = 'accepted' | 'declined'

interface DraftDecision {
  response: Response
  note: string
  alternatives: Array<{ date: string; time: string }>
}

/**
 * The expiry is stored as 23:59:59 UTC of the season's last day, which is already the
 * NEXT day in Zurich — formatting it in local time would print 01.07.2027 while the
 * invite email (which renders the same column from its UTC parts) says 30.06.2027.
 * One link must not carry two expiry dates, so this matches the email.
 */
function formatExpiryUtc(value: string | null | undefined): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('de-CH', {
    timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(d)
}

const STATUS_VARIANT: Record<BbPortalGame['status'], 'neutral' | 'success' | 'danger' | 'warning'> = {
  offered: 'neutral',
  accepted: 'success',
  declined: 'danger',
  countered: 'warning',
}

export default function BasketballClubFlowPage() {
  const { token } = useParams<{ token: string }>()
  const { t, i18n } = useTranslation('basketballScheduling')
  const { portal, games, pairings, keyDates, isLoading, error, respond, propose, saveNote, setLanguage } =
    useBbClubPortal(token)

  const [drafts, setDrafts] = useState<Record<string, DraftDecision>>({})
  const [submitting, setSubmitting] = useState(false)
  const [savingNote, setSavingNote] = useState(false)
  const [formError, setFormError] = useState('')
  const [success, setSuccess] = useState('')

  // "Who is answering" modal — the backend requires a name + email on every response.
  // Free pitches the club has ticked, by slot id. Separate from `drafts` because the two
  // flows answer different questions — ours ("do you accept this game?") and theirs ("which
  // dates suit you?") — and the identity modal serves whichever opened it via `responderMode`.
  const [picked, setPicked] = useState<Set<number>>(() => new Set())
  /** date → the slot id the club chose for it. Absent = take the day's best-ranked pitch. */
  const [timeByDate, setTimeByDate] = useState<Record<string, number>>({})
  const [responderMode, setResponderMode] = useState<'respond' | 'propose'>('respond')
  const [responderOpen, setResponderOpen] = useState(false)
  const [responderName, setResponderName] = useState('')
  const [responderEmail, setResponderEmail] = useState('')
  const [responderError, setResponderError] = useState('')

  // Club-level remark — seeded once from the portal, then owned by the user.
  const [note, setNote] = useState('')
  const didInitNote = useRef(false)
  useEffect(() => {
    if (didInitNote.current || !portal) return
    didInitNote.current = true
    setNote(portal.club_note || '')
  }, [portal])

  // Language memory: adopt the portal's stored language once, then persist switches.
  const didInitLang = useRef(false)
  useEffect(() => {
    if (didInitLang.current || !portal) return
    didInitLang.current = true
    const lang = portal.language || 'de'
    if (lang !== i18n.language) void i18n.changeLanguage(lang)
  }, [portal, i18n])
  useEffect(() => {
    if (!didInitLang.current) return
    void setLanguage((i18n.language || '').split('-')[0].toLowerCase())
  }, [i18n.language, setLanguage])

  const isInitialLoading = isLoading && !portal
  useReportPageLoading(isInitialLoading)

  const decided = useMemo(() => Object.entries(drafts), [drafts])

  if (isInitialLoading) return null

  if (error || !portal) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 dark:bg-gray-900">
        <div className="text-center">
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t('bbPortalInvalidTitle')}</h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            {error === 'Link expired' ? t('bbPortalExpired') : t('bbPortalInvalidHint')}
          </p>
          <p className="mt-4 text-xs text-gray-400 dark:text-gray-500">
            {t('bbPortalHelp')}{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="underline">{SUPPORT_EMAIL}</a>
          </p>
        </div>
      </div>
    )
  }

  const setDraft = (id: number, patch: Partial<DraftDecision>) =>
    setDrafts((prev) => {
      const cur = prev[String(id)] ?? { response: 'accepted' as Response, note: '', alternatives: [] }
      return { ...prev, [String(id)]: { ...cur, ...patch } }
    })

  const clearDraft = (id: number) =>
    setDrafts((prev) => {
      const next = { ...prev }
      delete next[String(id)]
      return next
    })

  const addAlternative = (id: number) => {
    const cur = drafts[String(id)]
    if (!cur || cur.alternatives.length >= MAX_ALTERNATIVES) return
    setDraft(id, { alternatives: [...cur.alternatives, { date: '', time: '' }] })
  }

  const updateAlternative = (id: number, idx: number, patch: Partial<{ date: string; time: string }>) => {
    const cur = drafts[String(id)]
    if (!cur) return
    const next = cur.alternatives.map((a, i) => (i === idx ? { ...a, ...patch } : a))
    setDraft(id, { alternatives: next })
  }

  const removeAlternative = (id: number, idx: number) => {
    const cur = drafts[String(id)]
    if (!cur) return
    setDraft(id, { alternatives: cur.alternatives.filter((_, i) => i !== idx) })
  }

  /**
   * Which pitch a date resolves to: the club's explicit time choice, else the day's best.
   * Keyed by date so switching the time on a ticked day moves the tick with it.
   */
  const chosenSlotFor = (d: BbPortalFreeDate) => {
    const explicit = d.options.find((o) => o.id === timeByDate[d.date])
    return explicit ?? d.options[0]
  }

  /** Change a day's time. If the day was already ticked, the tick follows the new pitch. */
  const chooseTime = (d: BbPortalFreeDate, slotId: number) => {
    const previous = chosenSlotFor(d).id
    setTimeByDate((prev) => ({ ...prev, [d.date]: slotId }))
    setPicked((prev) => {
      if (!prev.has(previous)) return prev
      const next = new Set(prev)
      next.delete(previous)
      next.add(slotId)
      return next
    })
  }

  const togglePick = (slotId: number) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(slotId)) next.delete(slotId)
      else next.add(slotId)
      return next
    })

  const openProposer = () => {
    setFormError('')
    setSuccess('')
    if (!picked.size) {
      setFormError(t('bbPortalNothingPicked'))
      return
    }
    setResponderMode('propose')
    setResponderError('')
    setResponderOpen(true)
  }

  const openResponder = () => {
    setFormError('')
    setSuccess('')
    setResponderMode('respond')
    if (!decided.length) {
      setFormError(t('bbPortalNothingDecided'))
      return
    }
    // A half-filled alternative would be rejected by the backend as invalid_alternative —
    // say so here instead of after the round-trip.
    for (const [, d] of decided) {
      if (d.response !== 'declined') continue
      if (d.alternatives.some((a) => (a.date && !a.time) || (!a.date && a.time) || (!a.date && !a.time))) {
        setFormError(t('bbPortalAlternativeIncomplete'))
        return
      }
    }
    setResponderError('')
    setResponderOpen(true)
  }

  const submitResponse = async () => {
    const name = responderName.trim()
    const email = responderEmail.trim()
    if (!name || !email) {
      setResponderError(t('bbPortalResponderRequired'))
      return
    }
    if (!EMAIL_RE.test(email)) {
      setResponderError(t('bbPortalInvalidEmail'))
      return
    }
    setResponderOpen(false)
    setSubmitting(true)
    setFormError('')

    if (responderMode === 'propose') {
      try {
        if (note.trim() !== (portal.club_note || '').trim()) await saveNote(note.trim())
        const res = await propose([...picked].map((slot_id) => ({ slot_id })), { name, email })
        setPicked(new Set())
        // `rejected` means the backend refused ids that are not this club's — say so rather
        // than reporting a clean success for a partial write.
        setSuccess(
          res.rejected > 0
            ? t('bbPortalProposedPartial', { count: res.created, rejected: res.rejected })
            : t('bbPortalProposed', { count: res.created }),
        )
      } catch (err) {
        const body = (err as { body?: { error?: string } })?.body
        const code = body?.error || ''
        setFormError(
          code === 'Link expired' ? t('bbPortalExpired')
            : code === 'no_valid_picks' ? t('bbPortalPicksUnavailable')
              : t('bbPortalSubmitError'),
        )
      } finally {
        setSubmitting(false)
      }
      return
    }

    try {
      const decisions: BbDecision[] = decided.map(([gameId, d]) => ({
        game_id: Number(gameId),
        response: d.response,
        note: d.note || '',
        ...(d.response === 'declined' && d.alternatives.length
          ? { alternatives: d.alternatives.filter((a) => a.date && a.time) }
          : {}),
      }))
      if (note.trim() !== (portal.club_note || '').trim()) await saveNote(note.trim())
      await respond(decisions, { name, email })
      setDrafts({})
      setSuccess(t('bbPortalSubmitted'))
    } catch (err) {
      const body = (err as { body?: { error?: string } })?.body
      const code = body?.error || ''
      setFormError(
        code === 'Link expired' ? t('bbPortalExpired')
          : code === 'invalid_alternative' ? t('bbPortalAlternativeIncomplete')
            : code === 'invalid_email' ? t('bbPortalInvalidEmail')
              : code || (err instanceof Error ? err.message : String(err)),
      )
    } finally {
      setSubmitting(false)
    }
  }

  const handleSaveNote = async () => {
    setFormError('')
    setSuccess('')
    setSavingNote(true)
    try {
      await saveNote(note.trim())
      setSuccess(t('bbPortalNoteSaved'))
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingNote(false)
    }
  }

  const noteChanged = note.trim() !== (portal.club_note || '').trim()
  const inputClass =
    'min-h-11 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100'

  const renderGame = (g: BbPortalGame) => {
    const draft = drafts[String(g.id)]
    const chosen = draft?.response ?? null
    return (
      <div key={g.id} className="rounded-xl border border-gray-200 bg-white p-4 sm:p-6 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              KSC Wiedikon {g.kscw_team}
              {g.opponent ? ` – ${g.opponent}` : ''}
            </h3>
            <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
              {formatDateZurich(g.date)} · {g.time}
              {g.hall ? ` · ${g.hall}` : ''}
            </p>
          </div>
          <Badge variant={STATUS_VARIANT[g.status]} size="sm">{t(`bbPortalStatus_${g.status}`)}</Badge>
        </div>

        {g.kscw_note && (
          <p className="mt-2 rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:bg-gray-900/40 dark:text-gray-400">
            {g.kscw_note}
          </p>
        )}

        {g.responded_at && (
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            {t('bbPortalAlreadyAnswered', { date: formatDateZurich(g.responded_at) })}
          </p>
        )}

        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => (chosen === 'accepted' ? clearDraft(g.id) : setDraft(g.id, { response: 'accepted', alternatives: [] }))}
            aria-pressed={chosen === 'accepted'}
            className={`min-h-11 flex-1 rounded-md border px-4 py-2 text-sm font-medium transition-colors ${
              chosen === 'accepted'
                ? 'border-green-600 bg-green-600 text-white'
                : 'border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700'
            }`}
          >
            {t('bbPortalAccept')}
          </button>
          <button
            type="button"
            onClick={() => (chosen === 'declined' ? clearDraft(g.id) : setDraft(g.id, { response: 'declined' }))}
            aria-pressed={chosen === 'declined'}
            className={`min-h-11 flex-1 rounded-md border px-4 py-2 text-sm font-medium transition-colors ${
              chosen === 'declined'
                ? 'border-rose-600 bg-rose-600 text-white'
                : 'border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700'
            }`}
          >
            {t('bbPortalDecline')}
          </button>
        </div>

        {chosen === 'declined' && (
          <div className="mt-3 space-y-3 rounded-md border border-gray-200 p-3 dark:border-gray-700">
            <p className="text-xs text-gray-500 dark:text-gray-400">{t('bbPortalAlternativesHint')}</p>
            {(draft?.alternatives ?? []).map((a, idx) => (
              <div key={idx} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  type="date"
                  value={a.date}
                  aria-label={t('bbPortalAltDate')}
                  onChange={(e) => updateAlternative(g.id, idx, { date: e.target.value })}
                  className={`${inputClass} sm:w-44`}
                />
                <input
                  type="time"
                  value={a.time}
                  aria-label={t('bbPortalAltTime')}
                  onChange={(e) => updateAlternative(g.id, idx, { time: e.target.value })}
                  className={`${inputClass} sm:w-32`}
                />
                <button
                  type="button"
                  onClick={() => removeAlternative(g.id, idx)}
                  className="min-h-11 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                  {t('bbPortalAltRemove')}
                </button>
              </div>
            ))}
            {(draft?.alternatives?.length ?? 0) < MAX_ALTERNATIVES && (
              <button
                type="button"
                onClick={() => addAlternative(g.id)}
                className="min-h-11 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                {t('bbPortalAltAdd')}
              </button>
            )}
          </div>
        )}

        {chosen && (
          <label className="mt-3 block text-xs font-medium text-gray-500 dark:text-gray-400">
            {t('bbPortalGameNote')}
            <textarea
              value={draft?.note ?? ''}
              rows={2}
              maxLength={2000}
              onChange={(e) => setDraft(g.id, { note: e.target.value })}
              placeholder={t('bbPortalGameNotePlaceholder')}
              className={`mt-1 ${inputClass}`}
            />
          </label>
        )}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8 dark:bg-gray-900">
      <div className="mx-auto max-w-3xl">
        <div className="mb-2 flex justify-end">
          <LanguageDropdown size="sm" />
        </div>

        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('bbPortalTitle')}</h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            {portal.club_name} · KSC Wiedikon
            {portal.season_name ? ` · ${portal.season_name}` : ''}
          </p>
        </div>

        <div className="mb-6 rounded-xl border border-brand-200 bg-brand-50 p-5 dark:border-brand-900 dark:bg-brand-900/20">
          <p className="text-sm text-gray-800 dark:text-gray-200">{t('bbPortalWelcome', { club: portal.club_name })}</p>
          {keyDates?.spielplansitzung && (
            <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
              {t('bbPortalArt18', { date: formatDateZurich(keyDates.spielplansitzung) })}
            </p>
          )}
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-gray-700 dark:text-gray-300">
            <li>{t('bbPortalStep1')}</li>
            <li>{t('bbPortalStep2')}</li>
            <li>{t('bbPortalStep3')}</li>
          </ul>
          {portal.expires_at && (
            <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
              {t('bbPortalExpiresOn', { date: formatExpiryUtc(portal.expires_at) })}
            </p>
          )}
        </div>

        {formError && (
          <div className="mb-4 rounded-md bg-red-50 p-4 text-sm text-red-800 dark:bg-red-900/30 dark:text-red-300">{formError}</div>
        )}
        {success && (
          <div className="mb-4 rounded-md bg-green-50 p-4 text-sm text-green-800 dark:bg-green-900/30 dark:text-green-300">{success}</div>
        )}

        {games.length === 0 ? (
          <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
            {t('bbPortalNoGames')}
          </div>
        ) : (
          <div className="mb-6 space-y-4">{games.map(renderGame)}</div>
        )}

        {games.length > 0 && (
          <button
            type="button"
            onClick={openResponder}
            disabled={submitting || decided.length === 0}
            className="mb-6 w-full rounded-md bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? t('bbPortalSending') : t('bbPortalSubmit', { count: decided.length })}
          </button>
        )}

        {/* Pick free dates. A record list you scan and select → <Table> per CLAUDE.md, unlike
            the game cards above, which are proposals you act on individually. */}
        {pairings.length > 0 && (
          <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4 sm:p-6 dark:border-gray-700 dark:bg-gray-800">
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{t('bbPortalPickTitle')}</h2>
            <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">{t('bbPortalPickHint')}</p>

            {pairings.map((p) => (
              <div key={p.kscw_team} className="mb-5 last:mb-0">
                <div className="mb-2 flex flex-wrap items-baseline gap-2">
                  <span className="font-semibold text-gray-900 dark:text-gray-100">{p.kscw_team_name}</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">{p.group_label || p.group}</span>
                  {/* null means ProBasket has stated no count — never render it as 0. */}
                  {p.home_games !== null && (
                    <Badge variant="secondary">{t('bbPortalHomeGames', { count: p.home_games })}</Badge>
                  )}
                </div>

                {p.slots.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">{t('bbPortalNoFreeSlots')}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10" />
                          <TableHead>{t('bbPortalColDate')}</TableHead>
                          <TableHead>{t('bbPortalColTime')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {groupSlotsByDate(p.slots).map((d) => {
                          // One row per DATE. The chosen slot id is the club's explicit time
                          // choice if it made one, else the day's best-ranked pitch.
                          const chosen = chosenSlotFor(d)
                          return (
                            <TableRow key={d.date} className="min-h-[44px]">
                              <TableCell>
                                <input
                                  type="checkbox"
                                  aria-label={formatDateZurich(d.date)}
                                  checked={picked.has(chosen.id)}
                                  onChange={() => togglePick(chosen.id)}
                                  className="h-5 w-5 accent-blue-600"
                                />
                              </TableCell>
                              <TableCell className="whitespace-normal break-words font-medium">
                                {formatDateZurich(d.date)}
                              </TableCell>
                              <TableCell>
                                {d.options.length === 1 ? (
                                  <span className="tabular-nums text-sm text-gray-600 dark:text-gray-300">
                                    {d.options[0].time}
                                  </span>
                                ) : (
                                  // Optional refinement, not a required decision — the club may
                                  // simply tick the day. `dark:bg-gray-800` is mandatory: an
                                  // <option> inherits the select's background (CLAUDE.md).
                                  <select
                                    aria-label={t('bbPortalColTime')}
                                    value={String(chosen.id)}
                                    onChange={(e) => chooseTime(d, Number(e.target.value))}
                                    className="min-h-11 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                                  >
                                    {d.options.map((o) => (
                                      <option key={o.id} value={o.id}>
                                        {o.time}{o.end_time ? `–${o.end_time}` : ''} · {o.hall}
                                      </option>
                                    ))}
                                  </select>
                                )}
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            ))}

            <button
              type="button"
              onClick={openProposer}
              disabled={submitting || picked.size === 0}
              className="mt-2 min-h-11 w-full rounded-md bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? t('bbPortalSending') : t('bbPortalPickSubmit', { count: picked.size })}
            </button>
          </div>
        )}

        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4 sm:p-6 dark:border-gray-700 dark:bg-gray-800">
          <label htmlFor="bb-club-note" className="block text-base font-semibold text-gray-900 dark:text-gray-100">
            {t('bbPortalNoteTitle')}
          </label>
          <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">{t('bbPortalNoteHint')}</p>
          <textarea
            id="bb-club-note"
            value={note}
            rows={3}
            maxLength={2000}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('bbPortalNotePlaceholder')}
            className={inputClass}
          />
          {noteChanged && (
            <button
              type="button"
              onClick={handleSaveNote}
              disabled={savingNote || submitting}
              className="mt-3 min-h-11 w-full rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 sm:w-auto dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              {savingNote ? t('bbPortalSending') : t('bbPortalNoteSave')}
            </button>
          )}
        </div>

        <Modal open={responderOpen} onClose={() => setResponderOpen(false)} title={t('bbPortalResponderTitle')} size="sm">
          <div className="space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-400">{t('bbPortalResponderHint')}</p>
            <div>
              <label htmlFor="bb-responder-name" className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
                {t('bbPortalResponderName')}
              </label>
              <input
                id="bb-responder-name"
                type="text"
                autoComplete="name"
                value={responderName}
                onChange={(e) => setResponderName(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="bb-responder-email" className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
                {t('bbPortalResponderEmail')}
              </label>
              <input
                id="bb-responder-email"
                type="email"
                autoComplete="email"
                value={responderEmail}
                onChange={(e) => setResponderEmail(e.target.value)}
                className={inputClass}
              />
            </div>
            {responderError && <p className="text-sm text-red-600 dark:text-red-400">{responderError}</p>}
            <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setResponderOpen(false)}
                className="min-h-11 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                onClick={submitResponse}
                disabled={submitting}
                className="min-h-11 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {t('bbPortalConfirmAndSend')}
              </button>
            </div>
          </div>
        </Modal>

        <p className="mt-8 text-center text-xs text-gray-400 dark:text-gray-500">
          {t('bbPortalHelp')}{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="underline hover:text-gray-600 dark:hover:text-gray-300">{SUPPORT_EMAIL}</a>
        </p>
      </div>
    </div>
  )
}
