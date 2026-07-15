import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '../../../components/ui/button'
import { formatDateZurich } from '../../../utils/dateHelpers'
import { useGameSchedulingSeason } from '../hooks/useGameSchedulingSeason'
import { useBasketballPlan, type PlaceGameInput } from '../hooks/useBasketballPlan'
import { parseYmd, slotsForDate } from '../utils/probasketSeason'
import { exportBasketballAvailability } from '../lib/basketballAvailabilityExport'
import PlaceGameModal from '../components/PlaceGameModal'
import type { BasketballSlotPlan, Team } from '../../../types'

// The ~5 teams that must file the 17-Aug hall-availability form (1. Liga + U12/HU16
// qualification), by teams.bb_source_id: Lions D1, Herren 1, DU12, HU12, HU16.
const AUTOMATIC_BB_SOURCE_IDS = ['4445', '1348', '5104', '5791', '5498']

// Weekday abbreviation follows the UI language (Sun/Sa/So/…); the full date stays
// Swiss dd.mm.yyyy via formatDateZurich.
const WEEKDAY_LOCALE: Record<string, string> = { en: 'en-GB', de: 'de-CH', fr: 'fr-CH', it: 'it-CH', gsw: 'de-CH' }
function weekday(ymd: string, lang: string): string {
  return new Intl.DateTimeFormat(WEEKDAY_LOCALE[lang] ?? 'de-CH', { weekday: 'short' }).format(parseYmd(ymd))
}

interface ModalSlot {
  date: string
  dow: number
  time: string
  hall: string
  canCombineAB: boolean
  existing: BasketballSlotPlan | null
}

