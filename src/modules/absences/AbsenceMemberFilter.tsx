import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, Users } from 'lucide-react'
import type { MemberFilterOption } from './absenceMemberOptions'
import { Button } from '@/components/ui/button'

interface AbsenceMemberFilterProps {
  options: MemberFilterOption[]
  /** Member IDs that are currently filtered OUT (everyone else is shown). */
  excluded: Set<string>
  onChange: (excluded: Set<string>) => void
}

/**
 * Multi-select dropdown to filter an absence list by member. All members are
 * selected by default — selection is tracked as the set of *excluded* IDs so
 * that members appearing later (e.g. after a team switch) stay visible.
 */
export default function AbsenceMemberFilter({ options, excluded, onChange }: AbsenceMemberFilterProps) {
  const { t } = useTranslation('absences')
  const [open, setOpen] = useState(false)

  const selectedCount = useMemo(
    () => options.filter((o) => !excluded.has(o.id)).length,
    [options, excluded],
  )

  if (options.length === 0) return null

  const allSelected = selectedCount === options.length

  function toggle(id: string) {
    const next = new Set(excluded)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(next)
  }

  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
        {t('filterByMember')}
      </label>
      <div className="relative">
        <Button
          type="button"
          variant="outline"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="w-full min-w-[12rem] justify-between px-3 font-normal dark:border-gray-600 dark:text-gray-100"
        >
          <span className="flex min-w-0 items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            {allSelected
              ? t('allMembers')
              : t('membersSelected', { count: selectedCount, total: options.length })}
          </span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </Button>

        {open && (
          <div className="absolute z-50 mt-1 max-h-72 w-64 overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-800">
            <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-3 py-1 dark:border-gray-700">
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={() => onChange(new Set())}
                className="px-0 text-brand-700 dark:text-brand-300"
              >
                {t('selectAllMembers')}
              </Button>
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={() => onChange(new Set(options.map((o) => o.id)))}
                className="px-0 text-brand-700 dark:text-brand-300"
              >
                {t('deselectAllMembers')}
              </Button>
            </div>
            {options.map((o) => {
              const isSelected = !excluded.has(o.id)
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => toggle(o.id)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  <div
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                      isSelected
                        ? 'border-brand-500 bg-brand-500 text-white'
                        : 'border-gray-300 dark:border-gray-500'
                    }`}
                  >
                    {isSelected && <Check className="h-3 w-3" />}
                  </div>
                  <span className="dark:text-gray-100">{o.name}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>
      {open && <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />}
    </div>
  )
}
