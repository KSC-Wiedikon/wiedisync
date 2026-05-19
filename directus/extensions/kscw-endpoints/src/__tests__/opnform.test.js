import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { badSlug, listSubmissions, getCount } from '../opnform.js'

describe('opnform exports', () => {
  it('badSlug rejects empty and bad, accepts normal slugs', () => {
    expect(badSlug('')).toBe(true)
    expect(badSlug('a b')).toBe(true)
    expect(badSlug('scorer-kurse-2026-en')).toBe(false)
  })

  describe('listSubmissions', () => {
    const realFetch = global.fetch
    const realPat = process.env.OPNFORM_PAT
    beforeEach(() => { process.env.OPNFORM_PAT = 'test-pat' })
    afterEach(() => {
      global.fetch = realFetch
      if (realPat === undefined) delete process.env.OPNFORM_PAT
      else process.env.OPNFORM_PAT = realPat
    })

    it('shapes the payload from OpnForm responses', async () => {
      const calls = []
      global.fetch = vi.fn(async (url) => {
        calls.push(String(url))
        if (String(url).includes('/submissions')) {
          return { ok: true, text: async () => JSON.stringify({
            data: [{ id: 1 }], meta: { total: 1, last_page: 1 } }) }
        }
        return { ok: true, text: async () => JSON.stringify({
          data: { title: 'Form X', properties: [{ id: 'f1', name: 'Name', type: 'text' }] } }) }
      })
      const out = await listSubmissions('my-form', { page: 1, perPage: 100 })
      expect(out.title).toBe('Form X')
      expect(out.fields).toEqual([{ id: 'f1', name: 'Name', type: 'text' }])
      expect(out.data).toEqual([{ id: 1 }])
      expect(out.total).toBe(1)
      expect(out.last_page).toBe(1)
      expect(calls.some(u => u.includes('/forms/my-form/submissions'))).toBe(true)
    })
  })

  describe('getCount', () => {
    const realFetch = global.fetch
    const realPat = process.env.OPNFORM_PAT
    beforeEach(() => { process.env.OPNFORM_PAT = 'test-pat' })
    afterEach(() => {
      global.fetch = realFetch
      if (realPat === undefined) delete process.env.OPNFORM_PAT
      else process.env.OPNFORM_PAT = realPat
    })

    it('fetches and caches the total, then serves the cached value', async () => {
      let fetchCalls = 0
      global.fetch = vi.fn(async () => {
        fetchCalls++
        return { ok: true, text: async () => JSON.stringify({ meta: { total: 7 } }) }
      })
      const slug = 'count-form-' + Math.random().toString(36).slice(2)
      const first = await getCount(slug)
      expect(first).toEqual({ count: 7, cached: false })
      const second = await getCount(slug)
      expect(second).toEqual({ count: 7, cached: true })
      expect(fetchCalls).toBe(1) // second call served from cache, no extra fetch
    })
  })
})
