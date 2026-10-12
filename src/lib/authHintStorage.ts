// SDK credential storage that keeps the readable auth hint alive with the session.
//
// The `.kscw.ch` hint cookie (api.ts → setAuthHint) is what a fresh page load reads
// to decide whether a session exists at all — no hint, no refresh attempt, straight
// to /login. It used to be written only at LOGIN with a fixed 7-day max-age, while
// the server session slides: every refresh pushes `directus_sessions.expires` out by
// SESSION_COOKIE_TTL (7 days). So exactly a week after logging in, an active member
// still held a valid session but the hint was gone, and the next cold start (iOS
// relaunching the home-screen app after a switch, a tapped notification) showed the
// login page without asking the server (prod 12.10.2026: a coach thrown out of the
// app mid-poll; her iPhone logins ran 7 days apart through August). WebKit also caps
// a script-written cookie at 7 days, so only re-writing it can keep it alive.
//
// The SDK stores credentials after EVERY successful login and refresh — the manual
// `refreshAuth()` and its own autoRefresh timer alike — and stores an all-null record
// on logout or a failed refresh. Renewing the hint there makes it expire with the
// session instead of a week after login.

import { memoryStorage, type AuthenticationData, type AuthenticationStorage } from '@directus/sdk'

export function hintRenewingStorage(renewHint: () => void): AuthenticationStorage {
  const inner = memoryStorage()
  return {
    get: () => inner.get(),
    async set(value: AuthenticationData | null) {
      await inner.set(value)
      // A cleared record (logout, rejected refresh) leaves the hint to the code that
      // ended the session — logout() and refreshAuth() drop it themselves.
      if (value?.expires != null) renewHint()
    },
  }
}
