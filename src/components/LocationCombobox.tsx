import { useState, useRef, useEffect, useId } from 'react'
import { useTranslation } from 'react-i18next'
import { MapPin } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useGooglePlacesSearch } from '@/hooks/useGooglePlacesSearch'
import { useHallSearch } from '@/hooks/useHallSearch'
import { formatLocationLabel } from '@/utils/locationLabel'
import type { LocationResult } from '@/types'

interface LocationComboboxProps {
  value: string
  onChange: (value: string) => void
  onSelect?: (result: LocationResult) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

export default function LocationCombobox({
  value,
  onChange,
  onSelect,
  placeholder,
  disabled,
  className,
}: LocationComboboxProps) {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listboxId = useId()

  const { results: hallResults } = useHallSearch(search)
  const { results: placesResults, isLoading: placesLoading } = useGooglePlacesSearch(search)

  const hasResults = hallResults.length > 0 || placesResults.length > 0 || placesLoading
  const listboxOpen = open && hasResults

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const handleSelect = (result: LocationResult) => {
    // ⚠ Not a plain `[name, address, city].join(', ')`. That is right for a hall
    // from our own table (three separate columns) and wrong for a Google Places
    // result, whose `address` is `formattedAddress` — already street + postcode +
    // city + country. See `tidyLocationLabel`.
    const display = formatLocationLabel(result)
    onChange(display)
    onSelect?.(result)
    setOpen(false)
    setSearch('')
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    onChange(val)
    setSearch(val)
    if (val.length > 0) setOpen(true)
  }

  const handleFocus = () => {
    if (value.length > 0 || search.length > 0) setOpen(true)
    setSearch(value)
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={listboxOpen}
          aria-controls={listboxOpen ? listboxId : undefined}
          aria-autocomplete="list"
          aria-haspopup="listbox"
          value={value}
          onChange={handleInputChange}
          onFocus={handleFocus}
          placeholder={placeholder || t('locationPlaceholder')}
          disabled={disabled}
          className={cn(
            'flex min-h-[44px] w-full rounded-md border border-input bg-transparent px-3 py-2 pr-10 text-sm shadow-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
            className,
          )}
        />
        <MapPin className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" />
      </div>

      {open && hasResults && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-md">
          <div id={listboxId} role="listbox" className="max-h-[200px] overflow-y-auto p-1">
            {hallResults.length > 0 && (
              <div>
                <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{t('clubHalls')}</div>
                {hallResults.map((r) => (
                  <button
                    key={`hall-${r.name}-${r.address}`}
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => handleSelect(r)}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                  >
                    <div className="h-full w-0.5 min-h-[24px] self-stretch rounded bg-gold-400" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{r.name}</div>
                      {(r.address || r.city) && (
                        <div className="truncate text-xs text-muted-foreground">
                          {[r.address, r.city].filter(Boolean).join(', ')}
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {(placesResults.length > 0 || placesLoading) && (
              <div>
                <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{t('searchResults')}</div>
                {placesLoading && (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">{t('searching')}</div>
                )}
                {placesResults.map((r, i) => (
                  <button
                    key={`places-${i}`}
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => handleSelect(r)}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{r.name}</div>
                      {(r.address || r.city) && (
                        <div className="truncate text-xs text-muted-foreground">
                          {[r.address, r.city].filter(Boolean).join(', ')}
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {open && search.length > 0 && !hasResults && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover p-2 shadow-md">
          <div className="text-sm text-muted-foreground">{t('noResults')}</div>
        </div>
      )}
    </div>
  )
}
