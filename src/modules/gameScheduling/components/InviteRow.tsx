import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import type { OpponentInvite, InviteSource, InviteStatus } from '../../../types'
import { buildInviteMailto } from './inviteEmailTemplate'

interface Props {
  invite: OpponentInvite
  kscwTeam: { name: string; league: string }
  season: { name: string }
  frontendUrl: string
  onReissue: (id: string | number) => Promise<{ token: string } | unknown>
  onRevoke: (id: string | number) => Promise<unknown>
}

const STATUS_VARIANT: Record<InviteStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  invited: 'secondary',
  viewed: 'outline',
  booked: 'default',
  revoked: 'destructive',
  expired: 'destructive',
  active: 'outline',
}

function statusKey(status: InviteStatus): string {
  return `status${status.charAt(0).toUpperCase()}${status.slice(1)}`
}

function sourceKey(source: InviteSource): string {
  if (source === 'self_registration') return 'sourceSelfRegistration'
  if (source === 'svrz') return 'sourceSvrz'
  return 'sourceManual'
}

export default function InviteRow({ invite, kscwTeam, season, frontendUrl, onReissue, onRevoke }: Props) {
  const { t } = useTranslation('gameScheduling')
  const [busy, setBusy] = useState(false)
  const link = `${frontendUrl}/terminplanung/${invite.token}`

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      toast.success(t('linkCopied'))
    } catch {
      toast.error('Copy failed')
    }
  }

  const handleDraft = () => {
    const mailto = buildInviteMailto({
      invite: {
        token: invite.token,
        team_name: invite.team_name,
        contact_name: invite.contact_name,
        contact_email: invite.contact_email,
        expires_at: invite.expires_at,
      },
      kscwTeam,
      season,
      frontendUrl,
    })
    window.location.href = mailto
  }

  const handleReissue = async () => {
    setBusy(true)
    try {
      await onReissue(invite.id)
      toast.success(t('inviteReissued'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const handleRevoke = async () => {
    if (!window.confirm(t('confirmRevoke'))) return
    setBusy(true)
    try {
      await onRevoke(invite.id)
      toast.success(t('inviteRevoked'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const createdDate = invite.date_created ? new Date(invite.date_created).toLocaleDateString('de-CH') : ''

  return (
    <tr className="border-b border-gray-200 text-sm dark:border-gray-800">
      <td className="py-2 pr-3">
        <div className="font-medium text-gray-900 dark:text-gray-100">{invite.team_name}</div>
        {invite.contact_name && (
          <div className="text-xs text-gray-500 dark:text-gray-400">{invite.contact_name}</div>
        )}
      </td>
      <td className="py-2 pr-3 text-gray-700 dark:text-gray-300">
        <a href={`mailto:${invite.contact_email.replace(/\s+/g, '')}`} className="hover:underline">
          {invite.contact_email}
        </a>
      </td>
      <td className="py-2 pr-3">
        <Badge variant={STATUS_VARIANT[invite.status] ?? 'outline'}>{t(statusKey(invite.status))}</Badge>
      </td>
      <td className="py-2 pr-3 text-xs text-gray-500 dark:text-gray-400">{t(sourceKey(invite.source))}</td>
      <td className="py-2 pr-3 text-xs text-gray-500 dark:text-gray-400">{createdDate}</td>
      <td className="py-2">
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant="outline" onClick={handleCopy} disabled={busy}>
            {t('copyLink')}
          </Button>
          <Button size="sm" variant="outline" onClick={handleDraft} disabled={busy}>
            {t('draftEmail')}
          </Button>
          <Button size="sm" variant="ghost" onClick={handleReissue} disabled={busy || invite.status === 'revoked'}>
            {t('reissueInvite')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleRevoke}
            disabled={busy || invite.status === 'revoked'}
            className="text-red-600 hover:text-red-700 dark:text-red-400"
          >
            {t('revokeInvite')}
          </Button>
        </div>
      </td>
    </tr>
  )
}
