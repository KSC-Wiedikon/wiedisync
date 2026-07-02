import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { fetchAllItems } from '../../../lib/api'
import { messagingApi } from '../api/messaging'
import type { ReactionRow } from '../api/types'
import { useRealtime } from '../../../hooks/useRealtime'
import { useAuth } from '../../../hooks/useAuth'
import { messagingFeatureEnabled } from '../../../utils/messagingFeatureFlag'

const REACTION_FIELDS = ['id', 'message', 'member', 'emoji', 'created_at']
const EMPTY_ROWS: ReactionRow[] = []

type ReactionsContextValue = {
  /** Called by each rendered message so it joins the batched fetch + shared subscription. */
  register: (messageId: string) => void
  unregister: (messageId: string) => void
  /** All loaded reactions for the conversation, grouped by message id. */
  rowsByMessage: Map<string, ReactionRow[]>
  /** Optimistic toggle for one message's emoji; reconciled by refetch/realtime. */
  toggle: (messageId: string, emoji: string) => Promise<void>
  currentUserId: string | null
}

const ReactionsContext = createContext<ReactionsContextValue | null>(null)

/**
 * Conversation-level reactions store. Mount ONCE around a thread (wrapping every
 * MessageBubble/ReactionBar) so all reactions load with a single fetch
 * (`message _in [...]`) and a single realtime subscription — instead of one
 * fetch + one WebSocket subscription per message (the old N+1 in `useReactions`).
 *
 * Rendered messages register their id via `useMessageReactions`; the store keeps
 * the union of those ids and (re)fetches their reactions in one query.
 */
export function ReactionsProvider({
  conversationId,
  children,
}: {
  conversationId: string | null
  children: ReactNode
}) {
  const { user } = useAuth()
  const enabled = messagingFeatureEnabled(user?.id) && !!user?.id && !!conversationId

  const [rows, setRows] = useState<ReactionRow[]>([])
  const [ids, setIds] = useState<string[]>([])

  // Reference-counted registrations: a message id stays in `ids` while ≥1
  // ReactionBar for it is mounted (StrictMode remounts + list churn safe).
  const refCounts = useRef(new Map<string, number>())

  const register = useCallback((messageId: string) => {
    const m = refCounts.current
    const next = (m.get(messageId) ?? 0) + 1
    m.set(messageId, next)
    if (next === 1) setIds(prev => (prev.includes(messageId) ? prev : [...prev, messageId]))
  }, [])

  const unregister = useCallback((messageId: string) => {
    const m = refCounts.current
    const next = (m.get(messageId) ?? 0) - 1
    if (next <= 0) {
      m.delete(messageId)
      setIds(prev => prev.filter(x => x !== messageId))
    } else {
      m.set(messageId, next)
    }
  }, [])

  // Stable dependency + current-set ref (used by realtime + refetch).
  const idsKey = useMemo(() => [...ids].sort().join('|'), [ids])
  const idsSetRef = useRef<Set<string>>(new Set())
  idsSetRef.current = new Set(ids)

  // Guards against stale responses when the id set changes mid-flight.
  const fetchSeq = useRef(0)

  const refetch = useCallback(async () => {
    if (!enabled) { setRows([]); return }
    const list = [...idsSetRef.current]
    if (list.length === 0) { setRows([]); return }
    const mySeq = ++fetchSeq.current
    try {
      const data = await fetchAllItems<ReactionRow>('message_reactions', {
        filter: { message: { _in: list } },
        fields: REACTION_FIELDS,
      })
      if (fetchSeq.current === mySeq) setRows(data)
    } catch { /* ignore */ }
  }, [enabled])

  // One fetch per id-set change (registrations from a message list batch into
  // a single update → a single query).
  useEffect(() => { refetch() }, [refetch, idsKey])

  // Drop the previous conversation's reactions the moment we switch.
  useEffect(() => { setRows([]) }, [conversationId])

  // One subscription for the whole conversation; ignore events for messages
  // that aren't currently rendered.
  useRealtime<ReactionRow>('message_reactions', (e) => {
    if (!idsSetRef.current.has(String(e.record.message))) return
    if (e.action === 'create') {
      setRows(prev => prev.some(r => r.id === e.record.id) ? prev : [...prev, e.record])
    } else if (e.action === 'delete') {
      setRows(prev => prev.filter(r => r.id !== e.record.id))
    }
  }, undefined, !enabled)

  const toggle = useCallback(async (messageId: string, emoji: string) => {
    if (!enabled) return
    const userId = user?.id
    // Optimistic toggle so tap feels instant; realtime/refetch reconciles truth.
    setRows(prev => {
      const hasMine = prev.some(r =>
        String(r.message) === String(messageId) && r.emoji === emoji && String(r.member) === String(userId),
      )
      if (hasMine) {
        return prev.filter(r =>
          !(String(r.message) === String(messageId) && r.emoji === emoji && String(r.member) === String(userId)),
        )
      }
      return [...prev, {
        id: `optimistic-${Date.now()}-${messageId}`,
        message: String(messageId), member: String(userId ?? ''), emoji,
        created_at: new Date().toISOString(),
      }]
    })
    try {
      await messagingApi.react(messageId, { emoji })
    } finally {
      refetch()
    }
  }, [enabled, user?.id, refetch])

  const rowsByMessage = useMemo(() => {
    const m = new Map<string, ReactionRow[]>()
    for (const r of rows) {
      const key = String(r.message)
      const arr = m.get(key)
      if (arr) arr.push(r)
      else m.set(key, [r])
    }
    return m
  }, [rows])

  const value = useMemo<ReactionsContextValue>(() => ({
    register, unregister, rowsByMessage, toggle, currentUserId: user?.id ?? null,
  }), [register, unregister, rowsByMessage, toggle, user?.id])

  return createElement(ReactionsContext.Provider, { value }, children)
}

