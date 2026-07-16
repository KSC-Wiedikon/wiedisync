import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { badSlug, listSubmissions, getCount, getCloses, setCloses } from '../opnform.js'

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

  // The registration deadline lives on scorer_courses; these mirror it onto the
  // form's own closes_at, which is what actually rejects a late sign-up.
  describe('getCloses / setCloses', () => {
    const realFetch = global.fetch
    const realPat = process.env.OPNFORM_PAT
    beforeEach(() => { process.env.OPNFORM_PAT = 'test-pat' })
    afterEach(() => {
      global.fetch = realFetch
      if (realPat === undefined) delete process.env.OPNFORM_PAT
      else process.env.OPNFORM_PAT = realPat
    })

    const FORM = {
      id: 3,
      title: 'Scorer course',
      visibility: 'public',
      language: 'de',
      theme: 'default',
      presentation_style: 'form',
      width: 'centered',
      size: 'md',
      border_radius: 'small',
      dark_mode: 'auto',
      color: '#3B82F6',
      uppercase_labels: false,
      no_branding: true,
      transparent_background: false,
      properties: [{ id: 'f1', name: 'Vorname', type: 'text' }],
      closes_at: '2026-08-11T22:00:00+00:00',
      is_closed: false,
      // Read-only/computed noise that must never be echoed back into the write.
      views_count: 42,
      form_pending_submission_key: 'openform-2-pending',
    }

    it('getCloses reports the form deadline', async () => {
      global.fetch = vi.fn(async () => ({ ok: true, text: async () => JSON.stringify({ data: FORM }) }))
      expect(await getCloses('my-form')).toEqual({
        slug: 'my-form', id: 3, closes_at: '2026-08-11T22:00:00+00:00', is_closed: false,
      })
    })

    it('setCloses sends only the validator-required fields plus closes_at', async () => {
      let put = null
      global.fetch = vi.fn(async (url, opts) => {
        if (opts && opts.method === 'PUT') {
          put = { url: String(url), body: JSON.parse(opts.body) }
          return { ok: true, text: async () => JSON.stringify({ data: FORM }) }
        }
        const form = put ? { ...FORM, closes_at: put.body.closes_at } : FORM
        return { ok: true, text: async () => JSON.stringify({ data: form }) }
      })

      const out = await setCloses('my-form', '2026-08-01T16:00:00.000Z')
      expect(out.closes_at).toBe('2026-08-01T16:00:00.000Z')
      // Addressed by numeric id — OpnForm's update route is PUT /open/forms/{id}.
      expect(put.url).toContain('/api/open/forms/3')
      expect(put.body.closes_at).toBe('2026-08-01T16:00:00.000Z')
      // properties is `required` by UpdateFormRequest, so it must round-trip intact.
      expect(put.body.properties).toEqual(FORM.properties)
      expect(put.body.title).toBe('Scorer course')
      // Computed/read-only attributes stay out of the write.
      expect(put.body).not.toHaveProperty('views_count')
      expect(put.body).not.toHaveProperty('is_closed')
      expect(put.body).not.toHaveProperty('form_pending_submission_key')
    })

    it('setCloses accepts null to reopen a form', async () => {
      let put = null
      global.fetch = vi.fn(async (url, opts) => {
        if (opts && opts.method === 'PUT') {
          put = JSON.parse(opts.body)
          return { ok: true, text: async () => JSON.stringify({ data: FORM }) }
        }
        return { ok: true, text: async () => JSON.stringify({ data: put ? { ...FORM, closes_at: null } : FORM }) }
      })
      const out = await setCloses('my-form', null)
      expect(put.closes_at).toBeNull()
      expect(out.closes_at).toBeNull()
    })

    it('setCloses throws if the write moved the form field set', async () => {
      // The guard that matters: `properties` has to be round-tripped on every write,
      // so a write that comes back with a different question set means a live
      // registration form was damaged — that must never report success.
      // First GET returns the intact form, the post-write GET returns a mangled one.
      let gets = 0
      global.fetch = vi.fn(async (url, opts) => {
        if (opts && opts.method === 'PUT') return { ok: true, text: async () => '{}' }
        gets++
        const form = gets === 1 ? FORM : { ...FORM, properties: [] }
        return { ok: true, text: async () => JSON.stringify({ data: form }) }
      })
      await expect(setCloses('my-form', '2026-08-01T16:00:00.000Z')).rejects.toThrow(/field set changed/)
    })

    it('setCloses surfaces an OpnForm validation rejection instead of failing silently', async () => {
      global.fetch = vi.fn(async (url, opts) => {
        if (opts && opts.method === 'PUT') {
          return { ok: false, status: 422, text: async () => '{"message":"The properties field is required."}' }
        }
        return { ok: true, text: async () => JSON.stringify({ data: FORM }) }
      })
      await expect(setCloses('my-form', '2026-08-01T16:00:00.000Z')).rejects.toMatchObject({ status: 422 })
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
