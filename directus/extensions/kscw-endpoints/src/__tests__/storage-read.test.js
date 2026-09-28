// streamManagedFile's Content-Disposition option (audit 2026-09-28, W2 follow-up):
// wadmin's ?download=1 used to monkey-patch res.setHeader to rewrite `inline`.
import { describe, it, expect } from 'vitest'
import { PassThrough, Writable } from 'node:stream'
import { streamManagedFile } from '../storage-read.js'

function deps(type = 'application/pdf') {
  class AssetsService {
    async getAsset() {
      const stream = new PassThrough()
      queueMicrotask(() => stream.end(Buffer.from('%PDF-1.7')))
      return { stream, file: { type, filename_download: 'doc.pdf' } }
    }
  }
  return { services: { AssetsService }, getSchema: async () => ({}), database: {} }
}

function makeRes() {
  const headers = {}
  const res = new Writable({ write(_c, _e, cb) { cb() } })
  res.setHeader = (k, v) => { headers[k.toLowerCase()] = v }
  res.headers = headers
  return res
}

describe('streamManagedFile disposition', () => {
  it('defaults to inline', async () => {
    const res = makeRes()
    await streamManagedFile('f', deps(), res, { filename: 'a b.pdf' })
    expect(res.headers['content-disposition']).toBe('inline; filename="a b.pdf"')
  })

  it('sends attachment when asked, and only for the exact value', async () => {
    const res = makeRes()
    await streamManagedFile('f', deps(), res, { filename: 'x.pdf', disposition: 'attachment' })
    expect(res.headers['content-disposition']).toBe('attachment; filename="x.pdf"')
    const odd = makeRes()
    await streamManagedFile('f', deps(), odd, { filename: 'x.pdf', disposition: 'attachment; filename="evil.html"' })
    expect(odd.headers['content-disposition']).toBe('inline; filename="x.pdf"')
  })

  it('keeps the nosniff + sandbox headers for an attachment', async () => {
    const res = makeRes()
    await streamManagedFile('f', deps('text/html'), res, { filename: 'x.html', disposition: 'attachment' })
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['content-security-policy']).toMatch(/sandbox/)
  })
})
