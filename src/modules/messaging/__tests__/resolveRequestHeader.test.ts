import { describe, it, expect } from 'vitest'
import { resolveRequestHeader } from '../utils/resolveRequestHeader'
import type { MessageRequestRow } from '../api/types'

const req = (overrides: Partial<MessageRequestRow> = {}): MessageRequestRow => ({
  id: 'r1', conversation: 'c1', sender: 'A', recipient: 'B',
  status: 'pending', created_at: '2026-04-18T00:00:00Z', resolved_at: null, ...overrides,
})

describe('resolveRequestHeader', () => {
  it('hidden when conv is not a dm_request', () => {
    expect(resolveRequestHeader({ type: 'dm', request_status: null }, 'me', req()).kind).toBe('hidden')
    expect(resolveRequestHeader({ type: 'team', request_status: null }, 'me', req()).kind).toBe('hidden')
  })

  it('hidden when no currentMemberId', () => {
    expect(resolveRequestHeader({ type: 'dm_request', request_status: 'pending' }, null, req()).kind).toBe('hidden')
  })

  it('hidden when no request row provided', () => {
    expect(resolveRequestHeader({ type: 'dm_request', request_status: 'pending' }, 'me', null).kind).toBe('hidden')
  })

  it('sender = me → awaiting-their-response', () => {
    const r = req({ sender: 'me', recipient: 'them' })
    const res = resolveRequestHeader({ type: 'dm_request', request_status: 'pending' }, 'me', r)
    expect(res).toEqual({ kind: 'awaiting-their-response', senderIsMe: true })
  })

  it('recipient = me → action-required with request payload', () => {
    const r = req({ sender: 'them', recipient: 'me' })
    const res = resolveRequestHeader({ type: 'dm_request', request_status: 'pending' }, 'me', r)
    expect(res.kind).toBe('action-required')
    if (res.kind === 'action-required') {
      expect(res.senderIsMe).toBe(false)
      expect(res.request).toBe(r)
    }
  })

  it('status=accepted hides the banner', () => {
    expect(resolveRequestHeader({ type: 'dm_request', request_status: 'accepted' }, 'me', req()).kind).toBe('hidden')
  })

  it('status=declined hides the banner', () => {
    expect(resolveRequestHeader({ type: 'dm_request', request_status: 'declined' }, 'me', req()).kind).toBe('hidden')
  })

  it('caller is neither sender nor recipient — hidden (defensive)', () => {
    const r = req({ sender: 'X', recipient: 'Y' })
    expect(resolveRequestHeader({ type: 'dm_request', request_status: 'pending' }, 'me', r).kind).toBe('hidden')
  })

  it('numeric-vs-string id comparison is coerced', () => {
    const r = req({ sender: 123 as unknown as string, recipient: 456 as unknown as string })
    const res = resolveRequestHeader({ type: 'dm_request', request_status: 'pending' }, '123', r)
    expect(res.kind).toBe('awaiting-their-response')
  })
})
