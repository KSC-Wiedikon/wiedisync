import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Lock, ShieldCheck, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ConfirmProvider'
import { useAuth } from '../../hooks/useAuth'
import { useIdentityKeys } from '../../hooks/useIdentityKeys'
import { API_URL, kscwApi, uploadFile } from '../../lib/api'
import { decryptDocument, encryptDocument, unwrapContentKey, wrapContentKeyFor, type Envelope } from '../../lib/e2ee'
import { formatDateZurich } from '../../utils/dateHelpers'

/** Migration 212. Ciphertext only — never served via /assets. */
const IDENTITY_FOLDER = 'd0c00001-0000-4000-8000-000000000001'

const MAX_BYTES = 8 * 1024 * 1024

interface Recipient {
  member: number
  is_self: boolean
  first_name: string
  last_name: string
  public_key: string
}

interface DocResponse {
  data: {
    iv: string
    mime: string | null
    uploaded_at: string
    uploaded_by_self: boolean
    envelope: Envelope
  }
}

/**
 * The member's identity document — encrypted in this browser, readable by them and by the
 * coaches/TRs of their teams, and by nobody else. Not the server, not an admin, not whoever
 * has root on the VPS.
 *
 * The password prompt below is NOT a login. It unlocks the private key that this device
 * stores afterwards, so it is asked for once per device, not once per page load.
 */
