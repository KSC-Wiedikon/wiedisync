import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import WeekdayHint from './WeekdayHint'
import ProposalContextHints from './ProposalContextHints'
import DatePicker from '@/components/ui/DatePicker'
import type { ProposalHealthProposal } from '../../../types'

interface HallOption {
  id: string | number
  name: string
}

/** One selectable game of a multi-game pairing (id null = legacy single-game). */
export interface ManualFixtureOption {
  id: string | null
  label: string
  /** A confirmed booking already exists for this game (saving overwrites it). */
  booked: boolean
  /** Current values of the existing confirmed booking — pre-filled into the form
   *  when this fixture is selected, so an overwrite is "tweak the time", not retype. */
  prefill?: {
    date?: string        // YYYY-MM-DD
    start_time?: string  // HH:MM (game start)
    hall?: string        // hall id (home leg only)
    place?: string       // away leg only
  }
}

interface Props {
  /** Halls offered for the home leg (KSCW halls). */
  halls: HallOption[]
  /** Hall id of this team's currently-open slots — pre-selected for a brand-new
   *  home game and floated to the top of the hall dropdown. */
  defaultHomeHall?: string | number | null
  /** Selectable games per leg — a pairing can be played 2-3× per season. A
   *  single entry hides the picker; its `booked` flag drives the overwrite hint. */
  homeFixtures: ManualFixtureOption[]
  awayFixtures: ManualFixtureOption[]
  /** Season offer window (YYYY-MM-DD) — bounds the date inputs so an out-of-season
   *  typo (e.g. 10.02.2026 for a 2026/27 season) can't be entered. */
  minDate?: string
  maxDate?: string
  /** Indication only: resolve who'd be absent + adjacent-game spacing for a typed
   *  date (admin/spielplaner-scoped). Returns null when there's nothing to show. */
  fetchDateContext?: (date: string) => Promise<ProposalHealthProposal | null>
  onSave: (legs: {
    home?: { date: string; start_time: string; end_time?: string; hall: number | string; additional_halls?: number[]; svrz_game_id?: string }
    away?: { date: string; start_time?: string; place?: string; svrz_game_id?: string }
  }) => Promise<void>
}

