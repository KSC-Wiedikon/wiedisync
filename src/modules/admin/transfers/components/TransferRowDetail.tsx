import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { TableCell, TableRow } from '../../../../components/ui/table'
import { countryFlag, formatCountryCodes, parseCountryCodes } from '../../../../utils/countries'
import { federationForMember } from '../utils/vmMatch'
import { LicenceCell } from './LicenceCell'
import { TransferStatusCell } from './TransferStatusCell'
import { VisCell } from './VisCell'
import { VisTransferLine } from './VisTransferLine'
import type { TableColumns, TableMode, TransferDerivations, TransferMember, TransferRowActions } from '../types'

/** One labelled fact in the detail grid. The heading is always an existing
 *  `trCol*` key, so a fact is named identically here and in the table header it
 *  was hidden from. */
function DetailBlock({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className={`min-w-0 space-y-1${className ? ` ${className}` : ''}`}>
      <span className="block text-xs font-medium text-gray-500 dark:text-gray-400">{label}</span>
      {children}
    </div>
  )
}

/**
 * The second `<TableRow>` under an expanded row — the page's answer to a table
 * that has to fit four columns on a 375px phone.
 *
 * Everything the responsive column set hides is HERE, and nothing else is: the
 * Evidence column disappears below `sm` and the note column below `lg`, so on a
 * phone this row is the ONLY place several of these facts exist. That is why the
 * disclosure button is not an optional column and why this row spans the whole
 * table (`colSpan` comes from `visibleColumnCount(mode)`, the same function the
 * header list is built from — a hand-counted colSpan silently shifts the moment
 * a column changes).
 *
 * ⚠ All FOUR authorities stay separately reachable here — `in_vis` (VisCell),
 * `licence_validated` (LicenceCell), `transfer_status` (the status control) and
 * the `vis_transfers` row (VisTransferLine). The State badge in the main row is
 * a derived LABEL over them and never a merge: a stale toggle must not be able
 * to hide an incomplete transfer, so the evidence it was derived from is one tap
 * away, unsummarised.
 */
export function TransferRowDetail({
  member,
  mode,
  columns,
  colSpan,
  derivations,
  actions,
}: {
  member: TransferMember
  mode: TableMode
  columns: TableColumns
  colSpan: number
  derivations: TransferDerivations
  actions: TransferRowActions
}) {
  const { t } = useTranslation('admin')

  const id = String(member.id)
  // Self-gating, so the caller renders <TransferRowDetail> unconditionally and
  // the closed rows cost nothing: a collapsed detail is UNMOUNTED, never hidden.
  if (!actions.openRows.has(id)) return null

  const saving = actions.savingId === id
  const visTransfer = derivations.visTransferOf(member)
  // ⚠ Resolved through the normaliser, never off the raw column: `federationByIso`
  // is keyed trimmed-uppercase, and a stored ' de' looked up bare printed the raw
  // ISO in the one sentence that tells an operator which index a manual link
  // failed against.
  const federation = federationForMember(member, derivations.federationByIso)
  // In `notNeeded` the main row swapped the three toggles for "Ruled out by" +
  // Reopen, so the FULL control lives here — no transition is lost, and it sits
  // next to the same evidence the ruling was made from.
  const withStatusControl = mode === 'notNeeded' && columns.status

  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="bg-gray-50/60 px-3 py-3 align-top dark:bg-gray-900/20">
        <div className="grid gap-3 sm:grid-cols-2">
          <DetailBlock label={t('trColNationality')}>
            <p className="text-xs whitespace-normal text-gray-600 dark:text-gray-300">
              {/* The flag is decoration on top of the name that follows it —
                  announced, it reads "flag of Italy, Italy", and on Windows the
                  glyph is missing and the literal letters render instead. */}
              <span aria-hidden="true" className="mr-1">
                {parseCountryCodes(member.nationalitaet_codes).map(countryFlag).join(' ')}
              </span>
              {formatCountryCodes(member.nationalitaet_codes) || '—'}
            </p>
          </DetailBlock>

          {/* Licence number + category together: two facets of the same fact,
              and each alone was a near-empty column. */}
          <DetailBlock label={t('trColLicence')}>
            <span className="block font-mono text-xs text-gray-600 dark:text-gray-300" title={t('trColLicenceNr')}>
              {member.license_nr || '—'}
            </span>
            {member.licence_category && (
              <span className="block text-xs text-gray-400 dark:text-gray-500" title={t('trColCategory')}>
                {member.licence_category}
              </span>
            )}
          </DetailBlock>

          {/* Swiss Volley's answer, in full: the validation date, Volleymanager's
              own origin line verbatim, and both call-outs — the red "not
              eligible" and the blue "probably done" with its inline Mark done.
              The Evidence column carries only the pill. */}
          {columns.licence && (
            <DetailBlock label={t('trColLicenceValidated')}>
              <LicenceCell
                member={member}
                state={derivations.validationOf(member)}
                vmRow={derivations.vmRowOf(member)}
                saving={saving}
                onSetStatus={actions.onSetStatus}
              />
            </DetailBlock>
          )}

          {/* Presence in the FIVB player index, in full: the hint, the checked-at
              date, the number to paste into the VIS search, the transfers-app
              link and the manual-link block. */}
          {columns.vis && (
            <DetailBlock label={t('trColInVis')}>
              <VisCell
                member={member}
                swiss={mode === 'swiss'}
                federation={federation}
                canLink={actions.canRunVisCheck}
                saving={saving}
                onLinkVisPlayer={actions.onLinkVisPlayer}
              />
            </DetailBlock>
          )}

          {/* FIVB's own record has always sat under the club's status control
              (original line 1636) and keeps that heading here: two authorities on
              one question, side by side, never merged into one verdict. */}
          {withStatusControl ? (
            <DetailBlock label={t('trColStatus')}>
              <TransferStatusCell
                member={member}
                visTransfer={visTransfer}
                vmSaysSwiss={derivations.vmSaysSwiss(member)}
                saving={saving}
                onSetStatus={actions.onSetStatus}
                withVisLine
              />
            </DetailBlock>
          ) : visTransfer ? (
            <DetailBlock label={t('trColStatus')}>
              <VisTransferLine member={member} transfer={visTransfer} />
            </DetailBlock>
          ) : null}

          {/* The note, always reachable. Below `lg` the main row has no note
              column, and for the Swiss cohort it has none at ANY width — 483
              controlled inputs must not mount just because the group was
              expanded. Same input, same commit-on-blur, one tap away. */}
          <DetailBlock label={t('trColNote')} className={columns.note ? 'lg:hidden' : undefined}>
            <input
              type="text"
              value={actions.noteDrafts.get(id) ?? (member.transfer_note ?? '')}
              onChange={(e) => { actions.onNoteDraftChange(id, e.target.value) }}
              // Saved on blur — an admin working down the list tabs through and
              // every field commits itself.
              onBlur={(e) => { actions.onSaveNote(member, e.target.value) }}
              disabled={saving}
              placeholder={t('trNotePlaceholder')}
              aria-label={t('trColNote')}
              className="min-h-[44px] w-full rounded-md border border-gray-200 bg-transparent px-2 py-1 text-xs text-gray-700 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none disabled:opacity-50 sm:min-h-0 dark:border-gray-600 dark:text-gray-200 dark:placeholder:text-gray-500"
            />
          </DetailBlock>
        </div>
      </TableCell>
    </TableRow>
  )
}
