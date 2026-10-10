import { describe, expect, it } from 'vitest'
import { detectNativeApp } from './pwa'

const browser = { ua: 'Mozilla/5.0 (Linux; Android 15) Chrome/140.0 Mobile Safari/537.36', capacitorPlatform: null, tauri: false }

describe('detectNativeApp', () => {
  it('is null in a plain browser', () => {
    expect(detectNativeApp(browser)).toBeNull()
  })

  it('reads the WiedisyncApp user-agent token', () => {
    expect(detectNativeApp({ ...browser, ua: `${browser.ua} WiedisyncApp/android` })).toBe('android')
    expect(detectNativeApp({ ...browser, ua: 'Mozilla/5.0 (X11; Linux x86_64) WiedisyncApp/desktop' })).toBe('desktop')
  })

  it('ignores an unknown platform in the token', () => {
    expect(detectNativeApp({ ...browser, ua: `${browser.ua} WiedisyncApp/tv` })).toBeNull()
  })

  it('falls back to the Capacitor and Tauri globals', () => {
    expect(detectNativeApp({ ...browser, capacitorPlatform: 'ios' })).toBe('ios')
    expect(detectNativeApp({ ...browser, capacitorPlatform: 'web' })).toBeNull()
    expect(detectNativeApp({ ...browser, tauri: true })).toBe('desktop')
  })
})
