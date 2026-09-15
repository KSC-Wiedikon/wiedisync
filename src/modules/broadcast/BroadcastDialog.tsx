import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
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
import Modal from '@/components/Modal'
import { messagingFeatureEnabled } from '@/utils/messagingFeatureFlag'
import { useBroadcast } from './useBroadcast'
import { useBroadcastPreview } from './useBroadcastPreview'
import type {
  BroadcastActivity,
  BroadcastAudience,
  BroadcastChannels,
  BroadcastError,
  BroadcastPayload,
  ParticipationStatus,
} from './types'

export interface BroadcastDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  activity: BroadcastActivity & { teamId?: number | string }
  /** Sender's member id — used to gate the inApp checkbox behind the messaging
   *  allowlist. Leave undefined to suppress inApp entirely. */
  senderMemberId?: number | string | null
}

// Must match the backend VALID_AUDIENCE_STATUSES in broadcast-helpers.js.
// The first four are real participations.status values; `unanswered` is the
// roster MINUS anyone who has already responded (resolved server-side).
const ALL_STATUSES: ParticipationStatus[] = [
  'confirmed',
  'tentative',
  'declined',
  'waitlisted',
  'unanswered',
]
const DEFAULT_STATUSES: ParticipationStatus[] = ['confirmed', 'tentative']

const SUBJECT_MIN = 3
const SUBJECT_MAX = 200
const MESSAGE_MAX = 2000

function formatLocaleNumber(n: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale).format(n)
  } catch {
    return String(n)
  }
}

