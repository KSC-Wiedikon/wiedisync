// "Done so far" tab of /scorer: per team, every core player and the duties they
// have already served this season (home games before today), fewest first — so
// whoever plans the next table sees at once who is next in line.
//
// Asked for by Leo (BB Herren 1 TR, 08.11.2026): /scorer only lists today and
// later since 23.09.2026, and the admin overview with past games is admin-only.
// A duty counts for the person who held the seat, whichever team it belonged
// to — the duty follows the person (moveSeatTeam), so this is their own record.

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { Game, Member, MemberTeam, Team } from '../../../types'
import { memberDisplayName } from '../../../utils/relations'
import { formatDateZurich } from '../../../utils/dateHelpers'
import TeamChip from '../../../components/TeamChip'
import LoadingSpinner from '../../../components/LoadingSpinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table'
import { servedDutiesByMember, type SeatKey } from '../lib/dutyHistory'

interface DutyHistoryProps {
  /** This season's home games before today, of this sport, cancelled/postponed excluded. */
  games: Game[]
  loading: boolean
  members: Member[]
  teams: Team[]
  memberTeams: MemberTeam[]
  sport: 'volleyball' | 'basketball'
  /** Non-admins: only these teams. null = every active team of the sport. */
  scopeTeamIds: string[] | null
}

export default function DutyHistory({ games, loading, members, teams, memberTeams, sport, scopeTeamIds }: DutyHistoryProps) {
  const { t, i18n } = useTranslation('scorer')

  const served = useMemo(() => servedDutiesByMember(games, sport), [games, sport])
  const memberMap = useMemo(() => new Map(members.map((m) => [String(m.id), m])), [members])

  const seatLabel: Record<SeatKey, string> = {
    scorer_member: t('scorer'),
    scoreboard_member: t('scoreboard'),
    scorer_scoreboard_member: t('scorerTaefeler'),
    referee_member: t('referee'),
    bb_scorer_member: t('bbScorer'),
    bb_timekeeper_member: t('bbTimekeeper'),
    bb_24s_official: t('bb24sOfficial'),
  }

  const groups = useMemo(() => {
    const scope = scopeTeamIds ? new Set(scopeTeamIds.map(String)) : null
    const sportTeams = teams
      .filter((tm) => tm.sport === sport && (!scope || scope.has(String(tm.id))))
      .sort((a, b) => a.name.localeCompare(b.name, i18n.language))
    return sportTeams.map((team) => {
      // Core players only: guests owe their duty to their own team.
      const ids = new Set(
        memberTeams
          .filter((mt) => String(mt.team) === String(team.id) && !((mt.guest_level ?? 0) > 0))
          .map((mt) => String(mt.member)),
      )
      const rows = [...ids]
        .map((id) => memberMap.get(id))
        .filter((m): m is Member => !!m && m.kscw_membership_active !== false)
        .map((m) => ({ member: m, duties: served.get(String(m.id)) ?? [] }))
        .sort((a, b) => a.duties.length - b.duties.length
          || `${a.member.last_name} ${a.member.first_name}`.localeCompare(`${b.member.last_name} ${b.member.first_name}`, i18n.language))
      return { team, rows, done: rows.filter((r) => r.duties.length > 0).length }
    }).filter((g) => g.rows.length > 0)
  }, [teams, sport, scopeTeamIds, memberTeams, memberMap, served, i18n.language])

  if (loading) return <div className="mt-6"><LoadingSpinner /></div>

  if (groups.length === 0) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        <p>{t('historyEmpty')}</p>
      </div>
    )
  }

  return (
    <div className="mt-6 space-y-6">
      <p className="text-sm text-muted-foreground">{t('historyIntro')}</p>
      {groups.map(({ team, rows, done }) => (
        <div key={team.id} className="overflow-hidden rounded-2xl border border-hairline bg-card shadow-card">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-hairline px-4 py-3">
            <TeamChip team={team.name} size="sm" />
            <span className="text-xs text-muted-foreground">{t('historyDoneCount', { done, total: rows.length })}</span>
          </div>
          <Table className="w-full text-left text-sm">
            <TableHeader>
              <TableRow className="border-b border-border text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <TableHead className="px-4 py-2">{t('historyColPerson')}</TableHead>
                <TableHead className="w-20 px-4 py-2 text-center">{t('overviewColDuties')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ member, duties }) => (
                <TableRow key={member.id} className="min-h-11 border-b border-border/60 last:border-0">
                  <TableCell className="px-4 py-2 align-top">
                    <div className="break-words font-medium leading-snug text-foreground">{memberDisplayName(member)}</div>
                    {duties.length > 0 ? (
                      <div className="mt-0.5 break-words text-xs leading-snug text-muted-foreground">
                        {duties.map((d) => `${formatDateZurich(d.date)} ${seatLabel[d.seat]}`).join(' · ')}
                      </div>
                    ) : (
                      <div className="mt-0.5 text-xs text-muted-foreground/80">{t('historyNone')}</div>
                    )}
                  </TableCell>
                  <TableCell className={`px-4 py-2 text-center align-top tabular-nums ${duties.length ? 'font-semibold text-foreground' : 'text-muted-foreground/80'}`}>
                    {duties.length || '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ))}
    </div>
  )
}
