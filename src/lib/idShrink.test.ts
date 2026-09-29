import { describe, expect, it } from 'vitest'
import { ID_SHRINK_ABOVE_BYTES, needsShrink } from './idShrink'

describe('needsShrink', () => {
  it('re-encodes camera-size photos, leaves WhatsApp-size ones alone', () => {
    expect(needsShrink(2_500_000, 'image/jpeg')).toBe(true)
    expect(needsShrink(ID_SHRINK_ABOVE_BYTES + 1, 'image/jpeg')).toBe(true)
    expect(needsShrink(ID_SHRINK_ABOVE_BYTES, 'image/jpeg')).toBe(false)
    expect(needsShrink(180_000, 'image/jpeg')).toBe(false)
  })

  it('always turns a PDF into a JPEG, however small — the hall then needs no pdf.js', () => {
    expect(needsShrink(100_000, 'application/pdf')).toBe(true)
  })

  it('treats an unknown size as small', () => {
    expect(needsShrink(null, 'image/jpeg')).toBe(false)
    expect(needsShrink(undefined, undefined)).toBe(false)
  })
})
