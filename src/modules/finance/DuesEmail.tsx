import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Loader2, Send, ShieldCheck, ShieldAlert, Mail } from 'lucide-react'
import Modal from '../../components/Modal'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import {
  useFinanceEmailSettings, saveFinanceEmailSettings,
  previewDuesEmails, sendDuesEmails, fetchDuesEmailJob,
  type DuesRun, type FinanceEmailSettings,
} from '../../hooks/useFinance'

const labelCls = 'block text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400'
const inputCls = 'mt-1 w-full rounded-md border border-gray-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
const apiErr = (e: unknown, fallback: string) => (e as { body?: { error?: string } })?.body?.error || fallback

/** The global TEST MODE switch — default on; while on, no member is ever emailed.
 *  Wrapper fetches; the inner form is keyed by the data signature so its state
 *  seeds from props (no state-syncing effect). */
export function DuesEmailSettings() {
  const { data, refetch } = useFinanceEmailSettings()
  if (!data) return null
  return <DuesEmailForm key={`${data.test_mode}|${data.test_recipient ?? ''}`} initial={data} onSaved={refetch} />
}

function DuesEmailForm({ initial, onSaved }: { initial: FinanceEmailSettings; onSaved: () => void }) {
  const { t } = useTranslation('finance')
  const [recipient, setRecipient] = useState(initial.test_recipient || '')
  const [testMode, setTestMode] = useState(initial.test_mode)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function save(nextTestMode: boolean) {
    if (!nextTestMode && !window.confirm(t('duesEmailLiveConfirm'))) return
    setBusy(true); setMsg('')
    try {
      const r = await saveFinanceEmailSettings({ test_mode: nextTestMode, test_recipient: recipient.trim() || null })
      setTestMode(r.test_mode)
      setMsg(t('duesEmailSettingsSaved'))
      onSaved()
    } catch (e) { setMsg(apiErr(e, t('duesEmailSettingsError'))) } finally { setBusy(false) }
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-center gap-2">
        <Mail className="h-4 w-4 text-gray-400" />
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t('duesEmailTitle')}</h2>
      </div>

      {/* Status banner — green = safe (test mode), red = live */}
      {testMode ? (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800 dark:border-green-900/50 dark:bg-green-900/20 dark:text-green-300">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{t('duesEmailTestOn', { recipient: recipient || t('duesEmailNoRecipient') })}</span>
        </div>
      ) : (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs font-medium text-red-800 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{t('duesEmailLiveOn')}</span>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div className="min-w-[12rem] flex-1">
          <label className={labelCls}>{t('duesEmailRecipient')}</label>
          <input value={recipient} onChange={(e) => setRecipient(e.target.value)} type="email" placeholder="treasurer@example.ch" className={inputCls} />
        </div>
        <button type="button" disabled={busy} onClick={() => save(testMode)}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t('save')}
        </button>
        {testMode ? (
          <button type="button" disabled={busy} onClick={() => save(false)}
            className="rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900/50 dark:text-red-300 dark:hover:bg-red-900/20">
            {t('duesEmailTurnOff')}
          </button>
        ) : (
          <button type="button" disabled={busy} onClick={() => save(true)}
            className="rounded-md border border-green-300 px-3 py-2 text-sm font-medium text-green-700 hover:bg-green-50 disabled:opacity-50 dark:border-green-900/50 dark:text-green-300 dark:hover:bg-green-900/20">
            {t('duesEmailTurnOn')}
          </button>
        )}
      </div>
      {msg && <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{msg}</p>}
    </section>
  )
}

