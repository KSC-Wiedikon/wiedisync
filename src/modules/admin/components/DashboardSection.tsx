import { useState, useEffect, type ReactNode } from 'react'

interface DashboardSectionProps {
  id: string
  title: string
  icon: ReactNode
  children: ReactNode
  isLoading?: boolean
  error?: string | null
  onRetry?: () => void
  emptyMessage?: string
  isEmpty?: boolean
}

const STORAGE_KEY = 'dashboard-sections'

function getOpenSections(): string[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
  } catch { return [] }
}

function toggleSection(id: string, open: boolean) {
  const sections = getOpenSections()
  const next = open ? [...new Set([...sections, id])] : sections.filter(s => s !== id)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
}

export default function DashboardSection({
  id, title, icon, children, isLoading, error, onRetry, emptyMessage, isEmpty
}: DashboardSectionProps) {
  const [open, setOpen] = useState(() => getOpenSections().includes(id))

  useEffect(() => { toggleSection(id, open) }, [id, open])

  return (
    <div className="rounded-lg border border-border">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold hover:bg-muted/50 transition-colors"
      >
        <span className="flex items-center gap-2">{icon}{title}</span>
        <span className="text-muted-foreground">{open ? '▼' : '▶'}</span>
      </button>
      {open && (
        <div className="border-t border-border px-4 py-3">
          {isLoading ? (
            <div className="animate-pulse space-y-2">
              <div className="h-4 bg-muted rounded w-3/4" />
              <div className="h-4 bg-muted rounded w-1/2" />
              <div className="h-4 bg-muted rounded w-2/3" />
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <span>{error}</span>
              {onRetry && (
                <button onClick={onRetry} className="underline hover:no-underline">
                  Retry
                </button>
              )}
            </div>
          ) : isEmpty ? (
            <p className="text-sm text-muted-foreground">{emptyMessage}</p>
          ) : children}
        </div>
      )}
    </div>
  )
}
