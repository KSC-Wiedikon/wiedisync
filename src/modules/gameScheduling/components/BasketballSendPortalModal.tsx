import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog'
import { Button } from '../../../components/ui/button'
import type { BbPortalPreview, BbSendOptions, BbSendResult } from '../hooks/useBasketballClubPortals'

/**
 * Preview-then-send for the basketball opponent-club invite.
 *
 * Mirrors `SendInvitesModal`: opening the dialog fetches DRY-RUN previews from the
 * same backend render path that the real send uses, so what an operator reads here
 * is byte-identical to what leaves the server.
 *
 * ⚠ Nothing is ever sent on mount or on render. The preview fetch is `dry_run: true`
 * (it renders and returns; it mails nobody), and the only call with `dry_run: false`
 * sits behind the footer button's onClick. Per CLAUDE.md's mass-email rule the
 * dialog also nudges the operator to send to a single club first and read the
 * received mail before mailing the rest.
 */

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Portal ids to mail. Empty → every portal of the season (the backend's default). */
  ids: number[]
  send: (opts: BbSendOptions) => Promise<BbSendResult | null>
  onSent?: () => void
}

export default function BasketballSendPortalModal({ open, onOpenChange, ids, send, onSent }: Props) {
  const { t } = useTranslation('basketballScheduling')
  const [loading, setLoading] = useState(() => open)
  const [sending, setSending] = useState(false)
  const [previews, setPreviews] = useState<BbPortalPreview[]>([])
  const [selected, setSelected] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [reminder, setReminder] = useState(false)

  // Settle the reset during render on exactly the renders the effect re-runs on
  // (react-hooks/set-state-in-effect), same shape as SendInvitesModal.
  const previewKey = `${open ? '1' : '0'}|${ids.join(',')}|${reminder ? 'r' : 'n'}`
  const [prevPreviewKey, setPrevPreviewKey] = useState(previewKey)
  if (prevPreviewKey !== previewKey) {
    setPrevPreviewKey(previewKey)
    if (open) {
      setLoading(true)
      setError(null)
      setPreviews([])
      setSelected(0)
    }
  }

  useEffect(() => {
    if (!open) return
    let cancelled = false
    send({ ids, dryRun: true, reminder })
      .then((res) => {
        if (cancelled) return
        setPreviews(res?.previews ?? [])
      })
      .catch((err) => {
        if (cancelled) return
        const body = (err as { body?: { error?: string } })?.body
        setError(body?.error || (err instanceof Error ? err.message : String(err)))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ids.join(','), reminder])

  const current = previews[selected] ?? null
  const sendable = previews.filter((p) => (p.to || '').trim().length > 0)

  const handleSend = async () => {
    setSending(true)
    try {
      const res = await send({ ids, dryRun: false, reminder })
      toast.success(t('portalSent', { count: res?.sent ?? 0 }))
      if (res?.failed?.length) toast.error(t('portalSendFailed', { count: res.failed.length }))
      onSent?.()
      onOpenChange(false)
    } catch (err) {
      const body = (err as { body?: { error?: string } })?.body
      toast.error(body?.error || (err instanceof Error ? err.message : String(err)))
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] gap-3 overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('portalPreviewTitle')}</DialogTitle>
          <DialogDescription>{t('portalPreviewDesc', { count: previews.length })}</DialogDescription>
        </DialogHeader>

        <label className="flex min-h-11 items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={reminder}
            disabled={sending}
            onChange={(e) => setReminder(e.target.checked)}
          />
          {t('portalReminderVariant')}
        </label>

        {loading ? (
          <div className="py-10 text-center text-sm text-gray-500">{t('portalPreviewLoading')}</div>
        ) : error ? (
          <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        ) : previews.length === 0 ? (
          <div className="py-10 text-center text-sm text-gray-500">{t('portalNothingToSend')}</div>
        ) : (
          <div className="flex min-h-0 flex-col gap-2">
            <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
              {t('portalPreviewRecipient')}
              <select
                value={selected}
                onChange={(e) => setSelected(Number(e.target.value))}
                className="mt-1 block w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              >
                {previews.map((p, i) => {
                  const to = p.to || ''
                  const shortTo = to.length > 40 ? `${to.slice(0, 40).trimEnd()}…` : to
                  return (
                    <option key={p.id} value={i}>
                      {p.club_name || `#${p.id}`} — {shortTo || t('portalNoContact')}
                    </option>
                  )
                })}
              </select>
            </label>

            {current && (
              <div className="min-h-0 overflow-y-auto rounded border border-gray-200 dark:border-gray-700">
                <div className="space-y-0.5 border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs dark:border-gray-700 dark:bg-gray-800/60">
                  <div className="break-words text-gray-500 dark:text-gray-400">
                    <span className="font-medium">{t('portalPreviewTo')}:</span>{' '}
                    {current.to || <span className="text-amber-600 dark:text-amber-400">{t('portalNoContact')}</span>}
                  </div>
                  <div className="break-words text-gray-500 dark:text-gray-400">
                    <span className="font-medium">{t('portalPreviewSubject')}:</span> {current.subject}
                  </div>
                  <div className="text-gray-500 dark:text-gray-400">
                    <span className="font-medium">{t('portalPreviewGames')}:</span> {current.offers}
                  </div>
                </div>
                {/* Sandboxed so the email HTML can't touch the app DOM. */}
                <iframe title={t('portalPreviewTitle')} srcDoc={current.html} sandbox="" className="h-72 w-full bg-white" />
              </div>
            )}

            {sendable.length > 1 && (
              <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                {t('portalSendOneFirst')}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={sending}>
            {t('cancel')}
          </Button>
          <Button onClick={handleSend} disabled={sending || loading || sendable.length === 0}>
            {sending ? t('portalSending') : t('portalSendNow', { count: sendable.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
