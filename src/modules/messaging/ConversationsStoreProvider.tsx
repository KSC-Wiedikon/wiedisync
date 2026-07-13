/**
 * ConversationsProvider — the app-wide conversation-list store component.
 *
 * Split out of `ConversationsProvider.tsx` (which keeps the context + the
 * `useConversationsContext` hook) so neither module exports both a React
 * component and non-component values — required by
 * react-refresh/only-export-components (Fast Refresh).
 *
 * Mount ONCE inside the authenticated shell (Layout) so the caller's conversation
 * summaries load with a single `listConversations()` fetch and a single `messages`
 * realtime subscription — shared by the inbox, the thread page, team-chat sections,
 * and the always-mounted TopNav unread badge. Previously each of those consumers
 * called `useConversations()` directly, so the fetch + WebSocket subscription ran
 * 2+ times concurrently.
 *
 * `useConversations` (and the `useAuth`/`useBlocks` it calls) is invoked
 * unconditionally here, so hook order is stable regardless of feature flags or
 * auth state — the hook itself no-ops (empty list, `enabled = false`) when there's
 * no signed-in user.
 */

import type { ReactNode } from 'react'
import { useConversations } from './hooks/useConversations'
import { ConversationsContext } from './ConversationsProvider'

export function ConversationsProvider({
  children,
  blockedSenderIds,
}: {
  children: ReactNode
  /**
   * Optional override forwarded to `useConversations` to filter realtime updates
   * from blocked senders. When omitted, the hook falls back to
   * `useBlocks().blockedMemberIds` — the same default every consumer relied on
   * before this was lifted to a shared provider.
   */
  blockedSenderIds?: string[]
}) {
  const value = useConversations({ blockedSenderIds })
  return (
    <ConversationsContext.Provider value={value}>
      {children}
    </ConversationsContext.Provider>
  )
}
