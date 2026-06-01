import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
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
  const [creating, setCreating] = useState(false)
  const [svrzOptions, setSvrzOptions] = useState<SvrzSeasonOption[]>([])
  const [savingSvrz, setSavingSvrz] = useState(false)

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
    closed: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
    archived: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
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
    if (!window.confirm(t('archiveSeasonConfirm', { season: formatSeasonShort(season.season) }))) return
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
    if (!window.confirm(t('restoreSeasonConfirm', { season: formatSeasonShort(season.season) }))) return
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
    <div className="rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      {/* Header: title + create-next-season affordance */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('season')}</h2>
        {!seasonExists && (
          <button
            onClick={handleCreate}
            disabled={creating}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {creating ? '…' : `+ ${nextSeason}`}
          </button>
        )}
      </div>

      {/* Season tabs — only shown when there's more than one to choose from */}
      {allSeasons.length > 1 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {allSeasons.map((s) => (
            <button
              key={s.id}
              onClick={() => onSelectSeason(s)}
              className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                season?.id === s.id
                  ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                  : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300'
              }`}
            >
              {formatSeasonShort(s.season)}
              <span className={`ml-1.5 inline-block rounded-full px-1.5 py-0.5 text-[10px] ${statusColors[s.status]}`}>
                {statusLabels[s.status]}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Primary state card */}
      {season && (
        <div className="mb-4 rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-gray-600 dark:bg-gray-700/50">
          <div className="flex items-baseline justify-between gap-2">
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('season')}</div>
              <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">{formatSeasonShort(season.season)}</div>
            </div>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status ? statusColors[status] : ''}`}>
              {status ? statusLabels[status] : ''}
            </span>
          </div>

          {/* Lifecycle stepper */}
          {status && status !== 'archived' && (
            <ol className="mt-3 flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400">
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
                          ? 'bg-gray-400 dark:bg-gray-500'
                          : 'bg-gray-300 dark:bg-gray-600'
                      }`}
                    />
                    <span className={isCurrent ? 'font-medium text-gray-800 dark:text-gray-200' : ''}>
                      {statusLabels[step]}
                    </span>
                    {i < 2 && <span className="mx-1 text-gray-300 dark:text-gray-600">→</span>}
                  </li>
                )
              })}
            </ol>
          )}

          {/* Primary action row */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {status === 'setup' && (
              <button
                onClick={() => onStatusChange('open')}
                className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700"
              >
                {t('openForBooking')} →
              </button>
            )}
            {status === 'open' && (
              <button
                onClick={() => onStatusChange('closed')}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                title={t('closeBookingHint') || ''}
              >
                {t('closeBooking')} →
              </button>
            )}
            {status === 'closed' && (
              <>
                <button
                  onClick={() => onStatusChange('setup')}
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                  ← {t('statusSetup')}
                </button>
                <button
                  onClick={handleArchive}
                  disabled={archiving}
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                  title={t('archiveSeasonHint') || ''}
                >
                  {archiving ? '…' : t('archiveSeason')}
                </button>
              </>
            )}
            {status === 'archived' && (
              <>
                <span className="text-sm italic text-gray-500 dark:text-gray-400">{t('archiveSeasonDone')}</span>
                <button
                  onClick={handleRestore}
                  disabled={restoring}
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                  {restoring ? '…' : t('restoreSeason')}
                </button>
              </>
            )}
          </div>

          {/* Season rollover — only when this season is still empty */}
          {onRollover && canRollover && status !== 'archived' && (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-900/20">
              <p className="text-xs text-amber-800 dark:text-amber-200">
                {t('rolloverHint', { from: previousSeasonShort(season?.season), to: formatSeasonShort(season?.season) })}
              </p>
              <button
                onClick={handleRolloverClick}
                disabled={rollingOver}
                className="mt-2 rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {rollingOver ? '…' : t('rolloverButton', { from: previousSeasonShort(season?.season) })}
              </button>
            </div>
          )}
        </div>
      )}

      {/* SVRZ integration — dense, secondary */}
      {season && onUpdateSeason && (
        <div className="mt-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-gray-600 dark:text-gray-400">{t('svrzSeasonLabel')}</span>
            {svrzOptions.length === 0 ? (
              <span className="text-xs italic text-amber-600 dark:text-amber-400">{t('svrzSeasonEmpty')}</span>
            ) : (
              <>
                <select
                  value={currentSvrzUuid}
                  onChange={(e) => handleSvrzSelect(e.target.value)}
                  disabled={savingSvrz}
                  className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                >
                  <option value="">{t('svrzSeasonNone')}</option>
                  {svrzOptions.map((opt) => (
                    <option key={opt.uuid} value={opt.uuid}>
                      {formatSeasonShort(opt.name)}
                    </option>
                  ))}
                </select>
                {savingSvrz ? (
                  <span className="text-xs text-gray-500">…</span>
                ) : currentSvrzUuid && !svrzMismatch ? (
                  <span className="text-xs text-green-600 dark:text-green-400">✓</span>
                ) : null}
              </>
            )}
          </div>
          <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">{t('svrzSeasonHelp')}</p>
          {svrzMismatch && (
            <p className="mt-1 text-[11px] italic text-amber-600 dark:text-amber-400">
              {t('svrzSeasonMismatchHint', { kscw: kscwShort, svrz: linkedShort })}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
