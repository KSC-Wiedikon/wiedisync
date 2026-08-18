import { useTranslation } from 'react-i18next'
import { Ban, ChevronRight } from 'lucide-react'
import { Button } from '../../../../components/ui/button'
import { TableCell, TableRow } from '../../../../components/ui/table'
import { countryFlag, formatCountryCodes, parseCountryCodes } from '../../../../utils/countries'
import { formatDateTimeCompact } from '../../../../utils/dateHelpers'
import { derivedStatusSource } from '../utils/cohorts'
import { visTransferPercent } from '../utils/rowState'
import { visibleColumnCount } from '../utils/tableMode'
import { federationForMember } from '../utils/vmMatch'
import { HintPopover } from './HintPopover'
import { LicenceCell } from './LicenceCell'
import { NameCell } from './NameCell'
import { RowStateBadge } from './RowStateBadge'
import { TransferRowDetail } from './TransferRowDetail'
import { TransferStatusCell } from './TransferStatusCell'
import { VisCell } from './VisCell'
import type {
  TableColumns, TableMode, TransferDerivations, TransferMember, TransferRowActions, TransferStatus,
} from '../types'

/**
 * One member, as a table row — plus its detail row underneath.
 *
 * The cell list here and the `<TableHead>` list in `TransferGroupTable` are both
 * governed by `columnsForMode(mode)` / `visibleColumnCount(mode)`, so a header
 * and a body row can never disagree about how many cells exist. The order is
 * fixed: State · Member · Evidence · Status · Note · Details.
 *
 * Four columns survive at 375px. `Evidence` drops below `sm` and `Note` below
 * `lg`, which is exactly why the 44x44 disclosure button is not optional: on a
 * phone the detail row is the ONLY place several of these facts exist.
 *
 * ⚠ NO local state anywhere in this file. The note input is fully controlled off
 * the page-level `noteDrafts` Map: a controlled input that writes its value back
 * into the row rendering it is the render-phase setState that produces React
 * #301. Everything a row can change — the draft, the open/closed flag, the
 * in-flight save — is owned by the page and arrives through `actions`.
 */
export function TransferRow({ member, mode, columns, derivations, actions }: {
  member: TransferMember
  mode: TableMode
  columns: TableColumns
  derivations: TransferDerivations
  actions: TransferRowActions
}) {
  const { t } = useTranslation('admin')

  const id = String(member.id)
  const saving = actions.savingId === id
  const open = actions.openRows.has(id)
  const visTransfer = derivations.visTransferOf(member)
  // ⚠ Resolved ONCE here and passed down, through the normaliser rather than off
  // the raw column: `federationByIso` is keyed trimmed-uppercase, and a stored
  // ' de' looked up bare printed the raw ISO in the one sentence that tells an
  // operator which index a manual link failed against.
  const federation = federationForMember(member, derivations.federationByIso)

  // The `notNeeded` cohort is a record, not a queue — everything except the
  // member's own identity is de-emphasised so the eye keeps moving.
  const demote = mode === 'notNeeded' ? ' text-muted-foreground' : ''

  const nationality = (
    <p className="text-xs whitespace-normal">
      {/* The flag is decoration on top of the name that follows it — announced,
          it reads "flag of Italy, Italy", and on Windows the glyph is missing so
          the literal letters render instead. */}
      <span aria-hidden="true" className="mr-1">
        {parseCountryCodes(member.nationalitaet_codes).map(countryFlag).join(' ')}
      </span>
      {formatCountryCodes(member.nationalitaet_codes) || '—'}
    </p>
  )

  return (
    <>
      <TableRow>
        {/* 1. State — ONE derived label over the four authorities. `clarify` has
            no federation answer yet, so there is nothing to derive a state from
            and the column does not exist for it. */}
        {mode !== 'clarify' && (
          <TableCell className="align-top">
            <RowStateBadge
              state={derivations.stateOf(member)}
              percent={visTransferPercent(visTransfer)}
              disputed={derivations.disputedOf(member)}
            />
          </TableCell>
        )}

        {/* 2. Member. ⚠ No `min-h-[44px]` on the <td>: min-height on a
            `display: table-cell` box is unreliable — the row box governs the
            height — and NameCell's inner div carries it, which is what actually
            holds the row open. */}
        <TableCell className="align-top">
          <NameCell
            m={member}
            teamNames={derivations.teamNamesOf(id)}
            unrostered={derivations.isUnrostered(id)}
          />
        </TableCell>

        {/* 3. Evidence — the four authorities, compact. Always present (it is
            counted unconditionally by `visibleColumnCount`), but what it holds
            follows `columns`: in `clarify` the nationality flags alone, which
            ARE that cohort's evidence and its grouping key.
            ⚠ Pills only. The full blocks, both call-outs and every hint live in
            the row detail — nothing here is the last copy of anything. */}
        <TableCell className={`hidden align-top sm:table-cell${demote}`}>
          <div className="flex flex-col gap-1">
            {columns.vis && (
              <VisCell
                member={member}
                swiss={mode === 'swiss'}
                federation={federation}
                canLink={actions.canRunVisCheck}
                saving={saving}
                onLinkVisPlayer={actions.onLinkVisPlayer}
                compact
              />
            )}
            {columns.licence && (
              <LicenceCell
                member={member}
                state={derivations.validationOf(member)}
                vmRow={derivations.vmRowOf(member)}
                saving={saving}
                onSetStatus={actions.onSetStatus}
                compact
              />
            )}
            {nationality}
          </div>
        </TableCell>

        {/* 4. Status — or, in `notNeeded`, "Ruled out by" + Reopen. */}
        {columns.status && (
          <TableCell className={`align-top${demote}`}>
            {mode === 'notNeeded' ? (
              <RuledOutByCell
                member={member}
                vmSaysSwiss={derivations.vmSaysSwiss(member)}
                saving={saving}
                onSetStatus={actions.onSetStatus}
              />
            ) : (
              <TransferStatusCell
                member={member}
                visTransfer={visTransfer}
                vmSaysSwiss={derivations.vmSaysSwiss(member)}
                saving={saving}
                onSetStatus={actions.onSetStatus}
              />
            )}
          </TableCell>
        )}

        {/* 5. Note. Below `lg` it moves into the row detail — same input, same
            commit-on-blur. */}
        {columns.note && (
          <TableCell className={`hidden align-top lg:table-cell${demote}`}>
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
              // ⚠ `sm:min-w-[8rem]`, never a bare `min-w-[8rem]`: an
              // unconditional 128px floor on the LAST column is a min-content
              // contribution that scrolls a 320px phone sideways. `w-full`
              // already fills the column; the floor is a desktop-only concern.
              className="min-h-[44px] w-full rounded-md border border-gray-200 bg-transparent px-2 py-1 text-xs text-gray-700 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none disabled:opacity-50 sm:min-h-0 sm:min-w-[8rem] dark:border-gray-600 dark:text-gray-200 dark:placeholder:text-gray-500"
            />
          </TableCell>
        )}

        {/* 6. Details. `aria-expanded` also drives the row's own
            `has-aria-expanded:bg-muted/50`, so an open row stays tied to its
            detail visually. */}
        <TableCell className="w-11 align-top">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            // Both axes carry the 44px floor on touch; back to the primitive's
            // own size from `sm`.
            className="h-11 w-11 shrink-0 sm:h-9 sm:w-9"
            aria-expanded={open}
            aria-label={t('trRowDetail')}
            title={t('trRowDetail')}
            onClick={() => { actions.onToggleRow(id, !open) }}
          >
            <ChevronRight
              className={`h-4 w-4 transition-transform${open ? ' rotate-90' : ''}`}
              aria-hidden="true"
            />
          </Button>
        </TableCell>
      </TableRow>

      {/* Self-gating: unmounted while closed, never merely hidden. */}
      <TransferRowDetail
        member={member}
        mode={mode}
        columns={columns}
        colSpan={visibleColumnCount(mode)}
        derivations={derivations}
        actions={actions}
      />
    </>
  )
}

