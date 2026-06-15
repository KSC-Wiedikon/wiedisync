import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { parseISO, isBefore, isAfter } from 'date-fns'
import { gameStartForDate } from '../utils/slotTime'
import { Calendar } from '@/components/ui/calendar'
import { Button } from '@/components/ui/button'
import Modal from '@/components/Modal'
import type { SlotData, BookingData } from '../hooks/useAvailableSlots'
import { toDateKey, formatDateLocale } from '@/utils/dateUtils'

interface Props {
  slots: SlotData[]
  existing?: BookingData
  onSubmit?: (slotIds: string[]) => Promise<void>
  /** Report the current picks (3 distinct ids) or null while incomplete, so a
   *  parent can drive a single combined submit. */
  onChange?: (slotIds: string[] | null) => void
  /** Hide the form's own submit button (parent owns submission). */
  hideSubmit?: boolean
  /** Selectable window (season open → close). Days outside it render "season not open". */
  seasonWindow?: { start: string; end: string } | null
}

interface TimeOption {
  start_time: string
  end_time: string
  hallLabel: string
  slotId: string
  strict: boolean
}


// "KWI A" + "KWI B" -> "KWI A/B"; otherwise join with " / ".
function mergeHalls(names: string[]): string {
  const uniq = [...new Set(names.filter(Boolean))].sort()
  if (uniq.length <= 1) return uniq[0] || ''
  const parts = uniq.map((n) => n.split(' '))
  const prefix = parts[0][0]
  if (parts.every((p) => p[0] === prefix)) {
    return `${prefix} ${parts.map((p) => p.slice(1).join(' ')).join('/')}`
  }
  return uniq.join(' / ')
}

