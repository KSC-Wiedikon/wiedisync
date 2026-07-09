/**
 * Roster export — CSV / PNG / PDF for the participation roster modal.
 * Image and PDF paths lazy-load `html-to-image` and `jspdf` so the main bundle
 * stays unaffected for users who never open Export.
 */
import { toCSV, downloadText } from '../modules/admin/utils/exportResults'

export type RosterExportRow = {
  name: string
  jerseyNumber: number | null
  positions: string
  status: string
  guests: number
  /** True when the player themselves is a guest on this team (member_teams
   *  `guest_level > 0`) — distinct from `guests` which counts plus-ones the
   *  player brings. Rendered as ✓ in the PNG/PDF guests column and "Yes" in
   *  CSV so a coach can spot guest players at a glance. */
  isGuest: boolean
  note: string
  rsvpAt: string
  /** Localized "Edited to X by Y on Z" sentence when the row was last
   *  touched by a staff member other than the member themselves; empty
   *  when self-edit or system-set. Rendered as a small italic line under
   *  the table row in PNG/PDF and as a separate column in CSV. */
  editedBy: string
  /** Per-session status breakdown, present ONLY when exporting the Overall tab
   *  of a per-day / per-session event; undefined for single-session tabs and
   *  non-session activities. The PNG/PDF snapshot renders these as colored
   *  per-day lines in the Status cell so a coach can see who's coming which day;
   *  CSV carries the same breakdown folded into the `status` string. */
  sessionStatuses?: { label: string; statusLabel: string; status: string | null }[]
}

export type RosterExportMeta = {
  /** Activity-kind label rendered as a small uppercase line above the title
   *  in PNG/PDF exports and on the first metadata row in CSV. Defaults to
   *  the localized activity type ("Training" / "Game" / "Event"); games
   *  may pass `"<home> vs <away>"` so the matchup appears in the export
   *  header even though the modal's on-screen title is just "Roster". */
  activityKind: string
  activityTitle: string
  activityDate: string
  filterLabel: string
  /** English filter label for the download filename (exports-always-English
   *  convention). `filterLabel` stays localized because it also renders inside
   *  the PNG/PDF snapshot, which is localized like the rest of the modal. */
  filterLabelEn?: string
  exportedAt: string
  totalCount: number
  /** Comma-separated `<count> <label>` for each position in the export
   *  population (e.g. "3 Setter, 5 Outside hitter"). Empty string when no
   *  positions are recorded. */
  positionsSummary: string
  /** Localized label of the single session being exported (e.g. "Sat, 3 Oct")
   *  when the modal's active tab is a specific session; empty for the Overall
   *  tab and non-session activities. Rendered in the PNG/PDF + CSV header so a
   *  single-day export is unambiguous. */
  sessionLabel?: string
}

const COLUMNS = ['Name', 'Number', 'Positions', 'Status', 'Guest', 'Plus-ones', 'Note', 'RSVP time', 'Edited by']

/** Replace characters that break filenames on Windows/Unix. Em/en dashes
 *  collapse with surrounding whitespace into a single `_` so titles like
 *  "H3 — 11/05/2026" don't end up as "H3-—-11_05_2026" (read as "---" by
 *  the user). Then collapse runs of `-` and `_` to a single `_`. */
function sanitizeFilename(s: string): string {
  return s
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s*[—–-]+\s*/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 80)
}

export function buildExportFilename(meta: RosterExportMeta, ext: 'csv' | 'png' | 'pdf'): string {
  // The activity title already includes the date for trainings/games (e.g.
  // "H3 — 11/05/2026"), so pasting `_<date>` after it produced the
  // "H3-—-11_05_2026_11_05_2026" duplicate. Trust the title to be unique
  // enough; fall back to date when the title doesn't contain it.
  const titleHasDate = meta.activityDate && meta.activityTitle.includes(meta.activityDate)
  const filterLabel = meta.filterLabelEn ?? meta.filterLabel
  const parts = titleHasDate
    ? [meta.activityTitle, filterLabel]
    : [meta.activityTitle, meta.activityDate, filterLabel]
  return `${sanitizeFilename(parts.filter(Boolean).join('_'))}.${ext}`
}

export function exportRosterCsv(rows: RosterExportRow[], meta: RosterExportMeta): void {
  const tableRows = rows.map((r) => [
    r.name,
    r.jerseyNumber ?? '',
    r.positions,
    r.status,
    r.isGuest ? 'Yes' : '',
    r.guests,
    r.note,
    r.rsvpAt,
    r.editedBy,
  ])
  const dataCsv = toCSV(COLUMNS, tableRows)
  // Trim metadata: title (already includes the date in our convention) +
  // filter + position summary + exported timestamp. Dropped the standalone
  // date row — duplicated the title and showed up as "11/05/2026" floating
  // alone on row 2 of the file.
  const metaLines: string[] = [meta.activityKind, meta.activityTitle, `Filter: ${meta.filterLabel} (${meta.totalCount})`]
  if (meta.sessionLabel) metaLines.push(`Session: ${meta.sessionLabel}`)
  if (meta.positionsSummary) metaLines.push(`Positions: ${meta.positionsSummary}`)
  metaLines.push(`Exported: ${meta.exportedAt}`, '')
  const metaBlock = metaLines.join('\n')
  // BOM up front so Excel autodetects UTF-8 for umlauts in names.
  downloadText('﻿' + metaBlock + '\n' + dataCsv, buildExportFilename(meta, 'csv'), 'text/csv;charset=utf-8')
}

