import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Search } from 'lucide-react'

interface Props {
  value: string
  onChange: (v: string) => void
  onEnter?: () => void
}

export default function ExplorerSearch({ value, onChange, onEnter }: Props) {
  const { t } = useTranslation('admin')
  const inputRef = useRef<HTMLInputElement>(null)

  // ⌘K / Ctrl+K global focus
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <div className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5">
      <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onEnter?.()
          if (e.key === 'Escape') onChange('')
        }}
        placeholder={t('explorerSearchPlaceholder')}
        // `min-w-0`: without it the input refuses to shrink below its default
        // preferred size and the header overflows the viewport on a phone.
        className="w-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        autoComplete="off"
      />
      <kbd className="hidden sm:inline-block rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
        ⌘K
      </kbd>
    </div>
  )
}
