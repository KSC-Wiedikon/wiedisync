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
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

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
      {/* Dense-tier control (table cells): 36px on a phone, 32px from sm. With
          showLabel the text only appears from sm, so on a phone it is icon-sized. */}
      <Button
        type="button"
        variant="ghost"
        size={showLabel ? 'sm' : 'icon-sm'}
        onClick={() => setOpen(true)}
        title={t('expenseReceipt')}
        aria-label={t('expenseReceipt')}
        className={cn('text-muted-foreground hover:text-foreground', showLabel && 'max-sm:w-9 max-sm:px-0', className)}
      >
        <Receipt className={iconClassName} />
        {showLabel && <span className="hidden sm:inline">{t('expenseReceipt')}</span>}
      </Button>
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