/**
 * Per-message reactions view.
 *
 * Under a {@link ReactionsProvider} (the conversation view) it reads its slice +
 * shared toggle from the store — no per-message fetch/subscription. Without a
 * provider (e.g. a thread mounted standalone) it transparently falls back to a
 * self-contained per-message fetch + subscription so reactions still work.
 * Hooks are always called; the fallback's work is gated by `fallbackEnabled` to
 * keep hook order unconditional.
 */
export function useMessageReactions(messageId: string) {
  const ctx = useContext(ReactionsContext)
  const hasProvider = ctx != null
  const { user } = useAuth()

  // Join the conversation-level store so this message is in the batched fetch.
  useEffect(() => {
    if (!ctx) return
    ctx.register(messageId)
    return () => ctx.unregister(messageId)
  }, [ctx, messageId])

  // ---- Fallback (only when NOT under a provider) ----
  const fallbackEnabled = !hasProvider && messagingFeatureEnabled(user?.id) && !!user?.id && !!messageId
  const [localRows, setLocalRows] = useState<ReactionRow[]>([])
  const msgRef = useRef<string | null>(messageId)
  msgRef.current = messageId

  const fallbackRefetch = useCallback(async () => {
    if (!fallbackEnabled || !messageId) { setLocalRows([]); return }
    try {
      const data = await fetchAllItems<ReactionRow>('message_reactions', {
        filter: { message: { _eq: messageId } },
        fields: REACTION_FIELDS,
      })
      setLocalRows(data)
    } catch { /* ignore */ }
  }, [fallbackEnabled, messageId])

  useEffect(() => { if (fallbackEnabled) fallbackRefetch() }, [fallbackEnabled, fallbackRefetch])

  useRealtime<ReactionRow>('message_reactions', (e) => {
    const mid = msgRef.current
    if (!mid || String(e.record.message) !== String(mid)) return
    if (e.action === 'create') {
      setLocalRows(prev => prev.some(r => r.id === e.record.id) ? prev : [...prev, e.record])
    } else if (e.action === 'delete') {
      setLocalRows(prev => prev.filter(r => r.id !== e.record.id))
    }
  }, undefined, !fallbackEnabled)

  const fallbackToggle = useCallback(async (emoji: string) => {
    if (!fallbackEnabled || !messageId) return
    const userId = user?.id
    setLocalRows(prev => {
      const hasMine = prev.some(r => r.emoji === emoji && String(r.member) === String(userId))
      if (hasMine) {
        return prev.filter(r => !(r.emoji === emoji && String(r.member) === String(userId)))
      }
      return [...prev, {
        id: `optimistic-${Date.now()}`,
        message: messageId, member: String(userId ?? ''), emoji,
        created_at: new Date().toISOString(),
      }]
    })
    try {
      await messagingApi.react(messageId, { emoji })
    } finally {
      fallbackRefetch()
    }
  }, [fallbackEnabled, messageId, user?.id, fallbackRefetch])

  // ---- Resolve source ----
  const rows = hasProvider ? (ctx!.rowsByMessage.get(String(messageId)) ?? EMPTY_ROWS) : localRows
  const currentUserId = hasProvider ? ctx!.currentUserId : (user?.id ?? null)

  const myReactions = useMemo(
    () => new Set(rows.filter(r => String(r.member) === String(currentUserId)).map(r => r.emoji)),
    [rows, currentUserId],
  )
  const groupedCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of rows) m.set(r.emoji, (m.get(r.emoji) ?? 0) + 1)
    return m
  }, [rows])

  const toggle = useCallback((emoji: string) => {
    if (ctx) return ctx.toggle(messageId, emoji)
    return fallbackToggle(emoji)
  }, [ctx, messageId, fallbackToggle])

  return { reactions: rows, myReactions, groupedCounts, toggle }
}
