/**
 * Fines summary PDF — one team, this season: who owes what, every fine in
 * order, and the ladders that priced them. The coach downloads it from the
 * roster editor's Fines panel and pins it in the team chat / on the wall.
 *
 * `buildFinesSummary` is pure (unit-tested); `exportFinesSummaryPdf` lazy-loads
 * jspdf + autotable so the main bundle stays unaffected for everyone who never
 * clicks Download. Exports are ALWAYS English, whatever the UI language — the
 * caller passes `i18n.getFixedT('en', …)`.
 */
import type { TFunction } from 'i18next'
import { formatDateCompactZurich, formatDateTimeCompactZurich } from '../../utils/dateHelpers'
import type { Fine, FineActivityType, FineRule, FineResetWindow } from '../../types'

export interface FinesSummaryMember {
  id: string | number
  first_name?: string | null
  last_name?: string | null
  nickname?: string | null
}

export interface FinesSummaryInput {
  team: { name: string; season?: string | null }
  fines: Fine[]
  members: FinesSummaryMember[]
  rules: FineRule[]
  exportedAt: Date
}

export interface FinesSummaryMemberRow {
  name: string
  count: number
  open: number
  paid: number
  waived: number
  /** The team-level row (fines with no member — owed by the Teamkasse). */
  isTeam: boolean
}

export interface FinesSummaryDetailRow {
  date: string
  member: string
  category: string
  activity: string
  reason: string
  amount: number
  status: string
}

export interface FinesSummaryModel {
  org: string
  title: string
  subtitle: string
  totals: { count: number; open: number; paid: number; waived: number }
  perMember: FinesSummaryMemberRow[]
  detail: FinesSummaryDetailRow[]
  /** One line per enabled rule, general first, e.g. "Late sign-in — Games: 1: CHF 20.00 · 2+: CHF 40.00 · season". */
  rules: string[]
  filename: string
}

const money = (n: number) => new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

function categoryKey(c: string): string {
  return `category${c.charAt(0).toUpperCase()}${c.slice(1).replace(/_(.)/g, (_, ch) => ch.toUpperCase())}`
}

function windowKey(w: FineResetWindow): string {
  switch (w) {
    case 'calendar_month': return 'windowMonth'
    case 'rolling_30d': return 'window30d'
    case 'rolling_90d': return 'window90d'
    case 'season': return 'windowSeason'
    case 'never': return 'windowNever'
  }
}

function typeKey(t: FineActivityType): string {
  switch (t) {
    case 'training': return 'settingsTypeTraining'
    case 'game': return 'settingsTypeGame'
    case 'event': return 'settingsTypeEvent'
  }
}

const ACTIVITY_LABEL: Record<FineActivityType, string> = { training: 'Training', game: 'Game', event: 'Event' }

/** "Last Nick" like the fines page — nickname over first name, never an empty string. */
function memberName(m: FinesSummaryMember | undefined, id: string | number): string {
  if (!m) return `#${id}`
  return `${m.last_name ?? ''} ${m.nickname || m.first_name || ''}`.trim() || `#${id}`
}

