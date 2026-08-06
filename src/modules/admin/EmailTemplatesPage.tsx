import { useState, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Mail, Send, Eye, RotateCcw, Save, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { useCollection, useUpdate } from '../../lib/query'
import { kscwApi } from '../../lib/api'
import { useReportPageLoading } from '../../hooks/usePageReady'
import { useConfirm } from '../../components/ConfirmProvider'
import { formatDateTimeCompact } from '../../utils/dateHelpers'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'

// ── Types ────────────────────────────────────────────────────────

interface EmailTemplate {
  id: string
  template_key: string
  locale: string
  subject: string | null
  title: string | null
  greeting: string | null
  body_html: string | null
  cta_label: string | null
  footer: string | null
  updated_by_name: string | null
  date_updated: string | null
}

interface EmailSend {
  id: string
  template_key: string | null
  locale: string | null
  to_email: string | null
  subject: string | null
  body_html: string | null
  collection_name: string | null
  record_id: string | null
  sent_by_name: string | null
  sent_at: string | null
}

// Mirrors TEMPLATE_FIELDS in kscw-endpoints/src/email-templates.js. The order is
// the order the boxes appear in.
const FIELDS = ['subject', 'title', 'greeting', 'body_html', 'cta_label', 'footer'] as const
type Field = (typeof FIELDS)[number]

const LOCALES = ['de', 'gsw', 'en', 'fr', 'it'] as const
type Locale = (typeof LOCALES)[number]

// Mirrors TEMPLATE_KEYS[key].vars server-side. Shown as clickable chips so the
// editor never has to remember the spelling — a typo is rejected on save, but
// not having to make it in the first place is better.
const PLACEHOLDERS = ['name', 'documents', 'reference', 'email', 'link'] as const

export default function EmailTemplatesPage() {
  const { t } = useTranslation('admin')
  const confirm = useConfirm()
  const [locale, setLocale] = useState<Locale>('de')
  const [draft, setDraft] = useState<Partial<Record<Field, string>>>({})
  const [preview, setPreview] = useState<{ html: string; subject: string } | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [tab, setTab] = useState<'edit' | 'sent'>('edit')

  const { data: templatesRaw, isLoading } = useCollection<EmailTemplate>('email_templates', {
    filter: { template_key: { _eq: 'registration_docs_request' } },
    all: true,
  })
  const templates = useMemo(() => templatesRaw ?? [], [templatesRaw])

  const { data: sendsRaw, isLoading: sendsLoading } = useCollection<EmailSend>('email_sends', {
    sort: ['-sent_at'],
    limit: 100,
    enabled: tab === 'sent',
  })
  const sends = sendsRaw ?? []

  useReportPageLoading(isLoading)

  const current = useMemo(
    () => templates.find((tpl) => tpl.locale === locale) ?? null,
    [templates, locale],
  )

  // Switching locale abandons the draft for the previous one. Deliberate: a draft
  // belongs to a locale, and silently carrying German text into the French box
  // would be worse than losing it. Done in the handler rather than an effect —
  // resetting state from an effect renders once with the stale draft first.
  const switchLocale = (l: Locale) => {
    setLocale(l)
    setDraft({})
    setPreview(null)
  }

  const value = useCallback(
    (f: Field): string => draft[f] ?? current?.[f] ?? '',
    [draft, current],
  )
  const dirty = FIELDS.some((f) => draft[f] !== undefined && draft[f] !== (current?.[f] ?? ''))

  const { mutate: updateTemplate, isPending: saving } = useUpdate<EmailTemplate>('email_templates', {
    onSuccess: () => { setDraft({}); toast.success(t('etSaved')) },
    onError: (err) => {
      // The write hook returns its complaints as the message — surface them
      // verbatim, they name the exact field and placeholder.
      toast.error((err as Error).message || t('etSaveError'))
    },
  })

  const handleSave = () => {
    if (!current || !dirty) return
    const patch: Record<string, unknown> = {}
    for (const f of FIELDS) if (draft[f] !== undefined) patch[f] = draft[f]
    updateTemplate({ id: current.id, data: patch })
  }

  // Render through the real backend builder, including unsaved edits, so what is
  // on screen is what would actually be sent.
  const handlePreview = async () => {
    setPreviewing(true)
    try {
      const overrides: Record<string, string> = {}
      for (const f of FIELDS) overrides[f] = value(f)
      const res = await kscwApi<{ html: string; subject: string }>(
        '/registration/docs-request-preview',
        { method: 'POST', body: { locale, overrides } },
      )
      setPreview({ html: res.html, subject: res.subject })
    } catch (err) {
      toast.error((err as Error).message || t('etPreviewError'))
    } finally {
      setPreviewing(false)
    }
  }

  // Clearing a box restores the compiled-in default at send time (the backend
  // merges per field), so "reset" is simply blanking everything.
  const handleReset = async () => {
    if (!current) return
    if (!(await confirm({ message: t('etResetConfirm'), danger: true }))) return
    const patch: Record<string, unknown> = {}
    for (const f of FIELDS) patch[f] = null
    updateTemplate({ id: current.id, data: patch })
  }

  const insertPlaceholder = (p: string) => {
    const el = document.getElementById('et-body') as HTMLTextAreaElement | null
    const body = value('body_html')
    if (!el) { setDraft((d) => ({ ...d, body_html: `${body}{{${p}}}` })); return }
    const start = el.selectionStart ?? body.length
    const end = el.selectionEnd ?? body.length
    setDraft((d) => ({ ...d, body_html: `${body.slice(0, start)}{{${p}}}${body.slice(end)}` }))
  }

  const label = (f: Field) => t(`etField_${f}`)
  const hint = (f: Field) => t(`etHint_${f}`)

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6">
      <div className="flex flex-wrap items-center gap-3">
        <Mail className="h-6 w-6 text-primary" />
        <div className="flex-1">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{t('etTitle')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('etSubtitle')}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
        {(['edit', 'sent'] as const).map((tb) => (
          <button
            key={tb}
            onClick={() => setTab(tb)}
            className={`min-h-[44px] px-4 text-sm font-medium transition-colors ${
              tab === tb
                ? 'border-b-2 border-primary text-primary'
                : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            {tb === 'edit' ? t('etTabEdit') : t('etTabSent')}
          </button>
        ))}
      </div>

      {tab === 'edit' ? (
        <>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            <AlertTriangle className="mr-1.5 inline h-4 w-4 align-text-bottom" />
            {t('etFallbackNote')}
          </div>

          {/* Locale picker */}
          <div className="flex flex-wrap gap-1.5">
            {LOCALES.map((l) => (
              <button
                key={l}
                onClick={() => switchLocale(l)}
                className={`min-h-[44px] rounded-md px-3 text-sm font-medium uppercase transition-colors sm:min-h-0 sm:py-1.5 ${
                  locale === l
                    ? 'bg-primary text-primary-foreground'
                    : 'border border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800'
                }`}
              >
                {l}
              </button>
            ))}
          </div>

          {isLoading ? (
            <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">…</p>
          ) : !current ? (
            <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">{t('etNoTemplate')}</p>
          ) : (
            <div className="space-y-4">
              {FIELDS.map((f) => (
                <div key={f} className="space-y-1">
                  <label htmlFor={f === 'body_html' ? 'et-body' : `et-${f}`} className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    {label(f)}
                  </label>
                  {f === 'body_html' ? (
                    <>
                      <div className="flex flex-wrap gap-1.5 pb-1">
                        {PLACEHOLDERS.map((p) => (
                          <button
                            key={p}
                            type="button"
                            onClick={() => insertPlaceholder(p)}
                            className="rounded border border-gray-200 bg-gray-50 px-2 py-1 font-mono text-xs text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                          >
                            {`{{${p}}}`}
                          </button>
                        ))}
                      </div>
                      <textarea
                        id="et-body"
                        rows={12}
                        value={value(f)}
                        onChange={(e) => setDraft((d) => ({ ...d, body_html: e.target.value }))}
                        className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-xs text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                      />
                    </>
                  ) : (
                    <input
                      id={`et-${f}`}
                      type="text"
                      value={value(f)}
                      onChange={(e) => setDraft((d) => ({ ...d, [f]: e.target.value }))}
                      className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                    />
                  )}
                  <p className="text-xs text-gray-500 dark:text-gray-400">{hint(f)}</p>
                </div>
              ))}

              <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
                <button
                  onClick={handleReset}
                  disabled={saving}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  {t('etReset')}
                </button>
                <button
                  onClick={handlePreview}
                  disabled={previewing}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  <Eye className="h-3.5 w-3.5" />
                  {t('etPreview')}
                </button>
                <button
                  onClick={handleSave}
                  disabled={!dirty || saving}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
                >
                  <Save className="h-3.5 w-3.5" />
                  {t('save')}
                </button>
              </div>

              {preview && (
                <div className="space-y-2 pt-2">
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    <span className="text-gray-400 dark:text-gray-500">{t('etPreviewSubject')} </span>
                    {preview.subject}
                  </p>
                  <iframe
                    title={t('etPreview')}
                    srcDoc={preview.html}
                    sandbox=""
                    className="h-[640px] w-full rounded-lg border border-gray-200 dark:border-gray-700"
                  />
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <SentTab sends={sends} isLoading={sendsLoading} t={t} />
      )}
    </div>
  )
}

// ── Sent archive ─────────────────────────────────────────────────
function SentTab({
  sends, isLoading, t,
}: {
  sends: EmailSend[]
  isLoading: boolean
  t: (key: string, opts?: Record<string, unknown>) => string
}) {
  const [open, setOpen] = useState<EmailSend | null>(null)

  if (isLoading) return <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">…</p>
  if (!sends.length) return <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">{t('etNoSends')}</p>

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500 dark:text-gray-400">{t('etSentNote')}</p>
      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('etColSentAt')}</TableHead>
              <TableHead>{t('etColTo')}</TableHead>
              <TableHead className="hidden sm:table-cell">{t('etColSubject')}</TableHead>
              <TableHead className="hidden sm:table-cell">{t('etColSentBy')}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sends.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="whitespace-normal break-words text-sm tabular-nums">
                  {s.sent_at ? formatDateTimeCompact(s.sent_at) : '—'}
                </TableCell>
                <TableCell className="whitespace-normal break-words text-sm">
                  {s.to_email}
                  <span className="ml-1.5 text-xs uppercase text-gray-400 dark:text-gray-500">{s.locale}</span>
                </TableCell>
                <TableCell className="hidden whitespace-normal break-words text-sm sm:table-cell">{s.subject}</TableCell>
                <TableCell className="hidden whitespace-normal break-words text-sm sm:table-cell">{s.sent_by_name || '—'}</TableCell>
                <TableCell className="text-right">
                  <button
                    onClick={() => setOpen(s)}
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800 sm:min-h-0"
                  >
                    <Send className="h-3 w-3" />
                    {t('etViewSent')}
                  </button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {open && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              <span className="text-gray-400 dark:text-gray-500">{t('etColTo')}: </span>{open.to_email}
            </p>
            <button
              onClick={() => setOpen(null)}
              className="min-h-[44px] rounded-md border border-gray-200 px-3 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800 sm:min-h-0 sm:py-1.5"
            >
              {t('close')}
            </button>
          </div>
          <iframe
            title={t('etViewSent')}
            srcDoc={open.body_html ?? ''}
            sandbox=""
            className="h-[640px] w-full rounded-lg border border-gray-200 dark:border-gray-700"
          />
        </div>
      )}
    </div>
  )
}
