/**
 * Unit tests for titleCaseName (normalize.js) — the registration write-path
 * display normalizer that capitalizes lazily-typed all-lowercase names and
 * addresses ("janina vanha" → "Janina Vanha") without mangling correctly-typed
 * names or house numbers. Hermetic — pure function, no DB or network.
 */
import { describe, it, expect } from 'vitest'
import { titleCaseName } from '../normalize.js'

describe('titleCaseName', () => {
  it('returns null for empty / whitespace / nullish input', () => {
    expect(titleCaseName('')).toBe(null)
    expect(titleCaseName('   ')).toBe(null)
    expect(titleCaseName(null)).toBe(null)
    expect(titleCaseName(undefined)).toBe(null)
  })

  it('capitalizes the first letter of each word in an all-lowercase name', () => {
    expect(titleCaseName('janina vanha')).toBe('Janina Vanha')
    expect(titleCaseName('anna maria weber')).toBe('Anna Maria Weber')
  })

  it('capitalizes an all-lowercase street address, leaving house numbers intact', () => {
    expect(titleCaseName('rosengartenstrasse 33')).toBe('Rosengartenstrasse 33')
    expect(titleCaseName('8b musterweg')).toBe('8b Musterweg')
  })

  it('capitalizes a lowercase city with an umlaut (Unicode-aware)', () => {
    expect(titleCaseName('zürich')).toBe('Zürich')
    expect(titleCaseName('österreich')).toBe('Österreich')
  })

  it('capitalizes across hyphens, apostrophes, and slashes', () => {
    expect(titleCaseName('mary-jane')).toBe('Mary-Jane')
    expect(titleCaseName("d'angelo")).toBe("D'Angelo")
    expect(titleCaseName('müller-lüdenscheidt')).toBe('Müller-Lüdenscheidt')
  })

  it('leaves the rest of a word as typed — never mangles intentional casing', () => {
    expect(titleCaseName('McDonald')).toBe('McDonald')
    expect(titleCaseName('DeLuca')).toBe('DeLuca')
    // already-correct input is a no-op
    expect(titleCaseName('Janina Vanha')).toBe('Janina Vanha')
  })

  it('trims surrounding whitespace', () => {
    expect(titleCaseName('  janina vanha  ')).toBe('Janina Vanha')
  })

  it('coerces non-string input to string (nullish → null)', () => {
    expect(titleCaseName(5)).toBe('5')
    expect(titleCaseName(0)).toBe('0')
  })
})
