import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ChevronDown, ChevronUp, Info, Plus, Trash2 } from 'lucide-react'
import { Button } from '../../../components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table'
import { useConfirm } from '../../../components/ConfirmProvider'
import { formatDateZurich } from '../../../utils/dateHelpers'
import {
  FRIDAY_SLOTS,
  SATURDAY_SLOTS,
  SUNDAY_SLOTS,
  PROBASKET_LEAGUES_2026_27,
  type ProbasketLeagueCode,
} from '../utils/probasketSeason'
import {
  HALL_PRESET_RULES,
  PLAY_DOWS,
  hallPresetOf,
  type BasketballBlockedRule,
  type BasketballRuleCategory,
  type BasketballTeamRule,
  type HallPreset,
} from '../utils/basketballRules'
import type { Team } from '../../../types'

/**
 * The club's basketball constraint matrix — one row per team, editable.
 *
 * Volleyball's equivalent (`TeamSlotConfigPanel`) is a card grid with two toggles per
 * team; basketball carries eight constraints per team, so this is a `<Table>` per
 * CLAUDE.md ("Lists → tables, always" — homogeneous records you scan and edit). The
 * interaction model is the same: every control writes immediately, no save button.
 *
 * ⚠ A team with NO rules row is NOT "a team without constraints" — it is a team the
 * generator skips entirely. That state is rendered as an explicit amber gap with a
 * "Configure" action, never as an empty rule set. Today it is the two DU18 squads,
 * whose Spark/Fire ↔ 1x/2x mapping nobody has resolved yet.
 */

interface Props {
  teams: Team[]
  byTeam: Map<string, BasketballTeamRule>
  saveRule: (teamId: string | number, patch: Partial<BasketballTeamRule>) => Promise<void>
  createRule: (team: Team) => Promise<void>
  removeRule: (id: string | number) => Promise<void>
  isLoading?: boolean
}

const CATEGORIES: BasketballRuleCategory[] = ['seniors', 'u18', 'youth']
const HALL_PRESETS: HallPreset[] = ['ab_hard', 'ab_then_halves', 'ab_halves_c', 'any']
const LEAGUE_CODES = Object.keys(PROBASKET_LEAGUES_2026_27) as ProbasketLeagueCode[]

/** Every tip-off time in the fixed weekend grid, ascending — the start-window choices. */
const ALL_TIMES = [...new Set([...FRIDAY_SLOTS, ...SATURDAY_SLOTS, ...SUNDAY_SLOTS])].sort()

const DAY_KEY: Record<number, string> = { 5: 'day_fri', 6: 'day_sat', 0: 'day_sun' }

const selectClass =
  'min-h-11 w-full rounded-md border border-border bg-transparent px-2 py-1 text-xs dark:bg-gray-800'
const inputClass =
  'min-h-11 rounded-md border border-border bg-transparent px-2 py-1 text-xs dark:bg-gray-800'

