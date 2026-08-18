import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Mail } from 'lucide-react'
import { Badge } from '../../../../components/ui/badge'
import { Button } from '../../../../components/ui/button'
import { prettyFederationName, splitEmails } from '../utils/federationText'
import { GROUP_HEADER_CLASS, columnsForMode } from '../utils/tableMode'
import { CopyButton } from './CopyButton'
import { FederationLetterDialog } from './FederationLetterDialog'
import type { TableMode, TransferGroup, VisFederation, VisPresenceCounts } from '../types'

/**
 * The strip above one group's table: which federation this is, how many of its
 * members are on the list, how far VIS has got with them, and — on the worklist
 * only — who to write to and the one prepared letter.
 *
 * ⚠ CONSTANT SILHOUETTE. Every group renders the same shape in the same order:
 * chevron (when it collapses) · label · member count · ONE "N of M in VIS"
 * meter. The original showed 0-3 conditional pills, omitting the empty buckets
 * — which meant no two group headers had the same layout and none of them could
 * be scanned against each other. The three-way split is not lost: it is the
 * meter's two coloured segments (in VIS / not found; the empty track is
 * "not checked"), its `title=` and its `sr-only` breakdown. "Never looked" and
 * "looked and did not find" stay different facts.
 *
 * On the collapsed Swiss group this header IS the point: the split has to be
 * readable without expanding ~483 rows.
 *
 * ⚠ The letter is withheld from the SWISS group (`mode === 'swiss'`), where the
 * contact is Swiss Volley itself: it would ask Swiss Volley to grant a transfer
 * TO Swiss Volley for players it already licensed. The contact stays — "who do
 * we write to about a Swiss player missing from VIS" is a real question, the
 * answer is just not this letter — but it is a property of the whole cohort, not
 * of a group, so it is rendered ONCE in that tab's header rather than repeated
 * over every group here.
 */
export function FederationGroupHeader({
  group,
  mode,
  federation,
  visCounts,
  collapsible,
  open,
  onOpenChange,
}: {
  group: TransferGroup
  mode: TableMode
  federation: VisFederation | null
  visCounts: VisPresenceCounts
  collapsible: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation('admin')
  const [letterOpen, setLetterOpen] = useState(false)
  const columns = columnsForMode(mode)

  const emails = splitEmails(federation?.email)
  const federationName = prettyFederationName(federation?.name)
  // Everyone we cannot request a transfer for yet: not found AND never checked
  // (`!== true`). The letter itself re-derives this from the same rule — see
  // FederationLetterDialog, which owns the reasoning.
  const pending = group.rows.filter((m) => m.in_vis !== true)
  const canRequest = mode === 'needs' && !!federation && pending.length > 0

  const total = visCounts.inVis + visCounts.notFound + visCounts.unchecked
  const width = (n: number) => (total > 0 ? `${(n / total) * 100}%` : '0%')
  const visBreakdown = [
    `${visCounts.inVis} ${t('trInVisYes')}`,
    `${visCounts.notFound} ${t('trInVisNo')}`,
    `${visCounts.unchecked} ${t('trInVisUnknown')}`,
  ].join(' · ')

  const title = (
    <>
      <span className="text-sm font-semibold text-gray-900 dark:text-white">
        {group.label || t('trUnknownFederation')}
      </span>
      <Badge variant="neutral">{t('trMemberCount', { count: group.rows.length })}</Badge>
    </>
  )

  return (
    <>
      <div className={GROUP_HEADER_CLASS}>
        {collapsible ? (
          // A controlled disclosure: the body is mounted by the table as
          // `{open && body}` and MUST stay unmounted while closed (the Swiss
          // cohort is ~483 rows), so the open state lives in the page and this
          // is only its trigger. Deliberately not a native <details>, whose
          // content is mounted-then-hidden.
          <button
            type="button"
            onClick={() => { onOpenChange(!open) }}
            aria-expanded={open}
            className="flex min-h-[44px] items-center gap-3 text-left sm:min-h-0"
          >
            {/* ⚠ This arrow is the ONLY affordance saying the collapsed cohorts
                open, and it had no dark variant — `text-gray-400` on a
                `dark:bg-gray-800/50` card. Every other de-emphasised element on
                this page pairs its gray with an explicit dark one. */}
            <ChevronRight
              className={`h-4 w-4 shrink-0 text-gray-400 transition-transform dark:text-gray-300 ${open ? 'rotate-90' : ''}`}
              aria-hidden="true"
            />
            {title}
          </button>
        ) : (
          title
        )}

        {columns.vis && (
          <span className="flex items-center gap-2" title={visBreakdown}>
            <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
              {t('trInVisOfTotal', { inVis: visCounts.inVis, total })}
            </span>
            <span
              aria-hidden="true"
              className="flex h-1 w-16 shrink-0 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700"
            >
              <span className="bg-green-500 dark:bg-green-400" style={{ width: width(visCounts.inVis) }} />
              <span className="bg-amber-500 dark:bg-amber-400" style={{ width: width(visCounts.notFound) }} />
            </span>
            <span className="sr-only">{visBreakdown}</span>
          </span>
        )}

        {/* Contact + letter, worklist only. On `notNeeded` there is nothing left
            to ask a federation, and on `swiss` the contact is the cohort's, not
            the group's (see the ⚠ above). */}
        {mode === 'needs' && (
          <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {!federation ? (
              // No directory row for this ISO — say so plainly. An empty mailto:
              // would look like a working contact and silently go nowhere.
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {t('trVisFederationMissing', { code: group.key || '—' })}
              </span>
            ) : (
              <>
                <span className="text-xs font-medium text-gray-700 dark:text-gray-200">{federationName}</span>
                {emails.length === 0 ? (
                  <span className="text-xs text-gray-500 dark:text-gray-400">{t('trVisNoEmail')}</span>
                ) : (
                  <span className="inline-flex flex-wrap items-center gap-1">
                    {/* mailto on the FIRST address only — VIS lists several for
                        many federations and which one is right for a transfer is
                        the club's call, so the rest are copied but not
                        pre-picked. */}
                    <a
                      href={`mailto:${emails[0]}`}
                      className="text-xs font-medium break-all text-brand-700 hover:underline dark:text-brand-200"
                    >
                      {emails[0]}
                    </a>
                    <CopyButton
                      value={emails.join('; ')}
                      title={emails.length > 1 ? t('trCopyEmails') : t('trCopyEmail')}
                    />
                    {emails.length > 1 && (
                      <span
                        className="text-xs text-gray-400 dark:text-gray-500"
                        title={emails.slice(1).join('; ')}
                      >
                        {t('trVisMoreAddresses', { count: emails.length - 1 })}
                      </span>
                    )}
                  </span>
                )}
                {canRequest && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => { setLetterOpen(true) }}
                    className="min-h-[44px] max-w-full gap-1 text-left whitespace-normal sm:min-h-0"
                  >
                    <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    {t('trBulkRequestTitle', { count: pending.length })}
                  </Button>
                )}
              </>
            )}
          </span>
        )}
      </div>

      {/* Opened from the button above, so the letter never sits open over the
          table it belongs to — and never renders at all for a group that has
          nothing to ask for. Nothing is ever sent from this page. */}
      {canRequest && (
        <FederationLetterDialog
          group={group}
          federationName={federationName}
          emails={emails}
          open={letterOpen}
          onOpenChange={setLetterOpen}
        />
      )}
    </>
  )
}
