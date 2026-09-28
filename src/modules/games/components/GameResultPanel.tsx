import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Minus, Plus, RotateCw } from 'lucide-react'
import { toast } from 'sonner'
import type { Game } from '../../../types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { kscwApi } from '../../../lib/api'
import { useConfirm } from '../../../components/ConfirmProvider'
import { formatDateTimeCompactZurich, gameKickoffMs } from '../../../utils/dateHelpers'
import { pickResultPrefill, setsEqual, validateSets, vmReasonKey, type SetScore } from '../../../utils/gameResult'

/**
 * Result entry for a played volleyball game (migration 395): the opponent's
 * VolleyManager report, our own, and one set-score form whose single action is
 * "Confirm result" (matches the opponent), "Report result" (nobody reported yet),
 * or — only when it differs from the opponent — "Report ours anyway" behind a
 * danger confirm, because two differing reports mean VM makes no result and SVRZ
 * reads the paper sheet.
 *
 * Asks `/kscw/game-result/:id` only from kickoff + 3 h to kickoff + 14 d (the
 * endpoint's own window) — its GET can read VolleyManager, and every game modal
 * must not do that. Who may report is the live-scoring set; the endpoint decides.
 */
const OPENS_AFTER_MS = 3 * 60 * 60 * 1000
const CLOSES_AFTER_MS = 14 * 24 * 60 * 60 * 1000
/** While the worker pushes: re-read this often, this many times. */
const POLL_MS = 8000
const POLL_MAX = 12

type VmStatus = NonNullable<Game['vm_result_status']>

interface ReportSets { sets: SetScore[]; home: number; away: number }

interface ResultInfo {
  can_report: boolean
  code: string | null
  official: boolean
  game: { home_score: number | null; away_score: number | null; sets_json: unknown }
  provisional: (ReportSets & { source: string | null; by_name: string | null; at: string | null }) | null
  vm: {
    status: VmStatus | null
    error: string | null
    pushed_at: string | null
    checked_at: string | null
    opponent: (ReportSets & { reported_at?: string | null; party?: string | null }) | null
    own: (ReportSets & { reported_at?: string | null }) | null
    reportable: boolean | null
    needed_sets: 2 | 3 | null
  }
  live: (ReportSets & { final: boolean }) | null
}

type FormSet = { home: string; away: string }

const NOTICE = 'rounded-lg border px-3 py-2 text-xs font-medium'
const NOTICE_SKY = 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-300'
const NOTICE_AMBER = 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300'

/** The "Provisional" pill next to a not-yet-official score (cards, modal, rankings). */
export function ProvisionalPill({ className }: { className?: string }) {
  const { t } = useTranslation('live')
  return (
    <span className={cn(
      'inline-flex items-center whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium leading-none text-amber-700 dark:border-amber-800/60 dark:bg-amber-900/30 dark:text-amber-300',
      className,
    )}>
      {t('result_provisional')}
    </span>
  )
}

function setsLine(r: ReportSets): string {
  return `${r.home}:${r.away} (${r.sets.map((s) => `${s.home}:${s.away}`).join(', ')})`
}

function toForm(sets: SetScore[]): FormSet[] {
  return sets.map((s) => ({ home: String(s.home), away: String(s.away) }))
}

function emptyForm(n: number): FormSet[] {
  return Array.from({ length: n }, () => ({ home: '', away: '' }))
}

function parseForm(form: FormSet[]): SetScore[] {
  // An empty field is NaN, which validateSets reports as `not_integer`.
  return form.map((s) => ({
    home: s.home.trim() === '' ? Number.NaN : Number(s.home),
    away: s.away.trim() === '' ? Number.NaN : Number(s.away),
  }))
}

/** The form's first content — the order and the "ours over theirs" rule live in pickResultPrefill. */
function prefill(info: ResultInfo): { form: FormSet[]; from: 'opponent' | 'live' | null } {
  const p = pickResultPrefill({ opponent: info.vm.opponent, own: info.vm.own, provisional: info.provisional, live: info.live })
  return {
    form: p.sets ? toForm(p.sets) : emptyForm(info.vm.needed_sets ?? 3),
    // Our own report needs no "filled in from" note: the conflict block says it all.
    from: p.from === 'own' ? null : p.from,
  }
}

interface Props {
  game: Game
  sport: 'volleyball' | 'basketball' | undefined
  homeLabel: string
  awayLabel: string
  /** After a save: the modal reloads the game so the score block shows the result. */
  onSaved?: () => void
}

