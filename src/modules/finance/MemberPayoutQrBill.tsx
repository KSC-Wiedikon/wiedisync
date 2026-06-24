import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SwissQRCode } from 'swissqrbill/svg'
import { QrCode, ShieldAlert, Download, Loader2 } from 'lucide-react'
import { isValidIban } from '../../utils/iban'
import { formatChf } from '../../hooks/useFinance'
import type { FinanceMember } from '../../hooks/useFinance'

/**
 * Per-member "pay-out" QR-bill: a Swiss QR with the payee as creditor. The
 * treasurer can set the amount + message BEFORE generating (baked into the QR →
 * scan-and-go), or leave the amount blank to type it when scanning. Renders on a
 * white background (scannable contrast) and downloads as a PDF for upload to UBS
 * e-banking. Payee = the billing contact (billing_iban + billing name/address)
 * when billing_different + a billing IBAN is set, else the member's own IBAN.
 */
const isChLiIban = (iban: string) => /^(CH|LI)/.test(iban) && isValidIban(iban)
const fmtIban = (iban: string) => iban.replace(/(.{4})/g, '$1 ').trim()
const cleanIban = (s?: string | null) => (s ?? '').replace(/\s/g, '').toUpperCase()

/** The club is the payer on a reimbursement — shown as "Payable by" on the slip. */
const CLUB_DEBTOR = { name: 'Kantonsschulsportclub Wiedikon', address: 'Schrennengasse 7', zip: 8003, city: 'Zürich', country: 'CH' } as const

