// Bank tab of the parallel books: import a camt.053 statement, book each line
// (Bank against the proposed or chosen account), ignore what does not belong in
// the books, and keep the rules that propose accounts.
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { Check, EyeOff, FileUp, Loader2, Plus, Undo2, Pencil, Trash2, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import IconButton from '@/components/IconButton'
import Modal from '../../../components/Modal'
import TabBar from '../../../components/TabBar'
import { useConfirm, usePrompt } from '../../../components/ConfirmProvider'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table'
import { formatDateCompactZurich } from '../../../utils/dateHelpers'
import { useAuth } from '../../../hooks/useAuth'
import { useLedgerAccounts, formatChf, toNum, type LedgerAccount } from '../../../hooks/useFinance'
import {
  useBankLines, importStatement, postBankLine, postProposedLines, ignoreBankLine, reopenBankLine,
  useBankRules, createBankRule, updateBankRule, deleteBankRule,
  type BankLine, type BankLineStatus, type BankRule,
} from '../../../hooks/useFinanceBooks'

const apiErr = (e: unknown, fb: string) => (e as { body?: { error?: string } })?.body?.error || fb
const selectCls = 'h-11 w-full min-w-[11rem] rounded-lg border border-input bg-card px-2 text-sm sm:h-9 dark:bg-gray-800 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
const inputCls = 'mt-1 h-11 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm sm:h-9 dark:bg-gray-800 text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
const labelCls = 'block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground'

function AccountSelect({ accounts, value, onChange, ariaLabel }: { accounts: LedgerAccount[]; value: number | ''; onChange: (v: number | '') => void; ariaLabel: string }) {
  const { t } = useTranslation('finance')
  const groups = useMemo(() => {
    const order = ['asset', 'liability', 'equity', 'income', 'expense', 'close']
    return order.map((type) => ({ type, list: accounts.filter((a) => a.type === type) })).filter((g) => g.list.length)
  }, [accounts])
  return (
    <select value={value} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : '')} className={selectCls} aria-label={ariaLabel}>
      <option value="">{t('bkChooseAccount')}</option>
      {groups.map((g) => (
        <optgroup key={g.type} label={t(`acctType_${g.type}`)}>
          {g.list.map((a) => <option key={a.id} value={a.id}>{a.number} {a.name}</option>)}
        </optgroup>
      ))}
    </select>
  )
}

