// Cloudflare Pages Function for /assets/* — the hashed-asset (JS/CSS/fonts/images) path.
//
// Why this exists: a request for a hashed asset that does NOT exist (a not-yet-
// propagated hash during a deploy, or a hash reused across deploys) otherwise falls
// through to the SPA index.html fallback and is served as `200 text/html`. Because
// `_headers` stamps `Cache-Control: immutable` on everything under /assets/*, CF caches
// that bogus `200 text/html immutable` at the EDGE and serves it to every client until a
// manual "Purge Everything" — which is exactly the "Refused to apply style … MIME type
// text/html" breakage on deploy.
//
// Fix: for /assets/* we serve the real static asset (untouched, keeping its immutable
// header so the edge still caches it), but if the asset is missing we return a genuine
// 404 with `Cache-Control: no-store`. A 404 is never applied as a stylesheet and is not
// edge-cached, so the moment the real asset lands, clients get it — no poison, no purge.
//
// SPA routes (/calendar, /login, …) do NOT match /assets/* and are unaffected: they keep
// the normal index.html 200 fallback (see public/_redirects).
export async function onRequest(ctx) {
  const res = await ctx.env.ASSETS.fetch(ctx.request);
  const contentType = res.headers.get('content-type') || '';

  // A hashed asset request that resolved to the HTML fallback (or a 404) does not exist.
  // Real assets are always text/css, application/javascript, font/*, image/*, … never HTML.
  if (res.status === 404 || contentType.includes('text/html')) {
    return new Response('Not found', {
      status: 404,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  }

  return res;
}