/** Wrap dynamic imports so a stale-bundle (chunk hashes from a prior deploy
 *  no longer on the server) becomes an actionable user-facing error rather
 *  than a silent "Failed to fetch dynamically imported module" Sentry. CF
 *  Pages serves the SPA fallback (index.html) for missing chunk URLs, which
 *  surfaces as `MIME type "text/html"` in the console. */
class ExportLibraryError extends Error {
  readonly lib: string
  constructor(lib: string, cause: unknown) {
    super(`Could not load the ${lib} export library. The app may have been updated since you opened this page — please refresh and try again.`)
    this.name = 'ExportLibraryError'
    this.lib = lib
    if (cause instanceof Error) this.stack = `${this.message}\nCaused by: ${cause.stack ?? cause.message}`
  }
}

/** Get a 2D canvas context or throw an actionable error. Context allocation can
 *  fail for a large multi-page roster on a memory-constrained mobile browser;
 *  without this guard the `!` assertion below throws a raw "Cannot read
 *  properties of null" TypeError instead of something the user can act on. */
function get2dContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Could not render the PDF — your browser ran out of memory for this roster. Try exporting fewer rows, or use CSV / a desktop browser.')
  }
  return ctx
}

async function loadHtmlToImage() {
  try { return await import('html-to-image') }
  catch (err) { throw new ExportLibraryError('image', err) }
}
async function loadJsPdf() {
  try { return await import('jspdf') }
  catch (err) { throw new ExportLibraryError('PDF', err) }
}

/** Set ?debugExport=1 in the URL to dump per-stage artifact info to the
 *  console. Survives in prod so we can diagnose blank-snapshot reports
 *  without redeploying. */
function shouldDebug(): boolean {
  try { return new URLSearchParams(window.location.search).has('debugExport') }
  catch { return false }
}

export async function exportRosterImage(node: HTMLElement, meta: RosterExportMeta): Promise<void> {
  const debug = shouldDebug()
  const lib = await loadHtmlToImage()
  const { toPng, toSvg } = lib
  if (document.fonts?.ready) await document.fonts.ready

  if (debug) {
    const rect = node.getBoundingClientRect()
    const cs = window.getComputedStyle(node)
    console.group('[rosterExport] PNG diagnostics')
    console.log('node:', node)
    console.log('rect:', { x: rect.x, y: rect.y, w: rect.width, h: rect.height })
    console.log('computed:', {
      display: cs.display, position: cs.position, opacity: cs.opacity,
      visibility: cs.visibility, transform: cs.transform, overflow: cs.overflow,
      width: cs.width, height: cs.height, color: cs.color, backgroundColor: cs.backgroundColor,
    })
    console.log('parent:', node.parentElement)
    console.log('children count:', node.children.length, 'innerHTML length:', node.innerHTML.length)
    console.log('innerHTML head:', node.innerHTML.slice(0, 400))
    try {
      const svgUrl = await toSvg(node, { backgroundColor: '#ffffff', cacheBust: true })
      console.log('toSvg dataURL length:', svgUrl.length)
      console.log('toSvg head (decoded):', decodeURIComponent(svgUrl.split(',')[1] ?? '').slice(0, 600))
    } catch (svgErr) { console.error('toSvg threw:', svgErr) }
  }

  const dataUrl = await toPng(node, {
    pixelRatio: 2,
    backgroundColor: '#ffffff',
    cacheBust: true,
  })

  if (debug) {
    console.log('toPng dataURL length:', dataUrl.length)
    console.log('toPng head:', dataUrl.slice(0, 80))
    console.groupEnd()
  }

  const a = document.createElement('a')
  a.href = dataUrl
  a.download = buildExportFilename(meta, 'png')
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

export async function exportRosterPdf(node: HTMLElement, meta: RosterExportMeta): Promise<void> {
  const [{ toPng }, { default: jsPDF }] = await Promise.all([
    loadHtmlToImage(),
    loadJsPdf(),
  ])
  if (document.fonts?.ready) await document.fonts.ready
  const dataUrl = await toPng(node, {
    pixelRatio: 2,
    backgroundColor: '#ffffff',
    cacheBust: true,
  })

  const img = new Image()
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('Failed to load roster snapshot'))
    img.src = dataUrl
  })

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = pdf.internal.pageSize.getWidth()
  const pageH = pdf.internal.pageSize.getHeight()
  const margin = 10
  const usableW = pageW - margin * 2
  const usableH = pageH - margin * 2
  const totalHeightMm = (img.height / img.width) * usableW

  if (totalHeightMm <= usableH) {
    pdf.addImage(dataUrl, 'PNG', margin, margin, usableW, totalHeightMm)
  } else {
    const canvas = document.createElement('canvas')
    canvas.width = img.width
    canvas.height = img.height
    get2dContext(canvas).drawImage(img, 0, 0)

    const pageSliceHeightPx = (usableH / usableW) * img.width
    let yPx = 0
    let pageIdx = 0
    while (yPx < img.height) {
      const sliceH = Math.min(pageSliceHeightPx, img.height - yPx)
      const slice = document.createElement('canvas')
      slice.width = img.width
      slice.height = sliceH
      get2dContext(slice).drawImage(canvas, 0, yPx, img.width, sliceH, 0, 0, img.width, sliceH)
      const sliceMm = (sliceH / img.width) * usableW
      if (pageIdx > 0) pdf.addPage()
      pdf.addImage(slice.toDataURL('image/png'), 'PNG', margin, margin, usableW, sliceMm)
      yPx += sliceH
      pageIdx++
    }
  }

  pdf.save(buildExportFilename(meta, 'pdf'))
}
