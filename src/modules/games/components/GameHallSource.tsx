/**
 * Venue → Hall: "Sync" / "Overwrite" for a game whose hall comes from Volleymanager
 * or Basketplan (migration 455). Admins and the sport admin of the game's sport only —
 * the parent decides who sees it, POST /kscw/games/:id/hall-source decides who may.
 *
 * Sync shows the synced hall read-only; Overwrite asks for a hall. Saving moves the
 * game everywhere at once: the app, kscw.ch and the KWI hall calendar (the server
 * pushes the calendar right after the change). Volleymanager / Basketplan are never
 * changed — they stay the official source.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { fetchItem, kscwApi } from '../../../lib/api'
import { apiErrorCode } from '../../../lib/apiErrorCode'
import { invalidateForCollection, keys, useCollection } from '../../../lib/query'
import { formatDateTimeCompactZurich } from '../../../utils/dateHelpers'
import type { Game, Hall } from '../../../types'
import {
  HALL_COMBO_AB, courtLabel, isHallSourceChange, overridePayload, pickerValue, syncSourceKey,
  type HallSourceMode,
} from '../utils/hallSource'

const SOURCE_FIELDS = [
  'id', 'source', 'type', 'hall', 'additional_halls', 'hall_override',
  'synced_hall', 'synced_additional_halls', 'hall_override_by_name', 'hall_override_at',
]

type HallSourceRow = Pick<Game, 'id' | 'source' | 'type' | 'hall' | 'additional_halls' | 'hall_override'
  | 'synced_hall' | 'synced_additional_halls' | 'hall_override_by_name' | 'hall_override_at'>

interface CalendarResult { outcome?: string; dryRun?: boolean }

interface GameHallSourceProps {
  gameId: string | number
  /** Re-read the game after a save, so Venue shows the new hall. */
  onSaved?: () => void | Promise<void>
  /** Line the notes up under a DetailRow value (the game modal's w-28 label column). */
  indent?: boolean
}

