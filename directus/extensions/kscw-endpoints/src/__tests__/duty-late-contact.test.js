/**
 * duty-late contact reveal — hide_phone / hide_email are honoured on BOTH the
 * GET and the POST (audit 2026-09-28 F22: the POST returned the raw row,
 * regressing 2026-08-08 #26).
 */
import { describe, it, expect } from 'vitest'
import { revealContact } from '../duty-late.js'

describe('revealContact', () => {
  it('passes through a contact with no opt-out', () => {
    expect(revealContact({ phone: '+41 79 000 00 00', email: 'a@b.ch', hide_phone: false, hide_email: false }))
      .toEqual({ phone: '+41 79 000 00 00', email: 'a@b.ch', hide_phone: false, hide_email: false })
  })
  it('withholds a hidden phone and a hidden email, keeping the flags', () => {
    expect(revealContact({ phone: '+41 79 000 00 00', email: 'a@b.ch', hide_phone: true, hide_email: true }))
      .toEqual({ phone: null, email: null, hide_phone: true, hide_email: true })
  })
  it('normalises empty values to null', () => {
    expect(revealContact({ phone: '', email: null })).toEqual({ phone: null, email: null, hide_phone: false, hide_email: false })
  })
})
