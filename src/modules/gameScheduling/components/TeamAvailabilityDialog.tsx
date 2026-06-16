import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { kscwApi } from '../../../lib/api'
import { Badge } from '../../../components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../../components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table'
import { formatDateZurich } from '../../../utils/dateHelpers'
import { gameStartForDate } from '../utils/slotTime'

/** One offerable home slot from /terminplanung/admin/team-availability. */
interface AvailabilitySlot {
  id: number
  date: string
  start_time: string
  end_time: string
  source: string
  hall_id: number | null
  hall_name: string
  abs_count: number
  strict: boolean
}

interface TeamAvailability {
  team: { id: number | string; name: string }
  slots: AvailabilitySlot[]
  blocked_away_strict: string[]
  blocked_away_loose: string[]
  season_window: { start: string; end: string } | null
  saturday: { cap: number | null; used: number; away_used?: number; no_saturday: boolean }
}

interface Props {
  kscwTeamId: string
  kscwTeamName: string
  seasonId: string
  seasonName: string
}

/** Localized short weekday for a YYYY-MM-DD date (UTC-anchored, day-stable). */
function weekdayShort(ymd: string, lang: string): string {
  const d = new Date(`${ymd}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat(lang, { weekday: 'short', timeZone: 'UTC' }).format(d)
}

/** Merge sorted YYYY-MM-DD dates into compact dd.mm.yyyy ranges for prose. */
function mergeDateRanges(dates: string[]): string[] {
  const out: string[] = []
  let start: string | null = null
  let prev: string | null = null
  const flush = () => {
    if (!start || !prev) return
    out.push(start === prev
      ? formatDateZurich(start)
      : `${formatDateZurich(start)} – ${formatDateZurich(prev)}`)
  }
  for (const d of dates) {
    if (prev) {
      const followUp: Date = new Date(`${prev}T00:00:00Z`)
      followUp.setUTCDate(followUp.getUTCDate() + 1)
      if (followUp.toISOString().slice(0, 10) === d) { prev = d; continue }
      flush()
    }
    start = d
    prev = d
  }
  flush()
  return out
}

/** Per-team "Available slots" button + dialog: every still-offerable home slot
 *  (strict vs 3rd-pick-only) plus the away blocked dates — with copy-as-text
 *  (for pasting into an opponent email) and CSV download. */
export default function TeamAvailabilityDialog({ kscwTeamId, kscwTeamName, seasonId, seasonName }: Props) {
  const { t, i18n } = useTranslation('gameScheduling')
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<TeamAvailability | null>(null)
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const resp = await kscwApi(`/terminplanung/admin/team-availability?kscw_team=${kscwTeamId}&season=${seasonId}`) as TeamAvailability
      setData(resp)
    } catch {
      toast.error(t('availabilityLoadError'))
      setOpen(false)
    } finally {
      setLoading(false)
    }
  }

  const handleOpen = () => {
    setOpen(true)
    if (!data) void load()
  }

  const slotLine = (s: AvailabilitySlot) =>
    `${weekdayShort(s.date, i18n.language)} ${formatDateZurich(s.date)}, ${gameStartForDate(s.date, s.start_time)}, ${s.hall_name}${s.strict ? '' : ` (${t('availTextThird')})`}`

  const buildText = () => {
    if (!data) return ''
    const lines: string[] = []
    lines.push(t('availTextHome', { team: `KSC Wiedikon ${kscwTeamName}`, season: seasonName }))
    lines.push('')
    if (data.slots.length === 0) {
      lines.push(t('noAvailableSlots'))
    } else {
      for (const s of data.slots) lines.push(slotLine(s))
    }
    lines.push('')
    lines.push(t('availTextAwayBlocked'))
    lines.push(mergeDateRanges(data.blocked_away_strict).join(', '))
    return lines.join('\n')
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(buildText())
      toast.success(t('copiedToClipboard'))
    } catch {
      toast.error(t('availabilityLoadError'))
    }
  }

  const handleCsv = () => {
    if (!data) return
    const esc = (v: string) => /[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
    const rows: string[] = ['Date,Day,Time,Hall,Pick,Source']
    for (const s of data.slots) {
      rows.push([
        formatDateZurich(s.date),
        weekdayShort(s.date, i18n.language),
        gameStartForDate(s.date, s.start_time),
        s.hall_name,
        s.strict ? t('pickAnyLabel') : t('pickThirdLabel'),
        s.source,
      ].map(esc).join(','))
    }
    rows.push('')
    rows.push(esc(t('availTextAwayBlocked')))
    for (const r of mergeDateRanges(data.blocked_away_strict)) rows.push(esc(r))
    // ﻿ BOM so Excel opens the umlauts correctly.
    const blob = new Blob([`﻿${rows.join('\n')}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `kscw-${kscwTeamName.toLowerCase().replace(/\s+/g, '-')}-slots.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="inline-flex items-center gap-1.5 self-start rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
      >
        {t('availableSlots')}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('availableSlotsTitle', { team: kscwTeamName })}</DialogTitle>
            <DialogDescription>{t('availableSlotsHint')}</DialogDescription>
          </DialogHeader>

          {loading && <p className="text-sm text-gray-500 dark:text-gray-400">…</p>}

          {!loading && data && (
            <div className="max-h-[60vh] space-y-4 overflow-y-auto">
              {data.saturday.no_saturday && (
                <p className="text-xs text-amber-600 dark:text-amber-400">{t('availabilityNoSaturday')}</p>
              )}
              {!data.saturday.no_saturday && data.saturday.cap != null && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t('availabilitySaturdayCap', { used: data.saturday.used, cap: data.saturday.cap })}
                </p>
              )}
              {typeof data.saturday.away_used === 'number' && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t('availabilitySaturdayAway', { n: data.saturday.away_used })}
                </p>
              )}

              {data.slots.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">{t('noAvailableSlots')}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('availColDate')}</TableHead>
                      <TableHead>{t('availColTime')}</TableHead>
                      <TableHead>{t('availColHall')}</TableHead>
                      <TableHead>{t('availColPick')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.slots.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="whitespace-nowrap font-medium">
                          {weekdayShort(s.date, i18n.language)} {formatDateZurich(s.date)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{gameStartForDate(s.date, s.start_time)}</TableCell>
                        <TableCell className="whitespace-normal break-words">{s.hall_name}</TableCell>
                        <TableCell>
                          {s.strict
                            ? <Badge variant="success" size="sm">{t('pickAnyLabel')}</Badge>
                            : <Badge variant="warning" size="sm" title={s.abs_count > 0 ? t('availAbsenceHint', { count: s.abs_count }) : undefined}>{t('pickThirdLabel')}</Badge>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}

              <div>
                <h4 className="mb-1 text-sm font-medium text-gray-700 dark:text-gray-300">{t('awayBlockedTitle')}</h4>
                <p className="mb-1 text-xs text-gray-500 dark:text-gray-400">{t('awayBlockedHint')}</p>
                <p className="text-sm break-words text-gray-700 dark:text-gray-300">
                  {mergeDateRanges(data.blocked_away_strict).join(', ') || '—'}
                </p>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <button
              type="button"
              onClick={handleCopy}
              disabled={!data}
              className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              {t('copyAsText')}
            </button>
            <button
              type="button"
              onClick={handleCsv}
              disabled={!data}
              className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              {t('downloadCsv')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
