import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../../hooks/useAuth'
import { useConversation } from '../hooks/useConversation'
import { useConversationMembers } from '../hooks/useConversationMembers'
import ConversationThread from './ConversationThread'
import MessageComposer from './MessageComposer'
import ReportMessageDialog from './ReportMessageDialog'
import GroupDmMenu from './GroupDmMenu'
import Avatar, { AvatarGroup } from './Avatar'
import { Bell, BellOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { disambiguateFirstNames, memberDisplayName, memberFirstName } from '../../../utils/relations'
import type { ConversationSummary, MessageRow } from '../api/types'

// The conversation-member rows carry nullable first_name/last_name and don't yet
// declare `nickname`. These adapters normalise the nulls so the shared UI name
// helpers (which type first_name as string) accept them — and surface a member's
// chosen nickname the moment the members endpoint starts returning one.
type NameFields = { first_name?: string | null; last_name?: string | null; nickname?: string | null }
const displayNameOf = (m: NameFields): string =>
  memberDisplayName({ nickname: m.nickname ?? null, first_name: m.first_name ?? undefined, last_name: m.last_name ?? undefined })
const firstNameOf = (m: NameFields): string =>
  memberFirstName({ nickname: m.nickname ?? null, first_name: m.first_name ?? undefined })

type Props = {
  conversation: ConversationSummary
  onMarkRead: (id: string) => void
  onToggleMute: (id: string) => void
  /** Optional content rendered above the thread (e.g. pending-request banner). */
  header?: ReactNode
  /** Disable the composer (e.g. declined request, opted out). */
  composerDisabled?: boolean
  /** Custom title shown in the compact header bar. Falls back to i18n threadTitle. */
  title?: string
}

export default function ThreadView({ conversation, onMarkRead, onToggleMute, header, composerDisabled, title }: Props) {
  const { t } = useTranslation('messaging')
  const { user, coachTeamIds, teamResponsibleIds } = useAuth()
  const { messages, isLoading, send, sendError, editMessage } = useConversation(conversation.id)
  const [reportingMessage, setReportingMessage] = useState<MessageRow | null>(null)

  const isGroupDm = conversation.type === 'group_dm'
  const isDmLike = conversation.type === 'dm' || conversation.type === 'dm_request'
  const needsMembers = isGroupDm || isDmLike

  const { members, loading: membersLoading, refetch: refetchMembers } = useConversationMembers(
    needsMembers ? conversation.id : null,
  )

  // One gate for the whole page so header + thread + composer arrive together
  // instead of filling in at different times.
  const isReady = !isLoading && (!needsMembers || !membersLoading)

  const isTeamModerator = conversation.type === 'team' && conversation.team != null && (
    coachTeamIds.includes(String(conversation.team)) ||
    teamResponsibleIds.includes(String(conversation.team))
  )

  useEffect(() => {
    if (conversation.id && conversation.unread_count > 0) onMarkRead(conversation.id)
  }, [conversation.id, conversation.unread_count, onMarkRead])

  const displayTitle = (() => {
    if (title) return title
    if (isGroupDm) {
      if (conversation.title) return conversation.title
      if (members.length === 0) return t('groupChat.defaultName')
      // Disambiguate so two "Luca"s read "Luca C." instead of "Luca, …, Luca"
      const labels = disambiguateFirstNames(members)
      return members
        .map(m => labels.get(String(m.id)) ?? firstNameOf(m))
        .filter(Boolean)
        .slice(0, 3)
        .join(', ')
    }
    if (isDmLike) {
      const other = members.find(m => String(m.id) !== String(user?.id))
      if (other) return displayNameOf(other) || t('threadTitle')
    }
    return t('threadTitle')
  })()

  const peer = isDmLike ? members.find(m => String(m.id) !== String(user?.id)) : null
  const groupAvatars = isGroupDm
    ? members.map(m => ({
        src: m.photo,
        alt: displayNameOf(m) || '—',
      }))
    : []

  if (!isReady) {
    return (
      <div className="flex flex-col h-full min-h-[60vh] md:min-h-[500px] items-center justify-center">
        <div
          className="h-6 w-6 rounded-full border-2 border-muted border-t-primary animate-spin"
          role="status"
          aria-label={t('loading')}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-[60vh] md:min-h-[500px]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {peer && <Avatar src={peer.photo} alt={displayTitle} size="sm" />}
          {isGroupDm && groupAvatars.length > 0 && (
            <AvatarGroup items={groupAvatars} max={3} size="sm" />
          )}
          <h3 className="font-semibold text-sm truncate">{displayTitle}</h3>
          {isGroupDm && members.length > 0 && (
            <span className="text-[10px] text-muted-foreground">({members.length})</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost" size="sm"
            onClick={() => onToggleMute(conversation.id)}
            aria-label={conversation.muted ? t('unmute') : t('mute')}
            title={conversation.muted ? t('unmute') : t('mute')}
            className="min-h-11"
          >
            {conversation.muted ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
          </Button>
          {isGroupDm && (
            <GroupDmMenu
              conversationId={conversation.id}
              currentMemberIds={members.map(m => m.id)}
              onMemberAdded={refetchMembers}
            />
          )}
        </div>
      </div>
      {header}
      <ConversationThread
        messages={messages}
        currentMemberId={user?.id ?? null}
        isLoading={isLoading}
        isTeamModerator={isTeamModerator}
        onReport={setReportingMessage}
        onEdit={editMessage}
      />
      <MessageComposer onSend={send} disabled={composerDisabled} conversationId={conversation.id} />
      {sendError && (
        <div className="text-xs text-destructive px-3 pb-2">{t('failedToSend')}</div>
      )}
      {reportingMessage && (
        <ReportMessageDialog
          message={reportingMessage}
          onClose={() => setReportingMessage(null)}
        />
      )}
    </div>
  )
}
