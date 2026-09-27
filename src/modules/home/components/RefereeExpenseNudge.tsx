import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import type { Game, Team, BaseRecord } from '../../../types'
import { useAuth } from '../../../hooks/useAuth'
import { useMissingRefereeExpenses, type NudgeGame } from '../../../hooks/useMissingRefereeExpenses'
import { formatDate, formatTime } from '../../../utils/dateHelpers'
import { asObj } from '../../../utils/relations'
import { Button } from '@/components/ui/button'

interface RefereeExpenseNudgeProps {
  /** Opens the game's detail modal — the caller sets `focus="refereeExpense"` so the section lands expanded. */
  onOpenGame: (game: Game) => void
}

// ⚠ Keyed per MEMBER and per GAME, not per device (same reasoning as the IBAN
// nudge, migration 348): a household guardian switches children on one phone,
// and a device-global key would hide one child's prompt for the other.
const dismissKey = (userId: string, gameId: string) => `wiedisync_ref_expense_nudge:${userId}:${gameId}`

/**
 * Home banner for coaches / team responsibles: a volleyball HOME game of their
 * team has ended and nobody has recorded who paid the referees. One row per
 * game; "Record now" opens GameDetailModal with the Referee expenses section
 * already open, "Not now" hides that one game on this device. Renders null
 * when there is nothing to nudge about (and issues no requests for non-leaders
 * — the hook's `enabled` handles that).
 */
export default function RefereeExpenseNudge({ onOpenGame }: RefereeExpenseNudgeProps) {
  const { t } = useTranslation('home')
  const { user } = useAuth()
  const { games } = useMissingRefereeExpenses()
  const userId = user?.id ?? 'anon'

  // localStorage is an external store the linter cannot see; `bump` is what
  // makes this re-read after a dismiss (a useState initialiser would run once
  // and carry a previous child's dismissals across a household switch).
  const [bump, setBump] = useState(0)
  const visible = useMemo(() => games.filter((g) => {
    try { return localStorage.getItem(dismissKey(userId, String(g.id))) !== '1' } catch { return true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [games, userId, bump])

  const dismiss = (g: NudgeGame) => {
    try { localStorage.setItem(dismissKey(userId, String(g.id)), '1') } catch { /* ignore */ }
    setBump((n) => n + 1)
  }

  if (visible.length === 0) return null

  return (
    <div className="mb-6 lg:flex lg:flex-col lg:items-center">
      <div className="w-full rounded-xl border border-amber-300 bg-amber-50 p-4 lg:max-w-2xl dark:border-amber-700/60 dark:bg-amber-900/20">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-100">
              {t('refExpenseNudgeTitle')}
            </h3>
            <p className="mt-1 text-sm text-amber-800 dark:text-amber-200/90">
              {t('refExpenseNudgeBody')}
            </p>
            <ul className="mt-3 divide-y divide-amber-200/80 dark:divide-amber-800/60">
              {visible.map((g) => {
                const team = asObj<Team & BaseRecord>(g.kscw_team)
                const when = `${g.date ? formatDate(g.date) : ''}${g.time ? ` · ${formatTime(g.time)}` : ''}`
                return (
                  <li key={g.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-medium text-amber-900 dark:text-amber-100">
                        {g.home_team} – {g.away_team}
                      </p>
                      <p className="text-xs text-amber-700/90 dark:text-amber-300/80">
                        {when}{team?.name ? ` · ${team.name}` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2 sm:ml-auto">
                      <Button
                        onClick={() => onOpenGame(g)}
                        className="bg-amber-600 text-white shadow-sm hover:bg-amber-700 dark:bg-amber-500 dark:text-amber-950 dark:hover:bg-amber-400"
                      >
                        {t('refExpenseNudgeCta')}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => dismiss(g)}
                        className="text-amber-700 hover:bg-amber-100 hover:text-amber-800 dark:text-amber-300 dark:hover:bg-amber-900/40 dark:hover:text-amber-200"
                      >
                        {t('ibanNudgeDismiss')}
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
