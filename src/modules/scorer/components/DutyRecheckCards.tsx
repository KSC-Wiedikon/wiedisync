import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, CalendarClock, Check, Hand, Search, UserPlus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ConfirmProvider'
import { hasApiErrorCode } from '@/lib/apiErrorCode'
import { kscwApi } from '../../../lib/api'
import { useInvalidate } from '../../../lib/query'
import { DUTY_ROLE_LABEL_KEYS } from '../../../hooks/useMyDuties'
import {
  DUTY_RECHECK_QUERY_KEY, useDutyRecheck,
  type DutyRecheckGame, type DutyRecheckQuestion, type DutySeatToFill,
} from '../../../hooks/useDutyRecheck'
import DutyReplacementModal from './DutyReplacementModal'

const SHELL = 'rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-card dark:border-amber-800 dark:bg-amber-950/40'

function GameLines({ game }: { game: DutyRecheckGame }) {
  return (
    <p className="mt-1 break-words text-sm text-foreground">{game.home_team} – {game.away_team}</p>
  )
}

function whenText(game: DutyRecheckGame): string {
  const when = [game.date, game.time].filter(Boolean).join(', ')
  return [when, game.hall].filter(Boolean).join(' · ')
}

/**
 * Moved home games: the question to the person on the seat, the open seats anybody can
 * take, and what the game team's leaders still have to find. Renders nothing when there
 * is nothing to do. Shown on the home page and on /scorer.
 */
export default function DutyRecheckCards({ onChanged }: { onChanged?: () => void }) {
  const { t } = useTranslation('scorer')
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const invalidate = useInvalidate()
  const { data } = useDutyRecheck()
  const [busy, setBusy] = useState<string | null>(null)
  const [filling, setFilling] = useState<DutySeatToFill | null>(null)

  const roleOf = (role: string) => t(DUTY_ROLE_LABEL_KEYS[role] ?? role)

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: DUTY_RECHECK_QUERY_KEY })
    // The seat is on the game row: anything showing "my duties" has to read it again.
    invalidate('games')
    onChanged?.()
  }

  async function answer(q: DutyRecheckQuestion, value: 'yes' | 'no') {
    if (value === 'no' && q.kind === 'ask' && !(await confirm({
      message: t('recheckCannotConfirm', { role: roleOf(q.role) }),
      confirmLabel: t('recheckCannot'),
      danger: true,
    }))) return
    setBusy(`q${q.id}`)
    try {
      await kscwApi(`/duty-recheck/${q.id}/answer`, { method: 'POST', body: { answer: value } })
      if (q.kind === 'ask') toast.success(t(value === 'yes' ? 'recheckYesDone' : 'recheckNoDone'))
      else toast.success(t(value === 'yes' ? 'inviteYesDone' : 'inviteNoDone'))
    } catch (err) {
      toast.error(t(
        hasApiErrorCode(err, 'duty_clash') ? 'selfAssignClash'
          : hasApiErrorCode(err, 'seat_taken') ? 'recheckSeatGone'
            : 'recheckError',
      ))
    } finally {
      setBusy(null)
      refresh()
    }
  }

  async function take(gameId: number, role: string, label: string) {
    if (!(await confirm({
      message: t('openSeatConfirm', { role: roleOf(role), game: label }),
      confirmLabel: t('openSeatTake'),
    }))) return
    setBusy(`s${gameId}-${role}`)
    try {
      await kscwApi(`/games/${gameId}/duty-claim`, { method: 'POST', body: { role } })
      toast.success(t('openSeatTaken'))
    } catch (err) {
      toast.error(t(hasApiErrorCode(err, 'duty_clash') ? 'selfAssignClash' : 'openSeatError'))
    } finally {
      setBusy(null)
      refresh()
    }
  }

  const questions = data?.questions ?? []
  const openSeats = data?.open_seats ?? []
  const toFill = data?.to_fill ?? []
  if (questions.length + openSeats.length + toFill.length === 0) return null

  return (
    <div className="mb-6 lg:flex lg:flex-col lg:items-center">
      <div className="w-full space-y-3 lg:max-w-2xl">
        {questions.map((q) => (
          <div key={q.id} className={SHELL}>
            <div className="flex items-start gap-3">
              <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-foreground">
                  {t(q.kind === 'ask' ? 'recheckTitle' : 'inviteTitle')}
                </h3>
                <GameLines game={q} />
                <p className="mt-1 text-sm text-muted-foreground">
                  {q.kind === 'ask'
                    ? t('recheckBody', { role: roleOf(q.role) })
                    : t('inviteBody', { by: q.by ?? '', role: roleOf(q.role) })}
                </p>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 text-xs">
                  {q.was && (
                    <>
                      <dt className="text-muted-foreground">{t('recheckWas')}</dt>
                      <dd className="text-muted-foreground line-through">{q.was}</dd>
                      <dt className="font-medium text-foreground">{t('recheckNow')}</dt>
                    </>
                  )}
                  {!q.was && <dt className="font-medium text-foreground">{t('recheckWhen')}</dt>}
                  <dd className="font-medium text-foreground">{whenText(q)}</dd>
                </dl>
                {q.clash && (
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-300">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    {t('recheckClash')}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => answer(q, 'yes')}
                    icon={<Check aria-hidden />}
                    className="bg-green-600 text-white hover:bg-green-700 dark:bg-green-600 dark:hover:bg-green-500"
                  >
                    {t('recheckCan')}
                  </Button>
                  <Button type="button" variant="outline" disabled={busy !== null} onClick={() => answer(q, 'no')} icon={<X aria-hidden />}>
                    {t('recheckCannot')}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ))}

        {toFill.map((s) => (
          <div key={`${s.game}-${s.role}-${s.state}`} className={SHELL}>
            <div className="flex items-start gap-3">
              <UserPlus className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-foreground">
                  {t(s.state === 'open' ? 'fillTitle' : 'fillSilentTitle')}
                </h3>
                <GameLines game={s} />
                <p className="text-xs text-muted-foreground">{whenText(s)}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {s.state === 'open'
                    ? t('fillBody', { role: roleOf(s.role) })
                    : t('fillSilentBody', { holder: s.holder ?? '', role: roleOf(s.role) })}
                </p>
                {s.invited.length > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('fillAskedNames', { names: s.invited.map((i) => i.name).join(', ') })}
                  </p>
                )}
                {s.state === 'open' && (
                  <Button type="button" className="mt-3" onClick={() => setFilling(s)} icon={<Search aria-hidden />}>
                    {t('fillButton')}
                  </Button>
                )}
              </div>
            </div>
          </div>
        ))}

        {openSeats.map((s) => {
          const label = `${s.home_team} – ${s.away_team}`
          return (
            <div key={`${s.game}-${s.role}`} className={SHELL}>
              <div className="flex items-start gap-3">
                <Hand className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-foreground">{t('openSeatTitle', { role: roleOf(s.role) })}</h3>
                  <GameLines game={s} />
                  <p className="text-xs text-muted-foreground">{whenText(s)}</p>
                  <Button
                    type="button"
                    className="mt-3"
                    disabled={busy !== null}
                    onClick={() => take(s.game, s.role, label)}
                    icon={<Check aria-hidden />}
                  >
                    {t('openSeatTake')}
                  </Button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {filling && (
        <DutyReplacementModal
          seat={filling}
          roleLabel={roleOf(filling.role)}
          onClose={() => setFilling(null)}
          onAsked={refresh}
        />
      )}
    </div>
  )
}
