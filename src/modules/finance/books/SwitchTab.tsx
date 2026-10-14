// The switch checklist: whether the criteria for making Wiedisync the club's book
// of record hold (.planning/bookkeeping-plan.md, Phase 5). It only reports — the
// switch itself is a board decision taken with the Revisoren.
import { useTranslation } from 'react-i18next'
import { CheckCircle2, CircleDashed, Loader2, XCircle } from 'lucide-react'
import { useSwitchReadiness, type ReadinessStatus } from '../../../hooks/useFinanceBooks'
import { formatChf } from '../../../hooks/useFinance'

const ICON: Record<ReadinessStatus, typeof CheckCircle2> = { pass: CheckCircle2, fail: XCircle, pending: CircleDashed }
const TONE: Record<ReadinessStatus, string> = {
  pass: 'text-green-600 dark:text-green-400',
  fail: 'text-red-600 dark:text-red-400',
  pending: 'text-muted-foreground',
}

export default function SwitchTab() {
  const { t } = useTranslation('finance')
  const { data, isLoading } = useSwitchReadiness()
  if (isLoading || !data) return <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground/80" /></div>
  const detail = (key: string, d: Record<string, unknown>) => {
    const n = (k: string) => Number(d[k] ?? 0)
    switch (key) {
      case 'mirror': return t('bkChk_mirror_d', { years: n('years'), total: n('clubdeskYears') }) + (d.syncHealthy ? '' : ` · ${t('bkChk_syncDown')}`)
      case 'opening': return d.fiscalYear ? t('bkChk_opening_d', { year: String(d.fiscalYear) }) : t('bkChk_noStart')
      case 'bank': return t('bkChk_bank_d', { open: n('open'), total: n('total') })
      case 'signoffs': return t('bkChk_signoffs_d', { signed: n('signed'), due: n('due') })
      case 'match': return d.differenceTotal == null ? t('bkChk_noMonths') : t('bkChk_match_d', { amount: formatChf(d.differenceTotal) })
      case 'fullYear': return t('bkChk_fullYear_d', { count: n('closedYearsMatching') })
      case 'receipts': return t('bkChk_receipts_d', { missing: n('missing'), needing: n('needing') })
      case 'archive': return t('bkChk_archive_d', { offsite: n('offsite'), archives: n('archives') })
      case 'auditors': return t('bkChk_people_d', { count: n('revisors') })
      case 'treasurer': return t('bkChk_people_d', { count: n('treasurers') })
      default: return ''
    }
  }
  return (
    <div className="space-y-4">
      <div className={`rounded-2xl border p-4 ${data.ready ? 'border-green-300 bg-green-50 dark:border-green-800 dark:bg-green-900/20' : 'border-hairline bg-card'} shadow-card`}>
        <p className="font-semibold text-foreground">{data.ready ? t('bkReady') : t('bkNotReady')}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t('bkSwitchIntro')}</p>
      </div>
      <ul className="space-y-2">
        {data.checks.map((c) => {
          const Icon = ICON[c.status]
          return (
            <li key={c.key} className="flex items-start gap-3 rounded-2xl border border-hairline bg-card p-3 shadow-card">
              <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${TONE[c.status]}`} aria-hidden />
              <div className="min-w-0">
                <p className="font-medium text-foreground">{t(`bkChk_${c.key}`)}</p>
                <p className="text-sm text-muted-foreground">{detail(c.key, c.detail)}</p>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
