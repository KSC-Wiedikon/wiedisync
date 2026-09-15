import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { MoreHorizontal, UserPlus, LogOut } from 'lucide-react'
import Modal from '@/components/Modal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { messagingApi, type SearchableMember } from '../api/messaging'
import { useMemberSearch } from '../hooks/useMemberSearch'
import { memberDisplayName } from '../../../utils/relations'
import Avatar from './Avatar'

interface GroupDmMenuProps {
  conversationId: string
  onMemberAdded?: () => void
  currentMemberIds: Array<number | string>
}

function fullName(m: SearchableMember): string {
  // On-screen UI: prefer the member's nickname over first_name (falls back).
  return memberDisplayName(m) || '—'
}

export default function GroupDmMenu({ conversationId, onMemberAdded, currentMemberIds }: GroupDmMenuProps) {
  const { t } = useTranslation('messaging')
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [leaving, setLeaving] = useState(false)

  const { results, loading } = useMemberSearch(query, { enabled: addOpen })
  const currentIdSet = new Set(currentMemberIds.map(String))
  const filteredResults = results.filter(m => !currentIdSet.has(String(m.id)))

  const handleAdd = async (m: SearchableMember) => {
    setAdding(true)
    try {
      await messagingApi.addGroupMember(conversationId, m.id)
      toast.success(t('group.memberAdded', { name: fullName(m) }))
      setQuery('')
      setAddOpen(false)
      onMemberAdded?.()
    } catch (err: unknown) {
      const e = err as { message?: string }
      toast.error(e?.message ?? t('group.addError'))
    } finally {
      setAdding(false)
    }
  }

  const handleLeave = async () => {
    setLeaving(true)
    try {
      await messagingApi.leaveGroup(conversationId)
      toast.success(t('group.leftSuccess'))
      navigate('/inbox')
    } catch (err: unknown) {
      const e = err as { message?: string }
      toast.error(e?.message ?? t('group.leaveError'))
    } finally {
      setLeaving(false)
      setLeaveConfirmOpen(false)
    }
  }

  return (
    <>
      <div className="relative">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setOpen(!open)}
          aria-label={t('group.menuLabel')}
          className="min-h-11"
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <div className="absolute right-0 top-full mt-1 z-20 min-w-[200px] rounded-md border border-border bg-popover text-popover-foreground shadow-md py-1">
              <button
                type="button"
                className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-muted"
                onClick={() => { setOpen(false); setAddOpen(true) }}
              >
                <UserPlus className="h-4 w-4" />
                {t('group.addMember')}
              </button>
              <button
                type="button"
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-destructive hover:bg-muted"
                onClick={() => { setOpen(false); setLeaveConfirmOpen(true) }}
              >
                <LogOut className="h-4 w-4" />
                {t('group.leave')}
              </button>
            </div>
          </>
        )}
      </div>

      <Modal
        open={addOpen}
        onClose={() => { if (!adding) setAddOpen(false) }}
        title={t('group.addMember')}
        size="md"
      >
        <div className="space-y-4">
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
            ) : filteredResults.length === 0 ? (
              <p className="px-3 py-4 text-xs text-muted-foreground">
                {t('newMessage.noResults')}
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {filteredResults.map(m => (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => handleAdd(m)}
                      disabled={adding}
                      className="w-full flex items-center gap-3 px-3 py-2 min-h-11 text-left hover:bg-muted focus:bg-muted focus:outline-none"
                    >
                      <Avatar src={m.photo} alt={fullName(m)} size="sm" />
                      <span className="flex-1 truncate text-sm text-foreground">{fullName(m)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Modal>

      <AlertDialog open={leaveConfirmOpen} onOpenChange={setLeaveConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('group.leaveTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('group.leaveBody')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={leaving}>
              {t('newMessage.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleLeave} disabled={leaving}>
              {leaving ? t('group.leaving') : t('group.leave')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
