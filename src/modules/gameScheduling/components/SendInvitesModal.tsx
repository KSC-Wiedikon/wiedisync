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
import type { InvitePreview, SendInvitesContext, useInvites } from '../hooks/useInvites'

type InvitesApi = ReturnType<typeof useInvites>

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  ids: Array<string | number>
  ctx: SendInvitesContext
  api: InvitesApi
}

/**
 * Bulk-send invite emails for a team, with a per-recipient preview that doubles
 * as the confirmation step. Opens → fetches dry-run previews (rendered HTML +
 * subject + recipients) → admin reviews each → "Send N emails" actually sends.
 * The preview is byte-identical to what's sent (same backend render path).
 */
export default function SendInvitesModal({ open, onOpenChange, ids, ctx, api }: Props) {
  const { t } = useTranslation('gameScheduling')
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [previews, setPreviews] = useState<InvitePreview[]>([])
  const [selected, setSelected] = useState(0)
  const [error, setError] = useState<string | null>(null)
  // Which contacts to email: team responsibles (default), calendar responsibles,
  // or the full union. Drives both the preview re-fetch and the actual send.
  // Default to 'team' so an opponent team only gets ITS OWN responsibles — the
  // server falls back to the full contact list when a team has none (clubs that
  // register one big club-wide Spielplan list, e.g. Volley Uster's 25, no longer
  // blanket every team's invite). Admins can still switch to 'all'/'calendar'.
  const [group, setGroup] = useState<'all' | 'calendar' | 'team'>('team')

  useEffect(() => {
    if (!open || ids.length === 0) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setPreviews([])
    setSelected(0)
    api
      .sendInvites(ids, { dryRun: true, contactsGroup: group, ...ctx })
      .then((resp) => {
        if (cancelled) return
        setPreviews(resp.previews ?? [])
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ids.join(','), group])

  const current = previews[selected] ?? null

  const handleSend = async () => {
    setSending(true)
    try {
      const resp = await api.sendInvites(ids, { dryRun: false, contactsGroup: group, ...ctx })
      toast.success(t('invitesEmailSent', { count: resp.sent }))
      if (resp.failed.length > 0) toast.error(t('invitesEmailFailed', { count: resp.failed.length }))
      await api.refetch() // refresh badges → "Invited" now that the email went out
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] gap-3 overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('invitePreviewTitle')}</DialogTitle>
          <DialogDescription>{t('invitePreviewDesc', { count: previews.length })}</DialogDescription>
        </DialogHeader>

        {/* Recipient group — union (default) / calendar / team responsibles. */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="font-medium text-gray-600 dark:text-gray-400">{t('sendToLabel')}:</span>
          {(['all', 'calendar', 'team'] as const).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGroup(g)}
              disabled={sending}
              className={`inline-flex items-center justify-center min-h-11 sm:min-h-0 rounded-full border px-2.5 py-1 transition-colors disabled:opacity-50 ${
                group === g
                  ? 'border-brand-500 bg-brand-50 font-medium text-brand-700 dark:border-brand-400 dark:bg-brand-900/40 dark:text-brand-300'
                  : 'border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800'
              }`}
            >
              {t(g === 'all' ? 'sendGroupAll' : g === 'calendar' ? 'calendarResponsibles' : 'teamResponsibles')}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="py-10 text-center text-sm text-gray-500">{t('previewLoading')}</div>
        ) : error ? (
          <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        ) : previews.length === 0 ? (
          <div className="py-10 text-center text-sm text-gray-500">{t('noSendableInvites')}</div>
        ) : (
          <div className="flex min-h-0 flex-col gap-2">
            {/* Recipient picker — drives the preview pane */}
            <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
              {t('previewRecipientLabel')}
              <select
                value={selected}
                onChange={(e) => setSelected(Number(e.target.value))}
                className="mt-1 block w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              >
                {previews.map((p, i) => {
                  // Native <option> can't wrap — truncate the (often multi-)email
                  // list so a long recipient string doesn't overflow the dropdown.
                  // The full list is shown in the preview header below.
                  const to = p.to || ''
                  const count = to.split(',').filter((e) => e.trim()).length
                  const shortTo = to.length > 46 ? `${to.slice(0, 46).trimEnd()}…` : to
                  return (
                    <option key={p.id} value={i}>
                      {p.team_name} — {shortTo}{count > 1 ? ` (${count})` : ''}
                    </option>
                  )
                })}
              </select>
            </label>

            {current && (
              <div className="min-h-0 overflow-y-auto rounded border border-gray-200 dark:border-gray-700">
                <div className="space-y-0.5 border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs dark:border-gray-700 dark:bg-gray-800/60">
                  <div className="break-words text-gray-500 dark:text-gray-400">
                    <span className="font-medium">{t('previewToLabel')}:</span> {current.to}
                  </div>
                  <div className="text-gray-500 dark:text-gray-400">
                    <span className="font-medium">{t('previewSubjectLabel')}:</span> {current.subject}
                  </div>
                </div>
                {/* Sandboxed so the email HTML can't touch the app DOM. */}
                <iframe
                  title={t('invitePreviewTitle')}
                  srcDoc={current.html}
                  sandbox=""
                  className="h-72 w-full bg-white"
                />
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={sending}>
            {t('cancel')}
          </Button>
          <Button onClick={handleSend} disabled={sending || loading || previews.length === 0}>
            {sending ? t('sendingEmails') : t('sendNEmails', { count: previews.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
