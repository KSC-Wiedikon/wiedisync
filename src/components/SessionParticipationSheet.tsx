import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, X } from 'lucide-react'
import Modal from '@/components/Modal'
import { useCollection } from '../lib/query'
import { useMutation } from '../hooks/useMutation'
import { useRealtime } from '../hooks/useRealtime'
import { useAuth } from '../hooks/useAuth'
import type { EventSession, Participation } from '../types'

interface Props {
  activityId: string
  sessions: EventSession[]
  onClose: () => void
}

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('de-CH', { weekday: 'short', day: 'numeric', month: 'short' })
}

function SessionRow({
  session,
  status,
  onSetStatus,
}: {
  session: EventSession
  status: Participation['status'] | null
  onSetStatus: (session: EventSession, status: Participation['status']) => void
}) {
  const { t } = useTranslation('participation')
  const dateStr = session.date?.split(' ')[0] ?? ''

  const buttons: { status: Participation['status']; icon: React.ReactNode; activeClass: string }[] = [
    { status: 'confirmed', icon: <Check className="h-4 w-4" />, activeClass: 'bg-green-500 text-white' },
    { status: 'declined', icon: <X className="h-4 w-4" />, activeClass: 'bg-red-500 text-white' },
  ]

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="flex-1">
        <div className="text-sm font-medium text-gray-800 dark:text-gray-200">
          {session.label || formatDateShort(dateStr)}
        </div>
        {session.start_time && (
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {session.start_time}{session.end_time ? `–${session.end_time}` : ''}
          </div>
        )}
        {!session.start_time && session.label && (
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {formatDateShort(dateStr)}
          </div>
        )}
      </div>
      <div className="flex gap-1.5">
        {buttons.map(({ status: btnStatus, icon, activeClass }) => (
          <button
            key={btnStatus}
            onClick={() => onSetStatus(session, btnStatus)}
            className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold transition-colors sm:h-8 sm:w-8 ${
              status === btnStatus
                ? activeClass
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-400 dark:hover:bg-gray-600'
            }`}
            title={t(btnStatus)}
          >
            {icon}
          </button>
        ))}
      </div>
    </div>
  )
}

export default function SessionParticipationSheet({ activityId, sessions, onClose }: Props) {
  const { t } = useTranslation('events')
  const { user } = useAuth()

  // Batch: fetch ALL of this user's participations for the event in one query
  // (was N queries — one per session row via useParticipation).
  const { data: rowsRaw, refetch } = useCollection<Participation>('participations', {
    filter: user && activityId
      ? { _and: [
          { member: { _eq: user.id } },
          { activity_type: { _eq: 'event' } },
          { activity_id: { _eq: activityId } },
        ] }
      : { id: { _eq: -1 } },
    all: true,
    enabled: !!user && !!activityId,
  })
  const rows = rowsRaw ?? []

  useRealtime<Participation>('participations', (e) => {
    if (e.record.activity_id === activityId && e.record.member === user?.id) refetch()
  })

  const { create, update } = useMutation<Participation>('participations')
  // Optimistic status per session, shown immediately while the write is in-flight.
  const [optimistic, setOptimistic] = useState<Record<string, Participation['status']>>({})

  const bySession = useMemo(() => {
    const map = new Map<string, Participation>()
    for (const p of rows) {
      const sid = p.session_id ? String(p.session_id) : ''
      if (sid) map.set(sid, p)
    }
    return map
  }, [rows])

  const handleSetStatus = useCallback(async (session: EventSession, status: Participation['status']) => {
    if (!user) return
    const sid = String(session.id)
    setOptimistic((prev) => ({ ...prev, [sid]: status }))
    const existing = bySession.get(sid)
    try {
      if (existing) {
        await update(existing.id, { status })
      } else {
        await create({
          member: user.id,
          activity_type: 'event',
          activity_id: activityId,
          status,
          note: '',
          guest_count: 0,
          is_staff: false,
          session_id: session.id,
        })
      }
    } catch {
      // Revert optimistic status on failure
      setOptimistic((prev) => {
        const next = { ...prev }
        delete next[sid]
        return next
      })
    }
  }, [user, bySession, activityId, create, update])

  return (
    <Modal open onClose={onClose} title={t('sessionParticipation')} size="sm">
      <div className="divide-y divide-gray-100 dark:divide-gray-700">
        {sessions.map((session) => {
          const sid = String(session.id)
          const status = optimistic[sid] ?? bySession.get(sid)?.status ?? null
          return (
            <SessionRow
              key={session.id}
              session={session}
              status={status}
              onSetStatus={handleSetStatus}
            />
          )
        })}
      </div>
    </Modal>
  )
}
