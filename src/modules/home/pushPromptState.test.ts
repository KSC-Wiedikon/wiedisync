import { describe, it, expect } from 'vitest'
import { shouldShowPushPrompt, type PushPromptSignals } from './pushPromptState'

const base: PushPromptSignals = {
  supported: true, probing: false, subscribed: false, permission: 'default',
  dismissed: false, installBannerShown: false, impersonating: false,
}

describe('shouldShowPushPrompt', () => {
  it('shows where push can work and is not on yet', () => {
    expect(shouldShowPushPrompt(base)).toBe(true)
    // Granted but no subscription (e.g. after a logout unbound the device): still offer it.
    expect(shouldShowPushPrompt({ ...base, permission: 'granted' })).toBe(true)
  })

  it('stays away when it cannot help or is not wanted', () => {
    expect(shouldShowPushPrompt({ ...base, supported: false })).toBe(false)   // iPhone in a Safari tab, Brave on Android
    expect(shouldShowPushPrompt({ ...base, probing: true })).toBe(false)     // not known yet
    expect(shouldShowPushPrompt({ ...base, subscribed: true })).toBe(false)
    expect(shouldShowPushPrompt({ ...base, permission: 'denied' })).toBe(false)
    expect(shouldShowPushPrompt({ ...base, dismissed: true })).toBe(false)   // "Not now", for good
    expect(shouldShowPushPrompt({ ...base, installBannerShown: true })).toBe(false) // one banner at a time
    expect(shouldShowPushPrompt({ ...base, impersonating: true })).toBe(false)
  })
})
