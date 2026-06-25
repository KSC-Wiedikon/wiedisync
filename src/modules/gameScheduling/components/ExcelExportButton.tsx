import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { GameSchedulingBooking, GameSchedulingOpponent, GameSchedulingSeason, GameSchedulingSlot, Team } from '../../../types'
import {
  buildScheduleSections, buildScheduleXlsx, buildSchedulePdf,
  downloadBytes, exportFilename, teamHasExportableGames, XLSX_MIME, PDF_MIME,
} from '../lib/scheduleExport'

interface Props {
  bookings: GameSchedulingBooking[]
  opponents: GameSchedulingOpponent[]
  slots: GameSchedulingSlot[]
  teams: Team[]
  season: GameSchedulingSeason | null
  // When set, export only this team's games (per-team report).
  teamId?: number | string
  teamName?: string
  // Compact rendering for the per-team action row (smaller buttons, short labels).
  compact?: boolean
}

export default function ExcelExportButton({ bookings, opponents, slots, teams, season, teamId, teamName, compact }: Props) {
  const { t } = useTranslation('gameScheduling')
  // Building a report now also fetches absences, so it's no longer instant —
  // track which file is generating to disable the buttons + show progress and
  // prevent a double-click firing a second fetch storm.
  const [busy, setBusy] = useState<null | 'xlsx' | 'pdf'>(null)

  const handleExcel = async () => {
    if (busy) return
    setBusy('xlsx')
    try {
      const sections = await buildScheduleSections({ bookings, opponents, slots, teams, season, teamId })
      const bytes = await buildScheduleXlsx(sections)
      downloadBytes(bytes, XLSX_MIME, exportFilename('xlsx', teamName))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const handlePdf = async () => {
    if (busy) return
    setBusy('pdf')
    try {
      const sections = await buildScheduleSections({ bookings, opponents, slots, teams, season, teamId })
      const bytes = await buildSchedulePdf(sections)
      downloadBytes(bytes, PDF_MIME, exportFilename('pdf', teamName))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const noGames = teamId != null
    ? !teamHasExportableGames(bookings, opponents, teamId)
    : bookings.filter(b => b.status === 'confirmed' || b.status === 'pending').length === 0
  const disabled = noGames || busy !== null

  if (compact) {
    // Small outline buttons for the per-team row — sit next to "Notify coaches".
    const cls = 'inline-flex items-center gap-1.5 self-start rounded-lg border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50'
    return (
      <>
        <button
          type="button"
          onClick={handleExcel}
          disabled={disabled}
          title={t('downloadExcel')}
          className={`${cls} border-green-300 bg-green-50 text-green-700 hover:bg-green-100 dark:border-green-900 dark:bg-green-900/20 dark:text-green-300 dark:hover:bg-green-900/40`}
        >
          {busy === 'xlsx' ? '…' : t('exportExcelShort')}
        </button>
        <button
          type="button"
          onClick={handlePdf}
          disabled={disabled}
          title={t('downloadPdf')}
          className={`${cls} border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-900/20 dark:text-rose-300 dark:hover:bg-rose-900/40`}
        >
          {busy === 'pdf' ? '…' : t('exportPdfShort')}
        </button>
      </>
    )
  }

  return (
    // Stack on mobile (PDF beneath Excel) so the buttons never overflow; side by
    // side on ≥sm.
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <button
        onClick={handleExcel}
        disabled={disabled}
        className="w-full rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 sm:w-auto"
      >
        {busy === 'xlsx' ? '…' : t('downloadExcel')}
      </button>
      <button
        onClick={handlePdf}
        disabled={disabled}
        className="w-full rounded-md bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50 sm:w-auto"
      >
        {busy === 'pdf' ? '…' : t('downloadPdf')}
      </button>
    </div>
  )
}
