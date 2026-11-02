import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Fingerprint, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import IconButton from '@/components/IconButton'
import { Switch } from '@/components/ui/switch'
import { FormInput } from '@/components/FormField'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import LoadingSpinner from '@/components/LoadingSpinner'
import { useConfirm } from '@/components/ConfirmProvider'
import { useAuth } from '../../hooks/useAuth'
import { usePasskeyHint } from '../../hooks/usePasskeyHint'
import { formatDateZurich } from '../../utils/dateHelpers'
import {
  PASSKEYS_MAX, isPasskeyAlreadyHere, isPasskeyCancel, listPasskeys, passkeyErrorCode, passkeyErrorText,
  passkeysPossible, reconcilePasskeyHint, rememberPasskeyHere, removePasskey, setPasskeyLock, setUpPasskey,
  unlockOnThisDevice, type PasskeyRow,
} from '../../lib/passkeys'

const ALERT = 'rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300'

/**
 * Profile → Passkeys (the backend's "passkey added" mail points here): the account's
 * passkeys, one per device; adding one on this device (the password first, then the
 * authenticator code if the account has one); removing any; and the optional app lock.
 * Only the session owner's own keys — hidden while acting for a household member or
 * viewing as someone else, and where passkeys cannot work.
 */
export default function PasskeysCard() {
  const { realUser, isActingForOther, isImpersonating } = useAuth()
  const [possible] = useState(() => passkeysPossible())
  if (!possible || !realUser || isActingForOther || isImpersonating) return null
  return <PasskeysCardBody memberId={realUser.id} />
}

