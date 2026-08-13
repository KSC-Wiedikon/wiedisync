import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CookieJar, vmLogin, vmSwitchRole, vmSwitchRoleResult, VM_ROLE_CLUB, VM_ROLE_SPIELPLANER,
} from '../vm-client.mjs';

test('CookieJar stores and serializes cookies', () => {
  const jar = new CookieJar();
  jar.set('language', 'de');
  jar.set('session', 'abc123');
  assert.match(jar.header(), /language=de/);
  assert.match(jar.header(), /session=abc123/);
});

test('CookieJar updates from Set-Cookie response header', () => {
  const jar = new CookieJar();
  const fakeResponse = { headers: { getSetCookie: () => ['Neos_Flow_Session=xyz; Path=/; Secure'] } };
  jar.update(fakeResponse);
  assert.equal(jar.cookies.Neos_Flow_Session, 'xyz');
});

test('the two role ids are distinct — one role cannot serve every job', () => {
  // Club serves teams/writers/referees/games; only Spielplaner serves the bulk
  // address viewer. Collapsing them would silently empty one of the two.
  assert.notEqual(VM_ROLE_CLUB, VM_ROLE_SPIELPLANER);
});

test('vmSwitchRole PUTs the attribute value and csrf as form fields', async () => {
  const jar = new CookieJar();
  jar.set('Neos_Flow_Session', 'xyz');
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200 };
  };
  try {
    assert.equal(await vmSwitchRole(jar, 'tok', VM_ROLE_CLUB), true);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, 'PUT');
  assert.match(calls[0].url, /switchRoleAndAttribute$/);
  const body = new URLSearchParams(calls[0].init.body);
  assert.equal(body.get('attributeValueAsArray[0]'), VM_ROLE_CLUB);
  assert.equal(body.get('__csrfToken'), 'tok');
  assert.match(calls[0].init.headers.Cookie, /Neos_Flow_Session=xyz/);
});

test('vmSwitchRole reports failure instead of throwing', async () => {
  // Best effort by design: the caller's own fetch gives a better error than
  // anything thrown here. It must never take a sync down on its own.
  const jar = new CookieJar();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('network down'); };
  try {
    assert.equal(await vmSwitchRole(jar, 'tok', VM_ROLE_CLUB), false);
  } finally {
    globalThis.fetch = realFetch;
  }
  // A missing token or role is a no-op, not a request.
  assert.equal(await vmSwitchRole(jar, '', VM_ROLE_CLUB), false);
  assert.equal(await vmSwitchRole(jar, 'tok', ''), false);
});

// ── The 4xx/5xx split (2026-08-13) ──────────────────────────────────
// The whole point of vmSwitchRoleResult: a REFUSAL is permanent and must fail
// the login loudly, while a flap must stay best-effort and retryable. Getting
// this backwards is how a wrong role hid inside "VM temporarily unavailable".
test('vmSwitchRoleResult marks a 4xx as refused and a 5xx as not', async () => {
  const jar = new CookieJar();
  const realFetch = globalThis.fetch;
  const respond = (status) => async () => ({ ok: false, status });
  try {
    globalThis.fetch = respond(403);
    assert.deepEqual(await vmSwitchRoleResult(jar, 'tok', VM_ROLE_CLUB),
      { ok: false, status: 403, refused: true });

    globalThis.fetch = respond(400);
    assert.equal((await vmSwitchRoleResult(jar, 'tok', VM_ROLE_CLUB)).refused, true);

    // Server-side wobble — VM's problem, not our permissions. Retryable.
    globalThis.fetch = respond(503);
    assert.deepEqual(await vmSwitchRoleResult(jar, 'tok', VM_ROLE_CLUB),
      { ok: false, status: 503, refused: false });

    // A network error yields no status at all, so it cannot be a refusal.
    globalThis.fetch = async () => { throw new Error('network down'); };
    assert.deepEqual(await vmSwitchRoleResult(jar, 'tok', VM_ROLE_CLUB),
      { ok: false, status: null, refused: false });
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('vmLogin FAILS when the role claim is refused, and says so unmistakably', async () => {
  // Continuing under an unclaimed role is the dangerous branch: the club
  // resources answer 403 (→ deferred → silence), and `indoorplayer` answers 200
  // with the whole federation. So the login must not return a usable jar.
  const realFetch = globalThis.fetch;
  const headers = { getSetCookie: () => [], get: () => '' };
  globalThis.fetch = async (url) => {
    if (String(url).includes('switchRoleAndAttribute')) return { ok: false, status: 403 };
    return { ok: true, status: 200, headers, text: async () => '<html data-csrf-token="tok"></html>' };
  };
  try {
    await assert.rejects(
      vmLogin({ username: 'u', password: 'p' }),
      (e) => /VM_ROLE_DENIED/.test(e.message) && /VM_ROLE_ATTRIBUTE_CLUB/.test(e.message),
    );
    // …but a caller that has a reason to proceed unclaimed can still opt out.
    const jar = await vmLogin({ username: 'u', password: 'p', requireRole: false });
    assert.ok(jar instanceof CookieJar);
    // …and so can one that asks for no role at all.
    assert.ok(await vmLogin({ username: 'u', password: 'p', role: null }) instanceof CookieJar);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('vmSwitchRole stays a boolean wrapper — a refusal is still just false', async () => {
  // Existing callers (vmUseRole, the contacts step) must not start throwing.
  const jar = new CookieJar();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 403 });
  try {
    assert.equal(await vmSwitchRole(jar, 'tok', VM_ROLE_CLUB), false);
  } finally {
    globalThis.fetch = realFetch;
  }
});
