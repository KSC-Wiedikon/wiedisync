import type { ReactNode } from 'react'
import { useNotifications } from '../hooks/useNotifications'
import { NotificationsContext } from '../hooks/NotificationsContext'

/**
 * NotificationsProvider — the app-wide notification store component.
 *
 * Mount ONCE around the authenticated shell. Before this, `useNotifications()`
 * was called independently by Layout (the bell), HomePage (the news feed) and
 * NewsArchivePage — and HomePage renders inside Layout's Outlet, so a member on
 * the home page ran the hook TWICE concurrently: two `fetchItems` calls (raw
 * fetch, so no TanStack dedup) and two sets of realtime subscriptions.
 *
 * The wasted request was never the real cost — the filter is `member = me` with
 * `limit: 30` against an indexed column. The bug users could actually see was
 * that the two instances held SEPARATE state: marking a news item read in the
 * feed did not decrement the bell badge, because nothing connected them except a
 * realtime round-trip that does not arrive when the socket is down.
 *
 * `useNotifications` is called unconditionally here so hook order is stable
 * regardless of auth state; the hook itself no-ops without a signed-in user.
 */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const value = useNotifications()
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>
}
