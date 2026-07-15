import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '../../../components/ui/button'
import { useConfirm } from '../../../components/ConfirmProvider'
import ClubBlockedDatesPanel from '../components/ClubBlockedDatesPanel'
import { useGameSchedulingSeason } from '../hooks/useGameSchedulingSeason'
import { useBasketballPlan } from '../hooks/useBasketballPlan'

export default function BasketballSettingsPage() {
  const { t } = useTranslation('basketballScheduling')
  const confirm = useConfirm()
  const { season, allSeasons, setSeason } = useGameSchedulingSeason()
  const { teams, links, addLink, removeLink } = useBasketballPlan(season)

  const [teamA, setTeamA] = useState('')
  const [teamB, setTeamB] = useState('')
  const [linkType, setLinkType] = useState<'same' | 'diff'>('diff')

  const teamName = (id: string | number) => teams.find((tm) => String(tm.id) === String(id))?.name ?? `#${id}`
  const selectClass = 'rounded-md border border-border bg-transparent px-3 py-2 text-sm dark:bg-gray-800'

  async function add() {
    if (!teamA || !teamB || teamA === teamB) return
    try {
      await addLink(teamA, teamB, linkType)
      setTeamA('')
      setTeamB('')
    } catch {
      toast.error(t('saveError'))
    }
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-2xl font-bold">{t('settingsTitle')}</h1>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-muted-foreground">{t('season')}</span>
          <select
            className={selectClass}
            value={season?.id ?? ''}
            onChange={(e) => setSeason(allSeasons.find((s) => String(s.id) === e.target.value) ?? null)}
          >
            {allSeasons.map((s) => (
              <option key={s.id} value={s.id}>{s.season}</option>
            ))}
          </select>
        </label>
      </header>

      {/* Club-wide blocked dates (shared with volleyball) */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">{t('blockedDates')}</h2>
        <ClubBlockedDatesPanel />
      </section>

      {/* Coach/player-sharing team links */}
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">{t('teamLinks')}</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">{t('teamLinksHint')}</p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <select className={selectClass} value={teamA} onChange={(e) => setTeamA(e.target.value)}>
            <option value="">{t('teamA')}</option>
            {teams.map((tm) => (
              <option key={tm.id} value={tm.id}>{tm.name}</option>
            ))}
          </select>
          <select className={selectClass} value={linkType} onChange={(e) => setLinkType(e.target.value as 'same' | 'diff')}>
            <option value="diff">{t('linkDiff')}</option>
            <option value="same">{t('linkSame')}</option>
          </select>
          <select className={selectClass} value={teamB} onChange={(e) => setTeamB(e.target.value)}>
            <option value="">{t('teamB')}</option>
            {teams.map((tm) => (
              <option key={tm.id} value={tm.id}>{tm.name}</option>
            ))}
          </select>
          <Button onClick={add} disabled={!teamA || !teamB || teamA === teamB}>{t('addLink')}</Button>
        </div>

        {links.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noLinks')}</p>
        ) : (
          <ul className="space-y-1">
            {links.map((l) => (
              <li key={l.id} className="flex items-center gap-2 text-sm">
                <span
                  className={`rounded px-2 py-0.5 text-xs ${
                    l.link_type === 'same'
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                      : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                  }`}
                >
                  {l.link_type === 'same' ? t('linkSame') : t('linkDiff')}
                </span>
                <span>{teamName(l.team_a)} ↔ {teamName(l.team_b)}</span>
                <button
                  type="button"
                  className="ml-auto text-xs text-rose-600 hover:underline"
                  onClick={async () => {
                    if (!(await confirm({ message: `${teamName(l.team_a)} ↔ ${teamName(l.team_b)}`, danger: true }))) return
                    await removeLink(l.id)
                  }}
                >
                  {t('remove')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
