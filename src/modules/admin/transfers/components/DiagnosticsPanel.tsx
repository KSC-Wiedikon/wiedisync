import { useTranslation } from 'react-i18next'
import { RadioTower, ShieldCheck } from 'lucide-react'
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '../../../../components/ui/card'
import { Table, TableBody, TableCell, TableRow } from '../../../../components/ui/table'
import { Button } from '../../../../components/ui/button'
import { formatDateTimeCompact } from '../../../../utils/dateHelpers'
import { FooConflictTable } from './FooConflictTable'
import type { FooConflict, HiddenCounts, TransferMember, TransferStatus } from '../types'

/**
 * Everything that is ABOUT the worklist rather than on it: the register
 * disagreements, who this page does not show and why, the settled tally, and the
 * one control that goes and asks FIVB.
 *
 * ⚠ Moving these behind a tab is only acceptable because the Diagnostics tab
 * label carries their total — a filter must never silently swallow a transfer,
 * which is the whole reason the hidden tallies exist. They are countable from
 * outside twice over: the tab badge, and the muted summary line under the page
 * header.
 */
export function DiagnosticsPanel({
  conflicts, hidden, u20Count, settledCount, swissCount, lastVisCheck,
  canRunVisCheck, visRunning, onRunVisCheck, savingId, onSetStatus, onShowInWorklist,
}: {
  conflicts: readonly FooConflict[]
  hidden: HiddenCounts
  u20Count: number
  settledCount: number
  swissCount: number
  lastVisCheck: string | null
  canRunVisCheck: boolean
  visRunning: boolean
  onRunVisCheck: () => void
  savingId: string | null
  onSetStatus: (m: TransferMember, next: TransferStatus | null) => void
  onShowInWorklist: (m: TransferMember) => void
}) {
  const { t } = useTranslation('admin')

  /**
   * ⚠ FOUR separate reasons, never one merged tally, and each row is omitted at
   * 0. They mean different things and lead to different actions: "on no team" is
   * a data gap to fix (give them a team and they reappear), "guest only" is the
   * correct answer (guests hold no licence, so no transfer applies),
   * "basketball" is a whole sport this page does not cover, and the U20
   * exemption is per TEAM — a player who also plays 2. Liga still needs the
   * transfer for that licence.
   */
  const hiddenRows = [
    { key: 'noTeam', count: hidden.noTeam, text: t('trHiddenNoTeam', { count: hidden.noTeam }) },
    { key: 'guestOnly', count: hidden.guestOnly, text: t('trHiddenGuests', { count: hidden.guestOnly }) },
    { key: 'basketball', count: hidden.basketball, text: t('trHiddenBasketball', { count: hidden.basketball }) },
    { key: 'u20', count: u20Count, text: t('trHiddenU20', { count: u20Count }) },
  ].filter((row) => row.count > 0)

  return (
    <div className="space-y-4">
      {/* Reported, never applied — see FooConflictTable. Renders nothing when
          the two registers agree. */}
      <FooConflictTable
        conflicts={conflicts}
        savingId={savingId}
        onSetStatus={onSetStatus}
        onShowInWorklist={onShowInWorklist}
      />

      {hiddenRows.length > 0 && (
        <Card>
          <CardHeader className="p-4">
            <CardTitle className="text-sm">{t('trDiagHiddenTitle')}</CardTitle>
            <CardDescription className="text-xs">{t('trDiagHiddenDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <Table>
              <TableBody>
                {hiddenRows.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell className="text-xs text-gray-600 dark:text-gray-300">
                      {row.text}
                    </TableCell>
                    <TableCell className="w-16 text-right text-sm font-medium tabular-nums">
                      {row.count}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="p-4">
          <CardTitle className="text-sm">{t('trDiagSettledTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {/* ⚠ Deliberately the TOTAL of both settled cohorts — the members whose
              federation answer already settles it, PLUS the Swiss group that has
              a tab of its own. The claim is "these many members need no
              transfer", and dropping the Swiss ones because they are also listed
              elsewhere would make it false. This is where that apparent
              double-count is finally explained, next to the number it explains. */}
          <p className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-200">
            <ShieldCheck className="h-4 w-4 shrink-0 text-green-600 dark:text-green-400" aria-hidden="true" />
            {t('trSettledCount', { count: settledCount + swissCount })}
          </p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {t('trSettledDescription')}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4">
          <CardTitle className="text-sm">{t('trDiagVisTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {/* The timestamp and the control that changes it, in one place. The
              monthly cron used to be the only writer of `in_vis`, so for 30 days
              of every 31 this page was frozen and the header's Refresh — a plain
              refetch of `members` — could not move it however often it was
              pressed. */}
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {lastVisCheck
              ? t('trVisLastChecked', { date: formatDateTimeCompact(lastVisCheck) })
              : t('trVisNeverChecked')}
          </p>
          {/* ⚠ `canRunVisCheck` is narrower than page read access — a basketball
              admin can read this page but the VIS endpoint 403s them — so the
              control is hidden rather than offered and refused. The timestamp
              above stays visible either way. */}
          {canRunVisCheck && (
            <>
              <Button
                size="sm"
                className="mt-2 min-h-[44px] sm:min-h-0"
                onClick={onRunVisCheck}
                disabled={visRunning}
                aria-busy={visRunning}
                icon={<RadioTower className={visRunning ? 'animate-pulse' : ''} aria-hidden="true" />}
              >
                {visRunning ? t('trVisCheckRunning') : t('trVisCheckNow')}
              </Button>
              {/* Visible text, not a `title=`: it is the sentence that says this
                  button asks FIVB while Refresh only re-reads the database, and a
                  `title=` is unreachable on touch. */}
              <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                {t('trVisCheckHint')}
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
