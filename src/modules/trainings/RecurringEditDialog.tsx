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
        <p className="text-sm text-gray-600 dark:text-gray-400">{t('editRecurringDescription')}</p>
        <button
          onClick={() => onSelect('this')}
          className="w-full rounded-lg border px-4 py-3 text-left text-sm font-medium text-gray-900 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-100 dark:hover:bg-gray-700"
        >
          {t('editThisOnly')}
        </button>
        <button
          onClick={() => onSelect('same_day')}
          className="w-full rounded-lg border px-4 py-3 text-left text-sm font-medium text-gray-900 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-100 dark:hover:bg-gray-700"
        >
          {t('editSameDay')}
        </button>
        <button
          onClick={() => onSelect('all')}
          className="w-full rounded-lg border px-4 py-3 text-left text-sm font-medium text-gray-900 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-100 dark:hover:bg-gray-700"
        >
          {t('editAllRecurring')}
        </button>
        <div className="pt-2">
          <Button
            variant="ghost"
            onClick={onClose}
            className="w-full text-gray-500 dark:text-gray-400"
          >
            {t('cancelEdit')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
