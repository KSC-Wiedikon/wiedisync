import { describe, it, expect } from 'vitest'
import { checkPassword, passwordErrorKeyFromCode, passwordIssueKey } from './passwordRules'

// These rules mirror validatePassword() in kscw-endpoints/src/index.js. The
// mirror drifting is the whole failure mode this module exists to prevent: when
// the frontend was laxer than the backend, a valid-looking password came back
// as an opaque 400 that the UI reported as "this link is invalid or expired".
describe('checkPassword — mirrors the backend rules', () => {
  it('rejects anything under 8 characters', () => {
    expect(checkPassword('Ab1!')).toBe('password_too_short')
    expect(checkPassword('Abcdef1')).toBe('password_too_short')
    expect(checkPassword('')).toBe('password_too_short')
  })

  it('rejects a long password with no digit or special character', () => {
    // The exact case that stranded a member on 2026-08-04: 8+ chars, letters
    // only. The old length-only check waved it through to a 400.
    expect(checkPassword('abcdefghij')).toBe('password_weak')
    expect(checkPassword('Volleyball')).toBe('password_weak')
  })

  it('rejects digits with no letter', () => {
    expect(checkPassword('12345678')).toBe('password_weak')
  })

  it('accepts a letter plus a digit', () => {
    expect(checkPassword('wiedikon1')).toBeNull()
  })

  it('accepts a letter plus a special character', () => {
    expect(checkPassword('wiedikon!')).toBeNull()
    expect(checkPassword('wiedi-kon')).toBeNull()
  })
})

describe('error-code mapping', () => {
  it('maps every password code to its own message key', () => {
    expect(passwordErrorKeyFromCode('password_too_short')).toBe('passwordTooShort')
    expect(passwordErrorKeyFromCode('password_weak')).toBe('passwordNeedsLetterAndNumber')
    expect(passwordErrorKeyFromCode('password_too_common')).toBe('passwordTooCommon')
  })

  it('returns null for non-password failures so callers keep their own message', () => {
    // A dead reset link and an unknown address must NOT be reported as a bad
    // password — that mislabelling is the bug in the other direction.
    expect(passwordErrorKeyFromCode('no_account')).toBeNull()
    expect(passwordErrorKeyFromCode('email_in_use')).toBeNull()
    expect(passwordErrorKeyFromCode(undefined)).toBeNull()
  })

  it('agrees with the local issue mapping', () => {
    expect(passwordIssueKey('password_weak')).toBe(passwordErrorKeyFromCode('password_weak'))
  })
})
