import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useFineRules, formatFineAmount } from '../../hooks/useFines'
import { createRecord, updateRecord, deleteRecord, fetchAllItems } from '../../lib/api'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useConfirm } from '../../components/ConfirmProvider'
import type { Fine, FineActivityType, FineCategory, FineResetWindow, FineRule, FineRuleTier, Member, Team } from '../../types'

const CATEGORIES: FineCategory[] = ['late_signin', 'no_show', 'late_payment', 'custom']
const WINDOWS: FineResetWindow[] = ['calendar_month', 'rolling_30d', 'rolling_90d', 'season', 'never']
const ACTIVITY_TYPES: FineActivityType[] = ['training', 'game', 'event']

/**
 * Categories that price an activity, and so may carry a per-type override
 * (migration 361). Late payment is never tied to an activity; a custom fine may
 * be, but its amount is whatever the leader types.
 */
const ACTIVITY_SCOPED: ReadonlySet<FineCategory> = new Set<FineCategory>(['late_signin', 'no_show'])

function categoryLabelKey(c: string): string {
  return `category${c.charAt(0).toUpperCase()}${c.slice(1).replace(/_(.)/g, (_, ch) => ch.toUpperCase())}`
}

function windowLabelKey(w: FineResetWindow): string {
  switch (w) {
    case 'calendar_month': return 'windowMonth'
    case 'rolling_30d': return 'window30d'
    case 'rolling_90d': return 'window90d'
    case 'season': return 'windowSeason'
    case 'never': return 'windowNever'
  }
}

function typeLabelKey(t: FineActivityType): string {
  switch (t) {
    case 'training': return 'settingsTypeTraining'
    case 'game': return 'settingsTypeGame'
    case 'event': return 'settingsTypeEvent'
  }
}

const inputClass = 'h-9 rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100'

interface FinesSettingsProps {
  teamId: string | number
  /** Team name + season for the PDF header; fetched when the caller has neither. */
  teamName?: string
  season?: string | null
}

const PDF_FINE_FIELDS = ['id', 'member', 'team', 'category', 'amount', 'currency', 'status', 'activity_type', 'activity_date', 'reason', 'issued_at']

/**
 * Per-team Fines settings panel. Wraps itself in the existing accordion-style
 * shell (caller doesn't need to provide a SettingsGroup). Renders one
 * sub-section per category: the general rule, plus — for the categories that
 * price an activity — an optional override per activity type.
 */
