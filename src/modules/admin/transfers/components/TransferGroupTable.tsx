import { useTranslation } from 'react-i18next'
import { Badge } from '../../../../components/ui/badge'
import { Collapsible } from '../../../../components/ui/collapsible'
import { Table, TableBody, TableHead, TableHeader, TableRow } from '../../../../components/ui/table'
import { countVisPresence } from '../utils/cohorts'
import { GROUP_HEADER_CLASS, columnsForMode } from '../utils/tableMode'
import { FederationGroupHeader } from './FederationGroupHeader'
import { TransferRow } from './TransferRow'
import type {
  GroupBy, TableMode, TransferDerivations, TransferGroup, TransferRowActions,
} from '../types'

/** The card every group sits in. One silhouette for all four cohorts. */
const CARD_CLASS = 'overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800/50'

/**
 * One card + data table per group, for all four cohorts.
 *
 * `mode` decides what a group IS and every column follows from it through
 * `columnsForMode()` — the SAME function `TransferRow` and `TransferRowDetail`
 * read, so the `<TableHead>` list here and the cell list there can never
 * disagree about how many cells exist. The order is fixed:
 * State · Member · Evidence · Status · Note · Details.
 *
 *  - `needs`   — the actionable worklist. Licence validation, VIS presence,
 *                the transfer status toggle, the federation contact and the
 *                one consolidated letter.
 *  - `clarify` — grouped by NATIONALITY, not by a federation answer. No status
 *                (there is no transfer to have one about — the note is where
 *                "asked on …" goes), no VIS (never checked), and no federation
 *                bar: a nationality must not be addressed as though it were a
 *                federation-of-origin answer.
 *  - `swiss`   — Swiss Volley's own players. VIS presence, the status control
 *                (every row deriving "not needed" until somebody says
 *                otherwise), and COLLAPSED.
 *  - `notNeeded` — taken off the worklist by an override. Reads exactly like
 *                `needs`, including the licence cross-check, so the decision
 *                can be re-checked against the same evidence that informed it.
 *                Collapsed: it is a record, not a queue.
 *
 * ⚠⚠ A collapsed group body is UNMOUNTED, never merely hidden — `{open && body}`.
 * The Swiss cohort is ~483 rows; a native `<details>`, an uncontrolled
 * `<Collapsible>` or `CollapsibleContent`'s default behaviour all MOUNT their
 * children and only hide them, so every cold page load would pay for a table
 * nobody opened. The `<Collapsible>` root here is the card element itself: it
 * carries `data-state` and keeps the disclosure a shadcn primitive rather than a
 * native `<details>`, while the body stays behind the `open &&` gate.
 *
 * ⚠ `openGroups` is a PROP, not local state, keyed `${mode}:${g.key}` — it lives
 * in the page so switching tabs does not collapse every group, and so two groups
 * can never close each other by sharing one boolean.
 */
