import { useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../../hooks/useAuth'
import { useConversationsContext } from '../ConversationsProvider'
import { useMessageRequests } from '../hooks/useMessageRequests'
import { useMemberDisplayNames } from '../hooks/useMemberDisplayNames'
import { messagingFeatureEnabled } from '../../../utils/messagingFeatureFlag'
import ThreadView from '../components/ThreadView'
import { ReactionsProvider } from '../hooks/useReactions'
import RequestCard from '../components/RequestCard'
import ConsentModal from '../components/ConsentModal'
import { resolveRequestHeader } from '../utils/resolveRequestHeader'
import { useReportPageLoading } from '../../../hooks/usePageReady'
import { Button } from '@/components/ui/button'
import { ChevronLeft } from 'lucide-react'

function BackToInbox() {
  const { t } = useTranslation('messaging')
  return (
    <div className="mb-2">
      <Button asChild variant="ghost" size="sm">
        <Link to="/inbox">
          <ChevronLeft className="h-4 w-4 mr-1" />
          {t('backToInbox')}
        </Link>
      </Button>
    </div>
  )
}

export default function ConversationPage() {
  const { t } = useTranslation('messaging')
  const { conversationId = '' } = useParams<{ conversationId: string }>()
  const { user } = useAuth()
  const { conversations, markRead, toggleMute } = useConversationsContext()
  const { requests, accept, decline } = useMessageRequests()

  const conv = useMemo(
    () => conversations.find(c => c.id === conversationId) ?? null,
    [conversations, conversationId],
  )
  const names = useMemberDisplayNames(conv?.other_member ? [conv.other_member] : [])
  const otherName = conv?.other_member ? (names.get(conv.other_member) ?? '—') : (conv?.title ?? '—')

  const request = useMemo(
    () => requests.find(r => r.conversation === conversationId) ?? null,
    [requests, conversationId],
  )

  const header = resolveRequestHeader(
    conv ?? { type: 'dm', request_status: null },
    user?.id ?? null,
    request,
  )

  // Report to app boot gate — see usePageReady.tsx. The initial full-page
  // conversation spinner only shows when messaging is enabled, the user exists,
  // and the conversation hasn't resolved yet — report exactly that condition.
  useReportPageLoading(messagingFeatureEnabled(user?.id) && !!user && !conv)

  if (!messagingFeatureEnabled(user?.id)) return null
  if (!user) return null
  if (!conv) {
    return (
      <div className="max-w-2xl mx-auto p-4">
        <BackToInbox />
      </div>
    )
  }

  const composerDisabled =
    (conv.type === 'dm_request' && conv.request_status !== 'pending') ||
    user.communications_dm_enabled !== true

  const bannerNode =
    header.kind === 'action-required'
      ? <RequestCard request={header.request} senderName={otherName} onAccept={accept} onDecline={decline} />
      : header.kind === 'awaiting-their-response'
        ? <div className="border-b border-border bg-muted/50 p-3 text-xs text-muted-foreground">
            {t('requestAwaitingResponse')}
          </div>
        : undefined

  return (
    <div className="max-w-2xl mx-auto">
      <BackToInbox />
      <ReactionsProvider conversationId={conv.id}>
        <ThreadView
          conversation={conv}
          onMarkRead={markRead}
          onToggleMute={toggleMute}
          title={otherName}
          composerDisabled={composerDisabled}
          header={bannerNode}
        />
      </ReactionsProvider>
      <ConsentModal />
    </div>
  )
}
