import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Gavel } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useAdminMode } from '../../hooks/useAdminMode'
import { useCollection } from '../../lib/query'
import { useRealtime } from '../../hooks/useRealtime'
import { useFines, formatFineAmount } from '../../hooks/useFines'
import { updateRecord } from '../../lib/api'
import { formatDateCompactZurich } from '../../utils/dateHelpers'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import EmptyState from '../../components/EmptyState'
import TabBar from '../../components/TabBar'
import { useReportPageLoading } from '../../hooks/usePageReady'
import WaiveFineModal from './WaiveFineModal'
import IssueFineModal from './IssueFineModal'
import IssueFinePickerModal, { type FinePickSelection } from './IssueFinePickerModal'
import type { Fine, FineStatus, Member, Team } from '../../types'

type Scope = 'mine' | 'team'

const STATUSES: Array<{ key: FineStatus | 'all'; tKey: string }> = [
  { key: 'all', tKey: 'filterAll' },
  { key: 'open', tKey: 'statusOpen' },
  { key: 'paid', tKey: 'statusPaid' },
  { key: 'waived', tKey: 'statusWaived' },
]

function StatusBadge({ status }: { status: FineStatus }) {
  const cls =
    status === 'open' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
    : status === 'paid' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300'
    : 'bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
  const { t } = useTranslation('fines')
  const label =
    status === 'open' ? t('statusOpen')
    : status === 'paid' ? t('statusPaid')
    : t('statusWaived')
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>
}

function categoryLabelKey(c: string): string {
  return `category${c.charAt(0).toUpperCase()}${c.slice(1).replace(/_(.)/g, (_, ch) => ch.toUpperCase())}`
}

