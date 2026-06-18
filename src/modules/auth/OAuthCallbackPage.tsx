import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { setAuthHint, logout as apiLogout } from '../../lib/api'

/**
 * Handles the OAuth redirect callback from Directus SSO (cookie-session mode).
 *
 * With `AUTH_<PROVIDER>_MODE=session`, Directus sets the httpOnly session cookie
 * (scoped `.kscw.ch`) and redirects back to our callback WITHOUT tokens in the
 * URL — only our `?state=<nonce>` survives. So there are no tokens to store;
 * the session already exists in the cookie. We only need to (a) prove the
 * callback originated from our own flow, then (b) prime the readable auth hint
 * and hard-reload so AuthProvider restores the session from the cookie.
 *
 * Defence layers (anti login-CSRF / session-fixation):
 *   1. `oauth_pending` sentinel must exist (proves a recent loginWithOAuth click).
 *   2. Sentinel TTL ≤ 2 min.
 *   3. The `state` nonce must round-trip and match the stored sentinel nonce.
 * If any check fails we LOG OUT — discarding any session Directus may have set
 * for an attacker-initiated flow — and bounce to /login.
 */
const OAUTH_TTL_MS = 2 * 60 * 1000 // 2 minutes

export default function OAuthCallbackPage() {
  const navigate = useNavigate()

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const stateParam = params.get('state')

    // Strip the query string immediately — keep nothing in history/referrer.
    window.history.replaceState({}, '', '/auth/callback')

    let pending: { nonce?: string; ts?: number; provider?: string } | null = null
    try {
      const raw = sessionStorage.getItem('oauth_pending')
      if (raw) pending = JSON.parse(raw)
    } catch { /* malformed — treat as absent */ }
    // Single-use: clear the sentinel before any branch.
    try { sessionStorage.removeItem('oauth_pending') } catch { /* ignore */ }

    const fresh = !!pending?.ts && (Date.now() - pending.ts) < OAUTH_TTL_MS
    const stateOk = !!stateParam && !!pending?.nonce && stateParam === pending.nonce

    if (fresh && stateOk) {
      // Directus already set the session cookie; mark the hint + hard-reload so
      // AuthProvider's init restores the session from the cookie.
      setAuthHint(true)
      window.location.replace('/')
    } else {
      // Reject: discard any session Directus set for this (possibly hostile) flow.
      apiLogout().finally(() => navigate('/login?oauth=expired', { replace: true }))
    }
  }, [navigate])

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
      <img
        src="/wiedisync_logo.svg"
        alt="Loading…"
        className="h-24 w-24 animate-spin"
        style={{ animationDuration: '2s' }}
      />
    </div>
  )
}
