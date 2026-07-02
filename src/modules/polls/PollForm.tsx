import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Plus, X } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface PollFormProps {
  open: boolean
  onClose: () => void
  onSubmit: (data: {
    question: string
    options: string[]
    mode: 'single' | 'multi'
    deadline?: string
    anonymous?: boolean
  }) => void | Promise<void>
}

export default function PollForm({ open, onClose, onSubmit }: PollFormProps) {
  const { t } = useTranslation('polls')
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState(['', ''])
  const [mode, setMode] = useState<'single' | 'multi'>('single')
  const [deadline, setDeadline] = useState('')
  const [anonymous, setAnonymous] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const canSubmit = question.trim().length > 0 && options.filter(o => o.trim()).length >= 2

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit || submitting) return
    setSubmitting(true)
    try {
      // Await so we only reset + close on success — a failed create keeps the
      // dialog open with the typed question/options intact.
      await onSubmit({
        question: question.trim(),
        options: options.filter(o => o.trim()).map(o => o.trim()),
        mode,
        deadline: deadline || undefined,
        anonymous,
      })
      // Reset form
      setQuestion('')
      setOptions(['', ''])
      setMode('single')
      setDeadline('')
      setAnonymous(false)
      onClose()
    } catch {
      toast.error(t('common:errorSaving'))
    } finally {
      setSubmitting(false)
    }
  }

  const addOption = () => setOptions([...options, ''])

  const removeOption = (idx: number) => {
    if (options.length <= 2) return
    setOptions(options.filter((_, i) => i !== idx))
  }

  const updateOption = (idx: number, value: string) => {
    const next = [...options]
    next[idx] = value
    setOptions(next)
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('createPoll')}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Question */}
          <div>
            <label
              htmlFor="poll-question"
              className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              {t('question')}
            </label>
            <input
              id="poll-question"
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={t('questionPlaceholder')}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500 dark:focus:border-blue-400 dark:focus:ring-blue-400"
              autoFocus
            />
          </div>

          {/* Options */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('options')}
            </label>
            <div className="space-y-2">
              {options.map((opt, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={opt}
                    onChange={(e) => updateOption(idx, e.target.value)}
                    placeholder={t('optionPlaceholder', { number: idx + 1 })}
                    aria-label={t('optionPlaceholder', { number: idx + 1 })}
                    className="flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500 dark:focus:border-blue-400 dark:focus:ring-blue-400"
                  />
                  {options.length > 2 && (
                    <button
                      type="button"
                      onClick={() => removeOption(idx)}
                      className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                      title={t('removeOption')}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addOption}
              className="mt-2 flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
            >
              <Plus className="h-3.5 w-3.5" />
              {t('addOption')}
            </button>
          </div>

          {/* Mode toggle */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('mode')}
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMode('single')}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  mode === 'single'
                    ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-400 dark:hover:bg-gray-600'
                }`}
              >
                {t('singleChoice')}
              </button>
              <button
                type="button"
                onClick={() => setMode('multi')}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  mode === 'multi'
                    ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-400 dark:hover:bg-gray-600'
                }`}
              >
                {t('multiChoice')}
              </button>
            </div>
          </div>

          {/* Deadline */}
          <div>
            <label
              htmlFor="poll-deadline"
              className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              {t('deadline')}
            </label>
            <input
              id="poll-deadline"
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:focus:border-blue-400 dark:focus:ring-blue-400"
            />
            {!deadline && (
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t('noDeadline')}</p>
            )}
          </div>

          {/* Anonymous toggle */}
          <div className="flex items-start gap-3">
            <input
              id="poll-anonymous"
              type="checkbox"
              checked={anonymous}
              onChange={(e) => setAnonymous(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
            />
            <div>
              <label
                htmlFor="poll-anonymous"
                className="text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                {t('anonymous')}
              </label>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t('anonymousDescription')}
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common:cancel', 'Cancel')}
            </Button>
            <Button type="submit" disabled={!canSubmit || submitting}>
              {t('createPoll')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
