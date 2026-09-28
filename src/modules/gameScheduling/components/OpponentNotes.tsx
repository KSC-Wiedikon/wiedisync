import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

interface Props {
  /** The opponent's own remark to KSCW (read-only here). */
  opponentNote?: string | null
  /** KSCW's note to the opponent (editable here; the opponent sees it on their page). */
  kscwNote?: string | null
  onSave: (kscwNote: string) => Promise<void>
}

// Per-opponent notes in the admin dashboard: the opponent's remark (read-only)
// and an editable note from KSCW that the opponent sees on their proposal page.
export default function OpponentNotes({ opponentNote, kscwNote, onSave }: Props) {
  const { t } = useTranslation('gameScheduling')
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(kscwNote || '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    setSaved(false)
    try {
      await onSave(draft.trim())
      setSaved(true)
      setOpen(false)
    } catch { /* errors surface via the page-level toast/log */ }
    finally { setSaving(false) }
  }

  const hasKscwNote = !!(kscwNote && kscwNote.trim())

  return (
    <div className="mt-3 space-y-2 border-t border-border/70 pt-3">
      {/* Opponent's remark (read-only) */}
      {opponentNote && opponentNote.trim() && (
        <div className="rounded-lg border border-hairline bg-surface-sunken px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('opponentRemark')}</p>
          <p className="mt-0.5 whitespace-pre-wrap text-sm text-foreground">{opponentNote}</p>
        </div>
      )}

      {/* KSCW note to the opponent (editable) */}
      {!open ? (
        <div className="flex flex-wrap items-start gap-x-2 gap-y-1 text-sm">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('noteToOpponent')}:</span>
          {hasKscwNote
            ? <span className="whitespace-pre-wrap text-foreground">{kscwNote}</span>
            : <span className="italic text-muted-foreground/80">{t('noteToOpponentNone')}</span>}
          <Button
            type="button"
            onClick={() => { setDraft(kscwNote || ''); setOpen(true); setSaved(false) }}
            variant="link"
            size="sm"
            className="px-0 text-xs"
          >
            {hasKscwNote ? t('edit') : t('add')}
          </Button>
          {saved && <span className="text-xs text-green-600 dark:text-green-400">{t('noteSaved')}</span>}
        </div>
      ) : (
        <div>
          <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('noteToOpponent')}</label>
          <p className="mb-1 text-xs text-muted-foreground/80">{t('noteToOpponentHint')}</p>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder={t('noteToOpponentPlaceholder')}
            className="w-full rounded-lg border border-input bg-card px-2.5 py-1.5 text-sm text-foreground focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring placeholder:text-muted-foreground/70 dark:bg-input/20"
          />
          <div className="mt-1.5 flex items-center gap-2">
            <Button
              type="button"
              onClick={handleSave}
              disabled={saving}
              size="sm"
            >
              {saving ? t('saving') : t('save')}
            </Button>
            <Button
              type="button"
              onClick={() => setOpen(false)}
              disabled={saving}
              variant="ghost"
              size="sm"
            >
              {t('cancel')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
