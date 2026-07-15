import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table'
import { formatDateZurich } from '../../../utils/dateHelpers'
import { useGameSchedulingSeason } from '../hooks/useGameSchedulingSeason'
import { useBasketballPlan } from '../hooks/useBasketballPlan'
import { parseYmd } from '../utils/probasketSeason'

const WEEKDAY_LOCALE: Record<string, string> = { en: 'en-GB', de: 'de-CH', fr: 'fr-CH', it: 'it-CH', gsw: 'de-CH' }

type CalRow =
  | { kind: 'bb'; date: string; time: string; hall: string; label: string; guest: boolean }
  | { kind: 'vb'; date: string; time: string; hall: string }
  | { kind: 'closure'; date: string; end: string; hall: string | null; reason: string }

export default function BasketballCalendarPage() {
  const { t, i18n } = useTranslation('basketballScheduling')
  const { season, allSeasons, setSeason } = useGameSchedulingSeason()
  const { teams, placements, vbGames, closureEntries } = useBasketballPlan(season)

  const teamName = (id: string | number | null | undefined, label?: string | null) =>
    (id != null ? teams.find((tm) => String(tm.id) === String(id))?.name : label) ?? label ?? ''

  const rows = useMemo<CalRow[]>(() => {
    const out: CalRow[] = []
    for (const p of placements.values()) {
      out.push({
        kind: 'bb',
        date: p.date,
        time: p.time,
        hall: p.hall,
        label: `${teamName(p.kscw_team, p.kscw_team_label)} vs ${p.opponent ?? '?'}`,
        guest: p.game_type === 'guest',
      })
    }
    for (const g of vbGames) out.push({ kind: 'vb', date: g.date, time: g.time, hall: g.hall })
    for (const c of closureEntries) out.push({ kind: 'closure', date: c.start, end: c.end, hall: c.hall, reason: c.reason })
    return out.sort((a, b) => (a.date + (('time' in a && a.time) || '')).localeCompare(b.date + (('time' in b && b.time) || '')))
  }, [placements, vbGames, closureEntries, teams])

  const weekday = (ymd: string) =>
    new Intl.DateTimeFormat(WEEKDAY_LOCALE[i18n.language] ?? 'de-CH', { weekday: 'short' }).format(parseYmd(ymd))
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

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('noGames')}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12" />
                <TableHead>{t('season')}</TableHead>
                <TableHead>Zeit</TableHead>
                <TableHead>Halle</TableHead>
                <TableHead>{/* content */}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={i} className={r.kind === 'closure' ? 'opacity-70' : undefined}>
                  <TableCell className="whitespace-normal font-medium">{weekday(r.date)}</TableCell>
                  <TableCell className="whitespace-normal">
                    {formatDateZurich(r.date)}
                    {r.kind === 'closure' && r.end && r.end !== r.date ? `–${formatDateZurich(r.end)}` : ''}
                  </TableCell>
                  <TableCell className="tabular-nums">{r.kind === 'closure' ? '' : r.time}</TableCell>
                  <TableCell className="whitespace-normal">{r.kind === 'closure' ? (r.hall ?? '—') : r.hall}</TableCell>
                  <TableCell className="whitespace-normal">
                    {r.kind === 'bb' ? (
                      <span className="inline-flex items-center gap-2">
                        <span
                          className={`rounded px-2 py-0.5 text-xs ${
                            r.guest
                              ? 'bg-purple-200 text-purple-800 dark:bg-purple-900/50 dark:text-purple-200'
                              : 'bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200'
                          }`}
                        >
                          {r.guest ? t('type_guest') : t('type_home')}
                        </span>
                        {r.label}
                      </span>
                    ) : r.kind === 'vb' ? (
                      <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                        {t('homeGameVb')}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        {t('closedLabel')}{r.reason ? ` — ${r.reason}` : ''}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
