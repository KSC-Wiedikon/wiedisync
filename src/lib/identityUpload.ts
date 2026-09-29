/**
 * Encrypt an identity document in this browser and store it: one envelope per reader the
 * server names, the ciphertext upload, then the bind. Shared by the profile upload and the
 * recompress paths (the owner's background shrink, a superadmin's Show IDs).
 *
 * `recompress`: a smaller re-encoding of the member's EXISTING document. The server keeps
 * its attribution and upload date, and allows only the readers it already had plus the
 * member's team staff — never a superadmin who held no key before (2026-09-28 audit F12).
 * Allowed for the owner and for a Directus admin, exactly like an upload.
 */
import { API_URL, kscwApi } from './api'
import { encryptDocument, wrapContentKeyFor } from './e2ee'

interface Recipient {
  member: number
  is_self: boolean
  public_key: string
}

export async function storeIdentityDocument(opts: {
  member: number
  file: Blob
  mime: string
  recompress?: boolean
}): Promise<{ staff: number }> {
  const { member, file, mime, recompress = false } = opts

  // Who may read it — asked FIRST: it is the cheap authorisation check, so a caller who
  // may not store this document is refused before any ciphertext is uploaded.
  const { data } = await kscwApi<{ data: { recipients: Recipient[] } }>(
    `/identity/recipients/${member}${recompress ? '?recompress=1' : ''}`,
  )

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
  if (!up.ok) throw Object.assign(new Error(`identity upload ${up.status}`), { status: up.status })
  const { data: { id: fileId } } = await up.json() as { data: { id: string } }

  // 3. Wrap the content key once per reader the server handed back — only those.
  const envelopes = await Promise.all(
    data.recipients.map(async (r) => ({
      recipient: r.member,
      ...(await wrapContentKeyFor(enc.contentKey, r.public_key)),
    })),
  )

  await kscwApi('/identity/document', {
    method: 'POST',
    body: { member, file: fileId, iv: enc.iv, mime, size: file.size, envelopes, ...(recompress ? { recompress: true } : {}) },
  })

  return { staff: data.recipients.filter((r) => !r.is_self).length }
}
