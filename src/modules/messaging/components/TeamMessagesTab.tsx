import { useTranslation } from 'react-i18next'
import type { ConversationSummary } from '../api/types'
import ThreadView from './ThreadView'
import MessagingDisabledBanner from './MessagingDisabledBanner'
import ConsentModal from './ConsentModal'

type Props = {
  conv: ConversationSummary | null
  teamChatEnabled: boolean
  isLoading: boolean
  onMarkRead: (id: string) => void
  onToggleMute: (id: string) => void
}

export default function TeamMessagesTab({ conv, teamChatEnabled, isLoading, onMarkRead, onToggleMute }: Props) {
  const { t } = useTranslation('messaging')

  if (!teamChatEnabled) return <div className="p-4"><MessagingDisabledBanner /></div>
  // Participation is gated by the parent section (TeamMessagesSection hides the
  // whole section for non-participants), so this only renders while the
  // conversation list is still loading.
  if (!conv) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        {isLoading ? t('loading') : t('notTeamMember')}
      </div>
    )
  }

  return (
    <>
      <ThreadView conversation={conv} onMarkRead={onMarkRead} onToggleMute={onToggleMute} />
      <ConsentModal />
    </>
  )
}