export default function FinesSettings({ teamId, teamName, season }: FinesSettingsProps) {
  const { t, i18n } = useTranslation(['fines'])
  const [open, setOpen] = useState(false)
  const { data: rulesRaw, isLoading, isError, refetch } = useFineRules(teamId, { enabled: open })
  const [downloading, setDownloading] = useState(false)
  // Exports are ALWAYS English, whatever the UI language (app-wide convention).
  const tEn = useMemo(() => i18n.getFixedT('en', 'fines'), [i18n])

  // The summary sheet: fetched on click, not on open — a coach opens this panel
  // to change a number far more often than to print the ledger.
  async function handleDownload() {
    setDownloading(true)
    try {
      const [fines, teamRows] = await Promise.all([
        fetchAllItems<Fine>('fines', { filter: { team: { _eq: teamId } }, fields: PDF_FINE_FIELDS, sort: ['issued_at'] }),
        teamName
          ? Promise.resolve<Pick<Team, 'name' | 'season'>[]>([{ name: teamName, season: season ?? '' }])
          : fetchAllItems<Pick<Team, 'name' | 'season'>>('teams', { filter: { id: { _eq: teamId } }, fields: ['name', 'season'] }),
      ])
      const memberIds = [...new Set(fines.filter((f) => f.member != null).map((f) => String(f.member)))]
      const members = memberIds.length > 0
        ? await fetchAllItems<Pick<Member, 'id' | 'first_name' | 'last_name' | 'nickname'>>('members', {
            filter: { id: { _in: memberIds } },
            fields: ['id', 'first_name', 'last_name', 'nickname'],
          })
        : []
      const { buildFinesSummary, exportFinesSummaryPdf } = await import('./finesSummaryExport')
      const model = buildFinesSummary({
        team: { name: teamRows[0]?.name ?? `Team ${teamId}`, season: teamRows[0]?.season ?? null },
        fines,
        members,
        rules: rulesRaw ?? [],
        exportedAt: new Date(),
      }, tEn)
      await exportFinesSummaryPdf(model, tEn)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(t('fines:settingsPdfError', { error: msg }))
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold text-gray-900 dark:text-gray-100"
        style={{ minHeight: 44 }}
      >
        <span>{t('fines:settingsTitle')}</span>
        <span className="text-gray-400 dark:text-gray-500">{open ? '▼' : '▶'}</span>
      </button>
      {open && (
        <div className="divide-y divide-gray-100 border-t border-gray-200 dark:divide-gray-700 dark:border-gray-700">
          <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <p className="text-xs italic text-gray-500 dark:text-gray-400">
              {t('fines:settingsDescription')}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="shrink-0 self-start sm:self-auto"
              onClick={handleDownload}
              loading={downloading}
              icon={<Download className="h-4 w-4" />}
            >
              {t('fines:settingsDownloadPdf')}
            </Button>
          </div>
          {/* The query is deferred until the accordion opens, so the first frame
              after a click never has the rules yet. It used to fall back to an
              empty list, which handed every CategoryEditor rule={null} — four
              unticked "Enabled" boxes that read as "no fines configured for this
              team" and then ticked themselves on a round trip later (and a tap
              landing in that window routed save() down the create branch). Show
              skeleton rows instead: same four labels, no toggle to misread or
              mis-tap. `!rulesRaw` is checked next to isLoading because isLoading
              is still false on the render where `open` flips true — the query's
              fetchStatus is idle for that one tick. */}
          {!isError && (isLoading || !rulesRaw) ? (
            CATEGORIES.map((cat) => (
              <div key={cat} className="flex min-h-[52px] items-center justify-between gap-3 px-4 py-3">
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {t(`fines:${categoryLabelKey(cat)}`)}
                </div>
                <div className="h-5 w-24 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
              </div>
            ))
          ) : (
            CATEGORIES.map((cat) => (
              <CategorySection
                key={cat}
                teamId={teamId}
                category={cat}
                rules={(rulesRaw ?? []).filter((r) => r.category === cat)}
                onChange={refetch}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ── Per-category section: general rule + per-type overrides ──────────

interface CategorySectionProps {
  teamId: string | number
  category: FineCategory
  /** Every fine_rules row of this team × category (general + overrides). */
  rules: FineRule[]
  onChange: () => void
}

function CategorySection({ teamId, category, rules, onChange }: CategorySectionProps) {
  const { t } = useTranslation(['fines'])
  const confirm = useConfirm()
  const general = rules.find((r) => r.activity_type == null) ?? null
  const overrides = rules.filter((r) => r.activity_type != null)
  const [switching, setSwitching] = useState(false)

  // A category is priced EITHER by one ladder for every activity OR per activity
  // type — never a mix, which read as "No tiers yet" next to fully priced
  // per-type rows on the PDF. Per-type mode is simply "override rows exist":
  // switching it on creates the three rows (each a copy of the general ladder,
  // so the coach changes a number rather than rebuilding) and silences the
  // general rule; switching it off deletes them and wakes the general rule up.
  // The engine needs nothing new: a disabled general rule prices nothing, so an
  // activity type whose own row is off is simply not fined.
  const perType = overrides.length > 0

  async function setPerType(on: boolean) {
    setSwitching(true)
    try {
      if (on) {
        await Promise.all(ACTIVITY_TYPES.map((type) => createRecord<FineRule>('fine_rules', {
          team: Number(teamId),
          category,
          activity_type: type,
          enabled: true,
          reset_window: general?.reset_window ?? 'calendar_month',
          tiers: general?.tiers ?? [],
        })))
        if (general?.enabled) await updateRecord<FineRule>('fine_rules', general.id, { enabled: false })
      } else {
        if (!(await confirm({ message: t('fines:settingsPerTypeOffConfirm'), danger: true }))) return
        await Promise.all(overrides.map((r) => deleteRecord('fine_rules', r.id)))
        if (general) await updateRecord<FineRule>('fine_rules', general.id, { enabled: true })
      }
      onChange()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(t('fines:settingsSaveError', { error: msg }))
    } finally {
      setSwitching(false)
    }
  }

  const showModeSwitch = ACTIVITY_SCOPED.has(category) && (general != null || perType)
  const modeSwitchId = `fine-mode-${category}-${String(teamId)}`

  return (
    <div className="space-y-4 px-4 py-3">
      {perType ? (
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {t(`fines:${categoryLabelKey(category)}`)}
        </div>
      ) : (
        <RuleEditor
          teamId={teamId}
          category={category}
          activityType={null}
          rule={general}
          onChange={onChange}
        />
      )}

      {showModeSwitch && (
        <div className={`flex items-center justify-between gap-3 ${perType ? '' : 'border-t border-dashed border-gray-200 pt-3 dark:border-gray-700'}`}>
          <div className="min-w-0">
            <label htmlFor={modeSwitchId} className="cursor-pointer text-xs font-medium text-gray-700 dark:text-gray-300">{t('fines:settingsPerType')}</label>
            <div className="text-xs italic text-gray-500 dark:text-gray-400">{t('fines:settingsPerTypeHint')}</div>
          </div>
          <Switch id={modeSwitchId} checked={perType} disabled={switching} onCheckedChange={setPerType} />
        </div>
      )}

      {perType && (
        <div className="divide-y divide-gray-100 rounded-lg border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
          {ACTIVITY_TYPES.map((type) => (
            <div key={type} className="px-3 py-3">
              <RuleEditor
                teamId={teamId}
                category={category}
                activityType={type}
                rule={overrides.find((r) => r.activity_type === type) ?? null}
                seed={general}
                onChange={onChange}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Single-rule editor (general rule or one override) ────────────────

interface RuleEditorProps {
  teamId: string | number
  category: FineCategory
  /** `null` = the category's general rule; a type = that type's override. */
  activityType: FineActivityType | null
  rule: FineRule | null
  /** Ladder to copy when this editor has to CREATE its row — the general rule, so a per-type row switched on later starts like the ones the mode switch made. */
  seed?: FineRule | null
  onChange: () => void
}

function RuleEditor({ teamId, category, activityType, rule, seed, onChange }: RuleEditorProps) {
  const { t } = useTranslation(['fines', 'common'])
  const confirm = useConfirm()
  const isOverride = activityType != null
  const [enabled, setEnabled] = useState(rule?.enabled ?? false)
  const [resetWindow, setResetWindow] = useState<FineResetWindow>(rule?.reset_window ?? 'calendar_month')
  const [tiers, setTiers] = useState<FineRuleTier[]>(rule?.tiers ?? [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  // Re-sync local state when the parent re-fetches. Adjust-state-during-render
  // keyed on exactly the same four values the old effect used as deps.
  const ruleId = rule?.id
  const ruleEnabled = rule?.enabled
  const ruleResetWindow = rule?.reset_window
  const ruleTiers = rule?.tiers
  const [prevRule, setPrevRule] = useState({ ruleId, ruleEnabled, ruleResetWindow, ruleTiers })
  if (
    prevRule.ruleId !== ruleId ||
    prevRule.ruleEnabled !== ruleEnabled ||
    prevRule.ruleResetWindow !== ruleResetWindow ||
    prevRule.ruleTiers !== ruleTiers
  ) {
    setPrevRule({ ruleId, ruleEnabled, ruleResetWindow, ruleTiers })
    setEnabled(ruleEnabled ?? false)
    setResetWindow(ruleResetWindow ?? 'calendar_month')
    setTiers(ruleTiers ?? [])
  }

  async function save(next: Partial<FineRule>) {
    setSaving(true)
    setError(null)
    try {
      if (rule) {
        await updateRecord<FineRule>('fine_rules', rule.id, next)
      } else {
        await createRecord<FineRule>('fine_rules', {
          team: Number(teamId),
          category,
          activity_type: activityType,
          enabled: true,
          reset_window: seed?.reset_window ?? 'calendar_month',
          tiers: seed?.tiers ?? [],
          ...next,
        })
      }
      setSavedAt(Date.now())
      onChange()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(t('fines:settingsSaveError', { error: msg }))
    } finally {
      setSaving(false)
    }
  }

  async function handleToggleEnabled(next: boolean) {
    setEnabled(next)
    await save({ enabled: next })
  }

  async function handleWindowChange(w: FineResetWindow) {
    setResetWindow(w)
    await save({ reset_window: w })
  }

  async function handleTiersChange(nextTiers: FineRuleTier[]) {
    setTiers(nextTiers)
    await save({ tiers: nextTiers })
  }

  async function handleDelete() {
    if (!rule) return
    if (!(await confirm({ message: t('common:confirmDelete') as string, danger: true }))) return
    await deleteRecord('fine_rules', rule.id)
    onChange()
  }

  function addTier() {
    const nextOffense = (tiers.length > 0 ? Math.max(...tiers.map((tt) => tt.offense ?? tt.offense_min ?? 0)) : 0) + 1
    handleTiersChange([...tiers, { offense: nextOffense, amount: 0 }])
  }

  function removeTier(idx: number) {
    handleTiersChange(tiers.filter((_, i) => i !== idx))
  }

  // Update tier fields locally only; persist on blur (below) so typing a digit
  // into an offense/amount field no longer fires a full fine_rules PATCH per
  // keystroke. Structural changes (add/remove/toggle) still save immediately.
  function updateTier(idx: number, patch: Partial<FineRuleTier>) {
    setTiers((prev) => prev.map((tt, i) => (i === idx ? { ...tt, ...patch } : tt)))
  }

  function toggleTierIsMin(idx: number) {
    handleTiersChange(tiers.map((tt, i) => {
      if (i !== idx) return tt
      if (tt.offense_min != null) return { offense: tt.offense_min, amount: tt.amount }
      return { offense_min: tt.offense ?? idx + 1, amount: tt.amount }
    }))
  }

  // Preview line
  const previewLine = tiers.length === 0
    ? t('fines:settingsNoTiers')
    : tiers.map((tt) => {
        const label = tt.offense_min != null ? `${tt.offense_min}+` : String(tt.offense ?? '?')
        return `${label}: ${formatFineAmount(tt.amount)}`
      }).join(' · ') + ` · ${t(`fines:${windowLabelKey(resetWindow)}`).toLowerCase()}`

  const title = isOverride
    ? t(`fines:${typeLabelKey(activityType)}`)
    : t(`fines:${categoryLabelKey(category)}`)
  const enabledId = `fine-rule-${category}-${activityType ?? 'general'}-${String(teamId)}`

  return (
    <div className="space-y-3">
      <div className="flex min-h-[36px] items-center justify-between gap-3">
        <div className="min-w-0">
          <div className={isOverride ? 'text-sm font-medium text-gray-900 dark:text-gray-100' : 'text-sm font-semibold text-gray-900 dark:text-gray-100'}>
            {title}
          </div>
          {/* In per-type mode the general ladder is off, so a type whose own row
              is off is not fined at all. Say so next to the switch. */}
          {isOverride && rule && !enabled && (
            <div className="text-xs italic text-gray-500 dark:text-gray-400">{t('fines:settingsOverrideOff')}</div>
          )}
        </div>
        <label htmlFor={enabledId} className="inline-flex shrink-0 cursor-pointer items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
          <Switch id={enabledId} checked={enabled} disabled={saving} onCheckedChange={handleToggleEnabled} />
          {t('fines:settingsEnabled')}
        </label>
      </div>

      {/* late_signin is the one category that acts on its own: enabling it arms
          the nightly sweep that declines and fines everyone who never answered.
          A coach flipping a switch called "Enabled" deserves to be told that
          here, not to discover it from a member asking why they owe CHF 20. */}
      {category === 'late_signin' && activityType !== 'event' && enabled && (
        <p className="text-xs italic text-gray-500 dark:text-gray-400">
          {t('fines:settingsLateSigninSweep')}
        </p>
      )}

      {(enabled || rule) && (
        <>
          {/* Reset window */}
          <div className="flex items-center gap-3">
            <label htmlFor={`${enabledId}-window`} className="w-28 shrink-0 text-xs text-gray-600 dark:text-gray-400">
              {t('fines:settingsResetWindow')}
            </label>
            <select
              id={`${enabledId}-window`}
              value={resetWindow}
              onChange={(e) => handleWindowChange(e.target.value as FineResetWindow)}
              className={inputClass}
            >
              {WINDOWS.map((w) => (
                <option key={w} value={w}>{t(`fines:${windowLabelKey(w)}`)}</option>
              ))}
            </select>
          </div>

          {/* Tiers — one row per escalation step, columns aligned by the header
              instead of by a label that changes width ("Offense #" vs "From
              offense #"). The "and above" toggle is what used to be that label. */}
          <div className="space-y-2">
            <div className="text-xs font-medium text-gray-700 dark:text-gray-300">{t('fines:settingsTiers')}</div>
            {tiers.length === 0 ? (
              <div className="text-xs italic text-gray-500 dark:text-gray-400">{t('fines:settingsNoTiers')}</div>
            ) : (
              <div className="rounded-lg border border-gray-200 bg-card dark:border-gray-700">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="whitespace-nowrap text-xs">{t('fines:settingsTierOffenseHeader')}</TableHead>
                      {/* Phone width has no room for "CHF" next to every input AND an
                          "Amount" header — the header carries the currency there. */}
                      <TableHead className="whitespace-nowrap text-xs">
                        <span className="sm:hidden">{t('fines:settingsTierAmount')}</span>
                        <span className="hidden sm:inline">{t('fines:settingsTierAmountHeader')}</span>
                      </TableHead>
                      <TableHead className="w-full whitespace-nowrap text-xs">
                        <span className="sm:hidden">{t('fines:settingsTierAndAboveShort')}</span>
                        <span className="hidden sm:inline">{t('fines:settingsTierAndAbove')}</span>
                      </TableHead>
                      <TableHead className="w-11" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tiers.map((tier, idx) => {
                      const isMin = tier.offense_min != null
                      return (
                        <TableRow key={idx} className="min-h-[44px]">
                          <TableCell className="py-1.5">
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                min="1"
                                step="1"
                                inputMode="numeric"
                                aria-label={isMin ? t('fines:settingsTierOffenseMin') : t('fines:settingsTierOffense')}
                                value={isMin ? (tier.offense_min ?? '') : (tier.offense ?? '')}
                                onChange={(e) => updateTier(idx, isMin
                                  ? { offense_min: parseInt(e.target.value, 10) || 1 }
                                  : { offense: parseInt(e.target.value, 10) || 1 })}
                                onBlur={() => save({ tiers })}
                                className={`${inputClass} w-14 text-right sm:w-16`}
                              />
                              <span className={`w-3 text-sm text-gray-500 dark:text-gray-400 ${isMin ? '' : 'invisible'}`} aria-hidden>+</span>
                            </div>
                          </TableCell>
                          <TableCell className="py-1.5">
                            <div className="flex items-center gap-1.5">
                              <span className="hidden text-xs text-gray-500 sm:inline dark:text-gray-400">{t('fines:settingsTierAmount')}</span>
                              <input
                                type="number"
                                min="0"
                                step="0.05"
                                inputMode="decimal"
                                aria-label={t('fines:settingsTierAmountHeader')}
                                value={tier.amount}
                                onChange={(e) => updateTier(idx, { amount: parseFloat(e.target.value) || 0 })}
                                onBlur={() => save({ tiers })}
                                className={`${inputClass} w-20 text-right`}
                              />
                            </div>
                          </TableCell>
                          <TableCell className="py-1.5">
                            <Switch
                              checked={isMin}
                              disabled={saving}
                              onCheckedChange={() => toggleTierIsMin(idx)}
                              aria-label={t('fines:settingsLastIsMin')}
                            />
                          </TableCell>
                          <TableCell className="py-1.5 text-right">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => removeTier(idx)}
                              aria-label={t('fines:settingsRemoveTier')}
                              className="text-gray-400 hover:text-red-600 dark:hover:text-red-400"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
            <Button type="button" variant="outline" size="sm" onClick={addTier}>
              <Plus className="mr-1 h-4 w-4" />
              {t('fines:settingsAddTier')}
            </Button>
          </div>

          {/* Preview */}
          <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
            <span className="font-medium">{t('fines:settingsPreview')}: </span>
            {previewLine}
          </div>

          {rule && (!isOverride || saving || savedAt) && (
            <div className="flex min-h-[36px] items-center justify-between gap-3">
              <span className="text-xs text-gray-500 dark:text-gray-400" aria-live="polite">
                {saving ? t('common:loading') : savedAt ? t('fines:settingsSaved') : ''}
              </span>
              {/* Per-type rows live and die with the mode switch — no per-row delete. */}
              {!isOverride && (
                <Button type="button" variant="ghost" size="sm" onClick={handleDelete}>
                  {t('common:delete')}
                </Button>
              )}
            </div>
          )}

          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        </>
      )}
    </div>
  )
}