// Opponent proposes exactly 3 home slots; the spielplaner confirms one. Slots
// 1 & 2 come from the strict pool (home gap + full squad), slot 3 may also use
// the lenient pool (proposal-3 gap, a couple of absences) — mirrors the away
// proposal form's strict/loose split. Slots are NOT reserved on submit.
export default function HomeProposalForm({ slots, existing, onSubmit, onChange, hideSubmit, seasonWindow }: Props) {
  const { t, i18n } = useTranslation('gameScheduling')
  const winStart = seasonWindow ? parseISO(seasonWindow.start) : null
  const winEnd = seasonWindow ? parseISO(seasonWindow.end) : null
  const isOutOfSeason = (date: Date) => (!!winStart && isBefore(date, winStart)) || (!!winEnd && isAfter(date, winEnd))
  const [picks, setPicks] = useState<(string | null)[]>(() => [
    existing?.proposed_slot_1 != null ? String(existing.proposed_slot_1) : null,
    existing?.proposed_slot_2 != null ? String(existing.proposed_slot_2) : null,
    existing?.proposed_slot_3 != null ? String(existing.proposed_slot_3) : null,
  ])
  const [activeRow, setActiveRow] = useState<number | null>(null)
  const [view, setView] = useState<'calendar' | 'list'>('calendar')
  const [modalDate, setModalDate] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const slotById = useMemo(() => new Map(slots.map((s) => [s.id, s])), [slots])
  // Smart slots: a team may have fewer than 3 offerable days (after cross-team,
  // Saturday, derby, distinct-day… filters), so require only as many picks as
  // there are available days — never a mandatory 3.
  const availableDays = useMemo(() => new Set(slots.map((s) => s.date)).size, [slots])
  const requiredPicks = Math.min(3, availableDays)
  // Fallback labels for already-proposed slots no longer in the available list
  // (e.g. booked by someone else since) — server-enriched on the pending booking.
  const proposedById = useMemo(() => {
    const m = new Map<string, { date?: string; start?: string; end?: string; hall_name?: string }>()
    for (const p of existing?.proposed_slots || []) m.set(String(p.slot_id), p)
    return m
  }, [existing])

  // Pool for the active row, gated by priority via the 3 picks. Excludes slots
  // already chosen in the other rows.
  //  - Picks 1 & 2: strict pool only — the own slot / Spielsamstag / Döltschi
  //    (Sundays are non-strict for juniors, so they can't land here).
  //  - Pick 3 (lenient): Sundays stay last-resort. Offer non-Sunday slots first;
  //    only when none remain, Spielsamstag-weekend Sundays; only when none of
  //    those remain, other Sundays. So a Sunday is only ever offered when no
  //    Saturday/other slot is available — and only as the 3rd pick.
  const poolSlots = useMemo(() => {
    if (activeRow == null) return []
    const otherPicks = new Set(picks.filter((p, i) => p && i !== activeRow) as string[])
    // Exclude any DATE already used by another pick — the three options must be on
    // three DIFFERENT days (same-day / different-time makes no sense).
    const usedDates = new Set(
      ([...otherPicks].map((id) => slotById.get(id)?.date).filter(Boolean)) as string[],
    )
    const avail = slots.filter((s) => !otherPicks.has(s.id) && !usedDates.has(s.date))
    // Smart: too few offerable days to satisfy the strict/lenient tiering — offer
    // whatever's available for every pick.
    if (availableDays < 3) return avail
    if (activeRow < 2) return avail.filter((s) => s.strict)
    // Pick 3: offer only the highest-priority tier still available, so each lower
    // tier is used only when nothing better is left. Priority (juniors):
    //   1 own slot / Spielsamstag / Döltschi  →  2 Friday Spielhalle
    //   →  3 Spielsamstag-weekend Sundays  →  4 other Sundays
    const isSun = (s: SlotData) => new Date(`${s.date}T00:00:00Z`).getUTCDay() === 0
    const tier = (s: SlotData) =>
      isSun(s) ? (s.preferred ? 3 : 4) : s.source === 'spielhalle' ? 2 : 1
    const best = avail.reduce((m, s) => Math.min(m, tier(s)), 5)
    return avail.filter((s) => tier(s) === best)
  }, [slots, activeRow, picks, slotById, availableDays])

  // date -> time options, merging same date+time across halls (strict if any).
  const byDate = useMemo(() => {
    const dm = new Map<string, Map<string, { start_time: string; end_time: string; members: { hall: string; slotId: string }[]; strict: boolean }>>()
    for (const s of poolSlots) {
      if (!dm.has(s.date)) dm.set(s.date, new Map())
      const tm = dm.get(s.date)!
      const tk = `${s.start_time}-${s.end_time}`
      if (!tm.has(tk)) tm.set(tk, { start_time: s.start_time, end_time: s.end_time, members: [], strict: false })
      const e = tm.get(tk)!
      e.members.push({ hall: s.hall_name, slotId: s.id })
      e.strict = e.strict || !!s.strict
    }
    const out = new Map<string, TimeOption[]>()
    for (const [dk, tm] of dm) {
      out.set(
        dk,
        [...tm.values()]
          .sort((a, b) => a.start_time.localeCompare(b.start_time))
          .map((v) => {
            const sorted = [...v.members].sort((a, b) => a.hall.localeCompare(b.hall))
            return {
              start_time: v.start_time,
              end_time: v.end_time,
              hallLabel: mergeHalls(sorted.map((m) => m.hall)),
              slotId: sorted[0].slotId,
              strict: v.strict,
            }
          }),
      )
    }
    return out
  }, [poolSlots])

  const availableDates = useMemo(() => new Set(byDate.keys()), [byDate])
  const sortedDates = useMemo(() => [...byDate.keys()].sort(), [byDate])
  const spielsamstagDates = useMemo(
    () => [...new Set(poolSlots.filter((s) => s.source === 'spielsamstag').map((s) => s.date))].sort(),
    [poolSlots],
  )
  const spielsamstagSet = useMemo(() => new Set(spielsamstagDates), [spielsamstagDates])

  const modalOptions = modalDate ? byDate.get(modalDate) ?? [] : []

  const assign = (slotId: string) => {
    setPicks((prev) => prev.map((p, i) => (i === activeRow ? slotId : p)))
    setModalDate(null)
    setActiveRow(null)
  }

  const slotLabel = (slotId: string) => {
    const s = slotById.get(slotId)
    if (s) return `${formatDateLocale(parseISO(s.date), 'EEE d. MMM', i18n.language)} · ${gameStartForDate(s.date, s.start_time)}${s.hall_name ? ` · ${s.hall_name}` : ''}`
    const p = proposedById.get(slotId)
    if (p?.date) return `${formatDateLocale(parseISO(p.date), 'EEE d. MMM', i18n.language)} · ${gameStartForDate(p.date, p.start)}${p.hall_name ? ` · ${p.hall_name}` : ''}`
    return slotId
  }

  const filled = picks.filter(Boolean) as string[]
  // At least one pick is enough to submit (the backend accepts 1–3 distinct
  // slots); the opponent may still add up to `requiredPicks` if they want.
  const allFilled = filled.length >= 1 && new Set(filled).size === filled.length

  // Report the current picks upward (for a parent-owned combined submit).
  useEffect(() => {
    onChange?.(allFilled ? filled : null)
  }, [picks, allFilled, onChange])

  const handleSubmit = async () => {
    if (!allFilled) return
    setSubmitting(true)
    try {
      await onSubmit?.(filled)
    } finally {
      setSubmitting(false)
    }
  }

  // ── Picker view (a row is being filled) ──────────────────────────────────
  if (activeRow != null) {
    return (
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => { setActiveRow(null); setModalDate(null) }}
          className="inline-flex items-center gap-1 text-sm font-medium text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
        >
          <span aria-hidden>←</span> {t('slotN', { number: activeRow + 1 })}
        </button>

        {sortedDates.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('noSlotsAvailable')}</p>
        ) : (
          <>
            {spielsamstagDates.length > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-900/20">
                <p className="mb-2 text-xs font-medium text-amber-800 dark:text-amber-200">
                  {t('spielsamstagPickFirst')}
                </p>
                <div className="flex flex-wrap gap-2">
                  {spielsamstagDates.map((dk) => (
                    <button
                      key={dk}
                      type="button"
                      onClick={() => setModalDate(dk)}
                      className="inline-flex items-center gap-2 rounded-md border border-amber-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-amber-900/40"
                    >
                      {formatDateLocale(parseISO(dk), 'EEE d. MMM', i18n.language)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-1">
              <Button type="button" size="sm" variant={view === 'calendar' ? 'default' : 'outline'} onClick={() => setView('calendar')}>
                {t('calendarView')}
              </Button>
              <Button type="button" size="sm" variant={view === 'list' ? 'default' : 'outline'} onClick={() => setView('list')}>
                {t('listView')}
              </Button>
            </div>

            {view === 'calendar' ? (
              <div className="flex flex-col items-center gap-2">
                <Calendar
                  mode="single"
                  weekStartsOn={1}
                  showOutsideDays={false}
                  defaultMonth={parseISO(sortedDates[0])}
                  startMonth={winStart ?? parseISO(sortedDates[0])}
                  endMonth={winEnd ?? parseISO(sortedDates[sortedDates.length - 1])}
                  disabled={(date) => !availableDates.has(toDateKey(date))}
                  modifiers={{
                    spielsamstag: (date) => spielsamstagSet.has(toDateKey(date)),
                    outOfSeason: isOutOfSeason,
                  }}
                  modifiersClassNames={{
                    spielsamstag: 'bg-amber-100 dark:bg-amber-900/40 font-semibold',
                    outOfSeason: '!bg-black !text-white/40',
                  }}
                  onDayClick={(day, modifiers) => {
                    if (modifiers.disabled) return
                    setModalDate(toDateKey(day))
                  }}
                />
                {seasonWindow && (
                  <p className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
                    <span className="inline-block h-3 w-3 rounded-sm bg-black" />
                    {t('outsideSeasonLabel')}
                  </p>
                )}
              </div>
            ) : (
              <div className="max-h-80 space-y-1 overflow-y-auto">
                {sortedDates.map((dk) => {
                  const opts = byDate.get(dk)!
                  return (
                    <button
                      key={dk}
                      type="button"
                      onClick={() => setModalDate(dk)}
                      className="flex w-full items-center justify-between rounded-md border border-gray-200 bg-white px-3 py-2.5 text-left text-sm hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:hover:bg-gray-600"
                    >
                      <span className="flex items-center gap-2 font-medium text-gray-900 dark:text-gray-100">
                        {formatDateLocale(parseISO(dk), 'EEE d. MMM yyyy', i18n.language)}
                        {spielsamstagSet.has(dk) && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-200">
                            {t('sourceSpielsamstag')}
                          </span>
                        )}
                      </span>
                      <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                        {opts.length === 1
                          ? `${gameStartForDate(dk, opts[0].start_time)} · ${opts[0].hallLabel}`
                          : t('nTimeOptions', { count: opts.length })}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </>
        )}

        <Modal
          open={!!modalDate}
          onClose={() => setModalDate(null)}
          title={modalDate ? formatDateLocale(parseISO(modalDate), 'EEE d. MMM yyyy', i18n.language) : ''}
          size="sm"
        >
          <div className="space-y-2">
            <p className="text-xs text-gray-500 dark:text-gray-400">{t('pickTimeProposalHint')}</p>
            {modalOptions.map((o) => (
              <button
                key={o.slotId}
                type="button"
                onClick={() => assign(o.slotId)}
                className="flex w-full items-center justify-between rounded-md border border-gray-200 px-3 py-3 text-sm hover:border-blue-500 hover:bg-blue-50 dark:border-gray-600 dark:hover:bg-blue-900/30"
              >
                <span className="font-medium text-gray-900 dark:text-gray-100">
                  {gameStartForDate(modalDate, o.start_time)}
                </span>
                <span className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                  {!o.strict && (
                    <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-medium text-orange-700 dark:bg-orange-900/40 dark:text-orange-200">
                      {t('tightOption')}
                    </span>
                  )}
                  {o.hallLabel}
                </span>
              </button>
            ))}
          </div>
        </Modal>
      </div>
    )
  }

  // ── Main view: 3 ordered slot rows + submit ──────────────────────────────
  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500 dark:text-gray-400">{t('homeProposalDesc')}</p>
      {[0, 1, 2].filter((i) => i < requiredPicks).map((i) => (
        <button
          key={i}
          type="button"
          onClick={() => { setActiveRow(i); setView('calendar'); setModalDate(null) }}
          className="flex w-full items-center justify-between gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-3 text-left dark:border-gray-600 dark:bg-gray-700"
        >
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
            {t('slotN', { number: i + 1 })}
            {i === 0 && <span className="ml-1 text-green-700 dark:text-green-300">· {t('slotReserved')}</span>}
            {i === 2 && <span className="ml-1 text-orange-600 dark:text-orange-300">· {t('slotLenientHint')}</span>}
          </span>
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
            {picks[i] ? slotLabel(picks[i]!) : t('pickSlot')}
          </span>
        </button>
      ))}

      <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
        {t('firstChoiceReservedNote')}
      </p>
      {existing?.status === 'pending' && (
        <p className="text-xs text-yellow-600 dark:text-yellow-400">{t('awaitingConfirmation')}</p>
      )}

      {!hideSubmit && (
        <button
          type="button"
          disabled={!allFilled || submitting}
          onClick={handleSubmit}
          className="w-full rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {submitting ? t('submitting') : existing ? t('updateProposals') : t('submitProposals')}
        </button>
      )}
    </div>
  )
}
