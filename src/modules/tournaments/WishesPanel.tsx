import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import DatePicker from '@/components/ui/DatePicker'
import { formatDateCompact } from '../../utils/dateHelpers'
import { toDateKey } from '../../utils/dateUtils'
import { useAddWish, useRemoveWish, useSaveTeamPrefs, type TournamentTeam, type TournamentWish, type TournamentsResponse } from './tournamentsApi'

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10)

/**
 * Weekend wishes (migration 400): new tournament batches open the moment they
 * are published, so a coach names the weekends the team wants to play and the
 * registration worker picks the first open tournament of that weekend —
 * skipping the team's places to avoid. Admins also choose which teams the
 * page shows (MU8 organises elsewhere).
 */
export default function WishesPanel({ data }: { data: TournamentsResponse }) {
  const { t } = useTranslation('tournaments')
  return (
    <section className="space-y-4 rounded-2xl border border-hairline bg-card p-4 shadow-card">
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-foreground">{t('wishesTitle')}</h2>
        <p className="max-w-prose text-sm text-muted-foreground">{t('wishesHint')}</p>
      </div>
      {data.teams.map((team) => (
        <TeamWishes key={team.id} team={team} wishes={data.wishes.filter((w) => w.team === team.id)} />
      ))}
      {data.admin && <ShownTeams data={data} />}
    </section>
  )
}

function TeamWishes({ team, wishes }: { team: TournamentTeam; wishes: TournamentWish[] }) {
  const { t } = useTranslation('tournaments')
  const addWish = useAddWish()
  const removeWish = useRemoveWish()
  const savePrefs = useSaveTeamPrefs()
  const [today] = useState(() => toDateKey(new Date()))
  const [date, setDate] = useState('')
  const [place, setPlace] = useState('')

  const onError = () => toast.error(t('saveError'))
  const add = () => {
    if (!date) return
    addWish.mutate({ team: team.id, date }, { onSuccess: () => setDate(''), onError })
  }
  const setAvoid = (avoid: string[], then?: () => void) =>
    savePrefs.mutate({ team: team.id, avoid }, { onSuccess: then, onError })
  const addPlace = () => {
    const p = place.trim()
    if (p.length < 2 || team.avoid.some((a) => a.toLowerCase() === p.toLowerCase())) return
    setAvoid([...team.avoid, p], () => setPlace(''))
  }

  return (
    <div className="space-y-3 border-t border-hairline pt-4">
      <h3 className="text-sm font-semibold text-foreground">{team.name}</h3>

      {wishes.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('wishNone')}</p>
      ) : (
        <ul className="divide-y divide-hairline">
          {wishes.map((w) => {
            const weekend = t('weekend', { sat: formatDateCompact(addDays(w.week_start, 5)), sun: formatDateCompact(addDays(w.week_start, 6)) })
            return (
              <li key={w.id} className="flex items-center gap-3 py-1">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium tabular-nums text-foreground">{weekend}</div>
                  <div
                    className={cn(
                      'text-xs',
                      w.state === 'registered' ? 'text-green-700 dark:text-green-400'
                        : w.state === 'picked' ? 'text-amber-700 dark:text-amber-400'
                          : 'text-muted-foreground',
                    )}
                  >
                    {w.state === 'waiting'
                      ? t('wishWaiting')
                      : t(w.state === 'registered' ? 'wishRegistered' : 'wishPicked', {
                        club: w.tournament?.host_club ?? '',
                        date: w.tournament ? formatDateCompact(w.tournament.date) : '',
                      })}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-11 shrink-0"
                  aria-label={t('wishRemove', { weekend })}
                  disabled={removeWish.isPending}
                  onClick={() => removeWish.mutate(w.id, { onError })}
                >
                  <X className="h-4 w-4" aria-hidden />
                </Button>
              </li>
            )
          })}
        </ul>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <DatePicker value={date} onChange={setDate} min={today} label={t('wishDate')} className="sm:w-56" />
        <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" disabled={!date || addWish.isPending} onClick={add}>
          {t('wishAdd')}
        </Button>
      </div>

      <div className="space-y-2">
        <div className="text-sm font-medium text-foreground">{t('avoidTitle')}</div>
        <p className="max-w-prose text-xs text-muted-foreground">{t('avoidHint')}</p>
        {team.avoid.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {team.avoid.map((a) => (
              <li key={a} className="inline-flex items-center gap-1 rounded-full border border-input bg-surface-sunken py-0.5 pl-3 pr-1 text-sm text-foreground">
                {a}
                <button
                  type="button"
                  className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-card hover:text-foreground disabled:opacity-50"
                  aria-label={t('avoidRemove', { place: a })}
                  disabled={savePrefs.isPending}
                  onClick={() => setAvoid(team.avoid.filter((x) => x !== a))}
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex gap-2"
          onSubmit={(e) => { e.preventDefault(); addPlace() }}
        >
          <Input
            value={place}
            onChange={(e) => setPlace(e.target.value)}
            placeholder={t('avoidPlaceholder')}
            aria-label={t('avoidTitle')}
            maxLength={60}
            className="min-w-0 flex-1 sm:max-w-xs"
          />
          <Button type="submit" variant="outline" className="min-h-11 sm:min-h-9" disabled={place.trim().length < 2 || savePrefs.isPending}>
            {t('avoidAdd')}
          </Button>
        </form>
      </div>
    </div>
  )
}

/** Admin: which tournament teams the page shows. */
function ShownTeams({ data }: { data: TournamentsResponse }) {
  const { t } = useTranslation('tournaments')
  const savePrefs = useSaveTeamPrefs()
  const all = [
    ...data.teams.map((x) => ({ id: x.id, name: x.name, shown: true })),
    ...data.hidden_teams.map((x) => ({ id: x.id, name: x.name, shown: false })),
  ].sort((a, b) => a.name.localeCompare(b.name))
  return (
    <div className="space-y-2 border-t border-hairline pt-4">
      <h3 className="text-sm font-semibold text-foreground">{t('shownTitle')}</h3>
      <p className="max-w-prose text-xs text-muted-foreground">{t('shownHint')}</p>
      <div className="flex flex-wrap gap-x-6 gap-y-1">
        {all.map((x) => (
          <label key={x.id} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-foreground">
            <Switch
              checked={x.shown}
              disabled={savePrefs.isPending}
              onCheckedChange={(on) => savePrefs.mutate({ team: x.id, hidden: !on }, { onError: () => toast.error(t('saveError')) })}
            />
            {x.name}
          </label>
        ))}
      </div>
    </div>
  )
}