// Add 90 minutes to an HH:MM string (default game length) for a sensible end time.
function plus90(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return ''
  const total = (h * 60 + m + 90) % (24 * 60)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

// First game without a confirmed booking, else the first game — the default
// pick for a leg's fixture select.
const defaultFixture = (opts: ManualFixtureOption[]): string =>
  String((opts.find((o) => !o.booked) ?? opts[0])?.id ?? '')

// Manually record an already-agreed matchup (date settled by email/phone outside
// the tool), skipping the opponent's propose/choose flow. Collapsed by default;
// the admin fills the home leg, the away leg, or both.
export default function ManualBookingForm({ halls, defaultHomeHall, homeFixtures, awayFixtures, minDate, maxDate, fetchDateContext, onSave }: Props) {
  const { t } = useTranslation('gameScheduling')
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  // Indication-only date context (absences + adjacent-game spacing), per leg.
  const [homeCtx, setHomeCtx] = useState<ProposalHealthProposal | null>(null)
  const [awayCtx, setAwayCtx] = useState<ProposalHealthProposal | null>(null)
  const ctxTimers = useRef<{ home?: ReturnType<typeof setTimeout>; away?: ReturnType<typeof setTimeout> }>({})

  const [homeOn, setHomeOn] = useState(false)
  const [homeFixtureId, setHomeFixtureId] = useState(() => defaultFixture(homeFixtures))
  const [homeDate, setHomeDate] = useState('')
  const [homeStart, setHomeStart] = useState('')
  const [homeHall, setHomeHall] = useState<string>('')
  // Extra courts for a multi-hall game (e.g. an H1/H3 derby across KWI A+B with
  // the divider open). VolleyManager takes the whole set as ONE combo gym.
  const [homeExtraHalls, setHomeExtraHalls] = useState<string[]>([])

  const [awayOn, setAwayOn] = useState(false)
  const [awayFixtureId, setAwayFixtureId] = useState(() => defaultFixture(awayFixtures))
  const [awayDate, setAwayDate] = useState('')
  const [awayStart, setAwayStart] = useState('')
  const [awayPlace, setAwayPlace] = useState('')

  // Indication-only: (re)load the absence + spacing hint for a leg's date,
  // debounced. Runs in the handler (not an effect) to stay lint-clean; clears
  // immediately for an empty/out-of-window date.
  const refreshCtx = (leg: 'home' | 'away', date: string) => {
    const set = leg === 'home' ? setHomeCtx : setAwayCtx
    const timers = ctxTimers.current
    if (timers[leg]) clearTimeout(timers[leg])
    const valid = !!date && /^\d{4}-\d{2}-\d{2}$/.test(date) && !((minDate && date < minDate) || (maxDate && date > maxDate))
    if (!fetchDateContext || !valid) { set(null); return }
    timers[leg] = setTimeout(() => {
      fetchDateContext(date).then((c) => set(c)).catch(() => set(null))
    }, 350)
  }

  const reset = () => {
    setHomeOn(false); setHomeDate(''); setHomeStart(''); setHomeHall(''); setHomeExtraHalls([])
    setAwayOn(false); setAwayDate(''); setAwayStart(''); setAwayPlace('')
    setHomeFixtureId(defaultFixture(homeFixtures))
    setAwayFixtureId(defaultFixture(awayFixtures))
    setHomeCtx(null); setAwayCtx(null)
  }

  // Pre-fill a leg from the selected fixture: its existing confirmed booking when
  // overwriting (req 1), else — for the home leg — the team's open-slot gym (req 2).
  const applyHomePrefill = (fx?: ManualFixtureOption) => {
    setHomeDate(fx?.prefill?.date || '')
    setHomeStart(fx?.prefill?.start_time || '')
    setHomeHall(String(fx?.prefill?.hall ?? defaultHomeHall ?? ''))
    // Switching fixture must not carry the previous one's extra courts over —
    // that would silently book a second hall for an unrelated game.
    setHomeExtraHalls([])
    refreshCtx('home', fx?.prefill?.date || '')
  }
  const applyAwayPrefill = (fx?: ManualFixtureOption) => {
    setAwayDate(fx?.prefill?.date || '')
    setAwayStart(fx?.prefill?.start_time || '')
    setAwayPlace(fx?.prefill?.place || '')
    refreshCtx('away', fx?.prefill?.date || '')
  }

  // The fixture options load lazily (per-team SVRZ fetch) and can arrive after
  // mount — re-pick the default whenever the current selection isn't offered.
  // Keyed on the options array (React's adjust-state-during-render pattern): the
  // initial state and every other setter already pick an offered id, so a new
  // options array is the only thing that can invalidate the selection.
  const [prevHomeFixtures, setPrevHomeFixtures] = useState(homeFixtures)
  if (prevHomeFixtures !== homeFixtures) {
    setPrevHomeFixtures(homeFixtures)
    if (!homeFixtures.some((o) => String(o.id ?? '') === homeFixtureId)) setHomeFixtureId(defaultFixture(homeFixtures))
  }
  const [prevAwayFixtures, setPrevAwayFixtures] = useState(awayFixtures)
  if (prevAwayFixtures !== awayFixtures) {
    setPrevAwayFixtures(awayFixtures)
    if (!awayFixtures.some((o) => String(o.id ?? '') === awayFixtureId)) setAwayFixtureId(defaultFixture(awayFixtures))
  }

  const selectedHome = homeFixtures.find((o) => String(o.id ?? '') === homeFixtureId)
  const selectedAway = awayFixtures.find((o) => String(o.id ?? '') === awayFixtureId)

  // Float this team's open-slot gym to the top of the hall dropdown (req 2) so
  // the pre-selected default is also the first option offered.
  const defaultHallKey = defaultHomeHall != null ? String(defaultHomeHall) : ''
  const orderedHalls = defaultHallKey
    ? [...halls.filter((h) => String(h.id) === defaultHallKey), ...halls.filter((h) => String(h.id) !== defaultHallKey)]
    : halls
  // Warn (don't block — manual booking is a deliberate override) when the chosen
  // home hall isn't the gym this team is assigned in its open slots.
  const homeHallMismatch = homeOn && !!homeHall && !!defaultHallKey && homeHall !== defaultHallKey

  // True if a date falls outside the season offer window (typo guard).
  const outOfWindow = (date: string) => !!date && ((minDate && date < minDate) || (maxDate && date > maxDate))
  const fmtWin = (ymd: string) => { const [y, m, d] = ymd.split('-'); return `${d}.${m}.${y}` }

  const handleSave = async () => {
    const legs: Parameters<typeof onSave>[0] = {}
    if ((homeOn && outOfWindow(homeDate)) || (awayOn && outOfWindow(awayDate))) {
      toast.error(t('manualDateOutOfWindow', { start: fmtWin(minDate || ''), end: fmtWin(maxDate || '') }))
      return
    }
    if (homeOn) {
      if (!homeDate || !homeStart || !homeHall) { toast.error(t('manualHomeIncomplete')); return }
      // Drop the primary if it somehow got ticked — it's implicit in `hall`, and
      // a set containing it twice is not a combo.
      const extras = homeExtraHalls.filter((h) => h !== homeHall).map(Number).filter(Number.isFinite)
      legs.home = {
        // End time is derived (start + 90 min) — the admin only enters a start.
        date: homeDate, start_time: homeStart, end_time: plus90(homeStart), hall: homeHall,
        // Send [] as undefined so an ordinary single-court booking keeps the exact
        // payload it has always sent.
        ...(extras.length ? { additional_halls: extras } : {}),
        ...(homeFixtureId ? { svrz_game_id: homeFixtureId } : {}),
      }
    }
    if (awayOn) {
      if (!awayDate) { toast.error(t('manualAwayIncomplete')); return }
      legs.away = {
        date: awayDate, start_time: awayStart || undefined, place: awayPlace || undefined,
        ...(awayFixtureId ? { svrz_game_id: awayFixtureId } : {}),
      }
    }
    if (!legs.home && !legs.away) { toast.error(t('manualNothingToSave')); return }
    setSaving(true)
    try {
      await onSave(legs)
      toast.success(t('manualSaved'))
      reset(); setOpen(false)
    } catch (err) {
      toast.error((err as { body?: { error?: string } })?.body?.error || (err instanceof Error ? err.message : String(err)))
    } finally {
      setSaving(false)
    }
  }

  const fieldCls = 'w-full rounded-lg border border-input bg-card px-2 py-1.5 text-sm text-foreground focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring h-11 sm:h-9'
  const inputCls = `${fieldCls} dark:bg-input/20`

  if (!open) {
    return (
      <div className="mt-3 border-t border-border/70 pt-3">
        <Button
          type="button"
          onClick={() => setOpen(true)}
          variant="link"
          size="sm"
          className="px-0 text-xs"
        >
          {t('manualEnterAgreed')}
        </Button>
      </div>
    )
  }

  return (
    <div className="mt-3 space-y-3 border-t border-border/70 pt-3">
      <p className="text-xs text-muted-foreground">{t('manualBookingHint')}</p>

      {/* Home leg */}
      <div className="rounded-xl border border-hairline bg-surface-sunken p-2">
        <label className="flex items-center gap-2 text-sm font-medium text-foreground/85">
          <input
            type="checkbox" checked={homeOn}
            onChange={(e) => { setHomeOn(e.target.checked); if (e.target.checked) applyHomePrefill(selectedHome) }}
          />
          {t('manualHomeGame')}{selectedHome?.booked ? ` (${t('manualOverwrite')})` : ''}
        </label>
        {homeOn && homeFixtures.length > 1 && (
          <label htmlFor="mbf-home-fixture" className="mt-2 block">
            <span className="mb-0.5 block text-xs text-muted-foreground">{t('manualWhichGame')}</span>
            <select
              id="mbf-home-fixture"
              value={homeFixtureId}
              onChange={(e) => { setHomeFixtureId(e.target.value); applyHomePrefill(homeFixtures.find((o) => String(o.id ?? '') === e.target.value)) }}
              className={`${fieldCls} dark:bg-gray-800`}
            >
              {homeFixtures.map((o) => (
                <option key={String(o.id ?? '')} value={String(o.id ?? '')}>
                  {o.label}{o.booked ? ` (${t('manualOverwrite')})` : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        {homeOn && (
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div className="col-span-2 sm:col-span-1">
              <DatePicker
                id="mbf-home-date"
                label={t('manualDate')}
                value={homeDate}
                min={minDate}
                max={maxDate}
                onChange={(v) => { setHomeDate(v); refreshCtx('home', v) }}
              />
              <WeekdayHint date={homeDate} className="mt-0.5 block" />
            </div>
            <label htmlFor="mbf-home-start">
              <span className="mb-0.5 block text-xs text-muted-foreground">{t('manualStart')}</span>
              <input id="mbf-home-start" type="time" value={homeStart} onChange={(e) => setHomeStart(e.target.value)} className={inputCls} />
            </label>
            <label htmlFor="mbf-home-hall" className="col-span-2 sm:col-span-1">
              <span className="mb-0.5 block text-xs text-muted-foreground">{t('manualHall')}</span>
              <select
                id="mbf-home-hall"
                value={homeHall}
                onChange={(e) => {
                  const next = e.target.value
                  setHomeHall(next)
                  // The new primary can't also be an "also uses" court.
                  setHomeExtraHalls((prev) => prev.filter((x) => x !== next))
                }}
                className={`${fieldCls} dark:bg-gray-800`}
              >
                <option value="">{t('manualSelectHall')}</option>
                {orderedHalls.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}{defaultHallKey && String(h.id) === defaultHallKey ? ` (${t('manualOpenSlotHall')})` : ''}
                  </option>
                ))}
              </select>
            </label>
            {/* Extra courts. Only offered once a primary hall is picked — an
                "also uses" list with nothing to add to would be meaningless. */}
            {homeHall && orderedHalls.length > 1 && (
              <fieldset className="col-span-2">
                <legend className="mb-0.5 block text-xs text-muted-foreground">{t('manualAlsoUses')}</legend>
                <div className="flex flex-wrap gap-x-3 gap-y-1.5">
                  {orderedHalls.filter((h) => String(h.id) !== homeHall).map((h) => (
                    <label key={h.id} htmlFor={`mbf-extra-${h.id}`} className="flex min-h-[44px] items-center gap-1.5 text-sm sm:min-h-0">
                      <input
                        id={`mbf-extra-${h.id}`}
                        type="checkbox"
                        checked={homeExtraHalls.includes(String(h.id))}
                        onChange={(e) => setHomeExtraHalls((prev) => (
                          e.target.checked ? [...prev, String(h.id)] : prev.filter((x) => x !== String(h.id))
                        ))}
                        className="h-4 w-4"
                      />
                      <span>{h.name}</span>
                    </label>
                  ))}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{t('manualAlsoUsesHint')}</p>
              </fieldset>
            )}
          </div>
        )}
        {homeOn && homeCtx && (
          <div className="mt-1.5"><ProposalContextHints hp={homeCtx} /></div>
        )}
        {homeHallMismatch && (
          <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
            ⚠ {t('manualHallMismatchWarn')}
          </p>
        )}
      </div>

      {/* Away leg */}
      <div className="rounded-xl border border-hairline bg-surface-sunken p-2">
        <label className="flex items-center gap-2 text-sm font-medium text-foreground/85">
          <input
            type="checkbox" checked={awayOn}
            onChange={(e) => { setAwayOn(e.target.checked); if (e.target.checked) applyAwayPrefill(selectedAway) }}
          />
          {t('manualAwayGame')}{selectedAway?.booked ? ` (${t('manualOverwrite')})` : ''}
        </label>
        {awayOn && awayFixtures.length > 1 && (
          <label htmlFor="mbf-away-fixture" className="mt-2 block">
            <span className="mb-0.5 block text-xs text-muted-foreground">{t('manualWhichGame')}</span>
            <select
              id="mbf-away-fixture"
              value={awayFixtureId}
              onChange={(e) => { setAwayFixtureId(e.target.value); applyAwayPrefill(awayFixtures.find((o) => String(o.id ?? '') === e.target.value)) }}
              className={`${fieldCls} dark:bg-gray-800`}
            >
              {awayFixtures.map((o) => (
                <option key={String(o.id ?? '')} value={String(o.id ?? '')}>
                  {o.label}{o.booked ? ` (${t('manualOverwrite')})` : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        {awayOn && (
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="col-span-2 sm:col-span-1">
              <DatePicker
                id="mbf-away-date"
                label={t('manualDate')}
                value={awayDate}
                min={minDate}
                max={maxDate}
                onChange={(v) => { setAwayDate(v); refreshCtx('away', v) }}
              />
              <WeekdayHint date={awayDate} className="mt-0.5 block" />
            </div>
            <label htmlFor="mbf-away-start">
              <span className="mb-0.5 block text-xs text-muted-foreground">{t('manualStart')}</span>
              <input id="mbf-away-start" type="time" value={awayStart} onChange={(e) => setAwayStart(e.target.value)} className={inputCls} />
            </label>
            <label htmlFor="mbf-away-place" className="col-span-2">
              <span className="mb-0.5 block text-xs text-muted-foreground">{t('manualPlace')}</span>
              <input id="mbf-away-place" type="text" value={awayPlace} onChange={(e) => setAwayPlace(e.target.value)} placeholder={t('manualPlacePlaceholder')} className={inputCls} />
            </label>
          </div>
        )}
        {awayOn && awayCtx && (
          <div className="mt-1.5"><ProposalContextHints hp={awayCtx} /></div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          onClick={handleSave}
          disabled={saving}
          size="sm"
        >
          {saving ? t('saving') : t('manualSave')}
        </Button>
        <Button
          type="button"
          onClick={() => { reset(); setOpen(false) }}
          disabled={saving}
          variant="ghost"
          size="sm"
        >
          {t('cancel')}
        </Button>
      </div>
    </div>
  )
}
