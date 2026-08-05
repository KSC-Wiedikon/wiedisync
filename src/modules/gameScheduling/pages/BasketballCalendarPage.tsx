import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { House } from 'lucide-react'
import CalendarGrid from '../../../components/CalendarGrid'
import Modal from '../../../components/Modal'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table'
import { toDateKey, getSeasonYear } from '../../../utils/dateUtils'
import { formatDateZurich } from '../../../utils/dateHelpers'
import { useGameSchedulingSeason } from '../hooks/useGameSchedulingSeason'
import { useBasketballPlan } from '../hooks/useBasketballPlan'
import { parseYmd } from '../utils/probasketSeason'
import type { BasketballSlotPlan, Team } from '../../../types'

// One thing shown on a calendar day: a basketball game (home/guest) or a
// cross-sport volleyball home game (venue coordination). Hall closures render as
// the grid's red day background, not as items.
type CalItem =
  | { id: string; kind: 'bb'; time: string; hall: string; label: string; guest: boolean }
  | { id: string; kind: 'vb'; time: string; hall: string }

export interface BasketballCalendarPanelProps {
  /** Season name ('2026/27') — drives the month range the calendar navigates. */
  seasonName?: string | null
  teams: Team[]
  placements: Map<string, BasketballSlotPlan>
  /** Booked volleyball slots — cross-sport hall coordination. */
  vbGames: { date: string; time: string; hall: string }[]
  closureEntries: { start: string; end: string; hall: string | null; reason: string }[]
  /** date → "no game may be played" reason (ProBasket blackout / club-wide block). */
  blockedDayReasons?: Map<string, string>
}

/**
 * The basketball season calendar: placed games + volleyball home games + hall
 * closures + blocked days on the shared `CalendarGrid`.
 *
 * Extracted from the standalone page so the prep view can show the same calendar
 * beside its slot grid — away games can be placed almost anywhere, so a planner
 * needs the whole month, not just the KWI home pitches.
 */
