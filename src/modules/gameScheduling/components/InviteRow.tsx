import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useConfirm } from '../../../components/ConfirmProvider'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import type { OpponentInvite, InviteSource, InviteStatus } from '../../../types'
import { buildInviteMailto } from './inviteEmailTemplate'
import { buildMailtoHref } from '../../../utils/sanitizeUrl'

interface Props {
  invite: OpponentInvite
  kscwTeam: { name: string; league: string }
  season: { name: string }
  frontendUrl: string
  onReissue: (id: string | number) => Promise<{ token: string } | unknown>
  onRevoke: (id: string | number) => Promise<unknown>
  /** Flag the invite as sent after the admin opens the "Draft email" mailto. */
  onSent?: (id: string | number) => Promise<unknown>
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

export default function InviteRow({ invite, kscwTeam, season, frontendUrl, onReissue, onRevoke, onSent }: Props) {
  const { t } = useTranslation('gameScheduling')
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const link = `${frontendUrl}/terminplanung/${invite.token}`

  // Auto-created invites sit at status 'invited' before any email goes out — show
  // them as "Not sent" until the invite is actually emailed (email_sent_at set).
  const notSent = invite.status === 'invited' && !invite.email_sent_at
  const displayStatusKey = notSent ? 'statusNotSent' : statusKey(invite.status)
  const displayVariant = notSent ? 'outline' : STATUS_VARIANT[invite.status] ?? 'outline'

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      toast.success(t('linkCopied'))
    } catch {
      toast.error(t('linkCopyFailed'))
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
    // Opening the mail client counts as sending the invite (the app can't see the
    // actual send) — flip the badge to "Invited". Fire-and-forget; the mailto
    // opens regardless.
    if (notSent && onSent) void onSent(invite.id)
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
    if (!(await confirm({ message: t('confirmRevoke'), danger: true }))) return
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
    <div className="rounded-md border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800/60">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-gray-900 dark:text-gray-100">{invite.team_name}</span>
            <Badge variant={displayVariant}>{t(displayStatusKey)}</Badge>
            <span className="text-xs text-gray-500 dark:text-gray-400">{t(sourceKey(invite.source))}</span>
          </div>
          {invite.contact_name && (
            <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{invite.contact_name}</div>
          )}
          <a
            href={buildMailtoHref(invite.contact_email)}
            className="mt-0.5 block break-all text-sm text-gray-700 hover:underline dark:text-gray-300"
          >
            {invite.contact_email}
          </a>
        </div>
        {createdDate && (
          <span className="whitespace-nowrap text-xs text-gray-400 dark:text-gray-500">{createdDate}</span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-1">
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
    </div>
  )
}
