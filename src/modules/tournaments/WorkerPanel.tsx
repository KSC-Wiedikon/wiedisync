import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import DateTimePicker from '@/components/ui/DateTimePicker'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { formatDateCompact, formatDateTimeCompactZurich, formatTimeZurich } from '../../utils/dateHelpers'
import { ATTENTION, useSaveWorker, useWorker, type WorkerMode } from './tournamentsApi'

const MODES: WorkerMode[] = ['off', 'dry', 'live']
const MODE_KEY: Record<WorkerMode, 'modeOff' | 'modeDry' | 'modeLive'> = { off: 'modeOff', dry: 'modeDry', live: 'modeLive' }
const LENGTHS = [30, 60, 90, 120, 180]

/**
 * Basketball admin: the registration worker's switch (off / test run / live),
 * the opening window for a new batch, and the log (migration 399).
 */
export default function WorkerPanel() {
  const { t } = useTranslation('tournaments')
  const { data } = useWorker(true)
  const save = useSaveWorker()
  const [start, setStart] = useState('')
  const [length, setLength] = useState(60)
  // "Active now" needs a clock; ticking keeps render pure.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  if (!data) return null

  const persist = (patch: Parameters<typeof save.mutate>[0]) =>
    save.mutate(patch, {
      onSuccess: () => toast.success(t('saved')),
      onError: () => toast.error(t('saveError')),
    })

  const windowActive = !!data.rush_from && !!data.rush_until
    && now >= new Date(data.rush_from).getTime() && now < new Date(data.rush_until).getTime()
  const windowSet = !!data.rush_from && !!data.rush_until && new Date(data.rush_until).getTime() > now

  const setWindow = () => {
    if (!start) return
    const from = new Date(start)
    persist({ rush_from: from.toISOString(), rush_until: new Date(from.getTime() + length * 60_000).toISOString() })
  }

  return (
    <section className="space-y-4 rounded-2xl border border-hairline bg-card p-4 shadow-card">
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-foreground">{t('workerTitle')}</h2>
        <p className="max-w-prose text-sm text-muted-foreground">{t('workerHint')}</p>
      </div>

      <div className="space-y-2">
        <div className="grid grid-cols-3 gap-2 sm:max-w-md" role="radiogroup" aria-label={t('workerTitle')}>
          {MODES.map((m) => (
            <Button
              key={m}
              type="button"
              variant="outline"
              role="radio"
              aria-checked={data.mode === m}
              disabled={save.isPending}
              onClick={() => data.mode !== m && persist({ mode: m })}
              className={cn(
                data.mode === m && (m === 'live'
                  ? 'border-green-600 bg-green-600 text-white hover:bg-green-700 hover:text-white dark:border-green-500 dark:bg-green-600'
                  : 'bg-selected text-selected-foreground hover:bg-selected'),
              )}
            >
              {t(MODE_KEY[m])}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {t(`${MODE_KEY[data.mode]}Hint` as 'modeOffHint')}
          {data.updated_by_name && <> · {t('changedBy', { name: data.updated_by_name })}</>}
        </p>
        {data.mode === 'live' && !data.live_allowed && (
          <p className="text-xs text-amber-700 dark:text-amber-400">{t('liveNotHere')}</p>
        )}
      </div>

      <div className="space-y-2 border-t border-hairline pt-4">
        <h3 className="text-sm font-semibold text-foreground">{t('windowTitle')}</h3>
        <p className="max-w-prose text-xs text-muted-foreground">{t('windowHint', { seconds: data.poll_seconds })}</p>
        {windowSet ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <span className="text-sm tabular-nums text-foreground">
              {t('windowCurrent', { from: formatDateTimeCompactZurich(data.rush_from!), until: formatTimeZurich(data.rush_until!) })}
              {windowActive && <span className="ml-2 font-medium text-green-700 dark:text-green-400">{t('windowActive')}</span>}
            </span>
            <Button type="button" variant="outline" size="sm" disabled={save.isPending} onClick={() => persist({ rush_from: null, rush_until: null })}>
              {t('windowClear')}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t('windowNone')}</p>
        )}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <DateTimePicker value={start} onChange={setStart} label={t('windowStart')} className="sm:w-72" />
          <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
            {t('windowLength')}
            <select
              value={length}
              onChange={(e) => setLength(Number(e.target.value))}
              className="h-11 rounded-md border border-input bg-card px-3 text-sm dark:bg-gray-800 sm:h-9"
            >
              {LENGTHS.map((m) => <option key={m} value={m}>{t('minutes', { count: m })}</option>)}
            </select>
          </label>
          <Button type="button" disabled={!start || save.isPending} onClick={setWindow}>{t('windowSet')}</Button>
        </div>
      </div>

      <div className="space-y-2 border-t border-hairline pt-4">
        <h3 className="text-sm font-semibold text-foreground">{t('logTitle')}</h3>
        {data.journal.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('logEmpty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('colTime')}</TableHead>
                  <TableHead>{t('colTournament')}</TableHead>
                  <TableHead>{t('colTeam')}</TableHead>
                  <TableHead>{t('colResult')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.journal.map((j) => (
                  <TableRow key={j.id}>
                    <TableCell className="align-top text-xs tabular-nums whitespace-nowrap">{formatDateTimeCompactZurich(j.attempted_at)}</TableCell>
                    <TableCell className="align-top whitespace-normal">
                      <div className="text-sm">{j.host_club ?? '—'}</div>
                      <div className="text-xs text-muted-foreground tabular-nums">{formatDateCompact(j.tournament_date)}</div>
                    </TableCell>
                    <TableCell className="align-top text-sm">{j.team_name}</TableCell>
                    <TableCell className="align-top whitespace-normal">
                      <div className={cn('text-sm font-medium', ATTENTION.includes(j.result) ? 'text-amber-700 dark:text-amber-400' : j.result === 'registered' ? 'text-green-700 dark:text-green-400' : 'text-foreground')}>
                        {t(`result_${j.result}` as 'result_error')}
                      </div>
                      {j.message && <div className="hidden text-xs text-muted-foreground sm:block">{j.message}</div>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </section>
  )
}
