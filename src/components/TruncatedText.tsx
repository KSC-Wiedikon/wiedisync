import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Secondary text that may be cut off — ALWAYS with the full text in `title`.
 * Must sit in a `min-w-0` flex/grid track to shrink. Primary content (team
 * names, person names in rows) wraps instead — see /kscw-ui → "Long text".
 */
export default function TruncatedText({
  text, children, as: Tag = 'span', lines = 1, className,
}: {
  /** The full string (goes into `title`). */
  text: string
  /** Optional rich rendering; defaults to `text`. */
  children?: ReactNode
  as?: 'span' | 'p' | 'div' | 'h2' | 'h3' | 'h4'
  /** 1 = single-line ellipsis; 2/3 = line clamp (previews). */
  lines?: 1 | 2 | 3
  className?: string
}) {
  return (
    <Tag
      title={text}
      className={cn(
        'min-w-0',
        lines === 1 ? 'block truncate' : lines === 2 ? 'line-clamp-2 break-words' : 'line-clamp-3 break-words',
        className,
      )}
    >
      {children ?? text}
    </Tag>
  )
}