export default function BroadcastDialog({
  open,
  onOpenChange,
  activity,
  senderMemberId,
}: BroadcastDialogProps) {
  const { t, i18n } = useTranslation('broadcast')
  const locale = i18n.language || 'de'
  const navigate = useNavigate()
  const { send, sending } = useBroadcast()

  // In-App is event-only (Plan 02 scope) AND gated behind the messaging flag
  // (allowlist or global VITE_FEATURE_MESSAGING=true).
  const inAppSupported = activity.type === 'event' && messagingFeatureEnabled(senderMemberId ?? null)

  // Channels — Email default ON, Push default OFF, In-App default OFF.
  const [emailOn, setEmailOn] = useState(true)
  const [pushOn, setPushOn] = useState(false)
  const [inAppOn, setInAppOn] = useState(false)

  // Audience
  const [statuses, setStatuses] = useState<ParticipationStatus[]>(DEFAULT_STATUSES)
  const [includeExternals, setIncludeExternals] = useState(false)

  // Subject + body
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')

  // Confirm dialog
  const [confirmOpen, setConfirmOpen] = useState(false)

  // Build channels object (only channels that are ON)
  const channels: BroadcastChannels = useMemo(() => {
    const out: BroadcastChannels = {}
    if (emailOn) out.email = true
    if (pushOn) out.push = true
    if (inAppOn) out.inApp = true
    return out
  }, [emailOn, pushOn, inAppOn])

  // Audience for preview / send
  const audience: BroadcastAudience = useMemo(
    () => ({
      statuses,
      ...(activity.type === 'event' ? { includeExternals } : {}),
    }),
    [statuses, includeExternals, activity.type],
  )

  // Live preview (debounced 300ms — re-fetches on activity/audience change)
  const previewActivityRef = open ? { type: activity.type, id: activity.id } : null
  const previewAudienceRef = open ? audience : null
  const { preview, loading: previewLoading, error: previewError } = useBroadcastPreview(
    previewActivityRef,
    previewAudienceRef,
    { debounceMs: 300 },
  )

  // Validation
  const noChannel = !emailOn && !pushOn && !inAppOn
  const messageTooLong = message.length > MESSAGE_MAX
  const messageEmpty = message.trim().length === 0
  const subjectRequired = emailOn
  const subjectTrimmed = subject.trim()
  const subjectInvalid =
    subjectRequired && (subjectTrimmed.length < SUBJECT_MIN || subjectTrimmed.length > SUBJECT_MAX)

  const sendDisabled = sending || noChannel || messageEmpty || messageTooLong || subjectInvalid

  const recipientCount = preview?.recipientCount ?? 0
  const memberCount = preview?.breakdown.members ?? 0
  const externalCount = preview?.breakdown.externals ?? 0
  const sampleNames = useMemo(
    () => (preview?.sample ?? []).slice(0, 3).map((s) => s.name).join(', '),
    [preview],
  )

  // Toggle a status checkbox
  const toggleStatus = (status: ParticipationStatus) => {
    setStatuses((prev) =>
      prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status],
    )
  }

  const close = () => {
    if (sending) return
    onOpenChange(false)
  }

  const handleSendClick = () => {
    if (sendDisabled) return
    setConfirmOpen(true)
  }

  const handleConfirmSend = async () => {
    setConfirmOpen(false)
    const payload: BroadcastPayload = {
      channels,
      audience,
      message: message.trim(),
      ...(emailOn ? { subject: subjectTrimmed } : {}),
    }
    try {
      const res = await send({ type: activity.type, id: activity.id }, payload)
      const convId = res.delivery?.in_app?.conversation_id ?? null
      if (convId) {
        toast.success(t('toast.sent', { count: res.recipientCount }), {
          action: {
            label: t('toast.openConversation'),
            onClick: () => navigate(`/inbox/${convId}`),
          },
        })
      } else {
        toast.success(t('toast.sent', { count: res.recipientCount }))
      }
      // Reset state for next open
      setSubject('')
      setMessage('')
      setInAppOn(false)
      onOpenChange(false)
    } catch (err: unknown) {
      // useBroadcast surfaces a structured error, but the thrown raw error is what arrives here.
      const e = err as Partial<BroadcastError> & { code?: string; message?: string }
      const code = e?.code ?? 'unknown'
      if (code === 'broadcast/rate_limited') {
        const sec = typeof e?.retryAfterSec === 'number' ? e.retryAfterSec : null
        if (sec && sec > 0) {
          toast.error(t('toast.rateLimitedTimed', { minutes: Math.max(1, Math.ceil(sec / 60)) }))
        } else {
          toast.error(t('toast.rateLimited'))
        }
      } else if (code === 'broadcast/invalid_payload') {
        if (e?.field) {
          toast.error(t('toast.invalidField', { field: e.field }))
        } else {
          toast.error(e?.message ?? t('toast.error'))
        }
      } else if (code === 'broadcast/not_implemented' || code === 'not_implemented') {
        toast.error(t('toast.notImplemented'))
      } else {
        toast.error(e?.message ?? t('toast.error'))
      }
    }
  }

  return (
    <>
      <Modal open={open} onClose={close} title={t('dialog.title')} size="md">
        <div className="space-y-5">
          {/* Activity title subtitle */}
          <p className="text-sm text-muted-foreground -mt-1">{activity.title}</p>

          {/* 1. Channels */}
          <section>
            <Label className="text-xs font-medium text-foreground">{t('channels.label')}</Label>
            <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-3">
              <label className="flex items-center gap-2 cursor-pointer min-h-11">
                <Checkbox
                  checked={emailOn}
                  onCheckedChange={(v) => setEmailOn(v === true)}
                  aria-label={t('channels.email')}
                />
                <span className="text-sm text-foreground">{t('channels.email')}</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer min-h-11">
                <Checkbox
                  checked={pushOn}
                  onCheckedChange={(v) => setPushOn(v === true)}
                  aria-label={t('channels.push')}
                />
                <span className="text-sm text-foreground">{t('channels.push')}</span>
              </label>
              {/* In-App: event-only (Plan 02). Games/trainings: hide entirely.
                  Events + flag off: show disabled "Bald verfügbar".
                  Events + flag on: enabled. */}
              {activity.type === 'event' && (
                inAppSupported ? (
                  <label className="flex items-center gap-2 cursor-pointer min-h-11">
                    <Checkbox
                      checked={inAppOn}
                      onCheckedChange={(v) => setInAppOn(v === true)}
                      aria-label={t('channels.inApp')}
                    />
                    <span className="text-sm text-foreground">{t('channels.inApp')}</span>
                  </label>
                ) : (
                  <label
                    className="flex items-center gap-2 cursor-not-allowed opacity-60 min-h-11"
                    title={t('channels.inAppComingSoon')}
                  >
                    <Checkbox checked={false} disabled aria-label={t('channels.inApp')} />
                    <span className="text-sm text-muted-foreground">
                      {t('channels.inApp')}{' '}
                      <span className="text-xs">({t('channels.inAppComingSoon')})</span>
                    </span>
                  </label>
                )
              )}
            </div>
            {noChannel && (
              <p className="mt-1 text-xs text-destructive">{t('channels.error_atLeastOne')}</p>
            )}
          </section>

          {/* 2. Audience */}
          <section>
            <Label className="text-xs font-medium text-foreground">{t('audience.label')}</Label>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
              {ALL_STATUSES.map((status) => {
                const checked = statuses.includes(status)
                return (
                  <label
                    key={status}
                    className="flex items-center gap-2 cursor-pointer min-h-11"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggleStatus(status)}
                      aria-label={t(`audience.${status}`)}
                    />
                    <span className="text-sm text-foreground">{t(`audience.${status}`)}</span>
                  </label>
                )
              })}
            </div>
            {activity.type === 'event' && (
              <label className="mt-3 flex items-center gap-2 cursor-pointer min-h-11">
                <Checkbox
                  checked={includeExternals}
                  onCheckedChange={(v) => setIncludeExternals(v === true)}
                  aria-label={t('audience.includeExternals')}
                />
                <span className="text-sm text-foreground">{t('audience.includeExternals')}</span>
              </label>
            )}
          </section>

          {/* 3. Live preview */}
          <section
            className={
              recipientCount === 0 && !previewLoading && !previewError
                ? 'rounded-md border border-yellow-300 bg-yellow-50 px-3 py-2 dark:border-yellow-700 dark:bg-yellow-950/40'
                : 'rounded-md border border-border bg-muted/40 px-3 py-2'
            }
            aria-live="polite"
          >
            {previewLoading && (
              <p className="text-xs text-muted-foreground">{t('preview.loading')}</p>
            )}
            {!previewLoading && previewError && (
              <p className="text-xs text-destructive">{t('preview.error')}</p>
            )}
            {!previewLoading && !previewError && preview && recipientCount === 0 && (
              <p className="text-xs text-yellow-900 dark:text-yellow-200">{t('preview.empty')}</p>
            )}
            {!previewLoading && !previewError && preview && recipientCount > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-foreground">
                  {t('preview.recipients', {
                    total: formatLocaleNumber(recipientCount, locale),
                    members: formatLocaleNumber(memberCount, locale),
                    externals: formatLocaleNumber(externalCount, locale),
                  })}
                </p>
                {sampleNames && (
                  <p className="text-xs text-muted-foreground truncate">
                    {t('preview.sample', { names: sampleNames + (preview.sample.length > 3 ? ', …' : '') })}
                  </p>
                )}
              </div>
            )}
          </section>

          {/* 4. Subject (only when email channel ON) */}
          {emailOn && (
            <section>
              <Label htmlFor="broadcast-subject" className="text-xs font-medium text-foreground">
                {t('subject.label')}
              </Label>
              <Input
                id="broadcast-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder={t('subject.placeholder')}
                maxLength={SUBJECT_MAX}
                className="mt-1"
                aria-invalid={subjectInvalid || undefined}
              />
            </section>
          )}

          {/* 5. Message */}
          <section>
            <Label htmlFor="broadcast-message" className="text-xs font-medium text-foreground">
              {t('message.label')}
            </Label>
            <Textarea
              id="broadcast-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t('message.placeholder')}
              rows={6}
              maxLength={MESSAGE_MAX}
              className="mt-1"
              aria-invalid={messageEmpty || messageTooLong || undefined}
            />
            <p
              className={`mt-1 text-xs ${
                messageTooLong ? 'text-destructive' : 'text-muted-foreground'
              }`}
            >
              {t('message.counter', { used: message.length, max: MESSAGE_MAX })}
            </p>
          </section>

          {/* Footer */}
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2 border-t border-border">
            <Button type="button" variant="ghost" onClick={close} disabled={sending}>
              {t('dialog.cancel')}
            </Button>
            <Button
              type="button"
              variant="default"
              onClick={handleSendClick}
              disabled={sendDisabled}
            >
              {sending ? t('dialog.sending') : t('dialog.send')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Confirmation AlertDialog */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('dialog.confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('dialog.confirm', { count: recipientCount })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('dialog.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmSend}>
              {t('dialog.confirmCta')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
