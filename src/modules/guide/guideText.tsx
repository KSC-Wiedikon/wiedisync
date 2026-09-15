import type { ReactNode } from 'react'
import type { GuideSectionContent } from './types'

/**
 * Minimal inline markup for guide text: `**label**` renders bold (UI labels),
 * `` `code` `` renders monospace, and every occurrence of `query` is wrapped in
 * a highlight. Nothing else — the guide is prose, not markdown, and
 * translators must not have to learn a syntax.
 */
export function inline(text: string, query?: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-semibold">{highlight(part.slice(2, -2), query)}</strong>
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={i} className="rounded bg-muted px-1 py-0.5 text-[0.85em]">{highlight(part.slice(1, -1), query)}</code>
    }
    return <span key={i}>{highlight(part, query)}</span>
  })
}

function highlight(text: string, query?: string): ReactNode {
  if (!query) return text
  const lower = text.toLowerCase()
  const out: ReactNode[] = []
  let from = 0
  let idx = lower.indexOf(query, from)
  if (idx === -1) return text
  let k = 0
  while (idx !== -1) {
    if (idx > from) out.push(text.slice(from, idx))
    out.push(<mark key={k++} className="rounded-sm bg-primary/25 px-0.5 text-inherit">{text.slice(idx, idx + query.length)}</mark>)
    from = idx + query.length
    idx = lower.indexOf(query, from)
  }
  if (from < text.length) out.push(text.slice(from))
  return out
}

/** Plain lower-cased text of a section, for search. */
export function sectionText(c: GuideSectionContent): string {
  const bodyText = c.body.map((b) => ('items' in b ? b.items.join(' ') : b.text)).join(' ')
  return `${c.title} ${c.summary} ${bodyText}`.toLowerCase()
}

/** How many times `query` occurs in a section (title, summary and body). */
export function countMatches(c: GuideSectionContent, query: string): number {
  if (!query) return 0
  const text = sectionText(c)
  let n = 0
  let idx = text.indexOf(query)
  while (idx !== -1) { n++; idx = text.indexOf(query, idx + query.length) }
  return n
}
