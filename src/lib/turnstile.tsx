import { useCallback, useRef, useState } from 'react'
import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile'

/**
 * Cloudflare Turnstile site key. Public by design (it is rendered into the page);
 * the matching SECRET lives only in the Directus container env and is what
 * `verifyTurnstile` checks server-side.
 *
 * It was copy-pasted into four page components before this module existed. That
 * is survivable for a constant, but the *usage* around it was not — see below.
 */
export const TURNSTILE_SITE_KEY = '0x4AAAAAACoYmx3xiDfRbmv9'

/**
 * A Turnstile widget plus a `getToken()` that always yields a FRESH token.
 *
 * The subtlety this exists to encapsulate: **a Turnstile token is single-use.**
 * Cloudflare's siteverify rejects the second presentation of the same token
 * (`timeout-or-duplicate`). Every existing call site captured one token via
 * `onSuccess` and sent that captured value, which is correct only as long as the
 * page makes exactly ONE protected call. The signup flow makes several —
 * `/check-email`, then `/verify-email`, then an OTP resend — so reusing the
 * captured token would have failed on the second one, and "add the captcha to
 * /verify-email" would have broken signup rather than protected it
 * (audit 2026-08-08, finding 12).
 *
 * `getToken()` therefore resets the widget and awaits a newly issued token on
 * every call. `getResponsePromise()` resolves once the widget has solved again;
 * with a non-interactive challenge that is automatic, and with an interactive
 * one it resolves when the user completes it.
 *
 * Usage:
 *   const { widget, getToken, ready } = useTurnstile()
 *   ...
 *   <Button disabled={!ready} onClick={async () => {
 *     await api('/x', { body: { turnstile_token: await getToken() } })
 *   }}>
 *   {widget}
 */
/** How long to wait for a re-solve before giving up and letting the server refuse. */
const RESOLVE_TIMEOUT_MS = 30_000

export function useTurnstile() {
  const ref = useRef<TurnstileInstance>(null)
  const [ready, setReady] = useState(false)
  /** The most recent solved-but-unspent token. */
  const tokenRef = useRef<string>('')
  /** Resolver for a `getToken()` call that is waiting on a re-solve. */
  const waiterRef = useRef<((token: string) => void) | null>(null)

  const deliver = useCallback((token: string) => {
    if (waiterRef.current) {
      const resolve = waiterRef.current
      waiterRef.current = null
      resolve(token)
      return
    }
    tokenRef.current = token
  }, [])

  /**
   * A fresh, unused token.
   *
   * ⚠ Deliberately NOT `getResponsePromise()`. That helper polls only while the
   * widget is still LOADING; once loaded it calls `window.turnstile.getResponse()`
   * exactly once and **rejects with "No response received"** when the answer is
   * empty. Straight after a `reset()` the answer is always empty, so using it
   * here would have rejected instantly on every call after the first — i.e. the
   * OTP resend and the second signup step would have silently sent an empty
   * token and been refused by the server. Caught by reading the library rather
   * than in testing, because headless Chromium cannot solve a challenge at all.
   *
   * So: reset, then wait for the widget's own `onSuccess` to hand over the new
   * token. The first call skips the reset and spends the token solved on mount —
   * resetting a perfectly good unused token would just make the user wait.
   */
  const getToken = useCallback(async (): Promise<string> => {
    if (tokenRef.current) {
      const current = tokenRef.current
      tokenRef.current = ''
      return current
    }
    setReady(false)
    ref.current?.reset()
    return new Promise<string>((resolve) => {
      waiterRef.current = resolve
      window.setTimeout(() => {
        if (waiterRef.current === resolve) {
          waiterRef.current = null
          // Never fabricate a token — an empty one makes the server refuse,
          // which is the correct outcome, and the caller shows its own error.
          resolve('')
        }
      }, RESOLVE_TIMEOUT_MS)
    })
  }, [])

  const widget = (
    <Turnstile
      ref={ref}
      siteKey={TURNSTILE_SITE_KEY}
      onSuccess={(token) => {
        setReady(true)
        deliver(token)
      }}
      onExpire={() => {
        tokenRef.current = ''
        setReady(false)
        ref.current?.reset()
      }}
      onError={() => {
        tokenRef.current = ''
        setReady(false)
        // Unblock anyone waiting; '' is refused server-side by design.
        if (waiterRef.current) {
          const resolve = waiterRef.current
          waiterRef.current = null
          resolve('')
        }
      }}
      options={{ theme: 'auto', size: 'flexible' }}
    />
  )

  return { widget, getToken, ready }
}
