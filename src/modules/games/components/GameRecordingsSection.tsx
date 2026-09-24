import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Globe, Pencil, Plus, Trash2, Video } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { kscwApi } from '../../../lib/api'
import { sanitizeUrl } from '../../../utils/sanitizeUrl'

interface Recording {
  id?: number
  url: string
  title: string | null
  show_on_website: boolean
}

interface RecordingsResponse {
  data: Recording[]
  can_edit: boolean
}

const MAX_RECORDINGS = 10

/** Hostname as a fallback label — "youtube.com" reads better than a 90-char URL. */
function hostLabel(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

/**
 * Video links for a game (migration 375, `/kscw/games/:id/recordings`).
 * Every logged-in member sees every link; a link with "Show on website" on is also
 * published on kscw.ch. Editing (coach/TR/admin) is decided server-side and
 * reported back as `can_edit` — `canManage` only additionally hides the editor
 * when the viewer is an admin with admin mode off.
 */
export default function GameRecordingsSection({ gameId, canManage }: { gameId: string; canManage: boolean }) {
  const { t } = useTranslation('games')
  const [recordings, setRecordings] = useState<Recording[]>([])
  const [serverCanEdit, setServerCanEdit] = useState(false)
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Recording[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    kscwApi<RecordingsResponse>(`/games/${gameId}/recordings`)
      .then((res) => {
        if (cancelled) return
        setRecordings(res.data ?? [])
        setServerCanEdit(!!res.can_edit)
        setLoadedFor(gameId)
      })
      .catch(() => { if (!cancelled) setLoadedFor(gameId) })
    return () => { cancelled = true }
  }, [gameId])

  const canEdit = serverCanEdit && canManage
  if (loadedFor !== gameId) return null
  if (!recordings.length && !canEdit) return null

  const startEdit = () => {
    setDraft(recordings.length ? recordings.map((r) => ({ ...r })) : [{ url: '', title: '', show_on_website: false }])
    setEditing(true)
  }

  const patchDraft = (i: number, patch: Partial<Recording>) =>
    setDraft((d) => d.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  const save = async () => {
    const rows = draft
      .map((r) => ({ ...r, url: r.url.trim(), title: (r.title ?? '').trim() || null }))
      .filter((r) => r.url)
    if (rows.some((r) => !sanitizeUrl(r.url))) {
      toast.error(t('recordingsInvalidUrl'))
      return
    }
    setSaving(true)
    try {
      const res = await kscwApi<RecordingsResponse>(`/games/${gameId}/recordings`, {
        method: 'POST',
        body: { recordings: rows },
      })
      setRecordings(res.data ?? [])
      setEditing(false)
      toast.success(t('recordingsSaved'))
    } catch {
      toast.error(t('recordingsSaveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3 border-t dark:border-gray-700 px-6 py-4">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          {t('recordings')}
        </h4>
        {canEdit && !editing && (
          <Button variant="ghost" size="sm" className="min-h-[44px] sm:min-h-0" onClick={startEdit}>
            {recordings.length ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {recordings.length ? t('recordingsEdit') : t('recordingsAdd')}
          </Button>
        )}
      </div>

      {!editing && (
        recordings.length ? (
          <ul className="space-y-2">
            {recordings.map((r) => {
              const href = sanitizeUrl(r.url)
              return (
                <li key={r.id ?? r.url} className="flex items-center gap-2 text-sm">
                  <Video className="h-4 w-4 shrink-0 text-muted-foreground" />
                  {href ? (
                    <a href={href} target="_blank" rel="noopener noreferrer" className="min-w-0 break-all text-primary underline-offset-2 hover:underline">
                      {r.title || hostLabel(r.url)}
                    </a>
                  ) : (
                    <span className="min-w-0 break-all">{r.title || r.url}</span>
                  )}
                  {r.show_on_website && (
                    <span title={t('recordingsOnWebsite')} className="inline-flex shrink-0 items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                      <Globe className="h-3 w-3" />
                      {t('recordingsWebsiteBadge')}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t('recordingsNone')}</p>
        )
      )}

      {editing && (
        <div className="space-y-3">
          {draft.map((r, i) => (
            <div key={i} className="space-y-2 rounded-md border p-3 dark:border-gray-700">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1 space-y-2">
                  <Input
                    type="url"
                    inputMode="url"
                    placeholder="https://…"
                    value={r.url}
                    onChange={(e) => patchDraft(i, { url: e.target.value })}
                    aria-label={t('recordingsUrl')}
                  />
                  <Input
                    placeholder={t('recordingsTitlePlaceholder')}
                    value={r.title ?? ''}
                    maxLength={120}
                    onChange={(e) => patchDraft(i, { title: e.target.value })}
                    aria-label={t('recordingsTitle')}
                  />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11 shrink-0 sm:h-9 sm:w-9"
                  onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}
                  aria-label={t('recordingsRemove')}
                  title={t('recordingsRemove')}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <label className="flex min-h-[44px] items-center gap-2 text-sm sm:min-h-0">
                <Switch
                  checked={r.show_on_website}
                  onCheckedChange={(v) => patchDraft(i, { show_on_website: v })}
                />
                {t('recordingsShowOnWebsite')}
              </label>
            </div>
          ))}
          {draft.length < MAX_RECORDINGS && (
            <Button
              variant="outline"
              size="sm"
              className="min-h-[44px] sm:min-h-0"
              onClick={() => setDraft((d) => [...d, { url: '', title: '', show_on_website: false }])}
            >
              <Plus className="h-4 w-4" />
              {t('recordingsAddAnother')}
            </Button>
          )}
          <p className="text-xs text-muted-foreground">{t('recordingsHint')}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={saving}>
              {t('recordingsCancel')}
            </Button>
            <Button size="sm" onClick={save} disabled={saving}>
              {t('recordingsSave')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
