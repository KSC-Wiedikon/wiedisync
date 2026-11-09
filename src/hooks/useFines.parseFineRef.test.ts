import { describe, expect, it } from 'vitest'
import { fineRef, parseFineRef } from './useFines'

describe('parseFineRef', () => {
  it('reads a reference however it was copied', () => {
    for (const q of ['F-56', 'f56', 'F 56', ' F - 56 ', '#56', '56']) expect(parseFineRef(q)).toBe(56)
  })
  it('round-trips fineRef', () => {
    expect(parseFineRef(fineRef(1234))).toBe(1234)
  })
  it('is null for names and empty input', () => {
    for (const q of ['', 'Fabian', 'F-', '56a', 'Late sign-in']) expect(parseFineRef(q)).toBeNull()
  })
})
