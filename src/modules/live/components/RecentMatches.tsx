import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { readItems } from '@directus/sdk'
import { client } from '@/lib/api'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDateTimeCompactZurich } from '../../../utils/dateHelpers'
import { normaliseSport } from '../scoreboard'
import type { LiveSport } from '../types'

/**
 * Matches the scoreboard has finished, newest first — so /live is useful on a
 * quiet evening instead of showing an empty board.
 *
 * A `<Table>`, not a card stack: each row is a homogeneous record you scan
 * (CLAUDE.md → "Lists → tables, always"). The board's own result cards are the
 * live view above; this is the log.
 *
 * ⚠ This is scoreboard history, NOT the club's results — `live_history` has no
 * link to a `games` row, because the board doesn't know which fixture it is
 * showing. Worded accordingly ("recent on the scoreboard").
 */
interface HistoryRow {
  id: string
  sport: LiveSport | null
  team_a_short: string | null
  team_a_name: string | null
  team_b_short: string | null
  team_b_name: string | null
  points_a: number | null
  points_b: number | null
  sets_won_a: number | null
  sets_won_b: number | null
  set_results: Array<{ a: number; b: number }> | null
  finished_at: string | null
}

const LIMIT = 8
const n = (v: unknown) => (typeof v === 'string' ? Number(v) : (v as number)) || 0

export default function RecentMatches({ channel }: { channel: string }) {
  const { t } = useTranslation('live')
  const [rows, setRows] = useState<HistoryRow[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const data = await client.request<HistoryRow[]>(
          readItems('live_history', {
            filter: { channel: { _eq: channel } },
            // Server clock, not the board's — a board with a wrong clock must not
            // be able to reorder the list.
            sort: ['-finished_at'],
            limit: LIMIT,
          } as never),
        )
        if (!cancelled) setRows(data ?? [])
      } catch {
        // Best-effort: no collection / no permission / offline → render nothing.
        if (!cancelled) setRows([])
      }
    })()
    return () => { cancelled = true }
  }, [channel])

  if (!rows || rows.length === 0) return null

  return (
    <section className="mt-6">
      <h2 className="mb-2 text-sm font-semibold text-foreground">{t('recentTitle')}</h2>
      {/* Wide content scrolls inside its own container, never the page body. */}
      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="whitespace-normal">{t('recentMatch')}</TableHead>
              <TableHead className="whitespace-normal text-right">{t('recentResult')}</TableHead>
              <TableHead className="hidden whitespace-normal sm:table-cell">{t('recentSets')}</TableHead>
              <TableHead className="whitespace-normal text-right">{t('recentWhen')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const sport = normaliseSport(r.sport)
              const bySets = sport !== 'basketball'
              const a = r.team_a_short || r.team_a_name || '—'
              const b = r.team_b_short || r.team_b_name || '—'
              const results = Array.isArray(r.set_results) ? r.set_results : []
              return (
                <TableRow key={r.id} className="min-h-11">
                  <TableCell className="whitespace-normal break-words font-medium">
                    {a} <span className="text-muted-foreground">–</span> {b}
                  </TableCell>
                  <TableCell className="whitespace-normal text-right font-semibold tabular-nums">
                    {bySets
                      ? `${n(r.sets_won_a)}:${n(r.sets_won_b)}`
                      : `${n(r.points_a)}:${n(r.points_b)}`}
                  </TableCell>
                  <TableCell className="hidden whitespace-normal break-words text-xs tabular-nums text-muted-foreground sm:table-cell">
                    {results.map((s) => `${n(s.a)}:${n(s.b)}`).join(', ') || '—'}
                  </TableCell>
                  <TableCell className="whitespace-normal text-right text-xs tabular-nums text-muted-foreground">
                    {formatDateTimeCompactZurich(r.finished_at) || '—'}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}