export default function BasketballPrepPage() {
  const { t, i18n } = useTranslation('basketballScheduling')
  const { season, allSeasons, isLoading: seasonLoading, setSeason } = useGameSchedulingSeason()
  const {
    config, candidateDates, teams, dateInfoByDate, vbHallsByDate,
    placements, availability, availKey, slotView, highlightFor, isLoading, error, placeGame, removeGame,
  } = useBasketballPlan(season)

  const [picked, setPicked] = useState<string | number | null>(null)
  const teamId =
    picked != null && teams.some((tm) => String(tm.id) === String(picked)) ? picked : teams[0]?.id ?? ''
  const [modal, setModal] = useState<ModalSlot | null>(null)
  const [exporting, setExporting] = useState(false)

  const teamName = useMemo(() => {
    const m = new Map<string, string>()
    for (const tm of teams) m.set(String(tm.id), tm.name)
    return m
  }, [teams])

  const placementLabel = (p: BasketballSlotPlan): string => {
    const ksc = p.kscw_team ? teamName.get(String(p.kscw_team)) ?? '' : p.kscw_team_label ?? ''
    const opp = p.opponent ?? '?'
    return `${ksc} vs ${opp}`
  }

  // Other placed games within ±3 days of the modal's date — shown for context.
  const nearby = useMemo(() => {
    if (!modal) return []
    const target = parseYmd(modal.date).getTime()
    return [...placements.values()]
      .filter((p) => Math.abs(parseYmd(p.date).getTime() - target) <= 3 * 86400000)
      .filter((p) => !(p.date === modal.date && p.time === modal.time && p.hall === modal.hall))
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
      .map((p) => ({ date: p.date, time: p.time, hall: p.hall, label: placementLabel(p) }))
  }, [modal, placements, teamName])

  async function doExport(mode: 'team' | 'auto') {
    const exportTeams: Team[] =
      mode === 'team'
        ? teams.filter((tm) => String(tm.id) === String(teamId))
        : teams.filter((tm) => AUTOMATIC_BB_SOURCE_IDS.includes(String(tm.bb_source_id)))
    if (!exportTeams.length) {
      toast.error(t('exportNoTeams'))
      return
    }
    setExporting(true)
    try {
      await exportBasketballAvailability({
        season, teams: exportTeams, candidateDates, dateInfoByDate, vbHallsByDate, availability, availKey,
      })
    } catch {
      toast.error(t('exportError'))
    } finally {
      setExporting(false)
    }
  }

  const selectClass = 'rounded-md border border-border bg-transparent px-3 py-2 text-sm dark:bg-gray-800'

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">{t('prepTitle')}</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      <div className="flex flex-wrap items-end gap-4">
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
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-muted-foreground">{t('highlightTeam')}</span>
          <select className={selectClass} value={String(teamId)} onChange={(e) => setPicked(e.target.value)}>
            {teams.length === 0 && <option value="">—</option>}
            {teams.map((tm) => (
              <option key={tm.id} value={tm.id}>{tm.name}</option>
            ))}
          </select>
        </label>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => doExport('team')} disabled={exporting || !teamId}>
            {t('exportTeam')}
          </Button>
          <Button variant="outline" onClick={() => doExport('auto')} disabled={exporting}>
            {t('exportAuto')}
          </Button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium text-muted-foreground">{t('legend')}:</span>
        <span className="rounded px-2 py-0.5 bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">{t('statusFree')}</span>
        <span className="rounded px-2 py-0.5 bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200">{t('statusGame')}</span>
        <span className="rounded px-2 py-0.5 bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">{t('statusVbUsing')}</span>
        <span className="rounded px-2 py-0.5 bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300">{t('statusUnavailable')}</span>
      </div>

      <p className="text-xs text-amber-700 dark:text-amber-400">⚠ {t('provisional')}</p>

      {seasonLoading || isLoading ? (
        <p className="text-sm text-muted-foreground">{t('loading')}</p>
      ) : error ? (
        <p className="text-sm text-rose-600">{String(error.message)}</p>
      ) : !season ? (
        <p className="text-sm text-muted-foreground">{t('noSeason')}</p>
      ) : !config ? (
        <p className="text-sm text-muted-foreground">{t('noConfig', { season: season.season })}</p>
      ) : (
        <div className="space-y-3">
          {candidateDates.map((cd) => {
            const info = dateInfoByDate.get(cd.date)
            const { times } = slotsForDate(cd.dow)
            if (info?.fullyBlocked) {
              return (
                <div key={cd.date} className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm opacity-70">
                  <span className="font-medium">{weekday(cd.date, i18n.language)} {formatDateZurich(cd.date)}</span>
                  <span className="rounded px-2 py-0.5 text-xs bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                    {t('statusUnavailable')}{info.blackout ? ` — ${info.blackout}` : ''}
                  </span>
                </div>
              )
            }
            return (
              <div key={cd.date} className="rounded-lg border border-border">
                <div className="border-b border-border px-3 py-2 text-sm font-semibold">
                  {weekday(cd.date, i18n.language)} {formatDateZurich(cd.date)}
                </div>
                <div className="divide-y divide-border">
                  {times.map((time) => {
                    const { cells, canCombineAB } = slotView(cd.date, cd.dow, time)
                    // Only show placeable (free) or placed (game) halls — a hall taken by
                    // volleyball or closed is omitted, not shown as a dead cell.
                    const visible = cells.filter((c) => c.status === 'free' || c.status === 'game')
                    if (visible.length === 0) return null
                    const hl = highlightFor(teamId, cd.date, time)
                    const hlRing =
                      hl === 'suggest'
                        ? ' ring-2 ring-emerald-500'
                        : hl === 'conflict'
                          ? ' ring-2 ring-amber-500'
                          : ''
                    return (
                      <div key={time} className="flex items-stretch gap-2 px-3 py-2">
                        <span className="flex w-14 shrink-0 items-center text-sm font-medium tabular-nums">
                          {time}
                          {hl === 'suggest' && <span className="ml-1 text-emerald-600" title={t('suggestSameTime')}>★</span>}
                          {hl === 'conflict' && <span className="ml-1 text-amber-600" title={t('conflictTime')}>⚠</span>}
                        </span>
                        <div className="flex flex-1 flex-wrap gap-2">
                          {visible.map((cell) => {
                            const base = 'min-h-[44px] min-w-[9rem] flex-1 rounded-md border px-2 py-1 text-left text-xs'
                            if (cell.status === 'game' && cell.placement) {
                              const p = cell.placement
                              return (
                                <button
                                  key={cell.hall}
                                  type="button"
                                  onClick={() => setModal({ date: cd.date, dow: cd.dow, time, hall: cell.hall, canCombineAB, existing: p })}
                                  className={`${base} border-brand-300 bg-brand-50 text-brand-900 hover:bg-brand-100 dark:border-brand-800 dark:bg-brand-900/40 dark:text-brand-100`}
                                >
                                  <div className="flex items-center justify-between gap-1 font-medium">
                                    <span>{cell.hall}{cell.viaCombined ? ' (A+B)' : ''}</span>
                                    {p.game_type === 'guest' && (
                                      <span className="rounded bg-purple-200 px-1 text-[10px] text-purple-800 dark:bg-purple-900/50 dark:text-purple-200">{t('type_guest')}</span>
                                    )}
                                  </div>
                                  <div className="truncate">{placementLabel(p)}</div>
                                </button>
                              )
                            }
                            return (
                              <button
                                key={cell.hall}
                                type="button"
                                onClick={() => setModal({ date: cd.date, dow: cd.dow, time, hall: cell.hall, canCombineAB, existing: null })}
                                className={`${base} border-dashed border-emerald-300 bg-emerald-50/50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300${hlRing}`}
                              >
                                <div className="font-medium">{cell.hall}</div>
                                <div>＋ {t('putGameHere')}</div>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {modal && (
        <PlaceGameModal
          open
          onClose={() => setModal(null)}
          date={modal.date}
          time={modal.time}
          hall={modal.hall}
          canCombineAB={modal.canCombineAB}
          teams={teams}
          existing={modal.existing}
          defaultTeamId={modal.existing ? undefined : (teamId ? String(teamId) : undefined)}
          nearbyGames={nearby}
          onPlace={(hall, input: PlaceGameInput) => placeGame(modal.date, modal.time, hall, input)}
          onRemove={modal.existing ? () => removeGame(modal.existing!.id) : undefined}
        />
      )}
    </div>
  )
}
