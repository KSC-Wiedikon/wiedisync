// src/modules/admin/components/MemberDangerZone.tsx
//
// The last block of the member detail in the Data Explorer: the four status
// columns that decide whether a person is still a club member and can still log
// in, plus the hard delete.
//
// Why these four live here and nowhere else: they render READ-ONLY in the field
// grid above (see memberFieldSchema.ts → `dangerZone`). One column, one editing
// surface. Two competing affordances for "switch off this person's login" is
// how you end up flipping it by accident while fixing a typo in their address.
//
// Status changes are ordinary PATCHes behind an ordinary confirm. The delete is
// not: it goes through DeleteImpactModal, which counts every dependent row
// first and makes the operator type `DELETE`.

import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'
import { updateRecord } from '../../../lib/api'
import { logActivity } from '../../../utils/logActivity'
import { formatDateTimeCompactZurich } from '../../../utils/dateHelpers'
import { useConfirm } from '../../../components/ConfirmProvider'
import { Button } from '../../../components/ui/button'
import { Switch } from '../../../components/ui/switch'
import DateTimePicker from '../../../components/ui/DateTimePicker'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../../../components/ui/table'
import DeleteImpactModal from './DeleteImpactModal'

export interface MemberDangerZoneProps {
  memberId: string
  /** The sanitized record (sensitive keys already stripped). */
  member: Record<string, unknown>
  /** Status toggles enabled. */
  canEditStatus: boolean
  /**
   * Delete affordance rendered at all.
   *
   * ⚠ The CALLER narrows this — by the member's own sport (spec §4.5), by rank
   * (a sport admin may not delete a board member or another admin) and by self.
   * This component deliberately does not re-derive any of it: it has no cache,
   * and the real boundary is the server, not a prop. `POST
   * /kscw/admin/delete-member` re-checks all three and answers 403 `scope` /
   * `privileged` / `self` regardless of what the UI decided.
   */
  canDelete: boolean
  /** Called after a successful status PATCH with the patch and the server response. */
  onPatched: (patch: Record<string, unknown>, updated: Record<string, unknown>) => void
  /** Called after a successful delete. */
  onDeleted: () => void
}

