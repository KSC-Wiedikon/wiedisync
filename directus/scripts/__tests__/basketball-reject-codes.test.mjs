/**
 * Every basketball slot reject code must be renderable.
 *
 * WHY THIS EXISTS
 * ---------------
 * Migration 285 added the hard Spielsamstage filter and with it a 14th reject code,
 * `not_a_spielsamstag`. The engine shipped; the UI did not. The per-team table renders
 * `t(`reject_${code}`)`, so i18next fell back to the key itself and the operator saw
 *
 *     reject_not_a_spielsamstag · 196
 *
 * in the "Main reasons for dropping" column — the single most-hit reason for every team.
 *
 * ⚠ The locale parity check (en vs de/fr/it/gsw) could NOT catch this: the key was absent
 * from all five locales equally, so they agreed perfectly with each other while agreeing
 * with the code not at all. The authority is REJECT_CODES in the endpoint, which is why
 * this test reads from there and compares outward.
 *
 * The locale files are read as TEXT rather than imported — they are TypeScript, and the
 * `node --test` scripts runner has no TS loader. A key look-up is all this needs.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import { REJECT_CODES } from '../../extensions/kscw-endpoints/src/basketball-slots.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../../..')
const LOCALES = ['en', 'de', 'fr', 'it', 'gsw']
const PANEL = resolve(REPO, 'src/modules/gameScheduling/components/BasketballSlotGenerationPanel.tsx')

const codes = Object.values(REJECT_CODES)

test('REJECT_CODES is non-empty and every value is a bare snake_case code', () => {
  assert.ok(codes.length >= 14, `expected at least 14 reject codes, got ${codes.length}`)
  for (const code of codes) {
    assert.match(code, /^[a-z][a-z0-9_]*$/, `reject code "${code}" is not snake_case`)
  }
})

for (const locale of LOCALES) {
  test(`${locale}/basketballScheduling.ts has a reject_* label for every code`, () => {
    const src = readFileSync(resolve(REPO, `src/i18n/locales/${locale}/basketballScheduling.ts`), 'utf8')
    const missing = codes.filter((code) => !new RegExp(`\\breject_${code}\\s*:`).test(src))
    assert.deepEqual(
      missing,
      [],
      `${locale} is missing reject_* labels — the raw key would render in the UI: ${missing.join(', ')}`,
    )
  })
}

test('REJECT_ORDER lists every code, so the tie-break sort never falls back to -1', () => {
  const src = readFileSync(PANEL, 'utf8')
  const block = src.match(/const REJECT_ORDER = \[([\s\S]*?)\]/)
  assert.ok(block, 'REJECT_ORDER not found in BasketballSlotGenerationPanel.tsx')
  const listed = [...block[1].matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1])

  const missing = codes.filter((c) => !listed.includes(c))
  assert.deepEqual(missing, [], `REJECT_ORDER is missing: ${missing.join(', ')}`)

  const stale = listed.filter((c) => !codes.includes(c))
  assert.deepEqual(stale, [], `REJECT_ORDER lists codes the engine no longer emits: ${stale.join(', ')}`)
})
