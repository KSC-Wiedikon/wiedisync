// src/modules/finance/ReceiptButton.tsx
//
// The receipt affordance shared by the three expense views (member uploads,
// board review, TK confirmation). Opens the receipt in the shared previewer —
// photos and PDFs render in place, with download still one click away — instead
// of pushing a file into the Downloads folder just to read an amount off it.

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Receipt } from 'lucide-react'
import { expenseReceiptUrl } from '../../hooks/useFinance'
import { FilePreviewDialog } from '../../components/FilePreview'

export default function ReceiptButton({
  expenseId,
  className,
  iconClassName = 'h-4 w-4',
  showLabel = false,
}: {
  expenseId: string | number
  className?: string
  iconClassName?: string
  showLabel?: boolean
}) {
  const { t } = useTranslation('finance')
  const [open, setOpen] = useState(false)

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className} title={t('expenseReceipt')}>
        <Receipt className={iconClassName} />
        {showLabel && <span className="hidden sm:inline">{t('expenseReceipt')}</span>}
      </button>
      <FilePreviewDialog
        open={open}
        onOpenChange={setOpen}
        url={open ? expenseReceiptUrl(expenseId) : null}
        label={t('expenseReceipt')}
        filename={`expense-receipt-${expenseId}`}
      />
    </>
  )
}
