// src/modules/auth/MyRegistrationDocs.tsx
//
// Member self-view of the documents they uploaded during registration (ID
// front/back, basketball licence docs, …). After approval the registration row
// is retained and linked to the member, so we can surface those files back to
// their owner — read-only, strictly scoped server-side to the caller's own
// registration (GET /kscw/registration/my-docs). Renders nothing when the
// member has no retained documents, so it stays invisible for the majority.

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { FileText, Loader2 } from 'lucide-react'
import { API_URL, kscwApi } from '../../lib/api'

interface MyDoc {
  field: string
  filename: string
  type: string | null
  size: number | null
}

// Registration document field → existing admin i18n label (reused, no new keys).
const DOC_LABEL_KEY: Record<string, string> = {
  id_upload_front: 'anmeldungenDocIdFront',
  id_upload_back: 'anmeldungenDocIdBack',
  bb_doc_lizenz: 'anmeldungenDocLizenz',
  bb_doc_freibrief: 'anmeldungenDocFreibrief',
  bb_doc_selfdecl: 'anmeldungenDocSelfDecl',
  bb_doc_natdecl: 'anmeldungenDocNatDecl',
  bb_doc_u18parents: 'anmeldungenDocU18Parents',
  bb_doc_schoolcert: 'anmeldungenDocSchoolCert',
}

export default function MyRegistrationDocs() {
  const { t } = useTranslation(['auth', 'admin'])
  const [docs, setDocs] = useState<MyDoc[] | null>(null)
  const [reference, setReference] = useState<string | null>(null)
  const [opening, setOpening] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    kscwApi<{ reference_number: string | null; docs: MyDoc[] }>('/registration/my-docs')
      .then((res) => {
        if (cancelled) return
        setDocs(res.docs ?? [])
        setReference(res.reference_number ?? null)
      })
      .catch(() => { if (!cancelled) setDocs([]) })
    return () => { cancelled = true }
  }, [])

  // Fetch the file (cookie auth) and open it in a new tab via a blob URL.
  const openDoc = async (field: string) => {
    if (opening) return
    setOpening(field)
    try {
      const res = await fetch(`${API_URL}/kscw/registration/my-docs/${field}`, { credentials: 'include' })
      if (!res.ok) throw new Error(String(res.status))
      const blob = await res.blob()
      const obj = URL.createObjectURL(blob)
      window.open(obj, '_blank', 'noopener')
      window.setTimeout(() => URL.revokeObjectURL(obj), 60_000)
    } catch {
      toast.error(t('auth:myDocsError'))
    } finally {
      setOpening(null)
    }
  }

  // Nothing to show (still loading, none, or endpoint unavailable) → render
  // nothing so members without documents don't see an empty card.
  if (!docs || docs.length === 0) return null

  return (
    <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('auth:myDocsTitle')}</h2>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
        {t('auth:myDocsSubtitle')}{reference ? ` · ${reference}` : ''}
      </p>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {docs.map((d) => {
          const label = DOC_LABEL_KEY[d.field] ? t(`admin:${DOC_LABEL_KEY[d.field]}`) : d.field
          const busy = opening === d.field
          return (
            <button
              key={d.field}
              type="button"
              disabled={busy}
              onClick={() => { void openDoc(d.field) }}
              className="flex min-h-11 items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              {busy
                ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gray-400" />
                : <FileText className="h-4 w-4 shrink-0 text-gray-400" />}
              <span className="truncate">{label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
