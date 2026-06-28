import { useTranslation } from 'react-i18next'
import { BarChart3 } from 'lucide-react'
import { useActivePolls } from './hooks/usePoll'
import PollCard from './PollCard'

interface HomePollsCardProps {
  teamIds: string[]
  /** Returns whether the current user manages (coach/TR/admin of) the given team. */
  canManage: (teamId: string) => boolean
}

/**
 * Home-screen card listing open, still-actionable polls for the user's teams.
 * Renders nothing when there are none. Mirrors the "Forms to fill" card so
 * surveys are discoverable without digging into each team page.
 */
export default function HomePollsCard({ teamIds, canManage }: HomePollsCardProps) {
  const { t } = useTranslation('polls')
  const { polls, closePoll, deletePoll } = useActivePolls(teamIds)

  if (polls.length === 0) return null

  return (
    <div className="mb-6 lg:flex lg:flex-col lg:items-center">
      <div className="w-full overflow-hidden rounded-xl border border-gray-200 bg-white lg:max-w-2xl dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-2.5 dark:border-gray-700">
          <BarChart3 className="h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400" />
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t('activePolls')}</h2>
          <span className="ml-auto rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
            {polls.length}
          </span>
        </div>
        <div className="space-y-3 p-4">
          {polls.map((poll) => (
            <PollCard
              key={poll.id}
              poll={poll}
              canManage={canManage(String(poll.team))}
              onClose={closePoll}
              onDelete={deletePoll}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
