import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { X, UserPlus, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import MemberMultiSelect from '@/components/MemberMultiSelect'
import { useCollection } from '../../../lib/query'
import { useMutation } from '../../../hooks/useMutation'
import { useConfirm } from '@/components/ConfirmProvider'
import { asObj, memberDisplayName, relId } from '../../../utils/relations'
import type { Game, Member, Team } from '../../../types'

interface Props {
  game: Game
  /** The game's own team. Guests are, by definition, everyone else. */
  kscwTeamId: string
  /** Coach / TR of this game's team, or an admin. Read-only view otherwise. */
  canEdit: boolean
}

type GuestRow = {
  id: string
  member: Member | string
  via_team: Team | string | null
}
type OpeningRow = {
  id: string
  team: Team | string
}

/**
 * "Open this game to…" — the coach's control for pulling in players from outside the
 * team's own roster for one fixture (migration 271).
 *
 * Two levers, because coaches ask for it two ways: open the whole of another team
 * (a cup game where H3 is the natural feeder), or name individuals. Both land in the
 * same invitee list; the difference is only that closing a team opening releases the
 * players it brought, while a named individual stays.
 *
 * Everyone can SEE who a game is open to — a player scanning the roster needs to know
 * why an unfamiliar name is on it. Only the game's own coach/TR can change it.
 */
export default function GameGuestSection({ game, kscwTeamId, canEdit }: Props) {
  const { t } = useTranslation('games')
  const confirm = useConfirm()
  const [picking, setPicking] = useState(false)
  const [pendingMembers, setPendingMembers] = useState<string[]>([])

  const gameDate = game.date?.split(' ')[0] ?? ''
  const sport = asObj<Team>(game.kscw_team)?.sport ?? ''

  const { data: openingsRaw, refetch: refetchOpenings } = useCollection<OpeningRow>('game_guest_teams', {
    filter: { game: { _eq: game.id } },
    fields: ['id', 'team.id', 'team.name'],
    all: true,
  })
  const openings = useMemo(() => openingsRaw ?? [], [openingsRaw])

  const { data: guestsRaw, refetch: refetchGuests } = useCollection<GuestRow>('game_guests', {
    filter: { game: { _eq: game.id } },
    fields: ['id', 'member.id', 'member.first_name', 'member.last_name', 'member.nickname', 'via_team.id'],
    all: true,
  })
  const guests = useMemo(() => guestsRaw ?? [], [guestsRaw])

  const { create: createOpening, remove: removeOpening } = useMutation<{ id: string }>('game_guest_teams')
  const { create: createGuest, remove: removeGuest } = useMutation<{ id: string }>('game_guests')

  // Candidate pool: active teams of the SAME sport, minus the game's own team.
  // Cross-sport would be nonsense (a basketball player cannot fill in at volleyball),
  // and the game's own team is already on the sheet.
  const { data: teamsRaw } = useCollection<Team>('teams', {
    filter: { active: { _eq: true } },
    fields: ['id', 'name', 'sport'],
    sort: ['name'],
    all: true,
  })
  const candidateTeams = useMemo(
    () => (teamsRaw ?? []).filter(tm => String(tm.id) !== String(kscwTeamId) && (!sport || tm.sport === sport)),
    [teamsRaw, kscwTeamId, sport],
  )
  const candidateTeamIds = useMemo(() => candidateTeams.map(tm => String(tm.id)), [candidateTeams])

  // Who plays for those teams. A single-level junction fetch (`member_teams` by
  // `team _in`) rather than filtering `members` through `member_teams.team` — the
  // latter walks the same alias the Coach policy walks and silently returns [] for
  // non-admins (the M2M-deep-filter trap).
  const { data: candidateRowsRaw } = useCollection<{ member: Member | string; team: string | number }>('member_teams', {
    filter: candidateTeamIds.length > 0 ? { team: { _in: candidateTeamIds } } : { id: { _eq: -1 } },
    fields: ['member.id', 'team'],
    all: true,
    enabled: canEdit && candidateTeamIds.length > 0,
  })

  // The game's own roster — never offer someone already on the sheet.
  const { data: ownRosterRaw } = useCollection<{ member: Member | string }>('member_teams', {
    filter: { team: { _eq: kscwTeamId } },
    fields: ['member.id'],
    all: true,
    enabled: canEdit,
  })
  const ownRosterIds = useMemo(
    () => new Set((ownRosterRaw ?? []).map(r => String(asObj<Member>(r.member)?.id ?? relId(r.member)))),
    [ownRosterRaw],
  )

  const candidateMemberIds = useMemo(() => {
    const ids = new Set<string>()
    for (const r of candidateRowsRaw ?? []) {
      const id = String(asObj<Member>(r.member)?.id ?? relId(r.member))
      if (id && !ownRosterIds.has(id)) ids.add(id)
    }
    return [...ids]
  }, [candidateRowsRaw, ownRosterIds])

  // memberId → their team ids, for the clash check below.
  const teamsByCandidate = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const r of candidateRowsRaw ?? []) {
      const id = String(asObj<Member>(r.member)?.id ?? relId(r.member))
      const team = String(relId(r.team))
      if (!id || !team) continue
      map.set(id, [...(map.get(id) ?? []), team])
    }
    return map
  }, [candidateRowsRaw])

  // Clash warning, advisory only (the user's call: warn, change nothing). Games read
  // club-wide so this is reliable; trainings are team-scoped for non-admins, so a
  // coach may not see another team's session — hence "may have" wording, and games
  // are checked first because they are the conflict that actually cannot be moved.
  const { data: sameDayGamesRaw } = useCollection<Game>('games', {
    filter: gameDate
      ? { _and: [{ date: { _eq: gameDate } }, { id: { _neq: game.id } }, { status: { _neq: 'cancelled' } }] }
      : { id: { _eq: -1 } },
    fields: ['id', 'kscw_team'],
    all: true,
    enabled: canEdit && !!gameDate,
  })
  const busyTeamIds = useMemo(
    () => new Set((sameDayGamesRaw ?? []).map(g => String(relId(g.kscw_team))).filter(Boolean)),
    [sameDayGamesRaw],
  )
  const clashNotes = useMemo(() => {
    const map = new Map<string, string>()
    if (busyTeamIds.size === 0) return map
    for (const [memberId, teams] of teamsByCandidate) {
      if (teams.some(tid => busyTeamIds.has(tid))) map.set(memberId, t('guestClashWarning'))
    }
    return map
  }, [teamsByCandidate, busyTeamIds, t])

  // Individually invited guests only. Players pulled in by a team opening are
  // represented by that opening's chip — listing them again would suggest they can be
  // removed one by one, which closing the opening is what actually does.
  const individualGuests = useMemo(
    () => guests.filter(g => relId(g.via_team) === ''),
    [guests],
  )
  const openTeamIds = useMemo(() => new Set(openings.map(o => String(relId(o.team)))), [openings])
  const availableTeams = candidateTeams.filter(tm => !openTeamIds.has(String(tm.id)))

  const guestCount = guests.length
  const clashingInvited = useMemo(
    () => guests.filter(g => {
      const id = String(asObj<Member>(g.member)?.id ?? relId(g.member))
      return clashNotes.has(id)
    }).length,
    [guests, clashNotes],
  )

  async function openToTeam(teamId: string) {
    try {
      await createOpening({ game: game.id, team: teamId })
      await Promise.all([refetchOpenings(), refetchGuests()])
      toast.success(t('guestTeamOpened'))
    } catch {
      toast.error(t('guestSaveFailed'))
    }
  }

  async function closeOpening(row: OpeningRow) {
    const name = asObj<Team>(row.team)?.name ?? ''
    if (!(await confirm({ message: t('guestTeamCloseConfirm', { team: name }), danger: true }))) return
    try {
      await removeOpening(row.id)
      await Promise.all([refetchOpenings(), refetchGuests()])
    } catch {
      toast.error(t('guestSaveFailed'))
    }
  }

  async function inviteMembers() {
    if (pendingMembers.length === 0) return
    try {
      for (const memberId of pendingMembers) {
        await createGuest({ game: game.id, member: memberId })
      }
      setPendingMembers([])
      setPicking(false)
      await refetchGuests()
      toast.success(t('guestInvited', { count: pendingMembers.length }))
    } catch {
      toast.error(t('guestSaveFailed'))
    }
  }

  async function uninvite(row: GuestRow) {
    const m = asObj<Member>(row.member)
    if (!(await confirm({ message: t('guestRemoveConfirm', { name: m ? memberDisplayName(m) : '' }), danger: true }))) return
    try {
      await removeGuest(row.id)
      await refetchGuests()
    } catch {
      toast.error(t('guestSaveFailed'))
    }
  }

  if (!canEdit && guestCount === 0) return null

  return (
    <div className="space-y-3 border-t px-6 py-4 dark:border-gray-700">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('guestSectionTitle')}</h4>
        {guestCount > 0 && (
          <span className="text-xs text-gray-500 dark:text-gray-400">{t('guestCount', { count: guestCount })}</span>
        )}
      </div>

      {guestCount === 0 && canEdit && (
        <p className="text-xs text-gray-500 dark:text-gray-400">{t('guestSectionHint')}</p>
      )}

      {(openings.length > 0 || individualGuests.length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {openings.map(o => {
            const team = asObj<Team>(o.team)
            return (
              <span key={`t-${o.id}`} className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-medium text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
                {team?.name ?? '—'}
                {canEdit && (
                  <button type="button" onClick={() => closeOpening(o)} aria-label={t('guestTeamClose', { team: team?.name ?? '' })} className="hover:text-sky-900 dark:hover:text-sky-100">
                    <X className="h-3 w-3" />
                  </button>
                )}
              </span>
            )
          })}
          {individualGuests.map(g => {
            const m = asObj<Member>(g.member)
            return (
              <span key={`m-${g.id}`} className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-2.5 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
                {m ? memberDisplayName(m) : '—'}
                {canEdit && (
                  <button type="button" onClick={() => uninvite(g)} aria-label={t('guestRemove', { name: m ? memberDisplayName(m) : '' })} className="hover:text-brand-900 dark:hover:text-brand-100">
                    <X className="h-3 w-3" />
                  </button>
                )}
              </span>
            )
          })}
        </div>
      )}

      {canEdit && clashingInvited > 0 && (
        <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>{t('guestClashSummary', { count: clashingInvited })}</span>
        </p>
      )}

      {canEdit && !picking && (
        <Button size="sm" variant="outline" onClick={() => setPicking(true)} className="gap-1.5">
          <UserPlus className="h-3.5 w-3.5" />
          {t('guestOpenTo')}
        </Button>
      )}

      {canEdit && picking && (
        <div className="space-y-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
          {availableTeams.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-gray-600 dark:text-gray-400">{t('guestOpenToTeam')}</p>
              <div className="flex flex-wrap gap-1.5">
                {availableTeams.map(tm => (
                  <button
                    key={tm.id}
                    type="button"
                    onClick={() => openToTeam(String(tm.id))}
                    className="min-h-[44px] rounded-full border border-gray-300 px-3 py-1 text-xs hover:border-sky-400 hover:bg-sky-50 dark:border-gray-600 dark:text-gray-200 dark:hover:border-sky-500 dark:hover:bg-sky-900/30 sm:min-h-0"
                  >
                    {tm.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="mb-1.5 text-xs font-medium text-gray-600 dark:text-gray-400">{t('guestOpenToMembers')}</p>
            <MemberMultiSelect
              selected={pendingMembers}
              onChange={setPendingMembers}
              restrictToIds={candidateMemberIds}
              noteByMember={clashNotes}
              placeholder={t('guestSearchPlaceholder')}
            />
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setPicking(false); setPendingMembers([]) }}
              className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400"
            >
              {t('cancel', { ns: 'common' })}
            </button>
            <Button size="sm" onClick={inviteMembers} disabled={pendingMembers.length === 0}>
              {t('guestInvite')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
