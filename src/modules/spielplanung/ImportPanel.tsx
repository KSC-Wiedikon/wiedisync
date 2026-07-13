import { useState, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, FileSpreadsheet } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { toXlsx, downloadBlob } from '../admin/utils/exportResults'
import { useCollection } from '../../lib/query'
import { useMutation } from '../../hooks/useMutation'
import { useTeams } from '../../hooks/useTeams'
import { buildManualGamePayload } from './utils/manualGamePayload'
import { getSeasonYear } from '../../utils/dateUtils'
import type { Hall, ManualGameInput, Team } from '../../types'

interface ImportRow {
  Team: string
  HomeAway: string
  Opponent: string
  Date: string
  Time: string
  Hall: string
  League: string
  Round: string
}

const COLUMNS = ['Team', 'HomeAway', 'Opponent', 'Date', 'Time', 'Hall', 'League', 'Round']

function seasonLabel(date: string): string {
  const year = getSeasonYear(new Date(date + 'T00:00:00'))
  return `${year}/${year + 1}`
}

interface ParsedRow {
  input: ManualGameInput
  teamName: string
  season: string
  raw: ImportRow
  error?: string
}

function parseRow(
  row: ImportRow,
  teamByName: Map<string, Team>,
  hallByName: Map<string, Hall>,
  editableTeamIds: Set<string>,
): ParsedRow {
  const team = teamByName.get(row.Team.trim().toLowerCase())
  if (!team) return { input: {} as ManualGameInput, teamName: row.Team, season: '', raw: row, error: 'unknownTeam' }
  if (!editableTeamIds.has(String(team.id))) {
    return { input: {} as ManualGameInput, teamName: team.name, season: '', raw: row, error: 'outOfScope' }
  }
  const typeRaw = row.HomeAway.trim().toLowerCase()
  const type: 'home' | 'away' =
    typeRaw === 'home' || typeRaw === 'heim' || typeRaw === 'h' ? 'home' : 'away'
  const opponent = row.Opponent.trim()
  if (!opponent) return { input: {} as ManualGameInput, teamName: team.name, season: '', raw: row, error: 'missingOpponent' }
  if (!row.Date.trim()) return { input: {} as ManualGameInput, teamName: team.name, season: '', raw: row, error: 'missingDate' }

  let hallId: string | number | null = null
  let additionalHalls: string[] | null = null
  let awayVenue: ManualGameInput['away_hall_json'] = null
  if (type === 'home') {
    const hallKey = row.Hall.trim().toLowerCase()
    // Basketball combo aliases: "A+B", "KWI A+B", "A + B", "halle a+b", etc.
    const isComboKey = /^(kwi\s*|halle\s*kwi\s*|halle\s*)?a\s*\+\s*b$/i.test(hallKey)
    if (isComboKey && team.sport === 'basketball') {
      const kwiA = hallByName.get('kwi a')
      const kwiB = hallByName.get('kwi b')
      if (!kwiA || !kwiB) {
        return { input: {} as ManualGameInput, teamName: team.name, season: '', raw: row, error: 'unknownHall' }
      }
      hallId = kwiA.id
      additionalHalls = [String(kwiB.id)]
    } else {
      const hall = hallByName.get(hallKey)
      if (!hall) {
        return { input: {} as ManualGameInput, teamName: team.name, season: '', raw: row, error: 'unknownHall' }
      }
      hallId = hall.id
    }
  } else if (row.Hall.trim()) {
    awayVenue = { name: row.Hall.trim(), address: '', city: '', plus_code: undefined }
  }

  const input: ManualGameInput = {
    kscw_team: team.id,
    type,
    opponent,
    date: row.Date.trim(),
    time: row.Time.trim() || '16:00',
    hall: hallId,
    additional_halls: additionalHalls,
    away_hall_json: awayVenue,
    league: row.League?.trim() || '',
    round: row.Round?.trim() || '',
  }
  return { input, teamName: team.name, season: seasonLabel(input.date), raw: row }
}

interface ImportPanelProps {
  editableTeamIds: string[]
  onImported?: () => void
}

