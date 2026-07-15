import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { X, Users } from 'lucide-react'
import Modal from '@/components/Modal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import Avatar from './Avatar'
import { useMemberSearch } from '../hooks/useMemberSearch'
import { messagingApi, type SearchableMember } from '../api/messaging'
import { memberDisplayName } from '../../../utils/relations'

export interface NewMessageDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function displayName(m: SearchableMember): string {
  // On-screen UI: prefer the member's nickname over first_name (falls back).
  return memberDisplayName(m) || '—'
}

export default function NewMessageDialog({ open, onOpenChange }: NewMessageDialogProps) {
  const { t } = useTranslation('messaging')
  const navigate = useNavigate()

  const [groupMode, setGroupMode] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<SearchableMember[]>([])
  const [title, setTitle] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const { results, loading } = useMemberSearch(query, { enabled: open })

  const close = () => {
    if (submitting) return
    setQuery('')
    setSelected([])
    setTitle('')
    setGroupMode(false)
    onOpenChange(false)
  }

  const selectedIds = useMemo(() => new Set(selected.map(s => s.id)), [selected])

  const toggleSelect = (m: SearchableMember) => {
    if (groupMode) {
      setSelected(prev =>
        selectedIds.has(m.id) ? prev.filter(s => s.id !== m.id) : [...prev, m],
      )
    } else {
      void startSingleDm(m)
    }
  }

  const startSingleDm = async (m: SearchableMember) => {
    setSubmitting(true)
    try {
      const res = await messagingApi.createDm({ recipient: String(m.id) })
      toast.success(
        res.type === 'dm_request'
          ? t('newMessage.requestCreated')
          : t('newMessage.dmCreated'),
      )
      close()
      navigate(`/inbox/${res.conversation_id}`)
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string }
      toast.error(e?.message ?? t('newMessage.error'))
    } finally {
      setSubmitting(false)
    }
  }

  const createGroup = async () => {
    if (selected.length < 2) return
    setSubmitting(true)
    try {
      const res = await messagingApi.createGroupDm({
        member_ids: selected.map(s => s.id),
        title: title.trim() || undefined,
      })
      toast.success(t('newMessage.groupCreated'))
      close()
      navigate(`/inbox/${res.conversation_id}`)
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string }
      toast.error(e?.message ?? t('newMessage.error'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open={open} onClose={close} title={t('newMessage.title')} size="md">
      <div className="space-y-4">
        <label className="flex items-center gap-2 cursor-pointer min-h-11">
          <Checkbox
            checked={groupMode}
            onCheckedChange={(v) => {
              const next = v === true
              setGroupMode(next)
              if (!next) setSelected([])
            }}
            aria-label={t('newMessage.groupMode')}
          />
          <Users className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-foreground">
            {t('newMessage.groupMode')}
          </span>
        </label>

        {groupMode && selected.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {selected.map(s => (
              <span
                key={s.id}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs text-foreground"
              >
                {displayName(s)}
                <button
                  type="button"
                  aria-label={t('newMessage.remove')}
                  className="hover:text-destructive"
                  onClick={() => setSelected(prev => prev.filter(p => p.id !== s.id))}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('newMessage.searchPlaceholder')}
          autoFocus
        />

        <div className="rounded-md border border-border bg-muted/30 max-h-72 overflow-y-auto">
          {query.trim().length < 2 ? (
            <p className="px-3 py-4 text-xs text-muted-foreground">
              {t('newMessage.minChars')}
            </p>
          ) : loading ? (
            <p className="px-3 py-4 text-xs text-muted-foreground">
              {t('newMessage.loading')}
            </p>
          ) : results.length === 0 ? (
            <p className="px-3 py-4 text-xs text-muted-foreground">
              {t('newMessage.noResults')}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {results.map(m => {
                const isSelected = selectedIds.has(m.id)
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => toggleSelect(m)}
                      disabled={submitting}
                      className={`w-full flex items-center gap-3 px-3 py-2 min-h-11 text-left hover:bg-muted focus:bg-muted focus:outline-none ${
                        isSelected ? 'bg-primary/10' : ''
                      }`}
                    >
                      <Avatar src={m.photo} alt={displayName(m)} size="sm" />
                      <span className="flex-1 truncate text-sm text-foreground">
                        {displayName(m)}
                      </span>
                      {groupMode && isSelected && (
                        <span className="text-xs text-primary">✓</span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {groupMode && selected.length >= 2 && (
          <div className="space-y-2">
            <Label htmlFor="group-title" className="text-xs font-medium text-foreground">
              {t('newMessage.titleLabel')}
            </Label>
            <Input
              id="group-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              placeholder={t('newMessage.titlePlaceholder')}
            />
          </div>
        )}

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2 border-t border-border">
          <Button type="button" variant="ghost" onClick={close} disabled={submitting}>
            {t('newMessage.cancel')}
          </Button>
          {groupMode && (
            <Button
              type="button"
              variant="default"
              onClick={createGroup}
              disabled={submitting || selected.length < 2}
            >
              {submitting
                ? t('newMessage.creating')
                : t('newMessage.createGroup', {
                    count: selected.length,
                  })}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}