export default function BankTab({ fiscalYearId }: { fiscalYearId?: string | number | null }) {
  const { t } = useTranslation('finance')
  const { canAccessFinance: canWrite } = useAuth()
  const qc = useQueryClient()
  const prompt = usePrompt()
  const [status, setStatus] = useState<BankLineStatus | 'all'>('open')
  const { data, isLoading } = useBankLines(status, fiscalYearId)
  const { data: accountsRaw } = useLedgerAccounts()
  const accounts = useMemo(() => accountsRaw ?? [], [accountsRaw])
  const [choice, setChoice] = useState<Record<number, number | ''>>({})
  const [busy, setBusy] = useState<number | 'import' | 'all' | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['finance'] })
  const lines = data?.lines ?? []
  const summary = data?.summary ?? {}
  const proposedOpen = lines.filter((l) => l.status === 'open' && l.proposed_account).length

  async function onFile(file: File | undefined) {
    if (!file) return
    setBusy('import')
    try {
      const r = await importStatement(await file.text())
      const unbalanced = r.statements.filter((s) => s.balance.ok === false)
      toast.success(t('bkImported', { inserted: r.inserted, skipped: r.skipped, proposed: r.proposed }))
      if (unbalanced.length) toast.error(t('bkStatementUnbalanced'))
      setStatus('open')
      refresh()
    } catch (e) {
      toast.error(apiErr(e, t('bkImportError')))
    } finally {
      setBusy(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function book(l: BankLine) {
    const account = choice[l.id] ?? l.proposed_account ?? ''
    if (!account) { toast.error(t('bkChooseAccount')); return }
    setBusy(l.id)
    try { await postBankLine(l.id, { account: Number(account) }); refresh() } catch (e) { toast.error(apiErr(e, t('ledActionError'))) } finally { setBusy(null) }
  }
  async function bookAll() {
    setBusy('all')
    try {
      const r = await postProposedLines()
      toast.success(t('bkPostedAll', { count: r.posted }))
      if (r.failed.length) toast.error(t('bkPostFailed', { count: r.failed.length, error: r.failed[0].error }))
      refresh()
    } catch (e) { toast.error(apiErr(e, t('ledActionError'))) } finally { setBusy(null) }
  }
  async function ignore(l: BankLine) {
    const note = await prompt({ message: t('bkIgnoreWhy'), defaultValue: '' })
    if (note == null) return
    setBusy(l.id)
    try { await ignoreBankLine(l.id, note); refresh() } catch (e) { toast.error(apiErr(e, t('ledActionError'))) } finally { setBusy(null) }
  }
  async function reopen(l: BankLine) {
    setBusy(l.id)
    try { await reopenBankLine(l.id); refresh() } catch (e) { toast.error(apiErr(e, t('ledActionError'))) } finally { setBusy(null) }
  }

  const proposalChip = (l: BankLine) => {
    if (!l.proposed_by) return null
    const isInvoice = l.proposed_by.startsWith('invoice:')
    return (
      <span className={`ml-1 rounded px-1 text-[10px] ${isInvoice ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'bg-muted text-muted-foreground'}`}>
        {isInvoice ? t('bkByInvoice', { number: l.matched_invoice_number }) : t('bkByRule')}
      </span>
    )
  }

  /** The booking for a line: the account picker (open), the entry (posted) or the
   *  ignore note. Its own column on wider screens, under the payment on phones. */
  const bookingCell = (l: BankLine) => (
    l.status === 'open' ? (
      canWrite ? (
        <div className="space-y-1">
          <AccountSelect accounts={accounts} value={choice[l.id] ?? l.proposed_account ?? ''} onChange={(v) => setChoice((c) => ({ ...c, [l.id]: v }))} ariaLabel={t('bkColBooking')} />
          {proposalChip(l)}
        </div>
      ) : (
        <span className="text-xs text-muted-foreground">{l.proposed_account_number ? `${l.proposed_account_number} ${l.proposed_account_name}` : t('bkNoProposal')}{proposalChip(l)}</span>
      )
    ) : l.status === 'posted' ? (
      <span className="text-xs text-muted-foreground"><span className="text-foreground">{l.entry_voucher_no}</span> · {l.entry_debit} → {l.entry_credit}</span>
    ) : (
      <span className="text-xs italic text-muted-foreground">{t('bkIgnored')}{l.note ? `: ${l.note}` : ''}</span>
    )
  )

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">{t('bkBankIntro')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <TabBar<BankLineStatus | 'all'>
          tabs={[
            { key: 'open', label: `${t('bkStatusOpen')} (${summary.open ?? 0})` },
            { key: 'posted', label: `${t('bkStatusPosted')} (${summary.posted ?? 0})` },
            { key: 'ignored', label: `${t('bkStatusIgnored')} (${summary.ignored ?? 0})` },
            { key: 'all', label: t('bkStatusAll') },
          ]}
          active={status}
          onChange={setStatus}
        />
        {canWrite && (
          <div className="ml-auto flex flex-wrap gap-2">
            <input ref={fileRef} type="file" accept=".xml,application/xml,text/xml" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
            <Button type="button" variant="outline" disabled={busy === 'import'} onClick={() => fileRef.current?.click()} icon={busy === 'import' ? <Loader2 className="animate-spin" /> : <FileUp />}>
              {t('bkImport')}
            </Button>
            {status === 'open' && proposedOpen > 0 && (
              <Button type="button" disabled={busy === 'all'} onClick={bookAll} icon={busy === 'all' ? <Loader2 className="animate-spin" /> : <Check />}>
                {t('bkPostAllProposed', { count: proposedOpen })}
              </Button>
            )}
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground/80" /></div>
      ) : lines.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">{status === 'open' ? t('bkNoOpenLines') : t('bkNoLines')}</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-hairline bg-card shadow-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="hidden sm:table-cell">{t('ledColDate')}</TableHead>
                <TableHead>{t('bkColCounterparty')}</TableHead>
                <TableHead className="hidden sm:table-cell text-right">{t('colAmount')}</TableHead>
                <TableHead className="hidden sm:table-cell">{t('bkColBooking')}</TableHead>
                <TableHead className="text-right"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l) => {
                const amt = toNum(l.amount)
                return (
                  <TableRow key={l.id} className="align-top">
                    <TableCell className="hidden sm:table-cell whitespace-nowrap text-muted-foreground">{formatDateCompactZurich(l.booking_date)}</TableCell>
                    <TableCell className="whitespace-normal break-words sm:min-w-[12rem]">
                      {/* Phones: date and amount first, then the booking below — the other columns are hidden. */}
                      <span className="mb-0.5 flex justify-between gap-2 text-xs sm:hidden">
                        <span className="text-muted-foreground">{formatDateCompactZurich(l.booking_date)}</span>
                        <span className={`whitespace-nowrap font-medium tabular-nums ${amt >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{amt >= 0 ? '+' : '−'}{formatChf(Math.abs(amt))}</span>
                      </span>
                      <span className="font-medium text-foreground">{l.counterparty_name || '–'}</span>
                      {l.remittance && <span className="block text-xs text-muted-foreground">{l.remittance}</span>}
                      {l.reference && <span className="block break-all font-mono text-[10px] text-muted-foreground/70">{l.reference}</span>}
                      <div className="mt-2 sm:hidden">{bookingCell(l)}</div>
                    </TableCell>
                    <TableCell className={`hidden sm:table-cell whitespace-nowrap text-right tabular-nums ${amt >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                      {amt >= 0 ? '+' : '−'}{formatChf(Math.abs(amt))}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell min-w-[12rem] whitespace-normal">
                      {bookingCell(l)}
                    </TableCell>
                    <TableCell className="text-right">
                      {canWrite && (
                        <div className="flex flex-col items-end gap-1 sm:flex-row sm:justify-end">
                          {l.status === 'open' ? (
                            <>
                              <IconButton size="sm" label={t('bkPost')} disabled={busy === l.id} onClick={() => book(l)}>{busy === l.id ? <Loader2 className="animate-spin" /> : <Check />}</IconButton>
                              <IconButton size="sm" variant="outline" label={t('bkIgnore')} disabled={busy === l.id} onClick={() => ignore(l)} className="text-muted-foreground"><EyeOff /></IconButton>
                            </>
                          ) : (
                            <IconButton size="sm" variant="outline" label={t('bkReopen')} disabled={busy === l.id} onClick={() => reopen(l)} className="text-muted-foreground"><Undo2 /></IconButton>
                          )}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <RulesPanel accounts={accounts} canWrite={canWrite} />
    </div>
  )
}

/* ── Rules ─────────────────────────────────────────────────────────────── */
function RulesPanel({ accounts, canWrite }: { accounts: LedgerAccount[]; canWrite: boolean }) {
  const { t } = useTranslation('finance')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { data: rules } = useBankRules()
  const [editing, setEditing] = useState<Partial<BankRule> | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['finance'] })
  async function remove(r: BankRule) {
    if (!(await confirm({ message: t('bkRuleDeleteSure', { name: r.name }), danger: true }))) return
    try { await deleteBankRule(r.id); refresh() } catch (e) { toast.error(apiErr(e, t('ledActionError'))) }
  }
  const dirLabel = (d: string) => t(`bkDir_${d}`)
  return (
    <section className="space-y-2 rounded-2xl border border-hairline bg-card p-4 shadow-card">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-foreground"><Wand2 className="mr-1 inline h-4 w-4" />{t('bkRules')}</h3>
        {canWrite && <Button type="button" size="sm" variant="outline" className="ml-auto" icon={<Plus />} onClick={() => setEditing({ direction: 'any', priority: 100, active: true })}>{t('bkRuleAdd')}</Button>}
      </div>
      <p className="text-xs text-muted-foreground">{t('bkRulesIntro')}</p>
      {!!rules?.length && (
        <div className="overflow-x-auto rounded-xl border border-hairline">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('bkRuleName')}</TableHead>
                <TableHead className="hidden sm:table-cell">{t('bkRuleWhen')}</TableHead>
                <TableHead>{t('bkColBooking')}</TableHead>
                <TableHead className="text-right"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.map((r) => (
                <TableRow key={r.id} className={r.active ? '' : 'opacity-50'}>
                  <TableCell className="whitespace-normal break-words text-foreground">{r.name}
                    <span className="block text-[11px] text-muted-foreground sm:hidden">{[r.match_name, r.match_text, r.match_iban].filter(Boolean).join(' · ')}</span></TableCell>
                  <TableCell className="hidden whitespace-normal break-words text-xs text-muted-foreground sm:table-cell">
                    {dirLabel(r.direction)}{r.match_name ? ` · ${t('bkRuleNameHas')} „${r.match_name}“` : ''}{r.match_text ? ` · ${t('bkRuleTextHas')} „${r.match_text}“` : ''}{r.match_iban ? ` · IBAN ${r.match_iban}` : ''}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{r.account_number} {r.account_name}</TableCell>
                  <TableCell className="text-right">
                    {canWrite && (
                      <div className="flex justify-end gap-1">
                        <IconButton size="sm" variant="outline" label={t('edit')} onClick={() => setEditing(r)} className="text-muted-foreground"><Pencil /></IconButton>
                        <IconButton size="sm" variant="outline" label={t('delete')} onClick={() => remove(r)} className="text-muted-foreground hover:text-red-600 dark:hover:text-red-400"><Trash2 /></IconButton>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {editing && <RuleModal rule={editing} accounts={accounts} onClose={() => setEditing(null)} onDone={() => { setEditing(null); refresh() }} />}
    </section>
  )
}

function RuleModal({ rule, accounts, onClose, onDone }: { rule: Partial<BankRule>; accounts: LedgerAccount[]; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation('finance')
  const [r, setR] = useState<Partial<BankRule>>(rule)
  const [saving, setSaving] = useState(false)
  const set = (k: keyof BankRule, v: unknown) => setR((x) => ({ ...x, [k]: v }))
  async function save() {
    setSaving(true)
    try {
      if (r.id) await updateBankRule(r.id, r); else await createBankRule(r)
      onDone()
    } catch (e) { toast.error(apiErr(e, t('ledActionError'))) } finally { setSaving(false) }
  }
  return (
    <Modal open onClose={onClose} title={r.id ? t('bkRuleEdit') : t('bkRuleAdd')}>
      <div className="space-y-3">
        <label className={labelCls}>{t('bkRuleName')}<input className={inputCls} value={r.name ?? ''} onChange={(e) => set('name', e.target.value)} /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={labelCls}>{t('bkRuleDirection')}
            <select className={`${inputCls} dark:bg-gray-800`} value={r.direction ?? 'any'} onChange={(e) => set('direction', e.target.value)}>
              {(['any', 'in', 'out'] as const).map((d) => <option key={d} value={d}>{t(`bkDir_${d}`)}</option>)}
            </select>
          </label>
          <label className={labelCls}>{t('bkRulePriority')}<input className={inputCls} type="number" value={r.priority ?? 100} onChange={(e) => set('priority', Number(e.target.value))} /></label>
        </div>
        <label className={labelCls}>{t('bkRuleNameHas')}<input className={inputCls} value={r.match_name ?? ''} onChange={(e) => set('match_name', e.target.value)} placeholder="Stadt Zürich" /></label>
        <label className={labelCls}>{t('bkRuleTextHas')}<input className={inputCls} value={r.match_text ?? ''} onChange={(e) => set('match_text', e.target.value)} placeholder="J+S" /></label>
        <label className={labelCls}>IBAN<input className={inputCls} value={r.match_iban ?? ''} onChange={(e) => set('match_iban', e.target.value)} /></label>
        <div className={labelCls}>{t('bkColBooking')}<div className="mt-1"><AccountSelect accounts={accounts} value={r.account ?? ''} onChange={(v) => set('account', v || undefined)} ariaLabel={t('bkColBooking')} /></div></div>
        <label className={labelCls}>{t('bkRuleTemplate')}<input className={inputCls} value={r.text_template ?? ''} onChange={(e) => set('text_template', e.target.value)} placeholder="{name}: {text}" /></label>
        <label className="flex items-center gap-2 text-sm text-foreground"><input type="checkbox" checked={r.active !== false} onChange={(e) => set('active', e.target.checked)} />{t('bkRuleActive')}</label>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>{t('cancel')}</Button>
          <Button type="button" disabled={saving} onClick={save}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{t('save')}</Button>
        </div>
      </div>
    </Modal>
  )
}
