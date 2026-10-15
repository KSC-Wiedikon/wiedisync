/**
 * Nomal (the club's video-analysis app at nomal.kscw.ch) sends people who are not logged
 * in to `/login?next=<Nomal bridge URL on the API host>`. After login, LoginPage leaves the
 * SPA for that URL, which hands Nomal a one-time login token (kscw-endpoints nomal-bridge.js).
 *
 * Only that one endpoint on our own API origin is accepted. Anything else returns null and
 * the normal in-app `next` handling (safeReturnPath) applies — no open redirect.
 */
export const NOMAL_AUTHORIZE_PATH = '/kscw/nomal/v1/authorize'

export function safeNomalReturn(raw: string | null | undefined, apiUrl: string): string | null {
  if (!raw) return null
  let target: URL
  let api: URL
  try {
    target = new URL(raw)
    api = new URL(apiUrl)
  } catch {
    return null
  }
  if (target.origin !== api.origin || target.pathname !== NOMAL_AUTHORIZE_PATH) return null
  if (target.username || target.password || target.hash) return null
  return target.toString()
}
