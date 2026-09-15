import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { MessageSquare, MessageSquareOff, Bell, BellOff } from 'lucide-react'
import SwitchToggle from '@/components/SwitchToggle'
import { useAuth } from '../../../hooks/useAuth'
import { messagingApi } from '../api/messaging'
import type { SettingsBody } from '../api/types'
import { messagingFeatureEnabled } from '../../../utils/messagingFeatureFlag'
import ExportDataButton from '../components/ExportDataButton'

export default function MessagingSettingsPage() {
  const { t } = useTranslation('messaging')
  const { user } = useAuth()
  const [teamChat, setTeamChat] = useState<boolean>(user?.communications_team_chat_enabled === true)
  const [dm, setDm] = useState<boolean>(user?.communications_dm_enabled === true)
  const [pushPreview, setPushPreview] = useState<boolean>(user?.push_preview_content === true)
  const [busy, setBusy] = useState(false)

  if (!messagingFeatureEnabled(user?.id)) return <Navigate to="/" replace />
  if (!user) return null

  const consentStatus = user.consent_decision ?? 'pending'

  const toggle = async (key: keyof SettingsBody, next: boolean, setter: (v: boolean) => void) => {
    const prev = { team_chat_enabled: teamChat, dm_enabled: dm, push_preview_content: pushPreview }[key]
    setter(next); setBusy(true)
    const patch: SettingsBody = {}
    patch[key] = next
    try { await messagingApi.updateSettings(patch) }
    catch { setter(prev) }
    finally { setBusy(false) }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-lg font-semibold text-foreground mb-4">{t('settingsPageTitle')}</h1>

      <section className="mb-6 rounded-lg border border-border bg-background p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
          {t('settingsConsentLabel', 'Einverständnis')}
        </div>
        <div className="text-sm text-foreground">{t(`settingsConsentStatus_${consentStatus}`)}</div>
      </section>

      <section className="mb-6 space-y-3">
        <label className="flex items-center justify-between rounded-lg border border-border bg-background p-4">
          <div className="mr-3">
            <div className="text-sm font-medium text-foreground">{t('settingsTeamChatLabel')}</div>
            <div className="text-xs text-muted-foreground">{t('settingsTeamChatHint')}</div>
          </div>
          <SwitchToggle enabled={teamChat} onChange={() => toggle('team_chat_enabled', !teamChat, setTeamChat)} ariaLabel={t('settingsTeamChatLabel')} iconOff={<MessageSquareOff className="h-4 w-4" />} iconOn={<MessageSquare className="h-4 w-4" />} />
        </label>
        <label className="flex items-center justify-between rounded-lg border border-border bg-background p-4">
          <div className="mr-3">
            <div className="text-sm font-medium text-foreground">{t('settingsDmLabel')}</div>
            <div className="text-xs text-muted-foreground">{t('settingsDmHint')}</div>
          </div>
          <SwitchToggle enabled={dm} onChange={() => toggle('dm_enabled', !dm, setDm)} ariaLabel={t('settingsDmLabel')} iconOff={<MessageSquareOff className="h-4 w-4" />} iconOn={<MessageSquare className="h-4 w-4" />} />
        </label>
        <label className="flex items-center justify-between rounded-lg border border-border bg-background p-4">
          <div className="mr-3">
            <div className="text-sm font-medium text-foreground">{t('settingsPushPreviewLabel')}</div>
            <div className="text-xs text-muted-foreground">{t('settingsPushPreviewHint')}</div>
          </div>
          <SwitchToggle enabled={pushPreview} onChange={() => toggle('push_preview_content', !pushPreview, setPushPreview)} ariaLabel={t('settingsPushPreviewLabel')} iconOff={<BellOff className="h-4 w-4" />} iconOn={<Bell className="h-4 w-4" />} />
        </label>
      </section>

      <section className="mb-6 rounded-lg border border-border bg-background p-4">
        <div className="text-sm font-medium text-foreground">{t('settingsExportTitle')}</div>
        <div className="text-xs text-muted-foreground mb-3">{t('settingsExportHint')}</div>
        <ExportDataButton />
      </section>

      <section className="rounded-lg border border-border bg-muted/30 p-4 text-xs text-muted-foreground">
        {t('settingsClearInfo')}
      </section>

      {busy && <div className="mt-3 text-xs text-muted-foreground">…</div>}
    </div>
  )
}
