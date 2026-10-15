import { describe, it, expect } from 'vitest'
import { safeNomalReturn } from './nomalReturn'

const API = 'https://directus.kscw.ch'
const OK = 'https://directus.kscw.ch/kscw/nomal/v1/authorize?state=abcdefghijklmnop&return=https%3A%2F%2Fnomal.kscw.ch%2Fapi%2Fauth%2Fcallback'

describe('safeNomalReturn', () => {
  it('accepts the Nomal bridge on our own API origin', () => {
    expect(safeNomalReturn(OK, API)).toBe(OK)
  })

  it('refuses everything else', () => {
    for (const bad of [
      null,
      '',
      '/events/42',
      'https://evil.example/kscw/nomal/v1/authorize?state=x',
      'https://directus.kscw.ch.evil.example/kscw/nomal/v1/authorize',
      'http://directus.kscw.ch/kscw/nomal/v1/authorize',
      'https://directus.kscw.ch/kscw/nomal/v1/sync?teams=1',
      'https://directus.kscw.ch/kscw/nomal/v1/authorize/../../admin',
      'https://user:pw@directus.kscw.ch/kscw/nomal/v1/authorize',
      'javascript:alert(1)',
    ]) {
      expect(safeNomalReturn(bad, API)).toBeNull()
    }
  })

  it('returns null when the API URL is relative (dev proxy)', () => {
    expect(safeNomalReturn(OK, '/directus')).toBeNull()
  })
})
