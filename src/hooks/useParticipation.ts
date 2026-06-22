import { useCallback, useState } from 'react'
import { useCollection } from '../lib/query'
import { useMutation } from './useMutation'
import { useAuth } from './useAuth'
import { useRealtime } from './useRealtime'
import type { Participation, Absence, VolleyPosition } from '../types'
import { absenceCoversActivity } from '../utils/absenceHelpers'

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

  const { data: absencesData } = useCollection<Absence>('absences', {
    filter: user && activityDate
      ? { _and: [{ member: { _eq: user.id } }, { start_date: { _lte: activityDate } }, { end_date: { _gte: activityDate } }] }
      : { id: { _eq: -1 } },
    limit: 5,
    enabled: !!user && !!activityDate,
  })
  const absencesRaw = absencesData ?? []

  const { create, update, remove } = useMutation<Participation>('participations')

  // Realtime: refetch when any participation for this activity changes
  useRealtime<Participation>('participations', (e) => {
    if (e.record.activity_id === activityId && e.record.member === user?.id) {
      refetch()
    }
  })

  // Optimistic status: shown immediately while API call is in-flight
  const [optimisticStatus, setOptimisticStatus] = useState<Participation['status'] | null>(null)
  const [saveConfirmed, setSaveConfirmed] = useState(false)

  const participation = participations[0] ?? null

  // Filter absences to those that actually affect this activity type
  const matchingAbsence = absencesRaw.find((a) => activityDate ? absenceCoversActivity(a, activityType, activityDate) : false)
  const hasAbsence = !!matchingAbsence

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
    setOptimisticStatus(status)
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
      setOptimisticStatus(null)
    }
  }, [user, participation, activityType, activityId, isStaff, sessionId, create, update])

  const clearStatus = useCallback(async () => {
    if (participation) {
      setOptimisticStatus(null)
      setSaveConfirmed(false)
      try {
        await remove(participation.id)
        // Skip explicit refetch — realtime subscription handles data sync
      } catch {
        // Revert — restore the original status
        setOptimisticStatus(participation.status)
      }
    }
  }, [participation, remove])

  // Clear optimistic status once server data catches up
  const serverStatus = participation?.status ?? null
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
