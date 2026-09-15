// src/modules/admin/components/seasonHealth/FindingSection.tsx
//
// One registry section (players, teams, …) of the current tab: a collapsible
// card whose body lists the section's checks ordered error → warn → info,
// each an expandable row revealing its FindingTable. A check that failed on
// the server renders a red "Check failed" pill and no table.
import { useState, type ComponentType } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle, BadgeCheck, Banknote, CalendarDays, CheckCircle2, ChevronDown, ChevronRight,
  ClipboardList, Dumbbell, Info, MailCheck, Trophy, Users, XCircle,
} from 'lucide-react'
import FindingTable from './FindingTable'
import type { SeasonTab, Section, Severity, TabCheck } from '../../utils/seasonHealth'

const SECTION_ICON: Record<Section, ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' }>> = {
  teams: Users,
  players: BadgeCheck,
  finance: Banknote,
  games: Trophy,
  duties: ClipboardList,
  rsvp: MailCheck,
  trainings: Dumbbell,
  events: CalendarDays,
}

const PILL = 'inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium'
const PILL_ERROR = `${PILL} bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400`
const PILL_WARN = `${PILL} bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400`
const PILL_INFO = `${PILL} bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400`
const PILL_CLEAN = `${PILL} bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400`

function severityIcon(severity: Severity) {
  if (severity === 'error') return <XCircle className="h-4 w-4 shrink-0 text-red-500" aria-hidden="true" />
  if (severity === 'warn') return <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
  return <Info className="h-4 w-4 shrink-0 text-blue-500" aria-hidden="true" />
}

function countPill(severity: Severity, count: number) {
  const cls = severity === 'error' ? PILL_ERROR : severity === 'warn' ? PILL_WARN : PILL_INFO
  return <span className={cls}>{count}</span>
}

function CheckRow({ item, tab }: { item: TabCheck; tab: SeasonTab }) {
  const { t } = useTranslation('seasonHealth')
  const [open, setOpen] = useState(false)
  const { check, rows, count, failed } = item
  const expandable = !failed && count > 0
  const panelId = `sh-check-${check.key}-${tab}`
  const title = t(`check_${check.key}`, { defaultValue: check.title })
  const description = t(`checkDesc_${check.key}`, { defaultValue: check.description })

  const inner = (
    <>
      {expandable
        ? (open
          ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />)
        : <span className="h-4 w-4 shrink-0" />}
      <span className="mt-0.5">{severityIcon(check.severity)}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">{title}</span>
        {description && (
          <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
        )}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-2 self-center">
        {failed ? (
          <span className={PILL_ERROR}>
            <XCircle className="h-3 w-3" aria-hidden="true" />
            {t('checkFailed')}
          </span>
        ) : count === 0 ? (
          <span className={PILL_CLEAN}>
            <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
            {t('clean')}
          </span>
        ) : countPill(check.severity, count)}
      </span>
    </>
  )

  return (
    <div className="border-t border-border">
      {expandable ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={panelId}
          className="flex min-h-11 w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-muted/40"
        >
          {inner}
        </button>
      ) : (
        <div className="flex min-h-11 w-full items-start gap-3 px-4 py-2.5">{inner}</div>
      )}
      {expandable && open && (
        <div id={panelId}>
          <FindingTable check={check} rows={rows} total={count} tab={tab} />
        </div>
      )}
    </div>
  )
}

export default function FindingSection({ section, items, tab }: {
  section: Section
  items: TabCheck[]
  tab: SeasonTab
}) {
  const { t } = useTranslation('seasonHealth')
  const [open, setOpen] = useState(true)
  const Icon = SECTION_ICON[section]
  const errors = items.filter((i) => i.check.severity === 'error').reduce((s, i) => s + i.count, 0)
  const warnings = items.filter((i) => i.check.severity === 'warn').reduce((s, i) => s + i.count, 0)
  const info = items.filter((i) => i.check.severity === 'info').reduce((s, i) => s + i.count, 0)
  const failed = items.filter((i) => i.failed).length
  const clean = errors === 0 && warnings === 0 && info === 0 && failed === 0
  const panelId = `sh-section-${section}-${tab}`

  return (
    <section className="rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex min-h-11 w-full items-center gap-3 px-4 py-3 text-left"
      >
        {open
          ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
        {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
        <span className="text-sm font-semibold text-foreground">
          {t(`section_${section}`, { defaultValue: section })}
        </span>
        <span className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
          {errors > 0 && <span className={PILL_ERROR}>{t('errors', { count: errors })}</span>}
          {warnings > 0 && <span className={PILL_WARN}>{t('warnings', { count: warnings })}</span>}
          {info > 0 && <span className={PILL_INFO}>{t('info', { count: info })}</span>}
          {failed > 0 && <span className={PILL_ERROR}>{t('failed', { count: failed })}</span>}
          {clean && (
            <span className={PILL_CLEAN}>
              <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
              {t('clean')}
            </span>
          )}
        </span>
      </button>
      {open && (
        <div id={panelId}>
          {items.map((item) => <CheckRow key={item.check.key} item={item} tab={tab} />)}
        </div>
      )}
    </section>
  )
}