export default function ImportPanel({ editableTeamIds, onImported }: ImportPanelProps) {
  const { t } = useTranslation('spielplanung')
  const fileRef = useRef<HTMLInputElement>(null)

  const { data: teamsData } = useTeams('all')
  const { data: halls } = useCollection<Hall>('halls', { all: true, fields: ['id', 'name'] })
  const { create } = useMutation('games')

  const [preview, setPreview] = useState<ParsedRow[]>([])
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const teams = teamsData ?? []
  const editableSet = useMemo(() => new Set(editableTeamIds), [editableTeamIds])
  const teamByName = useMemo(
    () => new Map(teams.map((tm) => [tm.name.trim().toLowerCase(), tm])),
    [teams],
  )
  const hallByName = useMemo(
    () => new Map((halls ?? []).map((h) => [h.name.trim().toLowerCase(), h])),
    [halls],
  )

  const validCount = preview.filter((p) => !p.error).length
  const errorCount = preview.length - validCount

  async function handleDownloadTemplate() {
    const exampleTeam = teams.find((tm) => editableSet.has(String(tm.id)))?.name ?? 'KSCW D1'
    const exampleHall = (halls ?? [])[0]?.name ?? 'Schulhaus Buchlern'
    const exampleRows = [
      [exampleTeam, 'home', 'Goldcoast Wadenswil 1', '2026-10-05', '16:00', exampleHall, '2. Liga', 'Hinrunde'],
      [exampleTeam, 'away', 'TV Uster D2', '2026-10-12', '19:00', 'TH Grüze', '2. Liga', 'Hinrunde'],
    ]
    const blob = await toXlsx(COLUMNS, exampleRows)
    downloadBlob(blob, 'spielplanung_import_template.xlsx')
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setResult(null)
    const { readSheet } = await import('read-excel-file/browser')
    const rawRows = await readSheet(file)
    if (rawRows.length === 0) return

    const headers = rawRows[0].map((h) => String(h).trim())
    const rows: ImportRow[] = rawRows.slice(1).map((row) => {
      const obj: Record<string, string> = {}
      headers.forEach((h, i) => (obj[h] = String(row[i] ?? '')))
      return obj as unknown as ImportRow
    })

    const parsed = rows.map((r) => parseRow(r, teamByName, hallByName, editableSet))
    setPreview(parsed)
  }

  async function handleImport() {
    const valid = preview.filter((p) => !p.error)
    if (valid.length === 0) return
    setImporting(true)
    setResult(null)
    let created = 0
    let failed = 0
    for (const row of valid) {
      try {
        await create(buildManualGamePayload(row.input, row.teamName, row.season))
        created++
      } catch (err) {
        failed++
        console.error('Import row failed', row.raw, err)
      }
    }
    setResult(t('import.result', { created, failed }))
    setPreview([])
    setImporting(false)
    if (fileRef.current) fileRef.current.value = ''
    onImported?.()
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-3 flex items-center gap-2">
        <FileSpreadsheet className="h-5 w-5 text-gray-500 dark:text-gray-400" aria-hidden />
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t('import.title')}
        </h2>
      </div>

      <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">
        {t('import.hint')}
      </p>

      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls"
          onChange={handleFileChange}
          className="text-sm text-gray-700 dark:text-gray-300 file:mr-3 file:rounded-md file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-gray-700 dark:file:bg-gray-700 dark:file:text-gray-300"
        />
        <button
          type="button"
          onClick={handleDownloadTemplate}
          className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
        >
          <Download className="h-3.5 w-3.5" aria-hidden />
          {t('import.downloadTemplate')}
        </button>
      </div>

      {preview.length > 0 && (
        <>
          <div className="mb-3 max-h-80 overflow-auto rounded-md border border-gray-200 dark:border-gray-600">
            <Table className="text-xs">
              <TableHeader className="bg-gray-50 dark:bg-gray-700">
                <TableRow>
                  <TableHead className="text-gray-700 dark:text-gray-300">{t('import.col.team')}</TableHead>
                  <TableHead className="text-gray-700 dark:text-gray-300">{t('import.col.type')}</TableHead>
                  <TableHead className="text-gray-700 dark:text-gray-300">{t('import.col.opponent')}</TableHead>
                  <TableHead className="text-gray-700 dark:text-gray-300">{t('import.col.date')}</TableHead>
                  <TableHead className="text-gray-700 dark:text-gray-300">{t('import.col.time')}</TableHead>
                  <TableHead className="text-gray-700 dark:text-gray-300">{t('import.col.hall')}</TableHead>
                  <TableHead className="text-gray-700 dark:text-gray-300">{t('import.col.status')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.map((p, i) => (
                  <TableRow key={i} className={p.error ? 'bg-red-50 dark:bg-red-950/30' : ''}>
                    <TableCell className="p-1 text-gray-900 dark:text-gray-100">{p.raw.Team}</TableCell>
                    <TableCell className="p-1 text-gray-900 dark:text-gray-100">{p.raw.HomeAway}</TableCell>
                    <TableCell className="p-1 text-gray-900 dark:text-gray-100">{p.raw.Opponent}</TableCell>
                    <TableCell className="p-1 text-gray-900 dark:text-gray-100">{p.raw.Date}</TableCell>
                    <TableCell className="p-1 text-gray-900 dark:text-gray-100">{p.raw.Time}</TableCell>
                    <TableCell className="p-1 text-gray-900 dark:text-gray-100">{p.raw.Hall}</TableCell>
                    <TableCell className={`p-1 ${p.error ? 'font-medium text-red-700 dark:text-red-300' : 'text-emerald-600 dark:text-emerald-400'}`}>
                      {p.error ? t(`import.error.${p.error}`) : t('import.ok')}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleImport}
              disabled={importing || validCount === 0}
              className="rounded-md bg-gold-400 px-4 py-2 text-sm font-semibold text-brand-900 transition-colors hover:bg-gold-500 disabled:opacity-50"
            >
              {importing
                ? t('import.importing')
                : t('import.importNValid', { count: validCount })}
            </button>
            {errorCount > 0 && (
              <span className="text-xs text-red-600 dark:text-red-400">
                {t('import.nSkipped', { count: errorCount })}
              </span>
            )}
          </div>
        </>
      )}

      {result && (
        <div className="mt-3 rounded-md bg-green-50 p-3 text-sm text-green-800 dark:bg-green-900/30 dark:text-green-300">
          {result}
        </div>
      )}
    </div>
  )
}
