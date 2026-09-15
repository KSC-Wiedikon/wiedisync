import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MoreVertical, Pencil, Trash2, Flag } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { resolveMessageActions } from '../utils/resolveMessageActions'
import type { MessageRow } from '../api/types'

type Props = {
  message: MessageRow
  currentMemberId: string | null
  isTeamModerator: boolean
  isOwn?: boolean
  onEdit?: () => void
  onDelete?: () => void
  onReport?: () => void
}

export default function MessageActions({ message, currentMemberId, isTeamModerator, isOwn, onEdit, onDelete, onReport }: Props) {
  const { t } = useTranslation('messaging')
  const [open, setOpen] = useState(false)
  const actions = resolveMessageActions(message, currentMemberId, { isTeamModerator })
  if (actions.size === 0) return null

  return (
    <div className="relative inline-block">
      <Button
        variant="ghost" size="sm"
        className="h-6 w-6 p-0 opacity-60 hover:opacity-100 focus:opacity-100"
        onClick={() => setOpen(o => !o)}
        aria-label={t('messageActions')}
      >
        <MoreVertical className="h-3.5 w-3.5" />
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className={`absolute top-6 z-50 min-w-[160px] rounded-md border border-border bg-background shadow-md text-sm ${isOwn ? 'left-0' : 'right-0'}`}>
            {actions.has('edit') && (
              <button type="button"
                className="flex w-full items-center gap-2 px-3 py-2 hover:bg-muted text-foreground"
                onClick={() => { setOpen(false); onEdit?.() }}>
                <Pencil className="h-3.5 w-3.5" />{t('edit')}
              </button>
            )}
            {actions.has('delete') && (
              <button type="button"
                className="flex w-full items-center gap-2 px-3 py-2 hover:bg-muted text-destructive"
                onClick={() => { setOpen(false); onDelete?.() }}>
                <Trash2 className="h-3.5 w-3.5" />{t('delete')}
              </button>
            )}
            {actions.has('report') && (
              <button type="button"
                className="flex w-full items-center gap-2 px-3 py-2 hover:bg-muted text-foreground"
                onClick={() => { setOpen(false); onReport?.() }}>
                <Flag className="h-3.5 w-3.5" />{t('report')}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
