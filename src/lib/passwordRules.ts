/**
 * Password rules, mirrored from the backend.
 *
 * WHY THIS FILE EXISTS. `validatePassword()` in
 * `directus/extensions/kscw-endpoints/src/index.js` is the authority — it is
 * what actually rejects a password. Until 2026-08-04 the frontend enforced only
 * `length >= 8`, so a letters-only password sailed through the form and came
 * back as an opaque 400 that `SetPasswordPage` reported as "This link is
 * invalid or expired". A member burned 15 minutes and two reset emails on a
 * link that was fine; the real problem was a missing digit, and nothing on
 * screen said so.
 *
 * So: mirror the cheap rules here to catch them before the network, translated,
 * while the password field is still on screen — and map the backend's codes for
 * anything the mirror can't know.
 *
 * ⚠ Keep in step with the backend. If you add a rule there, add it here (and an
 * i18n key for it). The one deliberate asymmetry is the common-password list:
 * it stays server-side rather than shipping to every browser, so
 * `password_too_common` arrives only as a backend code.
 */

export const PASSWORD_MIN_LENGTH = 8

/** Backend `code` values for a rejected password. Also used for local issues. */
export type PasswordIssue = 'password_too_short' | 'password_weak' | 'password_too_common'

/** Mirrors the backend's letter + digit-or-special character class exactly. */
const DIGIT_OR_SPECIAL = /[0-9!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/

/**
 * Returns the failing rule, or null when the password satisfies every rule this
 * side can check. A `null` here does NOT guarantee the backend will accept it
 * (see the common-password carve-out above).
 */
export function checkPassword(password: string): PasswordIssue | null {
  if (!password || password.length < PASSWORD_MIN_LENGTH) return 'password_too_short'
  const hasLetter = /[a-zA-Z]/.test(password)
  if (!hasLetter || !DIGIT_OR_SPECIAL.test(password)) return 'password_weak'
  return null
}

/** i18n key (in the `auth` namespace) for a rule violation. */
export function passwordIssueKey(issue: PasswordIssue): string {
  switch (issue) {
    case 'password_too_short':
      return 'passwordTooShort'
    case 'password_too_common':
      return 'passwordTooCommon'
    case 'password_weak':
    default:
      return 'passwordNeedsLetterAndNumber'
  }
}

/**
 * Maps a `code` off a failed API response to its i18n key, or null when the
 * failure was not about the password (dead token, unknown email, …) and the
 * caller should fall back to its own message.
 */
export function passwordErrorKeyFromCode(code: string | undefined): string | null {
  if (code === 'password_too_short' || code === 'password_weak' || code === 'password_too_common') {
    return passwordIssueKey(code)
  }
  return null
}
