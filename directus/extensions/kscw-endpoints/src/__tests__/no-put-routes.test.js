/**
 * No /kscw route may be a PUT.
 *
 * Directus answers a CORS preflight with
 * `Access-Control-Allow-Methods: GET,POST,PATCH,DELETE`. Every browser caller of
 * these endpoints is cross-origin — the website admin runs on kscw.ch and talks to
 * directus.kscw.ch — so a PUT route is unreachable from the only client that has
 * one, and the request dies in the browser before it is ever sent.
 *
 * This has to be a *test*, not a convention, because the failure is silent in both
 * directions. The route looks correct in isolation and works from curl (no
 * preflight), and the caller most likely to use it — pushClosesToForms — is written
 * to degrade to a warning rather than fail loudly. That combination hid a broken
 * scorer-course deadline push for weeks: the public card locked while the OpnForm
 * itself kept accepting entries. Two separate sessions rediscovered the same CORS
 * rule from scratch (see the comments on /wadmin/admins/:id and .../closes), which
 * is the sign it belongs in a test rather than in prose.
 *
 * PATCH is the replacement for an update, POST for a create.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Every .js file under `dir`, excluding the tests themselves. */
function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__tests__' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (entry.endsWith('.js')) out.push(full)
  }
  return out
}

describe('no endpoint is registered as PUT', () => {
  const files = walk(SRC)

  it('finds the endpoint sources at all', () => {
    // Guards against the walk silently returning nothing and the test passing empty.
    expect(files.length).toBeGreaterThan(20)
    expect(files.some((f) => f.endsWith('wadmin.js'))).toBe(true)
  })

  it('registers no router.put(...) anywhere', () => {
    const offenders = files
      .filter((f) => /router\s*\.\s*put\s*\(/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f))

    expect(offenders).toEqual([])
  })
})
