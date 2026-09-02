import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '../../components/Modal'
import { Button } from '../../components/ui/button'
import { createRecord } from '../../lib/api'
import { useFineQuote, formatFineAmount } from '../../hooks/useFines'
import type { Fine, FineActivityType, FineCategory } from '../../types'

interface IssueFineModalProps {
  open: boolean
  onClose: () => void
  /** `null` = fine the team itself (migration 350) — no member owes it. */
  memberId: string | number | null
  memberName: string
  teamId: string | number
  teamName?: string
  /** Default category. Defaults to 'late_signin'. */
  category?: FineCategory
  /** Optional pre-fill: when issuing from a roster row, the activity context. */
  activityType?: FineActivityType
  activityId?: string | number
  activityDate?: string | null
  /** Optional pre-fill: the reason text — used by the late-signin auto prompt. */
  defaultReason?: string
  onSuccess?: (fine: Fine) => void
}

const CATEGORIES: FineCategory[] = ['late_signin', 'no_show', 'late_payment', 'custom']

function ordinalLabel(n: number, t: (k: string, opts?: Record<string, unknown>) => string): string {
  if (n === 1) return t('fines:ordinal1st')
  if (n === 2) return t('fines:ordinal2nd')
  if (n === 3) return t('fines:ordinal3rd')
  return t('fines:ordinalNth', { n })
}

function windowPhrase(window: string, t: (k: string) => string): string {
  switch (window) {
    case 'calendar_month': return t('fines:thisMonth')
    case 'rolling_30d': return t('fines:last30Days')
    case 'rolling_90d': return t('fines:last90Days')
    case 'season': return t('fines:thisSeason')
    case 'never': return t('fines:allTime')
    default: return ''
  }
}

export default function IssueFineModal({
  open, onClose, memberId, memberName, teamId, teamName,
  category: initialCategory = 'late_signin',
  activityType, activityId, activityDate,
  defaultReason,
  onSuccess,
}: IssueFineModalProps) {
  const { t } = useTranslation(['fines', 'common'])
  const [category, setCategory] = useState<FineCategory>(initialCategory)
  const [amountText, setAmountText] = useState<string>('')
  const [amountOverridden, setAmountOverridden] = useState(false)
  const [reason, setReason] = useState<string>(defaultReason ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // A team-level fine is owed by the team, not a member: the escalation engine
  // counts offenses per member×team×category, so there is no tier to quote and
  // the amount is always entered by hand.
  const isTeamFine = memberId == null

  // Engine quote — re-runs when category changes. useFineQuote reports
  // not-ready (data null, isLoading false) for a null memberId, so a team fine
  // never fires the rules/priors queries.
  const quote = useFineQuote(memberId, teamId, category, { enabled: open && !isTeamFine })

  // Whenever a fresh quote arrives, populate the amount field — unless the
  // leader has typed something themselves. Adjust-state-during-render (React's
  // reset-on-change pattern) instead of a setState inside an effect: same
  // triggers ([open, amountOverridden, quote.data]), same guards, one render less.
  const amountKey = `${open}|${amountOverridden}`
  const [prevAmountSrc, setPrevAmountSrc] = useState<{ key: string; data: typeof quote.data } | null>(null)
  if (!prevAmountSrc || prevAmountSrc.key !== amountKey || prevAmountSrc.data !== quote.data) {
    setPrevAmountSrc({ key: amountKey, data: quote.data })
    if (open && !amountOverridden) {
      setAmountText(quote.data ? quote.data.amount.toFixed(2) : '')
    }
  }

  // Reset state when the modal closes/opens for a new member. Same triggers as the
  // former effect ([open, initialCategory, defaultReason, memberId]).
  const resetKey = `${open}|${initialCategory}|${defaultReason ?? ''}|${memberId}`
  const [prevResetKey, setPrevResetKey] = useState<string | null>(null)
  if (prevResetKey !== resetKey) {
    setPrevResetKey(resetKey)
    if (open) {
      setCategory(initialCategory)
      setAmountOverridden(false)
      setReason(defaultReason ?? '')
      setError(null)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const amountNum = parseFloat(amountText)
      if (!Number.isFinite(amountNum) || amountNum < 0) {
        throw new Error(t('fines:amountLabel') + ' …')
      }
      const payload: Record<string, unknown> = {
        member: isTeamFine ? null : Number(memberId),
        team: Number(teamId),
        category,
        amount: amountNum,
        reason: reason.trim() || null,
      }
      if (activityType) payload.activity_type = activityType
      if (activityId != null) payload.activity_id = Number(activityId)
      if (activityDate) payload.activity_date = activityDate
      const fine = await createRecord<Fine>('fines', payload)
      onSuccess?.(fine)
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(t('fines:issueFineError', { error: msg }))
    } finally {
      setSubmitting(false)
    }
  }

  const previewLine = (() => {
    if (isTeamFine) return null
    if (quote.isLoading) return null
    if (!quote.rule) return t('fines:previewNoRule')
    if (!quote.data) return t('fines:previewError')
    return t('fines:previewLine', {
      ordinal: ordinalLabel(quote.data.tier_offense, t),
      categoryLabel: t(`fines:category${category.charAt(0).toUpperCase()}${category.slice(1).replace(/_(.)/g, (_, c) => c.toUpperCase())}`),
      window: windowPhrase(quote.data.reset_window_at_issue, t),
      amount: formatFineAmount(quote.data.amount),
    })
  })()

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isTeamFine
        ? t('fines:issueFineForTeam', { name: teamName ?? '' })
        : t('fines:issueFineFor', { name: memberName })}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {isTeamFine ? (
          <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
            {t('fines:targetTeamHint')}
          </div>
        ) : teamName ? (
          <div className="text-xs text-gray-500 dark:text-gray-400">{teamName}</div>
        ) : null}

        {/* Category */}
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('fines:categoryLabel')}
          <select
            value={category}
            onChange={(e) => { setCategory(e.target.value as FineCategory); setAmountOverridden(false) }}
            className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`fines:category${c.charAt(0).toUpperCase()}${c.slice(1).replace(/_(.)/g, (_, ch) => ch.toUpperCase())}`)}
              </option>
            ))}
          </select>
        </label>

        {/* Amount */}
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('fines:amountLabel')}
          <input
            type="number"
            step="0.05"
            min="0"
            value={amountText}
            onChange={(e) => { setAmountText(e.target.value); setAmountOverridden(true) }}
            placeholder={isTeamFine ? t('fines:amountPlaceholderTeam') : t('fines:amountPlaceholder')}
            required
            className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          />
        </label>

        {/* Preview */}
        {previewLine && (
          <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
            {previewLine}
          </div>
        )}

        {/* Reason */}
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('fines:reasonLabel')}
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('fines:reasonPlaceholder')}
            rows={2}
            className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          />
        </label>

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={submitting}>
            {t('common:cancel')}
          </Button>
          <Button type="submit" size="sm" disabled={submitting}>
            {submitting ? t('common:loading') : t('fines:issueFineSubmit')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
