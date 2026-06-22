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

  // Prod is the only host that talks to prod Directus; every preview/dev host
  // (wiedisync.pages.dev, *.pages.dev) uses dev Directus. Mirrors src/lib/api.ts.
  const directusOrigin = url.hostname === 'wiedisync.kscw.ch'
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
  headers.set('cache-control', 'public, max-age=3600')

  return new Response(upstream.body, { status: upstream.status, headers })
}
