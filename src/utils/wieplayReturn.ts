/**
 * WiePlay (the club's video-analysis app at wieplay.kscw.ch, called Nomal until 17.10.2026)
 * sends people who are not logged in to `/login?next=<WiePlay bridge URL on the API host>`.
 * After login, LoginPage leaves the SPA for that URL, which hands WiePlay a one-time login
 * token (kscw-endpoints wieplay-bridge.js).
 *
 * Only that one endpoint on our own API origin is accepted (the old `/kscw/nomal/v1/authorize`
 * alias was removed on 18.10.2026, after WiePlay's cutover). Anything else returns null and
 * the normal in-app `next` handling (safeReturnPath) applies — no open redirect.
 */
export const WIEPLAY_AUTHORIZE_PATH = '/kscw/wieplay/v1/authorize'

export function safeWieplayReturn(raw: string | null | undefined, apiUrl: string): string | null {
  if (!raw) return null
  let target: URL
  let api: URL
  try {
    target = new URL(raw)
    api = new URL(apiUrl)
  } catch {
    return null
  }
  if (target.origin !== api.origin || target.pathname !== WIEPLAY_AUTHORIZE_PATH) return null
  if (target.username || target.password || target.hash) return null
  return target.toString()
}
