import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { kscwApi } from '../../../lib/api'
import { formatDateZurich, formatTimeZurich } from '../../../utils/dateHelpers'

/** `vm_check` on GET /kscw/scorer/game/:gameId/roster — see vmCheckSummary() in scorer-roster.js. */
export interface VmCheck {
  status: 'ok' | 'no_list' | 'busy' | 'failed' | 'unavailable' | null
  due_at: string | null
  checked_at: string | null
  checked_by_name: string | null
  list_at: string | null
  closed_at: string | null
  error: string | null
  issues: { code: string; names?: string[] }[]
}

/** HH:MM today, dd.mm.yyyy HH:MM on any other day. */
function when(iso: string): string {
  const sameDay = formatDateZurich(iso) === formatDateZurich(new Date().toISOString())
  return sameDay ? formatTimeZurich(iso) : `${formatDateZurich(iso)} ${formatTimeZurich(iso)}`
}

/**
 * The Volleymanager check on a match sheet (migration 396). The Einsatzliste is read ONCE,
 * 45 min before kickoff, and every sheet shows that stored list — opening a sheet never
 * logs the shared VM account in. This says when it was (or will be) read, flags every
 * problem with it, and offers a Recheck that reads Volleymanager again.
 */
export default function VmCheckBanner({ gameId, check, onRechecked, className }: {
  gameId: string
  check: VmCheck | null | undefined
  onRechecked: () => void | Promise<void>
  className?: string
}) {
  const { t } = useTranslation('games')
  const [busy, setBusy] = useState(false)
  if (!check) return null

  const recheck = async () => {
    setBusy(true)
    try {
      const res = await kscwApi<{ data: { status: VmCheck['status'] } }>(`/scorer/game/${gameId}/vm-check`, { method: 'POST' })
      if (res.data.status === 'ok' || res.data.status === 'no_list') toast.success(t('vmRechecked'))
      else toast.warning(t('vmRecheckFailed'))
      await onRechecked()
    } catch (err) {
      const code = (err as { code?: string }).code
      toast.error(
        code === 'too_soon' ? t('vmRecheckTooSoon')
          : code === 'vm_window' ? t('vmRecheckWindow')
            : code === 'vm_busy' ? t('vmRecheckBusy')
              : t('vmRecheckFailed'),
      )
    } finally {
      setBusy(false)
    }
  }

  const answeredByRecheck = check.checked_by_name && (check.status === 'ok' || check.status === 'no_list')
  const line = check.list_at
    ? `${t('vmCheckRead', { time: when(check.list_at) })}${answeredByRecheck ? ` · ${t('vmCheckBy', { name: check.checked_by_name })}` : ''}`
    // Not read yet and not overdue (the server flags `not_checked` once it is).
    : check.status == null && check.due_at && !check.issues.some((i) => i.code === 'not_checked')
      ? t('vmCheckDue', { time: when(check.due_at) })
      : null
  const issues = check.issues

  return (
    <div
      className={cn(
        'space-y-2 rounded-xl border p-3',
        issues.length
          ? 'border-amber-300 bg-amber-50 dark:border-amber-700/60 dark:bg-amber-950/30'
          : 'border-hairline bg-surface-sunken',
        className,
      )}
    >
      {line && <p className="text-xs text-muted-foreground">{line}</p>}
      {issues.length > 0 && (
        <ul className="space-y-1 text-xs text-amber-800 dark:text-amber-300">
          {issues.map((i) => (
            <li key={i.code} className="flex gap-1.5">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0">{t(`vmIssue_${i.code}`, { names: (i.names ?? []).join(', '), defaultValue: i.code })}</span>
            </li>
          ))}
        </ul>
      )}
      <Button type="button" variant="outline" size="sm" loading={busy} onClick={() => void recheck()}>
        <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
        {t('vmRecheck')}
      </Button>
    </div>
  )
}
