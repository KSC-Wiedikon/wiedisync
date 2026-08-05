import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '../../../components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table'
import { formatDateZurich } from '../../../utils/dateHelpers'
import { FRIDAY_SLOTS, SATURDAY_SLOTS, SUNDAY_SLOTS } from '../utils/probasketSeason'
import type { BasketballRuleCategory } from '../utils/basketballRules'

/**
 * The CLUB-level half of the basketball slot config (`game_scheduling_seasons
 * .bb_slot_config`, migration 278): which category may play at which fixed pitch, and
 * which weekends the club wants as Spielsamstage.
 *
 * The times are NOT stored — the json references (dow, time) pairs from the fixed grid in
 * `utils/probasketSeason.ts`, so the matrix and the grid cannot drift apart. A pitch with
 * no entry at all is offered to nobody, which is why every grid pitch is rendered here
 * even when the stored config omits it.
 */

export interface BbTimeslotRule {
  /** JS getDay: 5=Fri, 6=Sat, 0=Sun. */
  dow: number
  /** 'HH:MM' — must be one of the fixed grid times. */
  time: string
  /** The slot is meant for these categories. */
  allow: BasketballRuleCategory[]
  /** Permitted, but scored lower than an `allow` category. */
  tolerate: BasketballRuleCategory[]
}

export type BbSpielsamstagStatus = 'given' | 'desired' | 'fraglich' | 'bei_bedarf'

export interface BbSpielsamstag {
  /** 'YYYY-MM-DD'. */
  date: string
  status: BbSpielsamstagStatus
  note?: string
}

export interface BbSlotConfig {
  version?: number
  timeslots?: BbTimeslotRule[]
  spielsamstage?: BbSpielsamstag[]
}

interface Props {
  config: BbSlotConfig | null | undefined
  onUpdate: (config: BbSlotConfig) => Promise<void>
}

type CellState = 'allow' | 'tolerate' | 'off'

const CATEGORIES: BasketballRuleCategory[] = ['seniors', 'u18', 'youth']
const STATUSES: BbSpielsamstagStatus[] = ['given', 'desired', 'fraglich', 'bei_bedarf']

/** Every fixed pitch, in calendar order — the rows of the matrix. */
const GRID: { dow: number; time: string }[] = [
  ...FRIDAY_SLOTS.map((time) => ({ dow: 5, time })),
  ...SATURDAY_SLOTS.map((time) => ({ dow: 6, time })),
  ...SUNDAY_SLOTS.map((time) => ({ dow: 0, time })),
]

const DAY_KEY: Record<number, string> = { 5: 'day_fri_long', 6: 'day_sat_long', 0: 'day_sun_long' }

const selectClass =
  'min-h-11 rounded-md border border-border bg-transparent px-2 py-1 text-xs dark:bg-gray-800'

/** allow → tolerate → off → allow. One button per (pitch, category). */
function nextState(state: CellState): CellState {
  return state === 'allow' ? 'tolerate' : state === 'tolerate' ? 'off' : 'allow'
}

