// src/modules/admin/components/ExplorerFieldSearch.tsx
//
// The datapoint picker in the explorer header. Type "ahv", "licence",
// "geburtsdatum" → pick the field → both explorer views focus on it:
// the grid shows it as a column, the member detail shows that card alone.
//
// Deliberately multi-select: "show me AHV and the scorer licence side by side"
// is the actual question an admin has, and it is one column set in the grid.
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Crosshair, X } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { rankMemberFields, memberFieldLabel } from './memberFieldSearch'

interface Props {
  /** Selected `members` column keys, in pick order. */
  value: string[]
  onChange: (next: string[]) => void
}

export default function ExplorerFieldSearch({ value, onChange }: Props) {
  const { t } = useTranslation('admin')
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const results = useMemo(() => rankMemberFields(query), [query])

  const toggle = (key: string) => {
    onChange(value.includes(key) ? value.filter((k) => k !== key) : [...value, key])
  }

  return (
    <div className="flex items-center gap-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={
              'inline-flex min-h-[34px] items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium '
              + (value.length > 0
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-card text-foreground hover:bg-muted')
            }
            title={t('explorerDatapointTitle')}
          >
            <Crosshair className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">{t('explorerDatapoint')}</span>
            {value.length > 0 && (
              <span className="rounded bg-primary px-1 text-[10px] text-primary-foreground">
                {value.length}
              </span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 p-2">
          <input
            ref={inputRef}
            type="search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // Enter picks the top hit, so the whole flow is type-then-Enter.
              if (e.key === 'Enter' && results[0]) {
                e.preventDefault()
                toggle(results[0].def.key)
              }
              if (e.key === 'Escape') setQuery('')
            }}
            placeholder={t('explorerDatapointPlaceholder')}
            className="mb-2 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
            autoComplete="off"
          />

          {value.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1 border-b border-border pb-2">
              {value.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggle(key)}
                  className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/20"
                >
                  {memberFieldLabel(key)}
                  <X className="h-3 w-3" />
                </button>
              ))}
              <button
                type="button"
                onClick={() => onChange([])}
                className="rounded-full px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
              >
                {t('explorerDatapointClear')}
              </button>
            </div>
          )}

          <div className="max-h-72 overflow-y-auto">
            {query.trim() === '' ? (
              <p className="px-1 py-2 text-xs text-muted-foreground">{t('explorerDatapointHint')}</p>
            ) : results.length === 0 ? (
              <p className="px-1 py-2 text-xs text-muted-foreground">{t('explorerDatapointNoMatch')}</p>
            ) : (
              results.map(({ def, groupLabel }) => {
                const selected = value.includes(def.key)
                return (
                  <button
                    key={def.key}
                    type="button"
                    onClick={() => toggle(def.key)}
                    className={
                      'flex w-full min-h-[44px] flex-col items-start rounded px-1.5 py-1 text-left hover:bg-muted '
                      + (selected ? 'bg-primary/10' : '')
                    }
                  >
                    <span className="flex w-full items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-foreground">{def.label}</span>
                      {def.readOnly && (
                        <span className="shrink-0 rounded bg-muted px-1 text-[9px] tracking-wide text-muted-foreground">
                          {t('explorerDatapointReadOnly')}
                        </span>
                      )}
                    </span>
                    <span className="flex w-full items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className="truncate">{groupLabel}</span>
                      <code className="truncate font-mono text-muted-foreground/70">{def.key}</code>
                    </span>
                  </button>
                )
              })
            )}
          </div>
        </PopoverContent>
      </Popover>

      {/* Outside the popover so the focus stays visible (and clearable) once it
          is closed — otherwise a filtered view has no on-screen explanation. */}
      {value.length > 0 && (
        <button
          type="button"
          onClick={() => onChange([])}
          className="inline-flex min-h-[34px] items-center gap-1 rounded-md border border-border bg-card px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted"
          title={t('explorerDatapointClear')}
        >
          <X className="h-3.5 w-3.5" />
          <span className="hidden xl:inline">{t('explorerDatapointClear')}</span>
        </button>
      )}
    </div>
  )
}