export function BasketballCalendarPanel({
  seasonName, teams, placements, vbGames, closureEntries, blockedDayReasons,
}: BasketballCalendarPanelProps) {
  const { t } = useTranslation('basketballScheduling')

  const teamName = useCallback(
    (id: string | number | null | undefined, label?: string | null) =>
      (id != null ? teams.find((tm) => String(tm.id) === String(id))?.name : label) ?? label ?? '',
    [teams],
  )

  // Season start year drives the initial month + the Sep→May navigation clamp.
  const startYear = useMemo(() => {
    const y = parseInt(String(seasonName ?? '').slice(0, 4), 10)
    return Number.isFinite(y) ? y : getSeasonYear(new Date())
  }, [seasonName])
  const firstMonth = useMemo(() => new Date(startYear, 8, 1), [startYear]) // September
  // The 1.-Liga grid runs to 09.05.2027, so the calendar must reach May — clamping
  // at March hid the second half of the senior season entirely.
  const lastMonth = useMemo(() => new Date(startYear + 1, 4, 1), [startYear]) // May
  const [month, setMonth] = useState(() => new Date(startYear, 8, 1))
  const goMonth = (d: Date) => setMonth(d < firstMonth ? firstMonth : d > lastMonth ? lastMonth : d)

  // Games (bb + vb) keyed by the same date key CalendarGrid computes per cell.
  const itemsByDate = useMemo(() => {
    const m = new Map<string, CalItem[]>()
    const push = (dateStr: string, item: CalItem) => {
      const d = parseYmd(dateStr)
      if (!d) return
      const k = toDateKey(d)
      const arr = m.get(k) ?? []
      arr.push(item)
      m.set(k, arr)
    }
    for (const p of placements.values()) {
      push(p.date, {
        id: `bb-${p.id}`, kind: 'bb', time: p.time, hall: p.hall,
        label: `${teamName(p.kscw_team, p.kscw_team_label)} vs ${p.opponent ?? '?'}`,
        guest: p.game_type === 'guest',
      })
    }
    for (const g of vbGames) push(g.date, { id: `vb-${g.date}-${g.time}-${g.hall}`, kind: 'vb', time: g.time, hall: g.hall })
    // Sort each day's items by time.
    for (const arr of m.values()) arr.sort((a, b) => a.time.localeCompare(b.time))
    return m
  }, [placements, vbGames, teamName])

  // Hall closures → red day background + a per-day reason, expanding each range.
  const { closedDates, closureReasons } = useMemo(() => {
    const dates = new Set<string>()
    const reasons = new Map<string, string>()
    for (const c of closureEntries) {
      const start = parseYmd(c.start)
      const end = parseYmd(c.end)
      if (!start || !end) continue
      for (let d = new Date(start), guard = 0; d <= end && guard < 400; d.setDate(d.getDate() + 1), guard++) {
        const k = toDateKey(d)
        dates.add(k)
        const label = [c.hall, c.reason].filter(Boolean).join(' — ')
        if (label && !reasons.has(k)) reasons.set(k, label)
      }
    }
    return { closedDates: dates, closureReasons: reasons }
  }, [closureEntries])

  const [dayDetail, setDayDetail] = useState<{ date: Date; items: CalItem[] } | null>(null)

  return (
    <div className="space-y-3">
      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded bg-brand-500" />{t('type_home')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded bg-purple-500" />{t('type_guest')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded bg-amber-400" />{t('homeGameVb')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded bg-red-200 dark:bg-red-900" />{t('closedLabel')}
        </span>
        {blockedDayReasons && blockedDayReasons.size > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded bg-red-400 dark:bg-red-700" />{t('blockedLabel')}
          </span>
        )}
      </div>

      <div className="rounded-lg border border-border bg-white p-2 sm:p-4 dark:bg-gray-800">
        {/* The month grid is 7 columns wide — let it scroll inside its own box on a
            narrow phone instead of widening the page. */}
        <div className="overflow-x-auto">
          <div className="min-w-[19rem]">
            <CalendarGrid<CalItem>
              month={month}
              onMonthChange={goMonth}
              minMonth={firstMonth}
              maxMonth={lastMonth}
              itemsByDate={itemsByDate}
              closedDates={closedDates}
              closedLabel={t('closedLabel')}
              closureReasons={closureReasons}
              blockedDates={blockedDayReasons}
              blockedLabel={t('blockedLabel')}
              onDayClick={(date, items) => {
                if (items.length === 0) return
                setDayDetail({ date, items })
              }}
              renderDayContent={(_date, items) => (
                <div className="flex flex-col gap-0.5">
                  {items.slice(0, 3).map((it) => (
                    <span
                      key={it.id}
                      title={it.kind === 'bb' ? `${it.time} · ${it.hall} · ${it.label}` : `${it.time} · ${it.hall} · ${t('homeGameVb')}`}
                      className={`flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] leading-tight ${
                        it.kind === 'vb'
                          ? 'bg-amber-200 text-amber-900 dark:bg-amber-900/50 dark:text-amber-200'
                          : it.guest
                            ? 'bg-purple-500 text-white'
                            : 'bg-brand-500 text-white'
                      }`}
                    >
                      {it.time && <span className="shrink-0 tabular-nums">{it.time}</span>}
                      {it.kind === 'bb' && !it.guest && <House className="h-2.5 w-2.5 shrink-0" aria-hidden />}
                      <span className="truncate">{it.kind === 'bb' ? it.label : t('homeGameVb')}</span>
                    </span>
                  ))}
                  {items.length > 3 && (
                    <span className="text-[10px] text-gray-500 dark:text-gray-400">+{items.length - 3}</span>
                  )}
                </div>
              )}
            />
          </div>
        </div>
      </div>

      {/* Day-detail modal */}
      <Modal
        open={!!dayDetail}
        onClose={() => setDayDetail(null)}
        title={dayDetail ? formatDateZurich(toDateKey(dayDetail.date)) : ''}
        size="lg"
      >
        {dayDetail && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('colTime')}</TableHead>
                  <TableHead>{t('colHall')}</TableHead>
                  <TableHead>{t('colMatch')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dayDetail.items.map((it) => (
                  <TableRow key={it.id}>
                    <TableCell className="whitespace-nowrap tabular-nums">{it.time || '—'}</TableCell>
                    <TableCell className="whitespace-normal break-words">{it.hall}</TableCell>
                    <TableCell className="whitespace-normal break-words">
                      {it.kind === 'bb' ? (
                        <span className="inline-flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded px-2 py-0.5 text-xs ${
                              it.guest
                                ? 'bg-purple-200 text-purple-800 dark:bg-purple-900/50 dark:text-purple-200'
                                : 'bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200'
                            }`}
                          >
                            {it.guest ? t('type_guest') : t('type_home')}
                          </span>
                          {it.label}
                        </span>
                      ) : (
                        <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                          {t('homeGameVb')}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Modal>
    </div>
  )
}

/**
 * Standalone full-width calendar route (`/admin/terminplanung/basketball/calendar`).
 *
 * KEPT even though the prep page now embeds the same panel: the prep page's copy is a
 * collapsible side-panel next to the slot grid, while this route gives the month the
 * full viewport — which is what you want on a phone, and it is already a nav tab and a
 * bookmarkable deep link.
 */
export default function BasketballCalendarPage() {
  const { t } = useTranslation('basketballScheduling')
  const { season, allSeasons, setSeason } = useGameSchedulingSeason()
  const { teams, placements, vbGames, closureEntries, blockedDayReasons } = useBasketballPlan(season)

  const selectClass = 'rounded-md border border-border bg-transparent px-3 py-2 text-sm dark:bg-gray-800'

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-2xl font-bold">{t('calendarTitle')}</h1>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-muted-foreground">{t('season')}</span>
          <select
            className={selectClass}
            value={season?.id ?? ''}
            onChange={(e) => setSeason(allSeasons.find((s) => String(s.id) === e.target.value) ?? null)}
          >
            {allSeasons.map((s) => (
              <option key={s.id} value={s.id}>{s.season}</option>
            ))}
          </select>
        </label>
      </header>

      <BasketballCalendarPanel
        seasonName={season?.season}
        teams={teams}
        placements={placements}
        vbGames={vbGames}
        closureEntries={closureEntries}
        blockedDayReasons={blockedDayReasons}
      />
    </div>
  )
}
