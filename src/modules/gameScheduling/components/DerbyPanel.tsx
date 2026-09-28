import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import DatePicker from '@/components/ui/DatePicker'
import WeekdayHint from './WeekdayHint'
import { useDerbies } from '../hooks/useDerbies'
import type { Derby } from '../../../types'

interface Props {
  seasonId: string | number
}

// dd.mm.yyyy from a YYYY-MM-DD string (Swiss display; CLAUDE.md date rule).
const ddmmyyyy = (s: string | null) => (s ? s.split('-').reverse().join('.') : '')

const keyOf = (d: Derby) => `${d.team_a.id}:${d.team_b.id}`

// draft[pairKey][svrz_id] = 'YYYY-MM-DD' — rebuilt whenever `derbies` changes.
const buildDraft = (list: Derby[]): Record<string, Record<string, string>> => {
  const next: Record<string, Record<string, string>> = {}
  for (const d of list) {
    next[keyOf(d)] = {}
    for (const lg of d.legs) next[keyOf(d)][lg.svrz_id] = lg.date || ''
  }
  return next
}

// Intra-club derby anchoring (Art. 27 SVRZ). When two KSCW teams share a league
// group, their two head-to-head games must be the FIRST of the Vor- and
// Rückrunde. The spielplaner fixes those two dates here; the opponent slot flow
// then clamps everything else behind them.
export default function DerbyPanel({ seasonId }: Props) {
  const { t } = useTranslation('gameScheduling')
  const { derbies, boundary, isLoading, saveDerby } = useDerbies(seasonId)
  const [draft, setDraft] = useState<Record<string, Record<string, string>>>(() => buildDraft(derbies))
  const [savingKey, setSavingKey] = useState<string | null>(null)

  // Re-seed the draft from freshly loaded derbies — React's
  // adjust-state-during-render pattern, same trigger as the previous
  // `useEffect(…, [derbies])` (the mount run is covered by the lazy initializer).
  const [prevDerbies, setPrevDerbies] = useState(derbies)
  if (prevDerbies !== derbies) {
    setPrevDerbies(derbies)
    setDraft(buildDraft(derbies))
  }

  const halfOf = (date: string): 'vorrunde' | 'rueckrunde' | null =>
    !date || !boundary ? null : date < boundary ? 'vorrunde' : 'rueckrunde'

  const setLegDate = (key: string, svrzId: string, value: string) =>
    setDraft((prev) => ({ ...prev, [key]: { ...prev[key], [svrzId]: value } }))

  const handleSave = async (d: Derby, confirm: boolean) => {
    const key = keyOf(d)
    const legs = d.legs.map((lg) => ({
      svrz_id: lg.svrz_id,
      home_team_id: lg.home_team.id,
      date: draft[key]?.[lg.svrz_id] || null,
    }))
    if (confirm) {
      const dates = legs.map((l) => l.date)
      if (dates.some((x) => !x)) {
        toast.error(t('derbyBothDatesRequired'))
        return
      }
      const halves = dates.map((x) => halfOf(x as string)).sort().join(',')
      if (halves !== 'rueckrunde,vorrunde') {
        toast.error(t('derbyOnePerHalf'))
        return
      }
    }
    setSavingKey(key)
    try {
      await saveDerby({ team_a: d.team_a.id, team_b: d.team_b.id, legs, confirmed: confirm })
      toast.success(confirm ? t('derbyConfirmed') : t('derbySavedDraft'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingKey(null)
    }
  }

  // Nothing to show until games are synced; render a calm empty state so the
  // admin knows the rule is being watched and there's simply no pair this season.
  const body = () => {
    if (isLoading && derbies.length === 0) {
      return <p className="text-sm text-muted-foreground">…</p>
    }
    if (derbies.length === 0) {
      return <p className="text-sm text-muted-foreground">{t('derbyEmpty')}</p>
    }
    return (
      <div className="space-y-4">
        {derbies.map((d) => {
          const key = keyOf(d)
          const saving = savingKey === key
          return (
            <div key={key} className="rounded-xl border border-hairline bg-surface-sunken p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-foreground">
                  {d.team_a.name} ↔ {d.team_b.name}
                </span>
                {d.confirmed && (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/40 dark:text-green-300">
                    {t('derbyConfirmedBadge')}
                  </span>
                )}
              </div>
              <div className="space-y-2">
                {d.legs.map((lg) => {
                  const val = draft[key]?.[lg.svrz_id] ?? ''
                  const half = halfOf(val)
                  return (
                    <div key={lg.svrz_id} className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="text-sm text-foreground">
                          {t('derbyHosts', { home: lg.home_team.name, away: lg.away_team.name })}
                        </div>
                        {lg.round && (
                          <div className="text-xs text-amber-600 dark:text-amber-400">
                            {t('derbyFeedRound', { round: lg.round })}
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {half && (
                          <span className="text-xs text-muted-foreground">
                            {half === 'vorrunde' ? t('derbyVorrunde') : t('derbyRueckrunde')}
                          </span>
                        )}
                        <DatePicker
                          value={val}
                          onChange={(v) => setLegDate(key, lg.svrz_id, v)}
                          className="w-auto"
                        />
                        <WeekdayHint date={val} />
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Button onClick={() => handleSave(d, true)} disabled={saving} size="sm">
                  {saving ? '…' : d.confirmed ? t('derbyUpdate') : t('derbyConfirm')}
                </Button>
                <Button
                  type="button"
                  onClick={() => handleSave(d, false)}
                  disabled={saving}
                  variant="link"
                  size="sm"
                  className="px-2 text-xs text-muted-foreground"
                >
                  {t('derbySaveDraftAction')}
                </Button>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-hairline bg-card shadow-card p-4">
      <h2 className="text-base font-semibold tracking-tight text-foreground">{t('derbyTitle')}</h2>
      <p className="mt-1 mb-1 text-xs text-muted-foreground">{t('derbyHint')}</p>
      {boundary && (
        <p className="mb-4 text-xs text-muted-foreground">
          {t('derbyBoundaryHint', { date: ddmmyyyy(boundary) })}
        </p>
      )}
      {body()}
    </div>
  )
}
