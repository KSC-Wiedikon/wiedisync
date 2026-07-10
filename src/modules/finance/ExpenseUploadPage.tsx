import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile'
import { Upload, Loader2, FileText, X, Receipt } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import SearchableSelect from '@/components/ui/SearchableSelect'
import DatePicker from '@/components/ui/DatePicker'
import { FormInput, FormTextarea } from '@/components/FormField'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAuth } from '../../hooks/useAuth'
import { kscwApi, uploadFile } from '../../lib/api'
import { isValidIban, normalizeIban } from '../../utils/iban'
import { formatAmountCH, parseAmount } from '../../utils/amount'
import { CURRENCY_OPTIONS } from '../../utils/currencies'
import { useMyExpenses, openExpenseReceipt, formatExpenseAmount } from '../../hooks/useFinance'
import { ExpenseStatusBadge } from './expenseShared'
import { formatDateCompactZurich } from '../../utils/dateHelpers'
import { TourPageButton } from '../guide/TourPageButton'

// Public Cloudflare Turnstile site key (same widget the sign-up + scheduling pages use).
const TURNSTILE_SITE_KEY = '0x4AAAAAACoYmx3xiDfRbmv9'

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

/** The member's own submissions with their pending / paid / rejected status. */
function MyExpensesTable() {
  const { t } = useTranslation('finance')
  const { data } = useMyExpenses()
  const rows = data ?? []
  if (rows.length === 0) return null
  return (
    <div data-tour="expense-submissions" className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t('expenseMineTitle')}</h2>
      <div className="mt-2 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('expenseDate')}</TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('expenseAmount')}</TableHead>
              <TableHead className="hidden sm:table-cell text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('expenseVendor')}</TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('expenseStatusCol')}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((e) => (
              <TableRow key={e.id} className="min-h-[44px]">
                <TableCell className="text-sm text-gray-500 dark:text-gray-400">
                  {e.date_created ? formatDateCompactZurich(e.date_created) : '—'}
                </TableCell>
                <TableCell className="text-sm font-medium tabular-nums text-gray-900 dark:text-gray-100">
                  {formatExpenseAmount(e)}
                </TableCell>
                <TableCell className="hidden sm:table-cell whitespace-normal break-words text-sm text-gray-700 dark:text-gray-300">
                  {e.vendor || e.description || '—'}
                </TableCell>
                <TableCell>
                  <ExpenseStatusBadge status={e.status} />
                  {e.finance_note && (
                    <p className="mt-1 whitespace-normal break-words text-xs text-gray-500 dark:text-gray-400">{e.finance_note}</p>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {e.file && (
                    <button
                      type="button"
                      onClick={() => void openExpenseReceipt(e.id).catch(() => toast.error(t('expenseReceiptError')))}
                      className="inline-flex min-h-[44px] items-center gap-1 rounded-md px-2 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                      title={t('expenseReceipt')}
                    >
                      <Receipt className="h-4 w-4" />
                      <span className="hidden sm:inline">{t('expenseReceipt')}</span>
                    </button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

export default function ExpenseUploadPage() {
  const { t } = useTranslation('finance')
  const { user } = useAuth()
  const qc = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const turnstileRef = useRef<TurnstileInstance>(null)

  const [step, setStep] = useState<Step>('idle')
  const [fileId, setFileId] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const [scanFailed, setScanFailed] = useState(false)
  const [error, setError] = useState('')
  const [turnstileToken, setTurnstileToken] = useState('')

  // Review form fields
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState('CHF')
  const [date, setDate] = useState('')
  const [vendor, setVendor] = useState('')
  const [description, setDescription] = useState('')
  const [reference, setReference] = useState('')
  const [payToIban, setPayToIban] = useState('')
  const [note, setNote] = useState('')
  const [alreadyPaid, setAlreadyPaid] = useState(false)

  function resetForm() {
    setStep('idle')
    setFileId(null)
    setFileName('')
    setScanFailed(false)
    setError('')
    setAmount(''); setCurrency('CHF'); setDate(''); setVendor('')
    setDescription(''); setReference(''); setPayToIban(''); setNote(''); setAlreadyPaid(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
    turnstileRef.current?.reset()
    setTurnstileToken('')
  }

  function prefill(ex: Extracted) {
    setAmount(formatAmountCH(ex.amount))
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
          body: { fileId: id, turnstile_token: turnstileToken },
        })
        prefill(extracted)
      } catch (ocrErr) {
        // Rate-limited (5/hour): don't silently fall back — tell the member.
        if ((ocrErr as { status?: number })?.status === 429) {
          setError(t('expenseRateLimited'))
          turnstileRef.current?.reset()
          setTurnstileToken('')
          setStep('idle')
          return
        }
        // Otherwise OCR is best-effort — fall back to manual entry.
        setScanFailed(true)
        setPayToIban(user?.iban || '')
      }
      // The Turnstile token is single-use; refresh it for any later scan.
      turnstileRef.current?.reset()
      setTurnstileToken('')
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
    const amountNum = parseAmount(amount)
    if (amountNum == null || amountNum <= 0) {
      setError(t('expenseAmountRequired'))
      return
    }
    // A reimbursement needs an account to pay to — require a valid IBAN before send.
    if (!payToIban.trim()) {
      setError(t('expenseIbanRequired'))
      return
    }
    if (!isValidIban(payToIban)) {
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
          payToIban: normalizeIban(payToIban),
          note,
          memberAlreadyPaid: alreadyPaid,
        },
      })
      toast.success(t('expenseSuccess'))
      resetForm()
      void qc.invalidateQueries({ queryKey: ['finance', 'my-expenses'] })
    } catch {
      setError(t('expenseError'))
      setStep('review')
    }
  }

  const busy = step === 'uploading' || step === 'scanning'

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 sm:p-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t('expenseTitle')}</h1>
          <TourPageButton />
        </div>
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
            data-tour="expense-upload"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy || !turnstileToken}
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
          {/* Bot check — gates the OCR (vision) call. Button stays disabled until passed. */}
          {!busy && (
            <div className="mt-3 flex flex-col items-center gap-1">
              <Turnstile
                ref={turnstileRef}
                siteKey={TURNSTILE_SITE_KEY}
                onSuccess={setTurnstileToken}
                onExpire={() => setTurnstileToken('')}
                onError={() => setTurnstileToken('')}
                options={{ size: 'flexible' }}
              />
              {!turnstileToken && (
                <span className="text-xs text-gray-400 dark:text-gray-500">{t('expenseVerifyFirst')}</span>
              )}
            </div>
          )}
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
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
                <div className="sm:col-span-3">
                  <FormInput
                    label={t('expenseAmount')}
                    type="text"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    onBlur={() => {
                      // Reformat to 1'398.98 on blur; leave unparseable text
                      // untouched so the submit-time validation can flag it.
                      const formatted = formatAmountCH(amount)
                      if (formatted) setAmount(formatted)
                    }}
                    placeholder="0.00"
                  />
                </div>
                <div className="sm:col-span-2">
                  <SearchableSelect
                    label={t('expenseCurrency')}
                    options={CURRENCY_OPTIONS}
                    value={currency}
                    onChange={setCurrency}
                    searchPlaceholder={t('expenseCurrencySearch')}
                  />
                </div>
              </div>
              <DatePicker label={t('expenseDate')} value={date} onChange={setDate} />
              <FormInput label={t('expenseVendor')} value={vendor} onChange={(e) => setVendor(e.target.value)} />
              <FormInput label={t('expenseDescription')} value={description} onChange={(e) => setDescription(e.target.value)} />
              <FormInput label={t('expenseReference')} value={reference} onChange={(e) => setReference(e.target.value)} />
              <FormInput
                data-tour="expense-iban"
                label={t('expenseReimburseIban')}
                value={payToIban}
                onChange={(e) => setPayToIban(e.target.value)}
                placeholder="CH00 0000 0000 0000 0000 0"
                helperText={user?.iban ? t('expenseReimburseIbanHint') : t('expenseReimburseIbanHintEmpty')}
              />
              <FormTextarea label={t('expenseNote')} value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
              <label className="flex items-start gap-2.5 text-sm text-gray-700 dark:text-gray-300">
                <Checkbox
                  className="mt-0.5"
                  checked={alreadyPaid}
                  onCheckedChange={(v) => setAlreadyPaid(v === true)}
                />
                <span>
                  {t('expenseAlreadyPaid')}
                  <span className="mt-0.5 block text-xs text-gray-400 dark:text-gray-500">{t('expenseAlreadyPaidHint')}</span>
                </span>
              </label>
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

      {/* Previously submitted expenses + their status */}
      <MyExpensesTable />
    </div>
  )
}
