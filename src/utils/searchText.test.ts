import { describe, it, expect } from 'vitest'
import { matchesSearch, dateSearchText, htmlToSearchText } from './searchText'

describe('searchText', () => {
  it('matches every word, accent- and case-blind, in any order', () => {
    const parts = ['Pizza pre Christmas', 'Da Michelangelo, Zürich', 'H3']
    expect(matchesSearch('zurich pizza', parts)).toBe(true)
    expect(matchesSearch('PIZZA h3', parts)).toBe(true)
    expect(matchesSearch('pizza fondue', parts)).toBe(false)
    expect(matchesSearch('   ', parts)).toBe(true)
  })

  it('finds dates the way people type them', () => {
    const d = dateSearchText('2026-12-11T17:30:00Z')
    for (const q of ['11.12.2026', '11.12.', '11.12', '2026-12-11']) expect(matchesSearch(q, [d])).toBe(true)
    expect(matchesSearch('fri', [d])).toBe(true)
    expect(matchesSearch('12.11', [d])).toBe(false)
  })

  it('searches the text of an HTML description', () => {
    expect(matchesSearch('bring shoes', [htmlToSearchText('<p>Please <b>bring</b> shoes</p>')])).toBe(true)
  })
})
