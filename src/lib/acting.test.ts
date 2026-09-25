import { describe, it, expect } from 'vitest'
import {
  ACTING_HEADER, parseActingId, sentActingId, isActingDeniedError, actingRefusalScope, isActingEchoMismatch,
} from './acting'

describe('acting transport helpers', () => {
  it('reads the id a request was sent with, from every HeadersInit shape', () => {
    expect(sentActingId(new Headers({ [ACTING_HEADER]: '563' }))).toBe(563)
    expect(sentActingId([[ACTING_HEADER.toLowerCase(), '564']])).toBe(564)
    expect(sentActingId({ [ACTING_HEADER]: '565' })).toBe(565)
    expect(sentActingId(undefined)).toBeNull()
    expect(sentActingId({})).toBeNull()
  })

  it('accepts only positive integer ids', () => {
    for (const bad of ['0', '-3', 'abc', '1.5', '', null, undefined]) expect(parseActingId(bad)).toBeNull()
    expect(parseActingId('42')).toBe(42)
  })

  it('recognises the middleware refusal in kscwApi and SDK error shapes', () => {
    expect(isActingDeniedError({ code: 'KSCW_ACTING_DENIED' })).toBe(true)
    expect(isActingDeniedError({ errors: { code: 'KSCW_ACTING_DENIED' } })).toBe(true)
    expect(isActingDeniedError({ data: { code: 'KSCW_ACTING_DENIED' } })).toBe(true)
    expect(isActingDeniedError({ code: 'FORBIDDEN' })).toBe(false)
    expect(isActingDeniedError(null)).toBe(false)
  })

  it('tells a path refusal (keep acting) from a grant refusal (back to self)', () => {
    expect(actingRefusalScope({ scope: 'path' })).toBe('path')
    expect(actingRefusalScope({ error: 'Not available while using another account' })).toBe('path')
    expect(actingRefusalScope({ scope: 'grant' })).toBe('grant')
    expect(actingRefusalScope({ error: 'Not permitted' })).toBe('grant')
    expect(actingRefusalScope(null)).toBe('grant')
  })

  describe('echo check', () => {
    it('matches against the id the request was SENT with', () => {
      expect(isActingEchoMismatch(true, '563', 563)).toBe(false)
      expect(isActingEchoMismatch(true, null, null)).toBe(false)
    })

    it('a response in flight across a switch is not a desync (A sent, B current)', () => {
      // Sent as 563; the app has since switched to 564 or back to main. The
      // echo still matches what was sent, so nothing reloads.
      expect(isActingEchoMismatch(true, '563', 563)).toBe(false)
    })

    it('flags a real desync in both directions', () => {
      expect(isActingEchoMismatch(true, '564', 563)).toBe(true)
      expect(isActingEchoMismatch(true, null, 563)).toBe(true)
      expect(isActingEchoMismatch(true, '563', null)).toBe(true)
    })

    it('ignores non-2xx responses (a refusal carries no echo)', () => {
      expect(isActingEchoMismatch(false, null, 563)).toBe(false)
    })
  })
})
