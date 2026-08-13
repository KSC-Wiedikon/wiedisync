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

// ─── Roles ───────────────────────────────────────────────────────────
// VolleyManager keeps ONE active role per *account*, not per session, and it
// persists across logins — a fresh login inherits whatever was last selected,
// by a human in the VM UI or by another program. We share this account with
// svrz_rc (same VM_USERNAME), whose two syncs each switch it to a referee-admin
// role and leave it there. Under that role every resource below answers 403,
// and vm-sync-check treats a 403 as a transient "VM bad window" and defers
// silently — so the sync would go stale without anything surfacing it.
//
// Measured 2026-08-13 against the production account (403 = denied,
// 200:n = allowed, n rows):
//
//   role                                   team    writer  referee  game    spielplaner
//   SportManager.Indoorvolleyball:Club #1   200:67  200:120 200:13   200:1573 200:0
//   SportManager.Indoorvolleyball:Club #2   200:67  403     403      200:1573 200:130
//   SportManager.Indoorvolleyball:Team      200:1   403     403      200:10   403
//   Indoorvolleyball.RefAdmin (svrz games)  403     403     403      200:1573 403
//
// So Club #1 is the one role that serves every job we run EXCEPT the bulk
// Spielplaner address list, which only Club #2 serves — and note Club #1
// answers that one 200 with ZERO rows rather than 403, i.e. the wrong role
// there reads as "no contacts", not as an error. Hence two ids, and hence
// every job claims the one it needs instead of trusting what it inherits.
//
// The value is an *attribute value* id, not a role name: the
// `persistenceObjectIdentifier` of an entry in the party's
// `eligibleAttributeValues` (embedded in the dashboard's `:active-party`
// payload). They are per-account, so if VM_USERNAME changes, re-read them
// there and set these env vars.
export const VM_ROLE_CLUB = process.env.VM_ROLE_ATTRIBUTE_CLUB
  || '4cdade68-1c1a-49f4-9357-e35c540d3b89'; // SportManager.Indoorvolleyball:Club
export const VM_ROLE_SPIELPLANER = process.env.VM_ROLE_ATTRIBUTE_SPIELPLANER
  || 'ed24d37c-5444-4c5d-b602-623eff84d400'; // SportManager.Indoorvolleyball:Club (Spielplan addresses)

/** CSRF token from the dashboard, which opens under every role. */
export async function vmDashboardCsrf(jar) {
  const { body } = await follow(`${VM_BASE}/`, jar, { headers: { Accept: 'text/html' } });
  return body.match(/data-csrf-token="([^"]+)"/)?.[1] ?? '';
}

/**
 * Point the account at a role, reporting HOW it failed.
 *
 * The distinction is the whole point: a **4xx refusal** means VM will not give
 * this account that role — retrying cannot fix it, and every resource the role
 * gates will answer 403 for the rest of the run. A 5xx or a network error is
 * VM being VM, and the caller's own retry handles it. Collapsing the two is
 * what let a wrong role masquerade as a bad window (2026-08-13).
 *
 * ⚠ There is no way to READ the active role back: the dashboard's
 * `:active-party` payload carries `activeAttributeValue: null` /
 * `activeRoleIdentifier: ""` prototypes only (probed 2026-08-13), so the
 * refusal status is the only evidence available. Absence of a refusal is NOT
 * proof we hold the role — it is only proof VM did not say no.
 *
 * @returns {Promise<{ ok: boolean, status: number|null, refused: boolean }>}
 *   `refused` = VM answered 4xx, i.e. permanently denied.
 */
export async function vmSwitchRoleResult(jar, csrf, attributeValueId) {
  if (!attributeValueId || !csrf) return { ok: false, status: null, refused: false };
  try {
    const body = new URLSearchParams();
    body.set('attributeValueAsArray[0]', attributeValueId);
    body.set('__csrfToken', csrf);
    const r = await fetch(`${VM_BASE}/api/sportmanager.security/api%5cparty/switchRoleAndAttribute`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: '*/*',
        Origin: VM_BASE,
        Referer: `${VM_BASE}/`,
        'User-Agent': UA,
        Cookie: jar.header(),
      },
      body: body.toString(),
    });
    if (!r.ok) {
      console.warn(`[vm] role switch to ${attributeValueId} returned ${r.status}`);
      return { ok: false, status: r.status, refused: r.status >= 400 && r.status < 500 };
    }
    return { ok: true, status: r.status, refused: false };
  } catch (err) {
    console.warn(`[vm] role switch to ${attributeValueId} failed: ${err.message}`);
    return { ok: false, status: null, refused: false };
  }
}

