import { describe, it, expect, beforeEach, vi } from 'vitest'
import { computeShouldShow } from './bannerState'

const store: Record<string, string> = {}
const sessionStore: Record<string, string> = {}
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => { store[k] = v },
  removeItem: (k: string) => { delete store[k] },
  clear: () => { Object.keys(store).forEach(k => delete store[k]) },
})
vi.stubGlobal('sessionStorage', {
  getItem: (k: string) => sessionStore[k] ?? null,
  setItem: (k: string, v: string) => { sessionStore[k] = v },
  removeItem: (k: string) => { delete sessionStore[k] },
  clear: () => { Object.keys(sessionStore).forEach(k => delete sessionStore[k]) },
})

describe('computeShouldShow', () => {
  it('shows on mobile, installable, not dismissed, not snoozed', () => {
    expect(computeShouldShow({ isMobile: true, platform: 'android', dismissed: false, snoozed: false })).toBe(true)
    expect(computeShouldShow({ isMobile: true, platform: 'ios-safari', dismissed: false, snoozed: false })).toBe(true)
  })

  it('hides on desktop', () => {
    expect(computeShouldShow({ isMobile: false, platform: 'android', dismissed: false, snoozed: false })).toBe(false)
  })

  it('hides when already installed (standalone)', () => {
    expect(computeShouldShow({ isMobile: true, platform: 'standalone', dismissed: false, snoozed: false })).toBe(false)
  })

  it('hides when permanently dismissed', () => {
    expect(computeShouldShow({ isMobile: true, platform: 'android', dismissed: true, snoozed: false })).toBe(false)
  })

  it('hides when snoozed this session', () => {
    expect(computeShouldShow({ isMobile: true, platform: 'android', dismissed: false, snoozed: true })).toBe(false)
  })
})

describe('persistence helpers', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear() })

  it('readDismissed defaults false, setDismissed persists', async () => {
    const { readDismissed, setDismissed } = await import('./bannerState')
    expect(readDismissed()).toBe(false)
    setDismissed()
    expect(readDismissed()).toBe(true)
  })

  it('readSnoozed defaults false, setSnoozed persists in session', async () => {
    const { readSnoozed, setSnoozed } = await import('./bannerState')
    expect(readSnoozed()).toBe(false)
    setSnoozed()
    expect(readSnoozed()).toBe(true)
  })

  it('readDismissed survives corrupt JSON', async () => {
    const { readDismissed } = await import('./bannerState')
    localStorage.setItem('wiedisync_pwa_install', 'not json')
    expect(readDismissed()).toBe(false)
  })
})
