/**
 * Share links for activities, and the guard for coming back to one after login.
 *
 * Lives in utils rather than beside the button: both halves of the round trip
 * need it — ShareActivityButton writes the URL, AuthRoute and LoginPage read it
 * back — and a component file that also exports helpers breaks fast refresh.
 */

export type ShareableActivity = 'event' | 'training' | 'game'

const ROUTE_SEGMENT: Record<ShareableActivity, string> = {
  event: 'events',
  training: 'trainings',
  game: 'games',
}

/**
 * In-app route for one activity, e.g. `/events/42`. The half that carries the
 * meaning — and the half `safeReturnPath` has to accept, since AuthRoute stores
 * exactly this in `?next=`.
 */
export function activityPath(kind: ShareableActivity, id: string | number): string {
  return `/${ROUTE_SEGMENT[kind]}/${id}`
}

/**
 * Absolute deep link to one activity, e.g. `https://wiedisync.kscw.ch/events/42`.
 *
 * Origin taken from the browser on purpose: the same build serves
 * wiedisync.kscw.ch and wiedisync.pages.dev, and a hardcoded prod URL would send
 * a link shared from the dev preview to production data.
 */
export function activityLink(kind: ShareableActivity, id: string | number): string {
  return `${window.location.origin}${activityPath(kind, id)}`
}

/**
 * Same-origin, path-only, and not a login loop — the three things a redirect
 * target read off the URL has to be before we navigate to it.
 *
 * One definition, used by both the writer (AuthRoute) and the reader
 * (LoginPage); a second, subtly different copy is how open redirects get in.
 * `//evil.com` is the one that catches people out: it starts with `/`, so a
 * naive "is it relative?" check passes it, and the browser reads it as
 * protocol-relative and leaves the site.
 */
export function safeReturnPath(raw: string | null | undefined): string | null {
  if (!raw) return null
  if (!raw.startsWith('/') || raw.startsWith('//')) return null
  // Some browsers normalise a backslash to a forward slash, so `/\evil.com` is
  // another way to spell protocol-relative.
  if (raw.startsWith('/\\')) return null
  // Bouncing back to a gate would trap the user in a loop.
  if (/^\/(login|signup|pending|set-password)(\/|\?|$)/.test(raw)) return null
  return raw
}
