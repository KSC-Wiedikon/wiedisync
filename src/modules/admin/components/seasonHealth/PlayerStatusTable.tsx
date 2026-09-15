// src/modules/admin/components/seasonHealth/PlayerStatusTable.tsx
//
// Every core roster player of the sport tab with licence / dues / login
// state, filterable. Not a finding — the roster as the registers see it.
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Download } from 'lucide-react'
import TeamChip from '../../../../components/TeamChip'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../../../../components/ui/table'
import { toXlsx, downloadBlob } from '../../utils/exportResults'
import {
  EMPTY_PLAYER_FILTERS, LICENCE_STATES, bool, filterPlayers, humanize, licenceTone, loginState,
  type DuesFilter, type LoginFilter, type PlayerFilters, type PlayerStatusRow, type Sport,
  type TeamSummaryRow,
} from '../../utils/seasonHealth'

const SELECT = 'h-11 rounded-md border border-input bg-background px-2 text-sm text-foreground sm:h-9 dark:bg-gray-800'

const EXPORT_KEYS = [
  'member_id', 'last_name', 'first_name', 'team', 'licence_state', 'license_nr',
  'licence_status', 'dues_paid', 'has_login', 'shell', 'register_status',
] as const

export default function PlayerStatusTable({ players, teams, sport }: {
  players: PlayerStatusRow[]
  teams: TeamSummaryRow[]
  sport: Sport
}) {
  const { t, i18n } = useTranslation('seasonHealth')
  const [filters, setFilters] = useState<PlayerFilters>(EMPTY_PLAYER_FILTERS)
  const [exporting, setExporting] = useState(false)

  const set = <K extends keyof PlayerFilters>(k: K, v: PlayerFilters[K]) =>
    setFilters((f) => ({ ...f, [k]: v }))

  const teamOptions = useMemo(() => {
    const names = new Set<string>(teams.map((r) => r.team))
    for (const p of players) if (p.team) names.add(p.team)
    return [...names].sort((a, b) => a.localeCompare(b, 'de-CH'))
  }, [players, teams])

  const licenceOptions = useMemo(() => {
    const states = new Set<string>(LICENCE_STATES)
    for (const p of players) if (typeof p.licence_state === 'string' && p.licence_state) states.add(p.licence_state)
    return [...states]
  }, [players])

  const filtered = useMemo(() => filterPlayers(players, filters), [players, filters])

  const licenceLabel = (state: string) => t(`licence_${state}`, { defaultValue: humanize(state) })

  // English headers + raw values — exports are always English.
  async function handleExport() {
    setExporting(true)
    try {
      const tEn = i18n.getFixedT('en', 'seasonHealth')
      const columns = EXPORT_KEYS.map((k) => tEn(`col_${k}`, { defaultValue: humanize(k) }))
      const rows = filtered.map((p) => EXPORT_KEYS.map((k) => {
        const v = p[k]
        if (k === 'dues_paid' || k === 'has_login' || k === 'shell') return bool(v)
        return v ?? null
      }))
      const blob = await toXlsx(columns, rows)
      downloadBlob(blob, `season-health_players_${sport}_${new Date().toISOString().slice(0, 10)}.xlsx`)
    } catch {
      toast.error(t('exportFailed'))
    } finally {
      setExporting(false)
    }
  }

  const th = 'py-2 pr-3 font-medium'
  const td = 'py-2.5 pr-3'

  return (
    <section className="rounded-xl border border-border bg-card" aria-labelledby="sh-players-title">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3">
        <h2 id="sh-players-title" className="text-sm font-semibold text-foreground">
          {t('playersTitle')} <span className="font-normal text-muted-foreground">({players.length})</span>
        </h2>
        <Button
          type="button" variant="outline" size="sm" className="min-h-11 gap-1.5 sm:min-h-0"
          onClick={handleExport} disabled={exporting || filtered.length === 0} aria-busy={exporting}
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          {t('export')}
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 px-4 pb-2 pt-3">
        <select
          value={filters.team} onChange={(e) => set('team', e.target.value)}
          aria-label={t('filter_team')} className={SELECT}
        >
          <option value="all">{t('filter_team')}: {t('filter_all')}</option>
          {teamOptions.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <select
          value={filters.licence} onChange={(e) => set('licence', e.target.value)}
          aria-label={t('filter_licence')} className={SELECT}
        >
          <option value="all">{t('filter_licence')}: {t('filter_all')}</option>
          {licenceOptions.map((s) => <option key={s} value={s}>{licenceLabel(s)}</option>)}
        </select>
        <select
          value={filters.dues} onChange={(e) => set('dues', e.target.value as DuesFilter)}
          aria-label={t('filter_dues')} className={SELECT}
        >
          <option value="all">{t('filter_dues')}: {t('filter_all')}</option>
          <option value="paid">{t('dues_paid')}</option>
          <option value="unpaid">{t('dues_unpaid')}</option>
        </select>
        <select
          value={filters.login} onChange={(e) => set('login', e.target.value as LoginFilter)}
          aria-label={t('filter_login')} className={SELECT}
        >
          <option value="all">{t('filter_login')}: {t('filter_all')}</option>
          <option value="login">{t('login_login')}</option>
          <option value="shell">{t('login_shell')}</option>
          <option value="none">{t('login_none')}</option>
        </select>
        <Input
          type="search" value={filters.search} onChange={(e) => set('search', e.target.value)}
          placeholder={t('filter_search')} aria-label={t('filter_search')}
          className="h-11 w-full sm:h-9 sm:w-56"
        />
      </div>

      <p className="px-4 pb-2 text-xs text-muted-foreground" aria-live="polite">
        {t('shownOf', { shown: filtered.length, total: players.length })}
      </p>

      {players.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted-foreground">{t('playersEmpty')}</p>
      ) : (
        <div className="px-4 pb-2">
          <Table className="text-sm">
            <TableHeader>
              <TableRow className="border-b border-border text-left text-muted-foreground hover:bg-transparent">
                <TableHead className={th}>{t('col_name')}</TableHead>
                <TableHead className={th}>{t('col_team')}</TableHead>
                <TableHead className={th}>{t('col_licence_state')}</TableHead>
                <TableHead className={`${th} hidden sm:table-cell`}>{t('col_licence_status')}</TableHead>
                <TableHead className={`${th} text-center`}>{t('col_dues_paid')}</TableHead>
                <TableHead className={`${th} text-center`}>{t('col_has_login')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((p) => {
                const state = typeof p.licence_state === 'string' && p.licence_state ? p.licence_state : 'none'
                const login = loginState(p)
                const paid = bool(p.dues_paid)
                return (
                  <TableRow key={`${p.member_id}-${p.team}`} className="h-11 border-b border-border/50 hover:bg-muted/30">
                    <TableCell className={`${td} leading-tight`}>
                      <Link to={`/teams/player/${p.member_id}`} className="font-medium text-foreground hover:underline">
                        <span className="block sm:inline">{p.last_name}</span>
                        <span className="block text-muted-foreground sm:ml-1 sm:inline sm:text-foreground">{p.first_name}</span>
                      </Link>
                    </TableCell>
                    <TableCell className={td}>
                      {p.team ? <TeamChip team={p.team} size="sm" /> : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className={td}>
                      <Badge variant={licenceTone(state)} size="sm" title={p.license_nr ?? undefined}>
                        {licenceLabel(state)}
                      </Badge>
                    </TableCell>
                    <TableCell className={`${td} hidden text-muted-foreground sm:table-cell`}>
                      {p.licence_status ? humanize(String(p.licence_status)) : '—'}
                    </TableCell>
                    <TableCell className={`${td} text-center`}>
                      {paid
                        ? <span className="text-green-600 dark:text-green-400" aria-label={t('dues_paid')}>✓</span>
                        : <span className="font-medium text-red-600 dark:text-red-400" aria-label={t('dues_unpaid')}>✗</span>}
                    </TableCell>
                    <TableCell className={`${td} text-center`}>
                      {login === 'login'
                        ? <span className="text-green-600 dark:text-green-400" aria-label={t('login_login')}>✓</span>
                        : login === 'shell'
                          ? <Badge variant="neutral" size="sm">{t('login_shell')}</Badge>
                          : <span className="text-muted-foreground" aria-label={t('login_none')}>✗</span>}
                    </TableCell>
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
