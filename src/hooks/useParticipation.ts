import { useCallback, useState } from 'react'
import { useCollection } from '../lib/query'
import { useMutation } from './useMutation'
import { useAuth } from './useAuth'
import { useRealtime } from './useRealtime'
import { useMyCoveringAbsence } from './useMyCoveringAbsence'
import type { Participation, VolleyPosition } from '../types'

export function useParticipation(
  activityType: Participation['activity_type'],
  activityId: string,
  activityDate?: string,
  sessionId?: string,
  isStaff?: boolean,
) {
  const { user } = useAuth()

  const { data: participationsRaw, refetch } = useCollection<Participation>('participations', {
    filter: user && activityId
      ? { _and: [
          { member: { _eq: user.id } },
          { activity_type: { _eq: activityType } },
          { activity_id: { _eq: activityId } },
          ...(sessionId ? [{ session_id: { _eq: sessionId } }] : []),
        ] }
      : { id: { _eq: -1 } },
    limit: 1,
    enabled: !!user && !!activityId,
  })
  const participations = participationsRaw ?? []

  // Covering-absence lookup lives in one place (useMyCoveringAbsence) — reused by
  // the game/training/event cards + detail modals so the rule can't drift.
  const { hasAbsence } = useMyCoveringAbsence(activityType, activityDate)

  const { create, update, remove } = useMutation<Participation>('participations')

  // Realtime: refetch when any participation for this activity changes
  useRealtime<Participation>('participations', (e) => {
    if (e.record.activity_id === activityId && e.record.member === user?.id) {
      refetch()
    }
  })

  // Optimistic status: shown immediately while the API call is in-flight.
  // Scoped to the current activity via `activityKey` so a previously-opened
  // activity's optimistic RSVP can't bleed into a freshly-opened one — the
  // detail modals are a single persistent instance whose activityId prop
  // changes WITHOUT remounting, so plain state would survive the switch and
  // show a phantom "Yes" on a game the user never touched.
  const activityKey = `${activityType}|${activityId}|${sessionId ?? ''}`
  const [optimistic, setOptimistic] = useState<{ key: string; status: Participation['status'] } | null>(null)
  const [saveConfirmed, setSaveConfirmed] = useState(false)

  const participation = participations[0] ?? null

  // Auto-decline is handled by the backend (Directus hooks) when absences
  // or activities are created. The frontend only displays the absence state.

  const setStatus = useCallback(async (
    status: Participation['status'],
    note = '',
    guestCount = 0,
    positions?: { position_1?: VolleyPosition | null; position_2?: VolleyPosition | null; position_3?: VolleyPosition | null },
  ) => {
    if (!user) return
    // Optimistic update — show status immediately
    setOptimistic({ key: activityKey, status })
    setSaveConfirmed(false)
    const posFields = positions ? {
      position_1: positions.position_1 || null,
      position_2: positions.position_2 || null,
      position_3: positions.position_3 || null,
    } : {}
    try {
      if (participation) {
        // Preserve the row's original is_staff classification on update — set it
        // only on create (matches GameCard / TrainingCard / EventCard /
        // ParticipationButton, which all omit is_staff on update). Writing it
        // here clobbered an existing player RSVP to staff whenever the viewer's
        // role context drifted (e.g. a season-lagged member_teams row makes
        // isStaffOnly flip true), silently yanking the row out of the player
        // tally so the participation bricks dropped to zero on every click.
        await update(participation.id, { status, note, guest_count: guestCount, ...posFields })
      } else {
        await create({
          member: user.id,
          activity_type: activityType,
          activity_id: activityId,
          status,
          note,
          guest_count: guestCount,
          is_staff: isStaff ?? false,
          ...(sessionId ? { session_id: sessionId } : {}),
          ...posFields,
        })
      }
      setSaveConfirmed(true)
      // Skip explicit refetch — realtime subscription handles data sync
    } catch {
      // Revert optimistic update on failure
      setOptimistic(null)
    }
  }, [user, participation, activityType, activityId, activityKey, isStaff, sessionId, create, update])

  const clearStatus = useCallback(async () => {
    if (participation) {
      setOptimistic(null)
      setSaveConfirmed(false)
      try {
        await remove(participation.id)
        // Skip explicit refetch — realtime subscription handles data sync
      } catch {
        // Revert — restore the original status
        setOptimistic({ key: activityKey, status: participation.status })
      }
    }
  }, [participation, activityKey, remove])

  // Optimistic status only applies to the activity it was set for; once the
  // user switches activities its key no longer matches and we fall back to the
  // server value (null for an untouched activity).
  const serverStatus = participation?.status ?? null
  const optimisticStatus = optimistic && optimistic.key === activityKey ? optimistic.status : null
  const displayStatus = optimisticStatus ?? serverStatus

  return {
    participation,
    hasAbsence,
    effectiveStatus: displayStatus,
    note: participation?.note ?? '',
    setStatus,
    clearStatus,
    refetch,
    saveConfirmed,
    dismissConfirmed: useCallback(() => setSaveConfirmed(false), []),
  }
}

export function useTeamParticipations(
  activityType: Participation['activity_type'],
  activityId: string,
  memberIds: string[],
  sessionId?: string,
) {
  const { data, refetch, isLoading } = useCollection<Participation>('participations', {
    filter: activityId && memberIds.length > 0
      ? { _and: [
          { member: { _in: memberIds } },
          { activity_type: { _eq: activityType } },
          { activity_id: { _eq: activityId } },
          ...(sessionId ? [{ session_id: { _eq: sessionId } }] : []),
        ] }
      : { id: { _eq: -1 } },
    all: true,
    enabled: !!activityId && memberIds.length > 0,
  })

  return { participations: data ?? [], refetch, isLoading }
}

/** Fetch all participations for an event across all sessions (for roster aggregation) */
export function useAllEventParticipations(
  activityId: string,
  memberIds: string[],
) {
  const { data, refetch, isLoading } = useCollection<Participation>('participations', {
    filter: activityId && memberIds.length > 0
      ? { _and: [
          { member: { _in: memberIds } },
          { activity_type: { _eq: 'event' } },
          { activity_id: { _eq: activityId } },
        ] }
      : { id: { _eq: -1 } },
    all: true,
    enabled: !!activityId && memberIds.length > 0,
  })

  return { participations: data ?? [], refetch, isLoading }
}
