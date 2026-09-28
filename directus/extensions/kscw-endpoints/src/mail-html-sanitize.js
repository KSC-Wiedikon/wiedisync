/**
 * Allowlist HTML sanitiser for mail bodies the scheduling mailbox SENDS or
 * PREVIEWS: admin-authored replies (TipTap output) and reposted inbound mail.
 *
 * Replaces a blocklist of regexes (2026-09-28 audit) that `<img/src=x/onerror=…>`
 * and an unquoted `href=javascript:…` walked straight through. Same strategy as
 * kscw-hooks/src/sanitize-html.js (the announcement sanitiser — copied in
 * approach, not imported: the two extension bundles cannot import from each
 * other), but a TOKENISER rather than tag-regexes, because mail needs a wider
 * allowlist (tables, inline images, inline styles) and every tag is rebuilt from
 * parsed parts, so nothing the parser did not understand survives:
 *
 *   - text outside tags passes through; a `<` that does not open a tag is escaped
 *   - comments, doctype, <!…> / <?…> are dropped
 *   - script/style/head/title/iframe/object/… are dropped WITH their content
 *   - every other tag is kept only if on ALLOWED_TAGS, rebuilt with only the
 *     allowlisted attributes; everything else loses its markup, keeps its text
 *   - attribute values are entity-decoded before checking and re-encoded on output
 *   - URLs: href → http(s)/mailto/tel/#fragment; src → https / cid: / data:image
 *   - style → dropped whole if it contains anything that can fetch or execute
 *   - an unclosed tag at the end is dropped
 *
 * No dependencies. Pure; exported for the unit test.
 */

const ALLOWED_TAGS = new Set([
  'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'center', 'cite', 'code', 'col', 'colgroup',
  'dd', 'del', 'div', 'dl', 'dt', 'em', 'font', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i',
  'img', 'ins', 'kbd', 'li', 'mark', 'ol', 'p', 'pre', 'q', 's', 'small', 'span', 'strike',
  'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul', 'wbr',
])

const VOID_TAGS = new Set(['br', 'hr', 'img', 'wbr', 'col'])

/** Dropped together with everything up to their closing tag. */
const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'head', 'title', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet',
  'svg', 'math', 'template', 'noscript', 'noembed', 'noframes', 'textarea', 'select', 'xmp',
  'plaintext', 'form',
])

const GLOBAL_ATTRS = new Set(['style', 'title', 'dir', 'lang', 'align', 'valign', 'width', 'height', 'bgcolor', 'color'])
const TAG_ATTRS = {
  a: new Set(['href', 'name']),
  img: new Set(['src', 'alt', 'border', 'hspace', 'vspace']),
  table: new Set(['border', 'cellpadding', 'cellspacing', 'summary']),
  td: new Set(['colspan', 'rowspan', 'nowrap']),
  th: new Set(['colspan', 'rowspan', 'nowrap', 'scope']),
  col: new Set(['span']),
  colgroup: new Set(['span']),
  font: new Set(['face', 'size']),
  ol: new Set(['start', 'type']),
  ul: new Set(['type']),
  li: new Set(['value']),
  blockquote: new Set(['cite']),
  q: new Set(['cite']),
}

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', colon: ':', tab: '\t', newline: '\n' }

function decodeEntities(v) {
  return String(v).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi, (m, ent) => {
    if (ent[0] === '#') {
      const code = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
    }
    const named = NAMED[ent.toLowerCase()]
    return named !== undefined ? named : m
  })
}

const encodeAttr = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Scheme check on the DECODED value, with whitespace/control chars removed —
 *  browsers ignore them inside a scheme (`java\tscript:`). */
function schemeOf(decoded) {
  const compact = decoded.replace(/[\u0000- \u007f- ]/g, '')
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(compact)
  return m ? m[1].toLowerCase() : null
}

function safeHref(decoded) {
  const scheme = schemeOf(decoded)
  if (scheme == null) {
    // Scheme-less: a #fragment only. A relative path means nothing in a mail
    // client, and `//host` is a protocol-relative external link.
    return decoded.trim().startsWith('#') ? decoded.trim() : null
  }
  return ['http', 'https', 'mailto', 'tel'].includes(scheme) ? decoded.trim() : null
}

function safeSrc(decoded) {
  const scheme = schemeOf(decoded)
  if (scheme === 'https' || scheme === 'cid') return decoded.trim()
  if (scheme === 'data' && /^data:image\/(png|gif|jpe?g|webp);base64,[a-z0-9+/=\s]+$/i.test(decoded.trim())) return decoded.trim()
  return null
}

