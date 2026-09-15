import { Lightbulb, TriangleAlert } from 'lucide-react'
import type { GuideBlock } from './types'
import { inline } from './guideText'

/**
 * Renders a section body. `query` (lower-cased, trimmed) highlights every
 * match in the text — the search box and the help panel both use this.
 */
export function GuideBody({ body, query }: { body: GuideBlock[]; query?: string }) {
  return <>{body.map((block, i) => <Block key={i} block={block} query={query} />)}</>
}

function Block({ block, query }: { block: GuideBlock; query?: string }) {
  switch (block.t) {
    case 'h':
      return <h3 className="pt-2 font-semibold text-foreground">{inline(block.text, query)}</h3>
    case 'p':
      return <p className="leading-relaxed">{inline(block.text, query)}</p>
    case 'ul':
      return (
        <ul className="list-disc space-y-1 pl-5">
          {block.items.map((it, i) => <li key={i} className="leading-relaxed">{inline(it, query)}</li>)}
        </ul>
      )
    case 'ol':
      return (
        <ol className="list-decimal space-y-1 pl-5">
          {block.items.map((it, i) => <li key={i} className="leading-relaxed">{inline(it, query)}</li>)}
        </ol>
      )
    case 'tip':
      return (
        <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 p-3">
          <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p className="leading-relaxed">{inline(block.text, query)}</p>
        </div>
      )
    case 'note':
      return (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-amber-900 dark:text-amber-200">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="leading-relaxed">{inline(block.text, query)}</p>
        </div>
      )
    default:
      return null
  }
}