/** `Yes` emerald / `No` red — the same colour language the field grid uses. */
function BoolValue({ value }: { value: boolean }) {
  return (
    <span className={value ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
      {value ? 'Yes' : 'No'}
    </span>
  )
}

function asBool(v: unknown): boolean {
  return v === true || v === 'true' || v === 1
}

/**
 * Stored UTC ISO → the LOCAL `YYYY-MM-DDTHH:mm` string DateTimePicker speaks.
 *
 * ⚠ Not `iso.slice(0, 16)`. That hands the picker a UTC wall clock while the
 * save path (`new Date(local).toISOString()`) reads it back as local — in CET
 * the value would drift by an hour or two on every open/save round trip, and
 * the Save button would never settle back to disabled.
 */
function toPickerValue(v: unknown): string {
  if (typeof v !== 'string' || !v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return v.slice(0, 16)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function MemberDangerZone({
  memberId,
  member,
  canEditStatus,
  canDelete,
  onPatched,
  onDeleted,
}: MemberDangerZoneProps) {
  const { t } = useTranslation('admin')
  const { t: tCommon } = useTranslation('common')
  const confirm = useConfirm()

  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)

  // The picker is a draft over the stored value. Re-sync it whenever the record
  // actually changes — a different member, or our own save landing — but not on
  // every re-render, so an in-progress edit survives. Render-phase adjustment
  // (react-hooks/set-state-in-effect is an error in this repo).
  const storedShellExpires = toPickerValue(member.shell_expires)
  const shellKey = `${memberId}|${storedShellExpires}`
  const [shellExpires, setShellExpires] = useState<string>(storedShellExpires)
  const [primedShellKey, setPrimedShellKey] = useState(shellKey)
  if (primedShellKey !== shellKey) {
    setPrimedShellKey(shellKey)
    setShellExpires(storedShellExpires)
  }

  // Nothing to offer → render nothing. An empty red box reads as a broken page.
  if (!canEditStatus && !canDelete) return null

  const name = [member.first_name, member.last_name].filter(Boolean).join(' ').trim()
    || String(member.email || `#${memberId}`)

  async function patch(key: string, value: unknown, confirmMessage: string | null) {
    if (confirmMessage && !(await confirm({ message: confirmMessage, danger: true }))) return
    setSavingKey(key)
    try {
      const body = { [key]: value }
      // fields: ['*'] — without it Directus answers with its default field set
      // and the caller's record would silently change shape after a save.
      const updated = await updateRecord<Record<string, unknown>>(
        'members', memberId, body, { fields: ['*'] },
      )
      logActivity('update', 'members', memberId, body)
      onPatched(body, updated)
      toast.success(t('explorerDangerStatusSaved'))
    } catch {
      toast.error(t('explorerDangerStatusError'))
      // Re-sync the local control from the record — the switch must not stay
      // showing a state the database rejected.
      if (key === 'shell_expires') setShellExpires(storedShellExpires)
    } finally {
      setSavingKey(null)
    }
  }

  const membershipActive = asBool(member.kscw_membership_active)
  const appActive = asBool(member.wiedisync_active)
  const isShell = asBool(member.shell)

  const rows: Array<{
    key: string
    label: string
    current: ReactNode
    action: ReactNode
  }> = [
    {
      key: 'kscw_membership_active',
      label: t('explorerDangerMembership'),
      current: <BoolValue value={membershipActive} />,
      action: (
        <Switch
          checked={membershipActive}
          disabled={!canEditStatus || savingKey !== null}
          aria-label={t('explorerDangerMembership')}
          onCheckedChange={(next) => {
            void patch(
              'kscw_membership_active',
              next,
              next
                ? t('explorerDangerConfirmMembershipOn', { name })
                : t('explorerDangerConfirmMembershipOff', { name }),
            )
          }}
        />
      ),
    },
    {
      key: 'wiedisync_active',
      label: t('explorerDangerAppAccess'),
      current: <BoolValue value={appActive} />,
      action: (
        <Switch
          checked={appActive}
          disabled={!canEditStatus || savingKey !== null}
          aria-label={t('explorerDangerAppAccess')}
          onCheckedChange={(next) => {
            void patch(
              'wiedisync_active',
              next,
              next
                ? t('explorerDangerConfirmAppAccessOn', { name })
                : t('explorerDangerConfirmAppAccessOff', { name }),
            )
          }}
        />
      ),
    },
    {
      key: 'shell',
      label: t('explorerDangerShell'),
      current: <BoolValue value={isShell} />,
      action: (
        <Switch
          checked={isShell}
          disabled={!canEditStatus || savingKey !== null}
          aria-label={t('explorerDangerShell')}
          onCheckedChange={(next) => {
            // ⚠ `shell` is trigger-managed: trg_members_shell_convert flips it
            // to false the first time the member activates their login. Setting
            // it back to true on a real member re-enters them into the daily
            // 09:00 UTC shell-invite reminder sweep — i.e. it emails them.
            void patch(
              'shell',
              next,
              next
                ? t('explorerDangerConfirmShellOn', { name })
                : t('explorerDangerConfirmShellOff', { name }),
            )
          }}
        />
      ),
    },
    {
      key: 'shell_expires',
      label: t('explorerDangerShellExpires'),
      current: (
        <span className="font-mono text-xs">
          {member.shell_expires ? formatShellExpires(member.shell_expires) : '—'}
        </span>
      ),
      action: (
        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          <DateTimePicker
            value={shellExpires}
            onChange={setShellExpires}
            disabled={!canEditStatus || savingKey !== null}
            className="min-w-0"
          />
          <Button
            type="button"
            variant="outline"
            size="default"
            disabled={
              !canEditStatus
              || savingKey !== null
              || shellExpires === storedShellExpires
            }
            loading={savingKey === 'shell_expires'}
            onClick={() => {
              // No confirm: a date change is reversible and self-evident.
              void patch(
                'shell_expires',
                shellExpires ? new Date(shellExpires).toISOString() : null,
                null,
              )
            }}
          >
            {tCommon('save')}
          </Button>
        </div>
      ),
    },
  ]

  return (
    <section className="mt-8 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
      <h2 className="text-base font-semibold text-destructive">{t('explorerDangerTitle')}</h2>
      <p className="mb-3 text-xs text-muted-foreground">{t('explorerDangerDescription')}</p>

      {canEditStatus && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('explorerDangerColSetting')}</TableHead>
              <TableHead>{t('explorerDangerColState')}</TableHead>
              <TableHead>{t('explorerDangerColAction')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.key} className="min-h-[44px]">
                <TableCell className="text-sm font-medium">{r.label}</TableCell>
                <TableCell className="text-sm">{r.current}</TableCell>
                <TableCell>{r.action}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {canDelete && (
        <div className="mt-4 border-t border-destructive/30 pt-4">
          <Button
            type="button"
            variant="destructive"
            icon={<Trash2 />}
            onClick={() => setDeleteOpen(true)}
          >
            {t('explorerDangerDelete')}
          </Button>
        </div>
      )}

      {canDelete && deleteOpen && (
        <DeleteImpactModal
          open={deleteOpen}
          collection="members"
          recordId={memberId}
          recordLabel={name}
          onCancel={() => setDeleteOpen(false)}
          onDeleted={() => {
            setDeleteOpen(false)
            onDeleted()
          }}
        />
      )}
    </section>
  )
}

/** Swiss dd.mm.yyyy HH:MM via the central helper (it pins de-CH + hour12:false). */
function formatShellExpires(iso: unknown): string {
  if (typeof iso !== 'string' || !iso) return '—'
  return formatDateTimeCompactZurich(iso) || String(iso)
}
