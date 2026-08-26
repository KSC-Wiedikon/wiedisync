import { useAuth } from '../../hooks/useAuth'
import { useReportPageLoading } from '../../hooks/usePageReady'
import { useTransferData } from './transfers/hooks/useTransferData'
import { useTransferUiState } from './transfers/hooks/useTransferUiState'
import { useTransferWrites } from './transfers/hooks/useTransferWrites'
import { useVisCheckRun } from './transfers/hooks/useVisCheckRun'
import { DiagnosticsPanel } from './transfers/components/DiagnosticsPanel'
import { TransferAlerts } from './transfers/components/TransferAlerts'
import { TransferCohortTabs } from './transfers/components/TransferCohortTabs'
import { TransferNumbersBar } from './transfers/components/TransferNumbersBar'
import { TransfersHeader } from './transfers/components/TransfersHeader'
import type { TransferRowActions } from './transfers/types'

/**
 * /admin/transfers — the international-transfer worklist, as a composition root.
 *
 * Everything this file used to hold lives in `./transfers/` now, in four layers
 * that may only depend downwards:
 *
 *   transfers/types.ts + constants.ts   the shapes and the tuned constants
 *   transfers/utils/*.ts                pure functions — no React, no i18n
 *   transfers/hooks/*.ts                the six queries, the writes, the VIS
 *                                       poll loop and the view state
 *   transfers/components/*.tsx          presentation only, props in, JSX out
 *
 * This file wires them together and does nothing else: it holds no query, no
 * derivation and no string. The one thing it DOES own is hook order — see the
 * boundary comment below.
 *
 * ⚠ The path and the DEFAULT export are load-bearing. `src/App.tsx` imports this
 * module eagerly and mounts it at `admin/transfers`; renaming either breaks the
 * route with no type error anywhere.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * VOLLEYBALL ONLY — the page had a sport toggle and no longer does.
 *
 * Everything this page is made of belongs to FIVB's apparatus: the VIS player
 * index, the VIS federation directory, the prepared letters, and the Swiss
 * Volley licence cross-check. A FIBA transfer runs federation to federation
 * through Swiss Basketball and is not worked from here, so a basketball tab
 * could only ever show a worklist nobody works, addressed to the wrong
 * governing body. Basketball players are COUNTED (`trHiddenBasketball`) rather
 * than dropped in silence — in the header line and again in the Diagnostics
 * tab's "Not on this page" card.
 *
 * The sport itself is pinned once, as `SPORT` in `transfers/constants.ts`.
 */
