import { describe, it, expect } from 'vitest'
import { resolveConsentState } from '../utils/resolveConsentState'

const BASE = new Date('2026-04-18T12:00:00Z')
const sevenDaysMs = 7 * 24 * 3600 * 1000

describe('resolveConsentState', () => {
  it('accepted → hidden', () => {
    expect(resolveConsentState({ consentDecision: 'accepted', consentPromptedAt: null, now: BASE })).toBe('hidden')
  })

  it('declined → hidden', () => {
    expect(resolveConsentState({ consentDecision: 'declined', consentPromptedAt: null, now: BASE })).toBe('hidden')
  })

  it('pending + no promptedAt → show (first time)', () => {
    expect(resolveConsentState({ consentDecision: 'pending', consentPromptedAt: null, now: BASE })).toBe('show')
  })

  it('pending + promptedAt within 7 days → hidden', () => {
    const promptedAt = new Date(BASE.getTime() - sevenDaysMs + 1000).toISOString() // 1 second under 7 days
    expect(resolveConsentState({ consentDecision: 'pending', consentPromptedAt: promptedAt, now: BASE })).toBe('hidden')
  })

  it('pending + promptedAt exactly 7 days → hidden (strict >)', () => {
    const promptedAt = new Date(BASE.getTime() - sevenDaysMs).toISOString()
    expect(resolveConsentState({ consentDecision: 'pending', consentPromptedAt: promptedAt, now: BASE })).toBe('hidden')
  })

  it('pending + promptedAt > 7 days → show', () => {
    const promptedAt = new Date(BASE.getTime() - sevenDaysMs - 1000).toISOString() // 1 second over 7 days
    expect(resolveConsentState({ consentDecision: 'pending', consentPromptedAt: promptedAt, now: BASE })).toBe('show')
  })

  it('undefined decision → show (treated as pending, no promptedAt)', () => {
    expect(resolveConsentState({ consentDecision: undefined, consentPromptedAt: null, now: BASE })).toBe('show')
  })
})
