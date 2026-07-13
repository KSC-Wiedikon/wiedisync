import { useEffect, useRef } from 'react'
import { client as directus, isAuthenticated } from '../lib/api'

type RealtimeAction = 'create' | 'update' | 'delete'

interface RealtimeEvent<T = Record<string, unknown>> {
  action: RealtimeAction
  record: T
}

/**
 * Subscribe to realtime changes on a Directus collection.
 * Silently does nothing if not authenticated or if WebSocket fails.
 * Uses TanStack Query cache invalidation as primary refresh mechanism —
 * this is a bonus for instant UI updates.
 */
export function useRealtime<T = Record<string, unknown>>(
  collection: string,
  callback: (data: RealtimeEvent<T>) => void,
  actions?: RealtimeAction[],
  /** Skip subscription (e.g. while auth is still loading) */
  disabled?: boolean,
) {
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  const actionsRef = useRef(actions)
  actionsRef.current = actions

  useEffect(() => {
    // Skip if not authenticated or explicitly disabled (auth still loading)
    if (disabled || !isAuthenticated()) return

    let cleanup: (() => void) | undefined
    let cancelled = false

    const setup = async () => {
      try {
        // Wrap in Promise.resolve to catch sync throws from the SDK (e.g. "No token")
        const { subscription, unsubscribe } = await Promise.resolve(
          directus.subscribe(collection, { event: 'changes' as never })
        )

        // Unmounted while connecting — unsubscribe may throw on an already-closed socket; nothing to do.
        if (cancelled) { try { unsubscribe() } catch { /* socket already closed */ } return }
        cleanup = unsubscribe

        ;(async () => {
          try {
            for await (const message of subscription) {
              if (cancelled) break
              const event = message as unknown as { event: string; data: T[] }
              if (!event.data) continue

              let action: RealtimeAction = 'update'
              if (event.event === 'create') action = 'create'
              else if (event.event === 'delete') action = 'delete'

              if (!actionsRef.current || actionsRef.current.includes(action)) {
                for (const record of event.data) {
                  callbackRef.current({ action, record })
                }
              }
            }
          } catch {
            // Subscription iterator ended or errored — ignore
          }
        })()
      } catch {
        // WebSocket connection failed — app works fine without realtime
      }
    }

    setup()

    return () => {
      cancelled = true
      // Best-effort unsubscribe on unmount — a failed/closed socket must not throw during cleanup.
      try { cleanup?.() } catch { /* socket already closed */ }
    }
  }, [collection, disabled])
}