export default function GameHallSource({ gameId, onSaved, indent = true }: GameHallSourceProps) {
  const { t } = useTranslation('games')
  const { t: tc } = useTranslation('common')
  const [editing, setEditing] = useState(false)
  const [mode, setMode] = useState<HallSourceMode>('sync')
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)

  const { data: row } = useQuery<HallSourceRow>({
    queryKey: [...keys.collection('games'), 'hall-source', String(gameId)],
    queryFn: () => fetchItem<HallSourceRow>('games', gameId, { fields: SOURCE_FIELDS }),
    staleTime: 30_000,
  })
  const { data: halls } = useCollection<Hall>('halls', {
    sort: ['name'],
    all: true,
    fields: ['id', 'name'],
    staleTime: 120_000,
  })
  const hallList = halls ?? []
  const kwiA = hallList.find((h) => h.name === 'KWI A')?.id
  const kwiB = hallList.find((h) => h.name === 'KWI B')?.id
  const kwiAId = kwiA != null ? String(kwiA) : undefined
  const kwiBId = kwiB != null ? String(kwiB) : undefined

  if (!row) return null

  const overridden = row.hall_override === true
  const sourceName = row.source === 'basketplan' ? 'Basketplan' : 'Volleymanager'
  const syncedLabel = courtLabel(row.synced_hall, row.synced_additional_halls, hallList) || '–'
  const fromSource = t(syncSourceKey(row.source), { hall: syncedLabel })

  function startEdit() {
    if (!row) return
    setMode(overridden ? 'override' : 'sync')
    setValue(overridden ? pickerValue(row.hall, row.additional_halls, kwiAId, kwiBId) : '')
    setEditing(true)
  }

  const changed = isHallSourceChange(row, mode, value, kwiAId, kwiBId)
  const payload = mode === 'sync' ? { override: false as const } : overridePayload(value, kwiAId, kwiBId)

  async function save() {
    if (!payload || !changed) return
    setSaving(true)
    try {
      const res = await kscwApi<{ calendar?: CalendarResult; unchanged?: boolean }>(`/games/${gameId}/hall-source`, {
        method: 'POST',
        body: payload,
      })
      const cal = res?.calendar ?? {}
      if (cal.outcome === 'failed') toast.warning(t('hallSourceCalendarFailed'))
      else if (cal.outcome === 'queued') toast.success(t('hallSourceSavedCalendarLater'))
      else if (cal.dryRun && ['created', 'updated', 'deleted'].includes(cal.outcome ?? '')) toast.success(t('hallSourceSavedDryRun'))
      else if (['created', 'updated', 'deleted'].includes(cal.outcome ?? '')) toast.success(t('hallSourceSavedCalendar'))
      else toast.success(t('hallSourceSaved'))
      setEditing(false)
      invalidateForCollection('games')
      await onSaved?.()
    } catch (err) {
      toast.error(apiErrorCode(err) === 'forbidden' ? t('hallSourceForbidden') : t('hallSourceSaveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-2">
      {overridden && !editing && (
        <div className="flex items-start gap-3 text-sm">
          {indent && <span className="w-28 shrink-0" aria-hidden />}
          <div className="min-w-0 flex-1 space-y-0.5">
            <span className="inline-flex rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:border-amber-800/60 dark:bg-amber-900/30 dark:text-amber-300">
              {t('hallSourceOverwritten')}
            </span>
            <p className="text-xs text-muted-foreground">{fromSource}</p>
            {row.hall_override_by_name && (
              <p className="text-xs text-muted-foreground">
                {t('hallSourceOverwrittenBy', {
                  name: row.hall_override_by_name,
                  date: formatDateTimeCompactZurich(row.hall_override_at ?? ''),
                })}
              </p>
            )}
          </div>
        </div>
      )}

      {!editing ? (
        <div className="flex">
          <Button type="button" size="sm" variant="outline" className="ml-auto" icon={<Pencil />} onClick={startEdit}>
            {t('hallSourceEdit')}
          </Button>
        </div>
      ) : (
        <div className="space-y-3 rounded-xl border border-hairline bg-surface-sunken p-3.5">
          <div>
            <Label id={`hall-source-${gameId}`}>{t('hallSourceLabel')}</Label>
            <ToggleGroup
              type="single"
              variant="outline"
              value={mode}
              onValueChange={(v) => { if (v === 'sync' || v === 'override') setMode(v) }}
              aria-labelledby={`hall-source-${gameId}`}
              className="mt-1.5 grid w-full grid-cols-2"
            >
              <ToggleGroupItem value="sync">{t('hallSourceSync')}</ToggleGroupItem>
              <ToggleGroupItem value="override">{t('hallSourceOverride')}</ToggleGroupItem>
            </ToggleGroup>
          </div>

          {mode === 'sync' ? (
            <p className="text-sm text-foreground">{fromSource}</p>
          ) : (
            <div>
              <Label htmlFor={`hall-source-hall-${gameId}`}>{t('hallLabel')}</Label>
              <Select value={value} onValueChange={setValue}>
                <SelectTrigger id={`hall-source-hall-${gameId}`} className="mt-1.5">
                  <SelectValue placeholder={t('hallSourcePlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {kwiAId && kwiBId && (
                    <SelectItem value={HALL_COMBO_AB}>{t('hallSourceComboAB')}</SelectItem>
                  )}
                  {hallList.map((h) => (
                    <SelectItem key={h.id} value={String(h.id)}>{h.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            {mode === 'override'
              ? t('hallSourceOverrideHint', { source: sourceName })
              : t('hallSourceSyncHint', { source: sourceName })}
          </p>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setEditing(false)} disabled={saving}>
              {tc('cancel')}
            </Button>
            <Button type="button" size="sm" onClick={() => void save()} loading={saving} disabled={!payload || !changed}>
              {tc('save')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
