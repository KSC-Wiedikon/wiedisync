/**
 * Cloudflare Pages Function — expose the iCal feed under the on-brand host.
 *
 * The calendar feed is a Directus endpoint (directus[-dev].kscw.ch/kscw/ical),
 * but members should only ever see/store the wiedisync host. This transparently
 * PROXIES /kscw/ical (and /kscw/ical/{volleyball,basketball}) to the matching
 * Directus origin — NOT a redirect, so the resolved URL stays on wiedisync,
 * which Apple/Google/Outlook calendar subscriptions handle most reliably.
 *
 * Query strings pass through untouched, so this also covers the personal
 * feed (?source=duties&token=…). Any other /kscw/* path — and any non-GET —
 * falls through to the app via context.next(), unchanged.
 */
const ICAL_PATH = /^\/kscw\/ical(?:\/(?:volleyball|basketball))?\/?$/

export async function onRequest(context) {
  const { request, next } = context
  const url = new URL(request.url)

  if (!ICAL_PATH.test(url.pathname) || (request.method !== 'GET' && request.method !== 'HEAD')) {
    return next()
  }

  // Prod hosts talk to prod Directus; every preview/dev host
  // (wiedisync.pages.dev, *.pages.dev) uses dev Directus. Mirrors src/lib/api.ts,
  // which pins TWO prod hosts — this checked only one, so the Spielplanung host
  // would have been routed at DEV Directus (audit 2026-08-08, finding 36).
  // Unreachable today (the only iCal URL builder sits on an unrouted page), but
  // the next host added to api.ts's isProd regresses here silently otherwise.
  const PROD_HOSTS = new Set(['wiedisync.kscw.ch', 'spielplanung.wiedisync.kscw.ch'])
  const directusOrigin = PROD_HOSTS.has(url.hostname)
    ? 'https://directus.kscw.ch'
    : 'https://directus-dev.kscw.ch'

  let upstream
  try {
    upstream = await fetch(directusOrigin + url.pathname + url.search, {
      method: 'GET',
      headers: { Accept: 'text/calendar, text/plain, */*' },
    })
  } catch {
    return new Response('Calendar feed unavailable', { status: 502 })
  }

  // Re-emit only the calendar-relevant headers; copying the full set can carry a
  // content-encoding that no longer matches the re-streamed (already-decoded) body.
  const headers = new Headers()
  const ct = upstream.headers.get('content-type')
  if (ct) headers.set('content-type', ct)
  const cd = upstream.headers.get('content-disposition')
  if (cd) headers.set('content-disposition', cd)
  // Only cache a SUCCESSFUL feed. A 502 from the tunnel during
  // `ext:deploy:prod`'s container restart is a *successful* fetch() — the catch
  // above never fires — so this relayed the error with an explicit one-hour
  // freshness directive, and subscribing calendar clients stopped re-polling for
  // up to 60 minutes after Directus was healthy again (audit 2026-08-08,
  // finding 36). Self-healing, but the wait is the deploy window multiplied.
  if (upstream.ok) {
    headers.set('cache-control', 'public, max-age=3600')
  } else {
    headers.set('cache-control', 'no-store')
  }

  return new Response(upstream.body, { status: upstream.status, headers })
}
