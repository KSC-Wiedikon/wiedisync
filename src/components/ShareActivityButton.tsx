import { useTranslation } from 'react-i18next'
import { Share2 } from 'lucide-react'
import { toast } from 'sonner'
import { activityLink, type ShareableActivity } from '../utils/activityLinks'

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

    // The native sheet is the better mobile affordance (WhatsApp, Signal, mail
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

  return (
    <button
      type="button"
      onClick={handleShare}
      title={t('shareLink')}
      aria-label={t('shareLink')}
      className={
        className
        ?? (iconOnly
          // Square 44px so the header row keeps a touch target on mobile even
          // without the label to pad it out.
          ? 'flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground'
          : 'flex min-h-[44px] items-center gap-1.5 rounded-md border border-border px-3 text-sm hover:bg-accent')
      }
    >
      <Share2 className="h-4 w-4" />
      {!iconOnly && <span>{t('shareLink')}</span>}
    </button>
  )
}
