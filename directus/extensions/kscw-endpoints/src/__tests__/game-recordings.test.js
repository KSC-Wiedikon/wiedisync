/**
 * Validation for game recording links (migration 375). The URL lands in an <a href>
 * on the public website, so anything but https must be refused.
 */
import { describe, it, expect } from 'vitest'
import { normalizeRecordingUrl, parseRecordings } from '../game-recordings.js'

describe('normalizeRecordingUrl', () => {
  it('accepts https links', () => {
    expect(normalizeRecordingUrl(' https://youtu.be/abc ')).toBe('https://youtu.be/abc')
  })
  it('refuses non-https schemes and junk', () => {
    for (const bad of ['javascript:alert(1)', 'http://example.com', 'data:text/html,x', 'ftp://x', '', 'not a url', 'https://a b.com']) {
      expect(normalizeRecordingUrl(bad)).toBeNull()
    }
  })
})

describe('parseRecordings', () => {
  it('cleans rows, keeps order and defaults the website toggle to off', () => {
    const rows = parseRecordings({ recordings: [
      { url: 'https://a.ch/1', title: '  Set 1 ', show_on_website: true },
      { url: 'https://a.ch/2', show_on_website: 'yes' },
    ] })
    expect(rows).toEqual([
      { url: 'https://a.ch/1', title: 'Set 1', show_on_website: true, sort: 0 },
      { url: 'https://a.ch/2', title: null, show_on_website: false, sort: 1 },
    ])
  })
  it('rejects a bad URL and too many rows with a 400', () => {
    expect(() => parseRecordings({ recordings: [{ url: 'javascript:x' }] })).toThrow(/Invalid URL/)
    expect(() => parseRecordings({ recordings: Array.from({ length: 11 }, () => ({ url: 'https://a.ch' })) })).toThrow(/At most/)
    expect(() => parseRecordings({})).toThrow(/array/)
  })
})
