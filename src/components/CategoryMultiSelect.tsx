import { useState, useRef, useEffect, useMemo, useId } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, X } from 'lucide-react'

interface CategoryColor {
  bg: string
  text: string
  border: string
}

interface CategoryOption {
  value: string
  label: string
  /** Hex color object matching the teamColors pattern */
  color: CategoryColor
  /** Group label for sectioning (e.g. "Games", "Activities") */
  group?: string
}

interface CategoryMultiSelectProps {
  options: CategoryOption[]
  selected: string[]
  onChange: (selected: string[]) => void
  /** Placeholder when all selected */
  placeholder?: string
  /** Render options list inline (no collapsible dropdown). Useful inside modals. */
  inline?: boolean
}

export default function CategoryMultiSelect({ options, selected, onChange, placeholder, inline = false }: CategoryMultiSelectProps) {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const listboxId = useId()

  const allSelected = selected.length === options.length
  const noneSelected = selected.length === 0

  // O(1) membership checks instead of repeated Array.includes across every option.
  const selectedSet = useMemo(() => new Set(selected), [selected])

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

  function handleSelectAll() {
    onChange(options.map((o) => o.value))
  }

  function handleSelectNone() {
    onChange([])
  }

  // Group options if any have a group — the option→group partitioning only
  // depends on `options`, so memoize it (recomputed the full pass on every
  // parent keystroke otherwise).
  const { hasGroups, groupedOptions } = useMemo(() => {
    const has = options.some((o) => o.group)
    if (!has) return { hasGroups: false, groupedOptions: [] as { group: string; options: CategoryOption[]; values: string[] }[] }
    const groupNames = [...new Set(options.map((o) => o.group ?? ''))].filter(Boolean)
    return {
      hasGroups: true,
      groupedOptions: groupNames.map((group) => {
        const groupOptions = options.filter((o) => o.group === group)
        return { group, options: groupOptions, values: groupOptions.map((o) => o.value) }
      }),
    }
  }, [options])

  // Selected options for display
  const selectedOptions = useMemo(() => options.filter((o) => selectedSet.has(o.value)), [options, selectedSet])

  const list = (
    <>
      {/* All option */}
      <button
        type="button"
        role="option"
        aria-selected={allSelected}
        onClick={allSelected ? handleSelectNone : handleSelectAll}
        className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-gray-100 dark:hover:bg-gray-700 ${
          allSelected ? 'bg-brand-50 font-semibold text-brand-700 dark:bg-brand-900/30 dark:text-brand-300' : 'text-gray-700 dark:text-gray-300'
        }`}
      >
        <Checkbox checked={allSelected} indeterminate={!allSelected && !noneSelected} />
        {placeholder ?? t('all')}
      </button>

      {hasGroups ? (
        groupedOptions.map(({ group, options: groupOptions, values: groupValues }) => {
          const allGroupSelected = groupValues.every((v) => selectedSet.has(v))
          const someGroupSelected = groupValues.some((v) => selectedSet.has(v))

          function toggleGroup() {
            if (allGroupSelected) {
              onChange(selected.filter((v) => !groupValues.includes(v)))
            } else {
              onChange([...new Set([...selected, ...groupValues])])
            }
          }

          return (
            <div key={group} role="group" aria-label={group}>
              <button
                type="button"
                onClick={toggleGroup}
                aria-pressed={allGroupSelected}
                className="sticky top-0 flex w-full items-center gap-2.5 bg-gray-50 px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 hover:bg-gray-100 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800"
              >
                <Checkbox checked={allGroupSelected} indeterminate={someGroupSelected && !allGroupSelected} size="sm" />
                {group}
              </button>
              {groupOptions.map((o) => (
                <OptionRow key={o.value} option={o} isSelected={selectedSet.has(o.value)} onToggle={() => toggle(o.value)} />
              ))}
            </div>
          )
        })
      ) : (
        options.map((o) => (
          <OptionRow key={o.value} option={o} isSelected={selectedSet.has(o.value)} onToggle={() => toggle(o.value)} />
        ))
      )}
    </>
  )

  if (inline) {
    return (
      <div role="listbox" aria-multiselectable="true" className="w-full overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-600 dark:bg-gray-800">
        {list}
      </div>
    )
  }

  return (
    <div ref={ref} className="relative w-full">
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        className="flex min-h-[44px] w-full items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-sm shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:hover:bg-gray-700 sm:min-h-0"
      >
        <div className="flex flex-1 flex-wrap items-center gap-1.5 overflow-hidden">
          {allSelected ? (
            <span className="text-gray-500 dark:text-gray-400">{placeholder ?? t('all')}</span>
          ) : noneSelected ? (
            <span className="text-gray-500 dark:text-gray-400">{t('none')}</span>
          ) : selectedOptions.length <= 4 ? (
            selectedOptions.map((o) => (
              <ColorChip key={o.value} label={o.label} color={o.color} />
            ))
          ) : (
            <span className="text-gray-700 dark:text-gray-300">
              {selectedOptions.length}/{options.length}
            </span>
          )}
        </div>
        <ChevronDown className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Clear / Select all button */}
      {!allSelected && !noneSelected && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            handleSelectAll()
          }}
          className="absolute right-8 top-1/2 z-10 -translate-y-1/2 rounded-full p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
          title={t('selectAll')}
          aria-label={t('selectAll')}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}

      {/* Dropdown */}
      {open && (
        <div id={listboxId} role="listbox" aria-multiselectable="true" className="absolute left-0 z-50 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-800">
          {list}
        </div>
      )}
    </div>
  )
}

function ColorChip({ label, color }: { label: string; color: CategoryColor }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ backgroundColor: color.bg, color: color.text, borderColor: color.border, borderWidth: '1px', borderStyle: 'solid' }}
    >
      {label}
    </span>
  )
}

function OptionRow({ option, isSelected, onToggle }: { option: CategoryOption; isSelected: boolean; onToggle: () => void }) {
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
      <Checkbox checked={isSelected} />
      <ColorChip label={option.label} color={option.color} />
    </button>
  )
}

function Checkbox({ checked, indeterminate, size = 'md' }: { checked: boolean; indeterminate?: boolean; size?: 'sm' | 'md' }) {
  const sizeClass = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'
  return (
    <span aria-hidden="true" className={`flex ${sizeClass} shrink-0 items-center justify-center rounded border-2 transition-colors ${
      checked ? 'border-brand-500 bg-brand-500' : indeterminate ? 'border-brand-400 bg-brand-200 dark:bg-brand-800' : 'border-gray-300 dark:border-gray-500'
    }`}>
      {checked && (
        <svg className={size === 'sm' ? 'h-2 w-2 text-white' : 'h-2.5 w-2.5 text-white'} viewBox="0 0 12 12" fill="none">
          <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {indeterminate && !checked && (
        <span className="block h-1.5 w-1.5 rounded-sm bg-brand-500" />
      )}
    </span>
  )
}
