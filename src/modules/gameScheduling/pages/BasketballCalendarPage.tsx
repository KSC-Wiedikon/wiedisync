import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table'
import { formatDateZurich } from '../../../utils/dateHelpers'
import { useGameSchedulingSeason } from '../hooks/useGameSchedulingSeason'
import { useBasketballPlan } from '../hooks/useBasketballPlan'
import { parseYmd } from '../utils/probasketSeason'

export default function BasketballCalendarPage() {
  const { t } = useTranslation('basketballScheduling')
  const { season, allSeasons, setSeason } = useGameSchedulingSeason()
  const { teams, placements } = useBasketballPlan(season)

  const teamName = (id: string | number | null | undefined, label?: string | null) =>
    (id != null ? teams.find((tm) => String(tm.id) === String(id))?.name : label) ?? label ?? ''

  const rows = useMemo(
    () =>
      [...placements.values()].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)),
    [placements],
  )

  const weekday = (ymd: string) => new Intl.DateTimeFormat('de-CH', { weekday: 'short' }).format(parseYmd(ymd))
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
                <TableHead className="w-12">{/* day */}</TableHead>
                <TableHead>{t('season')}</TableHead>
                <TableHead>Zeit</TableHead>
                <TableHead>Halle</TableHead>
                <TableHead>{t('kscwTeam')}</TableHead>
                <TableHead>{t('opponent')}</TableHead>
                <TableHead className="hidden sm:table-cell">{/* type */}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="whitespace-normal font-medium">{weekday(p.date)}</TableCell>
                  <TableCell className="whitespace-normal">{formatDateZurich(p.date)}</TableCell>
                  <TableCell className="tabular-nums">{p.time}</TableCell>
                  <TableCell className="whitespace-normal">{p.hall}</TableCell>
                  <TableCell className="whitespace-normal">{teamName(p.kscw_team, p.kscw_team_label)}</TableCell>
                  <TableCell className="whitespace-normal">{p.opponent ?? ''}</TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${
                        p.game_type === 'guest'
                          ? 'bg-purple-200 text-purple-800 dark:bg-purple-900/50 dark:text-purple-200'
                          : 'bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200'
                      }`}
                    >
                      {p.game_type === 'guest' ? t('type_guest') : t('type_home')}
                    </span>
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
