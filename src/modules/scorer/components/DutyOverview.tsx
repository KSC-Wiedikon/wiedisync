// Overview tab of /admin/scorer-assign: one row per duty SPOT (game × role)
// showing the assigned duty team and the person who signed up for it.
//
// ⚠ This reads the SAVED games, not the planner's draft — "signed up" only ever
// exists in the database (members claim duties on /scorer after roll-out). A
// draft that hasn't been rolled out is deliberately invisible here.

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Download } from 'lucide-react'
import type { Game, Member, Team } from '../../../types'
import { memberDisplayName } from '../../../utils/relations'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table'
import TeamChip from '../../../components/TeamChip'
import { formatDateCompact, formatTime, todayLocal } from '../../../utils/dateHelpers'
import { buildDutySpots, weekdayShort, type DutyRole, type DutySpot } from '../lib/dutySpots'
import { buildOverviewXlsx, buildTeamColors, downloadBytes, XLSX_MIME, type XlsxOverviewRow, type XlsxOverviewLabels } from '../lib/assignmentExport'
import { maybeReloadOnStaleChunk } from '../../../lib/chunkReload'

interface DutyOverviewProps {
  /** Season home games of the active sport (saved state, cancelled excluded). */
  games: Game[]
  teams: Team[]
  members: Member[]
  hallNameById: Map<string, string>
  sport: 'volleyball' | 'basketball'
  season: string
}

