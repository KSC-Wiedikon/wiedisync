import type { ConversationSummary, MessageRequestRow } from '../api/types'

export type RequestHeaderVariant =
  | { kind: 'hidden' }
  | { kind: 'awaiting-their-response'; senderIsMe: true }
  | { kind: 'action-required'; senderIsMe: false; request: MessageRequestRow }

/**
 * Decide which request-related banner (if any) to render at the top of a
 * conversation thread. Pure — tested in isolation.
 *
 *  • conv.type !== 'dm_request'   → hidden
 *  • I am the sender              → 'awaiting-their-response' (neutral, no buttons)
 *  • I am the recipient + pending → 'action-required' (Accept / Decline / Block)
 */
export function resolveRequestHeader(
  conv: Pick<ConversationSummary, 'type' | 'request_status'>,
  currentMemberId: string | null,
  request: MessageRequestRow | null,
): RequestHeaderVariant {
  if (!currentMemberId) return { kind: 'hidden' }
  if (conv.type !== 'dm_request') return { kind: 'hidden' }
  if (conv.request_status !== 'pending') return { kind: 'hidden' }
  if (!request) return { kind: 'hidden' }
  if (String(request.sender) === String(currentMemberId)) {
    return { kind: 'awaiting-their-response', senderIsMe: true }
  }
  if (String(request.recipient) === String(currentMemberId)) {
    return { kind: 'action-required', senderIsMe: false, request }
  }
  return { kind: 'hidden' }
}
