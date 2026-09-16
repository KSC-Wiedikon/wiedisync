/* Boot watchdog — runs from the HTML, BEFORE the app bundle.
 *
 * Why: on 2026-09-16 two members opened a password-reset link and the page
 * "took forever and timed out"; 25 minutes later the same link worked. Nothing
 * from those page loads reached Directus and other members booted fine in
 * between, so the stall sat between "HTML arrived" and "React mounted" — the
 * one window in which the app's own error reporter (part of the bundle) does
 * not exist yet. This file is the reporter for that window.
 *
 * What it does: measures from navigation start. main.tsx calls
 * window.__kscwBootWatchdog.booted() after the first React commit.
 *   - no mount within STALL_MS      → `boot_stall` (error): resource timings so
 *     far (which asset was pending, for how long, HTTP status), connection
 *     type, online state, script/stylesheet load errors.
 *   - mount after a stall           → `boot_recovered` (warn), total time.
 *   - mount slower than SLOW_MS     → `boot_slow` (warn), same timings.
 *   - tab left ≥ ABANDON_MS before mounting → `boot_abandoned` (warn).
 * Reports go to the error-log collector (`POST /kscw/client-error`, anonymous
 * accepted) and are queued in localStorage FIRST: if the network itself is
 * what's stalled, the delivery dies too, and the queue is flushed on the next
 * successful boot — the 25-minutes-later click that "worked like a charm"
 * delivers the evidence of the click that didn't.
 *
 * Deliberately a plain external script (CSP: script-src has no
 * 'unsafe-inline'), ES5, no dependencies, never throws, never blocks. It does
 * nothing on localhost and sends nothing on a normal (< SLOW_MS) load.
 */
