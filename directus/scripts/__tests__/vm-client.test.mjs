import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CookieJar, vmSwitchRole, VM_ROLE_CLUB, VM_ROLE_SPIELPLANER,
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
