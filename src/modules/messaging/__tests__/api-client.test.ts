import { describe, it, expect, vi, beforeEach } from 'vitest'
import { messagingApi } from '../api/messaging'

// Mock kscwApi so we can assert the URLs and bodies emitted.
vi.mock('../../../lib/api', () => ({
  kscwApi: vi.fn(async () => undefined),
}))

import { kscwApi } from '../../../lib/api'

describe('messagingApi', () => {
  beforeEach(() => { vi.mocked(kscwApi).mockClear() })

  it('has the expected method names (contract surface)', () => {
    const expected = [
      'listConversations','listMessages','createDm','markRead','toggleMute','clearConversation',
      'send','edit','delete',
      'react',
      'acceptRequest','declineRequest','block','unblock',
      'createReport','listReports','resolveReport',
      'createPoll',
      'updateSettings','recordConsent','exportData',
    ] as const
    for (const k of expected) {
      expect(messagingApi).toHaveProperty(k)
      expect(typeof messagingApi[k]).toBe('function')
    }
  })

  it('createDm passes body as a plain object (not pre-stringified)', async () => {
    await messagingApi.createDm({ recipient: 'mbr-1' })
    expect(kscwApi).toHaveBeenCalledWith(
      '/messaging/conversations/dm',
      expect.objectContaining({ method: 'POST', body: { recipient: 'mbr-1' } }),
    )
  })

  it('send passes body as a plain object', async () => {
    await messagingApi.send({ conversation: 'conv-1', type: 'text', body: 'hi' })
    expect(kscwApi).toHaveBeenCalledWith(
      '/messaging/messages',
      expect.objectContaining({
        method: 'POST',
        body: { conversation: 'conv-1', type: 'text', body: 'hi' },
      }),
    )
  })

  it('react passes body as a plain object', async () => {
    await messagingApi.react('msg-1', { emoji: '👍' })
    expect(kscwApi).toHaveBeenCalledWith(
      '/messaging/messages/msg-1/reactions',
      expect.objectContaining({ method: 'POST', body: { emoji: '👍' } }),
    )
  })

  it('delete uses DELETE method', async () => {
    await messagingApi.delete('msg-1')
    expect(kscwApi).toHaveBeenCalledWith(
      '/messaging/messages/msg-1',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('acceptRequest POSTs with no body', async () => {
    await messagingApi.acceptRequest('req-1')
    expect(kscwApi).toHaveBeenCalledWith(
      '/messaging/requests/req-1/accept',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('declineRequest POSTs with no body', async () => {
    await messagingApi.declineRequest('req-1')
    expect(kscwApi).toHaveBeenCalledWith(
      '/messaging/requests/req-1/decline',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('block passes body as a raw object', async () => {
    await messagingApi.block({ member: 'mbr-2' })
    expect(kscwApi).toHaveBeenCalledWith(
      '/messaging/blocks',
      expect.objectContaining({ method: 'POST', body: { member: 'mbr-2' } }),
    )
  })

  it('unblock calls DELETE on the member path', async () => {
    await messagingApi.unblock('mbr-2')
    expect(kscwApi).toHaveBeenCalledWith(
      '/messaging/blocks/mbr-2',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('updateSettings passes body as a raw object', async () => {
    await messagingApi.updateSettings({ dm_enabled: true, team_chat_enabled: false })
    expect(kscwApi).toHaveBeenCalledWith(
      '/messaging/settings',
      expect.objectContaining({
        method: 'PATCH',
        body: { dm_enabled: true, team_chat_enabled: false },
      }),
    )
  })

  it('react POSTs to correct URL with raw body', async () => {
    await messagingApi.react('msg-1', { emoji: '👍' })
    expect(kscwApi).toHaveBeenCalledWith(
      '/messaging/messages/msg-1/reactions',
      expect.objectContaining({ method: 'POST', body: { emoji: '👍' } }),
    )
  })

  it('edit PATCHes to correct URL with raw body', async () => {
    await messagingApi.edit('msg-1', { body: 'new' })
    expect(kscwApi).toHaveBeenCalledWith(
      '/messaging/messages/msg-1',
      expect.objectContaining({ method: 'PATCH', body: { body: 'new' } }),
    )
  })

  it('delete calls DELETE on correct URL with no body', async () => {
    await messagingApi.delete('msg-1')
    expect(kscwApi).toHaveBeenCalledWith(
      '/messaging/messages/msg-1',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('createReport POSTs with exact raw body', async () => {
    await messagingApi.createReport({ reported_member: 'mbr-2', message: 'msg-1', reason: 'spam' })
    expect(kscwApi).toHaveBeenCalledWith(
      '/messaging/reports',
      expect.objectContaining({
        method: 'POST',
        body: { reported_member: 'mbr-2', message: 'msg-1', reason: 'spam' },
      }),
    )
  })

  it('listReports GETs /messaging/reports with no query string', async () => {
    await messagingApi.listReports()
    expect(kscwApi).toHaveBeenCalledWith('/messaging/reports')
  })

  it('listReports with status filter appends ?status=open', async () => {
    await messagingApi.listReports({ status: 'open' })
    expect(kscwApi).toHaveBeenCalledWith('/messaging/reports?status=open')
  })

  it('resolveReport PATCHes with raw body', async () => {
    await messagingApi.resolveReport('rep-1', { status: 'resolved', delete_message: true })
    expect(kscwApi).toHaveBeenCalledWith(
      '/messaging/reports/rep-1',
      expect.objectContaining({
        method: 'PATCH',
        body: { status: 'resolved', delete_message: true },
      }),
    )
  })

  it('createPoll POSTs to /messaging/polls with raw body', async () => {
    await messagingApi.createPoll({ conversation: 'c', question: 'q', options: ['a', 'b'], mode: 'single' })
    expect(kscwApi).toHaveBeenCalledWith(
      '/messaging/polls',
      expect.objectContaining({
        method: 'POST',
        body: { conversation: 'c', question: 'q', options: ['a', 'b'], mode: 'single' },
      }),
    )
  })

  it('recordConsent passes body as a raw object', async () => {
    await messagingApi.recordConsent({ decision: 'accepted' })
    expect(kscwApi).toHaveBeenCalledWith(
      '/messaging/settings/consent',
      expect.objectContaining({ method: 'POST', body: { decision: 'accepted' } }),
    )
  })

  it('clearConversation POSTs with no body', async () => {
    await messagingApi.clearConversation('conv-1')
    expect(kscwApi).toHaveBeenCalledWith(
      '/messaging/conversations/conv-1/clear',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('exportData POSTs with no body', async () => {
    await messagingApi.exportData()
    expect(kscwApi).toHaveBeenCalledWith(
      '/messaging/export',
      expect.objectContaining({ method: 'POST' }),
    )
  })
})