export default function TransfersPage() {
  const { hasAdminAccessToSport } = useAuth()
  /**
   * Who may TRIGGER the VIS check — the same set the endpoint's gate admits
   * (global admin / superuser / vb_admin), and deliberately narrower than who
   * may READ this page: `isAdmin` includes `bb_admin`, VIS is FIVB's index, and
   * a button that is visible but 403s is worse than one that is absent.
   *
   * ⚠ It is resolved ONCE, here, and travels as a prop (into `TransferRowActions`
   * for the per-row "Link VIS player" button, and into `DiagnosticsPanel` for
   * the "Check VIS now" card). No component re-derives it from a generic
   * `isAdmin` — that is how the two ended up disagreeing before.
   */
  const canRunVisCheck = hasAdminAccessToSport('volleyball')

  const data = useTransferData()
  const writes = useTransferWrites()
  const ui = useTransferUiState()

  /**
   * ⚠⚠ The VIS poll loop is instantiated HERE and nowhere else. Its only stop
   * signal is a ref set by an unmount effect (there is no AbortController), so a
   * copy living inside the header or the Diagnostics card would abort a live run
   * whenever that card unmounts — and start a second concurrent poll on the way
   * back. Both surfaces receive `visRunning` + `runVisCheck` as props.
   */
  const { visRunning, runVisCheck } = useVisCheckRun(data.refetch)

  // Report to the app boot gate — see usePageReady.tsx. `useTransferData` keys
  // `bootLoading` off `undefined` (query never resolved) rather than isLoading:
  // a DISABLED query reports isLoading=false in react-query v5 and would lift
  // the gate too early. The VM lookup is deliberately NOT part of the gate — it
  // is a secondary cross-check and must never hold the whole page hostage.
  useReportPageLoading(data.bootLoading)

  // ⚠⚠ HOOK BOUNDARY. Every hook this page uses is called above this line, and
  // nothing below it may call one — a hook after an early return is a
  // rules-of-hooks violation that ships as React #310 in production. `tsc` does
  // NOT catch it; only `npm run lint` does. Everything below is plain functions
  // and JSX.
  if (data.bootLoading) return null

  /**
   * The write surface every row shares. Bundled once so a row never reaches for
   * a mutation itself: `noteDrafts` and `savingId` are page-level by design
   * (a controlled note input that writes back into the row rendering it is the
   * render-phase setState that produces React #301, and one row saving at a time
   * is what every cell's `disabled` depends on).
   */
  const actions: TransferRowActions = {
    savingId: writes.savingId,
    canRunVisCheck,
    noteDrafts: writes.noteDrafts,
    openRows: ui.openRows,
    onToggleRow: ui.setRowOpen,
    onNoteDraftChange: writes.setNoteDraft,
    onSetStatus: (m, next) => { void writes.setStatus(m, next) },
    onSaveNote: (m, value) => { void writes.saveNote(m, value) },
    onLinkVisPlayer: (m) => { void writes.linkVisPlayer(m) },
  }

  /**
   * Only the DANGEROUS direction is promoted to a strip: we record CH and
   * Swiss Volley records a foreign federation, so nobody is chasing a transfer
   * that may be required. The other two kinds are reported in the
   * Diagnostics table, which is where all three are counted.
   */
  const dangerousConflictCount = data.fooConflicts.filter((c) => c.kind === 'vmSaysForeign').length

  return (
    <div className="mx-auto max-w-6xl px-4 py-4">
      <TransfersHeader
        isFetching={data.isFetching}
        onRefresh={() => { void data.refetch() }}
        hidden={data.hidden}
        u20Count={data.cohorts.u20}
      />

      <TransferAlerts
        blockedCount={data.blockedRows.length}
        dangerousConflictCount={dangerousConflictCount}
        onShowBlocked={ui.showBlocked}
        onShowConflicts={ui.showConflicts}
      />

      <TransferNumbersBar
        stateCounts={data.stateCounts}
        needsCount={data.cohorts.needs.length}
        stateFilter={ui.stateFilter}
        onStateFilterChange={ui.setStateFilter}
        lastVisCheck={data.lastVisCheck}
      />

      <TransferCohortTabs
        activeTab={ui.activeTab}
        onTabChange={ui.setActiveTab}
        cohorts={data.cohorts}
        conflicts={data.fooConflicts}
        needsGroups={data.needsGroups}
        clarifyGroups={data.clarifyGroups}
        swissGroups={data.swissGroups}
        notNeededGroups={data.notNeededGroups}
        search={ui.search}
        onSearchChange={ui.setSearch}
        groupBy={ui.groupBy}
        onGroupByChange={ui.setGroupBy}
        stateFilter={ui.stateFilter}
        onStateFilterChange={ui.setStateFilter}
        derivations={data.derivations}
        actions={actions}
        openGroups={ui.openGroups}
        onGroupOpenChange={ui.setGroupOpen}
        diagnostics={(
          <DiagnosticsPanel
            conflicts={data.fooConflicts}
            hidden={data.hidden}
            u20Count={data.cohorts.u20}
            settledCount={data.cohorts.settled}
            swissCount={data.cohorts.swiss.length}
            lastVisCheck={data.lastVisCheck}
            canRunVisCheck={canRunVisCheck}
            visRunning={visRunning}
            onRunVisCheck={() => { void runVisCheck() }}
            savingId={writes.savingId}
            onSetStatus={actions.onSetStatus}
            onShowInWorklist={ui.showMemberInWorklist}
          />
        )}
      />
    </div>
  )
}
