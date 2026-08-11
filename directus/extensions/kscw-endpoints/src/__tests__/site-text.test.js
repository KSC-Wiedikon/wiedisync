/**
 * /kscw/site-text value vetting.
 *
 * This is the write side of the kscw-website page-text editor, and it is a genuine
 * security boundary: whatever it stores is rendered on public pages in both
 * languages. The website's build applies a second, semantic gate (the key must
 * exist in the dictionary, placeholders must survive) — only the repo holding the
 * dictionaries can check that. Everything about the *shape* of a value is decided
 * here, and the table's CHECK constraints (migration 309) repeat it in the database.
 */
import { describe, it, expect } from 'vitest'
import { __test } from '../site-text.js'

const { vetValue, KEY_RE, MAX_LEN } = __test

describe('site-text value vetting', () => {
  it('accepts ordinary page copy and trims it', () => {
    expect(vetValue('  An Spielsamstagen bündeln wir Heimspiele.  '))
      .toEqual({ ok: true, value: 'An Spielsamstagen bündeln wir Heimspiele.' })
  })

  it('treats null, undefined, empty and whitespace as "not overridden"', () => {
    // Null is the meaningful state here: the website falls back to its own
    // dictionary, so a language nobody edited keeps improving with the repo.
    for (const raw of [null, undefined, '', '   ', '\t ']) {
      expect(vetValue(raw)).toEqual({ ok: true, value: null })
    }
  })

  it('refuses markup', () => {
    // No innerHTML path exists downstream; if one is ever added by accident, a
    // stored tag would execute in English only (German is escaped at build time),
    // which is invisible to a German-speaking reviewer.
    expect(vetValue('Hallo <b>Welt</b>').ok).toBe(false)
    expect(vetValue('Hallo <b>Welt</b>').error).toBe('markup_not_allowed')
    expect(vetValue('a < b').ok).toBe(false)
  })

  it('refuses control characters, including newlines', () => {
    expect(vetValue('zwei\nZeilen').error).toBe('control_characters')
    expect(vetValue('tab\there').error).toBe('control_characters')
    expect(vetValue('nul\u0000byte').error).toBe('control_characters')
  })

  it('refuses non-strings', () => {
    for (const raw of [42, true, {}, [], () => {}]) {
      expect(vetValue(raw)).toEqual({ ok: false, error: 'value_not_a_string' })
    }
  })

  it('caps the length', () => {
    expect(vetValue('a'.repeat(MAX_LEN)).ok).toBe(true)
    expect(vetValue('a'.repeat(MAX_LEN + 1))).toEqual({ ok: false, error: 'value_too_long' })
  })

  it('keeps the characters German copy actually needs', () => {
    const value = 'Grüezi — «Spielsamstag» 11:00–16:00, ca. 3 × pro Saison … ok?'
    expect(vetValue(value)).toEqual({ ok: true, value })
  })
})

describe('site-text key shape', () => {
  it('accepts the i18n keys the website uses', () => {
    for (const key of ['schedulingSaturdaysText', 'weiteresLogosAltBlue', 'bbTeamFull', 'a']) {
      expect(KEY_RE.test(key)).toBe(true)
    }
  })

  it('refuses anything that could widen a CSS attribute selector', () => {
    // public/js/i18n.js interpolates the key into [data-i18n="…"], so a quote or a
    // bracket here would select elements the key never named.
    for (const key of ['a"],[href', 'has space', 'has-dash', '1leading', '', 'a.b', 'a*']) {
      expect(KEY_RE.test(key)).toBe(false)
    }
  })

  it('caps the key length to the column width', () => {
    expect(KEY_RE.test('a'.repeat(120))).toBe(true)
    expect(KEY_RE.test('a'.repeat(121))).toBe(false)
  })
})
