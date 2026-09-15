import { useTranslation } from 'react-i18next'
import type { ConversationSummary } from '../api/types'
import ThreadView from './ThreadView'
import { ReactionsProvider } from '../hooks/useReactions'
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

  // ⚠ `ReactionsProvider` is not optional decoration. Without it every
  // `ReactionBar` falls back to its own per-message fetch + realtime subscription
  // (`useReactions.ts` — the fallback branch), and `ConversationThread` renders the
  // whole page of 50 messages unwindowed. `useRealtime` with no `actions` argument
  // opens all three, so an un-provided team chat at full page size costs 50 serial
  // `GET /items/message_reactions` plus 150 subscribe frames on open.
  // The team-chat path (TeamDetail → TeamMessagesSection → here → ThreadView) was
  // the only one of the two ReactionBar routes with no provider; `ConversationPage`
  // has always had one. Harmless today — the club has 6 messages total — which is
  // exactly why it needs fixing before team chat gets used.
  return (
    <>
      <ReactionsProvider conversationId={conv.id}>
        <ThreadView conversation={conv} onMarkRead={onMarkRead} onToggleMute={onToggleMute} />
      </ReactionsProvider>
      <ConsentModal />
    </>
  )
}
