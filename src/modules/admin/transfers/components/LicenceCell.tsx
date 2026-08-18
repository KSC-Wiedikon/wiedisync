import { useTranslation } from 'react-i18next'
import { AlertTriangle, Info } from 'lucide-react'
import { Badge } from '../../../../components/ui/badge'
import { Button } from '../../../../components/ui/button'
import { formatDateZurich } from '../../../../utils/dateHelpers'
import { HintPopover } from './HintPopover'
import type { TransferMember, TransferStatus, ValidationState, VmRow } from '../types'

/** Swiss Volley's answer, as a pill: `validated` green, `not_validated` red,
 *  `unknown` grey. `unknown` is "Volleymanager knows no licence for this
 *  person", which is NOT an explicit "not validated" — hence three colours and
 *  never two. */
const VALIDATION_BADGE: Record<ValidationState, 'success' | 'danger' | 'neutral'> = {
  validated: 'success',
  not_validated: 'danger',
  unknown: 'neutral',
}

const VALIDATION_LABEL_KEY: Record<ValidationState, string> = {
  validated: 'trLicenceValidated',
  not_validated: 'trLicenceNotValidated',
  unknown: 'trLicenceUnknown',
}

/**
 * Read-only licence-validation indicator + the two mismatch call-outs.
 *
 * `compact` renders ONLY the pill — that is the Evidence column, where the
 * cell has to stay scannable. The full block, including both call-outs and the
 * inline "Mark done" button, lives one tap away in the row detail; nothing is
 * lost, because the two call-outs are ALSO surfaced page-wide as the red
 * "blocked" alert strip and the "Licence validated" filter chip.
 */
export function LicenceCell({
  member,
  state,
  vmRow,
  saving,
  onSetStatus,
  compact,
}: {
  member: TransferMember
  state: ValidationState
  vmRow: VmRow | null
  saving: boolean
  onSetStatus: (m: TransferMember, next: TransferStatus | null) => void
  compact?: boolean
}) {
  const { t } = useTranslation('admin')

  const validatedAt = vmRow?.licence_validation_date
  // Volleymanager's side of the "federation of origin" question. VM stores no
  // FoO at all, so the closest it has is shown verbatim for comparison:
  // citizenship + the licence's playing nationality (see VmRow). Verbatim on
  // purpose — the value is evidence of what VM literally says, and mapping a
  // German country name or an IOC code through our own tables would let a
  // mapping bug misreport the register being checked against.
  const vmNationality = String(vmRow?.nationality ?? '').trim()
  const vmPlaysAs = String(vmRow?.nationality_code ?? '').trim()
  const blocked = member.transfer_status === 'done' && state !== 'validated'
  const probablyDone = member.transfer_status === 'pending' && state === 'validated'

  const pill = (
    <Badge
      variant={VALIDATION_BADGE[state]}
      className="rounded-full whitespace-normal"
      title={t('trLicenceHint')}
    >
      {t(VALIDATION_LABEL_KEY[state])}
    </Badge>
  )

  if (compact) return pill

  return (
    <div className="min-w-0 space-y-1">
      <div className="flex flex-wrap items-center gap-1">
        {pill}
        <HintPopover text={t('trLicenceHint')} />
      </div>
      {state === 'validated' && validatedAt && (
        <span className="block text-xs text-gray-400 dark:text-gray-500">
          {formatDateZurich(validatedAt)}
        </span>
      )}
      {(vmNationality || vmPlaysAs) && (
        <div className="flex flex-wrap items-start gap-1">
          <span
            className="text-xs whitespace-normal text-gray-400 dark:text-gray-500"
            title={t('trVmOriginHint')}
          >
            {vmNationality && vmPlaysAs
              ? t('trVmOriginBoth', { nationality: vmNationality, code: vmPlaysAs })
              : t('trVmOrigin', { value: vmNationality || vmPlaysAs })}
          </span>
          <HintPopover text={t('trVmOriginHint')} />
        </div>
      )}
      {/* Destructive, not a subtle badge: this player may not be fielded. */}
      {blocked && (
        <p className="flex items-start gap-1 rounded-md bg-red-50 px-1.5 py-1 text-xs font-medium whitespace-normal text-red-700 dark:bg-red-900/30 dark:text-red-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {t('trNotEligible')}
        </p>
      )}
      {probablyDone && (
        <div className="flex flex-col items-start gap-1 rounded-md bg-blue-50 px-1.5 py-1 dark:bg-blue-900/30">
          <p className="flex items-start gap-1 text-xs whitespace-normal text-blue-700 dark:text-blue-300">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {t('trProbablyDone')}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => { onSetStatus(member, 'done') }}
            disabled={saving}
            className="min-h-[44px] border-blue-300 text-blue-700 hover:bg-blue-100 sm:min-h-0 dark:border-blue-700 dark:text-blue-200 dark:hover:bg-blue-800/40"
          >
            {t('trMarkDone')}
          </Button>
        </div>
      )}
    </div>
  )
}
