import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  Plus, Edit2, Trash2, Pin, Calendar, Send, Mail, Bell, Image as ImageIcon, X, Loader2,
} from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { fetchItems, createRecord, updateRecord, deleteRecord, assetUrl, API_URL } from '../../lib/api'
import { pickTranslation } from '../../hooks/useAnnouncements'
import { isSafeAppLink } from '../../utils/sanitizeUrl'
import { useConfirm } from '../../components/ConfirmProvider'
import Modal from '../../components/Modal'
import RichTextEditor from '../../components/RichTextEditor'
import DateTimePicker from '../../components/ui/DateTimePicker'
import { stripHtml } from '../../utils/stripHtml'
import { useReportPageLoading } from '../../hooks/usePageReady'
import { formatDate, toUtcIsoFromDatetimeLocal, toDatetimeLocalFromUtcIso } from '../../utils/dateHelpers'
import type { Announcement, AnnouncementLocale, AnnouncementTranslation, AnnouncementAudienceType } from '../../types'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'

const LOCALES: AnnouncementLocale[] = ['de', 'en', 'fr', 'gsw', 'it']
const LOCALE_LABEL: Record<AnnouncementLocale, string> = {
  de: 'Deutsch', en: 'English', fr: 'Français', gsw: 'Schwiizerdütsch', it: 'Italiano',
}
const MAX_IMAGE_SIZE = 5 * 1024 * 1024
const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']

interface FormState {
  id: string | null
  image: string | null
  link: string
  pinned: boolean
  publishNow: boolean
  published_at: string | null
  expires_at: string | null
  audience_type: AnnouncementAudienceType
  audience_sport: 'volleyball' | 'basketball' | null
  notify_push: boolean
  notify_email: boolean
  email_layout: 'standard' | 'newsletter'
  reply_to: string
  translations: Partial<Record<AnnouncementLocale, AnnouncementTranslation>>
}

const emptyForm: FormState = {
  id: null,
  image: null,
  link: '',
  pinned: false,
  publishNow: false,
  published_at: null,
  expires_at: null,
  audience_type: 'all',
  audience_sport: null,
  notify_push: false,
  notify_email: false,
  email_layout: 'standard',
  reply_to: '',
  translations: { de: { title: '', body: '' } },
}

