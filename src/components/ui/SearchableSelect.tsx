import { useState, useRef, useEffect, useLayoutEffect, useId } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Check, ChevronsUpDown, X } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { cn } from '@/lib/utils'

export interface SearchableSelectOption {
  value: string
  label: string
}

interface SearchableSelectProps {
  label?: string
  placeholder?: string
  searchPlaceholder?: string
  options: SearchableSelectOption[]
  value: string
  onChange: (value: string) => void
  error?: string
}

export default function SearchableSelect({
  label,
  placeholder = '—',
  searchPlaceholder,
  options,
  value,
  onChange,
  error,
}: SearchableSelectProps) {
  const { t } = useTranslation('common')
  const isDesktop = useMediaQuery('(min-width: 640px)')
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({})
  // Portal target — prefer the nearest [role="dialog"] ancestor so the
  // dropdown lives inside Radix Dialog's focus-trap / inert-sibling scope.
  // Falls back to document.body when not inside a dialog. On mobile we
  // skip portalling entirely and render inline — iOS keyboard appearance
  // shifts Vaul drawer's transformed bounds and detaches absolute-
  // positioned children, so an inline flow that pushes the form down is
  // less fragile.
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null)
  // Keyboard navigation: index of the highlighted option within `filtered`.
  const [activeIndex, setActiveIndex] = useState(-1)
  const listboxId = useId()
  const labelId = useId()

  const selectedLabel = options.find((o) => o.value === value)?.label ?? ''

  const filtered = search
    ? options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
    : options

  // Reset the highlighted option whenever the list opens or the query changes.
  useEffect(() => { setActiveIndex(-1) }, [open, search])

  // Keep the highlighted option scrolled into view.
  useEffect(() => {
    if (!open || activeIndex < 0) return
    document.getElementById(`${listboxId}-opt-${activeIndex}`)?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex, listboxId])

  const activeDescendant = open && activeIndex >= 0 ? `${listboxId}-opt-${activeIndex}` : undefined

  // Arrow-key navigation + Enter-to-select for the filtered listbox. Shared by
  // the desktop search input and the mobile filter input.
  function handleListKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setOpen(false); return }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (filtered.length === 0) return
      setActiveIndex((i) => (i < 0 ? 0 : (i + 1) % filtered.length))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (filtered.length === 0) return
      setActiveIndex((i) => (i < 0 ? filtered.length - 1 : (i - 1 + filtered.length) % filtered.length))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const pick = activeIndex >= 0 ? filtered[activeIndex] : (filtered.length === 1 ? filtered[0] : null)
      if (pick) { onChange(pick.value); setOpen(false) }
    }
  }

  // Position dropdown relative to trigger via portal. When inside a Radix
  // Dialog (which uses translate(-50%, -50%) on its content), portalling
  // there + position:fixed breaks — the transform creates a containing block
  // for fixed children. So we portal into the dialog ancestor and use
  // position:absolute with coordinates relative to the target's bounding box.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    if (!isDesktop) {
      // Inline render on mobile — no portal, no positioning calc.
      setPortalTarget(null)
      return
    }
    const dialogAncestor = triggerRef.current.closest('[role="dialog"]') as HTMLElement | null
    const target = dialogAncestor ?? document.body
    setPortalTarget(target)
    function updatePosition() {
      const triggerRect = triggerRef.current!.getBoundingClientRect()
      if (dialogAncestor) {
        const targetRect = dialogAncestor.getBoundingClientRect()
        setDropdownStyle({
          position: 'absolute',
          top: triggerRect.bottom - targetRect.top + 4,
          left: triggerRect.left - targetRect.left,
          width: triggerRect.width,
          zIndex: 9999,
        })
      } else {
        setDropdownStyle({
          position: 'fixed',
          top: triggerRect.bottom + 4,
          left: triggerRect.left,
          width: triggerRect.width,
          zIndex: 9999,
        })
      }
    }
    updatePosition()
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)
    return () => {
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [open, isDesktop])

  // Focus input when dropdown opens — desktop only. On mobile we avoid the
  // search input entirely (would pop the iOS keyboard and break the layout).
  useEffect(() => {
    if (open && isDesktop) {
      requestAnimationFrame(() => inputRef.current?.focus())
    } else if (!open) {
      setSearch('')
      // Drop the portal target reference when closing — prevents the
      // "removeChild: node is not a child of this node" race where the
      // parent dialog/drawer unmounts before our portal child does.
      setPortalTarget(null)
    }
  }, [open, isDesktop])

  // Force-close + drop portal target on unmount, in case the parent modal
  // is torn down while we're still open.
  useEffect(() => () => {
    setOpen(false)
    setPortalTarget(null)
  }, [])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      const target = e.target as Node
      if (
        containerRef.current && !containerRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      {label && <Label id={labelId} className="mb-1.5">{label}</Label>}
      <div
        ref={triggerRef}
        className={cn(
          'flex min-h-[44px] w-full items-center rounded-md border border-input bg-transparent text-sm shadow-sm ring-offset-background transition-colors',
          open && 'ring-1 ring-ring',
          error && 'border-destructive',
        )}
      >
        {open && isDesktop ? (
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={activeDescendant}
            aria-labelledby={label ? labelId : undefined}
            className="flex-1 bg-transparent px-3 py-2 outline-none placeholder:text-muted-foreground"
            placeholder={searchPlaceholder ?? t('search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleListKeyDown}
          />
        ) : (
          <button
            type="button"
            role="combobox"
            aria-expanded={open}
            aria-haspopup="listbox"
            aria-controls={open ? listboxId : undefined}
            aria-activedescendant={activeDescendant}
            aria-labelledby={label ? labelId : undefined}
            className="flex flex-1 items-center justify-between px-3 py-2 text-left"
            onClick={() => setOpen((v) => !v)}
          >
            <span className={selectedLabel ? '' : 'text-muted-foreground'}>
              {selectedLabel || placeholder}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </button>
        )}
        {open && isDesktop && value && (
          <button
            type="button"
            className="mr-2 rounded p-0.5 text-muted-foreground hover:text-foreground"
            onClick={() => { onChange(''); inputRef.current?.focus() }}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {open && !isDesktop && (
        <div ref={dropdownRef} data-searchable-select className="mt-1 cursor-default rounded-md border bg-popover shadow-md">
          {/* Filter input — NOT auto-focused so the iOS keyboard only appears
              when the user taps it (large member lists stay filterable without
              popping the keyboard on open). */}
          <div className="border-b p-2">
            <input
              type="text"
              role="combobox"
              aria-expanded={open}
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-activedescendant={activeDescendant}
              aria-labelledby={label ? labelId : undefined}
              className="min-h-[40px] w-full rounded border border-input bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground"
              placeholder={searchPlaceholder ?? t('search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleListKeyDown}
            />
          </div>
          <ul
            id={listboxId}
            className="max-h-72 overflow-y-auto overscroll-contain py-1 [touch-action:pan-y] [-webkit-overflow-scrolling:touch]"
            role="listbox"
          >
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-sm text-muted-foreground">{t('noResults')}</li>
            )}
            {filtered.map((option, i) => (
              <li
                key={option.value}
                id={`${listboxId}-opt-${i}`}
                role="option"
                aria-selected={value === option.value}
                className={cn(
                  'flex min-h-[44px] cursor-pointer select-none items-center px-3 py-2 text-sm hover:bg-accent',
                  (value === option.value || i === activeIndex) && 'bg-accent',
                )}
                onClick={() => {
                  onChange(option.value)
                  setOpen(false)
                }}
              >
                <Check
                  className={cn(
                    'mr-2 h-4 w-4',
                    value === option.value ? 'opacity-100' : 'opacity-0',
                  )}
                />
                {option.label}
              </li>
            ))}
          </ul>
        </div>
      )}
      {open && isDesktop && portalTarget && portalTarget.isConnected && createPortal(
        <div ref={dropdownRef} data-searchable-select style={dropdownStyle} className="cursor-default rounded-md border bg-popover shadow-md">
          <ul
            id={listboxId}
            className="max-h-60 overflow-y-auto overscroll-contain py-1 [touch-action:pan-y] [-webkit-overflow-scrolling:touch]"
            role="listbox"
          >
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-sm text-muted-foreground">{t('noResults')}</li>
            )}
            {filtered.map((option, i) => (
              <li
                key={option.value}
                id={`${listboxId}-opt-${i}`}
                role="option"
                aria-selected={value === option.value}
                className={cn(
                  'flex min-h-[44px] cursor-pointer select-none items-center px-3 py-2 text-sm hover:bg-accent',
                  (value === option.value || i === activeIndex) && 'bg-accent',
                )}
                onClick={() => {
                  onChange(option.value)
                  setOpen(false)
                }}
              >
                <Check
                  className={cn(
                    'mr-2 h-4 w-4',
                    value === option.value ? 'opacity-100' : 'opacity-0',
                  )}
                />
                {option.label}
              </li>
            ))}
          </ul>
        </div>,
        portalTarget,
      )}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  )
}