(function () {
  'use strict'
  if (typeof window === 'undefined' || !window.performance || typeof fetch !== 'function') return
  var host = window.location.hostname
  if (host === 'localhost' || host === '127.0.0.1' || /\.local$/.test(host)) return

  var STALL_MS = 15000
  var SLOW_MS = 8000
  var ABANDON_MS = 5000
  var QUEUE_KEY = 'kscw-boot-watchdog-queue'
  var QUEUE_MAX = 5
  var RESOURCE_MAX = 20

  // Same pinning as src/lib/api.ts: the prod hostnames talk to prod Directus,
  // every other origin (dev, pages.dev previews) to dev.
  var isProd = host === 'wiedisync.kscw.ch' || host === 'spielplanung.wiedisync.kscw.ch'
  var collector = (isProd ? 'https://directus.kscw.ch' : 'https://directus-dev.kscw.ch') + '/kscw/client-error'

  var booted = false
  var stalled = false
  var loadErrors = []
  var inFlight = {}

  // Elapsed since navigation start, not since this script ran: a slow HTML
  // response is part of what the member waited for, and the navigation entry
  // below says how much of the total it was.
  function elapsed() { return Math.round(performance.now()) }

  // Never let a URL carry a secret into the log: reset links are
  // `/set-password?token=…`, invites `/signup?token=…`. Query strings and
  // fragments are dropped wholesale and long hex path segments masked (same
  // rule as redactTokens in src/lib/sentry.ts).
  function scrubUrl(u) {
    try {
      u = String(u).split('#')[0].split('?')[0]
      return u.replace(/\/[0-9a-f]{16,}(?![0-9a-f])/gi, '/:token')
    } catch (e) { return '' }
  }
  function relative(u) { return scrubUrl(u).replace(window.location.origin, '') }

  function resourceTimings() {
    try {
      var list = performance.getEntriesByType('resource') || []
      var out = []
      for (var i = 0; i < list.length && out.length < RESOURCE_MAX; i++) {
        var r = list[i]
        var item = { u: relative(r.name), ms: Math.round(r.duration), b: r.transferSize || 0 }
        if (r.responseStart) item.ttfb = Math.round(r.responseStart - r.startTime)
        if (typeof r.responseStatus === 'number') item.s = r.responseStatus
        out.push(item)
      }
      return out
    } catch (e) { return null }
  }

  // The Performance API lists only COMPLETED fetches, so at stall time the
  // one asset that matters is the one missing from it. Diff the document's
  // script/stylesheet/preload elements against the completed entries: what is
  // left is what the browser is still waiting for (or gave up on).
  function pendingAssets() {
    try {
      var done = {}
      var list = performance.getEntriesByType('resource') || []
      for (var i = 0; i < list.length; i++) done[list[i].name] = true
      var els = document.querySelectorAll('script[src], link[rel="stylesheet"][href], link[rel="modulepreload"][href]')
      var out = []
      for (var j = 0; j < els.length && out.length < RESOURCE_MAX; j++) {
        var url = els[j].src || els[j].href
        if (url && !done[url]) out.push(relative(url))
      }
      return out
    } catch (e) { return null }
  }

  function navigationTiming() {
    try {
      var n = (performance.getEntriesByType('navigation') || [])[0]
      if (!n) return null
      return {
        type: n.type,
        proto: n.nextHopProtocol || null,
        ttfb: Math.round(n.responseStart),
        resp_end: Math.round(n.responseEnd),
        dcl: Math.round(n.domContentLoadedEventEnd),
        load: Math.round(n.loadEventEnd),
        b: n.transferSize || 0,
      }
    } catch (e) { return null }
  }

  function connectionInfo() {
    try {
      var c = navigator.connection || navigator.mozConnection || navigator.webkitConnection
      if (!c) return null
      return { type: c.effectiveType || null, rtt: c.rtt, down: c.downlink, save: !!c.saveData }
    } catch (e) { return null }
  }

  function snapshot() {
    return {
      at: new Date().toISOString(),
      elapsed_ms: elapsed(),
      online: navigator.onLine,
      visibility: document.visibilityState,
      ready: document.readyState,
      standalone: !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches),
      sw: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
      conn: connectionInfo(),
      nav: navigationTiming(),
      res: resourceTimings(),
      pending: pendingAssets(),
      errors: loadErrors.slice(0, 10),
    }
  }

  function readQueue() {
    try {
      var q = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]')
      return Array.isArray(q) ? q : []
    } catch (e) { return [] }
  }
  function writeQueue(q) {
    try {
      if (q.length) localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-QUEUE_MAX)))
      else localStorage.removeItem(QUEUE_KEY)
    } catch (e) { /* storage unavailable — delivery below is best effort */ }
  }
  function dropFromQueue(id) {
    writeQueue(readQueue().filter(function (e) { return e.id !== id }))
  }

  // credentials: 'include' so a signed-in member's stall is attributed to them,
  // like every other client-error post. keepalive so a `pagehide` report
  // survives the unload. A 429 counts as delivered — the collector saw it.
  function deliver(entry) {
    if (inFlight[entry.id]) return
    inFlight[entry.id] = true
    var body = JSON.stringify({
      event: entry.event,
      level: entry.level,
      error: entry.error,
      page: entry.page,
      userAgent: entry.ua,
      payload: entry.payload,
    })
    try {
      fetch(collector, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        keepalive: true,
      }).then(function (res) {
        delete inFlight[entry.id]
        if (res.ok || res.status === 429) dropFromQueue(entry.id)
      }, function () { delete inFlight[entry.id] })
    } catch (e) { delete inFlight[entry.id] }
  }

  function report(event, level, error) {
    var entry = {
      id: String(Date.now()) + '-' + Math.random().toString(36).slice(2, 8),
      event: event,
      level: level,
      error: error,
      page: scrubUrl(window.location.pathname),
      ua: navigator.userAgent,
      payload: snapshot(),
    }
    // Queue first, deliver second: if the network is the thing that is
    // stalled, the delivery dies and the entry survives for the next boot.
    var q = readQueue()
    q.push(entry)
    writeQueue(q)
    deliver(entry)
  }

  function flushQueue() {
    readQueue().forEach(function (entry) {
      if (inFlight[entry.id]) return
      entry.payload = entry.payload || {}
      if (!entry.payload.deferred) {
        entry.payload.deferred = true
        entry.error = String(entry.error || '') + ' — deferred from ' + (entry.payload.at || 'an earlier page load')
      }
      deliver(entry)
    })
  }

  // Script / stylesheet / module load failures fire `error` on the element and
  // only reach window in the capture phase. Before boot they are the likeliest
  // reason for a blank page: a chunk 404 answered with index.html, a blocked
  // host, "Failed to fetch dynamically imported module".
  window.addEventListener('error', function (ev) {
    if (booted) return
    try {
      var target = ev.target
      var src = target && target !== window && (target.src || target.href)
      if (src) loadErrors.push({ tag: String(target.tagName || '').toLowerCase(), u: relative(src) })
      else if (ev.message) loadErrors.push({ msg: String(ev.message).slice(0, 200) })
    } catch (e) { /* ignore */ }
  }, true)
  window.addEventListener('unhandledrejection', function (ev) {
    if (booted) return
    try {
      var r = ev.reason
      loadErrors.push({ msg: String((r && r.message) || r).slice(0, 200) })
    } catch (e) { /* ignore */ }
  })

  // The HTML itself may already have eaten the budget (edge stall): then the
  // timer fires at once and a mount a second later reads as boot_recovered
  // with the navigation entry showing where the time went.
  var timer = setTimeout(function () {
    if (booted) return
    stalled = true
    report('boot_stall', 'error', 'App did not mount within ' + (STALL_MS / 1000) + 's of navigation')
  }, Math.max(0, STALL_MS - performance.now()))

  window.addEventListener('pagehide', function () {
    if (booted || stalled) return
    var ms = elapsed()
    if (ms < ABANDON_MS) return
    report('boot_abandoned', 'warn', 'Page left after ' + Math.round(ms / 1000) + 's without the app mounting')
  })

  window.__kscwBootWatchdog = {
    booted: function () {
      if (booted) return
      booted = true
      clearTimeout(timer)
      var ms = elapsed()
      if (stalled) report('boot_recovered', 'warn', 'App mounted after ' + Math.round(ms / 1000) + 's (stall reported)')
      else if (ms >= SLOW_MS) report('boot_slow', 'warn', 'App mounted after ' + Math.round(ms / 1000) + 's')
      // Let this load's own report go first, then anything an earlier, dead
      // page load left behind.
      setTimeout(flushQueue, 1500)
    },
  }
})()
