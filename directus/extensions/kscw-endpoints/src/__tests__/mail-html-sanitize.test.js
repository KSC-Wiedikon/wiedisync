/**
 * Unit tests for the scheduling-mailbox HTML sanitiser (mail-html-sanitize.js).
 * The payloads below are the ones the old regex blocklist let through
 * (2026-09-28 audit) plus the usual tokeniser edge cases. Hermetic.
 */
import { describe, it, expect } from 'vitest'
import { sanitizeOutgoingHtml as clean } from '../mail-html-sanitize.js'

const noExec = (html) => {
  expect(html).not.toMatch(/<script|<iframe|<svg|<style/i)
  expect(html).not.toMatch(/\son[a-z]+\s*=/i)
  expect(html).not.toMatch(/javascript:|vbscript:/i)
}

describe('sanitizeOutgoingHtml', () => {
  it('kills slash-separated event handlers', () => {
    const out = clean('<img/src=x/onerror=alert(1)>')
    noExec(out)
    expect(out).toBe('<img>')
  })

  it('kills unquoted and entity-encoded javascript: hrefs', () => {
    for (const p of [
      '<a href=javascript:alert(1)>x</a>',
      '<a href="java&#x09;script:alert(1)">x</a>',
      '<a href="&#106;avascript:alert(1)">x</a>',
      '<a href=" JAVASCRIPT:alert(1)">x</a>',
    ]) {
      const out = clean(p)
      noExec(out)
      expect(out).toBe('<a>x</a>')
    }
  })

  it('drops script/style with content, even with > inside attributes', () => {
    noExec(clean('<script data-x=">">alert(1)</script>ok'))
    expect(clean('<script data-x=">">alert(1)</script>ok')).toBe('ok')
    expect(clean('<style>p{color:red}</style><p>hi</p>')).toBe('<p>hi</p>')
  })

  it('keeps ordinary mail formatting', () => {
    expect(clean('<p style="color:#333">Hallo <strong>Team</strong></p>'))
      .toBe('<p style="color:#333">Hallo <strong>Team</strong></p>')
    expect(clean('<a href="https://kscw.ch/x?a=1&amp;b=2">link</a>'))
      .toBe('<a href="https://kscw.ch/x?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">link</a>')
    expect(clean('<img src="cid:logo@kscw" alt="Logo">')).toBe('<img src="cid:logo@kscw" alt="Logo">')
    expect(clean('<table border="0"><tr><td colspan="2">x</td></tr></table>'))
      .toBe('<table border="0"><tr><td colspan="2">x</td></tr></table>')
  })

  it('drops unsafe styles, unknown tags and attributes, comments and unclosed tags', () => {
    expect(clean('<p style="background:url(https://t.example/p.gif)">x</p>')).toBe('<p>x</p>')
    expect(clean('<custom-el foo="1">text</custom-el>')).toBe('text')
    expect(clean('<p class="x" id="y" data-a="b">t</p>')).toBe('<p>t</p>')
    expect(clean('a<!-- <script>x</script> -->b')).toBe('ab')
    expect(clean('ok<img src=https://tracker.example/p')).toBe('ok')
  })

  it('escapes a stray < that opens no tag', () => {
    expect(clean('1 < 2')).toBe('1 &lt; 2')
  })
})
