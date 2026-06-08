import { useState } from 'react'
import { useTranslation } from 'react-i18next'

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
    <div className="mt-3 space-y-2 border-t border-gray-200/70 pt-3 dark:border-gray-700/70">
      {/* Opponent's remark (read-only) */}
      {opponentNote && opponentNote.trim() && (
        <div className="rounded-md bg-gray-50 px-3 py-2 dark:bg-gray-700/40">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('opponentRemark')}</p>
          <p className="mt-0.5 whitespace-pre-wrap text-sm text-gray-800 dark:text-gray-200">{opponentNote}</p>
        </div>
      )}

      {/* KSCW note to the opponent (editable) */}
      {!open ? (
        <div className="flex flex-wrap items-start gap-x-2 gap-y-1 text-sm">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('noteToOpponent')}:</span>
          {hasKscwNote
            ? <span className="whitespace-pre-wrap text-gray-800 dark:text-gray-200">{kscwNote}</span>
            : <span className="italic text-gray-400 dark:text-gray-500">{t('noteToOpponentNone')}</span>}
          <button
            type="button"
            onClick={() => { setDraft(kscwNote || ''); setOpen(true); setSaved(false) }}
            className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
          >
            {hasKscwNote ? t('edit') : t('add')}
          </button>
          {saved && <span className="text-xs text-green-600 dark:text-green-400">{t('noteSaved')}</span>}
        </div>
      ) : (
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('noteToOpponent')}</label>
          <p className="mb-1 text-xs text-gray-400 dark:text-gray-500">{t('noteToOpponentHint')}</p>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder={t('noteToOpponentPlaceholder')}
            className="w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
          />
          <div className="mt-1.5 flex items-center gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded-md bg-brand-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {saving ? t('saving') : t('save')}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={saving}
              className="rounded-md px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              {t('cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
