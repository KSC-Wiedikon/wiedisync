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
import IconButton from '@/components/IconButton'
import DatePicker from '@/components/ui/DatePicker'

interface PollFormProps {
  open: boolean
  onClose: () => void
  onSubmit: (data: {
    question: string
    options: string[]
    mode: 'single' | 'multi'
    deadline?: string
    anonymous?: boolean
    results_visible?: boolean
  }) => void | Promise<void>
}

export default function PollForm({ open, onClose, onSubmit }: PollFormProps) {
  const { t } = useTranslation('polls')
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState(['', ''])
  const [mode, setMode] = useState<'single' | 'multi'>('single')
  const [deadline, setDeadline] = useState('')
  const [anonymous, setAnonymous] = useState(false)
  // Default ON — everyone sees the totals unless the creator opts out.
  const [resultsVisible, setResultsVisible] = useState(true)
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
        results_visible: resultsVisible,
      })
      // Reset form
      setQuestion('')
      setOptions(['', ''])
      setMode('single')
      setDeadline('')
      setAnonymous(false)
      setResultsVisible(true)
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
              className="mb-1.5 block text-xs font-medium text-muted-foreground"
            >
              {t('question')}
            </label>
            <input
              id="poll-question"
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={t('questionPlaceholder')}
              className="h-11 w-full sm:h-9 rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/70 dark:bg-input/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              autoFocus
            />
          </div>

          {/* Options */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
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
                    className="h-11 min-w-0 flex-1 sm:h-9 rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/70 dark:bg-input/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  {options.length > 2 && (
                    <IconButton
                      type="button"
                      label={t('removeOption')}
                      onClick={() => removeOption(idx)}
                      className="shrink-0 text-muted-foreground/80 hover:bg-accent hover:text-foreground"
                    >
                      <X />
                    </IconButton>
                  )}
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={addOption}
              icon={<Plus />}
              className="mt-2 -ml-3 gap-1 text-sm text-primary hover:text-primary/90 dark:text-brand-300 dark:hover:text-brand-200"
            >
              {t('addOption')}
            </Button>
          </div>

          {/* Mode toggle */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              {t('mode')}
            </label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setMode('single')}
                className={`px-3 ${
                  mode === 'single'
                    ? 'border border-transparent bg-selected text-selected-foreground hover:bg-selected/90 hover:text-selected-foreground'
                    : 'border border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
              >
                {t('singleChoice')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setMode('multi')}
                className={`px-3 ${
                  mode === 'multi'
                    ? 'border border-transparent bg-selected text-selected-foreground hover:bg-selected/90 hover:text-selected-foreground'
                    : 'border border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
              >
                {t('multiChoice')}
              </Button>
            </div>
          </div>

          {/* Deadline */}
          <div>
            <DatePicker
              id="poll-deadline"
              label={t('deadline')}
              value={deadline}
              onChange={setDeadline}
            />
            {!deadline && (
              <p className="mt-1 text-xs text-muted-foreground">{t('noDeadline')}</p>
            )}
          </div>

          {/* Anonymous toggle */}
          <div className="flex items-start gap-3">
            <input
              id="poll-anonymous"
              type="checkbox"
              checked={anonymous}
              onChange={(e) => setAnonymous(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-input accent-[var(--primary)] focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div>
              <label
                htmlFor="poll-anonymous"
                className="text-sm font-medium text-foreground/85"
              >
                {t('anonymous')}
              </label>
              <p className="text-xs text-muted-foreground">
                {t('anonymousDescription')}
              </p>
            </div>
          </div>

          {/* Results visibility toggle */}
          <div className="flex items-start gap-3">
            <input
              id="poll-results-visible"
              type="checkbox"
              checked={resultsVisible}
              onChange={(e) => setResultsVisible(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-input accent-[var(--primary)] focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div>
              <label
                htmlFor="poll-results-visible"
                className="text-sm font-medium text-foreground/85"
              >
                {t('resultsVisible')}
              </label>
              <p className="text-xs text-muted-foreground">
                {t('resultsVisibleDescription')}
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
