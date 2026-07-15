#!/usr/bin/env node
// Post-deploy frontend asset-reachability gate.
//
// Why this exists: a Cloudflare Pages deploy can go live with the HTML + entry
// chunk present but some *second-level* lazy chunks missing at origin — CF's
// content-addressed upload dedups unchanged vendor chunks (exceljs, jspdf,
// pdfkit, pptxgen …) against a prior deploy, and if those prior blobs were
// GC'd the new deploy references filenames that now 404. The app's client-side
// `chunkReload.ts` can't recover from this: reloading just re-fetches the same
// broken build. It surfaces to users as a dead export button / white-screened
// lazy route (this bit the SQL-workspace Excel export on 2026-07-15).
//
// This script crawls the LIVE build's full chunk graph (index.html → entry →
// every transitively-imported `assets/*.js`) and HEAD-checks each one, so a
// broken/incomplete deploy fails a gate instead of a user. Run it right after a
// prod (or dev) frontend deploy; exits non-zero if any referenced asset 404s.
//
// Usage:
//   node scripts/verify-frontend-assets.mjs [baseUrl]
//   npm run assets:check:prod   # https://wiedisync.kscw.ch
//   npm run assets:check:dev    # https://wiedisync.pages.dev

const BASE = (process.argv[2] || 'https://wiedisync.kscw.ch').replace(/\/+$/, '')
const CONCURRENCY = 10

// Match only the `assets/`-prefixed reference form — the reliable signal that
// Vite/rolldown actually emitted a deployable chunk. Every real code-split chunk
// is enumerated with an `assets/` path in index.html (entry + modulepreload) or
// in a `__vite__mapDeps` array inside a parent chunk, e.g.:
//   "/assets/index-BORPp83Y.js"   /   "assets/App-D3RpFcwe.js"   /   "assets/exceljs.min-us-yg9zz.js"
// The bare relative `./name.js` form is deliberately NOT matched: minified
// vendor bundles (exceljs→uuid, pdfkit→noble-hashes) carry library-internal
// `./v4.js`, `./stringify.js`, `./utils.js` … string literals that are NOT
// emitted chunks and genuinely 404 — matching them produced false positives.
// Basenames may contain dots and dashes (e.g. `exceljs.min-us-yg9zz.js`).
const ASSET_RE = /assets\/([A-Za-z0-9_.$-]+\.(?:js|css))/g

const assetUrl = (name) => `${BASE}/assets/${name}`

function extractAssetNames(text) {
  const names = new Set()
  for (const m of text.matchAll(ASSET_RE)) names.add(m[1])
  return names
}

// Bounded-concurrency map.
async function pool(items, limit, fn) {
  const results = []
  let i = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++
      results[idx] = await fn(items[idx])
    }
  })
  await Promise.all(workers)
  return results
}

async function main() {
  console.log(`▶ Verifying frontend assets at ${BASE}`)

  // 1. Fetch the live index.html fresh (it is served no-store).
  const indexRes = await fetch(`${BASE}/`, { cache: 'no-store', redirect: 'follow' })
  if (!indexRes.ok) {
    console.error(`✗ index.html unreachable: HTTP ${indexRes.status}`)
    process.exit(2)
  }
  const indexHtml = await indexRes.text()

  // 2. BFS the chunk graph. JS chunks are fetched (GET) both to verify they
  //    resolve AND to discover the chunks they import; CSS chunks are leaves,
  //    verified with a cheap HEAD in step 3.
  const jsSeen = new Set()
  const cssSeen = new Set()
  const missing = [] // { name, status, contentType, via }
  const queue = []

  const enqueue = (names, via) => {
    for (const n of names) {
      if (n.endsWith('.css')) { cssSeen.add(n); continue }
      if (!jsSeen.has(n)) { jsSeen.add(n); queue.push({ name: n, via }) }
    }
  }
  enqueue(extractAssetNames(indexHtml), 'index.html')

  while (queue.length) {
    const batch = queue.splice(0, CONCURRENCY)
    await pool(batch, CONCURRENCY, async ({ name, via }) => {
      let res
      try {
        res = await fetch(assetUrl(name), { redirect: 'manual' })
      } catch (e) {
        missing.push({ name, status: `fetch error: ${e.message}`, contentType: '', via })
        return
      }
      const ct = res.headers.get('content-type') || ''
      // The functions/assets handler returns a real 404 for a missing chunk;
      // a text/html body would mean the SPA fallback leaked through (poison).
      if (res.status !== 200 || ct.includes('text/html')) {
        missing.push({ name, status: res.status, contentType: ct, via })
        return
      }
      const body = await res.text()
      enqueue(extractAssetNames(body), name)
    })
  }

  // 3. Verify CSS leaves (HEAD is enough — they import nothing).
  const cssList = [...cssSeen]
  await pool(cssList, CONCURRENCY, async (name) => {
    try {
      const res = await fetch(assetUrl(name), { method: 'HEAD', redirect: 'manual' })
      const ct = res.headers.get('content-type') || ''
      if (res.status !== 200 || ct.includes('text/html')) {
        missing.push({ name, status: res.status, contentType: ct, via: 'css' })
      }
    } catch (e) {
      missing.push({ name, status: `fetch error: ${e.message}`, contentType: '', via: 'css' })
    }
  })

  const total = jsSeen.size + cssSeen.size
  console.log(`  Crawled ${jsSeen.size} JS + ${cssSeen.size} CSS = ${total} referenced assets`)

  if (missing.length) {
    console.error(`\n✗ ${missing.length} referenced asset(s) MISSING at origin — deploy is incomplete:\n`)
    for (const m of missing) {
      console.error(`   ${String(m.status).padEnd(18)} ${m.name}   (referenced by ${m.via})`)
    }
    console.error(`\n→ Redeploy the frontend (fresh CF Pages build re-uploads missing chunks), then re-run this check.`)
    process.exit(1)
  }

  console.log(`✓ All ${total} referenced assets reachable at origin.`)
}

main().catch((e) => {
  console.error('verify-frontend-assets crashed:', e)
  process.exit(2)
})
