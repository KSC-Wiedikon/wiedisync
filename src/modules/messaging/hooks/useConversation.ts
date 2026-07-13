import { useCallback, useEffect, useRef, useState } from 'react'
import { messagingApi } from '../api/messaging'
import type { MessageRow } from '../api/types'
import { useRealtime } from '../../../hooks/useRealtime'
import { useAuth } from '../../../hooks/useAuth'
import { messagingFeatureEnabled } from '../../../utils/messagingFeatureFlag'
import { useBlocks } from './useBlocks'

type UseConversationOptions = {
  /** Sender IDs whose messages must not appear in the thread. Defaults to useBlocks().blockedMemberIds in Plan 03; override only for tests. */
  blockedSenderIds?: string[]
}

/**
 * Fetch + keep up-to-date the messages in one conversation.
 * Realtime appends new messages sent to this conversation, minus blocked senders.
 */
export function useConversation(
  conversationId: string | null,
  { blockedSenderIds }: UseConversationOptions = {},
) {
  const { user } = useAuth()
  const { blockedMemberIds } = useBlocks()
  const effectiveBlocked = blockedSenderIds ?? blockedMemberIds
  const enabled = messagingFeatureEnabled(user?.id) && !!user?.id && !!conversationId
  const [messages, setMessages] = useState<MessageRow[]>([])
  // Initial mount: we know the effect will fire a refetch in the next tick.
  // Start "loading" so the first render doesn't briefly look "ready with 0 messages".
  const [isLoading, setIsLoading] = useState(true)
  const [sendError, setSendError] = useState<Error | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const convIdRef = useRef(conversationId)
  const blockedRef = useRef(new Set(effectiveBlocked))
  // "Latest value" refs — written after commit, never during render. Declared
  // BEFORE the refetch effect below so they are always current by the time it
  // (or any realtime callback, which can only fire post-commit) reads them.
  useEffect(() => { convIdRef.current = conversationId })
  useEffect(() => { blockedRef.current = new Set(effectiveBlocked) })
  // Monotonic fetch counter — any resolver whose seq no longer matches is stale.
  const fetchSeqRef = useRef(0)

  const refetch = useCallback(async () => {
    if (!enabled || !conversationId) { setMessages([]); setIsLoading(false); return }
    const mySeq = ++fetchSeqRef.current
    const myConvId = conversationId
    setIsLoading(true)
    try {
      const { messages, has_more } = await messagingApi.listMessages(conversationId, { limit: 50 })
      // Stale: a newer fetch started (conv switch or concurrent refetch) — bail.
      if (fetchSeqRef.current !== mySeq || convIdRef.current !== myConvId) return
      // Merge: keep realtime messages that arrived during the fetch and aren't
      // in the server snapshot. Client-side block filter stays until Plan 03.
      setMessages(prev => {
        const filtered = messages.filter(m => !blockedRef.current.has(String(m.sender)))
        const ids = new Set(filtered.map(m => m.id))
        const extras = prev.filter(m => !ids.has(m.id) && !blockedRef.current.has(String(m.sender)))
        if (extras.length === 0) return filtered
        return [...filtered, ...extras].sort((a, b) =>
          String(a.created_at) < String(b.created_at) ? -1 : String(a.created_at) > String(b.created_at) ? 1 : 0,
        )
      })
      setHasMore(has_more)
    } finally {
      if (fetchSeqRef.current === mySeq) setIsLoading(false)
    }
  }, [conversationId, enabled])

  useEffect(() => {
    // Clear prior conversation's thread immediately so the switch doesn't flash
    // stale messages while the new fetch is in flight.
    setMessages([])
    setHasMore(false)
    refetch()
  }, [refetch])

  useRealtime<MessageRow>('messages', (e) => {
    if (convIdRef.current !== e.record.conversation) return
    if (blockedRef.current.has(String(e.record.sender))) return
    if (e.action === 'create') {
      setMessages(prev => {
        if (prev.some(m => m.id === e.record.id)) return prev   // idempotent on self-echo
        return [...prev, e.record]
      })
    } else if (e.action === 'update') {
      // Directus realtime `update` payloads contain only changed fields — merge, don't replace.
      setMessages(prev => prev.map(m => m.id === e.record.id ? { ...m, ...e.record } : m))
    } else if (e.action === 'delete') {
      setMessages(prev => prev.filter(m => m.id !== e.record.id))
    }
  }, undefined, !enabled)

  const send = useCallback(async (body: string) => {
    if (!enabled || !conversationId) return
    const trimmed = body.trim()
    if (!trimmed) return
    setSendError(null)
    try {
      const row = await messagingApi.send({ conversation: conversationId, type: 'text', body: trimmed })
      // Optimistic: append immediately; the realtime echo is deduped by id above
      setMessages(prev => prev.some(m => m.id === row.id) ? prev : [...prev, row])
    } catch (e) {
      setSendError(e as Error)
      throw e
    }
  }, [conversationId, enabled])

  const editMessage = useCallback(async (id: string, body: string) => {
    const trimmed = body.trim()
    if (!trimmed) return
    const res = await messagingApi.edit(id, { body: trimmed })
    setMessages(prev => prev.map(m =>
      m.id === id
        ? { ...m, body: res.body, edited_at: res.edited_at, original_body: res.original_body ?? m.original_body ?? null }
        : m,
    ))
  }, [])

  return { messages, isLoading, sendError, hasMore, refetch, send, editMessage }
}
