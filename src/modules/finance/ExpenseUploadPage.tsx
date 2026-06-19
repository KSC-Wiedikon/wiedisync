import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Upload, Loader2, FileText, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FormInput, FormTextarea } from '@/components/FormField'
import { useAuth } from '../../hooks/useAuth'
import { kscwApi, uploadFile } from '../../lib/api'
import { isValidIban, normalizeIban } from '../../utils/iban'

type Step = 'idle' | 'uploading' | 'scanning' | 'review' | 'submitting'

interface Extracted {
  amount: number | null
  currency: string
  date: string | null
  vendor: string | null
  description: string | null
  reference: string | null
  payee_iban: string | null
}

const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp'

export default function ExpenseUploadPage() {
  const { t } = useTranslation('finance')
  const { user } = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<Step>('idle')
  const [fileId, setFileId] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const [scanFailed, setScanFailed] = useState(false)
  const [error, setError] = useState('')

  // Review form fields
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState('CHF')
  const [date, setDate] = useState('')
  const [vendor, setVendor] = useState('')
  const [description, setDescription] = useState('')
  const [reference, setReference] = useState('')
  const [payToIban, setPayToIban] = useState('')
  const [note, setNote] = useState('')

  function resetForm() {
    setStep('idle')
    setFileId(null)
    setFileName('')
    setScanFailed(false)
    setError('')
    setAmount(''); setCurrency('CHF'); setDate(''); setVendor('')
    setDescription(''); setReference(''); setPayToIban(''); setNote('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function prefill(ex: Extracted) {
    setAmount(ex.amount != null ? String(ex.amount) : '')
    setCurrency(ex.currency || 'CHF')
    setDate(ex.date || '')
    setVendor(ex.vendor || '')
    setDescription(ex.description || '')
    setReference(ex.reference || '')
    // Payout IBAN is the MEMBER's own account, not the vendor's — pre-fill from profile.
    setPayToIban(user?.iban || '')
  }

  async function handleFile(file: File) {
    setError('')
    setScanFailed(false)
    setStep('uploading')
    try {
      const { id, name } = await uploadFile(file)
      setFileId(id)
      setFileName(name)
      setStep('scanning')
      try {
        const { extracted } = await kscwApi<{ extracted: Extracted }>('/expenses/ocr', {
          method: 'POST',
          body: { fileId: id },
        })
        prefill(extracted)
      } catch {
        // OCR is best-effort — fall back to manual entry.
        setScanFailed(true)
        setPayToIban(user?.iban || '')
      }
      setStep('review')
    } catch {
      setError(t('expenseError'))
      setStep('idle')
    }
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) void handleFile(file)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const amountNum = Number(amount.replace(',', '.'))
    if (!amount.trim() || Number.isNaN(amountNum) || amountNum <= 0) {
      setError(t('expenseAmountRequired'))
      return
    }
    if (payToIban.trim() && !isValidIban(payToIban)) {
      setError(t('expenseInvalidIban'))
      return
    }
    setStep('submitting')
    try {
      await kscwApi('/expenses/submit', {
        method: 'POST',
        body: {
          fileId,
          amount: amountNum,
          currency: currency.trim().toUpperCase() || 'CHF',
          date,
          vendor,
          description,
          reference,
          payToIban: payToIban.trim() ? normalizeIban(payToIban) : '',
          note,
        },
      })
      toast.success(t('expenseSuccess'))
      resetForm()
    } catch {
      setError(t('expenseError'))
      setStep('review')
    }
  }

  const busy = step === 'uploading' || step === 'scanning'

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t('expenseTitle')}</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t('expenseSubtitle')}</p>
      </div>

      {/* Upload / scanning state */}
      {step !== 'review' && step !== 'submitting' && (
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT}
            onChange={onPick}
            className="sr-only"
            disabled={busy}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            className="flex min-h-[140px] w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 px-4 py-8 text-center transition-colors hover:border-brand-400 hover:bg-brand-50/40 disabled:cursor-not-allowed disabled:opacity-70 dark:border-gray-600 dark:hover:border-brand-500 dark:hover:bg-brand-900/20"
          >
            {busy ? (
              <>
                <Loader2 className="h-7 w-7 animate-spin text-brand-500" />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {step === 'uploading' ? t('expenseUploading') : t('expenseScanning')}
                </span>
              </>
            ) : (
              <>
                <Upload className="h-7 w-7 text-gray-400" />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('expensePickFile')}</span>
                <span className="text-xs text-gray-400 dark:text-gray-500">{t('expensePickHint')}</span>
              </>
            )}
          </button>
          {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>
      )}

      {/* Review + submit */}
      {(step === 'review' || step === 'submitting') && (
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* File chip */}
          <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800">
            <FileText className="h-4 w-4 shrink-0 text-gray-400" />
            <span className="min-w-0 flex-1 truncate text-gray-700 dark:text-gray-300">{fileName}</span>
            <button
              type="button"
              onClick={resetForm}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-700"
            >
              <X className="h-3.5 w-3.5" />
              {t('expenseChangeFile')}
            </button>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t('expenseReviewTitle')}</h2>
            {scanFailed ? (
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">{t('expenseScanFailed')}</p>
            ) : (
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t('expenseReviewHint')}</p>
            )}

            <div className="mt-4 space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <FormInput
                    label={t('expenseAmount')}
                    type="text"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
                <FormInput
                  label={t('expenseCurrency')}
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))}
                  maxLength={3}
                />
              </div>
              <FormInput label={t('expenseDate')} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              <FormInput label={t('expenseVendor')} value={vendor} onChange={(e) => setVendor(e.target.value)} />
              <FormInput label={t('expenseDescription')} value={description} onChange={(e) => setDescription(e.target.value)} />
              <FormInput label={t('expenseReference')} value={reference} onChange={(e) => setReference(e.target.value)} />
              <FormInput
                label={t('expensePayToIban')}
                value={payToIban}
                onChange={(e) => setPayToIban(e.target.value)}
                placeholder="CH00 0000 0000 0000 0000 0"
                helperText={t('expensePayToIbanHint')}
              />
              <FormTextarea label={t('expenseNote')} value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
            </div>
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <Button type="submit" disabled={step === 'submitting'} className="w-full sm:w-auto">
            {step === 'submitting' ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t('expenseSubmitting')}</>
            ) : (
              t('expenseSubmit')
            )}
          </Button>
        </form>
      )}
    </div>
  )
}
