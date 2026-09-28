import { describe, expect, it } from 'vitest'
import { classify, safeBlobType } from './filePreviewKind'

describe('classify (FilePreview render kind)', () => {
  it('renders raster images inline', () => {
    expect(classify('image/jpeg')).toBe('image')
    expect(classify('image/png; charset=binary')).toBe('image')
    expect(classify('IMAGE/WEBP')).toBe('image')
  })

  it('never renders SVG as an image (scriptable document on the app origin)', () => {
    expect(classify('image/svg+xml')).toBe('other')
    expect(classify('image/svg+xml; charset=utf-8')).toBe('other')
  })

  it('refuses unknown image subtypes by default', () => {
    expect(classify('image/x-something')).toBe('other')
  })

  it('frames PDFs and downloads everything else', () => {
    expect(classify('application/pdf')).toBe('pdf')
    expect(classify('text/html')).toBe('other')
    expect(classify(null)).toBe('other')
    expect(classify('')).toBe('other')
  })
})

describe('safeBlobType', () => {
  it('keeps vetted raster and PDF types, normalised', () => {
    expect(safeBlobType('image/JPEG; q=1')).toBe('image/jpeg')
    expect(safeBlobType('application/pdf')).toBe('application/pdf')
  })

  it('neutralises SVG, HTML and missing types', () => {
    expect(safeBlobType('image/svg+xml')).toBe('application/octet-stream')
    expect(safeBlobType('text/html')).toBe('application/octet-stream')
    expect(safeBlobType(undefined)).toBe('application/octet-stream')
  })
})
