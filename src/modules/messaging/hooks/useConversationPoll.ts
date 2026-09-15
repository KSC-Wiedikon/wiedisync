import { useCallback, useState } from 'react'
import { messagingApi } from '../api/messaging'
import type { CreatePollBody } from '../api/types'

export function useConversationPoll(conversationId: string | null) {
  const [busy, setBusy] = useState(false)
  const createPoll = useCallback(async (body: Omit<CreatePollBody, 'conversation'>) => {
    if (!conversationId) return null
    setBusy(true)
    try { return await messagingApi.createPoll({ ...body, conversation: conversationId }) }
    finally { setBusy(false) }
  }, [conversationId])
  return { createPoll, busy }
}
