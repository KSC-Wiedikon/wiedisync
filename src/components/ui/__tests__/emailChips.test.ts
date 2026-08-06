import { describe, it, expect } from 'vitest'
import { parseAddressList, serializeChips, hasInvalidAddress, isValidAddress } from '../emailChips'

const emails = (raw: string) => parseAddressList(raw).map((c) => c.email)

describe('parseAddressList', () => {
  it('splits a comma-separated list', () => {
    expect(emails('a@x.ch, b@y.ch')).toEqual(['a@x.ch', 'b@y.ch'])
  })

  it('splits on semicolons and newlines (Outlook / Excel pastes)', () => {
    expect(emails('a@x.ch; b@y.ch\nc@z.ch\r\nd@w.ch')).toEqual(['a@x.ch', 'b@y.ch', 'c@z.ch', 'd@w.ch'])
  })

  it('unwraps display names — the shape the send endpoint would drop', () => {
    const chips = parseAddressList('Luca Canepa <l@x.ch>; Anna <a@y.ch>')
    expect(chips.map((c) => c.email)).toEqual(['l@x.ch', 'a@y.ch'])
    expect(chips.map((c) => c.name)).toEqual(['Luca Canepa', 'Anna'])
    expect(chips.every((c) => !c.invalid)).toBe(true)
  })

  it('keeps a comma inside a quoted display name in one recipient', () => {
    expect(emails('"Canepa, Luca" <l@x.ch>, b@y.ch')).toEqual(['l@x.ch', 'b@y.ch'])
  })

  it('reads a bracket-less name + address as one recipient', () => {
    const [chip] = parseAddressList('Luca Canepa l@x.ch')
    expect(chip).toMatchObject({ email: 'l@x.ch', name: 'Luca Canepa' })
  })

  it('reads several space-separated addresses as several recipients', () => {
    expect(emails('a@x.ch b@y.ch')).toEqual(['a@x.ch', 'b@y.ch'])
  })

  it('lowercases and strips mailto:', () => {
    expect(emails('mailto:Luca@X.CH')).toEqual(['luca@x.ch'])
  })

  it('dedupes case-insensitively', () => {
    expect(emails('a@x.ch, A@X.ch, b@y.ch')).toEqual(['a@x.ch', 'b@y.ch'])
  })

  it('flags what it cannot parse instead of discarding it', () => {
    const chips = parseAddressList('a@x.ch, not-an-address')
    expect(chips).toHaveLength(2)
    expect(chips[1]).toMatchObject({ email: 'not-an-address', invalid: true })
    expect(hasInvalidAddress('a@x.ch, not-an-address')).toBe(true)
    expect(hasInvalidAddress('a@x.ch')).toBe(false)
  })

  it('ignores empty tokens and stray whitespace', () => {
    expect(emails('  , a@x.ch ,,  ; \n')).toEqual(['a@x.ch'])
    expect(emails('')).toEqual([])
    expect(emails(null as unknown as string)).toEqual([])
  })

  it('round-trips to the comma-separated string the endpoint parses', () => {
    expect(serializeChips(parseAddressList('Anna <a@y.ch>;b@x.ch'))).toBe('a@y.ch, b@x.ch')
  })
})

describe('isValidAddress', () => {
  it('matches the send endpoint EMAIL_RE', () => {
    expect(isValidAddress('a@x.ch')).toBe(true)
    expect(isValidAddress(' a@x.ch ')).toBe(true)
    expect(isValidAddress('a@x')).toBe(false)
    expect(isValidAddress('Anna <a@x.ch>')).toBe(false)
    expect(isValidAddress('a b@x.ch')).toBe(false)
  })
})