/** Per-run send: dry-run preview → send (test redirects to the test address). */
export function SendDuesEmailModal({ run, onClose }: { run: DuesRun | null; onClose: () => void }) {
  const { t } = useTranslation('finance')
  const [sending, setSending] = useState(false)
  const [started, setStarted] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [error, setError] = useState('')

  // The modal is remounted per run (key) so this state is always fresh.
  const { data: preview, isLoading: loading, isError: previewFailed } = useQuery({
    queryKey: ['finance', 'dues-email-preview', run?.id ?? 'none'],
    queryFn: () => previewDuesEmails(run!.id),
    enabled: !!run && !started,
  })

  // Poll the background send job while it runs.
  const { data: jobData } = useQuery({
    queryKey: ['finance', 'dues-email-job', run?.id ?? 'none'],
    queryFn: () => fetchDuesEmailJob(run!.id),
    enabled: !!run && started,
    refetchInterval: (q) => {
      const s = q.state.data?.job?.status
      return s === 'done' || s === 'failed' ? false : 1200
    },
  })
  const job = jobData?.job ?? null

  const liveReady = preview && (preview.test_mode || confirmText === String(preview.would_send))

  async function send() {
    if (!run || !preview) return
    setSending(true); setError('')
    try {
      await sendDuesEmails(run.id)
      setStarted(true)
    } catch (e) { setError(apiErr(e, t('duesEmailSendError'))) } finally { setSending(false) }
  }

  // ── Sending in progress / done ──
  if (started) {
    return (
      <Modal open={!!run} onClose={onClose} title={t('duesEmailSendTitle')}>
        <div className="space-y-3">
          {(!job || job.status === 'running') && (
            <div className="flex items-center gap-3 text-sm text-gray-700 dark:text-gray-300">
              <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
              {t('duesEmailSending', { sent: job?.sent ?? 0, total: job?.total ?? preview?.would_send ?? 0 })}
            </div>
          )}
          {job?.status === 'done' && (
            <p className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-900/50 dark:bg-green-900/20 dark:text-green-300">
              {job.test_mode
                ? t('duesEmailSentTest', { count: job.sent, recipient: preview?.test_recipient || '' })
                : t('duesEmailSentLive', { count: job.sent, failed: job.failed })}
            </p>
          )}
          {job?.status === 'failed' && (
            <p className="text-sm text-red-600 dark:text-red-400">{t('duesEmailSendError')}{job.error ? ` (${job.error})` : ''}</p>
          )}
          <div className="flex justify-end">
            <button type="button" onClick={onClose} className="rounded-md px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700">{t('cancel')}</button>
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal open={!!run} onClose={onClose} title={t('duesEmailSendTitle')}>
      {loading && <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>}

      {preview && (
        <div className="space-y-4">
          {preview.test_mode ? (
            <div className="flex items-start gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800 dark:border-green-900/50 dark:bg-green-900/20 dark:text-green-300">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{t('duesEmailModalTest', { recipient: preview.test_recipient || t('duesEmailNoRecipient') })}</span>
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs font-medium text-red-800 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{t('duesEmailModalLive', { count: preview.would_send })}</span>
            </div>
          )}

          <p className="text-sm text-gray-700 dark:text-gray-300">
            {t('duesEmailPreviewSummary', { send: preview.would_send, noEmail: preview.no_email })}
          </p>

          {preview.recipients.length > 0 && (
            <div className="max-h-56 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700">
              <Table>
                <TableHeader>
                  <TableRow className="border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40">
                    <TableHead className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('duesColMember')}</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('fieldEmail')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.recipients.map((r, i) => (
                    <TableRow key={i} className="border-gray-200 dark:border-gray-700">
                      <TableCell className="whitespace-normal break-words text-gray-900 dark:text-gray-100">{r.name || '–'}</TableCell>
                      <TableCell className="whitespace-normal break-words text-xs text-gray-500 dark:text-gray-400">{r.email}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Live send requires typing the count */}
          {!preview.test_mode && preview.would_send > 0 && (
            <div>
              <label className={labelCls}>{t('duesEmailTypeCount', { count: preview.would_send })}</label>
              <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} inputMode="numeric" className={inputCls} />
            </div>
          )}

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="rounded-md px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700">{t('cancel')}</button>
            <button type="button" disabled={!liveReady || sending || preview.would_send === 0} onClick={send}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {preview.test_mode ? t('duesEmailSendTestCta') : t('duesEmailSendLiveCta', { count: preview.would_send })}
            </button>
          </div>
        </div>
      )}

      {(previewFailed || (error && !preview)) && !loading && (
        <p className="text-sm text-red-600 dark:text-red-400">{previewFailed ? t('duesEmailPreviewError') : error}</p>
      )}
    </Modal>
  )
}