export default function GameResultPanel({ game, sport, homeLabel, awayLabel, onSaved }: Props) {
  const { t } = useTranslation('live')
  const confirm = useConfirm()
  const [info, setInfo] = useState<ResultInfo | null>(null)
  const [form, setForm] = useState<FormSet[]>([])
  const [prefilledFrom, setPrefilledFrom] = useState<'opponent' | 'live' | null>(null)
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [polls, setPolls] = useState(0)

  // Read once per mount: the modal is short-lived, and the endpoint re-checks anyway.
  const [now] = useState(() => Date.now())
  const kickoff = gameKickoffMs(game.date, game.time)
  const inWindow = kickoff != null && now >= kickoff + OPENS_AFTER_MS && now <= kickoff + CLOSES_AFTER_MS
  const enabled = sport === 'volleyball' && !!game.kscw_team && inWindow
  const gameId = String(game.id)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    kscwApi<ResultInfo>(`/game-result/${gameId}`)
      .then((r) => {
        if (cancelled) return
        setInfo(r)
        // A re-read (after a save / while polling) keeps what the member typed.
        if (reloadKey === 0) {
          const p = prefill(r)
          setForm(p.form)
          setPrefilledFrom(p.from)
        }
      })
      .catch(() => { /* no panel — the modal works without it */ })
    return () => { cancelled = true }
  }, [enabled, gameId, reloadKey])

  // Follow the background push until it settles — bounded, the modal is short-lived.
  const pending = info?.vm.status === 'pending'
  useEffect(() => {
    if (!pending || polls >= POLL_MAX) return
    const id = window.setTimeout(() => {
      setPolls((n) => n + 1)
      setReloadKey((k) => k + 1)
    }, POLL_MS)
    return () => window.clearTimeout(id)
  }, [pending, polls])

  const parsed = useMemo(() => parseForm(form), [form])
  const validation = useMemo(() => validateSets(parsed, info?.vm.needed_sets ?? null), [parsed, info?.vm.needed_sets])
  const allFilled = form.length > 0 && form.every((s) => s.home.trim() !== '' && s.away.trim() !== '')

  if (!enabled || !info) return null
  if (!info.can_report) return null

  const title = (
    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t('result_title')}</p>
  )

  if (info.official) {
    const sets = Array.isArray(info.game.sets_json) ? (info.game.sets_json as SetScore[]) : []
    return (
      <div className="rounded-xl border border-hairline bg-surface-sunken p-3.5">
        {title}
        <p className="mt-1 text-sm text-foreground">
          {t('result_official')}
          {info.game.home_score != null && (
            <span className="ml-1.5 font-semibold tabular-nums">
              {setsLine({ home: Number(info.game.home_score), away: Number(info.game.away_score), sets })}
            </span>
          )}
        </p>
      </div>
    )
  }

  const opponent = info.vm.opponent
  const own = info.vm.own
  const matchesOpponent = !!opponent && validation.ok && setsEqual(parsed, opponent.sets)
  // What we reported before, when it is not what the opponent reported. Switching
  // the form to theirs then REPLACES our report — the button must say so.
  const ourEarlier = info.provisional?.source === 'own' && info.provisional.sets.length ? info.provisional.sets : own?.sets ?? null
  const replacesOurs = matchesOpponent && !!ourEarlier?.length && !setsEqual(ourEarlier, opponent!.sets)
  const conflict = !!opponent && validation.ok && !matchesOpponent
  const showError = !validation.ok && (touched || allFilled)
  const errorText = validation.error
    ? t(`result_invalid_${validation.error}`, { n: validation.set ?? '' })
    : ''
  const maxSets = (info.vm.needed_sets ?? 3) * 2 - 1

  const edit = (i: number, side: 'home' | 'away', value: string) => {
    const clean = value.replace(/[^0-9]/g, '').slice(0, 2)
    setTouched(true)
    setPrefilledFrom(null)
    setForm((f) => f.map((s, j) => (j === i ? { ...s, [side]: clean } : s)))
  }

  async function submit(force: boolean) {
    if (!validation.ok) { setTouched(true); return }
    if (force && !(await confirm({ message: t('result_conflictConfirm'), danger: true, confirmLabel: t('result_reportAnyway') }))) return
    setSaving(true)
    try {
      const res = await kscwApi<{ ok: boolean; vm?: { status?: VmStatus | null; error?: string | null } }>(`/game-result/${gameId}`, {
        method: 'POST',
        body: { sets: parsed, ...(force ? { force: true } : {}) },
      })
      // The result is stored either way; a VM skip (derby, not configured, queued for
      // the night window, …) is a 200 with a reason, explained under the toast.
      const reasonKey = vmReasonKey(res.vm?.error)
      if (reasonKey === 'result_reason_queued_window') toast.success(t(reasonKey))
      else if (res.vm?.status === 'pending') toast.success(t('result_saved'))
      else toast.success(t('result_savedLocal'), reasonKey ? { description: t(reasonKey) } : undefined)
      setPolls(0)
      setReloadKey((k) => k + 1)
      onSaved?.()
    } catch (e) {
      const code = (e as { code?: string }).code
      toast.error(code ? t(`result_err_${code}`, t('result_saveFailed')) : t('result_saveFailed'))
      // A conflict / official / busy answer means our picture is stale — re-read it.
      if (code) setReloadKey((k) => k + 1)
    } finally {
      setSaving(false)
    }
  }

  const status = info.vm.status
  const reasonKey = vmReasonKey(info.vm.error)
  const statusLine = status ? (
    <div className="flex flex-wrap items-center gap-2">
      <p className="min-w-0 flex-1 text-xs text-muted-foreground">
        <span>{t(`result_vm_${status}`)}</span>
        {info.vm.pushed_at && (status === 'reported' || status === 'confirmed') && (
          <span className="tabular-nums"> · {formatDateTimeCompactZurich(info.vm.pushed_at)}</span>
        )}
        {reasonKey && status !== 'reported' && status !== 'confirmed' && (
          <span className="block break-words">{t(reasonKey)}</span>
        )}
      </p>
      {status === 'failed' && (
        <Button size="sm" variant="outline" onClick={() => submit(false)} loading={saving} icon={<RotateCw />}>
          {t('result_retry')}
        </Button>
      )}
    </div>
  ) : null

  return (
    <div className="space-y-3 rounded-xl border border-hairline bg-surface-sunken p-3.5">
      {title}

      {opponent && (
        <div className={cn(NOTICE, NOTICE_SKY)}>
          <span>{t('result_opponentReport')}: </span>
          <span className="tabular-nums">{setsLine(opponent)}</span>
        </div>
      )}
      {own && (
        <p className="text-xs text-muted-foreground">
          {t('result_ourReport')}: <span className="tabular-nums text-foreground/85">{setsLine(own)}</span>
        </p>
      )}

      {prefilledFrom && (
        <p className="text-xs text-muted-foreground">
          {prefilledFrom === 'opponent' ? t('result_prefill_opponent') : t('result_prefill_live')}
        </p>
      )}

      {/* Set grid: label | home | away. Names wrap above their column. */}
      <div className="grid grid-cols-[3.5rem_minmax(0,1fr)_minmax(0,1fr)] items-end gap-x-2 gap-y-1.5">
        <span />
        <span className="break-words text-center text-xs font-medium leading-snug text-muted-foreground">{homeLabel}</span>
        <span className="break-words text-center text-xs font-medium leading-snug text-muted-foreground">{awayLabel}</span>
        {form.map((s, i) => (
          <SetRow
            key={i}
            index={i}
            set={s}
            homeLabel={homeLabel}
            awayLabel={awayLabel}
            onChange={edit}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          icon={<Plus />}
          disabled={form.length >= maxSets}
          onClick={() => { setTouched(true); setForm((f) => [...f, { home: '', away: '' }]) }}
        >
          {t('result_addSet')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          icon={<Minus />}
          disabled={form.length <= 1}
          onClick={() => { setTouched(true); setForm((f) => f.slice(0, -1)) }}
        >
          {t('result_removeSet')}
        </Button>
        {validation.ok && (
          <span className="ml-auto text-xs font-semibold tabular-nums text-foreground">
            {t('result_setsWon', { home: validation.home, away: validation.away })}
          </span>
        )}
      </div>

      {showError && <p className="text-xs font-medium text-destructive">{errorText}</p>}

      {conflict && opponent && (
        <div className={cn(NOTICE, NOTICE_AMBER, 'space-y-0.5')}>
          <p className="font-semibold">{t('result_conflictTitle')}</p>
          <p className="tabular-nums">{t('result_conflictTheirs')}: {setsLine(opponent)}</p>
          <p className="tabular-nums">{t('result_conflictOurs')}: {setsLine({ ...validation, sets: parsed })}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {conflict ? (
          <>
            <Button variant="outline" onClick={() => { setTouched(true); setForm(toForm(opponent!.sets)) }}>
              {t('result_useOpponent')}
            </Button>
            <Button variant="danger-outline" onClick={() => submit(true)} loading={saving} disabled={pending}>
              {t('result_reportAnyway')}
            </Button>
          </>
        ) : (
          <Button onClick={() => submit(false)} loading={saving} disabled={pending || (!validation.ok && touched)}>
            {matchesOpponent ? t('result_confirm') : t('result_report')}
          </Button>
        )}
      </div>
      {replacesOurs && <p className="text-xs text-muted-foreground">{t('result_replacesOurs')}</p>}

      {statusLine}
    </div>
  )
}

function SetRow({ index, set, homeLabel, awayLabel, onChange }: {
  index: number
  set: FormSet
  homeLabel: string
  awayLabel: string
  onChange: (i: number, side: 'home' | 'away', value: string) => void
}) {
  const { t } = useTranslation('live')
  return (
    <>
      <span className="text-xs font-medium text-muted-foreground">{t('set', { n: index + 1 })}</span>
      <Input
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        className="text-center tabular-nums"
        value={set.home}
        onChange={(e) => onChange(index, 'home', e.target.value)}
        aria-label={t('result_setInput', { n: index + 1, team: homeLabel })}
      />
      <Input
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        className="text-center tabular-nums"
        value={set.away}
        onChange={(e) => onChange(index, 'away', e.target.value)}
        aria-label={t('result_setInput', { n: index + 1, team: awayLabel })}
      />
    </>
  )
}
