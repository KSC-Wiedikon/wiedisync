import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatDate } from '../../utils/dateHelpers'
import { useCarpoolBoard, type CarpoolActivityType } from './carpoolApi'
import CarpoolPanel from './CarpoolPanel'

interface CarpoolDialogProps {
  type: CarpoolActivityType
  id: string | number
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * The board on its own, for surfaces that have no detail modal to host the
 * banner (training cards, the Home list) or where opening the full modal would
 * bury it (the chip on a game/event card).
 */
export default function CarpoolDialog({ type, id, open, onOpenChange }: CarpoolDialogProps) {
  const { t } = useTranslation('carpool')
  const { data } = useCarpoolBoard(type, id, open)
  const a = data?.activity
  const typeLabel = t(type === 'game' ? 'typeGame' : type === 'training' ? 'typeTraining' : 'typeEvent')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] w-[calc(100vw-1rem)] max-w-2xl overflow-y-auto rounded-2xl p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>
            {a ? [typeLabel, a.label, a.date ? formatDate(a.date) : null, a.time].filter(Boolean).join(' · ') : typeLabel}
          </DialogDescription>
        </DialogHeader>
        {open && <CarpoolPanel type={type} id={id} standalone />}
      </DialogContent>
    </Dialog>
  )
}
