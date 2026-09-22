import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { kscwApi } from '../../../lib/api'
import { chfOrNull, chf, liveFee, type FeePreview } from '../../../utils/feeCalc'

/** The subset of the Anmeldungen `Registration` shape this panel needs.
 *  Kept local (not imported) — the full interface lives in AnmeldungenPage.tsx
 *  and is not exported. */
interface RegistrationFeeSubject {
  id: string | number
  beitragskategorie: string | null
  lizenz: string | null
  fee_discount: number | null
  fee_discount_pct: number | null
  fee_discount_reason: string | null
}

/**
 * Discount (CHF or %) + note for the Mitgliederbeitrag, plus a live preview of
 * the amount that will actually be pushed to ClubDesk on approval — shown on
 * the registration review screen so an admin sees the real number before the
 * auto-sync fires (see autoSyncRegistrationToClubdesk, kscw-hooks).
 *
 * Participates in the SAME `edits` draft + save flow as every other field on
 * this screen (`onEdit` mirrors field()/setCoded()'s commit semantics) — there
 * is no separate save button here.
 *
 * The preview itself comes from `GET /registration/:id/fee`, which runs the
 * exact same feeBreakdown() engine the ClubDesk CREATE push uses (see that
 * route for why: no finance_dues_rates lookup, isGuest always false). Refetched
 * only when category or licence change — the server-derived base/surcharge —
 * everything else (discount, %, reason) recomputes locally via liveFee().
 */
export default function RegistrationFeePanel({
  reg,
  edits,
  onEdit,
}: {
  reg: RegistrationFeeSubject
  edits: Record<string, string>
  onEdit: (key: string, value: string) => void
}) {
  const { t } = useTranslation('admin')
  const [fee, setFee] = useState<FeePreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const category = edits.beitragskategorie ?? reg.beitragskategorie ?? ''
  const lizenz = edits.lizenz ?? reg.lizenz ?? ''

  // Only ever sets state inside the async callbacks (never synchronously at
  // the top of the effect body — that cascades renders and fails the lint
  // gate; same pattern as ClubdeskRegistrationZone/RegistrationDuplicatePanel).
  // `loading` therefore stays false across a category/licence refetch — the
  // old amount is shown until the new one lands rather than flickering to a
  // spinner, which is the right tradeoff for a preview this cheap.
  useEffect(() => {
    let cancelled = false
    kscwApi<FeePreview>(`/registration/${reg.id}/fee`)
      .then((res) => { if (!cancelled) { setFee(res); setError(false) } })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [reg.id, category, lizenz])

  const discountChf = edits.fee_discount ?? String(reg.fee_discount ?? '')
  const discountPct = edits.fee_discount_pct ?? String(reg.fee_discount_pct ?? '')
  const discountReason = edits.fee_discount_reason ?? reg.fee_discount_reason ?? ''
  const hasChfDiscount = chfOrNull(discountChf) !== null
  const hasPctDiscount = chfOrNull(discountPct) !== null
  const reasonMissing = (hasChfDiscount || hasPctDiscount) && !discountReason.trim()

  const live = liveFee(fee, { fee_discount: discountChf, fee_discount_pct: discountPct })

  const inputClass = 'w-full rounded-md border border-gray-200 bg-transparent px-2.5 py-1.5 text-sm text-gray-900 disabled:opacity-50 dark:border-gray-600 dark:text-gray-100'
  const labelClass = 'mb-0.5 block text-xs font-medium text-gray-500 dark:text-gray-400'

  return (
    <div className="sm:col-span-2 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {t('anmeldungenFeeSectionTitle')}
      </h4>
      <div className="grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-3">
        <div>
          <label className={labelClass}>{t('anmeldungenFeeDiscountChf')}</label>
          <input
            type="number" min={0} max={10000} step="0.05"
            value={discountChf}
            disabled={hasPctDiscount}
            onChange={(e) => {
              onEdit('fee_discount', e.target.value)
              if (e.target.value) onEdit('fee_discount_pct', '')
            }}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>{t('anmeldungenFeeDiscountPct')}</label>
          <input
            type="number" min={0} max={100} step="0.5"
            value={discountPct}
            disabled={hasChfDiscount}
            onChange={(e) => {
              onEdit('fee_discount_pct', e.target.value)
              if (e.target.value) onEdit('fee_discount', '')
            }}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>{t('anmeldungenFeeDiscountReason')}</label>
          <input
            type="text"
            value={discountReason}
            onChange={(e) => onEdit('fee_discount_reason', e.target.value)}
            className={inputClass}
          />
          {reasonMissing && (
            <p className="mt-0.5 text-xs text-red-600 dark:text-red-400">
              {t('explorerFeeDiscountNeedsReasonField')}
            </p>
          )}
        </div>
      </div>

      <div className="mt-3 border-t border-gray-100 pt-2 dark:border-gray-800">
        {loading ? (
          <span className="text-xs text-muted-foreground">{t('anmeldungenFeeLoading')}</span>
        ) : error ? (
          <span className="text-xs text-red-600 dark:text-red-400">{t('anmeldungenFeeError')}</span>
        ) : !fee?.derived || !live ? (
          <span className="text-xs text-muted-foreground">
            {category ? t('anmeldungenFeeNoRate') : t('anmeldungenFeeUnknownCategory')}
          </span>
        ) : (
          <div className="flex flex-col gap-1">
            <span className="text-base font-semibold text-gray-900 dark:text-gray-100">{chf(live.amount)}</span>
            <dl className="flex flex-col gap-0.5 text-xs text-gray-500 dark:text-gray-400">
              <div className="flex items-baseline justify-between gap-3">
                <dt>{t('anmeldungenFeeBase')}</dt>
                <dd>{chf(live.base)}</dd>
              </div>
              {live.surcharge > 0 && (
                <div className="flex items-baseline justify-between gap-3">
                  <dt>{t('anmeldungenFeeSurcharge')}</dt>
                  <dd>{chf(live.surcharge)}</dd>
                </div>
              )}
              {live.discount > 0 && (
                <div className="flex items-baseline justify-between gap-3">
                  <dt>
                    {live.discountPct !== null
                      ? `${t('anmeldungenFeeDiscountLine')} (${live.discountPct}%)`
                      : t('anmeldungenFeeDiscountLine')}
                  </dt>
                  <dd>− {chf(live.discount)}</dd>
                </div>
              )}
            </dl>
          </div>
        )}
      </div>
    </div>
  )
}