function PasskeysCardBody({ memberId }: { memberId: string }) {
  const { t } = useTranslation('auth')
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const hint = usePasskeyHint(memberId)
  const queryKey = ['passkeys', 'mine', memberId]

  const { data, isLoading, isError } = useQuery({
    queryKey,
    queryFn: async () => {
      const list = await listPasskeys()
      // A key removed here or elsewhere, or all of them by a password change, leaves
      // this device's hint too (and the lock goes off with the last one).
      reconcilePasskeyHint(memberId, list.passkeys.map((p) => p.credential_id))
      return list
    },
  })
  const passkeys = data?.passkeys ?? []

  const [adding, setAdding] = useState(false)
  const [password, setPassword] = useState('')
  const [needCode, setNeedCode] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [addError, setAddError] = useState('')
  const [lockBusy, setLockBusy] = useState(false)
  const [lockError, setLockError] = useState('')

  if (data && !data.available) return null

  const stopAdding = () => {
    setAdding(false)
    setPassword('')
    setNeedCode(false)
    setCode('')
    setAddError('')
  }

  const setList = (update: (rows: PasskeyRow[]) => PasskeyRow[]) => {
    queryClient.setQueryData<typeof data>(queryKey, (prev) => (prev ? { ...prev, passkeys: update(prev.passkeys) } : prev))
  }

  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (busy || !password) return
    setAddError('')
    setBusy(true)
    try {
      const { passkey, onDevice } = await setUpPasskey({ password, otp: needCode ? code.trim() : undefined })
      rememberPasskeyHere(memberId, passkey.credential_id, onDevice)
      setList((rows) => [...rows.filter((r) => r.id !== passkey.id), passkey])
      stopAdding()
      toast.success(t('passkeySetUpDone'))
    } catch (err) {
      if (isPasskeyCancel(err)) return
      if (isPasskeyAlreadyHere(err)) {
        rememberPasskeyHere(memberId, null, false)
        setAddError(t('passkeyErrAlreadyHere'))
        return
      }
      if (passkeyErrorCode(err) === 'otp_required') {
        setNeedCode(true)
        return
      }
      setAddError(passkeyErrorText(t, err))
    } finally {
      setBusy(false)
    }
  }

  async function remove(row: PasskeyRow) {
    if (!(await confirm({
      title: t('passkeyRemoveTitle'),
      message: t('passkeyRemoveConfirm', { label: row.label }),
      confirmLabel: t('passkeyRemove'),
      danger: true,
    }))) return
    try {
      await removePasskey(row.id)
      setList((rows) => rows.filter((r) => r.id !== row.id))
      reconcilePasskeyHint(memberId, passkeys.filter((p) => p.id !== row.id).map((p) => p.credential_id))
      toast.success(t('passkeyRemoved'))
    } catch (err) {
      toast.error(passkeyErrorText(t, err))
    }
  }

  async function toggleLock(on: boolean) {
    setLockError('')
    if (!on) {
      setPasskeyLock(memberId, false)
      return
    }
    // Turning it on runs the check once, so nobody locks themselves out of a lock
    // this device cannot open.
    setLockBusy(true)
    try {
      const result = await unlockOnThisDevice(memberId)
      if (result === 'ok') setPasskeyLock(memberId, true)
      else if (result === 'refused') setLockError(t('passkeyLockCheckFailed'))
    } finally {
      setLockBusy(false)
    }
  }

  const keyHere = hint.credentialIds.length > 0
  const full = passkeys.length >= PASSKEYS_MAX

  return (
    <div className="mt-8" data-testid="passkeys-card">
      <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight text-foreground">
        <Fingerprint className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        {t('passkeysTitle')}
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">{t('passkeysHint')}</p>
      <div className="mt-3 rounded-2xl border border-hairline bg-card shadow-card">
        <div className="space-y-3 p-4">
          {isLoading && <LoadingSpinner size="sm" />}
          {isError && <p role="alert" className={ALERT}>{t('passkeysLoadError')}</p>}
          {data && passkeys.length === 0 && <p className="text-sm text-muted-foreground">{t('passkeysNone')}</p>}
          {passkeys.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-hairline">
              {/* Two columns on purpose: the dates ride under the name, so a phone keeps the
                  name readable and the remove button in view (no column hidden, nothing twice). */}
              <Table data-testid="passkey-list">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('passkeyColName')}</TableHead>
                    <TableHead className="w-0"><span className="sr-only">{t('passkeyRemove')}</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {passkeys.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="min-w-0">
                        <p className="break-words font-medium leading-snug text-foreground">
                          {row.label}
                          {hint.credentialIds.includes(row.credential_id) && (
                            <span className="ml-1.5 inline-block whitespace-nowrap rounded border border-brand-200 bg-brand-50 px-1.5 py-0.5 align-middle text-[10px] font-medium leading-none text-brand-700 dark:border-brand-800/60 dark:bg-brand-900/30 dark:text-brand-300">
                              {t('passkeyThisDevice')}
                            </span>
                          )}
                        </p>
                        <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                          {t('passkeyAddedOn', { date: formatDateZurich(row.created_at) })}
                          {row.last_used_at && <> · {t('passkeyLastUsedOn', { date: formatDateZurich(row.last_used_at) })}</>}
                        </p>
                      </TableCell>
                      <TableCell className="py-1 pl-0 text-right align-middle">
                        <IconButton
                          size="sm"
                          label={t('passkeyRemoveLabel', { label: row.label })}
                          onClick={() => remove(row)}
                          className="text-muted-foreground hover:text-red-600 dark:hover:text-red-400"
                        >
                          <Trash2 />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {adding ? (
            <form onSubmit={add} className="space-y-3 rounded-xl border border-hairline bg-surface-sunken p-3.5">
              <FormInput
                id="passkey-add-password"
                type="password"
                label={t('passkeyPasswordLabel')}
                helperText={t('passkeyPasswordHelp')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                autoFocus
              />
              {needCode && (
                <FormInput
                  id="passkey-add-otp"
                  label={t('passkeyOtpLabel')}
                  helperText={t('passkeyOtpNeeded')}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  autoFocus
                />
              )}
              {addError && <p role="alert" className={ALERT}>{addError}</p>}
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" loading={busy} icon={<Fingerprint />} disabled={!password || (needCode && code.length < 6)}>
                  {busy ? t('passkeyWaiting') : t('passkeySetUp')}
                </Button>
                <Button type="button" variant="outline" onClick={stopAdding} disabled={busy}>
                  {t('common:cancel')}
                </Button>
              </div>
            </form>
          ) : (
            data && !full && (
              <Button variant="outline" icon={<Fingerprint />} onClick={() => setAdding(true)} data-testid="passkey-add">
                {t('passkeyAdd')}
              </Button>
            )
          )}
          {full && !adding && <p className="text-xs text-muted-foreground">{t('passkeyErrFull')}</p>}

          <p className="text-xs font-medium text-foreground/85">{t('passkeysPasswordNote')}</p>
          <p className="text-xs text-muted-foreground/80">{t('passkeyPrivacy')}</p>
        </div>

        {/* The optional app lock — this device only, and only with a key on it. */}
        <div className="flex min-h-[44px] items-center justify-between gap-3 border-t border-hairline px-4 py-3">
          <div className="min-w-0">
            <p id="passkey-lock-label" className="text-sm font-medium text-foreground">{t('passkeyLockLabel')}</p>
            <p className="text-xs text-muted-foreground">{keyHere ? t('passkeyLockHint') : t('passkeyLockNeedsKey')}</p>
            {lockError && <p role="alert" className="mt-1 text-xs font-medium text-destructive">{lockError}</p>}
          </div>
          <Switch
            checked={hint.lock}
            disabled={!keyHere || lockBusy}
            onCheckedChange={(v) => { void toggleLock(v) }}
            aria-labelledby="passkey-lock-label"
          />
        </div>
      </div>
    </div>
  )
}
