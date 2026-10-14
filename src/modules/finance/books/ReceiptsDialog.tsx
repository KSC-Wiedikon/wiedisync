// Receipts (Belege) of one native journal entry: list, preview, attach, remove.
// Every booking needs one (Art. 957a OR) — bank postings carry their camt.053
// statement automatically; everything else is attached here.
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { Eye, FileUp, Loader2, Trash2 } from 'lucide-react'
import Modal from '../../../components/Modal'
import { Button } from '@/components/ui/button'
import IconButton from '@/components/IconButton'
import { useConfirm } from '../../../components/ConfirmProvider'
import { FilePreviewDialog } from '../../../components/FilePreview'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table'
import { formatDateCompactZurich } from '../../../utils/dateHelpers'
import { useAuth } from '../../../hooks/useAuth'
import {
  useEntryDocuments, uploadEntryDocument, deleteDocument, documentFileUrl, type EntryDocument,
} from '../../../hooks/useFinanceBooks'

const KINDS: EntryDocument['kind'][] = ['receipt', 'invoice', 'contract', 'other']
const selectCls = 'h-11 rounded-lg border border-input bg-card px-3 text-sm sm:h-9 dark:bg-gray-800 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

export default function ReceiptsDialog({ entry, closedYear, onClose }: {
  entry: { id: number; beleg: string | null; text: string | null } | null
  closedYear?: boolean
  onClose: () => void
}) {
  const { t } = useTranslation('finance')
  const { canAccessFinance } = useAuth()
  const confirm = useConfirm()
  const qc = useQueryClient()
  const { data: docs, isLoading } = useEntryDocuments(entry?.id ?? null, !!entry)
  const [kind, setKind] = useState<EntryDocument['kind']>('receipt')
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<EntryDocument | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['finance'] })

  async function upload(file: File | undefined) {
    if (!file || !entry) return
    setBusy(true)
    try {
      await uploadEntryDocument(entry.id, file, kind)
      toast.success(t('bkReceiptAdded'))
      refresh()
    } catch (e) {
      toast.error((e as Error).message || t('ledActionError'))
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function remove(d: EntryDocument) {
    if (!(await confirm({ message: t('bkReceiptDeleteSure'), danger: true }))) return
    try { await deleteDocument(d.id); refresh() } catch (e) { toast.error((e as { body?: { error?: string } })?.body?.error || t('ledActionError')) }
  }

  const kindLabel = (k: EntryDocument['kind']) => t(`bkKind_${k}`)
  return (
    <Modal open={!!entry} onClose={onClose} title={`${t('bkReceipts')} · ${entry?.beleg ?? ''}`} size="lg">
      <div className="space-y-4">
        {entry?.text && <p className="text-sm text-muted-foreground">{entry.text}</p>}
        {isLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : !docs?.length ? (
          <p className="rounded-xl border border-dashed border-border py-6 text-center text-sm text-muted-foreground">{t('bkNoReceipts')}</p>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-hairline bg-card shadow-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('bkReceiptFile')}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t('bkReceiptKind')}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t('ledColDate')}</TableHead>
                  <TableHead className="text-right"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {docs.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="whitespace-normal break-words text-foreground">
                      {d.filename || `#${d.id}`}
                      <span className="block text-[11px] text-muted-foreground sm:hidden">{kindLabel(d.kind)}</span>
                      <span className="block font-mono text-[10px] text-muted-foreground/70" title={d.sha256}>SHA-256 {d.sha256.slice(0, 12)}…</span>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-muted-foreground">{kindLabel(d.kind)}</TableCell>
                    <TableCell className="hidden sm:table-cell whitespace-nowrap text-muted-foreground">{formatDateCompactZurich(d.date_created)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <IconButton size="sm" variant="outline" label={t('bkReceiptView')} onClick={() => setPreview(d)}><Eye /></IconButton>
                        {canAccessFinance && !closedYear && d.kind !== 'statement' && (
                          <IconButton size="sm" variant="outline" label={t('delete')} onClick={() => remove(d)} className="text-muted-foreground hover:text-red-600 dark:hover:text-red-400"><Trash2 /></IconButton>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {canAccessFinance && (
          <div className="flex flex-wrap items-center gap-2">
            <select value={kind} onChange={(e) => setKind(e.target.value as EntryDocument['kind'])} className={selectCls} aria-label={t('bkReceiptKind')}>
              {KINDS.map((k) => <option key={k} value={k}>{kindLabel(k)}</option>)}
            </select>
            <input ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
            <Button type="button" disabled={busy} onClick={() => fileRef.current?.click()} icon={busy ? <Loader2 className="animate-spin" /> : <FileUp />}>
              {t('bkReceiptAdd')}
            </Button>
            <p className="w-full text-xs text-muted-foreground">{t('bkReceiptHint')}</p>
          </div>
        )}
      </div>
      <FilePreviewDialog
        open={!!preview}
        onOpenChange={(o) => { if (!o) setPreview(null) }}
        url={preview ? documentFileUrl(preview.id) : null}
        label={preview?.filename || t('bkReceipts')}
        filename={preview?.filename || 'beleg'}
      />
    </Modal>
  )
}
