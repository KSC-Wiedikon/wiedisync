import { useEffect, useLayoutEffect, useRef } from 'react'
import { client as directus, isAuthenticated, getActingMemberId } from '../lib/api'

type RealtimeAction = 'create' | 'update' | 'delete'

const ALL_ACTIONS: RealtimeAction[] = ['create', 'update', 'delete']

interface RealtimeEvent<T = Record<string, unknown>> {
  action: RealtimeAction
  record: T
}

/**
 * Subscribe to realtime changes on a Directus collection.
 * Silently does nothing if not authenticated or if WebSocket fails.
 * TanStack Query cache invalidation remains the primary refresh mechanism —
 * this is a bonus for instant UI updates.
 *
 * ONE SUBSCRIPTION PER ACTION — and that is not a style choice.
 *
 * This used to send `{ event: 'changes' }`, which Directus does not accept: its
 * subscribe schema allows only 'create' | 'update' | 'delete' (or the key omitted).
 * The server rejected every subscribe frame with an error, the error was swallowed
 * by the catch below, and realtime was silently dead app-wide — masked by the Query
 * invalidation fallback. The `as never` cast was what let the invalid value past
 * TypeScript. Verified against the live dev socket 2026-07-13.
 *
 * The tempting one-line fix — just omit `event` — is WRONG. With no event, Directus
 * sends an initial payload, which means it runs a full readByQuery() on the
 * collection as the subscriber. That works for `trainings`/`games`, but Members have
 * no direct read grant on `messages` (message reads go through /kscw/messaging/*), so
 * the init read is denied and the whole subscription is rejected. Probing dev:
 *
 *              event:'changes'   no event    create/update/delete
 *   messages      rejected       rejected           OK
 *   trainings     rejected          OK              OK
 *   games         rejected          OK              OK
 *
 * So: subscribe explicitly, once per action. No init read, works on every collection.
 */
export function useRealtime<T = Record<string, unknown>>(
  collection: string,
  callback: (data: RealtimeEvent<T>) => void,
  actions?: RealtimeAction[],
  /** Skip subscription (e.g. while auth is still loading) */
  disabled?: boolean,
) {
  // "Latest value" refs: the subscriptions below are set up once per collection and
  // read the current callback when a message arrives. Seeded by useRef on mount, then
  // refreshed in a layout effect — writing a ref during render is not allowed (React
  // Compiler: react-hooks/refs), and a layout effect commits the new value in the same
  // synchronous commit the render belongs to, so no post-commit code (including the
  // async message loop) can ever observe a stale value.
  const callbackRef = useRef(callback)
  useLayoutEffect(() => {
    callbackRef.current = callback
  })

  // `actions` is typically an inline array literal, so a new identity every render —
  // depending on it directly would tear down and rebuild the sockets on each render.
  // Serialise it into a stable primitive for the dependency array instead.
  const actionKey = (actions ?? ALL_ACTIONS).join(',')

  useEffect(() => {
    // Skip if not authenticated or explicitly disabled (auth still loading)
    //
    // ⚠ Also skipped while a household guardian is acting as one of her members
    // (migration 348). The WebSocket handshake authenticates from the session
    // COOKIE and cannot be told about the acting header, so the socket would
    // silently hold the guardian's own accountability and Directus would filter
    // out every frame belonging to the child. That looks identical to "nothing
    // is happening", which is worse than being honestly off: the query client
    // compensates with refetch-on-focus while acting.
    if (disabled || getActingMemberId() != null || !isAuthenticated()) return

    const wanted = actionKey.split(',') as RealtimeAction[]
    const cleanups: Array<() => void> = []
    let cancelled = false

    const subscribeTo = async (action: RealtimeAction) => {
      try {
        // Promise.resolve wraps a possible sync throw from the SDK (e.g. "No token").
        const { subscription, unsubscribe } = await Promise.resolve(
          directus.subscribe(collection, { event: action }),
        )

        // Unmounted while connecting — unsubscribe may throw on an already-closed socket.
        if (cancelled) { try { unsubscribe() } catch { /* socket already closed */ } return }
        cleanups.push(unsubscribe)

        for await (const message of subscription) {
          if (cancelled) break
          const event = message as unknown as { event?: string; data?: T[] }
          // The 'init' frame acknowledges the subscription and carries no rows for an
          // event-scoped subscribe; only act on the actual change frames.
          if (!event.data) continue
          for (const record of event.data) {
            callbackRef.current({ action, record })
          }
        }
      } catch {
        // Socket failed or the iterator ended — the app works fine without realtime.
      }
    }

    for (const action of wanted) void subscribeTo(action)

    return () => {
      cancelled = true
      // Best-effort unsubscribe on unmount — a closed socket must not throw during cleanup.
      for (const off of cleanups) {
        try { off() } catch { /* socket already closed */ }
      }
    }
  }, [collection, disabled, actionKey])
}
