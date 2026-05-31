import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

/**
 * Handles the OAuth redirect callback from Directus SSO.
 *
 * Directus redirects back with access_token + refresh_token + expires in the
 * URL search params. We require an `oauth_pending` sentinel set by
 * loginWithOAuth() to be present and fresh — that closes the CSRF window
 * where an attacker tricks a victim into loading a crafted callback URL.
 *
 * Defence layers (in order):
 *   1. `oauth_pending` sentinel must exist (proves a recent click).
 *   2. Sentinel TTL ≤ 2 min (was 5 min — the 2026-05-12 audit shrank this
 *      to halve the session-fixation window on shared/kiosk devices).
 *   3. A `state` nonce must round-trip and match the stored sentinel nonce.
 *      loginWithOAuth() always appends `?state=<crypto-random nonce>` to the
 *      callback URL, so a missing/mismatched state is rejected — this is the
 *      anti-login-CSRF / session-fixation binding. The sentinel-only fallback
 *      (accepting an absent state) was removed in the 2026-05-31 audit; we
 *      control the redirect contract, so an absent state means the callback
 *      did not originate from our own flow.
 *
 * Token hygiene: the access_token + refresh_token arrive in the URL query
 * string. We strip them from the address bar with history.replaceState the
 * instant they are read — before any branch, storage write or navigation —
 * so they don't linger in browser history, bookmarks, or a Referer header on
 * a later navigation. (The page renders only a same-origin SVG, so no
 * subresource Referer leaks before this runs.)
 */
const OAUTH_TTL_MS = 2 * 60 * 1000 // 2 minutes

export default function OAuthCallbackPage() {
  const navigate = useNavigate()

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const accessToken = params.get('access_token')
    const refreshToken = params.get('refresh_token')
    const expires = params.get('expires')
    const stateParam = params.get('state')

    // Strip tokens from the address bar immediately — before any branch,
    // storage write or navigation — so they never linger in history/referrer.
    window.history.replaceState({}, '', '/auth/callback')

    let consumed = false
    let pending: { nonce?: string; ts?: number; provider?: string } | null = null
    try {
      const raw = sessionStorage.getItem('oauth_pending')
      if (raw) pending = JSON.parse(raw)
    } catch { /* malformed — treat as absent */ }
    // Clear the sentinel before any branch — single-use.
    try { sessionStorage.removeItem('oauth_pending') } catch { /* ignore */ }

    // Reject token params that didn't come from a recent loginWithOAuth click.
    const fresh = !!pending?.ts && (Date.now() - pending.ts) < OAUTH_TTL_MS
    // Strict state binding: the `state` nonce must be present AND match the
    // stored sentinel nonce. loginWithOAuth() always sends one, so an absent
    // or mismatched state is rejected (anti-login-CSRF / session-fixation).
    const stateOk = !!stateParam && !!pending?.nonce && stateParam === pending.nonce
    if (accessToken && refreshToken && fresh && stateOk) {
      const authData = {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires: expires ? Number(expires) : null,
      }
      const rememberMe = localStorage.getItem('wiedisync-remember-me') !== 'false'
      const storage = rememberMe ? localStorage : sessionStorage
      storage.setItem('directus_auth', JSON.stringify(authData))
      consumed = true
    }

    if (consumed) {
      navigate('/', { replace: true })
    } else {
      // Either no tokens, or no recent OAuth attempt — bounce to login
      navigate('/login?oauth=expired', { replace: true })
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
