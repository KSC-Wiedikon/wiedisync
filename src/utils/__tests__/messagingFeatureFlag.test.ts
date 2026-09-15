import { describe, it, expect, vi, afterEach } from 'vitest'

const load = async () => (await import('../messagingFeatureFlag')).messagingFeatureEnabled

afterEach(() => { vi.resetModules() })

describe('messagingFeatureEnabled', () => {
  it('returns true when VITE_FEATURE_MESSAGING === "true"', async () => {
    vi.stubEnv('VITE_FEATURE_MESSAGING', 'true')
    vi.stubEnv('VITE_FEATURE_MESSAGING_ALLOWLIST', '')
    const fn = await load()
    expect(fn()).toBe(true)
    expect(fn(42)).toBe(true)
  })

  it('returns false when the var is unset and no allowlist', async () => {
    vi.stubEnv('VITE_FEATURE_MESSAGING', '')
    vi.stubEnv('VITE_FEATURE_MESSAGING_ALLOWLIST', '')
    const fn = await load()
    expect(fn()).toBe(false)
    expect(fn(42)).toBe(false)
  })

  it('returns false for any non-"true" string', async () => {
    vi.stubEnv('VITE_FEATURE_MESSAGING', '1')
    vi.stubEnv('VITE_FEATURE_MESSAGING_ALLOWLIST', '')
    const fn = await load()
    expect(fn()).toBe(false)
  })

  it('allowlists specific members when the global flag is off', async () => {
    vi.stubEnv('VITE_FEATURE_MESSAGING', '')
    vi.stubEnv('VITE_FEATURE_MESSAGING_ALLOWLIST', '8, 42 ,180')
    const fn = await load()
    expect(fn(42)).toBe(true)
    expect(fn('8')).toBe(true)
    expect(fn(180)).toBe(true)
    expect(fn(99)).toBe(false)
    expect(fn()).toBe(false)
    expect(fn(null)).toBe(false)
  })

  it('global flag wins over allowlist', async () => {
    vi.stubEnv('VITE_FEATURE_MESSAGING', 'true')
    vi.stubEnv('VITE_FEATURE_MESSAGING_ALLOWLIST', '42')
    const fn = await load()
    expect(fn(99)).toBe(true)
    expect(fn()).toBe(true)
  })
})
