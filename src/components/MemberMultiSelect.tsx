import { useState, useMemo, useId } from 'react'
import { useTranslation } from 'react-i18next'
import { useCollection } from '../lib/query'
import { X, Search, Check } from 'lucide-react'
import type { Member } from '../types'
import { memberDisplayName } from '../utils/relations'

interface MemberMultiSelectProps {
  selected: string[]
  onChange: (ids: string[]) => void
}

export default function MemberMultiSelect({ selected, onChange }: MemberMultiSelectProps) {
  const { t } = useTranslation('invitations')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const listboxId = useId()

  const { data: membersRaw } = useCollection<Member>('members', {
    filter: { wiedisync_active: { _eq: true } },
    fields: ['id', 'nickname', 'first_name', 'last_name', 'email'],
    sort: ['last_name', 'first_name'],
    limit: -1,
  })
  const members = membersRaw ?? []

  const filtered = useMemo(() => {
    if (!search) return members
    const q = search.toLowerCase()
    return members.filter(m =>
      `${m.first_name} ${m.last_name}`.toLowerCase().includes(q) ||
      memberDisplayName(m).toLowerCase().includes(q) ||
      m.email?.toLowerCase().includes(q)
    )
  }, [members, search])

  const selectedMembers = useMemo(
    () => members.filter(m => selected.includes(String(m.id))),
    [members, selected]
  )

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id])
  }

  return (
    <div>
      {selectedMembers.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {selectedMembers.map(m => (
            <span key={m.id} className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-2.5 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
              {memberDisplayName(m)}
              <button type="button" onClick={() => toggle(m.id)} className="hover:text-brand-900 dark:hover:text-brand-100">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="relative">
        <div className="flex items-center gap-2 rounded-md border border-gray-200 bg-transparent px-3 py-2 dark:border-gray-600">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            role="combobox"
            aria-expanded={open && filtered.length > 0}
            aria-controls={open && filtered.length > 0 ? listboxId : undefined}
            aria-autocomplete="list"
            aria-haspopup="listbox"
            value={search}
            onChange={e => { setSearch(e.target.value); setOpen(true) }}
            onFocus={() => setOpen(true)}
            placeholder={t('searchMembers')}
            className="flex-1 bg-transparent text-sm outline-none dark:text-gray-100"
          />
        </div>

        {open && filtered.length > 0 && (
          <div id={listboxId} role="listbox" aria-multiselectable="true" className="absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-800">
            {filtered.length > 50 && (
              <div className="sticky top-0 border-b border-gray-100 bg-gray-50 px-3 py-1.5 text-xs text-muted-foreground dark:border-gray-700 dark:bg-gray-900">
                {t('common:showingFirstOf', { shown: 50, total: filtered.length })}
              </div>
            )}
            {filtered.slice(0, 50).map(m => {
              const isSelected = selected.includes(String(m.id))
              return (
                <button
                  key={m.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => toggle(m.id)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  <div aria-hidden="true" className={`flex h-4 w-4 items-center justify-center rounded border ${isSelected ? 'border-brand-500 bg-brand-500 text-white' : 'border-gray-300 dark:border-gray-500'}`}>
                    {isSelected && <Check className="h-3 w-3" />}
                  </div>
                  <span className="dark:text-gray-100">{memberDisplayName(m)}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{m.email}</span>
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
