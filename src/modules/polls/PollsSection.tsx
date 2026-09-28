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
        <div className="flex min-w-0 items-center gap-2">
          <BarChart3 className="h-5 w-5 text-muted-foreground" />
          <h3 className="text-base font-semibold text-foreground">
            {t('title')}
          </h3>
          {openPolls.length > 0 && (
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
              {openPolls.length}
            </span>
          )}
        </div>
        {canManage && (
          <Button size="sm" variant="outline" onClick={() => setShowForm(true)} icon={<Plus />} className="shrink-0">
            {t('createPoll')}
          </Button>
        )}
      </div>

      {/* Loading */}
      {isLoading && <LoadingSpinner size="sm" />}

      {/* Empty state */}
      {!isLoading && polls.length === 0 && (
        <div className="rounded-2xl border border-dashed border-input bg-surface-sunken py-8 text-center">
          <p className="text-sm font-medium text-muted-foreground">{t('noPolls')}</p>
          <p className="mt-1 text-xs text-muted-foreground/80">{t('noPollsDescription')}</p>
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
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowClosed(!showClosed)}
            icon={showClosed ? <ChevronDown /> : <ChevronRight />}
            aria-expanded={showClosed}
            className="-ml-3 gap-1.5 text-sm text-muted-foreground hover:text-foreground/85"
          >
            {t('closedPolls')} ({closedPolls.length})
          </Button>
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
