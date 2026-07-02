import { describe, it, expect, vi } from 'vitest'

vi.mock('../ConversationsProvider', () => ({
  useConversationsContext: () => ({
    conversations: [
      { id: 'a', unread_count: 3, muted: false },
      { id: 'b', unread_count: 5, muted: true },   // muted — excluded
      { id: 'c', unread_count: 2, muted: false },
    ],
    isLoading: false, error: null, refetch: vi.fn(), markRead: vi.fn(), toggleMute: vi.fn(),
  }),
}))

import { useUnreadTotal } from '../hooks/useUnreadTotal'

describe('useUnreadTotal', () => {
  it('sums unread across non-muted conversations', () => {
    // useConversationsContext is fully mocked so no React runtime is needed
    const total = useUnreadTotal()
    expect(total).toBe(5)
  })
})
