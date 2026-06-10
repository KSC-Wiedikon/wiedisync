/**
 * Allowlist-based HTML sanitizer for admin-authored content that ends up in
 * outbound emails. Pure JS, no deps (Directus extensions have no node_modules).
 *
 * Threat model: a compromised Sport Admin posts an announcement; the email
 * fanout reaches the whole sport. Without sanitization an admin could ship
 * phishing redirects, tracking pixels, javascript: URLs, or `onerror` payloads
 * to every member's inbox.
 *
 * Strategy:
 *   1. Strip block tags whose content is dangerous (script/style/iframe/...).
 *   2. Tokenize remaining tags; keep only ALLOWED_TAGS, drop everything else.
 *   3. Strip ALL attributes except `href` on <a>, and only when the value is
 *      https:// or a same-origin path. Discard javascript:, data:, vbscript:,
 *      mailto:, tel:, etc.
 *   4. Strip HTML comments (some clients render conditional comments).
 */

const ALLOWED_TAGS = new Set([
  'p', 'br', 'span', 'div',
  'strong', 'b', 'em', 'i', 'u',
  'ul', 'ol', 'li',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'pre', 'code',
  'a',
])

// Tags whose entire content should disappear, not just the wrapping element.
const DANGEROUS_BLOCK_TAGS = [
  'script', 'style', 'iframe', 'object', 'embed', 'svg', 'math',
  'form', 'input', 'button', 'textarea', 'select', 'option', 'label',
  'video', 'audio', 'source', 'track', 'canvas', 'noscript',
]

// Standalone tags whose presence alone is bad (no closing pair).
const DANGEROUS_VOID_TAGS = [
  'link', 'meta', 'base', 'img', 'picture', 'frame', 'frameset',
]

function isSafeHref(value) {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (trimmed.startsWith('https://')) return true
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return true
  if (trimmed.startsWith('#')) return true
  return false
}

export function sanitizeAnnouncementHtml(input) {
  if (typeof input !== 'string') return ''
  let s = input

  // Strip HTML comments.
  s = s.replace(/<!--[\s\S]*?-->/g, '')

  // Strip dangerous block tags WITH their content.
  for (const tag of DANGEROUS_BLOCK_TAGS) {
    const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}\\s*>`, 'gi')
    s = s.replace(re, '')
    // Orphan/self-closing variants ("<script />", missing close).
    const reOrphan = new RegExp(`<${tag}\\b[^>]*/?>`, 'gi')
    s = s.replace(reOrphan, '')
  }

  // Strip dangerous void tags entirely.
  for (const tag of DANGEROUS_VOID_TAGS) {
    const re = new RegExp(`<${tag}\\b[^>]*/?>`, 'gi')
    s = s.replace(re, '')
  }

  // Tag pass: keep ALLOWED_TAGS, drop wrapping markup of everything else
  // (inner text survives, since dangerous-block content was already removed).
  s = s.replace(/<\/?([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g, (match, tag, attrs) => {
    const lower = tag.toLowerCase()
    const isClose = match.startsWith('</')
    if (!ALLOWED_TAGS.has(lower)) return ''

    if (isClose) return `</${lower}>`

    // <a> — keep href if safe; drop all other attributes.
    if (lower === 'a') {
      const hrefDouble = attrs.match(/\bhref\s*=\s*"([^"]*)"/i)
      const hrefSingle = attrs.match(/\bhref\s*=\s*'([^']*)'/i)
      const href = hrefDouble?.[1] ?? hrefSingle?.[1] ?? null
      if (href && isSafeHref(href)) {
        const safe = href
          .replace(/&/g, '&amp;')
          .replace(/"/g, '&quot;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
        return `<a href="${safe}" target="_blank" rel="noopener noreferrer">`
      }
      return '<a>'
    }

    // All other allowed tags — strip every attribute (no style, no class,
    // no event handlers, no data-*).
    return `<${lower}>`
  })

  // ── Final safety pass (defense-in-depth) ───────────────────────────────
  // The strip passes above use `[^>]*` for the open-tag class, which breaks on
  // a literal `>` inside an attribute value (`<script data-x=">">…`), and a
  // lazy same-tag match leaves a residual opener on nested duplicates
  // (`<script>x<script>y</script>` → stray `<script>`). This pass scrubs
  // whatever survived, fully case-insensitively, even when unclosed/malformed.

  // 1. Remove any remaining dangerous opener (with or without a closing `>`).
  //    `<script`, `<style data-x=">`, `<iframe` … all collapse to nothing.
  s = s.replace(/<\s*\/?\s*(script|style|iframe|svg|object|embed|form)\b[^>]*>?/gi, '')

  // 2. Strip any leftover event-handler attribute (`onerror=...`, `ONLOAD = ...`).
  //    Covers quoted, single-quoted, and bare values.
  s = s.replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
  s = s.replace(/\son\w+\s*=\s*'[^']*'/gi, '')
  s = s.replace(/\son\w+\s*=\s*[^\s>]+/gi, '')

  // 3. Neutralize dangerous URL schemes in any surviving attribute. Allow
  //    `data:image/` (inline images are harmless); kill bare `data:` and
  //    `javascript:` / `vbscript:` (tolerating whitespace/entities like
  //    `java\tscript:` is out of scope for a regex sanitizer — the opener
  //    strip + the <a> href allowlist below are the real guards).
  s = s.replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1=$2#$2')
  s = s.replace(/(href|src)\s*=\s*("|')\s*vbscript:[^"']*\2/gi, '$1=$2#$2')
  s = s.replace(/(href|src)\s*=\s*("|')\s*data:(?!image\/)[^"']*\2/gi, '$1=$2#$2')

  // 4. Reject/neutralize any <a href> whose value isn't https or same-origin.
  //    The allowed-tag pass above already rewrites <a> safely, but a residual
  //    or re-introduced anchor (e.g. produced by the strips above) is caught
  //    here as a backstop.
  s = s.replace(/<a\b([^>]*)>/gi, (m, attrs) => {
    const hrefDouble = attrs.match(/\bhref\s*=\s*"([^"]*)"/i)
    const hrefSingle = attrs.match(/\bhref\s*=\s*'([^']*)'/i)
    const href = hrefDouble?.[1] ?? hrefSingle?.[1] ?? null
    if (href && isSafeHref(href)) {
      const safe = href
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
      return `<a href="${safe}" target="_blank" rel="noopener noreferrer">`
    }
    return '<a>'
  })

  // 5. Fail closed: if any dangerous opener, event handler, or javascript:
  //    URL still survived all of the above, throw rather than email the
  //    payload to the whole club. A thrown error aborts the announcement
  //    fanout for that recipient (logged + counted as a failure) — a safe
  //    default vs. silently shipping an XSS/phishing vector.
  if (/<\s*\/?\s*(script|style|iframe|svg|object|embed|form)\b/i.test(s)
      || /\son\w+\s*=/i.test(s)
      || /javascript:/i.test(s)) {
    throw new Error('sanitizeAnnouncementHtml: residual unsafe content after sanitization')
  }

  return s
}
