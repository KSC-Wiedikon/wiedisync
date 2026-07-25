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
 * Token-field layout: the chips live INSIDE the bordered box alongside the search
 * caret, so a saved nationality carries the same visual weight as any other filled
 * input on the form. (The first version put chips above a separate search box and
 * a saved value read as "nothing selected" — the empty search field dominated.)
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
  const inputRef = useRef<HTMLInputElement>(null)
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
      {label && (
        <Label id={labelId} className="mb-1.5">
          {label}
          {selected.length > 1 && (
            <span className="ml-1.5 font-normal text-muted-foreground tabular-nums">
              ({t('nSelected', { count: selected.length })})
            </span>
          )}
        </Label>
      )}

      {/* One bordered field, chips inside — the same visual weight as every other
          filled input on the form. The previous layout put chips ABOVE a separate
          search box, so a saved nationality read as "nothing selected": the empty
          search field was the dominant element. Clicking anywhere focuses the
          input, so the whole box behaves as one control. */}
      <div
        onClick={() => { if (!disabled) { inputRef.current?.focus(); setOpen(true) } }}
        className={cn(
          'flex min-h-[44px] w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-2 py-1.5 text-sm shadow-sm transition-colors focus-within:ring-1 focus-within:ring-ring',
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-text',
        )}
      >
        {selected.length === 0 && (
          <Search className="ml-1 h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        {selected.map((code, i) => (
            <span
              key={code}
              // Solid brand fill so a chosen nationality is unmistakable against
              // the form's neutral surface. Every chip gets the SAME weight —
              // tinting the non-primary ones differently made them read as "not
              // really selected", which is the opposite of the point. Primary-ness
              // is carried by the ordinal badge instead.
              className="inline-flex items-center gap-1.5 rounded-full bg-primary py-1 pl-2 pr-1 text-xs font-semibold text-primary-foreground shadow-sm"
              title={selected.length > 1 && i === 0 ? t('primaryNationality') : undefined}
            >
              {/* Order is meaningful — the first code is the one ClubDesk
                  receives — so number the chips once there is more than one. */}
              {selected.length > 1 && (
                <span className="grid h-4 w-4 place-items-center rounded-full bg-primary-foreground/25 text-[10px] leading-none tabular-nums">
                  {i + 1}
                </span>
              )}
              {byCode.get(code) ?? code}
              {!disabled && (
                <button
                  type="button"
                  // Stop the wrapper's focus/open handler — removing a chip
                  // shouldn't also pop the dropdown open.
                  onClick={(e) => { e.stopPropagation(); toggle(code) }}
                  aria-label={`${t('remove')} ${byCode.get(code) ?? code}`}
                  className="grid h-5 w-5 shrink-0 place-items-center rounded-full transition-colors hover:bg-primary-foreground/25"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-autocomplete="list"
          aria-labelledby={label ? labelId : undefined}
          disabled={disabled}
          // Shrinks to a caret beside the chips; only claims the full row when
          // nothing is selected yet.
          className="min-w-[6rem] flex-1 bg-transparent px-1 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
          placeholder={selected.length ? t('addCountry') : t('searchCountry')}
          value={search}
          onFocus={() => setOpen(true)}
          onChange={(e) => { setSearch(e.target.value); setOpen(true) }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { setOpen(false); return }
            // Backspace on an empty query removes the last chip — the standard
            // token-field affordance.
            if (e.key === 'Backspace' && !search && selected.length) {
              toggle(selected[selected.length - 1])
            }
          }}
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
                  // A chosen row must not look like a merely hovered one: hover
                  // is `bg-accent` (brand-50 / brand-900-50), so selection uses a
                  // stronger brand wash + bold brand text + a left brand bar, and
                  // keeps winning on hover.
                  'flex min-h-[44px] w-full items-center border-l-2 px-3 py-2 text-left text-sm transition-colors',
                  isSelected
                    // brand-500 is dark, so `text-primary` would sit low-contrast
                    // on a dark surface — dark mode gets a heavier wash + white text.
                    ? 'border-l-primary bg-primary/10 font-semibold text-primary hover:bg-primary/20 dark:bg-primary/30 dark:text-primary-foreground dark:hover:bg-primary/40'
                    : 'border-l-transparent hover:bg-accent',
                  isLastFavourite && 'border-b',
                )}
              >
                <Check
                  className={cn(
                    'mr-2 h-4 w-4 shrink-0',
                    isSelected ? 'opacity-100' : 'opacity-0',
                  )}
                />
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
