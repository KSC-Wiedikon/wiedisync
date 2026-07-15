import { useMemo, useCallback } from 'react'
import type { ScorerDelegation, Member } from '../../../types'
import { memberDisplayName } from '../../../utils/relations'
import { useCollection } from '../../../lib/query'
import { useRealtime } from '../../../hooks/useRealtime'
import { useAuth } from '../../../hooks/useAuth'
import { logActivity } from '../../../utils/logActivity'
import { createRecord, updateRecord } from '../../../lib/api'

export function useScorerDelegations() {
  const { user } = useAuth()
  const userId = user?.id ?? ''

  const {
    data: delegations,
    isLoading,
    refetch,
  } = useCollection<ScorerDelegation>('scorer_delegations', {
    filter: userId
      ? { _and: [{ status: { _eq: 'pending' } }, { _or: [{ from_member: { _eq: userId } }, { to_member: { _eq: userId } }] }] }
      : { id: { _eq: -1 } },
    sort: ['-date_created'],
    limit: 50,
    enabled: !!userId,
  })

  useRealtime<ScorerDelegation>('scorer_delegations', () => { refetch() }, ['create', 'update'])

  const delegationsArr = delegations ?? []

  const pendingIncoming = useMemo(
    () => delegationsArr.filter((d) => d.to_member === userId && d.status === 'pending'),
    [delegationsArr, userId],
  )

  const pendingOutgoing = useMemo(
    () => delegationsArr.filter((d) => d.from_member === userId && d.status === 'pending'),
    [delegationsArr, userId],
  )

  const createDelegation = useCallback(
    async (
      gameId: string,
      role: ScorerDelegation['role'],
      toMemberId: string,
      fromTeamId: string,
      toTeamId: string,
    ) => {
      const sameTeam = fromTeamId === toTeamId
      const record = await createRecord<ScorerDelegation>('scorer_delegations', {
        game: gameId,
        role,
        from_member: userId,
        to_member: toMemberId,
        from_team: fromTeamId,
        to_team: toTeamId,
        same_team: sameTeam,
        // Every delegation — teammate or external — must be accepted by the
        // recipient. (DB trigger trg_scorer_delegation_validate no longer
        // auto-accepts same-team either; migration 121.)
        status: 'pending',
      })
      logActivity('create', 'scorer_delegations', record.id, { game: gameId, role, to_member: toMemberId, same_team: sameTeam })
      refetch()
      return record
    },
    [userId, refetch],
  )

  const acceptDelegation = useCallback(
    async (delegationId: string) => {
      await updateRecord('scorer_delegations', delegationId, { status: 'accepted' })
      logActivity('update', 'scorer_delegations', delegationId, { status: 'accepted' })
      refetch()
    },
    [refetch],
  )

  const declineDelegation = useCallback(
    async (delegationId: string) => {
      await updateRecord('scorer_delegations', delegationId, { status: 'declined' })
      logActivity('update', 'scorer_delegations', delegationId, { status: 'declined' })
      refetch()
    },
    [refetch],
  )

  /** Find pending outgoing delegation for a specific game + role */
  const getPendingForRole = useCallback(
    (gameId: string, role: string): ScorerDelegation | undefined =>
      pendingOutgoing.find((d) => d.game === gameId && d.role === role),
    [pendingOutgoing],
  )

  /** Get the target member name for a pending delegation */
  const getDelegationTargetName = useCallback(
    (delegation: ScorerDelegation, members: Member[]): string => {
      const m = members.find((mem) => mem.id === delegation.to_member)
      return m ? memberDisplayName(m) : ''
    },
    [],
  )

  return {
    pendingIncoming,
    pendingOutgoing,
    isLoading,
    createDelegation,
    acceptDelegation,
    declineDelegation,
    getPendingForRole,
    getDelegationTargetName,
    refetch,
  }
}
