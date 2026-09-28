import { useTranslation } from 'react-i18next'
import Modal from '@/components/Modal'
import { Button } from '@/components/ui/button'

export type RecurringEditScope = 'this' | 'all' | 'same_day'

interface RecurringEditDialogProps {
  open: boolean
  onClose: () => void
  onSelect: (scope: RecurringEditScope) => void
}

export default function RecurringEditDialog({ open, onClose, onSelect }: RecurringEditDialogProps) {
  const { t } = useTranslation('trainings')

  return (
    <Modal open={open} onClose={onClose} title={t('editRecurringTitle')} size="sm">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">{t('editRecurringDescription')}</p>
        <button
          onClick={() => onSelect('this')}
          className="w-full rounded-lg border border-border bg-card px-4 py-3 text-left text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t('editThisOnly')}
        </button>
        <button
          onClick={() => onSelect('same_day')}
          className="w-full rounded-lg border border-border bg-card px-4 py-3 text-left text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t('editSameDay')}
        </button>
        <button
          onClick={() => onSelect('all')}
          className="w-full rounded-lg border border-border bg-card px-4 py-3 text-left text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t('editAllRecurring')}
        </button>
        <div className="pt-2">
          <Button
            variant="ghost"
            onClick={onClose}
            className="w-full text-muted-foreground"
          >
            {t('cancelEdit')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
