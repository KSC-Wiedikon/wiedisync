/**
 * useMessagingConsent tests — node-env compatible (no @testing-library/react).
 *
 * Strategy: mock React hooks, useAuth, messagingApi, and window.location.reload.
 * We verify shouldShowModal logic and that accept/decline/later forward the right
 * decision string to messagingApi.recordConsent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ConsentBody } from '../api/types'

// ── Mock React hooks (node env) ──────────────────────────────────────
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useState: (init: unknown) => [init, vi.fn()],
    useCallback: (fn: unknown) => fn,
  }
})

// ── Mock window.location.reload ──────────────────────────────────────
const reloadMock = vi.fn()
Object.defineProperty(globalThis, 'window', {
  value: { location: { reload: reloadMock } },
  writable: true,
  configurable: true,
})

// ── Mock messagingApi ────────────────────────────────────────────────
type ConsentResponse = { decision: ConsentBody['decision']; consent_prompted_at: string }
const recordConsentMock = vi.fn<(body: ConsentBody) => Promise<ConsentResponse>>(
  async () => ({ decision: 'accepted', consent_prompted_at: '' }),
)
vi.mock('../api/messaging', () => ({
  messagingApi: {
    recordConsent: (body: ConsentBody) => recordConsentMock(body),
  },
}))

// ── Parameterise useAuth for each test ──────────────────────────────
let mockUser: Record<string, unknown> | null = null
vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({ user: mockUser }),
}))

import { useMessagingConsent } from '../hooks/useMessagingConsent'

describe('useMessagingConsent', () => {
  beforeEach(() => {
    recordConsentMock.mockReset()
    reloadMock.mockReset()
    mockUser = null
  })

  it('shouldShowModal is true when decision is pending and no promptedAt', () => {
    mockUser = { consent_decision: 'pending', consent_prompted_at: null }
    const { shouldShowModal } = useMessagingConsent()
    expect(shouldShowModal).toBe(true)
  })

  it('shouldShowModal is false when decision is accepted', () => {
    mockUser = { consent_decision: 'accepted', consent_prompted_at: null }
    const { shouldShowModal } = useMessagingConsent()
    expect(shouldShowModal).toBe(false)
  })

  it('shouldShowModal is false when decision is declined', () => {
    mockUser = { consent_decision: 'declined', consent_prompted_at: null }
    const { shouldShowModal } = useMessagingConsent()
    expect(shouldShowModal).toBe(false)
  })

  it('shouldShowModal is true when user is null (no decision)', () => {
    mockUser = null
    const { shouldShowModal } = useMessagingConsent()
    expect(shouldShowModal).toBe(true)
  })

  it('shouldShowModal is false when promptedAt is within 7 days', () => {
    const recentPrompt = new Date(Date.now() - 1000 * 60 * 60).toISOString() // 1 hour ago
    mockUser = { consent_decision: 'pending', consent_prompted_at: recentPrompt }
    const { shouldShowModal } = useMessagingConsent()
    expect(shouldShowModal).toBe(false)
  })

  it('accept forwards decision "accepted" to recordConsent', async () => {
    mockUser = { consent_decision: 'pending', consent_prompted_at: null }
    recordConsentMock.mockResolvedValueOnce({ decision: 'accepted', consent_prompted_at: '' })
    const { accept } = useMessagingConsent()
    await (accept as () => Promise<void>)()
    expect(recordConsentMock).toHaveBeenCalledWith({ decision: 'accepted' })
  })

  it('decline forwards decision "declined" to recordConsent', async () => {
    mockUser = { consent_decision: 'pending', consent_prompted_at: null }
    recordConsentMock.mockResolvedValueOnce({ decision: 'declined', consent_prompted_at: '' })
    const { decline } = useMessagingConsent()
    await (decline as () => Promise<void>)()
    expect(recordConsentMock).toHaveBeenCalledWith({ decision: 'declined' })
  })

  it('later forwards decision "later" to recordConsent', async () => {
    mockUser = { consent_decision: 'pending', consent_prompted_at: null }
    recordConsentMock.mockResolvedValueOnce({ decision: 'later', consent_prompted_at: '' })
    const { later } = useMessagingConsent()
    await (later as () => Promise<void>)()
    expect(recordConsentMock).toHaveBeenCalledWith({ decision: 'later' })
  })

  it('calls window.location.reload after a successful consent submission', async () => {
    mockUser = { consent_decision: 'pending', consent_prompted_at: null }
    recordConsentMock.mockResolvedValueOnce({ decision: 'accepted', consent_prompted_at: '' })
    const { accept } = useMessagingConsent()
    await (accept as () => Promise<void>)()
    expect(reloadMock).toHaveBeenCalledOnce()
  })
})