export default function DutyOverview({ games, teams, members, hallNameById, sport, season }: DutyOverviewProps) {
  const { t, i18n } = useTranslation('scorerAssign')
  // Exports are ALWAYS English, whatever the UI language (app-wide convention).
  const tEn = useMemo(() => i18n.getFixedT('en', 'scorerAssign'), [i18n])

  const [onlyEmpty, setOnlyEmpty] = useState(false)
  const [showPast, setShowPast] = useState(false)
  const [downloading, setDownloading] = useState(false)

  const today = useMemo(() => todayLocal(), [])

  const teamNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const tm of teams) m.set(String(tm.id), tm.name)
    return m
  }, [teams])
  const memberNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const mb of members) m.set(String(mb.id), memberDisplayName(mb))
    return m
  }, [members])

  // All spots in scope (date filter applied) — the denominator of the counts.
  const spots = useMemo(() => {
    const inScope = showPast ? games : games.filter((g) => g.date >= today)
    return buildDutySpots(inScope, sport, teamNameById, memberNameById)
  }, [games, showPast, today, sport, teamNameById, memberNameById])

  const openCount = useMemo(() => spots.filter((s) => !s.memberId).length, [spots])
  const visible = useMemo(() => (onlyEmpty ? spots.filter((s) => !s.memberId) : spots), [spots, onlyEmpty])

  const roleLabel = (tr: typeof t, role: DutyRole): string => {
    switch (role) {
      case 'scorer': return tr('autoScorer')
      case 'scoreboard': return tr('autoTaefeler')
      case 'scorer_scoreboard': return tr('combinedCount')
      case 'referee': return tr('refereeCount')
      case 'bb_scorer': return tr('bbScorer')
      case 'bb_timekeeper': return tr('bbTimekeeper')
      default: return tr('bb24sOfficial')
    }
  }

  // The person cell: their name, "Unknown member" when the id no longer resolves
  // (they left the club — still FILLED), or the open-slot marker.
  const personLabel = (tr: typeof t, s: DutySpot): string =>
    s.memberId ? (s.memberName ?? tr('overviewUnknownMember')) : tr('overviewOpen')

  async function handleDownload() {
    setDownloading(true)
    try {
      const rows: XlsxOverviewRow[] = visible.map((s) => ({
        gameNo: s.game.game_id ?? '',
        weekday: weekdayShort(s.game.date),
        date: formatDateCompact(s.game.date),
        time: s.game.time ? formatTime(s.game.time) : '',
        hall: hallNameById.get(String(s.game.hall)) ?? '',
        home: s.game.home_team ?? '',
        away: s.game.away_team ?? '',
        league: s.game.league ?? '',
        role: roleLabel(tEn, s.role),
        dutyTeam: s.teamName,
        person: personLabel(tEn, s),
        status: s.memberId ? tEn('overviewFilled') : tEn('overviewOpen'),
        open: !s.memberId,
      }))
      const L: XlsxOverviewLabels = {
        sheet: tEn('overviewSheet'),
        gameNo: tEn('gameNo'), weekday: tEn('weekday'), date: tEn('date'), time: tEn('time'),
        hall: tEn('hall'), home: tEn('home'), away: tEn('away'), league: tEn('league'),
        role: tEn('overviewRole'), dutyTeam: tEn('autoDutyTeam'), person: tEn('overviewPerson'),
        status: tEn('overviewStatus'),
      }
      const bytes = await buildOverviewXlsx(rows, buildTeamColors(teams.map((tm) => tm.name)), L)
      const scope = onlyEmpty ? '_open' : ''
      downloadBytes(bytes, XLSX_MIME, `kscw_duty_overview_${sport === 'volleyball' ? 'vb' : 'bb'}${scope}_${season.replace('/', '-')}.xlsx`)
    } catch (err) {
      // exceljs is a lazy chunk — after a deploy its hash rotates and a stale tab
      // imports a file that no longer exists. Reload once instead of showing a
      // bogus "export failed" (same recovery as every other lazy export).
      if (maybeReloadOnStaleChunk(err)) return
      toast.error(t('overviewDownloadError'))
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex min-h-[44px] cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <Checkbox checked={onlyEmpty} onCheckedChange={(v) => setOnlyEmpty(v === true)} />
          {t('overviewOnlyEmpty')}
        </label>
        <label className="flex min-h-[44px] cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <Checkbox checked={showPast} onCheckedChange={(v) => setShowPast(v === true)} />
          {t('overviewShowPast')}
        </label>
        <Button
          size="sm"
          variant="outline"
          onClick={handleDownload}
          loading={downloading}
          disabled={visible.length === 0}
          icon={<Download className="h-4 w-4" />}
        >
          {t('downloadXlsx')}
        </Button>
        <span className={`text-sm ${openCount ? 'font-medium text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'}`}>
          {t('overviewCounts', { open: openCount, total: spots.length })}
        </span>
      </div>

      {visible.length === 0 ? (
        <div className="mt-8 py-12 text-center text-gray-500 dark:text-gray-400">
          <p>{spots.length === 0 ? t('overviewEmpty') : t('overviewAllFilled')}</p>
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <Table className="w-full text-left text-sm">
            <TableHeader>
              <TableRow className="border-b border-gray-200 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:border-gray-700 dark:text-gray-400">
                <TableHead className="px-2 py-2">{t('date')}</TableHead>
                {/* Phones fold the matchup into the date cell — three columns
                    (when · what · who) is all that fits without side-scrolling
                    the two that matter. */}
                <TableHead className="hidden px-2 py-2 sm:table-cell">{t('overviewGame')}</TableHead>
                <TableHead className="hidden px-2 py-2 lg:table-cell">{t('league')}</TableHead>
                <TableHead className="hidden px-2 py-2 md:table-cell">{t('hall')}</TableHead>
                <TableHead className="px-2 py-2">{t('overviewRole')}</TableHead>
                {/* On a phone the team chip rides along in the Duty cell — the two
                    columns that must never scroll out of view are the duty and
                    who is on it. */}
                <TableHead className="hidden px-2 py-2 sm:table-cell">{t('autoDutyTeam')}</TableHead>
                <TableHead className="px-2 py-2">{t('overviewPerson')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((s) => {
                const isOpen = !s.memberId
                return (
                  <TableRow
                    key={`${s.game.id}-${s.role}`}
                    className={`border-b border-gray-100 dark:border-gray-700/50 ${isOpen ? 'bg-red-50 dark:bg-red-900/10' : ''}`}
                  >
                    <TableCell className="px-2 py-2 align-top text-gray-700 whitespace-normal dark:text-gray-300">
                      <div className="whitespace-nowrap"><span className="text-gray-400 dark:text-gray-500">{weekdayShort(s.game.date)}</span> {formatDateCompact(s.game.date)}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{s.game.time ? formatTime(s.game.time) : ''}</div>
                      <div className="mt-1 break-words text-xs text-gray-600 sm:hidden dark:text-gray-400">
                        <div className="font-medium text-gray-900 dark:text-gray-100">{s.game.home_team}</div>
                        <div>{s.game.away_team}</div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden px-2 py-2 align-top whitespace-normal break-words sm:table-cell">
                      <div className="font-medium text-gray-900 dark:text-gray-100">{s.game.home_team}</div>
                      <div className="text-xs text-gray-600 dark:text-gray-400">{s.game.away_team}</div>
                    </TableCell>
                    <TableCell className="hidden px-2 py-2 align-top text-gray-500 lg:table-cell dark:text-gray-400">
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs dark:bg-gray-700">{s.game.league}</span>
                    </TableCell>
                    <TableCell className="hidden whitespace-normal break-words px-2 py-2 align-top text-gray-600 md:table-cell dark:text-gray-400">
                      {hallNameById.get(String(s.game.hall)) ?? ''}
                    </TableCell>
                    <TableCell className="whitespace-normal break-words px-2 py-2 align-top text-gray-600 dark:text-gray-400">
                      {roleLabel(t, s.role)}
                      {s.teamName && <div className="mt-1 sm:hidden"><TeamChip team={s.teamName} size="sm" /></div>}
                    </TableCell>
                    <TableCell className="hidden px-2 py-2 align-top sm:table-cell">
                      {s.teamName ? <TeamChip team={s.teamName} size="sm" /> : <span className="text-gray-400 dark:text-gray-500">—</span>}
                    </TableCell>
                    <TableCell className={`whitespace-normal break-words px-2 py-2 align-top ${isOpen ? 'font-medium text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-gray-100'}`}>
                      {personLabel(t, s)}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