export default function MemberPayoutQrBill({ member }: { member: FinanceMember }) {
  const { t } = useTranslation('finance')
  const [open, setOpen] = useState(false)
  const [amountStr, setAmountStr] = useState('')
  const [message, setMessage] = useState('')
  const [pdfBusy, setPdfBusy] = useState(false)

  const memberName = [member.first_name, member.last_name].filter(Boolean).join(' ').trim()
  const useBilling = !!member.billing_different && !!cleanIban(member.billing_iban)
  const iban = cleanIban(useBilling ? member.billing_iban : member.iban)
  const name = useBilling ? (member.billing_name?.trim() || memberName) : memberName
  const street = useBilling ? member.billing_address : member.adresse
  const zip = useBilling ? member.billing_plz : member.plz
  const city = useBilling ? member.billing_ort : member.ort
  const hasAddress = !!zip && !!city
  const canRender = isChLiIban(iban) && !!name && hasAddress
  const unconfirmed = !useBilling && !!member.iban && !member.iban_confirmed

  const amount = useMemo(() => {
    const n = Math.round(Number(amountStr.replace(',', '.')) * 100) / 100
    return Number.isFinite(n) && n > 0 ? n : undefined
  }, [amountStr])

  const svg = useMemo(() => {
    if (!open || !canRender) return null
    try {
      return new SwissQRCode({
        currency: 'CHF',
        ...(amount ? { amount } : {}),
        creditor: { account: iban, name, address: street || name, zip: Number(zip), city: city as string, country: 'CH' },
        ...(message.trim() ? { message: message.trim().slice(0, 140) } : {}),
      }).toString()
    } catch {
      return null
    }
  }, [open, canRender, iban, name, street, zip, city, amount, message])

  async function downloadPdf() {
    if (!canRender) return
    setPdfBusy(true)
    try {
      const MM = 2.834645669 // mm → pt (pdfkit unit)
      // pdfkit's self-contained browser bundle (fonts + zlib inlined → no node polyfills);
      // swissqrbill draws the official payment part onto it as TRUE vector (selectable text).
      const [pdfkitMod, swissMod] = await Promise.all([
        import('pdfkit/js/pdfkit.standalone.js'),
        import('swissqrbill/pdf'),
      ])
      const PDFDocument = ((pdfkitMod as { default?: unknown }).default ?? pdfkitMod) as new (o: unknown) => Record<string, (...a: unknown[]) => unknown> & { page: { height: number }; on: (e: string, cb: (c: BlobPart) => void) => void }
      const SwissQRBill = (swissMod as { SwissQRBill: new (d: unknown, o?: unknown) => { attachTo: (doc: unknown) => void } }).SwissQRBill
      const doc = new PDFDocument({ size: 'A4', margin: 0 })
      const chunks: BlobPart[] = []
      doc.on('data', (c: BlobPart) => chunks.push(c))
      const done = new Promise<void>((resolve) => doc.on('end', () => resolve()))
      ;(doc.fontSize as (n: number) => { text: (s: string, x: number, y: number) => void }).call(doc, 13).text(`${t('payoutPdfTitle')} — ${name}`, 20 * MM, 20 * MM)
      if (amount) (doc.fontSize as (n: number) => { text: (s: string, x: number, y: number) => void }).call(doc, 10).text(`${t('payoutAmount')}: ${formatChf(amount)}`, 20 * MM, 28 * MM)
      new SwissQRBill({
        currency: 'CHF',
        ...(amount ? { amount } : {}),
        creditor: { account: iban, name, address: street || name, zip: Number(zip), city: city as string, country: 'CH' },
        debtor: { ...CLUB_DEBTOR },
        ...(message.trim() ? { message: message.trim().slice(0, 140) } : {}),
      }, { language: 'DE' }).attachTo(doc) // payment part at the A4 bottom (default position)
      ;(doc.end as () => void).call(doc)
      await done
      const url = URL.createObjectURL(new Blob(chunks, { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `payout-${name.replace(/\s+/g, '-')}.pdf`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
    } catch {
      toastError()
    } finally {
      setPdfBusy(false)
    }
  }
  function toastError() { import('sonner').then(({ toast }) => toast.error(t('payoutQrError'))) }

  if (!iban) return null

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
        <QrCode className="h-4 w-4" /> {t('payoutQrTitle')}
      </h3>
      <p className="font-mono text-sm text-gray-900 dark:text-gray-100">{fmtIban(iban)}</p>
      {useBilling && <p className="mt-0.5 text-xs font-medium text-brand-600 dark:text-brand-300">{t('payoutToBilling', { name })}</p>}
      {unconfirmed && (
        <p className="mt-0.5 flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
          <ShieldAlert className="h-3.5 w-3.5" /> {t('payoutUnconfirmed')}
        </p>
      )}

      {!isChLiIban(iban) ? (
        <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{t('payoutQrNonCh')}</p>
      ) : !hasAddress ? (
        <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{t('payoutQrNeedsAddress')}</p>
      ) : (
        <>
          {/* Amount + message — set before generating so the scan is ready to pay. */}
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">{t('payoutAmount')}</span>
              <input
                inputMode="decimal" value={amountStr} onChange={(e) => setAmountStr(e.target.value)}
                placeholder={t('payoutAmountPlaceholder')}
                className="w-full rounded-md border border-gray-200 bg-transparent px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">{t('payoutMessage')}</span>
              <input
                value={message} onChange={(e) => setMessage(e.target.value)} maxLength={140}
                className="w-full rounded-md border border-gray-200 bg-transparent px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
            </label>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => setOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              <QrCode className="h-4 w-4" /> {open ? t('payoutQrHide') : t('payoutQrShow')}
            </button>
            {canRender && (
              <button
                onClick={downloadPdf} disabled={pdfBusy}
                className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 dark:bg-brand-500 dark:hover:bg-brand-400"
              >
                {pdfBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                {pdfBusy ? t('payoutGenerating') : t('payoutDownloadPdf')}
              </button>
            )}
          </div>

          {open && svg && (
            <div className="mt-3">
              {/* The QR SVG has a fixed 46mm size, so center the white card that hugs
                  it (w-fit) rather than stretching the svg — black-on-white, scannable. */}
              <div className="flex justify-center">
                <div className="w-fit rounded-lg bg-white p-4 text-black" dangerouslySetInnerHTML={{ __html: svg }} />
              </div>
              <p className="mt-2 text-center text-xs text-gray-400 dark:text-gray-500">
                {amount ? t('payoutQrHintAmount', { amount: formatChf(amount) }) : t('payoutQrHint')}
              </p>
            </div>
          )}
          {open && !svg && <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">{t('payoutQrError')}</p>}
        </>
      )}
    </section>
  )
}
