import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { useConversationsContext } from '../ConversationsProvider'
import { useMessageRequests } from '../hooks/useMessageRequests'
import ConversationList from '../components/ConversationList'
import InboxEmptyState from '../components/InboxEmptyState'
import NewMessageDialog from '../components/NewMessageDialog'
import ConsentModal from '../components/ConsentModal'
import { Button } from '@/components/ui/button'
import { messagingFeatureEnabled } from '../../../utils/messagingFeatureFlag'
import { useAuth } from '../../../hooks/useAuth'
import { useReportPageLoading } from '../../../hooks/usePageReady'

export default function InboxPage() {
  const { t } = useTranslation('messaging')
  const { user } = useAuth()
  const { conversations, isLoading: conversationsLoading } = useConversationsContext()
  const { requests, isLoading: requestsLoading } = useMessageRequests()
  const [newMsgOpen, setNewMsgOpen] = useState(false)

  // Report to the app boot gate — see usePageReady.tsx. Runs before the
  // feature-flag <Navigate> guard so the hook fires on every render (rules-of-hooks).
  useReportPageLoading(conversationsLoading || requestsLoading)

  if (!messagingFeatureEnabled(user?.id)) return <Navigate to="/" replace />

  // Inbox shows DMs + dm_requests + group_dms. Team chats still live on team pages.
  const inbox = conversations.filter(
    c => c.type === 'dm' || c.type === 'dm_request' || c.type === 'group_dm',
  )
  const pendingRequests = inbox.filter(c => c.type === 'dm_request' && c.request_status === 'pending')
  const dms = inbox.filter(c => c.type === 'dm')
  const groups = inbox.filter(c => c.type === 'group_dm')

  const hasAnything = pendingRequests.length > 0 || dms.length > 0 || groups.length > 0 || requests.length > 0

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-4 gap-2">
        <h1 className="text-lg font-semibold text-foreground">{t('inboxTitle')}</h1>
        <Button size="sm" onClick={() => setNewMsgOpen(true)} className="min-h-11">
          <Plus className="h-4 w-4 mr-1" />
          {t('newMessage.button')}
        </Button>
      </div>

      {!hasAnything && <InboxEmptyState />}

      {pendingRequests.length > 0 && (
        <section className="mb-6">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            {t('requestsSectionTitle')}
          </h2>
          <ConversationList conversations={pendingRequests} />
        </section>
      )}

      {dms.length > 0 && (
        <section className="mb-6">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            {t('dmsSectionTitle')}
          </h2>
          <ConversationList conversations={dms} />
        </section>
      )}

      {groups.length > 0 && (
        <section className="mb-6">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            {t('groupsSectionTitle')}
          </h2>
          <ConversationList conversations={groups} />
        </section>
      )}

      <NewMessageDialog open={newMsgOpen} onOpenChange={setNewMsgOpen} />
      <ConsentModal />
    </div>
  )
}