function safeStyle(decoded) {
  if (/expression|javascript|vbscript|url\s*\(|@import|behavio(u)?r|-moz-binding|[<>\\]/i.test(decoded)) return null
  return decoded.trim()
}

/** Parse the attributes of an open tag starting at `i` (just after the name).
 *  Returns { attrs: [[name, rawValue|null]], end } with `end` the index after
 *  `>`, or null when the tag never closes. `/` between attributes is a
 *  separator, as in browsers (`<img/src=x/onerror=…>`). */
function parseAttrs(s, i) {
  const attrs = []
  const n = s.length
  while (i < n) {
    while (i < n && /[\s/]/.test(s[i])) i++
    if (i >= n) return null
    if (s[i] === '>') return { attrs, end: i + 1 }
    let j = i
    while (j < n && !/[\s/>=]/.test(s[j])) j++
    // A stray quote/`=` with no name: consume one char so the loop progresses.
    const name = j > i ? s.slice(i, j).toLowerCase() : null
    if (j === i) j++
    i = j
    while (i < n && /\s/.test(s[i])) i++
    let value = null
    if (s[i] === '=') {
      i++
      while (i < n && /\s/.test(s[i])) i++
      if (s[i] === '"' || s[i] === "'") {
        const q = s[i]
        const close = s.indexOf(q, i + 1)
        if (close === -1) return null
        value = s.slice(i + 1, close)
        i = close + 1
      } else {
        let k = i
        while (k < n && !/[\s>]/.test(s[k])) k++
        value = s.slice(i, k)
        i = k
      }
    }
    if (name) attrs.push([name, value])
  }
  return null
}

function buildTag(tag, attrs) {
  const allowed = TAG_ATTRS[tag]
  const out = []
  const seen = new Set()
  for (const [name, raw] of attrs) {
    if (seen.has(name)) continue
    if (!GLOBAL_ATTRS.has(name) && !allowed?.has(name)) continue
    const decoded = raw == null ? '' : decodeEntities(raw)
    let value = decoded
    if (name === 'href' || name === 'cite') value = safeHref(decoded)
    else if (name === 'src') value = safeSrc(decoded)
    else if (name === 'style') value = safeStyle(decoded)
    if (value == null) continue
    seen.add(name)
    out.push(`${name}="${encodeAttr(value)}"`)
  }
  if (tag === 'a' && seen.has('href')) out.push('target="_blank"', 'rel="noopener noreferrer"')
  return `<${tag}${out.length ? ` ${out.join(' ')}` : ''}>`
}

export function sanitizeOutgoingHtml(html) {
  if (!html) return ''
  const s = String(html)
  const n = s.length
  let out = ''
  let i = 0
  while (i < n) {
    const lt = s.indexOf('<', i)
    if (lt === -1) { out += s.slice(i); break }
    out += s.slice(i, lt)
    i = lt

    // Comments / doctype / CDATA / processing instructions — dropped.
    if (s.startsWith('<!--', i)) {
      const end = s.indexOf('-->', i + 4)
      i = end === -1 ? n : end + 3
      continue
    }
    if (s[i + 1] === '!' || s[i + 1] === '?') {
      const end = s.indexOf('>', i + 2)
      i = end === -1 ? n : end + 1
      continue
    }

    // Closing tag.
    const close = /^<\/\s*([a-zA-Z][a-zA-Z0-9:-]*)[^>]*>/.exec(s.slice(i, i + 256))
    if (close) {
      const tag = close[1].toLowerCase()
      if (ALLOWED_TAGS.has(tag) && !VOID_TAGS.has(tag)) out += `</${tag}>`
      i += close[0].length
      continue
    }
    if (s[i + 1] === '/') {
      // `</` not followed by a tag name — browsers treat it as a bogus comment.
      const end = s.indexOf('>', i + 2)
      i = end === -1 ? n : end + 1
      continue
    }

    // Opening tag.
    const open = /^<([a-zA-Z][a-zA-Z0-9:-]*)/.exec(s.slice(i, i + 256))
    if (!open) { out += '&lt;'; i++; continue }
    const tag = open[1].toLowerCase()
    const parsed = parseAttrs(s, i + open[0].length)
    if (!parsed) break // unclosed tag at the end — drop it and the rest
    i = parsed.end

    if (DROP_WITH_CONTENT.has(tag)) {
      // Raw-text semantics: content ends at the first `</tag`, whatever it holds.
      const re = new RegExp(`</\\s*${tag}\\b[^>]*>`, 'i')
      const m = re.exec(s.slice(i))
      i = m ? i + m.index + m[0].length : n
      continue
    }
    if (!ALLOWED_TAGS.has(tag)) continue
    out += buildTag(tag, parsed.attrs)
  }
  return out
}
