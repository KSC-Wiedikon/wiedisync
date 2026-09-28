// 2026-09-28 audit: a user upload is never served inline as anything but a PDF or a
// raster image, and the identity-document label is allow-listed, not client-chosen.
import { describe, it, expect } from 'vitest'
import { Readable } from 'node:stream'
import { streamManagedFile } from '../storage-read.js'
import { safeIdentityMime } from '../identity-document.js'

function fakeRes() {
  const headers = {}
  const chunks = []
  const listeners = {}
  return {
    headers,
    setHeader(k, v) { headers[k] = v },
    write(c) { chunks.push(c); return true },
    end() { (listeners.finish || []).forEach((f) => f()) },
    on(ev, f) { (listeners[ev] ||= []).push(f); return this },
    once(ev, f) { return this.on(ev, f) },
    emit() { return true },
    removeListener() { return this },
  }
}

async function serve(file, opts = {}) {
  class AssetsService { async getAsset() { return { stream: Readable.from([Buffer.from('x')]), file } } }
  const res = fakeRes()
  await streamManagedFile('id', { services: { AssetsService }, getSchema: async () => ({}), database: null }, res, opts)
  return res.headers
}

describe('streamManagedFile headers', () => {
  it('serves a PDF inline under its own type', async () => {
    const h = await serve({ type: 'application/pdf', filename_download: 'a.pdf' })
    expect(h['Content-Type']).toBe('application/pdf')
    expect(h['Content-Disposition']).toBe('inline; filename="a.pdf"')
    expect(h['Content-Security-Policy']).toBeUndefined()
  })
  it.each(['image/svg+xml', 'text/html', 'application/xml', ''])('%s → octet-stream attachment, sandboxed', async (type) => {
    const h = await serve({ type, filename_download: 'x".svg' })
    expect(h['Content-Type']).toBe('application/octet-stream')
    expect(h['Content-Disposition']).toBe('attachment; filename="x_.svg"')
    expect(h['Content-Security-Policy']).toMatch(/sandbox/)
    expect(h['X-Content-Type-Options']).toBe('nosniff')
  })
})

describe('safeIdentityMime', () => {
  it('keeps photos and PDFs, normalises case/params, neutralises the rest', () => {
    expect(safeIdentityMime('image/JPEG')).toBe('image/jpeg')
    expect(safeIdentityMime('image/jpg')).toBe('image/jpeg')
    expect(safeIdentityMime('application/pdf; charset=x')).toBe('application/pdf')
    expect(safeIdentityMime('image/heif')).toBe('image/heif')
    expect(safeIdentityMime('image/svg+xml')).toBe('application/octet-stream')
    expect(safeIdentityMime('text/html')).toBe('application/octet-stream')
    expect(safeIdentityMime(undefined)).toBeNull()
  })
})
