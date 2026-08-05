import { useCallback, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Download } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { Button } from '../../components/ui/button'
import { Badge } from '../../components/ui/badge'
import { Switch } from '../../components/ui/switch'
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '../../components/ui/table'
import ImageLightbox from '../../components/ImageLightbox'
import { formatRelativeTimeZurich, formatDateZurich, formatDateTimeCompact } from '../../utils/dateHelpers'
import { useHallenfinder, type HallenfinderFilters, type HallResult } from './useHallenfinder'
import {
  buildHallenfinderXlsx, downloadBytes, XLSX_MIME, type HallenfinderXlsxLabels,
} from './hallenfinderExport'

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7]
const START_OPTIONS = ['18:00', '18:30', '19:00', '19:30', '20:00', '20:30']
const DURATION_OPTIONS = [60, 90, 120, 150, 180] // minutes
const DISTRICTS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']
const HALL_TYPES = ['sporthalle', 'gymnastikraum', 'dreifachhalle', 'doppelhalle']

const selectClass =
  'h-9 rounded-md border border-input bg-transparent px-2 text-sm dark:bg-gray-800'

// The size column prints the city's own string verbatim (L x B x H, Swiss
// decimal comma) — no reformatting and no derived "fits a court" verdict.

export default function HallenfinderPage() {
  const { t, i18n } = useTranslation('hallenfinder')
  const { isAdmin, isCoach, isVorstand, teamResponsibleIds } = useAuth()

  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5])
  const [startFrom, setStartFrom] = useState('18:00')
  const [minMinutes, setMinMinutes] = useState(90)
  const [district, setDistrict] = useState<string | null>(null)
  const [hallType, setHallType] = useState<string | null>(null)
  const [freeAll, setFreeAll] = useState(true)
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null)

  // Memoised so it is a stable dependency of the export callback below — and
  // so the query key stops being a fresh object on every keystroke.
  const filters: HallenfinderFilters = useMemo(() => ({
    weekdays, startFrom, minMinutes, district, hallType, freeAllNonHolidayWeeks: freeAll,
  }), [weekdays, startFrom, minMinutes, district, hallType, freeAll])
  const { data, isLoading, isError } = useHallenfinder(filters)

  const [exporting, setExporting] = useState(false)

  /**
   * Excel of the CURRENT result set. Deliberately exports what is on screen
   * rather than re-querying unfiltered: the filters are the user's question,
   * and they travel with the file on its own sheet so the numbers stay
   * interpretable once it has been mailed on.
   *
   * ⚠ Declared above the authorisation early-return — a hook after a
   * conditional return is a hook-order violation.
   */
  const exportXlsx = useCallback(async () => {
    const rows = data?.results ?? []
    if (!rows.length) return
    setExporting(true)
    try {
      // English-only workbook, per the app-wide export convention.
      const tEn = i18n.getFixedT('en', 'hallenfinder')
      const L: HallenfinderXlsxLabels = {
        sheetHalls: tEn('xlsx.sheetHalls'), sheetCourts: tEn('xlsx.sheetCourts'), sheetSearch: tEn('xlsx.sheetSearch'),
        day: tEn('xlsx.day'), hall: tEn('xlsx.hall'), type: tEn('xlsx.type'), window: tEn('xlsx.window'),
        weeksFree: tEn('xlsx.weeksFree'), weeksTotal: tEn('xlsx.weeksTotal'), everyWeek: tEn('xlsx.everyWeek'),
        size: tEn('xlsx.size'), lengthM: tEn('xlsx.lengthM'), widthM: tEn('xlsx.widthM'), heightM: tEn('xlsx.heightM'),
        courts: tEn('xlsx.courts'), district: tEn('xlsx.district'), quarter: tEn('xlsx.quarter'),
        schoolDistrict: tEn('xlsx.schoolDistrict'), address: tEn('xlsx.address'), plz: tEn('xlsx.plz'),
        contact: tEn('xlsx.contact'), calendar: tEn('xlsx.calendar'), booking: tEn('xlsx.booking'),
        court: tEn('xlsx.court'), segment: tEn('xlsx.segment'),
        criterion: tEn('xlsx.criterion'), value: tEn('xlsx.value'),
        weekdays: tEn('xlsx.weekdays'), startFrom: tEn('xlsx.startFrom'), minDuration: tEn('xlsx.minDuration'),
        hallType: tEn('xlsx.hallType'), onlyEveryWeek: tEn('xlsx.onlyEveryWeek'),
        season: tEn('xlsx.season'), dataUpdated: tEn('xlsx.dataUpdated'), exported: tEn('xlsx.exported'),
        resultCount: tEn('xlsx.resultCount'),
        any: tEn('xlsx.any'), yes: tEn('xlsx.yes'), no: tEn('xlsx.no'),
        weekdayNames: Object.fromEntries(WEEKDAYS.map((d) => [d, tEn(`weekday.${d}`)])),
        typeNames: Object.fromEntries(HALL_TYPES.map((h) => [h, tEn(`type.${h}`)])),
      }
      const now = new Date()
      const bytes = await buildHallenfinderXlsx(rows, {
        filters,
        season: data?.season ?? null,
        lastUpdated: data?.lastUpdated ?? null,
        exportedAt: formatDateTimeCompact(now.toISOString()),
        formatDate: formatDateZurich,
      }, L)
      // ISO in the FILENAME on purpose — it sorts chronologically in a folder,
      // which dd.mm.yyyy does not. Everything inside the file is Swiss format.
      downloadBytes(bytes, XLSX_MIME, `kscw_hallenfinder_${now.toISOString().slice(0, 10)}.xlsx`)
      toast.success(t('exportDone', { count: rows.length }))
    } catch {
      toast.error(t('exportFailed'))
    } finally {
      setExporting(false)
    }
  }, [data, filters, i18n, t])

  const authorized = isAdmin || isCoach || isVorstand || teamResponsibleIds.length > 0
  if (!authorized) return <Navigate to="/" replace />

  const toggleWeekday = (d: number) =>
    setWeekdays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()))

  const durationLabel = (min: number) => t('durationOption', { h: min % 60 === 0 ? min / 60 : (min / 60).toFixed(1) })
  const results = data?.results ?? []
  const noData = data?.note === 'not-yet-scraped' || (data && !data.season)

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <header className="mb-4">
        <h1 className="text-2xl font-bold text-foreground">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t('intro')}</p>
        {data?.lastUpdated && (
          <Badge variant="secondary" className="mt-2">
            {t('lastUpdated', { ago: formatRelativeTimeZurich(data.lastUpdated) })}
          </Badge>
        )}
      </header>

      {/* Filters */}
      <div className="mb-4 flex flex-col gap-3 rounded-lg border border-border bg-card p-3">
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-sm text-muted-foreground">{t('filters.weekday')}:</span>
          {WEEKDAYS.map((d) => (
            <Button
              key={d}
              type="button"
              size="sm"
              variant={weekdays.includes(d) ? 'default' : 'outline'}
              onClick={() => toggleWeekday(d)}
              aria-pressed={weekdays.includes(d)}
            >
              {t(`weekdayShort.${d}`)}
            </Button>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t('filters.startFrom')}
            <select className={selectClass} value={startFrom} onChange={(e) => setStartFrom(e.target.value)}>
              {START_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t('filters.minDuration')}
            <select className={selectClass} value={minMinutes} onChange={(e) => setMinMinutes(Number(e.target.value))}>
              {DURATION_OPTIONS.map((m) => <option key={m} value={m}>{durationLabel(m)}</option>)}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t('filters.district')}
            <select className={selectClass} value={district ?? ''} onChange={(e) => setDistrict(e.target.value || null)}>
              <option value="">{t('filters.allDistricts')}</option>
              {DISTRICTS.map((d) => <option key={d} value={d}>{`Kreis ${d}`}</option>)}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t('filters.hallType')}
            <select className={selectClass} value={hallType ?? ''} onChange={(e) => setHallType(e.target.value || null)}>
              <option value="">{t('filters.allTypes')}</option>
              {HALL_TYPES.map((h) => <option key={h} value={h}>{t(`type.${h}`)}</option>)}
            </select>
          </label>

          <label className="flex items-center gap-2 text-sm text-foreground">
            <Switch checked={freeAll} onCheckedChange={setFreeAll} />
            {t('filters.freeAllWeeks')}
          </label>
        </div>
      </div>

      {/* Results */}
      {isLoading && <p className="py-8 text-center text-sm text-muted-foreground">{t('loading')}</p>}
      {isError && <p className="py-8 text-center text-sm text-destructive">{t('error')}</p>}
      {!isLoading && !isError && noData && (
        <p className="py-8 text-center text-sm text-muted-foreground">{t('noData')}</p>
      )}
      {!isLoading && !isError && !noData && results.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">{t('noResults')}</p>
      )}

      {!isLoading && !isError && results.length > 0 && (
        <>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">{t('resultCount', { count: results.length })}</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => { void exportXlsx() }}
              disabled={exporting}
              aria-busy={exporting}
              className="min-h-[44px] sm:min-h-0"
            >
              <Download className={`mr-1.5 h-4 w-4 ${exporting ? 'animate-pulse' : ''}`} aria-hidden="true" />
              {exporting ? t('exporting') : t('exportXlsx')}
            </Button>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('table.day')}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t('table.photo')}</TableHead>
                  <TableHead>{t('table.hall')}</TableHead>
                  <TableHead className="hidden md:table-cell">{t('table.size')}</TableHead>
                  <TableHead>{t('table.window')}</TableHead>
                  <TableHead>{t('table.weeks')}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t('table.district')}</TableHead>
                  <TableHead className="hidden md:table-cell">{t('table.address')}</TableHead>
                  <TableHead className="text-right">{t('table.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((r: HallResult) => (
                  <TableRow key={`${r.einrichtungId}-${r.weekday}`}>
                    <TableCell className="whitespace-nowrap font-medium">{t(`weekdayShort.${r.weekday}`)}</TableCell>
                    {/* Photos are hotlinked from the city's server (they own the
                        images) — roughly two thirds of halls have none, so the
                        cell is simply empty rather than showing a placeholder. */}
                    <TableCell className="hidden sm:table-cell">
                      {r.photoThumbUrl ? (
                        <button
                          type="button"
                          onClick={() => setLightbox({ src: r.photoUrl ?? r.photoThumbUrl!, alt: r.name })}
                          className="block overflow-hidden rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          title={t('photoOpen')}
                        >
                          <img
                            src={r.photoThumbUrl}
                            alt={r.name}
                            loading="lazy"
                            referrerPolicy="no-referrer"
                            className="h-10 w-14 object-cover"
                            onError={(e) => { e.currentTarget.style.display = 'none' }}
                          />
                        </button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-foreground">{r.name}</div>
                      {r.hallType && (
                        <span className="text-xs text-muted-foreground">
                          {r.hallTypeLabel ?? t(`type.${r.hallType}`)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap md:table-cell">
                      {r.sizeLabel ?? <span className="text-muted-foreground">—</span>}
                      {r.partitions?.length > 0 && (
                        <span className="block text-xs text-muted-foreground">
                          {t('courtCount', { count: r.partitions.length })}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{r.sampleWindow ?? '—'}</TableCell>
                    <TableCell>
                      {r.freeAllNonHolidayWeeks
                        ? <Badge variant="default">{t('allWeeks', { total: r.weeksTotal })}</Badge>
                        : <Badge variant="secondary">{t('someWeeks', { free: r.weeksFree, total: r.weeksTotal })}</Badge>}
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap sm:table-cell">
                      {r.stadtkreis ? `Kreis ${r.stadtkreis}` : '—'}
                      {r.stadtquartier ? <span className="block text-xs text-muted-foreground">{r.stadtquartier}</span> : null}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{r.address ?? '—'}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <a href={r.belegungsplanUrl} target="_blank" rel="noopener noreferrer"
                          className="text-xs text-muted-foreground underline hover:text-foreground">
                          {t('calendar')}
                        </a>
                        <a href={r.reservationUrl} target="_blank" rel="noopener noreferrer"
                          className="text-xs font-medium text-primary underline">
                          {t('book')}
                        </a>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      <ImageLightbox
        src={lightbox?.src ?? ''}
        alt={lightbox?.alt ?? ''}
        open={!!lightbox}
        onClose={() => setLightbox(null)}
      />
    </div>
  )
}
