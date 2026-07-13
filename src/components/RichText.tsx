import { useMemo } from 'react'
import DOMPurify from 'dompurify'

/** Sanitize and render HTML content safely */
export default function RichText({
  html,
  className = '',
}: {
  html: string
  className?: string
}) {
  // Memoize so a list of RichText nodes doesn't re-sanitize unchanged HTML on
  // every render — DOMPurify.sanitize is pure w.r.t. `html`.
  const clean = useMemo(() => DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 's', 'a', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'blockquote', 'span'],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'class'],
    // Restrict href to http(s) absolute URLs or same-origin paths. Defense in
    // depth on top of DOMPurify's default URI allow-list — rejects javascript:,
    // data:, mailto:, vbscript:, cid:, etc.
    ALLOWED_URI_REGEXP: /^(?:https?:\/\/|\/(?!\/))/i,
  }), [html])

  return (
    <div
      className={`prose prose-sm max-w-none break-words [overflow-wrap:anywhere] dark:prose-invert prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-headings:my-1 prose-blockquote:my-1 prose-a:text-brand-600 dark:prose-a:text-brand-400 ${className}`}
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  )
}
