import { useConversationsContext } from '../ConversationsProvider'

/** Total unread across all non-muted conversations. 0 when the feature is off. */
export function useUnreadTotal(): number {
  const { conversations } = useConversationsContext()
  return conversations.reduce((sum, c) => sum + (c.muted ? 0 : c.unread_count), 0)
}