export default function BasketballTeamRulesPanel({
  teams,
  byTeam,
  saveRule,
  createRule,
  removeRule,
  isLoading,
}: Props) {
  const { t } = useTranslation('basketballScheduling')
  const confirm = useConfirm()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const missing = useMemo(() => teams.filter((tm) => !byTeam.get(String(tm.id))), [teams, byTeam])

  /**
   * Configured teams first, then the open ones — on prod 6 of 17 active basketball teams
   * have no rules, and interleaving them by name buried the editable rows. Order only;
   * an open team is planned exactly like a configured one.
   */
  const ordered = useMemo(() => {
    const configured = teams.filter((tm) => byTeam.get(String(tm.id)))
    return [...configured, ...teams.filter((tm) => !byTeam.get(String(tm.id)))]
  }, [teams, byTeam])

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key)
    try {
      await fn()
    } catch {
      toast.error(t('saveError'))
    } finally {
      setBusy(null)
    }
  }

  const patch = (team: Team, p: Partial<BasketballTeamRule>) =>
    run(String(team.id), () => saveRule(team.id, p))

  /** A human summary of one blocked-date rule, for the compact table cell. */
  const blockedLabel = (rule: BasketballBlockedRule): string => {
    if (rule.kind === 'before_date') return t('blockedBefore', { date: formatDateZurich(rule.date) })
    if (rule.kind === 'date_range') {
      return t('blockedRange', { start: formatDateZurich(rule.start), end: formatDateZurich(rule.end) })
    }
    return rule.include_weekend_before ? t('blockedHolidaysPlus') : t('blockedHolidays')
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 sm:p-6 dark:border-gray-700 dark:bg-gray-800">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('teamRules')}</h2>
      <p className="mt-1 mb-4 max-w-3xl text-xs text-gray-500 dark:text-gray-400">{t('teamRulesHint')}</p>

      {/* Informational, not a warning — a team with no rules is offered every slot. */}
      {missing.length > 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-xs text-sky-900 dark:border-sky-800 dark:bg-sky-900/20 dark:text-sky-200">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{t('teamRulesMissing', { teams: missing.map((m) => m.name).join(', ') })}</span>
        </div>
      )}

      {isLoading ? (
        <p className="py-4 text-sm text-gray-500 dark:text-gray-400">{t('loading')}</p>
      ) : teams.length === 0 ? (
        <p className="py-4 text-sm text-gray-500 dark:text-gray-400">{t('teamRulesNoTeams')}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('colTeam')}</TableHead>
              <TableHead>{t('colGenerate')}</TableHead>
              <TableHead>{t('colCategory')}</TableHead>
              <TableHead>{t('colDays')}</TableHead>
              <TableHead>{t('colStart')}</TableHead>
              <TableHead className="hidden sm:table-cell">{t('colHalls')}</TableHead>
              <TableHead className="hidden sm:table-cell">{t('colBackToBack')}</TableHead>
              <TableHead className="hidden lg:table-cell">{t('colBlocked')}</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {ordered.map((team) => {
              const rule = byTeam.get(String(team.id)) ?? null
              const key = String(team.id)
              const isOpen = expanded === key
              const disabled = busy === key

              if (!rule) {
                return (
                  <TableRow key={key} className="bg-sky-50/60 dark:bg-sky-900/10">
                    <TableCell className="min-h-11 whitespace-normal break-words font-medium">
                      {team.name}
                    </TableCell>
                    {/* colSpan covers the four ALWAYS-visible columns only; the three
                        responsive ones get their own hidden cells, so the row keeps the
                        same shape as the header at every breakpoint. */}
                    <TableCell colSpan={4} className="whitespace-normal break-words text-xs">
                      <span className="mr-2 rounded bg-sky-100 px-2 py-0.5 font-medium text-sky-900 dark:bg-sky-900/40 dark:text-sky-200">
                        {t('openToAll')}
                      </span>
                      <span className="text-gray-600 dark:text-gray-300">{t('openToAllHint')}</span>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell" />
                    <TableCell className="hidden sm:table-cell" />
                    <TableCell className="hidden lg:table-cell" />
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        className="min-h-11 whitespace-nowrap"
                        disabled={disabled}
                        onClick={() => run(key, () => createRule(team))}
                      >
                        <Plus className="h-4 w-4" aria-hidden /> {t('configureTeam')}
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              }

              const preset = hallPresetOf(rule.halls)

              return [
                <TableRow key={key} className={rule.enabled ? undefined : 'opacity-60'}>
                  <TableCell className="whitespace-normal break-words font-medium">
                    {team.name}
                    <span className="block text-[11px] font-normal text-gray-500 dark:text-gray-400">
                      {rule.league}
                    </span>
                  </TableCell>

                  {/* Generate slots for this team at all */}
                  <TableCell>
                    <Button
                      size="sm"
                      variant={rule.enabled ? 'default' : 'outline'}
                      aria-pressed={rule.enabled}
                      disabled={disabled}
                      className="min-h-11 w-full text-xs"
                      onClick={() => patch(team, { enabled: !rule.enabled })}
                    >
                      {rule.enabled ? t('ruleOn') : t('ruleOff')}
                    </Button>
                  </TableCell>

                  {/* Category — joins the club timeslot matrix */}
                  <TableCell>
                    <select
                      className={selectClass}
                      value={rule.category}
                      disabled={disabled}
                      aria-label={t('colCategory')}
                      onChange={(e) => patch(team, { category: e.target.value as BasketballRuleCategory })}
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {t(`category_${c}`)}
                        </option>
                      ))}
                    </select>
                  </TableCell>

                  {/* Allowed (hard) + preferred (soft) weekdays */}
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-center">
                        <span className="text-[11px] text-gray-500 dark:text-gray-400">{t('daysAllowed')}</span>
                        <div className="flex gap-1">
                          {PLAY_DOWS.map((d) => {
                            const on = rule.allowed_dows.includes(d)
                            return (
                              <Button
                                key={d}
                                size="sm"
                                variant={on ? 'default' : 'outline'}
                                aria-pressed={on}
                                disabled={disabled}
                                className="h-11 w-11 p-0 text-xs sm:h-8 sm:w-9"
                                onClick={() =>
                                  patch(team, {
                                    allowed_dows: on
                                      ? rule.allowed_dows.filter((x) => x !== d)
                                      : [...rule.allowed_dows, d],
                                    // A day that is no longer allowed cannot stay preferred.
                                    ...(on ? { preferred_dows: rule.preferred_dows.filter((x) => x !== d) } : {}),
                                  })
                                }
                              >
                                {t(DAY_KEY[d])}
                              </Button>
                            )
                          })}
                        </div>
                      </div>
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-center">
                        <span className="text-[11px] text-gray-500 dark:text-gray-400">{t('daysPreferred')}</span>
                        <div className="flex gap-1">
                          {PLAY_DOWS.map((d) => {
                            const allowed = rule.allowed_dows.includes(d)
                            const on = rule.preferred_dows.includes(d)
                            return (
                              <Button
                                key={d}
                                size="sm"
                                variant={on ? 'default' : 'outline'}
                                aria-pressed={on}
                                disabled={disabled || !allowed}
                                className="h-11 w-11 p-0 text-xs sm:h-8 sm:w-9"
                                onClick={() =>
                                  patch(team, {
                                    preferred_dows: on
                                      ? rule.preferred_dows.filter((x) => x !== d)
                                      : [...rule.preferred_dows, d],
                                  })
                                }
                              >
                                {t(DAY_KEY[d])}
                              </Button>
                            )
                          })}
                        </div>
                      </div>
                    </div>
                  </TableCell>

                  {/* Start window — both bounds inclusive */}
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <label className="flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400">
                        {t('startFrom')}
                        <select
                          className={selectClass}
                          value={rule.start_min ?? ''}
                          disabled={disabled}
                          onChange={(e) => patch(team, { start_min: e.target.value || null })}
                        >
                          <option value="">{t('startAny')}</option>
                          {ALL_TIMES.map((tm) => (
                            <option key={tm} value={tm}>
                              {tm}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400">
                        {t('startUntil')}
                        <select
                          className={selectClass}
                          value={rule.start_max ?? ''}
                          disabled={disabled}
                          onChange={(e) => patch(team, { start_max: e.target.value || null })}
                        >
                          <option value="">{t('startAny')}</option>
                          {ALL_TIMES.map((tm) => (
                            <option key={tm} value={tm}>
                              {tm}
                            </option>
                          ))}
                        </select>
                      </label>
                      {(rule.start_min || rule.start_max) && (
                        <Button
                          size="sm"
                          variant={rule.start_hard ? 'default' : 'outline'}
                          aria-pressed={rule.start_hard}
                          disabled={disabled}
                          title={t('startHardHint')}
                          className="h-11 text-[11px] sm:h-8"
                          onClick={() => patch(team, { start_hard: !rule.start_hard })}
                        >
                          {rule.start_hard ? t('startHard') : t('startSoft')}
                        </Button>
                      )}
                    </div>
                  </TableCell>

                  {/* Hall preference */}
                  <TableCell className="hidden sm:table-cell">
                    <select
                      className={selectClass}
                      value={preset}
                      disabled={disabled}
                      aria-label={t('colHalls')}
                      onChange={(e) => {
                        // 'custom' is only ever a read-back of a hand-edited rule; picking
                        // it again would resolve to undefined and wipe the hall tiers.
                        const next = e.target.value as HallPreset
                        if (next === 'custom') return
                        patch(team, { halls: HALL_PRESET_RULES[next] })
                      }}
                    >
                      {preset === 'custom' && <option value="custom">{t('hallPreset_custom')}</option>}
                      {HALL_PRESETS.map((p) => (
                        <option key={p} value={p}>
                          {t(`hallPreset_${p}`)}
                        </option>
                      ))}
                    </select>
                  </TableCell>

                  {/* Own back-to-back games */}
                  <TableCell className="hidden sm:table-cell">
                    <Button
                      size="sm"
                      variant={rule.own_back_to_back ? 'default' : 'outline'}
                      aria-pressed={rule.own_back_to_back}
                      disabled={disabled}
                      title={t('backToBackHint')}
                      className="min-h-11 w-full text-xs"
                      onClick={() => patch(team, { own_back_to_back: !rule.own_back_to_back })}
                    >
                      {rule.own_back_to_back ? t('backToBackYes') : t('backToBackNo')}
                    </Button>
                  </TableCell>

                  {/* Blocked-date rules — summary only; edited in the detail row */}
                  <TableCell className="hidden whitespace-normal break-words text-xs lg:table-cell">
                    {rule.blocked.length === 0 ? (
                      <span className="text-gray-400 dark:text-gray-500">{t('blockedNone')}</span>
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {rule.blocked.map((b, i) => (
                          <span key={i} className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-700">
                            {blockedLabel(b)}
                          </span>
                        ))}
                      </span>
                    )}
                  </TableCell>

                  <TableCell>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-11 w-11 p-0"
                      aria-expanded={isOpen}
                      aria-label={isOpen ? t('hideDetails') : t('showDetails')}
                      onClick={() => setExpanded(isOpen ? null : key)}
                    >
                      {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </Button>
                  </TableCell>
                </TableRow>,

                isOpen ? (
                  <TableRow key={`${key}-detail`} className="bg-gray-50 dark:bg-gray-900/40">
                    <TableCell colSpan={9} className="whitespace-normal break-words">
                      <RuleDetail
                        rule={rule}
                        disabled={disabled}
                        blockedLabel={blockedLabel}
                        onPatch={(p) => patch(team, p)}
                        onDelete={async () => {
                          if (!(await confirm({ message: t('deleteRulesConfirm', { team: team.name }), danger: true }))) {
                            return
                          }
                          setExpanded(null)
                          await run(key, () => removeRule(rule.id))
                        }}
                      />
                    </TableCell>
                  </TableRow>
                ) : null,
              ]
            })}
          </TableBody>
        </Table>
      )}
    </div>
  )
}

