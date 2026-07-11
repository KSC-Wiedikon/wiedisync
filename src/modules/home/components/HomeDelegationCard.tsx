import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { Member, Game } from '../../../types'
import { useCollection } from '../../../lib/query'
import { useScorerDelegations } from '../../scorer/hooks/useScorerDelegations'
import DelegationRequestBanner from '../../scorer/components/DelegationRequestBanner'

/**
 * Homepage surface for pending incoming duty-delegation requests.
 *
 * A delegated duty is only transferred once the recipient accepts, so the
 * accept/decline action needs to be reachable without hunting through the
 * scorer page. This reuses the same DelegationRequestBanner shown on /scorer.
 *
 * Self-contained: `useScorerDelegations` already scopes to the logged-in user
 * (to_member = me, status = pending) and refetches on realtime. We only fetch
 * the delegator names + game details referenced by the pending rows, so the
 * card costs nothing when the user has no requests (returns null → no render).
 */
export default function HomeDelegationCard() {
  const { t } = useTranslation('scorer')
  const { pendingIncoming, acceptDelegation, declineDelegation } = useScorerDelegations()

  const fromIds = useMemo(
    () => [...new Set(pendingIncoming.map((d) => d.from_member).filter(Boolean))],
    [pendingIncoming],
  )
  const gameIds = useMemo(
    () => [...new Set(pendingIncoming.map((d) => d.game).filter(Boolean))],
    [pendingIncoming],
  )

  // Delegator names — members' first/last name are readable by any member
  // (MEMBER_VISIBLE_FIELDS, null row filter). Games are public.
  const { data: membersRaw } = useCollection<Member>('members', {
    filter: { id: { _in: fromIds.length ? fromIds : [-1] } },
    fields: ['id', 'first_name', 'last_name'],
    limit: 50,
    enabled: fromIds.length > 0,
  })
  const { data: gamesRaw } = useCollection<Game>('games', {
    filter: { id: { _in: gameIds.length ? gameIds : [-1] } },
    fields: ['id', 'home_team', 'away_team', 'date', 'time', 'league'],
    limit: 50,
    enabled: gameIds.length > 0,
  })

  if (pendingIncoming.length === 0) return null

  async function handleAccept(id: string) {
    try {
      await acceptDelegation(id)
      toast.success(t('delegateAccepted'))
    } catch {
      toast.error(t('errorAcceptDelegation'))
    }
  }
  async function handleDecline(id: string) {
    try {
      await declineDelegation(id)
      toast.success(t('delegateDeclined'))
    } catch {
      toast.error(t('errorDeclineDelegation'))
    }
  }

  return (
    <div className="mb-6 lg:flex lg:flex-col lg:items-center">
      <div className="w-full lg:max-w-2xl">
        <DelegationRequestBanner
          delegations={pendingIncoming}
          members={membersRaw ?? []}
          games={gamesRaw ?? []}
          onAccept={handleAccept}
          onDecline={handleDecline}
        />
      </div>
    </div>
  )
}
