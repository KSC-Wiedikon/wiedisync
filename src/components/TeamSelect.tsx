import { useState, useRef, useEffect } from 'react'
import type { Team } from '../types'
import { getTeamColor } from '../utils/teamColors'
import { ChevronDown } from 'lucide-react'

interface TeamSelectProps {
  value: string
  onChange: (value: string) => void
  teams: Team[]
  disabled?: boolean
  placeholder?: string
  'aria-label'?: string
  className?: string
  /** Compact mode for table cells */
  compact?: boolean
}

export default function TeamSelect({
  value,
  onChange,
  teams,
  disabled,
  placeholder = '—',
  'aria-label': ariaLabel,
  className = '',
  compact,
}: TeamSelectProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const selected = teams.find((t) => t.id === value)
  const selectedColor = selected ? getTeamColor(selected.name) : null

  const btnBase = compact
    ? 'flex h-9 w-full items-center gap-1.5 rounded-lg border px-1.5 text-xs sm:h-8'
    : 'flex h-11 w-full items-center gap-2 rounded-lg border px-3 text-sm sm:h-9'

  // Keyboard support for the custom listbox: Escape closes, arrows open + move
  // focus between options (Enter/Space fire the option button's native onClick).
  function handleKeyDown(e: React.KeyboardEvent) {
    if (disabled) return
    if (e.key === 'Escape') {
      if (open) { setOpen(false); e.stopPropagation() }
      return
    }
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        setOpen(true)
        e.preventDefault()
      }
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const items = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])
      if (items.length === 0) return
      const idx = items.findIndex((el) => el === document.activeElement)
      const next = e.key === 'ArrowDown'
        ? Math.min(items.length - 1, idx + 1)
        : Math.max(0, idx - 1)
      items[idx === -1 ? 0 : next]?.focus()
    }
  }

  return (
    <div ref={ref} className={`relative ${className}`} onKeyDown={handleKeyDown}>
      <button
        type="button"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`${btnBase} border-input bg-card text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-input/20 ${
          disabled ? 'cursor-not-allowed opacity-60' : 'hover:border-stone-400 dark:hover:border-gray-500'
        } ${open ? 'border-primary/60 ring-2 ring-ring' : ''}`}
      >
        {selectedColor ? (
          <>
            <span
              className="inline-block h-3 w-3 shrink-0 rounded-full border"
              style={{ backgroundColor: selectedColor.bg, borderColor: selectedColor.border }}
            />
            <span className="truncate text-foreground" title={selected!.name}>{selected!.name}</span>
          </>
        ) : (
          <span className="truncate text-muted-foreground/80" title={placeholder}>{placeholder}</span>
        )}
        <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-muted-foreground/80" />
      </button>

      {open && (
        <div role="listbox" aria-label={ariaLabel} className="absolute z-50 mt-1 max-h-60 w-full min-w-[140px] overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-xl">
          {/* Empty option */}
          <button
            type="button"
            role="option"
            aria-selected={!value}
            onClick={() => { onChange(''); setOpen(false) }}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground/80 hover:bg-accent"
          >
            {placeholder}
          </button>
          {teams.map((team) => {
            const color = getTeamColor(team.name)
            const isSelected = team.id === value
            return (
              <button
                key={team.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => { onChange(team.id); setOpen(false) }}
                className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                  isSelected
                    ? 'bg-primary/10 font-semibold text-primary dark:bg-primary/25 dark:text-brand-200'
                    : 'text-foreground hover:bg-accent'
                }`}
              >
                <span
                  className="inline-block h-3 w-3 shrink-0 rounded-full border"
                  style={{ backgroundColor: color.bg, borderColor: color.border }}
                />
                <span className="truncate" title={team.name}>{team.name}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
