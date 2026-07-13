import { useCallback, useEffect, useRef, useState } from 'react'
import { messagingApi, type ConversationMemberRow } from '../api/messaging'

export function useConversationMembers(conversationId: string | null | undefined) {
  const [members, setMembers] = useState<ConversationMemberRow[]>([])
  // Initial mount: we know the effect will fire a refetch. Start "loading" so
  // the first render doesn't look "ready with 0 members" for a frame.
  const [loading, setLoading] = useState(!!conversationId)
  const [error, setError] = useState<string | null>(null)
  const fetchSeqRef = useRef(0)

  // The request itself. Every state write lives in a promise callback, so this
  // is safe to call straight from an effect.
  const load = useCallback((convId: string) => {
    const mySeq = ++fetchSeqRef.current
    return messagingApi.listConversationMembers(convId).then(
      (data) => {
        // Stale: conversation switched or concurrent refetch — bail.
        if (fetchSeqRef.current !== mySeq) return
        setMembers(data.members)
        setLoading(false)
      },
      () => {
        if (fetchSeqRef.current !== mySeq) return
        setError('fetch_failed')
        setMembers([])
        setLoading(false)
      },
    )
  }, [])

  // Manual refetch — unchanged semantics (reset + loading flag, then load).
  const refetch = useCallback(async () => {
    if (!conversationId) { setMembers([]); setLoading(false); return }
    setLoading(true)
    setError(null)
    await load(conversationId)
  }, [conversationId, load])

  // Conversation-driven load. The reset half of the old effect ("clear prior
  // members so a switch doesn't flash the old roster", raise loading, clear
  // error) now runs during render, so the effect body writes no state
  // synchronously. On mount prev === current, and the initial state already
  // matches what the old effect wrote, so the mount pass is unchanged.
  const [prevConvId, setPrevConvId] = useState(conversationId)
  if (prevConvId !== conversationId) {
    setPrevConvId(conversationId)
    setMembers([])
    if (conversationId) {
      setLoading(true)
      setError(null)
    } else {
      setLoading(false)
    }
  }
  useEffect(() => {
    if (!conversationId) return
    void load(conversationId)
  }, [conversationId, load])

  return { members, loading, error, refetch }
}