export default function FinesPage() {
  const { t } = useTranslation(['fines', 'common'])
  const { user, isCoach, coachTeamIds } = useAuth()
  const { effectiveIsAdmin, effectiveIsVorstand } = useAdminMode()
  const isLeader = isCoach || effectiveIsAdmin || effectiveIsVorstand

  const [scope, setScope] = useState<Scope>(isLeader ? 'team' : 'mine')
  const [statusFilter, setStatusFilter] = useState<FineStatus | 'all'>('open')
  const [teamFilter, setTeamFilter] = useState<string | 'all'>('all')

  const [waiving, setWaiving] = useState<Fine | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [issuing, setIssuing] = useState<FinePickSelection | null>(null)

  // Fine query — leaders see their teams (server-side scoped), members see own.
  // `userId` is read out of `user` before the memo so the compiler-inferred
  // dependency matches the declared one (a `user?.id` dep infers as `user`).
  const userId = user?.id
  const finesFilter = useMemo<Record<string, unknown> | undefined>(() => {
    const filters: Record<string, unknown>[] = []
    if (scope === 'mine' || !isLeader) {
      if (!userId) return { id: { _eq: -1 } }
      filters.push({ member: { _eq: userId } })
    }
    if (statusFilter !== 'all') filters.push({ status: { _eq: statusFilter } })
    if (scope === 'team' && teamFilter !== 'all') filters.push({ team: { _eq: teamFilter } })
    if (filters.length === 0) return undefined
    if (filters.length === 1) return filters[0]
    return { _and: filters }
  }, [scope, isLeader, userId, statusFilter, teamFilter])

  const { data: finesRaw, refetch, isLoading } = useFines({ filter: finesFilter })
  const fines = finesRaw ?? []

  useRealtime('fines', () => refetch())

  // Resolve member + team names. Members can only see own fines so the
  // visible set is tiny; leaders may see hundreds — keep this lean by fetching
  // only the IDs the table needs.
  const memberIds = [...new Set(fines.map((f) => String(f.member)))]
  const teamIds = [...new Set(fines.map((f) => String(f.team)))]
  const { data: membersRaw, isLoading: membersLoading } = useCollection<Member>('members', {
    filter: memberIds.length ? { id: { _in: memberIds } } : undefined,
    fields: ['id', 'first_name', 'last_name', 'nickname'],
    enabled: memberIds.length > 0,
    all: true,
  })
  const { data: teamsRaw, isLoading: teamsLoading } = useCollection<Team>('teams', {
    filter: teamIds.length ? { id: { _in: teamIds } } : undefined,
    fields: ['id', 'name'],
    enabled: teamIds.length > 0,
    all: true,
  })

  // Wait for ALL primary data before rendering the table: fines, plus the
  // chained members + teams lookups that feed the table cells + leader team
  // picker. Disabled (enabled:false) queries report isLoading=false, so OR-ing
  // is safe — they never hang the gate.
  const pageLoading = isLoading || membersLoading || teamsLoading

  // Report to app boot gate — see usePageReady.tsx
  useReportPageLoading(pageLoading)

  const memberMap = useMemo(() => new Map((membersRaw ?? []).map((m) => [String(m.id), m])), [membersRaw])
  const teamMap = useMemo(() => new Map((teamsRaw ?? []).map((tm) => [String(tm.id), tm])), [teamsRaw])

  // Leader-only team picker
  const leaderTeams = (teamsRaw ?? []).filter((tm) => coachTeamIds.includes(String(tm.id)))
  const canManageTeam = (teamId: string | number): boolean => {
    if (effectiveIsAdmin || effectiveIsVorstand) return true
    return coachTeamIds.includes(String(teamId))
  }

  // Teams the leader may ISSUE a fine for: their coached/TR teams, or every
  // active team for admins/Vorstand. Separate from `leaderTeams` above, which
  // only lists teams that already have fines (so it can't seed a new fine).
  const issueTeamsFilter = useMemo<Record<string, unknown>>(
    () =>
      effectiveIsAdmin || effectiveIsVorstand
        ? { active: { _eq: true } }
        : coachTeamIds.length ? { id: { _in: coachTeamIds } } : { id: { _eq: -1 } },
    [effectiveIsAdmin, effectiveIsVorstand, coachTeamIds],
  )
  const { data: issueTeamsRaw } = useCollection<Team>('teams', {
    filter: issueTeamsFilter,
    fields: ['id', 'name'],
    enabled: isLeader,
    all: true,
  })
  const issueTeams = useMemo(
    () => [...(issueTeamsRaw ?? [])].sort((a, b) => String(a.name).localeCompare(String(b.name))),
    [issueTeamsRaw],
  )

  // Totals strip (for the active filter)
  const total = fines.reduce((acc, f) => acc + (Number(f.amount) || 0), 0)
  const openOnly = fines.filter((f) => f.status === 'open')
  const openTotal = openOnly.reduce((acc, f) => acc + (Number(f.amount) || 0), 0)

  async function handleMarkPaid(fine: Fine) {
    try {
      await updateRecord<Fine>('fines', fine.id, {
        status: 'paid',
        paid_at: new Date().toISOString(),
      })
      refetch()
    } catch (err) {
      console.error('mark-paid failed', err)
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-gray-100">
            <Gavel className="h-6 w-6 text-amber-600 dark:text-amber-500" />
            {t('fines:title')}
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t('fines:subtitle')}</p>
        </div>
        {isLeader && (
          <Button size="sm" onClick={() => setPickerOpen(true)} className="gap-1.5">
            <Gavel className="h-4 w-4" />
            {t('fines:issueFine')}
          </Button>
        )}
      </div>

      {/* Member outstanding strip */}
      {scope === 'mine' && openOnly.length > 0 && (
        <div data-tour="fines-outstanding" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm dark:border-amber-900/40 dark:bg-amber-900/20">
          <div className="font-medium text-amber-900 dark:text-amber-200">
            {t('fines:outstanding', { amount: formatFineAmount(openTotal) })}
          </div>
          <div className="text-xs text-amber-700 dark:text-amber-300">
            {t('fines:outstandingCount', { count: openOnly.length })}
          </div>
        </div>
      )}

      {/* Scope toggle (only for leaders) */}
      {isLeader && (
        <TabBar<Scope>
          tabs={[{ key: 'team', label: t('fines:filterTeam') }, { key: 'mine', label: t('fines:filterMine') }]}
          active={scope}
          onChange={setScope}
        />
      )}

      {/* Status + team filters */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          data-tour="fines-filter"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as FineStatus | 'all')}
          className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
        >
          {STATUSES.map((s) => (
            <option key={s.key} value={s.key}>{t(`fines:${s.tKey}`)}</option>
          ))}
        </select>

        {scope === 'team' && leaderTeams.length > 0 && (
          <select
            value={teamFilter}
            onChange={(e) => setTeamFilter(e.target.value)}
            className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          >
            <option value="all">{t('fines:filterAll')}</option>
            {leaderTeams.map((tm) => (
              <option key={tm.id} value={String(tm.id)}>{tm.name as string}</option>
            ))}
          </select>
        )}

        <div className="ml-auto text-xs text-gray-500 dark:text-gray-400">
          {fines.length > 0 ? `${fines.length} · ${formatFineAmount(total)}` : null}
        </div>
      </div>

      {/* Loading spinner, then table or empty state */}
      <div data-tour="fines-list">
      {pageLoading ? null : fines.length === 0 ? (
        <EmptyState
          icon={<Gavel className="h-10 w-10" />}
          title={scope === 'mine' ? t('fines:emptyMember') : t('fines:empty')}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              {scope === 'team' && <TableHead>{t('fines:colMember')}</TableHead>}
              <TableHead className="hidden sm:table-cell">{t('fines:colTeam')}</TableHead>
              <TableHead>{t('fines:colCategory')}</TableHead>
              <TableHead className="text-right">{t('fines:colAmount')}</TableHead>
              <TableHead>{t('fines:colStatus')}</TableHead>
              <TableHead className="hidden md:table-cell">{t('fines:colIssued')}</TableHead>
              <TableHead className="hidden lg:table-cell">{t('fines:colReason')}</TableHead>
              {isLeader && <TableHead>{t('fines:colActions')}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {fines.map((f) => {
              const m = memberMap.get(String(f.member))
              const tm = teamMap.get(String(f.team))
              const memberName = m ? `${m.last_name ?? ''} ${m.nickname || m.first_name || ''}`.trim() : `#${f.member}`
              const teamName = (tm?.name as string) ?? `Team ${f.team}`
              return (
                <TableRow key={f.id} className="min-h-[44px]">
                  {scope === 'team' && <TableCell className="font-medium">{memberName}</TableCell>}
                  <TableCell className="hidden sm:table-cell text-xs text-gray-600 dark:text-gray-400">{teamName}</TableCell>
                  <TableCell className="text-sm">{t(`fines:${categoryLabelKey(f.category)}`)}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatFineAmount(f.amount, f.currency)}</TableCell>
                  <TableCell><StatusBadge status={f.status} /></TableCell>
                  <TableCell className="hidden md:table-cell text-xs text-gray-500 dark:text-gray-400">
                    {formatDateCompactZurich(f.issued_at)}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-xs text-gray-600 dark:text-gray-400 max-w-xs truncate" title={f.reason ?? undefined}>
                    {f.reason ?? '—'}
                  </TableCell>
                  {isLeader && (
                    <TableCell>
                      {canManageTeam(f.team) && f.status === 'open' && (
                        <div className="flex flex-col gap-1 sm:flex-row">
                          <Button size="sm" variant="outline" onClick={() => handleMarkPaid(f)}>
                            {t('fines:markPaid')}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setWaiving(f)}>
                            {t('fines:waive')}
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
      </div>

      {waiving && (
        <WaiveFineModal
          open={!!waiving}
          onClose={() => setWaiving(null)}
          fine={waiving}
          onSuccess={() => refetch()}
        />
      )}

      {isLeader && pickerOpen && (
        <IssueFinePickerModal
          open
          onClose={() => setPickerOpen(false)}
          teams={issueTeams}
          onPicked={(sel) => { setPickerOpen(false); setIssuing(sel) }}
        />
      )}
      {issuing && (
        <IssueFineModal
          open
          onClose={() => setIssuing(null)}
          memberId={issuing.memberId}
          memberName={issuing.memberName}
          teamId={issuing.teamId}
          teamName={issuing.teamName}
          category="custom"
          onSuccess={() => { setIssuing(null); refetch() }}
        />
      )}
    </div>
  )
}
