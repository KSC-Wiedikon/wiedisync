import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BarChart3, ChevronDown, ChevronRight, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import LoadingSpinner from '../../components/LoadingSpinner'
import { usePolls } from './hooks/usePoll'
import PollCard from './PollCard'
import PollForm from './PollForm'

interface PollsSectionProps {
  teamId: string
  canManage: boolean
}

export default function PollsSection({ teamId, canManage }: PollsSectionProps) {
  const { t } = useTranslation('polls')
  const { polls, isLoading, addPoll, closePoll, deletePoll } = usePolls(teamId)
  const [showForm, setShowForm] = useState(false)
  const [showClosed, setShowClosed] = useState(false)

  const openPolls = polls.filter(p => p.status === 'open')
  const closedPolls = polls.filter(p => p.status === 'closed')

  return (
    <section>
      {/* Section header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-gray-600 dark:text-gray-400" />
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {t('title')}
          </h3>
          {openPolls.length > 0 && (
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900 dark:text-blue-300">
              {openPolls.length}
            </span>
          )}
        </div>
        {canManage && (
          <Button size="sm" variant="outline" onClick={() => setShowForm(true)}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            {t('createPoll')}
          </Button>
        )}
      </div>

      {/* Loading */}
      {isLoading && <LoadingSpinner size="sm" />}

      {/* Empty state */}
      {!isLoading && polls.length === 0 && (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 py-8 text-center dark:border-gray-600 dark:bg-gray-800/50">
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{t('noPolls')}</p>
          <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">{t('noPollsDescription')}</p>
        </div>
      )}

      {/* Active polls */}
      {openPolls.length > 0 && (
        <div className="space-y-3">
          {openPolls.map(poll => (
            <PollCard
              key={poll.id}
              poll={poll}
              canManage={canManage}
              onClose={closePoll}
              onDelete={deletePoll}
            />
          ))}
        </div>
      )}

      {/* Closed polls (collapsible) */}
      {closedPolls.length > 0 && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setShowClosed(!showClosed)}
            className="flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
          >
            {showClosed ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            {t('closedPolls')} ({closedPolls.length})
          </button>
          {showClosed && (
            <div className="mt-3 space-y-3">
              {closedPolls.map(poll => (
                <PollCard
                  key={poll.id}
                  poll={poll}
                  canManage={canManage}
                  onClose={closePoll}
                  onDelete={deletePoll}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Create poll form */}
      <PollForm open={showForm} onClose={() => setShowForm(false)} onSubmit={addPoll} />
    </section>
  )
}
