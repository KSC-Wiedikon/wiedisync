import { useTranslation } from 'react-i18next'
import { Share2 } from 'lucide-react'
import { toast } from 'sonner'
import { activityLink, type ShareableActivity } from '../utils/activityLinks'
import { hasNativeBridge, hasNativeFeature, nativeRequest } from '../lib/nativeBridge'
import { captureApiError } from '../lib/sentry'
import IconButton from './IconButton'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * "Copy link" for one activity — the member-facing share affordance.
 *
 * The link it produces is the app's own deep link (`/events/42`), NOT
 * `events.signup_url`. The two are different doors and must not be confused:
 * `signup_url` points at an OpnForm for people with no account, and a MEMBER who
 * signs up through it leaves no `participations` row, so the event's own count
 * and roster silently under-report (see event-signup-form.js). This button is
 * the members' door — it lands them on the activity inside Wiedisync, where the
 * normal RSVP buttons write the participation.
 */

interface ShareActivityButtonProps {
  kind: ShareableActivity
  id: string | number
  /** Used as the share-sheet title on mobile. */
  title?: string
  /** Drop the text label — for modal headers, where the row is already crowded. */
  iconOnly?: boolean
  className?: string
}

export default function ShareActivityButton({ kind, id, title, iconOnly, className }: ShareActivityButtonProps) {
  const { t } = useTranslation('common')

  async function handleShare(e: React.MouseEvent) {
    // Every one of these lives inside a clickable card or modal row.
    e.stopPropagation()
    const url = activityLink(kind, id)

    // Inside the Android app: its WebView has no navigator.share, so the bridge
    // opens the system share sheet. A failure falls through to the clipboard.
    // The sync presence check first keeps a browser's click free of any await
    // before navigator.share (Safari drops the user gesture across awaits).
    if (hasNativeBridge() && (await hasNativeFeature('share'))) {
      try {
        await nativeRequest('share', { title: title || undefined, url })
        return
      } catch (err) {
        captureApiError(err, { operation: 'ShareActivityButton.nativeShare' })
      }
    }

    // The Web Share sheet is the better mobile affordance (WhatsApp, Signal, mail
    // in one tap) but is absent on desktop Chrome/Firefox, and the user can
    // dismiss it — an AbortError is a cancel, not a failure, so it must not
    // fall through to the clipboard toast and claim it copied something.
    if (navigator.share) {
      try {
        await navigator.share({ title: title || undefined, url })
        return
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return
        // Anything else (no handler registered, permission policy) → clipboard.
      }
    }

    try {
      await navigator.clipboard.writeText(url)
      toast.success(t('copied'))
    } catch {
      // Insecure context or a denied clipboard permission. No native prompt()
      // fallback by house rule, so say so rather than failing silently.
      toast.error(t('copyFailed'))
    }
  }

  if (iconOnly) {
    return (
      <IconButton label={t('shareLink')} onClick={handleShare} className={cn('text-muted-foreground', className)}>
        <Share2 />
      </IconButton>
    )
  }
  return (
    <Button type="button" variant="outline" onClick={handleShare} title={t('shareLink')} className={className}>
      <Share2 aria-hidden />
      {t('shareLink')}
    </Button>
  )
}
