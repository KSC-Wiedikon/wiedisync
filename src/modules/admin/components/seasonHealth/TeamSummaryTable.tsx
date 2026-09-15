// src/modules/admin/components/seasonHealth/TeamSummaryTable.tsx
//
// One row per active team of the sport tab with its season KPIs. Not a
// finding — the "is everything there?" glance before the finding sections.
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import TeamChip from '../../../../components/TeamChip'
import { Badge } from '@/components/ui/badge'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../../../../components/ui/table'
import { bool, isUmbrella, num, type TeamSummaryRow } from '../../utils/seasonHealth'

const RED = 'font-medium text-red-600 dark:text-red-400'
const GREEN = 'text-green-600 dark:text-green-400'
const AMBER = 'text-amber-600 dark:text-amber-400'

function CountCheck({ n, danger }: { n: number; danger: boolean }) {
  return n > 0
    ? <span className={GREEN}><span aria-hidden="true">✓</span> {n}</span>
    : <span className={danger ? RED : 'text-muted-foreground'} aria-label={String(n)}>✗</span>
}

function Ratio({ a, b }: { a: number; b: number }) {
  const cls = b === 0 ? 'text-muted-foreground' : a >= b ? GREEN : a === 0 ? RED : AMBER
  return <span className={cls}>{a}/{b}</span>
}

export default function TeamSummaryTable({ teams }: { teams: TeamSummaryRow[] }) {
  const { t } = useTranslation('seasonHealth')
  // Umbrellas last; server order (deterministic) otherwise.
  const rows = useMemo(
    () => [...teams.filter((r) => !isUmbrella(r)), ...teams.filter(isUmbrella)],
    [teams])

  const th = 'py-2 pr-3 font-medium'
  const thc = `${th} text-center`
  const td = 'py-2.5 pr-3'
  const tdc = `${td} text-center tabular-nums`

  return (
    <section className="rounded-xl border border-border bg-card" aria-labelledby="sh-teams-title">
      <h2 id="sh-teams-title" className="px-4 pt-3 text-sm font-semibold text-foreground">
        {t('teamsTitle')} <span className="font-normal text-muted-foreground">({rows.length})</span>
      </h2>
      {rows.length === 0 ? (
        <p className="px-4 pb-4 pt-2 text-sm text-muted-foreground">{t('teamsEmpty')}</p>
      ) : (
        <div className="px-4 pb-2">
          <Table className="text-sm">
            <TableHeader>
              <TableRow className="border-b border-border text-left text-muted-foreground hover:bg-transparent">
                <TableHead className={th}>{t('col_team')}</TableHead>
                <TableHead className={`${th} hidden sm:table-cell`}>{t('col_league')}</TableHead>
                <TableHead className={thc}>{t('col_players')}</TableHead>
                <TableHead className={thc}>{t('col_coach')}</TableHead>
                <TableHead className={thc} title={t('col_team_responsible')}>TR</TableHead>
                <TableHead className={thc}>{t('col_captain')}</TableHead>
                <TableHead className={thc}>{t('col_licence_ok')}</TableHead>
                <TableHead className={thc}>{t('col_dues_paid')}</TableHead>
                <TableHead className={thc}>{t('col_games')}</TableHead>
                <TableHead className={`${thc} hidden sm:table-cell`} title={t('kpi_trainingsSub')}>{t('col_trainings')}</TableHead>
                <TableHead className={thc}>{t('col_slots')}</TableHead>
                <TableHead className={`${thc} hidden sm:table-cell`}>{t('col_officials')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const umbrella = isUmbrella(r)
                const players = num(r.players)
                const guests = num(r.guests)
                const coaches = num(r.coaches)
                const slots = num(r.hall_slots)
                return (
                  <TableRow key={r.team_id} className="h-11 border-b border-border/50 hover:bg-muted/30">
                    <TableCell className={td}>
                      <span className="inline-flex flex-wrap items-center gap-1.5">
                        <Link to={`/teams/${r.team}`} className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          <TeamChip team={r.team} size="sm" />
                        </Link>
                        {umbrella && <Badge variant="neutral" size="sm">{t('umbrella')}</Badge>}
                      </span>
                    </TableCell>
                    <TableCell className={`${td} hidden text-muted-foreground sm:table-cell`}>{r.league ?? '—'}</TableCell>
                    <TableCell className={tdc}>
                      {players}
                      {guests > 0 && <span className="text-muted-foreground"> +{guests}</span>}
                    </TableCell>
                    <TableCell className={tdc}><CountCheck n={coaches} danger={!umbrella} /></TableCell>
                    <TableCell className={tdc}><CountCheck n={num(r.team_responsibles)} danger={false} /></TableCell>
                    <TableCell className={tdc}>
                      {bool(r.has_captain)
                        ? <span className={GREEN} aria-label={t('yes')}>✓</span>
                        : <span className={umbrella ? 'text-muted-foreground' : AMBER} aria-label={t('no')}>✗</span>}
                    </TableCell>
                    <TableCell className={tdc}><Ratio a={num(r.licence_ok)} b={players} /></TableCell>
                    <TableCell className={tdc}><Ratio a={num(r.dues_paid)} b={players} /></TableCell>
                    <TableCell className={tdc}>{num(r.games_total)}</TableCell>
                    <TableCell className={`${tdc} hidden sm:table-cell`}>{num(r.trainings_next_4w)}</TableCell>
                    <TableCell className={tdc}>
                      <span className={slots === 0 && !umbrella ? RED : ''}>{slots}</span>
                    </TableCell>
                    <TableCell className={`${tdc} hidden sm:table-cell`}>{num(r.licensed_officials)}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  )
}
