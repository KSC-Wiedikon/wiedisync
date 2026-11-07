// @vitest-environment happy-dom
//
// Only English ships in the first load; the member's own language is a chunk of its own.
// So English must always work, a switch must wait for its chunk, and a chunk that can't
// load must leave English on screen, never raw keys or a crash.
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'

// A language whose chunk can't be fetched: a stale tab after a deploy, or no signal.
vi.mock('./locales/it', () => { throw new Error('Failed to fetch dynamically imported module') })

import i18n, { i18nReady } from './index'
import de from './locales/de'
import en from './locales/en'
import gsw from './locales/gsw'

type Tree = Record<string, unknown>

/** A key of `from` that `other` doesn't have, so a fallback can be watched. */
function keyMissingIn(other: Record<string, Tree>, from: Record<string, Tree>): [string, string] {
  for (const ns of Object.keys(from)) {
    for (const key of Object.keys(from[ns])) {
      if (typeof from[ns][key] === 'string' && other[ns]?.[key] === undefined) return [ns, key]
    }
  }
  throw new Error('No missing key to test the fallback with')
}

describe('language chunks', () => {
  beforeAll(async () => { await i18nReady })
  afterEach(async () => { await i18n.changeLanguage('en') })

  it('has English from the first moment, without loading anything', () => {
    expect(i18n.getResource('en', 'common', 'save')).toBe((en.common as Tree).save)
    expect(i18n.getFixedT('en', 'common')('save')).toBe((en.common as Tree).save)
  })

  it('knows every namespace, including one the old list had left out', () => {
    expect(i18n.options.ns).toEqual(Object.keys(en))
    expect(i18n.options.ns).toContain('teamLinks')
  })

  it('switches only once the language is in, so nothing flashes half-translated', async () => {
    const switching = i18n.changeLanguage('de')
    expect(i18n.language).toBe('en')
    await switching
    expect(i18n.language).toBe('de')
    expect(i18n.t('common:save')).toBe((de.common as Tree).save)
    expect(i18n.t('common:save')).not.toBe((en.common as Tree).save)
  })

  it('keeps English exports English while the app runs in another language', async () => {
    await i18n.changeLanguage('de')
    expect(i18n.getFixedT('en', 'common')('save')).toBe((en.common as Tree).save)
  })

  it('reads gsw, then German, then English', async () => {
    await i18n.changeLanguage('gsw')
    const [deNs, deKey] = keyMissingIn(gsw as Record<string, Tree>, de as Record<string, Tree>)
    expect(i18n.t(`${deNs}:${deKey}`)).toBe((de as Record<string, Tree>)[deNs][deKey])
    const [enNs, enKey] = keyMissingIn(de as Record<string, Tree>, en as Record<string, Tree>)
    if ((gsw as Record<string, Tree>)[enNs]?.[enKey] === undefined) {
      expect(i18n.t(`${enNs}:${enKey}`)).toBe((en as Record<string, Tree>)[enNs][enKey])
    }
  })

  it('falls back to English when a language chunk cannot be fetched', async () => {
    await expect(i18n.changeLanguage('it')).resolves.toBeDefined()
    expect(i18n.t('common:save')).toBe((en.common as Tree).save)
  })

  it('falls back to English for a language it has never heard of', async () => {
    await i18n.changeLanguage('xx')
    expect(i18n.t('common:save')).toBe((en.common as Tree).save)
  })
})
