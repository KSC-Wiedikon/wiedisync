import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useBlocks } from '../hooks/useBlocks'
import { Ban } from 'lucide-react'

type Props = {
  memberId: string
  memberName: string
  onBlocked?: () => void
  variant?: 'default' | 'outline' | 'ghost' | 'destructive'
  size?: 'sm' | 'default'
}

export default function BlockMemberDialog({ memberId, memberName, onBlocked, variant = 'outline', size = 'sm' }: Props) {
  const { t } = useTranslation('messaging')
  const { block } = useBlocks()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const confirm = useCallback(async () => {
    setBusy(true)
    try { await block(memberId); setOpen(false); onBlocked?.() }
    finally { setBusy(false) }
  }, [block, memberId, onBlocked])

  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)} aria-label={t('block')}>
        <Ban className="h-4 w-4 md:mr-1" />
        <span className="hidden md:inline">{t('block')}</span>
      </Button>
      {open && (
        <div
          role="dialog" aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !busy && setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-lg border border-border bg-background p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-foreground">{t('blockDialogTitle', { name: memberName })}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{t('blockDialogBody')}</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
                {t('common:cancel')}
              </Button>
              <Button variant="destructive" onClick={confirm} disabled={busy}>
                {busy ? t('common:loading') : t('blockConfirm')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
