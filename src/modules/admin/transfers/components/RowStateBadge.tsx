import { useTranslation } from 'react-i18next'
import { Badge } from '../../../../components/ui/badge'
import { HintPopover } from './HintPopover'
import {
  ROW_STATE_BADGE_VARIANT, ROW_STATE_HINT_KEY, ROW_STATE_LABEL_KEY,
} from '../utils/rowState'
import type { RowState } from '../types'

/**
 * The `State` column: ONE derived label over the four authorities.
 *
 * ⚠ It is a LABEL, never a merge. `in_vis`, `licence_validated`,
 * `transfer_status` and `vis_transfers` stay four separate facts and are still
 * rendered separately in `Evidence` and in the row detail — collapsing them into
 * a single boolean is what would let a stale toggle hide an incomplete transfer.
 * This badge only says which of them is currently the interesting one.
 */
export function RowStateBadge({ state, percent, disputed, withHint }: {
  state: RowState
  percent?: number
  disputed?: boolean
  withHint?: boolean
}) {
  const { t } = useTranslation('admin')
  const label = state === 'inProgress'
    ? t(ROW_STATE_LABEL_KEY[state], { percent: percent ?? 0 })
    : t(ROW_STATE_LABEL_KEY[state])
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge
        variant={ROW_STATE_BADGE_VARIANT[state]}
        className="max-w-[7rem] whitespace-normal break-words"
        title={t(ROW_STATE_HINT_KEY[state])}
      >
        {label}
      </Badge>
      {/* The nightly VIS sync refuses to touch 'not_needed', by design — it is
          the one way to overrule VIS permanently. So a row ruled out here while
          FIVB reports a live transfer is the ONE disagreement that can persist,
          and it has to stay visible or it is invisible forever. It renders
          BESIDE the state badge, never instead of it, and is not dismissible. */}
      {disputed && (
        <Badge variant="warning" size="sm" className="whitespace-normal break-words">
          {t('trStateDisputed')}
        </Badge>
      )}
      {withHint && <HintPopover text={t(ROW_STATE_HINT_KEY[state])} />}
    </span>
  )
}
