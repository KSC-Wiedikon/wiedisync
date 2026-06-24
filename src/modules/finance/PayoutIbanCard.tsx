import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Landmark, Pencil, Check, ShieldCheck } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { FormInput } from '../../components/FormField'
import { useAuth } from '../../hooks/useAuth'
import { updateRecord } from '../../lib/api'
import { logActivity } from '../../utils/logActivity'
import { isValidIban, normalizeIban, formatIban } from '../../utils/iban'
import { toast } from 'sonner'

/**
 * The member's payout IBAN — the canonical place to add/edit/check it.
 * Moved out of the profile editor so finance settings live in the Finance tab.
 * The value is pre-filled from ClubDesk (backfill-member-iban.sql); the member
 * confirms or corrects it here. Sensitive financial PII: own-member + admin only.
 */
export default function PayoutIbanCard() {
  const { t } = useTranslation('finance')
  const { t: tc } = useTranslation('common')
  const { user, refreshUser } = useAuth()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  if (!user) return null

  const current = user.iban ? formatIban(user.iban) : ''

  function startEdit() {
    setValue(user?.iban ? formatIban(user.iban) : '')
    setError('')
    setEditing(true)
  }

  async function save() {
    if (!user) return
    setError('')
    const trimmed = value.trim()
    if (trimmed && !isValidIban(trimmed)) {
      setError(t('ibanInvalid'))
      return
    }
    setSaving(true)
    try {
      const iban = trimmed ? normalizeIban(trimmed) : null
      // Saving your own IBAN counts as confirming it (migration 136).
      await updateRecord('members', user.id, { iban, iban_confirmed: !!iban })
      logActivity('update', 'members', user.id, { iban: iban ? 'set' : 'cleared' })
      await refreshUser()
      toast.success(t('ibanSaved'))
      setEditing(false)
    } catch {
      setError(t('ibanSaveError'))
    } finally {
      setSaving(false)
    }
  }

  async function confirmIban() {
    if (!user) return
    setSaving(true)
    try {
      await updateRecord('members', user.id, { iban_confirmed: true })
      logActivity('update', 'members', user.id, { iban: 'confirmed' })
      await refreshUser()
      toast.success(t('ibanConfirmed'))
    } catch {
      toast.error(t('ibanSaveError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-300">
          <Landmark className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t('ibanCardTitle')}</h2>
            {!editing && (
              <Button type="button" variant="ghost" size="sm" onClick={startEdit} className="h-8 px-2">
                <Pencil className="mr-1.5 h-3.5 w-3.5" />
                {current ? tc('edit') : t('ibanCardAdd')}
              </Button>
            )}
          </div>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{t('ibanCardSubtitle')}</p>

          {editing ? (
            <div className="mt-3 space-y-2">
              <FormInput
                label={t('ibanCardTitle')}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="CH00 0000 0000 0000 0000 0"
                autoComplete="off"
                autoFocus
                spellCheck={false}
              />
              {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
              <div className="flex items-center justify-end gap-2 pt-1">
                <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={saving}>
                  {tc('cancel')}
                </Button>
                <Button type="button" size="sm" onClick={save} loading={saving}>
                  <Check className="mr-1.5 h-3.5 w-3.5" />
                  {saving ? tc('saving') : tc('save')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-2.5">
              {current ? (
                <>
                  <p className="font-mono text-sm tabular-nums text-gray-900 dark:text-gray-100">{current}</p>
                  {user.iban_confirmed === false && (
                    <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 dark:border-amber-900/40 dark:bg-amber-900/20">
                      <p className="text-xs text-amber-800 dark:text-amber-300">{t('ibanConfirmPrompt')}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button type="button" size="sm" onClick={confirmIban} loading={saving}>
                          <Check className="mr-1.5 h-3.5 w-3.5" />{t('ibanConfirmYes')}
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={startEdit}>{t('ibanConfirmChange')}</Button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-amber-700 dark:text-amber-300">{t('ibanCardEmpty')}</p>
              )}
            </div>
          )}

          <p className="mt-2.5 flex items-center gap-1.5 text-[11px] text-gray-400 dark:text-gray-500">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
            {t('ibanCardPrivacy')}
          </p>
        </div>
      </div>
    </div>
  )
}
