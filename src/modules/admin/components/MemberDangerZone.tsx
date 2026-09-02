// src/modules/admin/components/MemberDangerZone.tsx
//
// The last block of the member detail in the Data Explorer, in the order an
// operator escalates through it:
//
//   1. the four status columns — the LOW LEVEL switches for club membership,
//      app access and the shell account,
//   2. "Member left" — the whole departure as one action (MemberDepartModal),
//   3. "Delete permanently" — the hard delete (DeleteImpactModal).
//
// Why the four columns live here and nowhere else: they render READ-ONLY in the
// field grid above (see memberFieldSchema.ts → `dangerZone`). One column, one
// editing surface. Two competing affordances for "switch off this person's
// login" is how you end up flipping it by accident while fixing a typo in their
// address.
//
// ⚠ 1 IS NOT 2. Flipping "Club membership" off is one column: it drops the
// person out of the app, but the club register still says they are a member,
// there is no exit date, nothing is pushed to ClubDesk, and Data Health reports
// them under "Former members without an exit date (no retention period
// running)". It is the temporary switch-off. The departure is (2).
//
// ⚠ 2 IS NOT 3 EITHER. Deleting destroys the person's wiedisync history and
// does NOT remove their ClubDesk contact — nothing in wiedisync ever deletes a
// register contact. For somebody who has simply left the club, (2) is the
// correct action; DeleteImpactModal says so on screen when the member is linked.
//
// Status changes are ordinary PATCHes behind an ordinary confirm. The departure
// writes five things at once through departMember.ts, shared with the grid's
// bulk action. The delete goes through DeleteImpactModal, which counts every
// dependent row first and makes the operator type `DELETE`.

import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Trash2, UserMinus } from 'lucide-react'
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
import MemberDepartModal from './MemberDepartModal'

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

/**
 * `Yes` emerald / `No` red — the same colour language the field grid uses.
 * ⚠ The label is translated: it was hardcoded English in a five-locale app.
 */
function BoolValue({ value, t }: { value: boolean; t: (key: string) => string }) {
  return (
    <span className={value ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
      {value ? t('yes') : t('no')}
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
  const [departOpen, setDepartOpen] = useState(false)
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
      current: <BoolValue t={tCommon} value={membershipActive} />,
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
      current: <BoolValue t={tCommon} value={appActive} />,
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
      current: <BoolValue t={tCommon} value={isShell} />,
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
          {/* Explicit desktop width: in a table cell the control is sized from
              its content, and its content is intentionally allowed to shrink,
              which otherwise wraps the time field onto a second line even on a
              1440px screen. `min-w-0` keeps it free to shrink on a phone. */}
          <DateTimePicker
            value={shellExpires}
            onChange={setShellExpires}
            disabled={!canEditStatus || savingKey !== null}
            className="min-w-0 sm:w-[19rem]"
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

      {/* ⚠ `table-fixed`. With auto layout the column widths come from the
          content's min-content, and the date+time picker's is ~280px, so the
          table demanded 460px inside a 292px card and everything from the third
          column on was clipped behind the overflow container. Fixed layout
          sizes the columns from the percentages below instead, and the picker
          then wraps inside whatever it is given. */}
      {canEditStatus && (
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[38%] sm:w-[30%]">{t('explorerDangerColSetting')}</TableHead>
              {/* The state column is redundant on a phone — the switch in the
                  action column already shows on/off, and the expiry picker
                  already shows the stored date — and three columns plus a date
                  field do not fit 390px, so the table used to scroll away under
                  its own card. Hidden below `sm`, kept on desktop where the
                  explicit Yes/No is the faster read. */}
              <TableHead className="hidden sm:table-cell sm:w-[15%]">{t('explorerDangerColState')}</TableHead>
              <TableHead>{t('explorerDangerColAction')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.key} className="min-h-[44px]">
                <TableCell className="text-sm font-medium">{r.label}</TableCell>
                <TableCell className="hidden text-sm sm:table-cell">{r.current}</TableCell>
                <TableCell>{r.action}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* ── Member left ────────────────────────────────────────────────────
          The departure, as one action. The four switches above are the LOW
          LEVEL columns: flipping "Club membership" off on its own leaves the
          register saying this person is still a member with no exit date, and
          Data Health then reports them under "Former members without an exit
          date (no retention period running)". This button writes the whole
          statement — status, exit date, both flags, and the current-season
          rosters — via the same helper the grid's bulk action uses. */}
      {canEditStatus && (
        <div className="mt-4 border-t border-destructive/30 pt-4">
          <Button
            type="button"
            variant="destructive"
            icon={<UserMinus />}
            onClick={() => setDepartOpen(true)}
          >
            {t('explorerDangerDepart')}
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">{t('explorerDangerDepartHint')}</p>
        </div>
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
          <p className="mt-2 text-xs text-muted-foreground">{t('explorerDangerDeleteHint')}</p>
        </div>
      )}

      {canEditStatus && departOpen && (
        <MemberDepartModal
          open={departOpen}
          onClose={() => setDepartOpen(false)}
          memberId={memberId}
          memberName={name}
          member={member}
          onDeparted={onPatched}
        />
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
