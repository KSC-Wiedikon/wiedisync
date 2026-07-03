import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Download } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table'
import { createRecord, fetchAllItems } from '../../../lib/api'
import { toXlsx, downloadBlob } from '../../admin/utils/exportResults'
import type { Team } from '../../../types'

const normalizeTeam = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

interface ImportRow {
  Datum: string
  Heimteam: string
  Gastteam: string
  Liga: string
  Runde: string
}

export default function ExcelImportPanel() {
  const { t } = useTranslation('gameScheduling')
  const fileRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<ImportRow[]>([])
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [teams, setTeams] = useState<Team[]>([])

  useEffect(() => {
    fetchAllItems<Team>('teams', {
      filter: { sport: { _eq: 'volleyball' }, active: { _eq: true } },
      fields: ['id', 'name', 'full_name'],
    })
      .then(setTeams)
      .catch(() => {})
  }, [])

  // Match an Excel team cell ("KSCW H2", "KSC Wiedikon H2", "H2", …) to a KSCW team.
  const resolveKscw = (side: string): Team | null => {
    const n = normalizeTeam(side)
    if (!n) return null
    for (const tm of teams) {
      const cands = [
        normalizeTeam(`KSCW ${tm.name}`),
        normalizeTeam(`KSC Wiedikon ${tm.name}`),
        normalizeTeam(tm.full_name || ''),
        normalizeTeam(tm.name),
      ]
      if (cands.includes(n)) return tm
    }
    // Looser fallback: a "KSCW…"/"KSC Wiedikon…" cell ending in the short name.
    for (const tm of teams) {
      const tn = normalizeTeam(tm.name)
      if (tn && (n.startsWith('kscw') || n.startsWith('kscwiedikon')) && n.endsWith(tn)) return tm
    }
    return null
  }

  async function handleDownloadTemplate() {
    const columns = ['Datum', 'Heimteam', 'Gastteam', 'Liga', 'Runde']
    const exampleRows = [
      ['2026-10-05', 'KSCW H2', 'VBC Zürich H3', '3. Liga', 'Hinrunde'],
      ['2026-10-12', 'KSCW D1', 'TV Uster D2', '2. Liga', 'Hinrunde'],
    ]
    const blob = await toXlsx(columns, exampleRows)
    downloadBlob(blob, 'game_import_template.xlsx')
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const { readSheet } = await import('read-excel-file/browser')
    const rawRows = await readSheet(file)
    if (rawRows.length === 0) return
    const headers = rawRows[0].map((h) => String(h).trim())
    const rows = rawRows.slice(1).map((row) => {
      const obj: Record<string, string> = {}
      headers.forEach((h, i) => (obj[h] = String(row[i] ?? '')))
      return obj as unknown as ImportRow
    })
    setPreview(rows.slice(0, 20))
    setResult(null)
  }

  const handleImport = async () => {
    if (preview.length === 0) return
    setImporting(true)
    setResult(null)

    let created = 0
    let unmatched = 0
    for (const row of preview) {
      const homeT = resolveKscw(row.Heimteam)
      const awayT = resolveKscw(row.Gastteam)
      const kscw = homeT || awayT
      if (!kscw) unmatched++
      try {
        await createRecord('games', {
          date: row.Datum,
          home_team: row.Heimteam,
          away_team: row.Gastteam,
          kscw_team: kscw ? kscw.id : null,
          type: homeT ? 'home' : awayT ? 'away' : null,
          league: row.Liga || '',
          round: row.Runde || '',
          status: 'scheduled',
          source: 'manual',
          time: '',
        })
        created++
      } catch (err) {
        console.error('Failed to import row:', row, err)
      }
    }

    setResult(
      t('importSuccess', { count: created }) +
        (unmatched ? ` · ${unmatched} ${t('importUnlinked', { defaultValue: 'without a KSCW team match' })}` : ''),
    )
    setPreview([])
    setImporting(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">{t('excelImport')}</h2>

      <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">
        {t('importColumnsHint')}
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
          className="flex items-center gap-1.5 min-h-11 py-2 self-start sm:min-h-0 sm:py-0 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
        >
          <Download className="h-3.5 w-3.5" />
          {t('downloadTemplate')}
        </button>
      </div>

      {preview.length > 0 && (
        <>
          <div className="mb-3 max-h-60 overflow-auto rounded-md border border-gray-200 dark:border-gray-600">
            <Table>
              <TableHeader className="bg-gray-50 dark:bg-gray-700">
                <TableRow>
                  <TableHead className="text-gray-700 dark:text-gray-300">Datum</TableHead>
                  <TableHead className="text-gray-700 dark:text-gray-300">Heim</TableHead>
                  <TableHead className="text-gray-700 dark:text-gray-300">Gast</TableHead>
                  <TableHead className="text-gray-700 dark:text-gray-300">Liga</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.map((row, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-gray-900 dark:text-gray-100">{row.Datum}</TableCell>
                    <TableCell className="text-gray-900 dark:text-gray-100">{row.Heimteam}</TableCell>
                    <TableCell className="text-gray-900 dark:text-gray-100">{row.Gastteam}</TableCell>
                    <TableCell className="text-gray-500 dark:text-gray-400">{row.Liga}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <button
            onClick={handleImport}
            disabled={importing}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 min-h-11 w-full sm:w-auto sm:min-h-0"
          >
            {importing ? '...' : t('importGames') + ` (${preview.length})`}
          </button>
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
