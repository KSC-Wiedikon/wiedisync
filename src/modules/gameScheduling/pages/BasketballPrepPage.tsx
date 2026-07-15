import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table'
import { formatDateZurich } from '../../../utils/dateHelpers'
import { useGameSchedulingSeason } from '../hooks/useGameSchedulingSeason'
import { useBasketballAvailability, type HallCellStatus } from '../hooks/useBasketballAvailability'
import { parseYmd } from '../utils/probasketSeason'
import type { BasketballHallAvailability, HallAvailabilityWindow } from '../../../types'

/** de-CH short weekday ("Fr.", "Sa.", "So.") — Swiss format regardless of UI language. */
function weekdayLabel(ymd: string): string {
  return new Intl.DateTimeFormat('de-CH', { weekday: 'short' }).format(parseYmd(ymd))
}

const STATUS_STYLE: Record<HallCellStatus, string> = {
  free: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  vb_using: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  closed: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300',
  club_block: 'bg-red-200 text-red-900 dark:bg-red-900/50 dark:text-red-200',
  training_only: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
  blackout: 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
}
const STATUS_KEY: Record<HallCellStatus, string> = {
  free: 'statusFree',
  vb_using: 'statusVbUsing',
  closed: 'statusClosed',
  club_block: 'statusClubBlock',
  training_only: 'statusTrainingOnly',
  blackout: 'statusBlackout',
}

function getWindow(avail: BasketballHallAvailability | undefined, hall: string): HallAvailabilityWindow | undefined {
  return avail?.windows?.find((w) => w.hall === hall)
}
function upsertWindow(windows: HallAvailabilityWindow[], hall: string, patch: Partial<HallAvailabilityWindow>): HallAvailabilityWindow[] {
  const others = windows.filter((w) => w.hall !== hall)
  const cur = windows.find((w) => w.hall === hall) ?? { hall, from: '', to: '' }
  const next = { ...cur, ...patch }
  if (!next.from && !next.to) return others // drop an emptied window
  return [...others, next]
}

export default function BasketballPrepPage() {
  const { t } = useTranslation('basketballScheduling')
  const { season, allSeasons, isLoading: seasonLoading, setSeason } = useGameSchedulingSeason()
  const {
    config, teams, kwiHalls, candidateDates, overlayByDate, availability, availKey,
    isLoading, error, saveAvailability,
  } = useBasketballAvailability(season)

  // Derived selection: the user's choice if still valid, else the first team. No
  // effect → avoids a synchronous setState-in-effect (react-hooks/set-state-in-effect).
  const [picked, setPicked] = useState<string | number | null>(null)
  const teamId =
    picked != null && teams.some((tm) => String(tm.id) === String(picked))
      ? picked
      : teams[0]?.id ?? ''

  const selectClass =
    'rounded-md border border-border bg-transparent px-3 py-2 text-sm dark:bg-gray-800'

  async function save(date: string, patch: Parameters<typeof saveAvailability>[2]) {
    try {
      await saveAvailability(teamId, date, patch)
    } catch {
      toast.error(t('saveError'))
    }
  }

  const legend = useMemo<HallCellStatus[]>(
    () => ['free', 'vb_using', 'training_only', 'closed', 'club_block', 'blackout'],
    [],
  )

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">{t('prepTitle')}</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      {/* Season + team pickers */}
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
          <span className="font-medium text-muted-foreground">{t('team')}</span>
          <select className={selectClass} value={String(teamId)} onChange={(e) => setPicked(e.target.value)}>
            {teams.length === 0 && <option value="">—</option>}
            {teams.map((tm) => (
              <option key={tm.id} value={tm.id}>{tm.name}</option>
            ))}
          </select>
        </label>
        {config && (
          <p className="text-xs text-muted-foreground">
            {t('vorrunde', {
              start: formatDateZurich(config.vorrundeStart),
              end: formatDateZurich(config.vorrundeEnd),
            })}
          </p>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">{t('legend')}:</span>
        {legend.map((s) => (
          <span key={s} className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[s]}`}>
            {t(STATUS_KEY[s])}
          </span>
        ))}
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
      ) : teams.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('teamsEmpty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">{t('colDay')}</TableHead>
                <TableHead className="w-28">{t('colDate')}</TableHead>
                <TableHead className="w-40">{t('available')}</TableHead>
                {kwiHalls.map((h) => (
                  <TableHead key={h}>{h}</TableHead>
                ))}
                <TableHead className="hidden sm:table-cell">{t('colNote')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {candidateDates.map((cd) => {
                const overlay = overlayByDate.get(cd.date)
                const avail = availability.get(availKey(teamId, cd.date))
                const isUnavailable = avail?.unavailable === true
                return (
                  <TableRow key={cd.date} className={isUnavailable ? 'opacity-60' : undefined}>
                    <TableCell className="whitespace-normal font-medium">{weekdayLabel(cd.date)}</TableCell>
                    <TableCell className="whitespace-normal">{formatDateZurich(cd.date)}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => save(cd.date, { unavailable: false })}
                          className={`rounded px-2 py-1 text-xs ${
                            !isUnavailable
                              ? 'bg-emerald-600 text-white'
                              : 'bg-muted text-muted-foreground hover:bg-muted/70'
                          }`}
                        >
                          {t('available')}
                        </button>
                        <button
                          type="button"
                          onClick={() => save(cd.date, { unavailable: true, windows: [] })}
                          className={`rounded px-2 py-1 text-xs ${
                            isUnavailable
                              ? 'bg-rose-600 text-white'
                              : 'bg-muted text-muted-foreground hover:bg-muted/70'
                          }`}
                        >
                          {t('unavailable')}
                        </button>
                      </div>
                    </TableCell>
                    {kwiHalls.map((h) => {
                      const status = overlay?.perHall[h] ?? 'free'
                      const win = getWindow(avail, h)
                      const editable = !isUnavailable
                      return (
                        <TableCell key={h} className="whitespace-normal align-top">
                          <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] ${STATUS_STYLE[status]}`}>
                            {t(STATUS_KEY[status])}
                          </span>
                          {editable && (
                            <div className="mt-1 flex items-center gap-1">
                              <input
                                type="time"
                                aria-label={`${h} ${t('from')}`}
                                className="w-24 rounded border border-border bg-transparent px-1 py-0.5 text-xs dark:bg-gray-800"
                                value={win?.from ?? ''}
                                onChange={(e) =>
                                  save(cd.date, {
                                    unavailable: false,
                                    windows: upsertWindow(avail?.windows ?? [], h, { from: e.target.value }),
                                  })
                                }
                              />
                              <span className="text-xs text-muted-foreground">–</span>
                              <input
                                type="time"
                                aria-label={`${h} ${t('to')}`}
                                className="w-24 rounded border border-border bg-transparent px-1 py-0.5 text-xs dark:bg-gray-800"
                                value={win?.to ?? ''}
                                onChange={(e) =>
                                  save(cd.date, {
                                    unavailable: false,
                                    windows: upsertWindow(avail?.windows ?? [], h, { to: e.target.value }),
                                  })
                                }
                              />
                            </div>
                          )}
                        </TableCell>
                      )
                    })}
                    <TableCell className="hidden sm:table-cell">
                      <input
                        type="text"
                        defaultValue={avail?.note ?? ''}
                        placeholder={t('notePlaceholder')}
                        className="w-full rounded border border-border bg-transparent px-2 py-1 text-xs dark:bg-gray-800"
                        onBlur={(e) => {
                          if ((e.target.value ?? '') !== (avail?.note ?? '')) {
                            void save(cd.date, { note: e.target.value })
                          }
                        }}
                      />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
