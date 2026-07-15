import { useTranslation } from 'react-i18next'

interface ResultsTableProps {
  columns: string[]
  rows: unknown[][]
  maxHeight?: string
  /** Map of column index → (id → display label) for relation fields */
  relationLabels?: Record<number, Record<string, string>>
}

function formatCell(value: unknown, labelMap?: Record<string, string>): React.ReactNode {
  if (value === null || value === undefined)
    return <span className="text-gray-400 italic">NULL</span>
  if (typeof value === 'boolean')
    return (
      <span className={value ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
        {String(value)}
      </span>
    )
  // Format ISO datetime strings
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(value)) {
    const d = new Date(value)
    if (!isNaN(d.getTime())) {
      return (
        <span className="text-gray-500 dark:text-gray-400" title={value}>
          {d.toLocaleString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}
        </span>
      )
    }
  }
  // Resolve relation IDs to display labels
  if (labelMap) {
    const str = String(value)
    // Could be a single ID or JSON array of IDs
    if (Array.isArray(value)) {
      const labels = value.map((id) => labelMap[String(id)] || String(id))
      const display = labels.join(', ')
      if (display.length > 120) return <span title={display}>{display.slice(0, 120)}…</span>
      return display
    }
    if (labelMap[str]) {
      return <span title={str}>{labelMap[str]}</span>
    }
  }
  const str = typeof value === 'object' ? JSON.stringify(value) : String(value)
  if (str.length > 120)
    return <span title={str}>{str.slice(0, 120)}…</span>
  return str
}

export default function ResultsTable({ columns, rows, maxHeight = 'max-h-[60vh]', relationLabels }: ResultsTableProps) {
  const { t } = useTranslation('admin')

  if (columns.length === 0)
    return <p className="py-4 text-center text-sm text-gray-500 dark:text-gray-400">{t('noResults')}</p>

  return (
    <div>
      <div className={`overflow-auto rounded-lg border border-gray-200 dark:border-gray-700 ${maxHeight}`}>
        {/* Header bar with row/column counts */}
        <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
          <span>{t('resultsSummary', { rows: rows.length, cols: columns.length })}</span>
        </div>
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800">
            <tr>
              {/* Row-number gutter — sticky left so it stays visible on horizontal scroll */}
              <th
                className="sticky left-0 z-20 whitespace-nowrap border-b border-r border-gray-200 bg-gray-50 px-2 py-2 text-right font-semibold text-gray-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-500"
                aria-label="#"
              >
                #
              </th>
              {columns.map((col) => (
                <th
                  key={col}
                  className="whitespace-nowrap border-b border-gray-200 px-3 py-2 font-semibold text-gray-700 dark:border-gray-700 dark:text-gray-300"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={i}
                className={`${
                  i % 2 === 1 ? 'bg-gray-50/50 dark:bg-gray-800/30' : ''
                } hover:bg-gray-100 dark:hover:bg-gray-700/50`}
              >
                {/* Row number (1-indexed) */}
                <td className="sticky left-0 z-10 whitespace-nowrap border-r border-gray-200 bg-gray-50 px-2 py-1.5 text-right font-mono tabular-nums text-gray-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-500">
                  {i + 1}
                </td>
                {row.map((cell, j) => (
                  <td
                    key={j}
                    className="whitespace-nowrap px-3 py-1.5 font-mono text-gray-900 dark:text-gray-100"
                  >
                    {formatCell(cell, relationLabels?.[j])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
