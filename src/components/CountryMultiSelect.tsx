import { useState, useMemo, useId, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Search, Check } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { countryOptions, parseCountryCodes, FAVORITE_CODES } from '../utils/countries'

interface CountryMultiSelectProps {
  label?: string
  /** Ordered ISO 3166-1 alpha-2 codes. The FIRST one is the primary nationality. */
  selected: string[]
  onChange: (codes: string[]) => void
  helperText?: string
  disabled?: boolean
}

/**
 * Country picker for `members.nationalitaet_codes` — multi-select, searchable,
 * order-preserving. Selection order is meaningful: the first code is the primary
 * nationality and is the one pushed to ClubDesk, whose field holds a single
 * value. Chips therefore render in selection order, not alphabetically.
 *
 * Follows the MemberMultiSelect grammar (chips above, search + absolute list).
 */
export default function CountryMultiSelect({
  label,
  selected,
  onChange,
  helperText,
  disabled,
}: CountryMultiSelectProps) {
  const { t } = useTranslation('common')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const listboxId = useId()
  const labelId = useId()

  // countryOptions() memoizes per locale internally and returns a stable array
  // for a given language, so calling it per render is cheap and the identity is
  // steady enough for the derived Map's memo.
  const options = countryOptions()
  const byCode = useMemo(() => new Map(options.map((o) => [o.value, o.label])), [options])

  const selectedSet = useMemo(() => new Set(selected), [selected])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return options
    // Match the localized name or the ISO code itself ("CH" finds Switzerland).
    return options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase() === q)
  }, [options, search])

  // Close on outside click — the list is an absolutely-positioned sibling, so a
  // click anywhere else should dismiss it.
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  function toggle(code: string) {
    onChange(selectedSet.has(code) ? selected.filter((c) => c !== code) : [...selected, code])
  }

  return (
    <div ref={containerRef} className="relative">
      {label && <Label id={labelId} className="mb-1.5">{label}</Label>}

      {selected.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {selected.map((code, i) => (
            <span
              key={code}
              className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-2.5 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-900/40 dark:text-brand-300"
              // The first chip is the value ClubDesk receives — say so rather
              // than relying on position alone.
              title={i === 0 && selected.length > 1 ? `${byCode.get(code) ?? code} (1.)` : undefined}
            >
              {byCode.get(code) ?? code}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => toggle(code)}
                  aria-label={`${t('remove')} ${byCode.get(code) ?? code}`}
                  className="hover:text-brand-900 dark:hover:text-brand-100"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-autocomplete="list"
          aria-labelledby={label ? labelId : undefined}
          disabled={disabled}
          className="min-h-[44px] w-full rounded-md border border-input bg-transparent py-2 pl-9 pr-3 text-sm shadow-sm outline-none ring-offset-background transition-colors placeholder:text-muted-foreground focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          placeholder={t('searchCountry')}
          value={search}
          onFocus={() => setOpen(true)}
          onChange={(e) => { setSearch(e.target.value); setOpen(true) }}
          onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false) }}
        />
      </div>

      {open && !disabled && (
        <div
          id={listboxId}
          role="listbox"
          aria-multiselectable="true"
          className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto overscroll-contain rounded-md border bg-popover shadow-lg [touch-action:pan-y] [-webkit-overflow-scrolling:touch]"
        >
          {filtered.length === 0 && (
            <div className="px-3 py-2 text-sm text-muted-foreground">{t('noResults')}</div>
          )}
          {filtered.map((o, i) => {
            const isSelected = selectedSet.has(o.value)
            // Visually separate the pinned favourites from the full A–Z list.
            const isLastFavourite = !search && i === FAVORITE_CODES.length - 1
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => toggle(o.value)}
                className={cn(
                  'flex min-h-[44px] w-full items-center px-3 py-2 text-left text-sm transition-colors hover:bg-accent',
                  isSelected && 'bg-accent',
                  isLastFavourite && 'border-b',
                )}
              >
                <Check className={cn('mr-2 h-4 w-4 shrink-0', isSelected ? 'opacity-100' : 'opacity-0')} />
                {o.label}
              </button>
            )
          })}
        </div>
      )}

      {helperText && <p className="mt-1 text-xs text-muted-foreground">{helperText}</p>}
    </div>
  )
}

/** Convenience wrapper for callers holding the stored comma-separated string. */
export function CountryMultiSelectField({
  value,
  onChange,
  ...rest
}: Omit<CountryMultiSelectProps, 'selected' | 'onChange'> & {
  value: string | null | undefined
  onChange: (codes: string[]) => void
}) {
  return <CountryMultiSelect {...rest} selected={parseCountryCodes(value)} onChange={onChange} />
}
