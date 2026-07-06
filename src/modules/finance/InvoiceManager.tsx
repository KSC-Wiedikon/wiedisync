import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Search, Check, X, Link2, Loader2, Upload, Coins } from 'lucide-react'
import Modal from '../../components/Modal'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { useCollection } from '../../lib/query'
import { useTeams } from '../../hooks/useTeams'
import { formatDateCompactZurich } from '../../utils/dateHelpers'
import {
  useFinanceInvoices, formatChf, isNativeInvoice,
  createNativeInvoice, confirmInvoice, cancelInvoice, linkInvoiceMember,
  importCamt, useBillingContacts, createBillingContact, type CamtImportResult,
} from '../../hooks/useFinance'
import type { FinanceInvoice } from './types'
import type { Member, Team } from '../../types'
import PaymentLedgerModal from './PaymentLedgerModal'

/** Searchable single-member picker (mirrors MemberMultiSelect's dropdown). */
function MemberPicker({ value, onChange }: { value: Member | null; onChange: (m: Member | null) => void }) {
  const { t } = useTranslation('finance')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const { data: membersRaw } = useCollection<Member>('members', {
    filter: { wiedisync_active: { _eq: true } },
    fields: ['id', 'first_name', 'last_name', 'email'],
    sort: ['last_name', 'first_name'],
    limit: -1,
  })
  const members = membersRaw ?? []
  const filtered = useMemo(() => {
    if (!search) return members
    const q = search.toLowerCase()
    return members.filter((m) => `${m.first_name} ${m.last_name}`.toLowerCase().includes(q) || m.email?.toLowerCase().includes(q))
  }, [members, search])

  if (value) {
    return (
      <div className="flex items-center justify-between rounded-md border border-gray-200 px-3 py-2 dark:border-gray-600">
        <span className="text-sm dark:text-gray-100">{value.first_name} {value.last_name}</span>
        <button type="button" onClick={() => onChange(null)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
      </div>
    )
  }
  return (
    <div className="relative">
      <div className="flex items-center gap-2 rounded-md border border-gray-200 bg-transparent px-3 py-2 dark:border-gray-600">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          type="text" value={search} onChange={(e) => { setSearch(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)}
          placeholder={t('selectMember')} className="flex-1 bg-transparent text-sm outline-none dark:text-gray-100"
        />
      </div>
      {open && filtered.length > 0 && (
        <div className="absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-800">
          {filtered.slice(0, 50).map((m) => (
            <button key={m.id} type="button" onClick={() => { onChange(m); setOpen(false); setSearch('') }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700">
              <span className="dark:text-gray-100">{m.first_name} {m.last_name}</span>
              <span className="ml-auto text-xs text-muted-foreground">{m.email}</span>
            </button>
          ))}
        </div>
      )}
      {open && <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />}
    </div>
  )
}

const labelCls = 'block text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400'
const inputCls = 'mt-1 w-full rounded-md border border-gray-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'

function CreateInvoiceModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation('finance')
  const { data: teamsRaw } = useTeams('all')
  const teams = (teamsRaw ?? []) as Team[]
  const [recipientType, setRecipientType] = useState<'member' | 'team' | 'contact'>('member')
  const [member, setMember] = useState<Member | null>(null)
  const [teamId, setTeamId] = useState('')
  const [contactId, setContactId] = useState('')
  const [newContact, setNewContact] = useState(false)
  const [cName, setCName] = useState(''); const [cEmail, setCEmail] = useState(''); const [cKind, setCKind] = useState('sponsor')
  const [amount, setAmount] = useState('')
  const [subject, setSubject] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [category, setCategory] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { data: contacts } = useBillingContacts(open)

  function reset() {
    setRecipientType('member'); setMember(null); setTeamId(''); setContactId(''); setNewContact(false)
    setCName(''); setCEmail(''); setCKind('sponsor'); setAmount(''); setSubject(''); setDueDate(''); setCategory(''); setError('')
  }
  const amt = Number(amount.replace(',', '.'))
  const recipientValid = recipientType === 'member' ? !!member
    : recipientType === 'team' ? !!teamId
    : (newContact ? !!cName.trim() : !!contactId)
  const valid = amt > 0 && !!subject.trim() && recipientValid

  async function submit() {
    if (!valid) return
    setBusy(true); setError('')
    try {
      let contactRef = recipientType === 'contact' ? Number(contactId) : undefined
      if (recipientType === 'contact' && newContact) {
        const r = await createBillingContact({ kind: cKind, name: cName.trim(), email: cEmail.trim() || null })
        contactRef = r.contact.id
      }
      await createNativeInvoice({
        recipient_type: recipientType,
        member: recipientType === 'member' ? Number(member!.id) : undefined,
        team: recipientType === 'team' ? Number(teamId) : undefined,
        contact: recipientType === 'contact' ? contactRef : undefined,
        amount: amt,
        subject: subject.trim(),
        due_date: dueDate || null,
        fee_category: category.trim() || null,
      })
      reset(); onDone(); onClose()
    } catch {
      setError(t('createInvoiceError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t('createInvoiceTitle')}>
      <div className="space-y-4">
        <div>
          <span id="inv-recipient-type-label" className={labelCls}>{t('recipientType')}</span>
          <div role="group" aria-labelledby="inv-recipient-type-label" className="mt-1 flex gap-2">
            {(['member', 'team', 'contact'] as const).map((rt) => (
              <button key={rt} type="button" onClick={() => setRecipientType(rt)}
                className={`flex-1 rounded-md border px-3 py-2 text-sm ${recipientType === rt ? 'border-brand-500 bg-brand-50 font-medium text-brand-700 dark:bg-brand-900/30 dark:text-brand-300' : 'border-gray-200 text-gray-600 dark:border-gray-600 dark:text-gray-300'}`}>
                {rt === 'member' ? t('recipientMember') : rt === 'team' ? t('recipientTeam') : t('recipientContact')}
              </button>
            ))}
          </div>
        </div>

        {recipientType === 'member' && (
          <div><span className={labelCls}>{t('recipientMember')}</span><div className="mt-1"><MemberPicker value={member} onChange={setMember} /></div></div>
        )}
        {recipientType === 'team' && (
          <div>
            <label htmlFor="inv-team" className={labelCls}>{t('recipientTeam')}</label>
            <select id="inv-team" value={teamId} onChange={(e) => setTeamId(e.target.value)} className={`${inputCls} dark:bg-gray-800`}>
              <option value="">{t('selectTeam')}</option>
              {teams.map((tm) => <option key={tm.id} value={tm.id}>{tm.name}</option>)}
            </select>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t('teamInvoiceHint')}</p>
          </div>
        )}
        {recipientType === 'contact' && (
          <div className="space-y-2">
            <label htmlFor="inv-contact" className={labelCls}>{t('recipientContact')}</label>
            {!newContact ? (
              <>
                <select id="inv-contact" value={contactId} onChange={(e) => setContactId(e.target.value)} className={`${inputCls} dark:bg-gray-800`}>
                  <option value="">{t('selectContact')}</option>
                  {(contacts ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}{c.email ? ` · ${c.email}` : ''}</option>)}
                </select>
                <button type="button" onClick={() => setNewContact(true)} className="text-xs text-brand-600 hover:underline dark:text-brand-400">{t('contactNew')}</button>
              </>
            ) : (
              <div className="space-y-2 rounded-md border border-gray-200 p-2 dark:border-gray-700">
                <input value={cName} onChange={(e) => setCName(e.target.value)} placeholder={t('contactName')} aria-label={t('contactName')} className={inputCls} />
                <input value={cEmail} onChange={(e) => setCEmail(e.target.value)} type="email" placeholder={t('contactEmail')} aria-label={t('contactEmail')} className={inputCls} />
                <select value={cKind} onChange={(e) => setCKind(e.target.value)} className={`${inputCls} dark:bg-gray-800`}>
                  {['sponsor', 'parent', 'company', 'ex_member', 'other'].map((k) => <option key={k} value={k}>{t(`contactKind_${k}`)}</option>)}
                </select>
                <button type="button" onClick={() => setNewContact(false)} className="text-xs text-gray-500 hover:underline dark:text-gray-400">{t('contactPickExisting')}</button>
              </div>
            )}
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t('contactInvoiceHint')}</p>
          </div>
        )}

        <div>
          <label htmlFor="inv-subject" className={labelCls}>{t('invoiceSubject')}</label>
          <input id="inv-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={t('invoiceSubjectPlaceholder')} className={inputCls} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="inv-amount" className={labelCls}>{t('invoiceAmount')}</label>
            <input id="inv-amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" className={inputCls} />
          </div>
          <div>
            <label htmlFor="inv-duedate" className={labelCls}>{t('invoiceDueDate')}</label>
            <input id="inv-duedate" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={`${inputCls} dark:bg-gray-800`} />
          </div>
        </div>
        <div>
          <label htmlFor="inv-category" className={labelCls}>{t('invoiceCategory')}</label>
          <input id="inv-category" value={category} onChange={(e) => setCategory(e.target.value)} placeholder={t('invoiceCategoryPlaceholder')} className={inputCls} />
        </div>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-md px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700">{t('cancel')}</button>
          <button type="button" disabled={!valid || busy} onClick={submit}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}{t('createInvoiceCta')}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function LinkMemberModal({ invoice, onClose, onDone }: { invoice: FinanceInvoice | null; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation('finance')
  const [member, setMember] = useState<Member | null>(null)
  const [scope, setScope] = useState<'email' | 'invoice'>('email')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const hasEmail = !!(invoice?.recipient_email || '').trim()

  async function submit() {
    if (!invoice || !member) return
    setBusy(true); setError('')
    try {
      await linkInvoiceMember(invoice.id, Number(member.id), hasEmail ? scope : 'invoice')
      setMember(null); onDone(); onClose()
    } catch (err) {
      setError((err as { body?: { error?: string } })?.body?.error || t('ledActionError'))
    } finally { setBusy(false) }
  }

  return (
    <Modal open={!!invoice} onClose={onClose} title={t('linkMemberTitle')}>
      {invoice && (
        <div className="space-y-4">
          <div className="rounded-md bg-gray-50 p-3 text-sm dark:bg-gray-800">
            <div className="font-medium text-gray-900 dark:text-gray-100">{invoice.recipient_name || '–'}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">{invoice.recipient_email || t('noEmail')} · {invoice.subject} · {formatChf(invoice.amount)}</div>
          </div>
          <div><span className={labelCls}>{t('linkMemberPick')}</span><div className="mt-1"><MemberPicker value={member} onChange={setMember} /></div></div>
          {hasEmail && (
            <div className="space-y-1.5">
              {(['email', 'invoice'] as const).map((s) => (
                <label key={s} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <input type="radio" checked={scope === s} onChange={() => setScope(s)} />
                  {s === 'email' ? t('linkScopeEmail') : t('linkScopeInvoice')}
                </label>
              ))}
            </div>
          )}
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="rounded-md px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700">{t('cancel')}</button>
            <button type="button" disabled={!member || busy} onClick={submit}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}{t('linkCta')}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}

const STATUS_TONE: Record<string, string> = {
  auto_confirmed: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  clubdesk_match: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
  clubdesk_guess: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  unmatched: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
  native_partial: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  native_already_settled: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  skipped: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
}

/** Bank reconciliation — upload a camt.053/.054 export → native invoices auto-confirm, ClubDesk credits are cross-checked. */
function CamtReconcile({ onImported }: { onImported: () => void }) {
  const { t } = useTranslation('finance')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<CamtImportResult | null>(null)

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file
    if (!file) return
    setBusy(true); setError(''); setResult(null)
    try {
      const xml = await file.text()
      const r = await importCamt(xml)
      setResult(r)
      onImported()
    } catch (err) {
      const body = (err as { body?: { error?: string } })?.body
      setError(body?.error || t('camtError'))
    } finally { setBusy(false) }
  }

  const statusLabel = (s: string) => {
    const map: Record<string, string> = {
      auto_confirmed: t('sAutoConfirmed'), clubdesk_match: t('sClubdeskMatch'), clubdesk_guess: t('sClubdeskGuess'), unmatched: t('sUnmatched'),
      native_partial: t('sPartial'), native_already_settled: t('sAlreadySettled'), skipped: t('sSkipped'),
    }
    return map[s] ?? s
  }

  return (
    <section>
      <h2 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">{t('reconcileTitle')}</h2>
      <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">{t('reconcileHint')}</p>
      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        {busy ? t('camtImporting') : t('camtChoose')}
        <input type="file" accept=".xml,text/xml,application/xml" className="hidden" onChange={onFile} disabled={busy} />
      </label>
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {result && (
        <div className="mt-3">
          <p className="mb-2 text-sm text-gray-700 dark:text-gray-300">
            {t('camtSummary', { auto: result.summary.auto_confirmed, guess: result.summary.clubdesk_guesses, unmatched: result.summary.unmatched, dup: result.summary.duplicates })}
          </p>
          {result.details.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
              <Table>
                <TableHeader>
                  <TableRow className="border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40">
                    <TableHead className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('colStatus')}</TableHead>
                    <TableHead className="text-right text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('colAmount')}</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('colPayer')}</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('colDetail')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.details.map((d, i) => (
                    <TableRow key={i} className="border-gray-200 dark:border-gray-700">
                      <TableCell><span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[d.status] ?? STATUS_TONE.unmatched}`}>{statusLabel(d.status)}</span></TableCell>
                      <TableCell className="text-right tabular-nums text-gray-900 dark:text-gray-100">{d.amount != null ? formatChf(d.amount) : '–'}</TableCell>
                      <TableCell className="whitespace-normal break-words text-gray-600 dark:text-gray-400">{d.debtor || '–'}</TableCell>
                      <TableCell className="whitespace-normal break-words text-gray-600 dark:text-gray-400">
                        {d.invoice ? `${d.invoice}${d.recipient ? ` · ${d.recipient}` : ''}${d.invoiceStatus ? ` (${d.invoiceStatus})` : ''}` : (d.reference || d.reason || '–')}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

const ORPHAN_CAP = 100

export default function InvoiceManager() {
  const { t } = useTranslation('finance')
  const { data: invoicesRaw, refetch } = useFinanceInvoices()
  const invoices = invoicesRaw ?? []
  const { data: allTeamsRaw } = useTeams('all')
  const teamNameById = useMemo(
    () => new Map(((allTeamsRaw ?? []) as Team[]).map((tm) => [String(tm.id), tm.name])),
    [allTeamsRaw],
  )
  const [showCreate, setShowCreate] = useState(false)
  const [linkTarget, setLinkTarget] = useState<FinanceInvoice | null>(null)
  const [paymentTarget, setPaymentTarget] = useState<FinanceInvoice | null>(null)
  const [orphanSearch, setOrphanSearch] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const native = useMemo(() => invoices.filter(isNativeInvoice), [invoices])
  const orphansAll = useMemo(
    () => invoices.filter((i) => i.source !== 'native' && !i.member),
    [invoices],
  )
  const orphans = useMemo(() => {
    if (!orphanSearch) return orphansAll
    const q = orphanSearch.toLowerCase()
    return orphansAll.filter((i) =>
      (i.recipient_name || '').toLowerCase().includes(q) ||
      (i.recipient_email || '').toLowerCase().includes(q) ||
      (i.subject || '').toLowerCase().includes(q))
  }, [orphansAll, orphanSearch])

  async function act(id: string, fn: (id: string) => Promise<unknown>) {
    setBusyId(id)
    try { await fn(id); await refetch() } finally { setBusyId(null) }
  }

  const statusLabel = (s: string | null) => {
    const map: Record<string, string> = {
      open: t('statusOpen'), pending_confirmation: t('statusPendingConfirmation'), partial: t('statusPartial'), paid: t('statusPaid'), cancelled: t('statusCancelled'),
    }
    return map[s ?? ''] ?? s ?? '–'
  }

  return (
    <div className="space-y-8">
      {/* ── Native invoices ───────────────────────────────────── */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t('nativeInvoices')}</h2>
          <button type="button" onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">
            <Plus className="h-4 w-4" />{t('newInvoice')}
          </button>
        </div>
        {native.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 py-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">{t('noNativeInvoices')}</p>
        ) : (
          <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
            <Table>
              <TableHeader>
                <TableRow className="border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40">
                  <TableHead className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('colNumber')}</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('colRecipient')}</TableHead>
                  <TableHead className="hidden sm:table-cell text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('colSubject')}</TableHead>
                  <TableHead className="text-right text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('colAmount')}</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('colStatus')}</TableHead>
                  <TableHead className="text-right text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {native.map((inv) => (
                  <TableRow key={inv.id} className="border-gray-200 dark:border-gray-700">
                    <TableCell className="whitespace-nowrap text-xs text-gray-500 dark:text-gray-400">{inv.number}</TableCell>
                    <TableCell className="whitespace-normal break-words text-gray-900 dark:text-gray-100">
                      {inv.team ? t('billedToTeam', { team: teamNameById.get(String(inv.team)) ?? `#${inv.team}` }) : inv.recipient_name || '–'}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell whitespace-normal break-words text-gray-600 dark:text-gray-400">{inv.subject}</TableCell>
                    <TableCell className="text-right tabular-nums text-gray-900 dark:text-gray-100">{formatChf(inv.amount)}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-gray-600 dark:text-gray-300">{statusLabel(inv.status)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1.5">
                        {['pending_confirmation', 'open', 'partial'].includes(inv.status ?? '') && (
                          <button type="button" disabled={busyId === inv.id} onClick={() => act(inv.id, confirmInvoice)}
                            className="inline-flex items-center gap-1 rounded-md bg-green-600 px-2 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50">
                            <Check className="h-3.5 w-3.5" />{t('confirmPaymentCta')}
                          </button>
                        )}
                        {inv.status !== 'cancelled' && (
                          <button type="button" onClick={() => setPaymentTarget(inv)}
                            className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700">
                            <Coins className="h-3.5 w-3.5" />{t('payButton')}
                          </button>
                        )}
                        {inv.status !== 'paid' && inv.status !== 'cancelled' && (
                          <button type="button" disabled={busyId === inv.id} onClick={() => { if (window.confirm(t('cancelInvoiceSure'))) act(inv.id, cancelInvoice) }}
                            className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700">
                            {t('cancelInvoiceCta')}
                          </button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* ── Bank reconciliation (camt.053/.054) ──────────────────── */}
      <CamtReconcile onImported={() => refetch()} />

      {/* ── Unmatched ClubDesk invoices ──────────────────────────── */}
      <section>
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t('orphanedInvoices')}</h2>
          <span className="text-xs text-gray-400">{orphans.length}{orphans.length !== orphansAll.length ? `/${orphansAll.length}` : ''}</span>
        </div>
        <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">{t('orphanedHint')}</p>
        {orphansAll.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 py-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">{t('noOrphans')}</p>
        ) : (
          <>
            <div className="mb-2 flex items-center gap-2 rounded-md border border-gray-200 bg-transparent px-3 py-2 dark:border-gray-600">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input value={orphanSearch} onChange={(e) => setOrphanSearch(e.target.value)} placeholder={t('orphanSearchPlaceholder')}
                className="flex-1 bg-transparent text-sm outline-none dark:text-gray-100" />
            </div>
            <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
              <Table>
                <TableHeader>
                  <TableRow className="border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40">
                    <TableHead className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('colRecipient')}</TableHead>
                    <TableHead className="hidden sm:table-cell text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('colSubject')}</TableHead>
                    <TableHead className="hidden sm:table-cell text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('colDate')}</TableHead>
                    <TableHead className="text-right text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('colAmount')}</TableHead>
                    <TableHead className="text-right text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orphans.slice(0, ORPHAN_CAP).map((inv) => (
                    <TableRow key={inv.id} className="border-gray-200 dark:border-gray-700">
                      <TableCell className="whitespace-normal break-words text-gray-900 dark:text-gray-100">
                        {inv.recipient_name || '–'}
                        <span className="mt-0.5 block text-xs text-gray-400">{inv.recipient_email}</span>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell whitespace-normal break-words text-gray-600 dark:text-gray-400">{inv.subject}</TableCell>
                      <TableCell className="hidden sm:table-cell whitespace-nowrap text-gray-600 dark:text-gray-400">{inv.invoice_date ? formatDateCompactZurich(inv.invoice_date) : '–'}</TableCell>
                      <TableCell className="text-right tabular-nums text-gray-900 dark:text-gray-100">{formatChf(inv.amount)}</TableCell>
                      <TableCell className="text-right">
                        <button type="button" onClick={() => setLinkTarget(inv)}
                          className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700">
                          <Link2 className="h-3.5 w-3.5" />{t('linkToMember')}
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {orphans.length > ORPHAN_CAP && (
              <p className="mt-2 text-center text-xs text-gray-400">{t('orphanShowingCap', { shown: ORPHAN_CAP, total: orphans.length })}</p>
            )}
          </>
        )}
      </section>

      <CreateInvoiceModal open={showCreate} onClose={() => setShowCreate(false)} onDone={() => refetch()} />
      <LinkMemberModal invoice={linkTarget} onClose={() => setLinkTarget(null)} onDone={() => refetch()} />
      <PaymentLedgerModal invoice={paymentTarget} onClose={() => setPaymentTarget(null)} onChanged={() => refetch()} />
    </div>
  )
}