/**
 * The `notNeeded` cohort's Status slot: WHO took this member off the worklist,
 * and the one way back.
 *
 * The three toggles are gone from the main row here because the answer is
 * already given — what an operator needs first is the provenance of the ruling,
 * not the ability to re-issue it. The FULL `TransferStatusCell` stays in the row
 * detail, so no transition is lost.
 *
 * ⚠ `Reopen` is offered ONLY for a STORED `not_needed`. A row that is here
 * because Volleymanager licences the member as Swiss cannot be reopened from
 * here — `bucketOf` would put it straight back the moment the write landed
 * (transferBucket.ts:66-73) — so the derived pill names the source instead, and
 * its hint says where the correction actually has to be made.
 */
function RuledOutByCell({ member, vmSaysSwiss, saving, onSetStatus }: {
  member: TransferMember
  vmSaysSwiss: boolean
  saving: boolean
  onSetStatus: (m: TransferMember, next: TransferStatus | null) => void
}) {
  const { t } = useTranslation('admin')

  const derived = derivedStatusSource(member, vmSaysSwiss)
  const derivedHint = derived === 'volleymanager' ? t('trDerivedVmHint') : t('trDerivedOursHint')

  if (member.transfer_status === 'not_needed') {
    return (
      <div className="space-y-1">
        <p className="text-xs whitespace-normal text-gray-600 dark:text-gray-300">
          {t('trRuledOutByHand')}
        </p>
        {/* Same attribution line a completed transfer carries — the ruling has
            an author too. */}
        {member.transfer_done_at && (
          <p className="text-xs whitespace-normal text-gray-400 dark:text-gray-500">
            {member.transfer_done_by_name
              ? t('trDoneByOn', {
                  date: formatDateTimeCompact(member.transfer_done_at),
                  name: member.transfer_done_by_name,
                })
              : t('trDoneOn', { date: formatDateTimeCompact(member.transfer_done_at) })}
          </p>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-[44px] sm:min-h-0"
          disabled={saving}
          onClick={() => { onSetStatus(member, 'pending') }}
        >
          {t('trReopen')}
        </Button>
      </div>
    )
  }

  if (!derived) return <span className="text-xs text-gray-400 dark:text-gray-500">—</span>

  return (
    <div className="flex flex-wrap items-start gap-1">
      <p
        className="flex items-start gap-1 text-xs whitespace-normal text-gray-500 dark:text-gray-400"
        title={derivedHint}
      >
        <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {derived === 'volleymanager' ? t('trDerivedVm') : t('trDerivedOurs')}
      </p>
      {/* The hint says WHERE to correct it, which differs per source — and it
          only ever lived in a `title=`, unreachable on the phones this page is
          worked from. */}
      <HintPopover text={derivedHint} />
    </div>
  )
}
