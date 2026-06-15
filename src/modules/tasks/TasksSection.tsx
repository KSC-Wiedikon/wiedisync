import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ListTodo, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '../../hooks/useAuth'
import { useConfirm } from '../../components/ConfirmProvider'
import { useTasks, useTaskTemplates } from './hooks/useTasks'
import TaskCard from './TaskCard'
import TaskForm from './TaskForm'
import type { TaskTemplate } from '../../types'

interface TasksSectionProps {
  activityType: 'game' | 'training' | 'event'
  activityId: string
  teamId?: string
  canManage: boolean
  members?: Array<{ id: string; first_name: string; last_name: string }>
}

export default function TasksSection({
  activityType,
  activityId,
  teamId,
  canManage,
  members,
}: TasksSectionProps) {
  const { t } = useTranslation('tasks')
  const confirm = useConfirm()
  const { user } = useAuth()
  const { tasks, addTask, removeTask, claimTask, unclaimTask, toggleComplete } = useTasks(
    activityType,
    activityId,
  )
  const { templates } = useTaskTemplates(teamId)
  const [formOpen, setFormOpen] = useState(false)

  const handleSubmit = useCallback(
    (label: string, category?: string) => {
      addTask(label, category)
    },
    [addTask],
  )

  const handleApplyTemplate = useCallback(
    (template: TaskTemplate) => {
      if (!template.tasks_json) return
      for (const item of template.tasks_json) {
        addTask(item.label, item.category || undefined)
      }
    },
    [addTask],
  )

  const handleDelete = useCallback(
    async (taskId: string) => {
      if (await confirm({ message: t('confirmDelete'), danger: true })) {
        removeTask(taskId)
      }
    },
    [removeTask, t, confirm],
  )

  const completedCount = tasks.filter((t) => t.completed).length
  const canAdd = canManage || !!user

  return (
    <section className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ListTodo className="h-5 w-5 text-gray-500 dark:text-gray-400" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {t('title')}
          </h3>
          {tasks.length > 0 && (
            <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
              {completedCount}/{tasks.length}
            </span>
          )}
        </div>

        {canAdd && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setFormOpen(true)}
            className="gap-1"
          >
            <Plus className="h-4 w-4" />
            {t('addTask')}
          </Button>
        )}
      </div>

      {/* Task list */}
      {tasks.length > 0 ? (
        <div className="space-y-2">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onToggleComplete={toggleComplete}
              onClaim={claimTask}
              onUnclaim={unclaimTask}
              onDelete={handleDelete}
              currentUserId={user?.id}
              canManage={canManage}
              members={members}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-gray-300 px-4 py-6 text-center dark:border-gray-600">
          <ListTodo className="mx-auto mb-2 h-8 w-8 text-gray-300 dark:text-gray-600" />
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
            {t('noTasks')}
          </p>
          <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
            {t('noTasksDescription')}
          </p>
        </div>
      )}

      {/* Add task form modal */}
      <TaskForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSubmit={handleSubmit}
        templates={templates}
        onApplyTemplate={handleApplyTemplate}
      />
    </section>
  )
}
