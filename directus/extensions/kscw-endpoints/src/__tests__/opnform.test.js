import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { badSlug, listSubmissions } from '../opnform.js'

describe('opnform exports', () => {
  it('badSlug rejects empty and bad, accepts normal slugs', () => {
    expect(badSlug('')).toBe(true)
    expect(badSlug('a b')).toBe(true)
    expect(badSlug('scorer-kurse-2026-en')).toBe(false)
  })

  describe('listSubmissions', () => {
    const realFetch = global.fetch
    beforeEach(() => { process.env.OPNFORM_PAT = 'test-pat' })
    afterEach(() => { global.fetch = realFetch })

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
})
