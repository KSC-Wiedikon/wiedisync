import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchItems } from '../../../lib/api'
import { useCollection, useCount } from '../../../lib/query'
import ResultsTable from './ResultsTable'
import SchemaViewer from './SchemaViewer'
import RecordEditModal from './RecordEditModal'

export interface CollectionInfo {
  id: string
  name: string
  type: string
  schema: SchemaField[]
}

export interface SchemaField {
  id: string
  name: string
  type: string
  required: boolean
  options: Record<string, unknown>
}

const PER_PAGE = 25

// Stable identity for "no relation columns to resolve".
const EMPTY_LABELS: Record<number, Record<string, string>> = {}

interface TableBrowserProps {
  collections: CollectionInfo[]
  loadingCollections: boolean
}

export default function TableBrowser({ collections, loadingCollections }: TableBrowserProps) {
  const { t } = useTranslation('admin')
  const [selected, setSelected] = useState('')
  const [page, setPage] = useState(1)
  const [sortField, setSortField] = useState('')
  const [sortDir, setSortDir] = useState<'+' | '-'>('+')
  const [filterText, setFilterText] = useState('')
  const [appliedFilter, setAppliedFilter] = useState('')
  const [showSchema, setShowSchema] = useState(false)
  const [editRecord, setEditRecord] = useState<Record<string, unknown> | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  const selectedCol = collections.find((c) => c.name === selected)

  // Build sort array
  const sort = sortField ? [`${sortDir}${sortField}`] : undefined

  // Parse filter string as JSON object (if provided)
  const parsedFilter = useMemo((): Record<string, unknown> | undefined => {
    if (!appliedFilter) return undefined
    try { return JSON.parse(appliedFilter) } catch { return undefined }
  }, [appliedFilter])

  // Fetch records for selected collection
  const { data: recordsRaw, isLoading, refetch } = useCollection(selected, {
    offset: (page - 1) * PER_PAGE,
    limit: PER_PAGE,
    sort,
    filter: parsedFilter,
    enabled: !!selected,
  })
  const records = recordsRaw ?? []
  // The `useCollection` above only returns the CURRENT page (limit PER_PAGE), so
  // its length can't drive pagination — it would cap totalPages at 1. Fetch the
  // real row count separately (respects the same filter + the caller's
  // permissions). Fall back to the page length until the count resolves.
  const { data: totalCount } = useCount(selected, parsedFilter, { enabled: !!selected })
  const total = totalCount ?? records.length
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE))

  // Column names for the results table
  const columns = useMemo(() => {
    if (!selectedCol) return []
    return ['id', 'created', 'updated', ...selectedCol.schema.map((f) => f.name)]
  }, [selectedCol])

  // Convert records to rows for ResultsTable
  const rows = useMemo(() => {
    return records.map((rec) => columns.map((col) => rec[col]))
  }, [records, columns])

  // ── Resolve relation fields to display labels ──
  const [resolvedLabels, setResolvedLabels] = useState<Record<number, Record<string, string>>>({})

  // Relation columns with their index in `columns`. Pure derivation — used to be
  // computed inside the effect below, whose "nothing to resolve" branches then
  // had to setRelationLabels({}) synchronously.
  const relationCols = useMemo(() => {
    const out: { colIdx: number; field: SchemaField; collectionId: string }[] = []
    if (!selectedCol || records.length === 0) return out
    for (const f of selectedCol.schema) {
      if (f.type === 'relation' && f.options?.collectionId) {
        const idx = columns.indexOf(f.name)
        if (idx >= 0) {
          out.push({ colIdx: idx, field: f, collectionId: String(f.options.collectionId) })
        }
      }
    }
    return out
  }, [selectedCol, records, columns])

  // Nothing to resolve → `{}`, same as the old effect's two reset branches.
  const relationLabels = relationCols.length === 0 ? EMPTY_LABELS : resolvedLabels

  useEffect(() => {
    if (relationCols.length === 0) return

    // Group by target collection, collecting all unique IDs
    const byCollection: Record<string, { ids: Set<string>; colIdxs: number[] }> = {}
    for (const rc of relationCols) {
      if (!byCollection[rc.collectionId]) {
        byCollection[rc.collectionId] = { ids: new Set(), colIdxs: [] }
      }
      byCollection[rc.collectionId].colIdxs.push(rc.colIdx)
      // Collect IDs from rows
      for (const row of rows) {
        const val = row[rc.colIdx]
        if (!val) continue
        if (Array.isArray(val)) {
          val.forEach((v) => { if (v) byCollection[rc.collectionId].ids.add(String(v)) })
        } else {
          byCollection[rc.collectionId].ids.add(String(val))
        }
      }
    }

    // Resolve collection names (collectionId → collectionName)
    const colIdToName: Record<string, string> = {}
    for (const c of collections) colIdToName[c.id] = c.name

    // Fetch display labels for each target collection
    let cancelled = false
    const labels: Record<number, Record<string, string>> = {}

    // Returns the resolved labels (or null if the effect was cancelled mid-flight)
    // instead of calling setState itself — the commit happens in the `.then` below.
    async function resolve() {
      for (const [colId, { ids, colIdxs }] of Object.entries(byCollection)) {
        const colName = colIdToName[colId]
        if (!colName || ids.size === 0) continue
        const idArr = [...ids]
        const idMap: Record<string, string> = {}

        // Fetch in batches of 50
        for (let i = 0; i < idArr.length; i += 50) {
          if (cancelled) return null
          const batch = idArr.slice(i, i + 50)
          try {
            const res = await fetchItems<Record<string, unknown>>(colName, {
              filter: { id: { _in: batch } },
              fields: ['*'],
              limit: 50,
            })
            for (const rec of res) {
              // Try multiple display name strategies
              const label =
                [rec.last_name, rec.nickname || rec.first_name].filter(Boolean).join(' ') ||
                rec.full_name ||
                rec.name ||
                rec.title ||
                rec.email ||
                rec.id
              idMap[String(rec.id)] = String(label)
            }
          } catch {
            // Collection might not have those fields, fall back to id
          }
        }
        for (const idx of colIdxs) {
          labels[idx] = idMap
        }
      }
      return labels
    }

    resolve().then((result) => { if (!cancelled && result) setResolvedLabels(result) })
    return () => { cancelled = true }
  }, [relationCols, rows, collections])

  // Group collections by type
  //
  // The three keys are Directus's own lowercase codes, and they used to reach
  // the sidebar as raw text shouted into capitals by a CSS class. With the
  // shouting gone they need real labels — a bare `auth` heading is a stored code
  // on screen, which is the one thing the sentence-case rule is about.
  const COLLECTION_TYPE_LABEL: Record<string, string> = {
    auth: 'Directus system',
    base: 'Club data',
    view: 'Views',
  }
  const grouped = useMemo(() => {
    const groups: Record<string, CollectionInfo[]> = { auth: [], base: [], view: [] }
    for (const col of collections) {
      const key = col.type in groups ? col.type : 'base'
      groups[key].push(col)
    }
    return groups
  }, [collections])

  const handleSelectCollection = (name: string) => {
    setSelected(name)
    setPage(1)
    setFilterText('')
    setAppliedFilter('')
    setSortField('')
    setSortDir('+')
    setShowSchema(false)
  }

  const handleApplyFilter = () => {
    setAppliedFilter(filterText)
    setPage(1)
  }

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDir((d) => (d === '+' ? '-' : '+'))
    } else {
      setSortField(field)
      setSortDir('+')
    }
    setPage(1)
  }

  return (
    <div className="flex flex-col gap-4 sm:flex-row">
      {/* ── Collection list (sidebar on desktop, select on mobile) ── */}
      <div className="shrink-0 sm:w-48">
        {/* Mobile: select dropdown */}
        <select
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 sm:hidden"
          value={selected}
          onChange={(e) => handleSelectCollection(e.target.value)}
        >
          <option value="">{t('selectTable')}</option>
          {collections.map((c) => (
            <option key={c.id} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>

        {/* Desktop: sidebar */}
        <div className="hidden max-h-[calc(100vh-14rem)] overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 sm:block">
          {loadingCollections ? (
            <p className="p-3 text-sm text-gray-500">...</p>
          ) : (
            Object.entries(grouped).map(
              ([type, cols]) =>
                cols.length > 0 && (
                  <div key={COLLECTION_TYPE_LABEL[type] ?? type}>
                    <p className="sticky top-0 bg-gray-50 px-3 py-1.5 text-[10px] font-bold tracking-wide text-gray-400 dark:bg-gray-800 dark:text-gray-500">
                      {type}
                    </p>
                    {cols.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => handleSelectCollection(c.name)}
                        className={`block w-full truncate px-3 py-1.5 text-left text-xs ${
                          selected === c.name
                            ? 'bg-brand-50 font-medium text-brand-700 dark:bg-brand-900/30 dark:text-brand-400'
                            : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
                        }`}
                      >
                        {c.name}
                      </button>
                    ))}
                  </div>
                ),
            )
          )}
        </div>
      </div>

      {/* ── Main content area ── */}
      <div className="min-w-0 flex-1">
        {!selected ? (
          <p className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
            {t('selectTable')}
          </p>
        ) : (
          <div className="space-y-3">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{selected}</h2>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowSchema(!showSchema)}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
                >
                  {t('schema')}
                </button>
                <button
                  onClick={() => setShowCreate(true)}
                  className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-600"
                >
                  {t('newRecord')}
                </button>
              </div>
            </div>

            {/* Schema (collapsible) */}
            {showSchema && selectedCol && (
              <SchemaViewer schema={selectedCol.schema} collectionType={selectedCol.type} />
            )}

            {/* Filter bar */}
            <div className="flex gap-2">
              <input
                type="text"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleApplyFilter()
                }}
                placeholder={t('filterPlaceholder')}
                className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              />
              <button
                onClick={handleApplyFilter}
                className="rounded-lg bg-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-300 dark:bg-gray-600 dark:text-gray-200 dark:hover:bg-gray-500"
              >
                {t('filter')}
              </button>
            </div>

            {/* Sortable column headers */}
            {columns.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {columns.map((col) => (
                  <button
                    key={col}
                    onClick={() => handleSort(col)}
                    className={`rounded px-2 py-0.5 text-[10px] font-medium ${
                      sortField === col
                        ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-400 dark:hover:bg-gray-600'
                    }`}
                  >
                    {col}
                    {sortField === col && (sortDir === '+' ? ' ↑' : ' ↓')}
                  </button>
                ))}
              </div>
            )}

            {/* Data */}
            {isLoading ? (
              <p className="py-4 text-center text-sm text-gray-500">...</p>
            ) : records.length === 0 ? (
              <p className="py-4 text-center text-sm text-gray-500 dark:text-gray-400">
                {t('noRecords')}
              </p>
            ) : (
              <div
                className="cursor-pointer"
                onClick={(e) => {
                  // Find which row was clicked
                  const target = e.target as HTMLElement
                  const row = target.closest('tr')
                  if (!row || row.closest('thead')) return
                  const idx = Array.from(row.parentElement?.children ?? []).indexOf(row)
                  if (idx >= 0 && records[idx]) {
                    setEditRecord(records[idx] as never)
                  }
                }}
              >
                <ResultsTable columns={columns} rows={rows} relationLabels={relationLabels} />
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-40 dark:text-gray-400 dark:hover:bg-gray-700"
                >
                  ←
                </button>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {page} / {totalPages} ({total})
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-40 dark:text-gray-400 dark:hover:bg-gray-700"
                >
                  →
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Record edit modal */}
      {selectedCol && (
        <>
          <RecordEditModal
            open={!!editRecord}
            onClose={() => setEditRecord(null)}
            collection={selected}
            schema={selectedCol.schema}
            record={editRecord}
            onSaved={refetch}
          />
          <RecordEditModal
            open={showCreate}
            onClose={() => setShowCreate(false)}
            collection={selected}
            schema={selectedCol.schema}
            record={null}
            onSaved={refetch}
          />
        </>
      )}
    </div>
  )
}
