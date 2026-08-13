// Deploy gate for directus/extensions/ — catches the class of bug that ships
// green today.
//
// Why this exists. These extensions are plain ESM. `npm run build` (tsc -b) is
// the repo's type gate but it does not see this directory AT ALL, and the
// documented per-file check, `node --check`, validates SYNTAX ONLY. An
// identifier that is never bound is legal JavaScript right up until it
// executes, so nothing in the chain could catch one.
//
// On 2026-08-13 that cost us `/admin/clubdesk-sync`: the `/clubdesk-group-sync`
// handler read a `season` it never declared (its sibling handlers each declare
// their own, in different scopes). It threw `ReferenceError` on every call and
// had done so since the feature shipped. Because the throw happened inside a
// `.map()` while building the response, one uncomputable field took the whole
// `res.json()` with it — nine working checks were unreachable.
//
// This config is deliberately SELF-CONTAINED — no `globals` package, no preset
// imports. `deploy-extensions.sh` runs it against the `git archive` export in a
// temp dir outside the repo, where anything it tried to import would not
// resolve.
//
// Scope note: `no-undef` only. It is the rule that catches the above, and it is
// quiet — the whole tree passes clean. Resist adding stylistic rules here; a
// noisy gate gets bypassed, and this one blocks deploys.

// Node/web globals available in the Directus extension runtime. Anything absent
// here reports as a false `no-undef`, so keep it complete rather than minimal.
const NODE_GLOBALS = [
  // core
  'process', 'console', 'Buffer', 'global', 'globalThis', 'structuredClone',
  '__dirname', '__filename', 'module', 'require', 'exports',
  // timers
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'setImmediate', 'clearImmediate', 'queueMicrotask',
  // fetch/web platform (Node >= 18)
  'fetch', 'Headers', 'Request', 'Response', 'FormData', 'Blob', 'File',
  'AbortController', 'AbortSignal', 'Event', 'EventTarget',
  'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder',
  'ReadableStream', 'WritableStream', 'TransformStream',
  'CompressionStream', 'DecompressionStream',
  'MessageChannel', 'MessagePort', 'BroadcastChannel',
  // misc
  'crypto', 'performance', 'navigator', 'atob', 'btoa', 'WebAssembly', 'Intl',
]

export default [
  {
    files: ['**/*.js', '**/*.mjs'],
    ignores: ['**/node_modules/**', '**/dist/**'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: Object.fromEntries(NODE_GLOBALS.map((g) => [g, 'readonly'])),
    },
    rules: {
      'no-undef': 'error',
    },
  },
]