export default function IdentityDocumentSection() {
  const { t } = useTranslation('auth')
  const { realUser } = useAuth()
  const confirm = useConfirm()
  const { state, privateKey, setup, unlock, lock } = useIdentityKeys()

  const memberId = realUser?.id ? Number(realUser.id) : null
  const fileRef = useRef<HTMLInputElement>(null)

  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [doc, setDoc] = useState<DocResponse['data'] | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [checked, setChecked] = useState(false)

  // Revoke the object URL when it changes or the section unmounts — a decrypted ID left in
  // a live blob URL is exactly the thing this feature exists to avoid leaving lying around.
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  /** Re-read after a write. Only ever called from an event handler, never from an effect. */
  const loadDoc = useCallback(async () => {
    if (memberId == null) return
    try {
      setDoc((await kscwApi<DocResponse>(`/identity/document/${memberId}`)).data)
    } catch {
      setDoc(null)
    }
  }, [memberId])

  // First read, once the key is in hand. Every setState sits inside a promise callback:
  // a synchronous one in the effect body cascades a render.
  useEffect(() => {
    if (memberId == null || state !== 'unlocked' || checked) return
    let cancelled = false
    kscwApi<DocResponse>(`/identity/document/${memberId}`)
      .then((res) => { if (!cancelled) setDoc(res.data) })
      .catch(() => { if (!cancelled) setDoc(null) })
      .finally(() => { if (!cancelled) setChecked(true) })
    return () => { cancelled = true }
  }, [memberId, state, checked])

  const handleKeyAction = async () => {
    if (!password) return
    setBusy(true)
    try {
      if (state === 'none') {
        await setup(password)
        toast.success(t('idKeyCreated'))
      } else {
        await unlock(password)
        toast.success(t('idUnlocked'))
      }
      setPassword('')
    } catch {
      // A wrong password fails the AES-GCM auth tag, so this really is "wrong password"
      // rather than a guess.
      toast.error(state === 'none' ? t('idKeyFailed') : t('idWrongPassword'))
    } finally {
      setBusy(false)
    }
  }

  const handleUpload = async (file: File) => {
    if (memberId == null || !privateKey) return
    if (file.size > MAX_BYTES) { toast.error(t('idTooLarge')); return }

    setBusy(true)
    try {
      // 1. Encrypt here. The plaintext never leaves this function.
      const enc = await encryptDocument(file)

      // 2. Upload the ciphertext. What lands on the server is noise without an envelope.
      const blob = new File([enc.ciphertext as BlobPart], 'identity.enc', { type: 'application/octet-stream' })
      const { id: fileId } = await uploadFile(blob, IDENTITY_FOLDER)

      // 3. Wrap the content key once per authorised reader — the member, plus the coaches
      //    and TRs of their teams. The server decides that list; we only wrap to what it
      //    hands back, and it never includes an admin.
      const { data } = await kscwApi<{ data: { recipients: Recipient[] } }>(
        `/identity/recipients/${memberId}`,
      )
      const envelopes = await Promise.all(
        data.recipients.map(async (r) => ({
          recipient: r.member,
          ...(await wrapContentKeyFor(enc.contentKey, r.public_key)),
        })),
      )

      await kscwApi('/identity/document', {
        method: 'POST',
        body: {
          member: memberId,
          file: fileId,
          iv: enc.iv,
          mime: file.type || 'image/jpeg',
          size: file.size,
          envelopes,
        },
      })

      const staff = data.recipients.filter((r) => !r.is_self).length
      toast.success(t('idUploaded', { count: staff }))
      setPreview(null)
      await loadDoc()
    } catch {
      toast.error(t('idUploadFailed'))
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const handleView = async () => {
    if (memberId == null || !privateKey || !doc) return
    setBusy(true)
    try {
      const key = await unwrapContentKey(doc.envelope, privateKey)
      // Raw bytes, so not via kscwApi (which parses JSON). Cookie auth, same as my-docs.
      const res = await fetch(`${API_URL}/kscw/identity/document/${memberId}/bytes`, {
        credentials: 'include',
      })
      if (!res.ok) throw new Error(String(res.status))
      const plain = await decryptDocument(new Uint8Array(await res.arrayBuffer()), doc.iv, key)
      const url = URL.createObjectURL(new Blob([plain as BlobPart], { type: doc.mime ?? 'image/jpeg' }))
      setPreview(url)
    } catch {
      toast.error(t('idDecryptFailed'))
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async () => {
    if (memberId == null) return
    if (!(await confirm({ message: t('idDeleteConfirm'), danger: true }))) return
    setBusy(true)
    try {
      await kscwApi(`/identity/document/${memberId}`, { method: 'DELETE' })
      setDoc(null)
      setPreview(null)
      toast.success(t('idDeleted'))
    } catch {
      toast.error(t('idDeleteFailed'))
    } finally {
      setBusy(false)
    }
  }

  if (state === 'loading') {
    return <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
  }

  return (
    <div className="space-y-4 rounded-lg border bg-card p-4">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{t('idTitle')}</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{t('idExplainer')}</p>
        </div>
      </div>

      {(state === 'none' || state === 'locked') && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {state === 'none' ? t('idSetupHint') : t('idUnlockHint')}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleKeyAction() }}
              placeholder={t('idPasswordPlaceholder')}
              aria-label={t('idPasswordPlaceholder')}
              className="h-11 flex-1 rounded-md border bg-background px-3 text-sm dark:bg-gray-800"
            />
            <Button onClick={() => void handleKeyAction()} loading={busy} disabled={!password}>
              <Lock className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {state === 'none' ? t('idSetup') : t('idUnlock')}
            </Button>
          </div>
          {state === 'locked' && <p className="text-xs text-muted-foreground">{t('idResetWarning')}</p>}
        </div>
      )}

      {state === 'unlocked' && (
        <div className="space-y-3">
          {doc ? (
            <>
              <div className="rounded-md border bg-background p-3 text-xs text-muted-foreground">
                {t('idStored', { date: formatDateZurich(doc.uploaded_at) })}
                {!doc.uploaded_by_self && <> · {t('idUploadedByAdmin')}</>}
              </div>

              {preview && (
                <img
                  src={preview}
                  alt={t('idTitle')}
                  className="max-h-80 w-full rounded-md border object-contain"
                />
              )}

              <div className="flex flex-wrap gap-2">
                {!preview && (
                  <Button variant="outline" onClick={() => void handleView()} loading={busy}>
                    {t('idView')}
                  </Button>
                )}
                <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={busy}>
                  <Upload className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  {t('idReplace')}
                </Button>
                <Button variant="destructive" onClick={() => void handleDelete()} disabled={busy}>
                  <Trash2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  {t('idDelete')}
                </Button>
              </div>
            </>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => fileRef.current?.click()} loading={busy}>
                <Upload className="mr-1.5 h-4 w-4" aria-hidden="true" />
                {t('idUpload')}
              </Button>
              <span className="text-xs text-muted-foreground">{t('idUploadHint')}</span>
            </div>
          )}

          <button
            type="button"
            onClick={() => void lock()}
            className="text-xs text-muted-foreground underline underline-offset-2"
          >
            {t('idForgetDevice')}
          </button>

          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUpload(f) }}
          />
        </div>
      )}

      {state === 'error' && <p className="text-xs text-destructive">{t('idError')}</p>}
    </div>
  )
}
