import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import WeekdayHint from './WeekdayHint'
import DatePicker from '@/components/ui/DatePicker'
import { Button } from '@/components/ui/button'
import { useConfirm } from '../../../components/ConfirmProvider'
import { kscwApi } from '../../../lib/api'
import type { GameSchedulingSeason } from '../../../types'
import { formatSeasonShort, previousSeasonShort } from '../utils/formatSeason'

interface Props {
  season: GameSchedulingSeason | null
  allSeasons: GameSchedulingSeason[]
  onCreateSeason: (name: string) => Promise<void>
  onSelectSeason: (season: GameSchedulingSeason) => void
  onStatusChange: (status: 'setup' | 'open' | 'closed') => Promise<void>
  onUpdateSeason?: (patch: Record<string, unknown>) => Promise<void>
  onAfterArchive?: () => Promise<void> | void
  /** True when the selected season has no teams yet and a previous season exists to clone from. */
  canRollover?: boolean
  /** Deep-clone the previous season's teams + rosters into this season, then archive the old one. */
  onRollover?: () => Promise<void>
}

interface ArchiveResult {
  success: true
  season: string
  teams_archived: number
  invites_expired: number
}

interface SvrzSeasonOption {
  uuid: string
  name: string
}

export default function SeasonConfig({
  season,
  allSeasons,
  onCreateSeason,
  onSelectSeason,
  onStatusChange,
  onUpdateSeason,
  onAfterArchive,
  canRollover,
  onRollover,
}: Props) {
  const { t } = useTranslation('gameScheduling')
  const confirm = useConfirm()
  const [creating, setCreating] = useState(false)
  const [svrzOptions, setSvrzOptions] = useState<SvrzSeasonOption[]>([])
  const [savingSvrz, setSavingSvrz] = useState(false)
  const [savingWindow, setSavingWindow] = useState(false)

  const currentSvrzUuid = typeof season?.svrz_season_uuid === 'string' ? season.svrz_season_uuid : ''

  useEffect(() => {
    if (!onUpdateSeason) return
    kscwApi<{ data: SvrzSeasonOption[] }>('/admin/terminplanung/svrz-available-seasons')
      .then((resp) => setSvrzOptions(resp.data ?? []))
      .catch(() => setSvrzOptions([]))
  }, [onUpdateSeason])

  const handleSvrzSelect = async (uuid: string) => {
    if (!onUpdateSeason) return
    setSavingSvrz(true)
    try {
      await onUpdateSeason({ svrz_season_uuid: uuid || null })
    } finally {
      setSavingSvrz(false)
    }
  }

  const handleWindowSave = async (field: 'season_opens' | 'season_closes', value: string) => {
    if (!onUpdateSeason) return
    setSavingWindow(true)
    try {
      await onUpdateSeason({ [field]: value || null })
      toast.success(t('seasonWindowSaved'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingWindow(false)
    }
  }

  const [savingAuthority, setSavingAuthority] = useState(false)
  const handleAuthoritySave = async (value: string) => {
    if (!onUpdateSeason) return
    setSavingAuthority(true)
    try {
      await onUpdateSeason({ vm_authority_date: value || null })
      toast.success(t('vmAuthoritySaved'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingAuthority(false)
    }
  }

  const getNextSeasonName = () => {
    const year = new Date().getFullYear()
    return `${year}/${(year + 1).toString().slice(-2)}`
  }

  const nextSeason = getNextSeasonName()
  const seasonExists = allSeasons.some((s) => s.season === nextSeason)

  const handleCreate = async () => {
    if (seasonExists) return
    setCreating(true)
    try {
      await onCreateSeason(nextSeason)
    } finally {
      setCreating(false)
    }
  }

  const statusColors: Record<string, string> = {
    setup: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    open: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    closed: 'bg-muted text-foreground',
    archived: 'bg-stone-200 text-muted-foreground dark:bg-slate-700',
  }

  const statusLabels: Record<string, string> = {
    setup: t('statusSetup'),
    open: t('statusOpen'),
    closed: t('statusClosed'),
    archived: t('statusArchived'),
  }

  const [archiving, setArchiving] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const handleArchive = async () => {
    if (!season) return
    if (!(await confirm({ message: t('archiveSeasonConfirm', { season: formatSeasonShort(season.season) }), danger: true }))) return
    setArchiving(true)
    try {
      const resp = await kscwApi<ArchiveResult>(`/admin/terminplanung/archive-season/${season.id}`, { method: 'POST' })
      toast.success(
        t('archiveSeasonSuccess', {
          season: formatSeasonShort(resp.season),
          teams: resp.teams_archived,
          invites: resp.invites_expired,
        }),
      )
      if (onAfterArchive) await onAfterArchive()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setArchiving(false)
    }
  }

  const [rollingOver, setRollingOver] = useState(false)
  const handleRolloverClick = async () => {
    if (!onRollover) return
    setRollingOver(true)
    try {
      await onRollover()
    } finally {
      setRollingOver(false)
    }
  }

  const handleRestore = async () => {
    if (!season) return
    if (!(await confirm({ message: t('restoreSeasonConfirm', { season: formatSeasonShort(season.season) }) }))) return
    setRestoring(true)
    try {
      const resp = await kscwApi<{ success: true; season: string; teams_restored: number }>(
        `/admin/terminplanung/restore-season/${season.id}`,
        { method: 'POST' },
      )
      toast.success(t('restoreSeasonSuccess', { season: formatSeasonShort(resp.season), teams: resp.teams_restored }))
      if (onAfterArchive) await onAfterArchive()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setRestoring(false)
    }
  }

  const status = season?.status as 'setup' | 'open' | 'closed' | 'archived' | undefined
  const stepOrder: Array<'setup' | 'open' | 'closed' | 'archived'> = ['setup', 'open', 'closed', 'archived']
  const stepIndex = status ? stepOrder.indexOf(status) : -1

  const linkedOption = svrzOptions.find((o) => o.uuid === currentSvrzUuid)
  const kscwShort = season ? formatSeasonShort(season.season) : ''
  const linkedShort = linkedOption ? formatSeasonShort(linkedOption.name) : ''
  const svrzMismatch = !!(currentSvrzUuid && linkedShort && kscwShort && linkedShort !== kscwShort)

  return (
    <div className="rounded-2xl border border-hairline bg-card shadow-card p-5">
      {/* Header: title + create-next-season affordance */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold tracking-tight text-foreground">{t('season')}</h2>
        {!seasonExists && (
          <Button
            onClick={handleCreate}
            disabled={creating}
            size="sm"
          >
            {creating ? '…' : `+ ${nextSeason}`}
          </Button>
        )}
      </div>

      {/* Season tabs — only shown when there's more than one to choose from */}
      {allSeasons.length > 1 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {allSeasons.map((s) => (
            <Button
              key={s.id}
              onClick={() => onSelectSeason(s)}
              variant="outline"
              size="sm"
              className={
                season?.id === s.id
                  ? 'border-transparent font-medium bg-selected text-selected-foreground hover:bg-selected/90 hover:text-selected-foreground'
                  : 'text-muted-foreground'
              }
            >
              {formatSeasonShort(s.season)}
              <span className={`ml-1.5 inline-block rounded-full px-1.5 py-0.5 text-[10px] ${statusColors[s.status]}`}>
                {statusLabels[s.status]}
              </span>
            </Button>
          ))}
        </div>
      )}

      {/* Primary state card */}
      {season && (
        <div className="mb-4 rounded-xl border border-hairline bg-surface-sunken p-3">
          <div className="flex items-baseline justify-between gap-2">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t('season')}</div>
              <div className="text-lg font-semibold text-foreground">{formatSeasonShort(season.season)}</div>
            </div>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status ? statusColors[status] : ''}`}>
              {status ? statusLabels[status] : ''}
            </span>
          </div>

          {/* Lifecycle stepper */}
          {status && status !== 'archived' && (
            <ol className="mt-3 flex items-center gap-1 text-[11px] text-muted-foreground">
              {(['setup', 'open', 'closed'] as const).map((step, i) => {
                const isDone = stepIndex > i
                const isCurrent = status === step
                return (
                  <li key={step} className="flex items-center gap-1">
                    <span
                      className={`inline-block h-1.5 w-1.5 rounded-full ${
                        isCurrent
                          ? 'bg-blue-500 ring-2 ring-blue-200 dark:ring-blue-900'
                          : isDone
                          ? 'bg-stone-400 dark:bg-gray-500'
                          : 'bg-stone-300 dark:bg-gray-600'
                      }`}
                    />
                    <span className={isCurrent ? 'font-medium text-foreground' : ''}>
                      {statusLabels[step]}
                    </span>
                    {i < 2 && <span className="mx-1 text-muted-foreground/50">→</span>}
                  </li>
                )
              })}
            </ol>
          )}

          {/* Primary action row */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {status === 'setup' && (
              <Button
                onClick={() => onStatusChange('open')}
                className="bg-green-600 text-white hover:bg-green-700 dark:bg-green-600 dark:hover:bg-green-700"
              >
                {t('openForBooking')} →
              </Button>
            )}
            {status === 'open' && (
              <Button
                onClick={() => onStatusChange('closed')}
                variant="outline"
                title={t('closeBookingHint') || ''}
              >
                {t('closeBooking')} →
              </Button>
            )}
            {status === 'closed' && (
              <>
                <Button
                  onClick={() => onStatusChange('setup')}
                  variant="outline"
                >
                  ← {t('statusSetup')}
                </Button>
                <Button
                  onClick={handleArchive}
                  disabled={archiving}
                  variant="outline"
                  title={t('archiveSeasonHint') || ''}
                >
                  {archiving ? '…' : t('archiveSeason')}
                </Button>
              </>
            )}
            {status === 'archived' && (
              <>
                <span className="text-sm italic text-muted-foreground">{t('archiveSeasonDone')}</span>
                <Button
                  onClick={handleRestore}
                  disabled={restoring}
                  variant="outline"
                >
                  {restoring ? '…' : t('restoreSeason')}
                </Button>
              </>
            )}
          </div>

          {/* Season rollover — only when this season is still empty */}
          {onRollover && canRollover && status !== 'archived' && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-900/20">
              <p className="text-xs text-amber-800 dark:text-amber-200">
                {t('rolloverHint', { from: previousSeasonShort(season?.season), to: formatSeasonShort(season?.season) })}
              </p>
              <Button
                onClick={handleRolloverClick}
                disabled={rollingOver}
                className="mt-2 bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-600 dark:hover:bg-amber-700"
              >
                {rollingOver ? '…' : t('rolloverButton', { from: previousSeasonShort(season?.season) })}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* SVRZ integration — dense, secondary */}
      {season && onUpdateSeason && (
        <div className="mt-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">{t('svrzSeasonLabel')}</span>
            {svrzOptions.length === 0 ? (
              <span className="text-xs italic text-amber-600 dark:text-amber-400">{t('svrzSeasonEmpty')}</span>
            ) : (
              <>
                <select
                  value={currentSvrzUuid}
                  onChange={(e) => handleSvrzSelect(e.target.value)}
                  disabled={savingSvrz}
                  className="h-11 rounded-lg border border-input bg-card px-2 py-1 text-xs text-foreground sm:h-9 dark:bg-gray-800"
                >
                  <option value="">{t('svrzSeasonNone')}</option>
                  {svrzOptions.map((opt) => (
                    <option key={opt.uuid} value={opt.uuid}>
                      {formatSeasonShort(opt.name)}
                    </option>
                  ))}
                </select>
                {savingSvrz ? (
                  <span className="text-xs text-muted-foreground">…</span>
                ) : currentSvrzUuid && !svrzMismatch ? (
                  <span className="text-xs text-green-600 dark:text-green-400">✓</span>
                ) : null}
              </>
            )}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">{t('svrzSeasonHelp')}</p>
          {svrzMismatch && (
            <p className="mt-1 text-[11px] italic text-amber-600 dark:text-amber-400">
              {t('svrzSeasonMismatchHint', { kscw: kscwShort, svrz: linkedShort })}
            </p>
          )}
        </div>
      )}

      {/* Season offer window — bounds the selectable dates in both calendars */}
      {season && onUpdateSeason && (
        <div className="mt-4 border-t border-border/60 pt-4">
          <span className="text-xs font-medium text-muted-foreground">{t('seasonWindowLabel')}</span>
          <div className="mt-2 flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <DatePicker
                label={t('seasonOpens')}
                value={season.season_opens ? String(season.season_opens).slice(0, 10) : ''}
                disabled={savingWindow}
                onChange={(v) => handleWindowSave('season_opens', v)}
              />
              <WeekdayHint date={season.season_opens ? String(season.season_opens).slice(0, 10) : ''} />
            </div>
            <div className="flex flex-col gap-1">
              <DatePicker
                label={t('seasonCloses')}
                value={season.season_closes ? String(season.season_closes).slice(0, 10) : ''}
                disabled={savingWindow}
                onChange={(v) => handleWindowSave('season_closes', v)}
              />
              <WeekdayHint date={season.season_closes ? String(season.season_closes).slice(0, 10) : ''} />
            </div>
            {savingWindow && <span className="pb-1 text-xs text-muted-foreground">…</span>}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">{t('seasonWindowHelp')}</p>
        </div>
      )}

      {/* SV feed takeover date — after this date the national feed becomes
          authoritative for tool-scheduled games' date/time/venue. */}
      {season && onUpdateSeason && (
        <div className="mt-4 border-t border-border/60 pt-4">
          <span className="text-xs font-medium text-muted-foreground">{t('vmAuthorityLabel')}</span>
          <div className="mt-2 flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <DatePicker
                label={t('vmAuthorityDate')}
                value={season.vm_authority_date ? String(season.vm_authority_date).slice(0, 10) : ''}
                disabled={savingAuthority}
                onChange={(v) => handleAuthoritySave(v)}
              />
              <WeekdayHint date={season.vm_authority_date ? String(season.vm_authority_date).slice(0, 10) : ''} />
            </div>
            {savingAuthority && <span className="pb-1 text-xs text-muted-foreground">…</span>}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">{t('vmAuthorityHelp')}</p>
        </div>
      )}
    </div>
  )
}
