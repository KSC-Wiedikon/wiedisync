import { useTranslation } from 'react-i18next'
import { Check, X } from 'lucide-react'
import Modal from '@/components/Modal'
import { useParticipation } from '../hooks/useParticipation'
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

function SessionRow({ activityId, session }: { activityId: string; session: EventSession }) {
  const { t } = useTranslation('participation')
  const dateStr = session.date?.split(' ')[0] ?? ''
  const { effectiveStatus, setStatus } = useParticipation('event', activityId, dateStr, session.id)

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
        {buttons.map(({ status, icon, activeClass }) => (
          <button
            key={status}
            onClick={() => setStatus(status)}
            className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold transition-colors sm:h-8 sm:w-8 ${
              effectiveStatus === status
                ? activeClass
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-400 dark:hover:bg-gray-600'
            }`}
            title={t(status)}
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

  return (
    <Modal open onClose={onClose} title={t('sessionParticipation')} size="sm">
      <div className="divide-y divide-gray-100 dark:divide-gray-700">
        {sessions.map((session) => (
          <SessionRow key={session.id} activityId={activityId} session={session} />
        ))}
      </div>
    </Modal>
  )
}
