// src/modules/admin/components/ExplorerSectionCard.tsx
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight } from 'lucide-react'

interface Props {
  title: string
  count?: number | null
  /** Called once on first expansion. Safe to call multiple times — the consumer dedupes. */
  onExpand?: () => void
  /** If true (default), the `explorerLazyTag` hint is shown until first expansion. */
  lazy?: boolean
  children?: React.ReactNode
  isLoading?: boolean
  error?: Error | null
}

export default function ExplorerSectionCard({
  title,
  count,
  onExpand,
  lazy = true,
  children,
  isLoading,
  error,
}: Props) {
  const { t } = useTranslation('admin')
  const [open, setOpen] = useState(false)
  const [hasExpanded, setHasExpanded] = useState(false)

  const handleToggle = () => {
    const next = !open
    setOpen(next)
    if (next && !hasExpanded) {
      setHasExpanded(true)
      onExpand?.()
    }
  }

  return (
    <section className="mb-2 rounded-xl border border-hairline bg-surface-sunken">
      <button
        type="button"
        onClick={handleToggle}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-sm font-semibold text-foreground hover:bg-muted/70"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <span>{title}</span>
        {typeof count === 'number' && (
          <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
            {count}
          </span>
        )}
        {!open && lazy && !hasExpanded && (
          <span className="ml-auto text-[10px] font-normal text-muted-foreground">
            {t('explorerLazyTag')}
          </span>
        )}
      </button>
      {open && (
        <div className="border-t border-border px-3 py-2 text-sm">
          {isLoading && <div className="text-muted-foreground">{t('explorerLoading')}</div>}
          {error && <div className="text-destructive">{t('explorerError')}</div>}
          {!isLoading && !error && children}
        </div>
      )}
    </section>
  )
}
