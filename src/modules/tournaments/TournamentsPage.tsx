import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Check, CircleCheck, Lock, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { Switch } from '@/components/ui/switch'
import { formatDate, formatDateCompact } from '../../utils/dateHelpers'
import WorkerPanel from './WorkerPanel'
import { ATTENTION, useSetPick, useTournaments, type Tournament, type TournamentTeam, type TournamentTeamState } from './tournamentsApi'

/**
 * /tournaments — basketball youth tournaments (migration 398). One row per
 * tournament, one column per team the caller picks for: a coach sees their
 * team(s), the basketball admin every youth team and what is left to register
 * on Basketplan. "Registered" always comes from Basketplan, never from a pick.
 */
export default function TournamentsPage() {
  const { t } = useTranslation('tournaments')
  const { data, isLoading, isError } = useTournaments()
  const setPick = useSetPick()
  const [onlyToRegister, setOnlyToRegister] = useState(false)

  const toRegister = (tt: TournamentTeamState) => tt.status === 'picked'
  const openCount = useMemo(
    () => (data?.tournaments ?? []).reduce((n, tr) => n + tr.teams.filter(toRegister).length, 0),
    [data],
  )
  const rows = useMemo(
    () => (data?.tournaments ?? []).filter((tr) => !onlyToRegister || tr.teams.some(toRegister)),
    [data, onlyToRegister],
  )

  const toggle = (tr: Tournament, team: TournamentTeam, state: TournamentTeamState) => {
    setPick.mutate(
      { tournament: tr.id, team: team.id, picked: !state.picked },
      { onError: () => toast.error(t('saveError')) },
    )
  }

  const teams = data?.teams ?? []

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-4 sm:px-0">
      <div className="space-y-1">
        <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">{t('title')}</h1>
        {teams.length > 0 && (
          <p className="max-w-prose text-sm text-muted-foreground">{t(data?.admin ? 'introAdmin' : 'intro')}</p>
        )}
      </div>

      {isError && <Empty>{t('loadError')}</Empty>}
      {!isLoading && !isError && teams.length === 0 && <Empty>{t('noAccess')}</Empty>}

      {teams.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {teams.map((team) => {
              const states = (data?.tournaments ?? []).flatMap((tr) => tr.teams.filter((x) => x.team === team.id))
              return (
                <span key={team.id} className="text-sm text-foreground">
                  <span className="font-semibold">{team.name}</span>{' '}
                  <span className="text-muted-foreground">
                    {t('summary', {
                      picked: states.filter((s) => s.picked || s.status === 'registered').length,
                      registered: states.filter((s) => s.status === 'registered').length,
                    })}
                  </span>
                </span>
              )
            })}
          </div>

          {data?.admin && (
            <div className="flex flex-col gap-1 rounded-2xl border border-hairline bg-card px-4 py-3 shadow-card sm:flex-row sm:items-center sm:justify-between">
              <span className={cn('text-sm font-medium', openCount > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground')}>
                {t('toRegister', { count: openCount })}
              </span>
              <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-foreground">
                <Switch checked={onlyToRegister} onCheckedChange={setOnlyToRegister} />
                {t('onlyToRegister')}
              </label>
            </div>
          )}

          {data?.admin && <WorkerPanel />}

          {rows.length === 0 && !isLoading && <Empty>{t('empty')}</Empty>}

          {rows.length > 0 && (
            <div className="overflow-x-auto rounded-2xl border border-hairline bg-card shadow-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20 sm:w-28">{t('colDate')}</TableHead>
                    <TableHead>{t('colTournament')}</TableHead>
                    <TableHead className="hidden sm:table-cell">{t('colDeadline')}</TableHead>
                    {teams.map((team) => (
                      <TableHead key={team.id} className="w-16 text-center sm:w-24">{team.name}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((tr) => (
                    <TableRow key={tr.id}>
                      <TableCell className="align-top tabular-nums">
                        <span className="hidden sm:inline">{formatDate(tr.date)}</span>
                        <span className="sm:hidden">{formatDateCompact(tr.date)}</span>
                        {tr.time_from && <div className="text-xs text-muted-foreground">{tr.time_from}{tr.time_to ? `–${tr.time_to}` : ''}</div>}
                      </TableCell>
                      <TableCell className="min-w-0 align-top whitespace-normal">
                        <div className="font-medium text-foreground">{tr.host_club ?? '—'}</div>
                        <div className="text-xs text-muted-foreground">
                          {[tr.hall, tr.registered_count != null ? t('teamsCount', { count: tr.registered_count }) : null].filter(Boolean).join(' · ')}
                        </div>
                        {tr.deadline && (
                          <div className="text-xs text-muted-foreground sm:hidden">{t('colDeadline')} {formatDateCompact(tr.deadline)}</div>
                        )}
                      </TableCell>
                      <TableCell className="hidden align-top tabular-nums sm:table-cell">
                        {tr.deadline ? formatDate(tr.deadline) : '—'}
                      </TableCell>
                      {teams.map((team) => {
                        const state = tr.teams.find((x) => x.team === team.id)
                        return (
                          <TableCell key={team.id} className="p-1 text-center align-top">
                            {state ? (
                              <PickCell
                                state={state}
                                admin={!!data?.admin}
                                labelOn={t('unpickFor', { tournament: tr.host_club ?? '', team: team.name })}
                                labelOff={t('pickFor', { tournament: tr.host_club ?? '', team: team.name })}
                                busy={setPick.isPending && setPick.variables?.tournament === tr.id && setPick.variables?.team === team.id}
                                onToggle={() => toggle(tr, team, state)}
                              />
                            ) : (
                              <span className="text-muted-foreground" aria-hidden>·</span>
                            )}
                          </TableCell>
                        )
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-2xl border border-dashed border-input p-6 text-center text-sm text-muted-foreground">{children}</p>
}

/** One team × tournament: registered (from Basketplan), a pick toggle, or closed. */
function PickCell({ state, admin, labelOn, labelOff, busy, onToggle }: {
  state: TournamentTeamState
  admin: boolean
  labelOn: string
  labelOff: string
  busy: boolean
  onToggle: () => void
}) {
  const { t } = useTranslation('tournaments')
  if (state.status === 'registered') {
    return (
      <span className="inline-flex min-h-11 flex-col items-center justify-center gap-0.5 text-green-700 dark:text-green-400" title={t('registeredHint')}>
        <CircleCheck className="h-5 w-5" aria-hidden />
        <span className="text-[11px] leading-none">{t('registered')}</span>
      </span>
    )
  }
  if (!state.canPick && !state.picked) {
    return (
      <span className="inline-flex min-h-11 items-center justify-center text-muted-foreground" title={t('closedHint')}>
        <Lock className="h-4 w-4" aria-label={t('closed')} />
      </span>
    )
  }
  const attention = state.picked && state.attempt && ATTENTION.includes(state.attempt.result) ? state.attempt : null
  const title = [
    state.picked ? labelOn : labelOff,
    state.picked_by_name ? t('pickedBy', { name: state.picked_by_name }) : null,
    state.attempt ? t(`result_${state.attempt.result}` as 'result_error') : null,
  ].filter(Boolean).join(' · ')
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={busy}
      aria-pressed={state.picked}
      aria-label={state.picked ? labelOn : labelOff}
      title={title}
      className={cn(
        'inline-flex min-h-11 min-w-11 flex-col items-center justify-center gap-0.5 rounded-lg border px-1.5 text-[11px] leading-none transition-colors disabled:opacity-50',
        state.picked
          ? admin
            ? 'border-amber-400 bg-amber-50 text-amber-800 dark:border-amber-500/60 dark:bg-amber-500/10 dark:text-amber-300'
            : 'border-transparent bg-selected text-selected-foreground'
          : 'border-input bg-card text-muted-foreground hover:bg-surface-sunken',
      )}
    >
      {attention
        ? <TriangleAlert className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden />
        : state.picked ? <Check className="h-4 w-4" aria-hidden /> : <span className="h-4 w-4 rounded border border-input" aria-hidden />}
      <span>{attention ? t(`result_${attention.result}` as 'result_error') : state.picked ? t('picked') : t('pick')}</span>
    </button>
  )
}