/**
 * Point the account at a role. Best effort: on failure the caller's own fetch
 * reports a clearer error than anything thrown here, and the account may
 * already be on the right role, in which case the switch was unnecessary.
 * Returns true only if VM accepted it.
 */
export async function vmSwitchRole(jar, csrf, attributeValueId) {
  return (await vmSwitchRoleResult(jar, csrf, attributeValueId)).ok;
}

/** Fetch a dashboard CSRF and claim `roleId`. Use mid-run to change roles. */
export async function vmUseRole(jar, roleId) {
  return vmSwitchRole(jar, await vmDashboardCsrf(jar), roleId);
}

// ─── Auth ────────────────────────────────────────────────────────────
export async function vmLogin({ username, password, role = VM_ROLE_CLUB, requireRole = true }) {
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

  // 3. Dashboard (sets session permissions). It opens under every role and
  // carries the CSRF token that lets us ask for the role we actually need.
  const { body: dashboard } = await follow(`${VM_BASE}/`, jar);

  // 3b. Claim the role. Before entering the sub-app, so step 4 establishes the
  // sub-app scope under the role we intend to use rather than the one this
  // account happened to be left on. See VM_ROLE_CLUB above.
  //
  // A 4xx REFUSAL fails the login outright (`requireRole`, the default). It is
  // not defensible to continue: under the wrong role this account gets 403 on
  // every club resource — or, worse, 200 with the WRONG SCOPE (`indoorplayer`
  // answers 170'736 federation-wide rows instead of KSCW's 258). Failing here
  // costs one run; continuing risks storing another club's data as ours. The
  // `VM_ROLE_DENIED` marker is what stops `vm-sync-check` from filing the
  // resulting 403s as a transient VM window and going quiet about them.
  if (role) {
    const claim = await vmSwitchRoleResult(jar, dashboard.match(/data-csrf-token="([^"]+)"/)?.[1] ?? '', role);
    if (claim.refused && requireRole) {
      throw new Error(`VM_ROLE_DENIED: VolleyManager refused role ${role} (HTTP ${claim.status}). `
        + 'Retrying cannot fix this — re-read the role ids off the dashboard\'s :active-party '
        + 'payload (they are per account, so a VM_USERNAME change invalidates them) and set '
        + 'VM_ROLE_ATTRIBUTE_CLUB / VM_ROLE_ATTRIBUTE_SPIELPLANER.');
    }
  }

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
  // 3. Poll once for the namespace ack ("40{sid}").
  await fetch(`${base}?${qs({ sid })}`, { headers: H }).catch(() => {});
  // 4. UPGRADE to WebSocket and KEEP IT OPEN. Since ~2026-06-25 VolleyManager
  //    requires the editing window to be a LIVE websocket (not just the polling
  //    registration the 06-22 fix did) before it accepts a write — polling-only now
  //    yields 403 "Access denied" again. Confirmed via browser HAR 2026-06-28: the
  //    winning updateGame's window did the Engine.IO upgrade (2probe→3probe→5) and
  //    held the socket open. Node 22 global WebSocket; the headers option carries
  //    the auth cookie + Origin. The CALLER MUST close the returned socket after the
  //    write (it answers server pings until then).
  const wsUrl = `${base.replace(/^http/, 'ws')}?${qs({ sid, transport: 'websocket' })}`;
  const ws = new WebSocket(wsUrl, { headers: { Cookie: jar.header(), Origin: VM_BASE, 'User-Agent': UA } });
  await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('ws upgrade timeout')), 10000);
    ws.addEventListener('open', () => ws.send('2probe'));
    ws.addEventListener('message', (ev) => {
      const d = String(ev.data);
      if (d === '3probe') { ws.send('5'); clearTimeout(to); resolve(); } // Engine.IO upgrade done
      else if (d === '2') ws.send('3');                                  // ping → pong (keep-alive)
    });
    ws.addEventListener('error', (e) => { clearTimeout(to); reject(new Error(`ws upgrade error: ${e?.message || 'unknown'}`)); });
  });
  return { sessionKey, sid, ws };
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
