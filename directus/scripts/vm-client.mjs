/**
 * Volleymanager Auth Client
 *
 * Shared authentication primitives for volleymanager.volleyball.ch.
 * Pure module — reads no env vars; callers pass credentials explicitly.
 */

export const VM_BASE = 'https://volleymanager.volleyball.ch';
export const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';

// ─── Cookie jar ──────────────────────────────────────────────────────
export class CookieJar {
  constructor() { this.cookies = {}; }
  update(r) {
    for (const h of r.headers.getSetCookie?.() ?? []) {
      const m = h.match(/^([^=]+)=([^;]*)/);
      if (m) this.cookies[m[1]] = m[2];
    }
  }
  set(n, v) { this.cookies[n] = v; }
  header() { return Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; '); }
}

// ─── HTTP helpers ────────────────────────────────────────────────────
export async function follow(url, jar, init = {}, max = 10) {
  let u = url, opts = init;
  for (let i = 0; i < max; i++) {
    const r = await fetch(u, {
      ...opts,
      headers: { 'User-Agent': UA, Cookie: jar.header(), ...(opts.headers ?? {}) },
      redirect: 'manual',
    });
    jar.update(r);
    const body = await r.text();
    const loc = r.headers.get('location') || '';
    if (r.status >= 300 && r.status < 400 && loc) {
      u = loc.startsWith('http') ? loc : `${VM_BASE}${loc}`;
      opts = {};
      continue;
    }
    return { response: r, body };
  }
  throw new Error(`Too many redirects: ${url}`);
}

// ─── Auth ────────────────────────────────────────────────────────────
export async function vmLogin({ username, password }) {
  if (!username || !password) throw new Error('vmLogin: username and password are required');

  const jar = new CookieJar();
  jar.set('language', 'de');

  // 1. Login page → hidden fields
  const { body: html } = await follow(`${VM_BASE}/login`, jar);
  const fields = {};
  for (const m of html.matchAll(/name="([^"]+)"[^>]*value="([^"]*?)"/g))
    fields[m[1]] = m[2];
  fields['__authentication[Neos][Flow][Security][Authentication][Token][UsernamePassword][username]'] = username;
  fields['__authentication[Neos][Flow][Security][Authentication][Token][UsernamePassword][password]'] = password;

  // 2. POST credentials
  await follow(`${VM_BASE}/sportmanager.security/authentication/authenticate`, jar, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });

  // 3. Dashboard (sets session permissions)
  await follow(`${VM_BASE}/`, jar);

  // 4. Enter the volleyball sub-app context. Without this step every indoor
  // page except /sportmanager.indoorvolleyball/game/index returns 403 — the
  // session is authenticated but has no sub-app scope. Discovered 2026-05-03.
  await follow(`${VM_BASE}/sportmanager.volleyball/main/dashboard`, jar);

  return jar;
}

// ─── Socket.IO window registration (the write gate) ──────────────────
// VolleyManager gates state-changing writes (updateGame) on the windowUniqueId
// being a LIVE, registered editing window — the SPA establishes this over its
// socket.io presence channel (:8443) on page load. A headless session that only
// scrapes csrf + Window-Unique-Id never registers, so reads pass but writes are
// denied at the security layer with a 403 "Access denied" HTML page. This
// replicates the Engine.IO v4 polling handshake (open → namespace CONNECT)
// carrying our windowUniqueId, marking the window active just before we write.
// The Engine.IO session has a ~20s ping timeout, so call this immediately before
// the update. Discovered via browser HAR 2026-06-22.
export const VM_WS_BASE = 'https://volleymanager.volleyball.ch:8443';
const randKey = (n) => {
  const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < n; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
};
export async function registerWindow(jar, windowUniqueId) {
  if (!windowUniqueId) throw new Error('registerWindow: windowUniqueId required');
  const sessionKey = randKey(32);
  const base = `${VM_WS_BASE}/socket.io/`;
  const H = { 'User-Agent': UA, Cookie: jar.header(), Accept: '*/*', Origin: VM_BASE, Referer: `${VM_BASE}/sportmanager.indoorvolleyball/game/index` };
  const qs = (extra = {}) => new URLSearchParams({ sessionKey, windowUniqueId, EIO: '4', transport: 'polling', t: Date.now().toString(36) + randKey(4), ...extra }).toString();
  // 1. Engine.IO open → sid
  const open = await fetch(`${base}?${qs()}`, { headers: H });
  if (!open.ok) throw new Error(`socket.io open HTTP ${open.status}`);
  const openTxt = await open.text();
  const m = openTxt.match(/^0(\{[\s\S]*\})/);
  const sid = m ? JSON.parse(m[1]).sid : null;
  if (!sid) throw new Error(`socket.io: no sid in "${openTxt.slice(0, 80)}"`);
  // 2. Socket.IO namespace CONNECT packet ("40")
  const conn = await fetch(`${base}?${qs({ sid })}`, { method: 'POST', headers: { ...H, 'Content-Type': 'text/plain;charset=UTF-8' }, body: '40' });
  if (!conn.ok) throw new Error(`socket.io connect HTTP ${conn.status}`);
  // 3. Poll once for the namespace ack — the server registers the window here.
  await fetch(`${base}?${qs({ sid })}`, { headers: H }).catch(() => {});
  return { sessionKey, sid };
}

// ─── CSRF extraction ─────────────────────────────────────────────────
export async function csrfFromPage(jar, pagePath) {
  const { response, body } = await follow(
    `${VM_BASE}${pagePath}`,
    jar,
    { headers: { Accept: 'text/html', Referer: `${VM_BASE}/` } },
  );
  if (!response.ok) throw new Error(`csrfFromPage ${pagePath} → HTTP ${response.status}`);
  const csrf = body.match(/data-csrf-token="([^"]+)"/)?.[1];
  const wuid = body.match(/data-window-unique-id="([^"]+)"/)?.[1] || '';
  if (!csrf) throw new Error(`CSRF token extraction failed for ${pagePath}`);
  return { csrf, wuid };
}
