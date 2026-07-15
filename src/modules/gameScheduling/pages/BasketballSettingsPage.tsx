import { useTranslation } from 'react-i18next'
import ClubBlockedDatesPanel from '../components/ClubBlockedDatesPanel'
import TeamLinksEditor from '../components/TeamLinksEditor'
import { useGameSchedulingSeason } from '../hooks/useGameSchedulingSeason'
import { useBasketballPlan } from '../hooks/useBasketballPlan'

export default function BasketballSettingsPage() {
  const { t } = useTranslation('basketballScheduling')
  const { season, allSeasons, setSeason } = useGameSchedulingSeason()
  const { teams, links, addLink, updateLink, removeLink } = useBasketballPlan(season)

  const selectClass = 'rounded-md border border-border bg-transparent px-3 py-2 text-sm dark:bg-gray-800'

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

      {/* Coach/player-sharing team links (sport-agnostic editor) */}
      <TeamLinksEditor teams={teams} links={links} addLink={addLink} updateLink={updateLink} removeLink={removeLink} />
    </div>
  )
}
