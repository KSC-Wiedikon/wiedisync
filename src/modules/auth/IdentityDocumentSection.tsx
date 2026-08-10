import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Lock, ShieldCheck, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ConfirmProvider'
import { useAuth } from '../../hooks/useAuth'
import { useIdentityKeys } from '../../hooks/useIdentityKeys'
import { API_URL, kscwApi } from '../../lib/api'
import { captureApiError } from '../../lib/sentry'
import { decryptDocument, encryptDocument, unwrapContentKey, wrapContentKeyFor, type Envelope } from '../../lib/e2ee'
import { formatDateZurich } from '../../utils/dateHelpers'
import IdentityCropDialog from './IdentityCropDialog'

const MAX_BYTES = 8 * 1024 * 1024

/**
 * Can this browser actually render the picked image?
 *
 * `image/*` is not a promise that the decoder exists: an iPhone HEIC opened on Android Chrome
 * has an image MIME type and decodes nowhere. The crop editor would show a black frame and
 * then fail on the canvas draw, which is worse than not offering it.
 */
async function canDecode(file: File): Promise<boolean> {
  const url = URL.createObjectURL(file)
  try {
    await new Promise<void>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('decode failed'))
      img.src = url
    })
    return true
  } catch {
    return false
  } finally {
    URL.revokeObjectURL(url)
  }
}

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
 *
 * ⚠ EVERY <Button> HERE NEEDS type="button". This section renders inside ProfileEditForm's
 * <form> (the `beforeActions` slot), and shadcn's Button sets no type — so the HTML default
 * `submit` applies. Without it, tapping "Upload" opened the file picker AND submitted the
 * profile form, whose onSaved navigates away from /profile/edit; the picker's onChange then
 * landed on an unmounted component and the upload silently never fired. Four members hit
 * this on 2026-08-03 with zero server-side trace — the POST never left the browser.
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
  /** A picked image waiting to be cropped/rotated. PDFs skip this and upload as-is. */
  const [pending, setPending] = useState<File | null>(null)

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

      // 2. Upload the ciphertext through our own endpoint, NOT POST /files. The identity
      //    folder is excluded from the Member file-read policy, so Directus would create the
      //    row and answer 204 with an empty body — no file id ever reaches us.
      const up = await fetch(`${API_URL}/kscw/identity/upload`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: enc.ciphertext as BodyInit,
      })
      if (!up.ok) throw new Error(String(up.status))
      const { data: { id: fileId } } = await up.json() as { data: { id: string } }

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
    } catch (err) {
      // Report it. The two kscwApi legs log themselves, but the raw fetch above and the
      // crypto before it do not — so a failed upload used to leave NO trace anywhere: no
      // log line, no Sentry event, and (because the POST never left the browser) nothing
      // server-side either. That is what made the 2026-08-03 reports unfalsifiable.
      captureApiError(err, {
        operation: 'identityUpload',
        endpoint: '/identity/upload',
        method: 'POST',
        payload: { mime: file.type, size: file.size },
      })
      toast.error(t('idUploadFailed'))
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  /**
   * A freshly picked file. Images go to the crop/rotate editor first — a phone shot of an ID
   * is nearly always sideways, or a small card on a big table — and the editor hands back the
   * flattened JPEG to upload.
   *
   * A PDF has nothing to crop, and an undecodable image has nothing to show, so both skip the
   * editor and upload as they are rather than dead-ending in it.
   */
  const handlePicked = async (file: File) => {
    if (file.size > MAX_BYTES) { toast.error(t('idTooLarge')); return }
    if (file.type.startsWith('image/') && await canDecode(file)) { setPending(file); return }
    await handleUpload(file)
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

  const header = (
    <div className="flex items-start gap-3">
      <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-foreground">{t('idTitle')}</h3>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{t('idExplainer')}</p>
      </div>
    </div>
  )

  // The card shell renders in EVERY state — swapping a bare spinner for the card
  // (and, below, the upload branch for the stored branch) made the section pop
  // and reflow in stages as each fetch landed.
  if (state === 'loading') {
    return (
      <div className="space-y-4 rounded-lg border bg-card p-4">
        {header}
        <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      </div>
    )
  }

  return (
    <div className="space-y-4 rounded-lg border bg-card p-4">
      {header}

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
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleKeyAction() } }}
              placeholder={t('idPasswordPlaceholder')}
              aria-label={t('idPasswordPlaceholder')}
              className="h-11 flex-1 rounded-md border bg-background px-3 text-sm dark:bg-gray-800"
            />
            <Button type="button" onClick={() => void handleKeyAction()} loading={busy} disabled={!password}>
              <Lock className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {state === 'none' ? t('idSetup') : t('idUnlock')}
            </Button>
          </div>
          {state === 'locked' && <p className="text-xs text-muted-foreground">{t('idResetWarning')}</p>}
        </div>
      )}

      {/* Until the first document read resolves, hold a spinner — rendering the
          upload branch and then flipping to "stored" a beat later reads as a
          glitch, and for a member who HAS a document it briefly offers the
          wrong action. */}
      {state === 'unlocked' && !checked && (
        <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      )}

      {state === 'unlocked' && checked && (
        <div className="space-y-3">
          {doc ? (
            <>
              <div className="rounded-md border bg-background p-3 text-xs text-muted-foreground">
                {t('idStored', { date: formatDateZurich(doc.uploaded_at) })}
                {!doc.uploaded_by_self && <> · {t('idUploadedByAdmin')}</>}
              </div>

              {/* The upload accepts PDFs as well as photos — rendering one through
                  <img> showed a broken icon. Preview off the SAME decrypted blob
                  URL (not the shared FilePreview): a second copy of a plaintext ID
                  in memory is exactly what the revoke-on-unmount dance avoids. */}
              {preview && (doc.mime === 'application/pdf' ? (
                <iframe
                  src={preview}
                  title={t('idTitle')}
                  className="h-96 w-full rounded-md border bg-white"
                />
              ) : (
                <img
                  src={preview}
                  alt={t('idTitle')}
                  className="max-h-80 w-full rounded-md border object-contain"
                />
              ))}

              <div className="flex flex-wrap gap-2">
                {!preview && (
                  <Button type="button" variant="outline" onClick={() => void handleView()} loading={busy}>
                    {t('idView')}
                  </Button>
                )}
                <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} disabled={busy}>
                  <Upload className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  {t('idReplace')}
                </Button>
                <Button type="button" variant="destructive" onClick={() => void handleDelete()} disabled={busy}>
                  <Trash2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  {t('idDelete')}
                </Button>
              </div>
            </>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" onClick={() => fileRef.current?.click()} loading={busy}>
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
            onChange={(e) => {
              const f = e.target.files?.[0]
              // Clear the input here, not after the upload: the editor can be cancelled, and
              // a stale value would make re-picking the SAME photo fire no change event.
              e.target.value = ''
              if (f) void handlePicked(f)
            }}
          />
        </div>
      )}

      {pending && (
        <IdentityCropDialog
          file={pending}
          onCancel={() => setPending(null)}
          onConfirm={(cropped) => { setPending(null); void handleUpload(cropped) }}
        />
      )}

      {state === 'error' && <p className="text-xs text-destructive">{t('idError')}</p>}
    </div>
  )
}
