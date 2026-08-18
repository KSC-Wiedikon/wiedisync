import { useTranslation } from 'react-i18next'
import { AlertTriangle, CheckCircle2, ExternalLink, HelpCircle, Link2 } from 'lucide-react'
import { Badge } from '../../../../components/ui/badge'
import { Button } from '../../../../components/ui/button'
import { formatDateZurich } from '../../../../utils/dateHelpers'
import { VIS_TRANSFERS_URL } from '../constants'
import { normaliseVisPlayerNo } from '../utils/visTransfer'
import { CopyButton } from './CopyButton'
import { HintPopover } from './HintPopover'
import type { TransferMember, VisFederation } from '../types'

/**
 * VIS presence for ONE member: the state, when it was established, and — when
 * they are in VIS — the number to paste into the VIS search.
 *
 * The federation contact and the request letter deliberately do NOT live here.
 * They are identical for every row of a federation group, so per row they were
 * ~120px of repeated boilerplate that pushed the note field off the screen;
 * they now sit once in the group header, which is also the only place a
 * consolidated ask can exist.
 *
 * The three states are worded as evidence, never as verdicts. In particular
 * `false` renders as "not found", never "does not exist": see the `in_vis`
 * doc comment on TransferMember for why a miss usually indicts our seeded
 * federation of origin rather than the federation itself.
 *
 * `swiss` swaps the hints and drops the transfers-app link: for a CH-origin
 * member the index is Swiss Volley's own and no transfer applies either way,
 * so "a transfer can be requested for them" and an "Open in VIS" CTA would
 * both point at something that does not exist for them.
 *
 * ⚠ `federation` is resolved by the CALLER through `federationForMember()`, so
 * the "unconfirmed" warning below names the FIVB code even when
 * `federation_of_origin` is stored untrimmed or lowercase. Looking it up here
 * off the raw column printed the raw ISO instead — in the one sentence that
 * tells an operator which index the link failed against.
 *
 * `compact` renders ONLY the in-VIS pill — that is the Evidence column. The
 * full block, hints included, is one tap away in the row detail.
 */
export function VisCell({
  member,
  swiss = false,
  federation,
  canLink,
  saving,
  onLinkVisPlayer,
  compact,
}: {
  member: TransferMember
  swiss?: boolean
  federation: VisFederation | null
  canLink: boolean
  saving: boolean
  onLinkVisPlayer: (m: TransferMember) => void
  compact?: boolean
}) {
  const { t } = useTranslation('admin')

  // ⚠ Both numbers arrive as STRINGS (`fetchItems` → `stringifyIds`), so they
  // go through the module's one reader rather than being touched bare.
  const visNo = normaliseVisPlayerNo(member.vis_player_no)
  const manualNo = normaliseVisPlayerNo(member.vis_player_no_manual)

  const hint = member.in_vis === true
    ? (swiss ? t('trSwissInVisYesHint') : t('trInVisYesHint'))
    : member.in_vis === false
      ? (swiss ? t('trSwissInVisNoHint') : t('trInVisNoHint'))
      // No swiss variant: "the check has not run for them yet" reads the same
      // either way, so there is deliberately only one key.
      : t('trInVisUnknownHint')

  const pill = member.in_vis === true ? (
    <Badge variant="success" className="gap-1 rounded-full whitespace-normal" title={hint}>
      <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
      {t('trInVisYes')}
    </Badge>
  ) : member.in_vis === false ? (
    // Amber, not red: this is a lead to follow up, not a violation.
    <Badge variant="warning" className="gap-1 rounded-full whitespace-normal" title={hint}>
      <HelpCircle className="h-3 w-3" aria-hidden="true" />
      {t('trInVisNo')}
    </Badge>
  ) : (
    <span className="text-xs text-gray-400 dark:text-gray-500" title={hint}>
      {t('trInVisUnknown')}
    </span>
  )

  if (compact) return pill

  return (
    // ⚠ `sm:min-w-[7rem]`, never a bare `min-w-[7rem]`: an unconditional 112px
    // floor here is a min-content contribution that scrolls a 320px phone
    // sideways. The floor is a desktop-only concern.
    <div className="space-y-1 sm:min-w-[7rem]">
      <div className="flex flex-wrap items-center gap-1">
        {pill}
        <HintPopover text={hint} />
      </div>

      {/* A stale check is worth seeing: the answer only holds as of this date. */}
      {member.in_vis_checked_at && (
        <span className="block text-xs text-gray-400 dark:text-gray-500">
          {t('trInVisCheckedAt', { date: formatDateZurich(member.in_vis_checked_at) })}
        </span>
      )}

      {member.in_vis === true && (
        <div className="flex flex-wrap items-center gap-1">
          {visNo != null && (
            <>
              <span
                title={t('trVisPlayerNo')}
                className="font-mono text-xs font-medium text-gray-900 dark:text-white"
              >
                #{visNo}
              </span>
              <CopyButton value={String(visNo)} title={t('trCopyPlayerNo')} />
            </>
          )}
          {/* The `title` and the hint popover carry the "VIS has no per-player
              URL" explanation that used to be a line of text under every single
              row. */}
          {!swiss && (
            <>
              <a
                href={VIS_TRANSFERS_URL}
                target="_blank"
                rel="noopener noreferrer"
                title={t('trOpenInVisHint')}
                className="inline-flex min-h-[44px] items-center gap-1 rounded-md border border-brand-300 px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50 sm:min-h-0 dark:border-brand-700 dark:text-brand-200 dark:hover:bg-brand-900/30"
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                {t('trOpenInVis')}
              </a>
              <HintPopover text={t('trOpenInVisHint')} />
            </>
          )}
        </div>
      )}

      {/* The hand-set link (migration 312), shown whether or not it resolved —
          the UNCONFIRMED state is the one an operator most needs to see, since
          it is the only signal that somebody believes a link holds and VIS does
          not agree. A confirmed link renders VIS's own spelling so that "did I
          link the right person?" is answerable without leaving the page. */}
      {manualNo != null && (
        <div className="space-y-0.5">
          <span className="flex flex-wrap items-center gap-1">
            <span
              title={t('trManualLinkHint')}
              className="inline-flex items-center gap-1 font-mono text-xs text-gray-600 dark:text-gray-300"
            >
              <Link2 className="h-3 w-3 shrink-0" aria-hidden="true" />
              #{manualNo}
            </span>
            {/* The hand-set number is exactly the value you paste into the VIS
                search — the same reason `vis_player_no` has one. */}
            <CopyButton value={String(manualNo)} title={t('trCopyPlayerNo')} />
            <HintPopover text={t('trManualLinkHint')} />
          </span>
          {member.vis_manual_vis_name ? (
            <span className="block text-xs break-words whitespace-normal text-green-700 dark:text-green-300">
              {t('trManualLinkConfirmed', { name: member.vis_manual_vis_name })}
            </span>
          ) : (
            <span className="block text-xs break-words whitespace-normal text-amber-700 dark:text-amber-300">
              <AlertTriangle className="mr-1 inline h-3 w-3" aria-hidden="true" />
              {t('trManualLinkUnconfirmed', {
                fed: federation?.code || (member.federation_of_origin ?? '—'),
              })}
            </span>
          )}
        </div>
      )}

      {canLink && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => { onLinkVisPlayer(member) }}
          disabled={saving}
          title={t('trManualLinkHint')}
          className="min-h-[44px] gap-1 sm:min-h-0"
        >
          <Link2 className="h-3 w-3" aria-hidden="true" />
          {manualNo != null ? t('trManualLinkEdit') : t('trManualLinkAdd')}
        </Button>
      )}
    </div>
  )
}