export function TransferGroupTable({
  groups,
  mode,
  groupBy = 'federation',
  derivations,
  actions,
  openGroups,
  onGroupOpenChange,
}: {
  groups: TransferGroup[]
  mode: TableMode
  groupBy?: GroupBy
  derivations: TransferDerivations
  actions: TransferRowActions
  openGroups: ReadonlySet<string>
  onGroupOpenChange: (key: string, open: boolean) => void
}) {
  const { t } = useTranslation('admin')
  const columns = columnsForMode(mode)

  /**
   * The Evidence head, named from the same `trCol*` keys the row detail labels
   * its blocks with, so a fact is called the same thing in the column it was
   * hidden from and in the detail row it reappears in. `clarify` carries the
   * nationality flags alone — which ARE that cohort's evidence and its grouping
   * key — so it is named for them.
   */
  const evidenceHead = columns.vis || columns.licence
    ? [columns.vis ? t('trColInVis') : '', columns.licence ? t('trColLicenceValidated') : '']
        .filter(Boolean)
        .join(' · ')
    : t('trColNationality')

  const head = (
    <TableHeader>
      <TableRow>
        {/* State — every mode EXCEPT `clarify`: those rows have no federation
            answer yet, so there is no derived state to label. */}
        {mode !== 'clarify' && <TableHead>{t('trColState')}</TableHead>}
        <TableHead>{t('trColMember')}</TableHead>
        <TableHead className="hidden sm:table-cell">{evidenceHead}</TableHead>
        {/* In `notNeeded` this slot holds "Ruled out by" + Reopen instead of the
            three toggles — the answer is already given, and what an operator
            needs first is the provenance of the ruling. */}
        {columns.status && (
          <TableHead>{mode === 'notNeeded' ? t('trColRuledOutBy') : t('trColStatus')}</TableHead>
        )}
        {columns.note && <TableHead className="hidden lg:table-cell">{t('trColNote')}</TableHead>}
        {/* The disclosure column. ⚠ The `sr-only` goes on a `<span>` INSIDE the
            head, never on the `<th>` itself: `sr-only` is `position: absolute`,
            which would take the cell out of the header row and leave the header
            one cell short of every body row. */}
        <TableHead className="w-11">
          <span className="sr-only">{t('trRowDetail')}</span>
        </TableHead>
      </TableRow>
    </TableHeader>
  )

  const tableFor = (g: TransferGroup) => (
    <Table>
      {head}
      <TableBody>
        {g.rows.map((m) => (
          <TransferRow
            key={String(m.id)}
            member={m}
            mode={mode}
            columns={columns}
            derivations={derivations}
            actions={actions}
          />
        ))}
      </TableBody>
    </Table>
  )

  // "No grouping": one flat table per group with no header strip at all. The
  // card stays so the table keeps the same border and background as every other
  // tab — what is dropped is the header, which has nothing to say once the rows
  // are not grouped by anything.
  if (groupBy === 'none') {
    return (
      <div className="space-y-4">
        {groups.map((g) => (
          <div key={g.key || 'all'} className={CARD_CLASS}>
            {tableFor(g)}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {groups.map((g) => {
        // ⚠ Keyed by mode AND group key: the same federation code appears in the
        // worklist and in "Ruled out", and one shared key would open both.
        const groupKey = `${mode}:${g.key}`
        const open = openGroups.has(groupKey)
        const setOpen = (next: boolean) => { onGroupOpenChange(groupKey, next) }
        const body = <div className="border-t border-gray-100 dark:border-gray-700">{tableFor(g)}</div>

        const header = groupBy === 'state' ? (
          /**
           * Grouped by derived state, so the group is NOT a federation — its
           * rows come from many of them. The federation header is deliberately
           * not reused here: its contact line and prepared letter would address
           * one federation on behalf of members licensed by several, and a
           * missing-contact note against a state name ("no VIS contact on file
           * for Can request") is nonsense. The state is already the label, and
           * every row carries its own State badge.
           */
          <div className={GROUP_HEADER_CLASS}>
            <span className="text-sm font-semibold text-gray-900 dark:text-white">{g.label}</span>
            <Badge variant="neutral">{t('trMemberCount', { count: g.rows.length })}</Badge>
          </div>
        ) : (
          <FederationGroupHeader
            group={g}
            mode={mode}
            // ⚠ `clarify` groups by nationality, and a nationality must not be
            // addressed as though it were a federation-of-origin answer — so it
            // never resolves a federation, contact or letter.
            federation={mode === 'clarify' ? null : (derivations.federationByIso.get(g.key) ?? null)}
            visCounts={countVisPresence(g.rows)}
            collapsible={columns.collapsible}
            open={open}
            onOpenChange={setOpen}
          />
        )

        // ⚠⚠ `{open && body}` — the body is UNMOUNTED while closed, not hidden.
        const card = (
          <>
            {header}
            {(!columns.collapsible || open) && body}
          </>
        )

        return columns.collapsible ? (
          <Collapsible
            key={g.key || 'unknown'}
            open={open}
            onOpenChange={setOpen}
            className={CARD_CLASS}
          >
            {card}
          </Collapsible>
        ) : (
          <div key={g.key || 'unknown'} className={CARD_CLASS}>
            {card}
          </div>
        )
      })}
    </div>
  )
}
