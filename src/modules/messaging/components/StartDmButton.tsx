import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { MessageSquarePlus } from 'lucide-react'
import { messagingApi } from '../api/messaging'
import { messagingFeatureEnabled } from '../../../utils/messagingFeatureFlag'
import { useAuth } from '../../../hooks/useAuth'

type Props = {
  recipientId: string
  label?: string
  variant?: 'default' | 'outline' | 'ghost' | 'secondary'
  size?: 'sm' | 'default' | 'lg'
}

export default function StartDmButton({ recipientId, label, variant = 'default', size = 'sm' }: Props) {
  const { t } = useTranslation('messaging')
  const { user } = useAuth()
  const nav = useNavigate()
  const [loading, setLoading] = useState(false)

  // Hoisted above the early returns below so hook call order stays unconditional.
  const onClick = useCallback(async () => {
    setLoading(true)
    try {
      const res = await messagingApi.createDm({ recipient: String(recipientId) })
      nav(`/inbox/${res.conversation_id}`)
    } catch (e: unknown) {
      // kscwApi attaches response body as e.body on throws; also try e directly.
      const err = e as { body?: { code?: string; conversation_id?: string }; code?: string; conversation_id?: string }
      const body = err?.body ?? err
      if (body?.conversation_id) {
        nav(`/inbox/${body.conversation_id}`)
        return
      }
      if (body?.code === 'messaging/blocked')            toast.error(t('errors.blocked'))
      else if (body?.code === 'messaging/comms_disabled') toast.error(t('errors.recipientOptedOut'))
      else if (body?.code === 'messaging/request_cooldown') toast.error(t('errors.cooldown'))
      else                                                toast.error(t('errors.generic'))
    } finally { setLoading(false) }
  }, [recipientId, nav, t])

  if (!messagingFeatureEnabled(user?.id) || !user?.id || String(recipientId) === String(user.id)) return null
  if (user.communications_dm_enabled !== true) return null

  return (
    <Button onClick={onClick} disabled={loading} variant={variant} size={size} aria-label={t('startDm')}>
      <MessageSquarePlus className="h-4 w-4 md:mr-1" />
      <span className="hidden md:inline">{label ?? t('startDm')}</span>
    </Button>
  )
}
