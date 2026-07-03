import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { MessageRow } from '../api/types'
import MessageBubble from './MessageBubble'
import LoadingSpinner from '@/components/LoadingSpinner'

type Props = {
  messages: MessageRow[]
  currentMemberId: string | null
  isLoading: boolean
  isTeamModerator: boolean
  onReport?: (message: MessageRow) => void
  onEdit?: (id: string, body: string) => Promise<void>
}

export default function ConversationThread({ messages, currentMemberId, isLoading, isTeamModerator, onReport, onEdit }: Props) {
  const { t } = useTranslation('messaging')
  const containerRef = useRef<HTMLDivElement>(null)
  const didInitialScroll = useRef(false)

  // Keep the thread pinned to the newest message. Scroll the message container
  // itself (via scrollTop) rather than scrollIntoView, which could scroll the
  // whole page. The first open jumps instantly to the bottom; later incoming
  // messages animate smoothly.
  useEffect(() => {
    const container = containerRef.current
    if (!container || messages.length === 0) return
    container.scrollTo({
      top: container.scrollHeight,
      behavior: didInitialScroll.current ? 'smooth' : 'auto',
    })
    didInitialScroll.current = true
  }, [messages.length])

  if (isLoading && messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <LoadingSpinner />
      </div>
    )
  }

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground p-6 text-center">
        {t('emptyThread')}
      </div>
    )
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-2">
      {messages.map(m => (
        <MessageBubble
            key={m.id}
            message={m}
            isOwn={currentMemberId != null && String(m.sender) === String(currentMemberId)}
            currentMemberId={currentMemberId}
            isTeamModerator={isTeamModerator}
            onReport={onReport}
            onEdit={onEdit}
          />
      ))}
    </div>
  )
}
