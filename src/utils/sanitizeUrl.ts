/**
 * Sanitize a URL to prevent javascript: protocol XSS attacks.
 * Returns the URL only if it uses https:, empty string otherwise.
 *
 * 2026-05-12 audit #16: rejects http: (HSTS downgrade for admin-entered URLs).
 * App is served over HTTPS-only on prod + dev (CF Pages enforces); accepting
 * plain http: for outbound links surprises users who expect every link they
 * click to honor the same transport guarantees.
 */
export function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'https:') return url
  } catch {
    /* invalid URL */
  }
  return ''
}

const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/

/**
 * Build a safe `mailto:` href from a (possibly comma/semicolon-joined) contact
 * string. SVRZ-scraped contacts can bundle several addresses and arrive
 * unvalidated — strip CR/LF + angle brackets (header-injection vectors), keep
 * only well-formed addresses, and URL-encode each. Returns '' when nothing
 * valid remains (callers can treat that as "no link"). Does not touch the
 * visible text — only the href.
 */
export function buildMailtoHref(raw: string | null | undefined): string {
  if (!raw) return ''
  const valid = raw
    .split(/[,;]/)
    .map((part) => part.replace(/[\r\n<>]/g, '').trim())
    .filter((part) => EMAIL_RE.test(part))
    .map((part) => encodeURIComponent(part))
  if (valid.length === 0) return ''
  return `mailto:${valid.join(',')}`
}

/**
 * Allow https absolute URLs and same-origin relative paths starting with "/".
 * Rejects http:, javascript:, data:, vbscript:, mailto:, etc.
 */
export function isSafeAppLink(url: string | null | undefined): boolean {
  if (!url) return false
  const trimmed = url.trim()
  if (!trimmed) return false
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return true
  try {
    const parsed = new URL(trimmed)
    return parsed.protocol === 'https:'
  } catch {
    return false
  }
}