export function buildFinesSummary(input: FinesSummaryInput, t: TFunction): FinesSummaryModel {
  const { team, fines, members, rules, exportedAt } = input
  const memberMap = new Map(members.map((m) => [String(m.id), m]))
  const teamLabel = t('teamFineRow')

  // Per member, in name order; the team-level row last. Waived fines are
  // counted (the fine was issued) but priced in their own column, so "Open" is
  // exactly what the member still owes.
  const byMember = new Map<string, FinesSummaryMemberRow>()
  const totals = { count: 0, open: 0, paid: 0, waived: 0 }
  for (const f of fines) {
    const key = f.member == null ? '__team__' : String(f.member)
    let row = byMember.get(key)
    if (!row) {
      row = {
        name: f.member == null ? teamLabel : memberName(memberMap.get(key), key),
        count: 0, open: 0, paid: 0, waived: 0,
        isTeam: f.member == null,
      }
      byMember.set(key, row)
    }
    const amount = Number(f.amount) || 0
    row.count += 1
    totals.count += 1
    if (f.status === 'paid') { row.paid += amount; totals.paid += amount }
    else if (f.status === 'waived') { row.waived += amount; totals.waived += amount }
    else { row.open += amount; totals.open += amount }
  }
  const perMember = [...byMember.values()].sort((a, b) =>
    a.isTeam === b.isTeam ? a.name.localeCompare(b.name, 'de-CH') : a.isTeam ? 1 : -1,
  )

  // Every fine, oldest first — a ledger reads top-down.
  const detail = [...fines]
    .sort((a, b) => a.issued_at.localeCompare(b.issued_at))
    .map((f): FinesSummaryDetailRow => ({
      date: formatDateCompactZurich(f.issued_at),
      member: f.member == null ? teamLabel : memberName(memberMap.get(String(f.member)), f.member),
      category: t(categoryKey(f.category)),
      activity: f.activity_type
        ? `${ACTIVITY_LABEL[f.activity_type]}${f.activity_date ? ` ${formatDateCompactZurich(f.activity_date)}` : ''}`
        : '',
      reason: f.reason ?? '',
      amount: Number(f.amount) || 0,
      status: t(`status${f.status.charAt(0).toUpperCase()}${f.status.slice(1)}`),
    }))

  // The ladders, so the sheet explains its own numbers: general rule first,
  // then each per-type override (migration 361), enabled ones only.
  const ruleLines = rules
    .filter((r) => r.enabled)
    .sort((a, b) => a.category.localeCompare(b.category) || (a.activity_type ?? '').localeCompare(b.activity_type ?? ''))
    .map((r) => {
      const scope = r.activity_type ? ` — ${t(typeKey(r.activity_type))}` : ''
      const tiers = r.tiers.length === 0
        ? t('settingsNoTiers')
        : r.tiers.map((tier) => `${tier.offense_min != null ? `${tier.offense_min}+` : tier.offense ?? '?'}: CHF ${money(Number(tier.amount) || 0)}`).join(' · ')
      return `${t(categoryKey(r.category))}${scope}: ${tiers} · ${String(t(windowKey(r.reset_window))).toLowerCase()}`
    })

  const season = team.season ? ` · ${team.season}` : ''
  const stamp = formatDateTimeCompactZurich(exportedAt)
  return {
    org: 'KSC Wiedikon',
    title: `${t('pdfTitle')} — ${team.name}${season}`,
    subtitle: `${t('pdfExported')} ${stamp} · ${t('pdfFineCount', { count: totals.count })} · ${t('statusOpen')} CHF ${money(totals.open)} · ${t('statusPaid')} CHF ${money(totals.paid)} · ${t('statusWaived')} CHF ${money(totals.waived)}`,
    totals,
    perMember,
    detail,
    rules: ruleLines,
    filename: `fines-${team.name}${team.season ? `-${team.season}` : ''}-${exportedAt.toISOString().slice(0, 10)}`.replace(/[/\\:*?"<>|\s]+/g, '-'),
  }
}

const BRAND: [number, number, number] = [74, 85, 162] // #4A55A2

export async function exportFinesSummaryPdf(model: FinesSummaryModel, t: TFunction): Promise<void> {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const M = 40
  const pw = doc.internal.pageSize.getWidth()
  const ph = doc.internal.pageSize.getHeight()
  const lastY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY

  doc.setFontSize(16); doc.setFont('helvetica', 'bold'); doc.text(model.org, M, 50)
  doc.setFontSize(12); doc.setFont('helvetica', 'normal'); doc.text(model.title, M, 70)
  doc.setFontSize(9); doc.setTextColor(120); doc.text(model.subtitle, M, 86); doc.setTextColor(0)
  let y = 108

  const heading = (label: string) => {
    if (y > ph - 90) { doc.addPage(); y = 50 }  // keep the heading with its table
    doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.text(label, M, y); doc.setFont('helvetica', 'normal'); y += 6
  }
  const table = (head: string[], body: (string | number)[][], right: number[], widths?: Record<number, number>) => {
    autoTable(doc, {
      startY: y,
      head: [head],
      body,
      styles: { fontSize: 9, cellPadding: 4, overflow: 'linebreak' },
      headStyles: { fillColor: BRAND, textColor: 255 },
      columnStyles: Object.fromEntries(head.map((_, i) => [i, { halign: right.includes(i) ? 'right' : 'left', ...(widths?.[i] ? { cellWidth: widths[i] } : {}) }])),
      didParseCell: (d: { section: string; row: { index: number }; column: { index: number }; cell: { styles: { fontStyle: string; halign: string } } }) => {
        // columnStyles.halign only reaches the body — align the head the same way.
        if (d.section === 'head' && right.includes(d.column.index)) d.cell.styles.halign = 'right'
        if (d.section === 'body' && body[d.row.index]?.[0] === t('pdfTotal')) d.cell.styles.fontStyle = 'bold'
      },
      margin: { left: M, right: M },
    })
    y = lastY() + 18
  }

  if (model.detail.length === 0) {
    doc.setFontSize(10); doc.text(t('pdfNoFines'), M, y); y += 18
  } else {
    heading(t('pdfPerMember'))
    table(
      [t('pdfMember'), t('pdfCount'), `${t('statusOpen')} (CHF)`, `${t('statusPaid')} (CHF)`, `${t('statusWaived')} (CHF)`],
      [
        ...model.perMember.map((r) => [r.name, r.count, money(r.open), money(r.paid), money(r.waived)]),
        [t('pdfTotal'), model.totals.count, money(model.totals.open), money(model.totals.paid), money(model.totals.waived)],
      ],
      [1, 2, 3, 4],
      { 1: 50, 2: 80, 3: 80, 4: 80 },
    )

    heading(t('pdfAllFines'))
    table(
      [t('pdfDate'), t('pdfMember'), t('colCategory'), t('pdfActivity'), t('colReason'), 'CHF', t('colStatus')],
      model.detail.map((r) => [r.date, r.member, r.category, r.activity, r.reason, money(r.amount), r.status]),
      [5],
      { 0: 62, 1: 100, 2: 72, 3: 92, 5: 50, 6: 46 },
    )
  }

  if (model.rules.length > 0) {
    heading(t('pdfRules'))
    y += 10  // heading() leaves y at the table start; text needs a baseline below it
    doc.setFontSize(9); doc.setTextColor(60)
    for (const line of model.rules) {
      const wrapped = doc.splitTextToSize(line, pw - 2 * M) as string[]
      if (y + wrapped.length * 12 > ph - 40) { doc.addPage(); y = 50 }
      doc.text(wrapped, M, y); y += wrapped.length * 12 + 2
    }
    doc.setTextColor(0)
  }

  // Footer on every page — the sheet gets photographed and forwarded, so each
  // page says where it came from and where it sits.
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setFontSize(8); doc.setTextColor(150)
    doc.text(`wiedisync · ${formatDateCompactZurich(new Date())}`, M, ph - 22)
    doc.text(`${i} / ${pages}`, pw - M, ph - 22, { align: 'right' })
  }
  doc.setTextColor(0)
  doc.save(`${model.filename}.pdf`)
}
