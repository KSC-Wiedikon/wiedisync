import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MessageRow } from '../api/types'
import Avatar from './Avatar'
import EditMessageInline from './EditMessageInline'
import MessageActions from './MessageActions'
import ReactionBar from './ReactionBar'
import { messagingApi } from '../api/messaging'
import { formatTimeZurich } from '../../../utils/dateHelpers'
import PollMessage from './PollMessage'
import { useConfirm } from '../../../components/ConfirmProvider'

type Props = {
  message: MessageRow
  isOwn: boolean
  currentMemberId: string | null
  isTeamModerator: boolean
  onReport?: (message: MessageRow) => void
  onEdit?: (id: string, body: string) => Promise<void>
}

export default function MessageBubble({ message, isOwn, currentMemberId, isTeamModerator, onReport, onEdit }: Props) {
  const { t } = useTranslation('messaging')
  const confirm = useConfirm()
  const [editing, setEditing] = useState(false)
  const [showOriginal, setShowOriginal] = useState(false)
  const timestamp = message.created_at ? formatTimeZurich(message.created_at) : ''

  const onDelete = async () => {
    if (!(await confirm({ message: t('confirmDelete'), danger: true }))) return
    try { await messagingApi.delete(message.id) } catch { /* toast later */ }
  }

  // Tombstone
  if (message.deleted_at != null) {
    return (
      <div className={`flex max-w-[85%] gap-2 ${isOwn ? 'self-start' : 'self-end flex-row-reverse'}`}>
        {isOwn && <div className="w-6 shrink-0" />}
        <div className="rounded-2xl px-3 py-2 text-xs italic text-muted-foreground bg-muted">
          {t('messageDeleted')}
        </div>
      </div>
    )
  }

  const avatar = !isOwn ? (
    <Avatar
      src={message.sender_photo ?? null}
      alt={message.sender_name ?? '—'}
      size="xs"
      className="mt-0.5"
    />
  ) : null

  return (
    <div className={`group flex gap-2 max-w-[85%] ${isOwn ? 'self-start' : 'self-end flex-row-reverse'}`}>
      {avatar}
      <div className={`flex flex-col min-w-0 ${isOwn ? 'items-start' : 'items-end'}`}>
      {!isOwn && message.sender_name && (
        <div className="text-xs text-muted-foreground mb-0.5 px-2">{message.sender_name}</div>
      )}
      <div className={`
        rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words
        ${isOwn ? 'bg-muted text-foreground rounded-bl-sm'
                : 'bg-primary text-primary-foreground rounded-br-sm'}
      `}>
        {message.type === 'poll' && message.poll ? (
          <PollMessage pollId={message.poll} />
        ) : editing && message.body != null ? (
          <EditMessageInline
            messageId={message.id}
            initialBody={message.body}
            onDone={() => setEditing(false)}
            onSave={onEdit}
          />
        ) : (
          message.body
        )}
      </div>
      <div className="relative flex items-center gap-1 text-[10px] text-muted-foreground mt-0.5 px-2">
        <span>{timestamp}</span>
        {message.edited_at != null && (
          message.original_body
            ? (
              <button
                type="button"
                className="italic underline decoration-dotted underline-offset-2 hover:text-foreground focus:text-foreground"
                onClick={() => setShowOriginal(s => !s)}
                aria-label={t('showOriginal')}
                title={t('showOriginal')}
              >· {t('edited')}</button>
            )
            : <span className="italic">· {t('edited')}</span>
        )}
        <MessageActions
          message={message}
          currentMemberId={currentMemberId}
          isTeamModerator={isTeamModerator}
          isOwn={isOwn}
          onEdit={() => setEditing(true)}
          onDelete={onDelete}
          onReport={() => onReport?.(message)}
        />
        {showOriginal && message.original_body && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowOriginal(false)} />
            <div className={`absolute top-5 z-50 min-w-[180px] max-w-[85vw] rounded-md border border-border bg-background text-foreground shadow-md p-2 text-xs ${isOwn ? 'left-0' : 'right-0'}`}>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                {t('originalMessage')}
              </div>
              <div className="whitespace-pre-wrap break-words">{message.original_body}</div>
            </div>
          </>
        )}
      </div>
      {message.type !== 'poll' && <ReactionBar messageId={message.id} />}
      </div>
    </div>
  )
}
