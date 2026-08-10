import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { slugifyTitle, findFreeSlug, createFormFromTemplate } from '../opnform.js'
import { slugFromSignupUrl, resolveTemplateId } from '../event-signup-form.js'

/** Minimal knex stand-in for `database('app_settings').where(...).first(...)`. */
function fakeDb(row, { throws = false } = {}) {
  return () => ({
    where: () => ({
      first: async () => { if (throws) throw new Error('relation does not exist'); return row },
    }),
  })
}

describe('resolveTemplateId', () => {
  const realEnv = process.env.OPNFORM_TEMPLATE_FORM_ID
  afterEach(() => {
    if (realEnv === undefined) delete process.env.OPNFORM_TEMPLATE_FORM_ID
    else process.env.OPNFORM_TEMPLATE_FORM_ID = realEnv
  })

  it('prefers the app_settings row over the env var', async () => {
    process.env.OPNFORM_TEMPLATE_FORM_ID = '11'
    expect(await resolveTemplateId(fakeDb({ value: '42' }))).toBe('42')
  })

  it('falls back to the env var when the row is missing or blank', async () => {
    process.env.OPNFORM_TEMPLATE_FORM_ID = '11'
    expect(await resolveTemplateId(fakeDb(undefined))).toBe('11')
    expect(await resolveTemplateId(fakeDb({ value: '   ' }))).toBe('11')
    expect(await resolveTemplateId(fakeDb({ value: null }))).toBe('11')
  })

  it('falls back to the env var when the settings read throws', async () => {
    // A missing table must degrade to the env var, not 500 the whole route.
    process.env.OPNFORM_TEMPLATE_FORM_ID = '11'
    expect(await resolveTemplateId(fakeDb(null, { throws: true }))).toBe('11')
  })

  it('returns empty when neither source is configured', async () => {
    delete process.env.OPNFORM_TEMPLATE_FORM_ID
    expect(await resolveTemplateId(fakeDb(undefined))).toBe('')
  })
})

describe('slugifyTitle', () => {
  it('produces a CustomSlugRule-legal slug', () => {
    const rule = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
    for (const input of ['Mixed Turnier 2027', '  Spaces   everywhere  ', 'Grümpi!!! (2027)', 'A']) {
      expect(slugifyTitle(input)).toMatch(rule)
    }
  })

  it('transliterates German umlauts rather than dropping the diacritic', () => {
    // "grun" would be a different word; members read and type this URL.
    expect(slugifyTitle('Turnier Grün')).toBe('turnier-gruen')
    expect(slugifyTitle('Fussball Übung')).toBe('fussball-uebung')
    expect(slugifyTitle('Strauß')).toBe('strauss')
  })

  it('strips non-German accents via NFD', () => {
    expect(slugifyTitle('Café Léo')).toBe('cafe-leo')
  })

  it('never returns an empty slug', () => {
    // OpnForm would 422 on '' — and the failure would surface as an opaque
    // validation error rather than "your event has no usable title".
    expect(slugifyTitle('')).toBe('event')
    expect(slugifyTitle('!!!')).toBe('event')
    expect(slugifyTitle(null)).toBe('event')
  })

  it('caps length and never leaves a trailing hyphen', () => {
    const s = slugifyTitle('x'.repeat(80))
    expect(s.length).toBeLessThanOrEqual(60)
    expect(s.endsWith('-')).toBe(false)
    // A 60-char cut landing mid-separator must not leave "foo-"
    expect(slugifyTitle(`${'a'.repeat(59)} bbb`)).not.toMatch(/-$/)
  })
})

describe('slugFromSignupUrl', () => {
  it('parses the slug the same way kscw-website does', () => {
    expect(slugFromSignupUrl('https://forms.kscw.ch/forms/mixed-turnier-2027')).toBe('mixed-turnier-2027')
  })

  it('returns null for anything that is not a form URL', () => {
    expect(slugFromSignupUrl('https://example.com/signup')).toBeNull()
    expect(slugFromSignupUrl('')).toBeNull()
    expect(slugFromSignupUrl(null)).toBeNull()
  })
})

describe('findFreeSlug', () => {
  const realFetch = global.fetch
  const realPat = process.env.OPNFORM_PAT
  beforeEach(() => { process.env.OPNFORM_PAT = 'test-pat' })
  afterEach(() => {
    global.fetch = realFetch
    if (realPat === undefined) delete process.env.OPNFORM_PAT
    else process.env.OPNFORM_PAT = realPat
  })

  it('returns the base slug when nothing occupies it', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 404, text: async () => '' }))
    expect(await findFreeSlug('Mixed Turnier 2027')).toBe('mixed-turnier-2027')
  })

  it('suffixes past slugs that are already taken', async () => {
    const taken = new Set(['mixed-turnier', 'mixed-turnier-2'])
    global.fetch = vi.fn(async (url) => {
      const slug = String(url).split('/forms/')[1]
      return taken.has(slug)
        ? { ok: true, text: async () => JSON.stringify({ data: { id: 1, slug } }) }
        : { ok: false, status: 404, text: async () => '' }
    })
    expect(await findFreeSlug('Mixed Turnier')).toBe('mixed-turnier-3')
  })
})

