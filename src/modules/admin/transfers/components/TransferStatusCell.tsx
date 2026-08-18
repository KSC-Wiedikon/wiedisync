import { useTranslation } from 'react-i18next'
import { Ban, CheckCircle2, Clock } from 'lucide-react'
import { formatDateTimeCompact } from '../../../../utils/dateHelpers'
import { derivedStatusSource } from '../utils/cohorts'
import { ClearStatusButton, TransferStatusButton } from './TransferStatusButton'
import { HintPopover } from './HintPopover'
import { VisTransferLine } from './VisTransferLine'
import type { TransferMember, TransferStatus, VisTransfer } from '../types'

/**
 * The whole status control for one row: the three buttons, the clear, the
 * attribution line for a completed transfer — and, when nothing is stored, the
 * DERIVED answer, said out loud.
 *
 * Saying it is the point. An empty control reads as "not done yet" whichever
 * way the derivation actually went, so a member Swiss Volley already licences
 * as Swiss looked exactly like one nobody had got to. The pill names the
 * source, because the two derivations are corrected in completely different
 * places: ours in this app, Swiss Volley's by asking them.
 *
 * ⚠ `withVisLine` is the ONE change from the original, which always rendered
 * FIVB's own transfer record inline underneath (line 1636). It is off in the
 * main row and on in the row detail: that line is four facts tall (state pill,
 * reference, progress bar, phase + start date) and was the tallest thing in the
 * Status column on a phone. Nothing is lost — the detail row is one tap away,
 * and it is where all four authorities stay reachable. The two are still
 * rendered by the SAME component so they can never be worded differently.
 */
export function TransferStatusCell({
  member,
  visTransfer,
  vmSaysSwiss,
  saving,
  onSetStatus,
  withVisLine = false,
}: {
  member: TransferMember
  visTransfer: VisTransfer | null
  vmSaysSwiss: boolean
  saving: boolean
  onSetStatus: (m: TransferMember, next: TransferStatus | null) => void
  withVisLine?: boolean
}) {
  const { t } = useTranslation('admin')

  // Never re-derived here. `derivedStatusSource` is the single place that decides
  // whether an EMPTY control means anything at all, and it deliberately says
  // nothing for a member who has never answered the federation question — that
  // is the whole `clarify` cohort, and telling them "no transfer needed" would
  // answer a question nobody has asked yet.
  const derived = derivedStatusSource(member, vmSaysSwiss)
  const derivedHint = derived === 'volleymanager' ? t('trDerivedVmHint') : t('trDerivedOursHint')

  return (
    <>
      {/* Stacked on phones, inline from sm — CLAUDE.md's action-toggle
          compaction rule. The labels themselves hide below sm inside
          TransferStatusButton, so the three toggles are icon-only there. */}
      <div className="inline-flex flex-col gap-1.5 sm:flex-row sm:items-center">
        <TransferStatusButton
          member={member}
          value="pending"
          label={t('trStatusPending')}
          icon={Clock}
          disabled={saving}
          onSelect={onSetStatus}
        />
        <TransferStatusButton
          member={member}
          value="done"
          label={t('trStatusDone')}
          icon={CheckCircle2}
          disabled={saving}
          onSelect={onSetStatus}
        />
        <TransferStatusButton
          member={member}
          value="not_needed"
          label={t('trStatusNotNeeded')}
          icon={Ban}
          disabled={saving}
          onSelect={onSetStatus}
        />
        {/* Clearing writes NULL, which is not "not needed": it hands the row back
            to the derivation, and that is what can put it on the worklist again. */}
        {member.transfer_status && (
          <ClearStatusButton disabled={saving} onClear={() => { onSetStatus(member, null) }} />
        )}
      </div>

      {derived && (
        <div className="mt-1 flex flex-wrap items-start gap-1">
          <p
            className="flex items-start gap-1 text-xs whitespace-normal text-gray-500 dark:text-gray-400"
            title={derivedHint}
          >
            <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {derived === 'volleymanager' ? t('trDerivedVm') : t('trDerivedOurs')}
          </p>
          {/* The hint says WHERE to correct it, which differs per source — and it
              only ever lived in a `title=`, unreachable on the phones this page
              is worked from. */}
          <HintPopover text={derivedHint} />
        </div>
      )}

      {member.transfer_status === 'done' && member.transfer_done_at && (
        <p className="mt-1 text-xs whitespace-normal text-gray-400 dark:text-gray-500">
          {member.transfer_done_by_name
            ? t('trDoneByOn', {
                date: formatDateTimeCompact(member.transfer_done_at),
                name: member.transfer_done_by_name,
              })
            : t('trDoneOn', { date: formatDateTimeCompact(member.transfer_done_at) })}
        </p>
      )}

      {withVisLine && <VisTransferLine member={member} transfer={visTransfer} />}
    </>
  )
}