export default function AnnouncementsPage() {
  const { t, i18n } = useTranslation('announcements')
  const confirm = useConfirm()
  const { user } = useAuth()
  const [items, setItems] = useState<Announcement[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [editorOpen, setEditorOpen] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [activeLocale, setActiveLocale] = useState<AnnouncementLocale>('de')
  const [submitting, setSubmitting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  // The fetch itself — state lands in the promise callbacks, never synchronously.
  const load = () =>
    fetchItems<Announcement>('announcements', {
      sort: ['-pinned', '-published_at', '-id'],
      limit: 100,
    })
      .then(setItems)
      .catch((err) => {
        toast.error(t('loadError'))
        console.error(err)
      })
      .finally(() => setIsLoading(false))

  // Re-fetch after a mutation: flip back to the spinner first (event-handler path).
  const refresh = () => {
    setIsLoading(true)
    return load()
  }

  // Initial load. `isLoading` already starts `true`, so the old `refresh()` here
  // set it to `true` again for nothing — `load()` is the exact same request.
  useEffect(() => { load() }, [])

  const openCreate = () => {
    setForm(emptyForm)
    setActiveLocale('de')
    setEditorOpen(true)
  }

  const openEdit = (a: Announcement) => {
    setForm({
      id: a.id,
      image: a.image,
      link: a.link ?? '',
      pinned: !!a.pinned,
      publishNow: !!a.published_at,
      published_at: a.published_at ? toDatetimeLocalFromUtcIso(a.published_at) : null,
      expires_at: a.expires_at ? toDatetimeLocalFromUtcIso(a.expires_at) : null,
      audience_type: a.audience_type ?? 'all',
      audience_sport: a.audience_sport ?? null,
      notify_push: !!a.notify_push,
      notify_email: !!a.notify_email,
      email_layout: a.email_layout === 'newsletter' ? 'newsletter' : 'standard',
      reply_to: a.reply_to ?? '',
      translations: { ...a.translations, de: a.translations?.de ?? { title: '', body: '' } },
    })
    setActiveLocale('de')
    setEditorOpen(true)
  }

  const handleImageUpload = async (file: File) => {
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      toast.error(t('imageType'))
      return
    }
    if (file.size > MAX_IMAGE_SIZE) {
      toast.error(t('imageSize'))
      return
    }
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`${API_URL}/files`, {
        method: 'POST',
        credentials: 'include',
        body: fd,
      })
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`)
      const { data } = await res.json()
      setForm((f) => ({ ...f, image: data.id }))
      toast.success(t('imageUploaded'))
    } catch (err) {
      toast.error(t('imageUploadError'))
      console.error(err)
    } finally {
      setUploading(false)
    }
  }

  const handleSubmit = async () => {
    if (!form.translations.de?.title?.trim()) {
      toast.error(t('titleRequired'))
      setActiveLocale('de')
      return
    }
    if (form.audience_type === 'sport' && !form.audience_sport) {
      toast.error(t('sportRequired'))
      return
    }
    const trimmedLink = form.link.trim()
    if (trimmedLink && !isSafeAppLink(trimmedLink)) {
      toast.error(t('linkInvalid'))
      return
    }

    // Mass-email confirmation guard — audience=all + email send would hit ~200 members.
    // Single point of friction modeled on the /events/test-email CLAUDE.md guideline.
    if (form.notify_email && form.audience_type === 'all' && (form.publishNow || form.published_at)) {
      const ok = await confirm({ message: t('confirmMassEmail'), danger: true })
      if (!ok) return
    }

    // Strip empty translations (where both title and body are blank)
    const cleanedTranslations: Partial<Record<AnnouncementLocale, AnnouncementTranslation>> = {}
    for (const code of LOCALES) {
      const tr = form.translations[code]
      if (tr && (tr.title?.trim() || tr.body?.trim())) {
        cleanedTranslations[code] = { title: tr.title?.trim() ?? '', body: tr.body ?? '' }
      }
    }

    const payload: Record<string, unknown> = {
      image: form.image,
      link: trimmedLink,
      pinned: form.pinned,
      published_at: form.publishNow
        ? (form.published_at && new Date(toUtcIsoFromDatetimeLocal(form.published_at)) <= new Date()
            ? toUtcIsoFromDatetimeLocal(form.published_at)
            : new Date().toISOString())
        : null,
      expires_at: form.expires_at ? toUtcIsoFromDatetimeLocal(form.expires_at) : null,
      audience_type: form.audience_type,
      audience_sport: form.audience_type === 'sport' ? form.audience_sport : null,
      notify_push: form.notify_push,
      notify_email: form.notify_email,
      email_layout: form.email_layout,
      reply_to: form.reply_to.trim() || null,
      translations: cleanedTranslations,
    }
    if (!form.id && user?.id) payload.created_by = user.id

    setSubmitting(true)
    try {
      if (form.id) {
        await updateRecord('announcements', form.id, payload)
        toast.success(t('updated'))
      } else {
        await createRecord('announcements', payload)
        toast.success(t('created'))
      }
      setEditorOpen(false)
      refresh()
    } catch (err) {
      toast.error(t('saveError'))
      console.error(err)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await deleteRecord('announcements', id)
      toast.success(t('deleted'))
      setConfirmDeleteId(null)
      refresh()
    } catch (err) {
      toast.error(t('deleteError'))
      console.error(err)
    }
  }

  const tr = form.translations[activeLocale] ?? { title: '', body: '' }

  const updateTranslation = (patch: Partial<AnnouncementTranslation>) => {
    setForm((f) => ({
      ...f,
      translations: {
        ...f.translations,
        [activeLocale]: { ...(f.translations[activeLocale] ?? { title: '', body: '' }), ...patch },
      },
    }))
  }

  const filledLocales = useMemo(
    () => LOCALES.filter((c) => {
      const v = form.translations[c]
      return !!(v && (v.title?.trim() || v.body?.trim()))
    }),
    [form.translations],
  )

  // Report to app boot gate — see usePageReady.tsx
  useReportPageLoading(isLoading)

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{t('pageTitle')}</h1>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          <Plus className="h-4 w-4" />
          {t('newAnnouncement')}
        </button>
      </div>

      {isLoading ? null : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 px-6 py-10 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
          {t('empty')}
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
          <Table>
            <TableHeader>
              <TableRow className="border-gray-200 dark:border-gray-700">
                <TableHead className="hidden sm:table-cell w-16" />
                <TableHead className="text-gray-500 dark:text-gray-400">{t('pageTitle')}</TableHead>
                <TableHead className="hidden md:table-cell text-gray-500 dark:text-gray-400">{t('audienceLabel')}</TableHead>
                <TableHead className="hidden sm:table-cell text-gray-500 dark:text-gray-400">{t('statusPublished')}</TableHead>
                <TableHead className="w-20 text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((a) => {
                const trItem = pickTranslation(a.translations, i18n.language)
                const isPublished = !!a.published_at && new Date(a.published_at) <= new Date()
                const isExpired = !!a.expires_at && new Date(a.expires_at) <= new Date()
                return (
                  <TableRow key={a.id} className="border-gray-200 dark:border-gray-700 align-top">
                    <TableCell className="hidden sm:table-cell">
                      {a.image ? (
                        <img
                          src={assetUrl(a.image, 'width=160&height=160&fit=cover')}
                          alt=""
                          className="h-12 w-12 rounded-md object-cover"
                        />
                      ) : (
                        <span className="flex h-12 w-12 items-center justify-center rounded-md bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
                          <ImageIcon className="h-4 w-4" />
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <div className="flex items-center gap-1.5">
                        {a.pinned && <Pin className="h-3.5 w-3.5 shrink-0 text-gold-500 dark:text-gold-400" />}
                        <span className="font-medium text-gray-900 dark:text-gray-100">{trItem.title || <span className="italic text-gray-400">({t('noTitle')})</span>}</span>
                      </div>
                      {trItem.body && (
                        <p className="mt-0.5 line-clamp-2 text-xs text-gray-500 dark:text-gray-400">
                          {stripHtml(trItem.body)}
                        </p>
                      )}
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-gray-500 dark:text-gray-400 md:hidden">
                        <span>{audienceLabel(a, t)}</span>
                        {a.published_at && (
                          <span className="inline-flex items-center gap-1 sm:hidden">
                            <Calendar className="h-3 w-3" />
                            {formatDate(a.published_at)}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-xs text-gray-600 dark:text-gray-400">
                      {audienceLabel(a, t)}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <div className="flex flex-col items-start gap-1">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
                            isExpired
                              ? 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                              : isPublished
                                ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                                : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300'
                          }`}
                        >
                          {isExpired ? t('statusExpired') : isPublished ? t('statusPublished') : t('statusDraft')}
                        </span>
                        {a.published_at && (
                          <span className="inline-flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400">
                            <Calendar className="h-3 w-3" />
                            {formatDate(a.published_at)}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-col items-end gap-1 sm:flex-row sm:justify-end">
                        <button
                          onClick={() => openEdit(a)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                          aria-label={t('common:edit')}
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(a.id)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30"
                          aria-label={t('common:delete')}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* ─── Editor modal ─── */}
      <Modal open={editorOpen} onClose={() => setEditorOpen(false)} title={form.id ? t('editTitle') : t('createTitle')} size="lg">
        <div className="space-y-4">
          {/* Hero image */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('image')}
            </label>
            {form.image ? (
              <div className="relative inline-block">
                <img
                  src={assetUrl(form.image, 'width=400&height=200&fit=cover')}
                  alt=""
                  className="h-32 w-auto rounded-md object-cover"
                />
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, image: null }))}
                  className="absolute right-1 top-1 rounded-full bg-white/90 p-1 text-gray-700 shadow hover:bg-white"
                  aria-label={t('common:remove')}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <label className="flex h-24 cursor-pointer items-center justify-center rounded-md border-2 border-dashed border-gray-300 bg-gray-50 text-sm text-gray-500 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:hover:bg-gray-700">
                {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : (
                  <>
                    <ImageIcon className="mr-2 h-4 w-4" />
                    {t('uploadImage')}
                  </>
                )}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => { if (e.target.files?.[0]) handleImageUpload(e.target.files[0]) }}
                  disabled={uploading}
                />
              </label>
            )}
          </div>

          {/* Translation tabs */}
          <div>
            <div className="flex flex-wrap gap-1 border-b border-gray-200 dark:border-gray-700">
              {LOCALES.map((code) => {
                const isActive = activeLocale === code
                const isFilled = filledLocales.includes(code)
                return (
                  <button
                    key={code}
                    type="button"
                    onClick={() => setActiveLocale(code)}
                    className={`relative -mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                      isActive
                        ? 'border-brand-600 text-brand-700 dark:border-brand-400 dark:text-brand-300'
                        : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                    }`}
                  >
                    {LOCALE_LABEL[code]}
                    {code === 'de' && <span className="ml-1 text-red-500">*</span>}
                    {isFilled && code !== 'de' && (
                      <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-green-500" aria-label="Filled" />
                    )}
                  </button>
                )
              })}
            </div>

            <div className="mt-3 space-y-3">
              <input
                type="text"
                value={tr.title}
                onChange={(e) => updateTranslation({ title: e.target.value })}
                placeholder={t('titlePlaceholder')}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
              <RichTextEditor
                value={tr.body}
                onChange={(html) => updateTranslation({ body: html })}
                placeholder={t('bodyPlaceholder')}
                minHeight="10rem"
              />
            </div>
          </div>

          {/* Optional CTA link */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('link')}
            </label>
            <input
              type="text"
              value={form.link}
              onChange={(e) => setForm((f) => ({ ...f, link: e.target.value }))}
              placeholder={t('common:linkUrl')}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            />
          </div>

          {/* Audience */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('audience')}
              </label>
              <select
                value={form.audience_type}
                onChange={(e) => setForm((f) => ({ ...f, audience_type: e.target.value as AnnouncementAudienceType }))}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              >
                <option value="all">{t('audienceAll')}</option>
                <option value="sport">{t('audienceSport')}</option>
              </select>
            </div>
            {form.audience_type === 'sport' && (
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('sport')}
                </label>
                <select
                  value={form.audience_sport ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, audience_sport: (e.target.value || null) as 'volleyball' | 'basketball' | null }))}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                >
                  <option value="">—</option>
                  <option value="volleyball">{t('volleyball')}</option>
                  <option value="basketball">{t('basketball')}</option>
                </select>
              </div>
            )}
          </div>

          {/* Pin + Expiry + Publish */}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={form.pinned}
                onChange={(e) => setForm((f) => ({ ...f, pinned: e.target.checked }))}
                className="h-4 w-4 rounded text-brand-600"
              />
              <Pin className="h-3.5 w-3.5" />
              {t('pin')}
            </label>
            <DateTimePicker
              label={t('expires')}
              value={form.expires_at ?? ''}
              onChange={(v) => setForm((f) => ({ ...f, expires_at: v || null }))}
            />
          </div>

          {/* Publish + Notification toggles */}
          <div className="space-y-2 rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/60">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={form.publishNow}
                onChange={(e) => setForm((f) => ({ ...f, publishNow: e.target.checked }))}
                className="h-4 w-4 rounded text-brand-600"
              />
              <Send className="h-3.5 w-3.5" />
              {t('publish')}
            </label>
            <label className="ml-6 flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={form.notify_push}
                onChange={(e) => setForm((f) => ({ ...f, notify_push: e.target.checked }))}
                disabled={!form.publishNow}
                className="h-4 w-4 rounded text-brand-600"
              />
              <Bell className="h-3.5 w-3.5" />
              {t('notifyPush')}
            </label>
            <label className="ml-6 flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={form.notify_email}
                onChange={(e) => setForm((f) => ({
                  ...f,
                  notify_email: e.target.checked,
                  // Prefill Reply-to with the composing admin's own email the
                  // first time email is enabled; clearing it keeps no-reply.
                  reply_to: e.target.checked && !f.reply_to ? (user?.email ?? '') : f.reply_to,
                }))}
                disabled={!form.publishNow}
                className="h-4 w-4 rounded text-brand-600"
              />
              <Mail className="h-3.5 w-3.5" />
              {t('notifyEmail')}
            </label>
          </div>

          {/* Email options — layout + reply-to (only when emailing) */}
          {form.notify_email && (
            <div className="grid grid-cols-1 gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                  {t('emailLayout')}
                </label>
                <select
                  value={form.email_layout}
                  onChange={(e) => setForm((f) => ({ ...f, email_layout: e.target.value as 'standard' | 'newsletter' }))}
                  className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                >
                  <option value="standard">{t('emailLayoutStandard')}</option>
                  <option value="newsletter">{t('emailLayoutNewsletter')}</option>
                </select>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t('emailLayoutHint')}</p>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                  {t('emailReplyTo')}
                </label>
                <input
                  type="email"
                  value={form.reply_to}
                  onChange={(e) => setForm((f) => ({ ...f, reply_to: e.target.value }))}
                  placeholder="noreply"
                  className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t('emailReplyToHint')}</p>
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 border-t border-gray-200 pt-3 dark:border-gray-700">
            <button
              type="button"
              onClick={() => setEditorOpen(false)}
              disabled={submitting}
              className="rounded-md px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              {t('cancel')}
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {form.id ? t('save') : t('create')}
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete confirm */}
      {confirmDeleteId && (
        <Modal open onClose={() => setConfirmDeleteId(null)} title={t('confirmDeleteTitle')} size="sm">
          <div className="space-y-4">
            <p className="text-sm text-gray-700 dark:text-gray-300">
              {t('confirmDeleteBody')}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="rounded-md px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                {t('cancel')}
              </button>
              <button
                onClick={() => handleDelete(confirmDeleteId)}
                className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                {t('delete')}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

function audienceLabel(a: Announcement, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (a.audience_type === 'all') return t('audienceAll')
  if (a.audience_type === 'sport') {
    return a.audience_sport === 'volleyball'
      ? t('volleyball')
      : a.audience_sport === 'basketball'
        ? t('basketball')
        : '—'
  }
  return a.audience_type
}