describe('createFormFromTemplate', () => {
  const realFetch = global.fetch
  const realPat = process.env.OPNFORM_PAT
  beforeEach(() => { process.env.OPNFORM_PAT = 'test-pat' })
  afterEach(() => {
    global.fetch = realFetch
    if (realPat === undefined) delete process.env.OPNFORM_PAT
    else process.env.OPNFORM_PAT = realPat
  })

  const TEMPLATE_COPY = {
    id: 77,
    title: 'Copy of Event signup template',
    slug: 'copy-of-event-signup-template',
    visibility: 'draft',
    language: 'de', theme: 'default', presentation_style: 'classic',
    width: 'centered', size: 'md', border_radius: 'small', dark_mode: 'auto',
    color: '#4A55A2', uppercase_labels: false, no_branding: true,
    transparent_background: false,
    properties: [{ id: 'p1', name: 'Name', type: 'text' }],
  }

  it('duplicates then renames, and round-trips every required field', async () => {
    const calls = []
    global.fetch = vi.fn(async (url, init) => {
      const u = String(url)
      calls.push({ u, method: init?.method || 'GET', body: init?.body ? JSON.parse(init.body) : null })
      if (u.endsWith('/duplicate')) {
        return { ok: true, text: async () => JSON.stringify({ new_form: TEMPLATE_COPY }) }
      }
      if (init?.method === 'PUT') return { ok: true, text: async () => '{}' }
      return { ok: true, text: async () => JSON.stringify({
        data: { ...TEMPLATE_COPY, title: 'Mixed Turnier', slug: 'mixed-turnier-2027', closes_at: '2027-05-01T21:59:00Z' } }) }
    })

    const out = await createFormFromTemplate(42, {
      title: 'Mixed Turnier', slug: 'mixed-turnier-2027', closesAt: '2027-05-01T21:59:00Z',
    })

    const put = calls.find((c) => c.method === 'PUT')
    // UpdateFormRequest marks all of these required — a missing one is a 422.
    for (const k of ['title', 'visibility', 'language', 'theme', 'presentation_style', 'width',
      'size', 'border_radius', 'dark_mode', 'color', 'uppercase_labels', 'no_branding',
      'transparent_background', 'properties']) {
      expect(put.body).toHaveProperty(k)
    }
    expect(put.body.title).toBe('Mixed Turnier')
    expect(put.body.slug).toBe('mixed-turnier-2027')
    expect(put.body.visibility).toBe('public')
    // The template's own question set must survive verbatim — we never author it.
    expect(put.body.properties).toEqual(TEMPLATE_COPY.properties)
    expect(out.url).toBe('https://forms.kscw.ch/forms/mixed-turnier-2027')
  })

  it('truncates an over-long title to OpnForm\'s 60-char cap', async () => {
    let putBody = null
    global.fetch = vi.fn(async (url, init) => {
      const u = String(url)
      if (u.endsWith('/duplicate')) return { ok: true, text: async () => JSON.stringify({ new_form: TEMPLATE_COPY }) }
      if (init?.method === 'PUT') { putBody = JSON.parse(init.body); return { ok: true, text: async () => '{}' } }
      return { ok: true, text: async () => JSON.stringify({ data: TEMPLATE_COPY }) }
    })
    await createFormFromTemplate(42, { title: 'T'.repeat(120), slug: 'long-one' })
    expect(putBody.title).toHaveLength(60)
  })

  it('deletes the copy when the rename fails, leaving no orphan', async () => {
    const methods = []
    global.fetch = vi.fn(async (url, init) => {
      const u = String(url)
      methods.push(`${init?.method || 'GET'} ${u.split('/api/open')[1]}`)
      if (u.endsWith('/duplicate')) return { ok: true, text: async () => JSON.stringify({ new_form: TEMPLATE_COPY }) }
      if (init?.method === 'PUT') return { ok: false, status: 422, text: async () => '{"errors":{"slug":["taken"]}}' }
      if (init?.method === 'DELETE') return { ok: true, text: async () => '{}' }
      return { ok: true, text: async () => JSON.stringify({ data: TEMPLATE_COPY }) }
    })

    await expect(createFormFromTemplate(42, { title: 'X', slug: 'taken' })).rejects.toThrow()
    // A half-renamed "Copy of …" form left public would be worse than none.
    expect(methods).toContain('DELETE /forms/77')
  })
})
