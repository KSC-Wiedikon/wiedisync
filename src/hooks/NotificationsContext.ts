import { createContext, useContext } from 'react'
import type { useNotifications } from './useNotifications'

export type NotificationsContextValue = ReturnType<typeof useNotifications>

/**
 * Context for the app-wide notification store. The provider COMPONENT that fills
 * it lives in `src/components/NotificationsStoreProvider.tsx` — a module may
 * export either React components or non-components, not both (react-refresh /
 * Fast Refresh). Same split as `ConversationsProvider` / `ConversationsStoreProvider`.
 */
export const NotificationsContext = createContext<NotificationsContextValue | null>(null)

/**
 * Read the shared notification store. Must be used within a NotificationsProvider
 * (mounted around Layout, so the whole authenticated app shares ONE fetch and ONE
 * set of realtime subscriptions).
 */
export function useNotificationsContext(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext)
  if (!ctx) {
    throw new Error('useNotificationsContext must be used within a NotificationsProvider')
  }
  return ctx
}
