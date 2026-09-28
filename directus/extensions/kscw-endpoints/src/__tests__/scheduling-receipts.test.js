/**
 * Terminplanung proposal receipts go to the opponent's KNOWN contacts, never to
 * an address typed by whoever holds the token (audit 2026-09-28 F60).
 */
import { describe, it, expect } from 'vitest'
import { pickReceiptRecipients, registerAddressKey } from '../game-scheduling.js'

describe('pickReceiptRecipients', () => {
  it('a typed address that is not a known contact gets nothing', () => {
    expect(pickReceiptRecipients(['plan@club.ch', 'tr@club.ch'], 'victim@example.com'))
      .toEqual({ to: 'plan@club.ch', cc: ['tr@club.ch'] })
  })
  it('a known proposer is the To, the other contacts cc (case-insensitive)', () => {
    expect(pickReceiptRecipients(['plan@club.ch', 'TR@club.ch'], ' tr@CLUB.ch '))
      .toEqual({ to: 'tr@club.ch', cc: ['plan@club.ch'] })
  })
  it('dedupes and returns null when nothing is known', () => {
    expect(pickReceiptRecipients(['a@b.ch', 'A@b.ch'], 'a@b.ch')).toEqual({ to: 'a@b.ch', cc: null })
    expect(pickReceiptRecipients([], 'x@y.ch')).toBeNull()
  })
})

describe('registerAddressKey (F60 dedup)', () => {
  it('plus-tags and case collapse to one address', () => {
    expect(registerAddressKey(' A+1@Club.ch ')).toBe('a@club.ch')
    expect(registerAddressKey('a+2@club.ch')).toBe('a@club.ch')
    expect(registerAddressKey('a@club.ch')).toBe('a@club.ch')
  })
  it('a plus sign in the domain part is left alone', () => {
    expect(registerAddressKey('a@b+c.ch')).toBe('a@b+c.ch')
  })
})
