import { createContext, useContext } from 'react'
import type { useConversations } from './hooks/useConversations'

export type ConversationsContextValue = ReturnType<typeof useConversations>

/**
 * Context for the app-wide conversation-list store. The provider COMPONENT that
 * fills it lives in `ConversationsStoreProvider.tsx` — a module may export either
 * React components or non-components, not both (react-refresh / Fast Refresh).
 */
export const ConversationsContext = createContext<ConversationsContextValue | null>(null)

/**
 * Read the shared conversation-list store. Must be used within a
 * ConversationsProvider (mounted in Layout for the whole authenticated app).
 * Returns the exact shape of `useConversations`:
 * `{ conversations, isLoading, error, refetch, markRead, toggleMute }`.
 */
export function useConversationsContext(): ConversationsContextValue {
  const ctx = useContext(ConversationsContext)
  if (!ctx) {
    throw new Error('useConversationsContext must be used within a ConversationsProvider')
  }
  return ctx
}
