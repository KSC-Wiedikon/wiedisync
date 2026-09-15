import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Check, X } from 'lucide-react'
import type { MessageRequestRow } from '../api/types'
import BlockMemberDialog from './BlockMemberDialog'

type Props = {
  request: MessageRequestRow
  senderName: string
  onAccept: (requestId: string) => Promise<void>
  onDecline: (requestId: string) => Promise<void>
}

export default function RequestCard({ request, senderName, onAccept, onDecline }: Props) {
  const { t } = useTranslation('messaging')
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null)

  const accept = async () => {
    setBusy('accept')
    try { await onAccept(request.id) } finally { setBusy(null) }
  }
  const decline = async () => {
    setBusy('decline')
    try { await onDecline(request.id) } finally { setBusy(null) }
  }

  return (
    <div className="border-b border-border bg-muted/50 p-3">
      <div className="text-xs text-muted-foreground">{t('requestFrom', { name: senderName })}</div>
      <div className="text-sm font-medium text-foreground mt-0.5">{t('requestPendingBody')}</div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" onClick={accept} disabled={busy !== null} aria-label={t('accept')}>
          <Check className="h-4 w-4 md:mr-1" />
          <span className="hidden md:inline">{t('accept')}</span>
        </Button>
        <Button size="sm" variant="outline" onClick={decline} disabled={busy !== null} aria-label={t('decline')}>
          <X className="h-4 w-4 md:mr-1" />
          <span className="hidden md:inline">{t('decline')}</span>
        </Button>
        <BlockMemberDialog memberId={request.sender} memberName={senderName} />
      </div>
    </div>
  )
}