interface DetailProps {
  rule: BasketballTeamRule
  disabled: boolean
  blockedLabel: (rule: BasketballBlockedRule) => string
  onPatch: (patch: Partial<BasketballTeamRule>) => void
  onDelete: () => Promise<void>
}

/** League window, Ferien hardness, blocked-date rules and the free-text note. */
function RuleDetail({ rule, disabled, blockedLabel, onPatch, onDelete }: DetailProps) {
  const { t } = useTranslation('basketballScheduling')
  const [note, setNote] = useState(rule.note ?? '')
  const [kind, setKind] = useState<BasketballBlockedRule['kind']>('before_date')
  const [date, setDate] = useState('')
  const [rangeEnd, setRangeEnd] = useState('')
  const [weekendBefore, setWeekendBefore] = useState(true)

  const addRule = () => {
    let next: BasketballBlockedRule | null = null
    if (kind === 'before_date' && date) next = { kind: 'before_date', date }
    else if (kind === 'date_range' && date && rangeEnd) next = { kind: 'date_range', start: date, end: rangeEnd }
    else if (kind === 'school_holidays') {
      next = { kind: 'school_holidays', canton: 'ZH', include_weekend_before: weekendBefore }
    }
    if (!next) return
    onPatch({ blocked: [...rule.blocked, next] })
    setDate('')
    setRangeEnd('')
  }

  return (
    <div className="grid gap-4 py-2 lg:grid-cols-2">
      {/* League window + Ferien hardness */}
      <div className="space-y-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium text-gray-700 dark:text-gray-200">{t('leagueLabel')}</span>
          <select
            className={`${selectClass} max-w-sm`}
            value={rule.league}
            disabled={disabled}
            onChange={(e) => onPatch({ league: e.target.value })}
          >
            {LEAGUE_CODES.map((code) => (
              <option key={code} value={code}>
                {code} · {PROBASKET_LEAGUES_2026_27[code].label}
              </option>
            ))}
          </select>
          <span className="text-gray-500 dark:text-gray-400">{t('leagueHint')}</span>
        </label>

        <div className="flex flex-col gap-1 text-xs">
          <span className="font-medium text-gray-700 dark:text-gray-200">{t('ferienLabel')}</span>
          <Button
            size="sm"
            variant={rule.ferien_hard ? 'default' : 'outline'}
            aria-pressed={rule.ferien_hard}
            disabled={disabled}
            className="min-h-11 max-w-sm text-xs"
            onClick={() => onPatch({ ferien_hard: !rule.ferien_hard })}
          >
            {rule.ferien_hard ? t('ferienHard') : t('ferienSoft')}
          </Button>
          <span className="text-gray-500 dark:text-gray-400">{t('ferienHint')}</span>
        </div>
      </div>

      {/* Blocked-date rules */}
      <div className="space-y-2">
        <span className="text-xs font-medium text-gray-700 dark:text-gray-200">{t('blockedRules')}</span>
        {rule.blocked.length === 0 ? (
          <p className="text-xs text-gray-400 dark:text-gray-500">{t('blockedNone')}</p>
        ) : (
          <ul className="space-y-1">
            {rule.blocked.map((b, i) => (
              <li key={i} className="flex items-center justify-between gap-2 rounded bg-white px-2 py-1 text-xs dark:bg-gray-800">
                <span className="whitespace-normal break-words">{blockedLabel(b)}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-11 w-11 shrink-0 p-0 text-rose-600"
                  aria-label={t('removeRule')}
                  disabled={disabled}
                  onClick={() => onPatch({ blocked: rule.blocked.filter((_, idx) => idx !== i) })}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
          <label className="flex flex-col gap-1 text-[11px] text-gray-500 dark:text-gray-400">
            {t('ruleKind')}
            <select
              className={`${selectClass} sm:w-48`}
              value={kind}
              disabled={disabled}
              onChange={(e) => setKind(e.target.value as BasketballBlockedRule['kind'])}
            >
              <option value="before_date">{t('ruleBeforeDate')}</option>
              <option value="school_holidays">{t('ruleSchoolHolidays')}</option>
              <option value="date_range">{t('ruleDateRange')}</option>
            </select>
          </label>
          {kind !== 'school_holidays' && (
            <label className="flex flex-col gap-1 text-[11px] text-gray-500 dark:text-gray-400">
              {kind === 'date_range' ? t('ruleRangeStart') : t('ruleBeforeDateValue')}
              <input
                type="date"
                className={inputClass}
                value={date}
                disabled={disabled}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
          )}
          {kind === 'date_range' && (
            <label className="flex flex-col gap-1 text-[11px] text-gray-500 dark:text-gray-400">
              {t('ruleRangeEnd')}
              <input
                type="date"
                className={inputClass}
                value={rangeEnd}
                disabled={disabled}
                onChange={(e) => setRangeEnd(e.target.value)}
              />
            </label>
          )}
          {kind === 'school_holidays' && (
            <label className="flex min-h-11 items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
              <input
                type="checkbox"
                checked={weekendBefore}
                disabled={disabled}
                onChange={(e) => setWeekendBefore(e.target.checked)}
              />
              {t('includeWeekendBefore')}
            </label>
          )}
          <Button size="sm" variant="outline" className="min-h-11" disabled={disabled} onClick={addRule}>
            <Plus className="h-4 w-4" aria-hidden /> {t('addBlockedRule')}
          </Button>
        </div>
      </div>

      {/* Note + delete */}
      <div className="space-y-1 lg:col-span-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium text-gray-700 dark:text-gray-200">{t('noteLabel')}</span>
          <textarea
            className="min-h-11 w-full rounded-md border border-border bg-transparent px-2 py-1 text-xs dark:bg-gray-800"
            rows={2}
            value={note}
            disabled={disabled}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => {
              if ((rule.note ?? '') !== note) onPatch({ note: note.trim() || null })
            }}
          />
        </label>
        <Button
          size="sm"
          variant="outline"
          className="min-h-11 text-rose-600"
          disabled={disabled}
          onClick={onDelete}
        >
          <Trash2 className="h-4 w-4" aria-hidden /> {t('deleteRules')}
        </Button>
      </div>
    </div>
  )
}
