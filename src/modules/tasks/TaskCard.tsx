import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, X, User } from 'lucide-react'
import type { Task, TaskCategory } from '../../types'
import { disambiguateFirstNames, memberDisplayName, memberFirstName } from '../../utils/relations'

interface TaskCardProps {
  task: Task
  onToggleComplete: (id: string) => void
  onClaim: (id: string) => void
  onUnclaim: (id: string) => void
  onDelete: (id: string) => void
  currentUserId?: string
  canManage: boolean
  members?: Array<{ id: string; first_name: string; last_name: string; nickname?: string | null }>
}

const categoryColors: Record<TaskCategory, string> = {
  setup: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  equipment: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300',
  food: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300',
  firstAid: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
  other: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
}

export default function TaskCard({
  task,
  onToggleComplete,
  onClaim,
  onUnclaim,
  onDelete,
  currentUserId,
  canManage,
  members,
}: TaskCardProps) {
  const { t } = useTranslation('tasks')

  const claimedMember = members?.find((m) => m.id === task.claimed_by)
  const assignedMember = members?.find((m) => m.id === task.assigned_to)
  const displayMember = claimedMember || assignedMember
  // Disambiguate across the task list's members so two "Luca"s read "Luca C."
  const displayNames = useMemo(() => disambiguateFirstNames(members ?? []), [members])
  const isClaimed = !!task.claimed_by
  const isClaimedByMe = task.claimed_by === currentUserId

  return (
    <div
      className={`flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors ${
        task.completed
          ? 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50'
          : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'
      }`}
    >
      {/* Checkbox */}
      <button
        type="button"
        onClick={() => onToggleComplete(task.id)}
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${
          task.completed
            ? 'border-green-500 bg-green-500 text-white dark:border-green-400 dark:bg-green-400'
            : 'border-gray-300 bg-white hover:border-gray-400 dark:border-gray-600 dark:bg-gray-700 dark:hover:border-gray-500'
        }`}
        title={task.completed ? t('markIncomplete') : t('markComplete')}
      >
        {task.completed && <Check className="h-3.5 w-3.5" />}
      </button>

      {/* Label */}
      <span
        className={`flex-1 text-sm ${
          task.completed
            ? 'text-gray-400 line-through dark:text-gray-500'
            : 'text-gray-900 dark:text-gray-100'
        }`}
      >
        {task.label}
      </span>

      {/* Category badge */}
      {task.category && task.category in categoryColors && (
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
            categoryColors[task.category as TaskCategory]
          }`}
        >
          {t(`categories.${task.category}`)}
        </span>
      )}

      {/* Claimed / assigned avatar or Claim button */}
      {displayMember ? (
        <span
          className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700 dark:bg-gray-700 dark:text-gray-300"
          title={memberDisplayName(displayMember)}
        >
          <User className="h-3 w-3" />
          {displayNames.get(String(displayMember.id)) ?? memberFirstName(displayMember)}
        </span>
      ) : isClaimed ? (
        // Claimed by someone not in the members list
        <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700 dark:bg-gray-700 dark:text-gray-300">
          <User className="h-3 w-3" />
        </span>
      ) : (
        !task.completed && currentUserId && (
          <button
            type="button"
            onClick={() => onClaim(task.id)}
            className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-100 dark:bg-blue-900/50 dark:text-blue-300 dark:hover:bg-blue-900"
          >
            {t('claimTask')}
          </button>
        )
      )}

      {/* Unclaim button (if claimed by me) */}
      {isClaimedByMe && !task.completed && (
        <button
          type="button"
          onClick={() => onUnclaim(task.id)}
          className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-400 dark:hover:bg-gray-600"
        >
          {t('unclaimTask')}
        </button>
      )}

      {/* Delete button */}
      {canManage && (
        <button
          type="button"
          onClick={() => onDelete(task.id)}
          className="shrink-0 rounded p-1 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:text-gray-500 dark:hover:bg-red-900/30 dark:hover:text-red-400"
          title={t('deleteTask')}
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}
