import { useCallback, useEffect, useState } from 'react'
import i18n from '../../../i18n'
import { todayLocal } from '../../../utils/dateHelpers'
import type { Game, Participation, Absence, Member, MemberTeam } from '../../../types'
import { fetchAllItems } from '../../../lib/api'
import { asObj, memberName } from '../../../utils/relations'
import { classifyAttendance, type DateRange, type PlayerStats } from '../../trainings/useAttendanceStats'
import { isCupGame } from '../../../utils/leagueClassification'

export interface GamePlayerStats extends PlayerStats {
  gameStatuses: Array<{ gameId: string; status: 'present' | 'absent'; dateKey: string }>
}

export function useGameAttendanceStats(
  teamId: string | null,
  range: DateRange,
  leagueOnly: boolean,
) {
  const [stats, setStats] = useState<GamePlayerStats[]>([])
  const [gamesById, setGamesById] = useState<Map<string, Game>>(new Map())
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const fetch = useCallback(async () => {
    if (!teamId) {
      setStats([])
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    setError(null)
    try {
      // Members
      const memberTeams = await fetchAllItems<MemberTeam & { member: Member | string }>('member_teams', {
        filter: { team: { _eq: teamId } },
        fields: ['*', 'member.*'],
      })
      const members = memberTeams
        .map((mt) => asObj<Member>(mt.member))
        .filter((m): m is Member => m !== null)
        .map((m) => ({ ...m, id: String(m.id) }))

      if (members.length === 0) {
        setStats([])
        setGamesById(new Map())
        setIsLoading(false)
        return
      }

      // Games
      const allGames = await fetchAllItems<Game>('games', {
        filter: {
          _and: [
            { kscw_team: { _eq: teamId } },
            { status: { _in: ['scheduled', 'completed', 'live'] } },
            { date: { _gte: range.from } },
            { date: { _lte: range.to } },
            { away_team: { _nnull: true } },
          ],
        },
        sort: ['date', 'time'],
        fields: ['id', 'date', 'time', 'home_team', 'away_team', 'league', 'hall.id', 'hall.name', 'kscw_team', 'type', 'status', 'source'],
      })
      const games = leagueOnly
        ? allGames.filter((g) => !isCupGame(g.league))
        : allGames

      const map = new Map<string, Game>()
      for (const g of games) map.set(g.id, g)
      setGamesById(map)

      if (games.length === 0) {
        setStats([])
        setIsLoading(false)
        return
      }

      // Participations
      const gameIds = games.map((g) => g.id)
      const participations = await fetchAllItems<Participation>('participations', {
        filter: { _and: [{ activity_type: { _eq: 'game' } }, { activity_id: { _in: gameIds } }] },
      })

      // Absences
      const memberIds = members.map((m) => m.id)
      const absences = await fetchAllItems<Absence>('absences', {
        filter: { _and: [{ member: { _in: memberIds } }, { end_date: { _gte: range.from } }, { start_date: { _lte: range.to } }] },
      })

      // Pre-index participations + absences once so the per-(game, member) loops
      // below run in O(games × members) instead of O(games × members × participations).
      const partByKey = new Map<string, Participation>()
      const partByMember = new Map<string, Participation[]>()
      for (const p of participations) {
        partByKey.set(`${p.member}|${p.activity_id}`, p)
        const arr = partByMember.get(String(p.member))
        if (arr) arr.push(p)
        else partByMember.set(String(p.member), [p])
      }
      const absencesByMember = new Map<string, Absence[]>()
      for (const a of absences) {
        const arr = absencesByMember.get(String(a.member))
        if (arr) arr.push(a)
        else absencesByMember.set(String(a.member), [a])
      }
      const hasCoveringAbsence = (memberId: string, dateKey: string) =>
        (absencesByMember.get(memberId) ?? []).some(
          (a) => a.start_date <= dateKey && a.end_date >= dateKey,
        )

      const memberStats: Record<string, GamePlayerStats> = {}
      for (const member of members) {
        memberStats[member.id] = {
          memberId: member.id,
          memberName: memberName(member),
          jerseyNumber: member.number,
          total: games.length,
          present: 0,
          absent: 0,
          percentage: 0,
          trend: [],
          lastResponseAt: null,
          gameStatuses: [],
        }
      }

      const today = todayLocal()
      for (const game of games) {
        const dateKey = (game.date ?? '').split(' ')[0]
        if (!dateKey) continue
        const isPast = dateKey <= today
        for (const member of members) {
          const s = memberStats[member.id]
          const participation = partByKey.get(`${member.id}|${game.id}`)
          const hasAbsence = hasCoveringAbsence(member.id, dateKey)
          const bucket = classifyAttendance({
            participationStatus: participation?.status ?? null,
            hasAbsence,
            isPast,
          })
          if (bucket === 'present') {
            s.present++
            s.gameStatuses.push({ gameId: game.id, status: 'present', dateKey })
          } else if (bucket === 'absent') {
            s.absent++
            s.gameStatuses.push({ gameId: game.id, status: 'absent', dateKey })
          }
          // 'not_counted' — skip from drilldown (future, no response, no absence)
        }
      }

      // Last response timestamp + trend (last 5 past games)
      const pastGames = games.filter((g) => (g.date ?? '').split(' ')[0] <= today)
      const lastGames = pastGames.slice(-5)
      for (const member of members) {
        const memberPart = partByMember.get(member.id) ?? []
        if (memberPart.length > 0) {
          const latest = memberPart.reduce((a, b) =>
            (a.date_updated ?? '') > (b.date_updated ?? '') ? a : b,
          )
          memberStats[member.id].lastResponseAt = latest.date_updated ?? null
        }

        const trend: GamePlayerStats['trend'] = []
        for (const game of lastGames) {
          const dateKey = (game.date ?? '').split(' ')[0]
          const participation = partByKey.get(`${member.id}|${game.id}`)
          const hasAbsence = hasCoveringAbsence(member.id, dateKey)
          const bucket = classifyAttendance({
            participationStatus: participation?.status ?? null,
            hasAbsence,
            isPast: true,
          })
          trend.push(bucket === 'present' ? 'present' : 'absent')
        }
        memberStats[member.id].trend = trend
      }

      // Total = past games + future games with explicit response or absence
      const futureGames = games.filter((g) => (g.date ?? '').split(' ')[0] > today)
      const result = Object.values(memberStats).map((s) => {
        const futureResponded = futureGames.filter((g) => {
          const dateKey = (g.date ?? '').split(' ')[0]
          const hasParticipation = partByKey.has(`${s.memberId}|${g.id}`)
          const hasAbsence = hasCoveringAbsence(s.memberId, dateKey)
          return hasParticipation || hasAbsence
        }).length
        const total = pastGames.length + futureResponded
        return {
          ...s,
          total,
          percentage: total > 0 ? Math.round((s.present / total) * 100) : 0,
        }
      })
      result.sort((a, b) => b.percentage - a.percentage || a.memberName.localeCompare(b.memberName, i18n.language))

      setStats(result)
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      setIsLoading(false)
    }
  }, [teamId, range.from, range.to, leagueOnly])

  useEffect(() => { fetch() }, [fetch])

  return { stats, gamesById, isLoading, error, refetch: fetch }
}
