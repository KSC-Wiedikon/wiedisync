// src/modules/admin/components/DeleteImpactModal.tsx
//
// "Here is everything that dies with this record" — then a typed `DELETE`.
//
// The order of operations is the whole point:
//   1. open in a loading state and fetch the impact,
//   2. render the dependent-row counts, split by what the database will
//      actually do to each one,
//   3. only then unlock the destructive button, and never while a RESTRICT
//      blocker (or a failed preview) is on screen.
//
// A row can be created between the preview and the delete, so the RESTRICT
// case is handled a second time on failure: the modal stays open, names the
// blocking table, and re-runs the preview so the operator sees the new blocker.

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AlertTriangle, Loader2, UserX } from 'lucide-react'
import { deleteRecord, kscwApi } from '../../../lib/api'
import {
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from '../../../components/ui/table'
import TypedConfirmDialog from '../../../components/TypedConfirmDialog'
import { useDeleteImpact, type DeleteImpactRow, type DeleteImpactRule } from '../hooks/useDeleteImpact'

/** The literal the operator types. English in every locale — it is a token, not a word. */
const REQUIRED_TEXT = 'DELETE'

export interface DeleteImpactModalProps {
  open: boolean
  collection: 'members' | 'events' | 'trainings' | 'games'
  recordId: string
  /** Human label for the heading + the success toast, e.g. "Anna Muster". */
  recordLabel: string
  onCancel: () => void
  /** Fired after a 2xx delete. The caller refreshes the cache and navigates back. */
  onDeleted: () => void
}

/** Per-rule row styling. RESTRICT screams, CASCADE/TRIGGER/ORPHANED warn, SET NULL is calm. */
const RULE_STYLE: Record<DeleteImpactRule, { row: string; text: string }> = {
  'RESTRICT': { row: 'bg-destructive/10', text: 'text-destructive font-medium' },
  'CASCADE': { row: '', text: 'text-amber-700 dark:text-amber-400' },
  'TRIGGER_DELETE': { row: '', text: 'text-amber-700 dark:text-amber-400' },
  'ORPHANED': { row: '', text: 'text-amber-700 dark:text-amber-400' },
  'SET NULL': { row: '', text: 'text-muted-foreground' },
}

const RULE_LABEL_KEY: Record<DeleteImpactRule, string> = {
  'RESTRICT': 'explorerDangerRuleRestrict',
  'CASCADE': 'explorerDangerRuleCascade',
  'TRIGGER_DELETE': 'explorerDangerRuleTrigger',
  'ORPHANED': 'explorerDangerRuleOrphaned',
  'SET NULL': 'explorerDangerRuleSetNull',
}

/**
 * Pull the blocking (referencing) table out of a Postgres FK-violation string.
 *
 *   update or delete on table "members" violates foreign key constraint
 *   "finance_expenses_member_foreign" on table "finance_expenses"
 *
 * The LAST `on table "…"` is the referencing side — the table holding the rows
 * that have to be dealt with first.
 */
function parseRestrictTable(message: string | null | undefined): string | null {
  if (!message) return null
  const matches = [...String(message).matchAll(/on table "([^"]+)"/g)]
  if (matches.length > 0) return matches[matches.length - 1][1]
  const constraint = String(message).match(/constraint "([a-z0-9_]+?)_[a-z0-9_]+_foreign"/i)
  return constraint ? constraint[1] : null
}

function isRestrictMessage(message: string): boolean {
  return /violates foreign key constraint|update or delete on table/i.test(message)
}

export default function DeleteImpactModal({
  open,
  collection,
  recordId,
  recordLabel,
  onCancel,
  onDeleted,
}: DeleteImpactModalProps) {
  const { t } = useTranslation('admin')
  const { t: tCommon } = useTranslation('common')
  const { data, loading, error, reload } = useDeleteImpact(collection, recordId, open)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const sentinelBlocked = data?.blockers.some((b) => b.kind === 'sentinel') ?? false
  const blockerRows: DeleteImpactRow[] = (data?.blockers ?? [])
    .filter((b) => b.kind === 'restrict')
    .map((b) => ({ table: b.table, column: b.column ?? null, rule: 'RESTRICT', count: b.count ?? 0 }))

  const triggerRows = (data?.polymorphic ?? []).filter((r) => r.rule === 'TRIGGER_DELETE')
  const orphanRows = (data?.polymorphic ?? []).filter((r) => r.rule === 'ORPHANED')

  // RESTRICT first (it is the reason nothing will happen), then destructive,
  // then trigger-driven, then the harmless link clearing, then the leftovers.
  const rows: DeleteImpactRow[] = [
    ...blockerRows,
    ...(data?.cascade ?? []),
    ...triggerRows,
    ...(data?.setNull ?? []),
    ...orphanRows,
  ]

  // Blocked while we do not KNOW it is safe: still loading, the preview failed,
  // or the server reported something that blocks.
  const blocked = loading || !!error || !data || data.blockers.length > 0

  async function handleConfirm() {
    setBusy(true)
    setFailure(null)
    try {
      if (collection === 'members') {
        const res = await kscwApi<{ success: boolean; user_deleted?: boolean; warning?: string }>(
          '/admin/delete-member',
          { method: 'POST', body: { member_id: Number(recordId) } },
        )
        toast.success(t('explorerDangerDeleted', { label: recordLabel }))
        // The member is gone either way — but if their login survived, the
        // operator has to know, because that account can still authenticate.
        if (res?.user_deleted === false) {
          toast.warning(res.warning || t('explorerDangerLinkedUserKept', { email: data?.linkedUser?.email ?? '' }))
        }
      } else {
        // Items API: Directus writes its own actor trail for these.
        await deleteRecord(collection, recordId)
        toast.success(t('explorerDangerDeleted', { label: recordLabel }))
      }
      onDeleted()
    } catch (err: unknown) {
      const body = (err as {
        body?: { error?: string; message?: string; table?: string; count?: number | null }
      })?.body
      const raw = body?.message || (err instanceof Error ? err.message : String(err))

      // Refusals the server decides and the UI cannot: sport scope, rank, self.
      // They are error CODES, not sentences — the endpoint must never hand a
      // locale-less English string to a French-speaking operator.
      const REFUSAL_KEY: Record<string, string> = {
        scope: 'explorerDangerOutOfScope',
        self: 'explorerDangerBlockedSelf',
        privileged: 'explorerDangerBlockedPrivileged',
      }
      if (body?.error && REFUSAL_KEY[body.error]) {
        setFailure(t(REFUSAL_KEY[body.error]))
      } else if (body?.error === 'restrict' || isRestrictMessage(raw)) {
        // Something was created between the preview and now. Name the table —
        // never dump the raw Postgres string at the operator.
        const table = body?.table || parseRestrictTable(raw)
        // The endpoint recounts the blocking rows on this path; the cached
        // preview cannot know about a row that appeared after it ran, so its
        // count for this table is stale (zero) and must not be used.
        const count = typeof body?.count === 'number' ? body.count : null
        if (table && count !== null) {
          setFailure(t('explorerDangerBlockedRestrict', { table, count }))
        } else if (table) {
          // Count unavailable — still name the table, still no Postgres string.
          setFailure(`${t('explorerDangerBlockedTitle')} — ${table}`)
        } else {
          setFailure(t('explorerDangerDeleteError', { message: raw }))
        }
        // Re-run the preview so the new blocker shows up in the table below.
        reload()
      } else {
        setFailure(t('explorerDangerDeleteError', { message: raw }))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <TypedConfirmDialog
      open={open}
      title={t('explorerDangerDeleteTitle', { label: recordLabel })}
      message={t('explorerDangerDeleteIntro')}
      requiredText={REQUIRED_TEXT}
      inputLabel={t('explorerDangerTypeToConfirm')}
      mismatchHint={t('explorerDangerTypeMismatch')}
      confirmLabel={busy ? t('explorerDangerDeleting') : t('explorerDangerDelete')}
      cancelLabel={tCommon('cancel')}
      blocked={blocked}
      busy={busy}
      onConfirm={handleConfirm}
      onCancel={onCancel}
    >
      <div className="space-y-3">
        {/* Loading / failed preview — both keep the confirm button disabled. */}
        {loading && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('explorerDangerImpactLoading')}
          </p>
        )}
        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {t('explorerDangerImpactError')}
          </div>
        )}

        {/* A delete that failed after the preview said it would work. */}
        {failure && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <p className="font-medium">{t('explorerDangerBlockedTitle')}</p>
            <p>{failure}</p>
          </div>
        )}

        {data && (
          <>
            {/* Callouts — the things a row count cannot say. */}
            {sentinelBlocked && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{t('explorerDangerBlockedSentinel')}</span>
              </div>
            )}
            {data.linkedUser && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
                <UserX className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{t('explorerDangerLinkedUser', { email: data.linkedUser.email ?? data.linkedUser.id })}</span>
              </div>
            )}
            {data.derbySiblings > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{t('explorerDangerDerbySibling', { count: data.derbySiblings })}</span>
              </div>
            )}

            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('explorerDangerNothingElse')}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('explorerDangerColTable')}</TableHead>
                    <TableHead>{t('explorerDangerColEffect')}</TableHead>
                    <TableHead className="text-right">{t('explorerDangerColRows')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const style = RULE_STYLE[r.rule]
                    return (
                      <TableRow key={`${r.table}.${r.column ?? '*'}.${r.rule}`} className={style.row}>
                        <TableCell className="font-mono text-xs">
                          {r.table}
                          {r.column && <span className="text-muted-foreground">.{r.column}</span>}
                        </TableCell>
                        <TableCell className={`text-xs ${style.text}`}>
                          {t(RULE_LABEL_KEY[r.rule])}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">
                          {r.count}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={2} className="text-xs font-medium">
                      {t('explorerDangerTotal', { count: data.total })}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">{data.total}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            )}
          </>
        )}
      </div>
    </TypedConfirmDialog>
  )
}
