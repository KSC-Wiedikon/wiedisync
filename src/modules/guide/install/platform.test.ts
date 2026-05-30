import { describe, it, expect } from 'vitest'
import { detectPlatform } from './platform'

const base = { ua: '', standalone: false, maxTouchPoints: 0, platform: '' }

describe('detectPlatform', () => {
  it('returns standalone when running as installed app', () => {
    expect(detectPlatform({ ...base, standalone: true, ua: 'iphone' })).toBe('standalone')
  })

  it('detects iPhone Safari', () => {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    expect(detectPlatform({ ...base, ua })).toBe('ios-safari')
  })

  it('detects Chrome on iOS (CriOS) as ios-other', () => {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1'
    expect(detectPlatform({ ...base, ua })).toBe('ios-other')
  })

  it('detects an in-app webview on iOS as ios-other', () => {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 300.0'
    expect(detectPlatform({ ...base, ua })).toBe('ios-other')
  })

  it('detects iPadOS (reports as MacIntel with touch) as ios-safari', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
    expect(detectPlatform({ ...base, ua, platform: 'MacIntel', maxTouchPoints: 5 })).toBe('ios-safari')
  })

  it('detects Android Chrome', () => {
    const ua = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36'
    expect(detectPlatform({ ...base, ua })).toBe('android')
  })

  it('falls back to desktop', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
    expect(detectPlatform({ ...base, ua })).toBe('desktop')
  })
})
