import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../../hooks/useAuth'
import { useConversations } from '../hooks/useConversations'
import ThreadView from './ThreadView'
import MessagingDisabledBanner from './MessagingDisabledBanner'
import ConsentModal from './ConsentModal'

type Props = { teamId: string }

export default function TeamMessagesTab({ teamId }: Props) {
  const { t } = useTranslation('messaging')
  const { user } = useAuth()
  const { conversations, isLoading, markRead, toggleMute } = useConversations()
  const conv = useMemo(
    () => conversations.find(c => c.type === 'team' && String(c.team) === String(teamId)) ?? null,
    [conversations, teamId],
  )

  const teamChatEnabled = user?.communications_team_chat_enabled === true
  if (!teamChatEnabled) return <div className="p-4"><MessagingDisabledBanner /></div>
  // Distinguish "still loading" from "loaded but the caller isn't a participant
  // of this team's chat" (e.g. an admin/coach viewing a team they're not on) —
  // otherwise the latter sat on the spinner forever.
  if (!conv) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        {isLoading ? t('loading') : t('notTeamMember')}
      </div>
    )
  }

  return (
    <>
      <ThreadView conversation={conv} onMarkRead={markRead} onToggleMute={toggleMute} />
      <ConsentModal />
    </>
  )
}
