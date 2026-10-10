import { describe, expect, it } from 'vitest'
import { blendToHex } from './nativeSystemBars'

describe('blendToHex', () => {
  it('returns an opaque colour as is', () => {
    expect(blendToHex([[15, 23, 42, 1]])).toBe('#0f172a')
  })

  it('paints a translucent layer over the one below', () => {
    // The tab bar is bg-card/95 over the page: card #1e293b over background #0f172a.
    expect(blendToHex([[15, 23, 42, 1], [30, 41, 59, 0.95]])).toBe('#1d283a')
  })

  it('starts from white, so a lone translucent colour still comes out opaque', () => {
    expect(blendToHex([[0, 0, 0, 0.5]])).toBe('#808080')
    expect(blendToHex([])).toBe('#ffffff')
  })
})
