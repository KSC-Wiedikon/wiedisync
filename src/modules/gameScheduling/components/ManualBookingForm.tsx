import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

interface HallOption {
  id: string | number
  name: string
}

interface Props {
  opponentId: string | number
  /** Halls offered for the home leg (KSCW halls). */
  halls: HallOption[]
  /** Whether a confirmed home leg already exists (changes the toggle label). */
  hasHome?: boolean
  /** Whether a confirmed away leg already exists. */
  hasAway?: boolean
  onSave: (legs: {
    home?: { date: string; start_time: string; end_time?: string; hall: number | string }
    away?: { date: string; start_time?: string; place?: string }
  }) => Promise<void>
}

// Add 90 minutes to an HH:MM string (default game length) for a sensible end time.
function plus90(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return ''
  const total = (h * 60 + m + 90) % (24 * 60)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

// Manually record an already-agreed matchup (date settled by email/phone outside
// the tool), skipping the opponent's propose/choose flow. Collapsed by default;
// the admin fills the home leg, the away leg, or both.
export default function ManualBookingForm({ opponentId, halls, hasHome, hasAway, onSave }: Props) {
  const { t } = useTranslation('gameScheduling')
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const [homeOn, setHomeOn] = useState(false)
  const [homeDate, setHomeDate] = useState('')
  const [homeStart, setHomeStart] = useState('')
  const [homeEnd, setHomeEnd] = useState('')
  const [homeHall, setHomeHall] = useState<string>('')

  const [awayOn, setAwayOn] = useState(false)
  const [awayDate, setAwayDate] = useState('')
  const [awayStart, setAwayStart] = useState('')
  const [awayPlace, setAwayPlace] = useState('')

  const reset = () => {
    setHomeOn(false); setHomeDate(''); setHomeStart(''); setHomeEnd(''); setHomeHall('')
    setAwayOn(false); setAwayDate(''); setAwayStart(''); setAwayPlace('')
  }

  const handleSave = async () => {
    const legs: Parameters<typeof onSave>[0] = {}
    if (homeOn) {
      if (!homeDate || !homeStart || !homeHall) { toast.error(t('manualHomeIncomplete')); return }
      legs.home = { date: homeDate, start_time: homeStart, end_time: homeEnd || plus90(homeStart), hall: homeHall }
    }
    if (awayOn) {
      if (!awayDate) { toast.error(t('manualAwayIncomplete')); return }
      legs.away = { date: awayDate, start_time: awayStart || undefined, place: awayPlace || undefined }
    }
    if (!legs.home && !legs.away) { toast.error(t('manualNothingToSave')); return }
    setSaving(true)
    try {
      await onSave(legs)
      toast.success(t('manualSaved'))
      reset(); setOpen(false)
    } catch (err) {
      toast.error((err as { body?: { error?: string } })?.body?.error || (err instanceof Error ? err.message : String(err)))
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100'

  if (!open) {
    return (
      <div className="mt-3 border-t border-gray-200/70 pt-3 dark:border-gray-700/70">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
        >
          {t('manualEnterAgreed')}
        </button>
      </div>
    )
  }

  return (
    <div className="mt-3 space-y-3 border-t border-gray-200/70 pt-3 dark:border-gray-700/70">
      <p className="text-xs text-gray-500 dark:text-gray-400">{t('manualHint')}</p>

      {/* Home leg */}
      <div className="rounded-md border border-gray-200 p-2 dark:border-gray-700">
        <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-200">
          <input type="checkbox" checked={homeOn} onChange={(e) => setHomeOn(e.target.checked)} />
          {t('manualHomeGame')}{hasHome ? ` (${t('manualOverwrite')})` : ''}
        </label>
        {homeOn && (
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="col-span-2 sm:col-span-1">
              <span className="mb-0.5 block text-xs text-gray-500 dark:text-gray-400">{t('manualDate')}</span>
              <input type="date" value={homeDate} onChange={(e) => setHomeDate(e.target.value)} className={inputCls} />
            </label>
            <label>
              <span className="mb-0.5 block text-xs text-gray-500 dark:text-gray-400">{t('manualStart')}</span>
              <input
                type="time" value={homeStart}
                onChange={(e) => { setHomeStart(e.target.value); if (!homeEnd && e.target.value) setHomeEnd(plus90(e.target.value)) }}
                className={inputCls}
              />
            </label>
            <label>
              <span className="mb-0.5 block text-xs text-gray-500 dark:text-gray-400">{t('manualEnd')}</span>
              <input type="time" value={homeEnd} onChange={(e) => setHomeEnd(e.target.value)} className={inputCls} />
            </label>
            <label className="col-span-2 sm:col-span-1">
              <span className="mb-0.5 block text-xs text-gray-500 dark:text-gray-400">{t('manualHall')}</span>
              <select value={homeHall} onChange={(e) => setHomeHall(e.target.value)} className={`${inputCls} dark:bg-gray-800`}>
                <option value="">{t('manualSelectHall')}</option>
                {halls.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
              </select>
            </label>
          </div>
        )}
      </div>

      {/* Away leg */}
      <div className="rounded-md border border-gray-200 p-2 dark:border-gray-700">
        <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-200">
          <input type="checkbox" checked={awayOn} onChange={(e) => setAwayOn(e.target.checked)} />
          {t('manualAwayGame')}{hasAway ? ` (${t('manualOverwrite')})` : ''}
        </label>
        {awayOn && (
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="col-span-2 sm:col-span-1">
              <span className="mb-0.5 block text-xs text-gray-500 dark:text-gray-400">{t('manualDate')}</span>
              <input type="date" value={awayDate} onChange={(e) => setAwayDate(e.target.value)} className={inputCls} />
            </label>
            <label>
              <span className="mb-0.5 block text-xs text-gray-500 dark:text-gray-400">{t('manualStart')}</span>
              <input type="time" value={awayStart} onChange={(e) => setAwayStart(e.target.value)} className={inputCls} />
            </label>
            <label className="col-span-2">
              <span className="mb-0.5 block text-xs text-gray-500 dark:text-gray-400">{t('manualPlace')}</span>
              <input type="text" value={awayPlace} onChange={(e) => setAwayPlace(e.target.value)} placeholder={t('manualPlacePlaceholder')} className={inputCls} />
            </label>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? t('saving') : t('manualSave')}
        </button>
        <button
          type="button"
          onClick={() => { reset(); setOpen(false) }}
          disabled={saving}
          className="rounded-md px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          {t('cancel')}
        </button>
      </div>
    </div>
  )
}
