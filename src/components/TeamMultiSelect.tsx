import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, X } from 'lucide-react'
import TeamChip from './TeamChip'

interface TeamOption {
  value: string
  label: string
  /** Key into teamColors for coloring (defaults to label) */
  colorKey?: string
  /** Optional group label (e.g. "Volleyball", "Basketball") */
  group?: string
}

interface TeamMultiSelectProps {
  options: TeamOption[]
  selected: string[]
  onChange: (selected: string[]) => void
  /** Placeholder when nothing is selected (defaults to t('common:all')) */
  placeholder?: string
}

export default function TeamMultiSelect({ options, selected, onChange, placeholder }: TeamMultiSelectProps) {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const allSelected = selected.length === 0

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  function toggle(value: string) {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value))
    } else {
      onChange([...selected, value])
    }
  }

  // Keyboard support for the custom listbox: Escape closes, arrows open + move
  // focus between options (Enter/Space toggle via the option button's onClick).
  function handleKeyDown(e: React.KeyboardEvent) {
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

  function handleSelectAll() {
    onChange([])
  }

  // Group options if any have a group
  const hasGroups = options.some((o) => o.group)
  const groups = hasGroups
    ? [...new Set(options.map((o) => o.group ?? ''))].filter(Boolean)
    : []

  // Selected chips to display
  const selectedOptions = allSelected ? [] : options.filter((o) => selected.includes(o.value))

  return (
    <div ref={ref} className="relative w-full" onKeyDown={handleKeyDown}>
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex min-h-[44px] w-full items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-sm shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:hover:bg-gray-700 sm:min-h-0"
      >
        <div className="flex flex-1 flex-wrap items-center gap-1.5 overflow-hidden">
          {allSelected ? (
            <span className="text-gray-500 dark:text-gray-400">{placeholder ?? t('all')}</span>
          ) : selectedOptions.length <= 5 ? (
            selectedOptions.map((o) => (
              <TeamChip key={o.value} team={o.colorKey ?? o.label} label={o.label} size="xs" />
            ))
          ) : (
            <span className="text-gray-700 dark:text-gray-300">
              {selectedOptions.length} {t('team')}{selectedOptions.length > 1 ? 's' : ''}
            </span>
          )}
        </div>
        <ChevronDown className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {!allSelected && selected.length > 0 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            handleSelectAll()
          }}
          className="absolute right-8 top-1/2 z-10 -translate-y-1/2 rounded-full p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
          title={t('selectNone')}
          aria-label={t('selectNone')}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}

      {/* Dropdown */}
      {open && (
        <div role="listbox" aria-multiselectable="true" className="absolute left-0 z-50 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-800">
          {/* All option */}
          <button
            type="button"
            role="option"
            aria-selected={allSelected}
            onClick={handleSelectAll}
            className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-gray-100 dark:hover:bg-gray-700 ${
              allSelected ? 'bg-brand-50 font-semibold text-brand-700 dark:bg-brand-900/30 dark:text-brand-300' : 'text-gray-700 dark:text-gray-300'
            }`}
          >
            <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 transition-colors ${
              allSelected ? 'border-brand-500 bg-brand-500' : 'border-gray-300 dark:border-gray-500'
            }`}>
              {allSelected && (
                <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 12 12" fill="none">
                  <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
            {placeholder ?? t('all')}
          </button>

          {hasGroups ? (
            groups.map((group) => {
              const groupOptions = options.filter((o) => o.group === group)
              const groupIds = groupOptions.map((o) => o.value)
              const allGroupSelected = !allSelected && groupIds.every((id) => selected.includes(id))
              const someGroupSelected = !allSelected && groupIds.some((id) => selected.includes(id))

              function toggleGroup() {
                if (allGroupSelected) {
                  // Deselect all in this group
                  onChange(selected.filter((v) => !groupIds.includes(v)))
                } else {
                  // Select all in this group
                  onChange([...new Set([...selected, ...groupIds])])
                }
              }

              return (
                <div key={group}>
                  <button
                    type="button"
                    onClick={toggleGroup}
                    className="sticky top-0 flex w-full items-center gap-2.5 bg-gray-50 px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 hover:bg-gray-100 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800"
                  >
                    <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border-2 transition-colors ${
                      allGroupSelected ? 'border-brand-500 bg-brand-500' : someGroupSelected ? 'border-brand-400 bg-brand-200 dark:bg-brand-800' : 'border-gray-300 dark:border-gray-500'
                    }`}>
                      {allGroupSelected && (
                        <svg className="h-2 w-2 text-white" viewBox="0 0 12 12" fill="none">
                          <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                      {someGroupSelected && !allGroupSelected && (
                        <span className="block h-1.5 w-1.5 rounded-sm bg-brand-500" />
                      )}
                    </span>
                    {group}
                  </button>
                  {groupOptions.map((o) => (
                    <DropdownOption
                      key={o.value}
                      option={o}
                      isSelected={!allSelected && selected.includes(o.value)}
                      onToggle={() => toggle(o.value)}
                    />
                  ))}
                </div>
              )
            })
          ) : (
            options.map((o) => (
              <DropdownOption
                key={o.value}
                option={o}
                isSelected={!allSelected && selected.includes(o.value)}
                onToggle={() => toggle(o.value)}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

function DropdownOption({ option, isSelected, onToggle }: { option: TeamOption; isSelected: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={isSelected}
      onClick={onToggle}
      className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-gray-100 dark:hover:bg-gray-700 ${
        isSelected ? 'bg-gray-100 dark:bg-gray-700/50' : ''
      }`}
    >
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 transition-colors ${
          isSelected
            ? 'border-brand-500 bg-brand-500'
            : 'border-gray-300 dark:border-gray-500'
        }`}
      >
        {isSelected && (
          <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 12 12" fill="none">
            <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <TeamChip team={option.colorKey ?? option.label} label={option.label} size="xs" />
    </button>
  )
}