export default function BasketballTimeslotMatrixPanel({ config, onUpdate }: Props) {
  const { t } = useTranslation('basketballScheduling')
  const [busy, setBusy] = useState(false)
  const [newDate, setNewDate] = useState('')
  const [newStatus, setNewStatus] = useState<BbSpielsamstagStatus>('desired')

  const timeslots = useMemo(() => config?.timeslots ?? [], [config])
  const spielsamstage = useMemo(
    () => [...(config?.spielsamstage ?? [])].sort((a, b) => a.date.localeCompare(b.date)),
    [config],
  )

  const byPitch = useMemo(() => {
    const m = new Map<string, BbTimeslotRule>()
    for (const s of timeslots) m.set(`${s.dow}|${s.time}`, s)
    return m
  }, [timeslots])

  const stateOf = (dow: number, time: string, category: BasketballRuleCategory): CellState => {
    const rule = byPitch.get(`${dow}|${time}`)
    if (!rule) return 'off'
    if (rule.allow?.includes(category)) return 'allow'
    if (rule.tolerate?.includes(category)) return 'tolerate'
    return 'off'
  }

  async function save(next: BbSlotConfig) {
    setBusy(true)
    try {
      await onUpdate({ version: config?.version ?? 1, ...next })
    } catch {
      toast.error(t('saveError'))
    } finally {
      setBusy(false)
    }
  }

  function cycle(dow: number, time: string, category: BasketballRuleCategory) {
    const target = nextState(stateOf(dow, time, category))
    const others = timeslots.filter((s) => !(s.dow === dow && s.time === time))
    const current = byPitch.get(`${dow}|${time}`)
    const allow = (current?.allow ?? []).filter((c) => c !== category)
    const tolerate = (current?.tolerate ?? []).filter((c) => c !== category)
    if (target === 'allow') allow.push(category)
    if (target === 'tolerate') tolerate.push(category)
    const nextSlots = [...others, { dow, time, allow, tolerate }].sort(
      (a, b) => GRID.findIndex((g) => g.dow === a.dow && g.time === a.time)
        - GRID.findIndex((g) => g.dow === b.dow && g.time === b.time),
    )
    void save({ timeslots: nextSlots, spielsamstage })
  }

  function patchSpielsamstage(next: BbSpielsamstag[]) {
    void save({ timeslots, spielsamstage: next })
  }

  const cellClass = (state: CellState) =>
    state === 'allow'
      ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200'
      : state === 'tolerate'
        ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200'
        : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'

  return (
    <div className="space-y-6 rounded-lg border border-gray-200 bg-white p-4 sm:p-6 dark:border-gray-700 dark:bg-gray-800">
      {/* ── Timeslot → category matrix ── */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('timeslotMatrix')}</h2>
        <p className="mt-1 mb-4 max-w-3xl text-xs text-gray-500 dark:text-gray-400">{t('timeslotMatrixHint')}</p>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('colSlot')}</TableHead>
              {CATEGORIES.map((c) => (
                <TableHead key={c}>{t(`category_${c}`)}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {GRID.map(({ dow, time }) => (
              <TableRow key={`${dow}|${time}`}>
                <TableCell className="whitespace-normal break-words font-medium">
                  <span className="block">{t(DAY_KEY[dow])}</span>
                  <span className="tabular-nums text-gray-500 dark:text-gray-400">{time}</span>
                </TableCell>
                {CATEGORIES.map((c) => {
                  const state = stateOf(dow, time, c)
                  return (
                    <TableCell key={c}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => cycle(dow, time, c)}
                        title={t('cycleHint')}
                        className={`min-h-11 w-full rounded-md px-2 py-1 text-xs font-medium disabled:opacity-50 ${cellClass(state)}`}
                      >
                        {t(`matrix_${state}`)}
                      </button>
                    </TableCell>
                  )
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      {/* ── Spielsamstage ── */}
      <section>
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{t('spielsamstage')}</h3>
        <p className="mt-1 mb-3 max-w-3xl text-xs text-gray-500 dark:text-gray-400">{t('spielsamstageHint')}</p>

        {spielsamstage.length === 0 ? (
          <p className="py-2 text-sm text-gray-400 dark:text-gray-500">{t('spielsamstageEmpty')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('colDate')}</TableHead>
                <TableHead>{t('colStatus')}</TableHead>
                <TableHead className="hidden sm:table-cell">{t('colNote')}</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {spielsamstage.map((s, i) => (
                <TableRow key={`${s.date}-${i}`}>
                  <TableCell className="whitespace-normal break-words font-medium tabular-nums">
                    {formatDateZurich(s.date)}
                  </TableCell>
                  <TableCell>
                    <select
                      className={selectClass}
                      value={s.status}
                      disabled={busy}
                      aria-label={t('colStatus')}
                      onChange={(e) =>
                        patchSpielsamstage(
                          spielsamstage.map((row, idx) =>
                            idx === i ? { ...row, status: e.target.value as BbSpielsamstagStatus } : row,
                          ),
                        )
                      }
                    >
                      {STATUSES.map((st) => (
                        <option key={st} value={st}>
                          {t(`sam_${st}`)}
                        </option>
                      ))}
                    </select>
                  </TableCell>
                  <TableCell className="hidden whitespace-normal break-words text-xs text-gray-500 sm:table-cell dark:text-gray-400">
                    {s.note || '–'}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-11 w-11 p-0 text-rose-600"
                      aria-label={t('removeEntry')}
                      disabled={busy}
                      onClick={() => patchSpielsamstage(spielsamstage.filter((_, idx) => idx !== i))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex flex-col gap-1 text-[11px] text-gray-500 dark:text-gray-400">
            {t('colDate')}
            <input
              type="date"
              className={selectClass}
              value={newDate}
              disabled={busy}
              onChange={(e) => setNewDate(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-gray-500 dark:text-gray-400">
            {t('colStatus')}
            <select
              className={selectClass}
              value={newStatus}
              disabled={busy}
              onChange={(e) => setNewStatus(e.target.value as BbSpielsamstagStatus)}
            >
              {STATUSES.map((st) => (
                <option key={st} value={st}>
                  {t(`sam_${st}`)}
                </option>
              ))}
            </select>
          </label>
          <Button
            size="sm"
            variant="outline"
            className="min-h-11"
            disabled={busy || !newDate || spielsamstage.some((s) => s.date === newDate)}
            onClick={() => {
              patchSpielsamstage([...spielsamstage, { date: newDate, status: newStatus }])
              setNewDate('')
            }}
          >
            <Plus className="h-4 w-4" aria-hidden /> {t('addSpielsamstag')}
          </Button>
        </div>
      </section>
    </div>
  )
}
