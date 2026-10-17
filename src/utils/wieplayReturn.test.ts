import { describe, it, expect } from 'vitest'
import { safeWieplayReturn } from './wieplayReturn'

const API = 'https://directus.kscw.ch'
const RETURN = 'return=https%3A%2F%2Fwieplay.kscw.ch%2Fapi%2Fauth%2Fcallback'
const OK = `https://directus.kscw.ch/kscw/wieplay/v1/authorize?state=abcdefghijklmnop&${RETURN}`

describe('safeWieplayReturn', () => {
  it('accepts the WiePlay bridge on our own API origin', () => {
    expect(safeWieplayReturn(OK, API)).toBe(OK)
  })

  it('refuses everything else', () => {
    for (const bad of [
      null,
      '',
      '/events/42',
      'https://evil.example/kscw/wieplay/v1/authorize?state=x',
      'https://directus.kscw.ch.evil.example/kscw/wieplay/v1/authorize',
      'http://directus.kscw.ch/kscw/wieplay/v1/authorize',
      'https://directus.kscw.ch/kscw/wieplay/v1/sync?teams=1',
      'https://directus.kscw.ch/kscw/wieplay/v1/authorize/../../admin',
      'https://directus.kscw.ch/kscw/wieplay/v1/authorize/',
      'https://directus.kscw.ch/kscw/wieplay/v2/authorize',
      'https://user:pw@directus.kscw.ch/kscw/wieplay/v1/authorize',
      'https://directus.kscw.ch/kscw/wieplay/v1/authorize#x',
      'javascript:alert(1)',
    ]) {
      expect(safeWieplayReturn(bad, API)).toBeNull()
    }
  })

  it('returns null when the API URL is relative (dev proxy)', () => {
    expect(safeWieplayReturn(OK, '/directus')).toBeNull()
  })

  it('refuses any other app name on the API origin', () => {
    for (const bad of [
      'https://directus.kscw.ch/kscw/wieplay2/v1/authorize',
      'https://directus.kscw.ch/kscw/WiePlay/v1/authorize',
      'https://directus.kscw.ch/kscw/public/teams',
    ]) {
      expect(safeWieplayReturn(bad, API)).toBeNull()
    }
  })

  it('refuses the pre-rename /kscw/nomal/v1/authorize (removed after the cutover, 18.10.2026)', () => {
    expect(safeWieplayReturn(`https://directus.kscw.ch/kscw/nomal/v1/authorize?state=abcdefghijklmnop&${RETURN}`, API))
      .toBeNull()
  })
})
