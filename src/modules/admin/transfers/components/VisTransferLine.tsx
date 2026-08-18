import { useTranslation } from 'react-i18next'
import { AlertTriangle, RadioTower } from 'lucide-react'
import { Badge } from '../../../../components/ui/badge'
import { formatDateZurich } from '../../../../utils/dateHelpers'
import { visPhaseI18nKey, visTransferState } from '../utils/visTransfer'
import { isDisputed, visTransferPercent } from '../utils/rowState'
import { HintPopover } from './HintPopover'
import type { TransferMember, VisTransfer } from '../types'

/**
 * What FIVB itself says about this member's transfer, under the control that
 * says what the club decided. Deliberately here rather than in its own column:
 * the two are the same question answered by two authorities, and the whole
 * design of `vis_transfers` (migration 237) rests on keeping them comparable
 * without conflating them — a stale toggle must never be able to hide an
 * incomplete transfer.
 *
 * Renders nothing at all when VIS has no row for the member. Silence is
 * correct here: most of the worklist is people no transfer has been opened
 * for yet, and an "unknown" pill on every one of them would be noise.
 */
export function VisTransferLine({
  member,
  transfer,
}: {
  member: TransferMember
  transfer: VisTransfer | null
}) {
  const { t } = useTranslation('admin')
  if (!transfer) return null

  const state = visTransferState(transfer)
  const pct = visTransferPercent(transfer)
  const ref = transfer.no_by_season ?? transfer.vis_no
  // ⚠ `status_label` is the sync's own English string ('in progress',
  // 'submitted') and is NEVER rendered — printing it raw would put lowercase
  // English into all five locales. The phase is translated off the numeric CODE,
  // and only when it AGREES with the badge: a finished ITC sits at code 130
  // ("in progress") at 100% until the season starts, and "Transfer complete ·
  // In progress" reads as a contradiction. `visPhaseI18nKey` holds the full
  // reasoning and returns null when nothing should be printed.
  const phaseKey = visPhaseI18nKey(transfer, state)
  const phase = phaseKey ? t(phaseKey) : null
  // Only 'not_needed' can disagree without the sync correcting it — the other
  // two it rewrites itself, so a divergence there is just the nightly run not
  // having caught up and is not worth alarming about.
  const ruledOut = isDisputed(member, transfer)

  return (
    <div className="mt-1.5 space-y-1 border-t border-gray-100 pt-1.5 dark:border-gray-700">
      <div className="flex flex-wrap items-center gap-1">
        <Badge
          variant={state === 'complete' ? 'success' : state === 'dead' ? 'neutral' : 'info'}
          className="gap-1 rounded-full whitespace-normal"
          title={t('trVisTransferHint')}
        >
          <RadioTower className="h-3 w-3" aria-hidden="true" />
          {state === 'complete'
            ? t('trVisTransferComplete')
            : state === 'dead'
              ? t(Number(transfer.status_code) === 255 ? 'trVisTransferRefused' : 'trVisTransferCancelled')
              : t('trVisTransferProgress', { percent: pct })}
        </Badge>
        <HintPopover text={t('trVisTransferHint')} />
        <span className="font-mono text-xs text-gray-400 dark:text-gray-500" title={t('trVisTransferNo')}>
          #{ref}
        </span>
      </div>
      {/* The bar is the part that is scannable down a column of rows: 20 vs
          60 vs 100 is the difference between "just filed" and "waiting on the
          start date", and reading it off two digits per row is slower. */}
      {state === 'in_progress' && (
        <span
          className="block h-1 w-full max-w-[7rem] overflow-hidden rounded-full bg-gray-200 dark:bg-gray-600"
          role="img"
          aria-label={t('trVisTransferProgress', { percent: pct })}
        >
          <span
            className="block h-full rounded-full bg-blue-500 dark:bg-blue-400"
            style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
          />
        </span>
      )}
      {state !== 'dead' && (phase || transfer.start_on) && (
        <span className="block text-xs whitespace-normal text-gray-400 dark:text-gray-500">
          {[phase, transfer.start_on ? t('trVisTransferFrom', { date: formatDateZurich(transfer.start_on) }) : null]
            .filter(Boolean).join(' · ')}
        </span>
      )}
      {/* The sync refuses to touch 'not_needed', by design — it is the one way
          to overrule VIS permanently. So this is the only disagreement that
          can persist, and it has to be visible or it is invisible forever.
          Non-dismissible on purpose. */}
      {ruledOut && (
        <p className="flex items-start gap-1 rounded-md bg-amber-50 px-1.5 py-1 text-xs whitespace-normal text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {t('trVisTransferRuledOut')}
        </p>
      )}
    </div>
  )
}
