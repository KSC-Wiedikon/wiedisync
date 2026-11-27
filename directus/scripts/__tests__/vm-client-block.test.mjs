// The block pause in vm-client.mjs: VolleyManager's web server refuses
// kscw-server (since 25.11.2026) with its stock 403 page. The first such page
// must stop every VolleyManager call (all processes, via a file) instead of
// letting the crons keep knocking; the app's own role 403 must not trip it.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'vm-block-test-'));
process.env.VM_BLOCK_FILE = join(dir, 'blocked-until');
const { follow, vmLogin, CookieJar, vmBlockedUntil, isWebServerBlock, VmBlockedError, VM_BLOCK_PAUSE_MS } = await import('../vm-client.mjs');

const realFetch = globalThis.fetch;
let calls = 0;
const answer = (status, body) => { globalThis.fetch = async () => { calls++; return new Response(body, { status }); }; };
const BLOCK_PAGE = '<!DOCTYPE HTML PUBLIC "-//IETF//DTD HTML 2.0//EN">\n<html><head>\n<title>403 Forbidden</title>\n</head><body><h1>Forbidden</h1></body></html>';

beforeEach(() => { calls = 0; rmSync(process.env.VM_BLOCK_FILE, { force: true }); });
after(() => { globalThis.fetch = realFetch; rmSync(dir, { recursive: true, force: true }); });

test('the web server 403 page stops every VolleyManager call, without another request', async () => {
  answer(403, BLOCK_PAGE);
  await assert.rejects(follow('https://vm.test/login', new CookieJar()), VmBlockedError);
  assert.ok(existsSync(process.env.VM_BLOCK_FILE), 'the pause is shared through the file');
  assert.ok(vmBlockedUntil() > Date.now() + VM_BLOCK_PAUSE_MS - 60_000);
  // the next job — another process would read the same file — logs in no more
  await assert.rejects(vmLogin({ username: 'u', password: 'p' }), VmBlockedError);
  assert.equal(calls, 1);
});

test("the app's own role 403 is just an answer", async () => {
  answer(403, '{"error":"access denied"}');
  const { response } = await follow('https://vm.test/api/x', new CookieJar());
  assert.equal(response.status, 403);
  assert.equal(vmBlockedUntil(), 0);
});

test('once the pause has run out, the next call is the one probe', async () => {
  writeFileSync(process.env.VM_BLOCK_FILE, String(Date.now() - 1));
  answer(200, '<html>login</html>');
  const { response } = await follow('https://vm.test/login', new CookieJar());
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
});

test('isWebServerBlock reads the page, not just the status', () => {
  assert.equal(isWebServerBlock(403, BLOCK_PAGE), true);
  assert.equal(isWebServerBlock(403, 'Forbidden'), false);
  assert.equal(isWebServerBlock(200, BLOCK_PAGE), false);
});
