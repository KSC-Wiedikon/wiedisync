/**
 * Email suppression list — the addresses we must stop mailing.
 *
 * Backed by `email_suppressions` (migration 277), written by the SES/SNS
 * webhook in ses-notify.js and read by every send path.
 *
 * Why this exists: bounces and complaints accrue against the SES *identity*,
 * not against a campaign, and this platform sends password resets, signup
 * invitations, scheduling mail and expense reimbursements through that same
 * identity. Repeatedly mailing dead addresses is therefore not a cosmetic
 * problem — it is how a club loses its transactional email.
 */

/** Normalised form used everywhere — the table stores this, readers compare it. */
export function normaliseEmail(email) {
  return String(email || '').trim().toLowerCase()
}

/**
 * Which of `emails` are currently suppressed. Returns a Set of normalised
 * addresses; an empty input (or any failure) returns an empty Set so a
 * suppression-table problem can never block a legitimate send.
 */
export async function loadSuppressed(database, emails) {
  const wanted = [...new Set((emails || []).map(normaliseEmail).filter(Boolean))]
  if (wanted.length === 0) return new Set()
  try {
    const rows = await database('email_suppressions')
      .whereIn('email', wanted)
      .whereNull('released_at')
      .select('email')
    return new Set(rows.map(r => normaliseEmail(r.email)))
  } catch {
    // Fail OPEN. A missing/locked suppression table must not silently stop the
    // club's mail; the cost of one extra bounce is far lower than the cost of
    // a GV invitation that never went out.
    return new Set()
  }
}

/**
 * Record a suppression. Idempotent via the partial unique index on active rows,
 * so SES retrying the same bounce notification is a no-op rather than a
 * duplicate. Returns true if a NEW row was written.
 */
export async function suppress(database, { email, reason, subtype, detail, sesMessageId, source = 'ses' }) {
  const addr = normaliseEmail(email)
  if (!addr) return false
  const inserted = await database('email_suppressions')
    .insert({
      email: addr,
      reason,
      subtype: subtype ? String(subtype).slice(0, 64) : null,
      detail: detail ? String(detail).slice(0, 2000) : null,
      source,
      ses_message_id: sesMessageId ? String(sesMessageId).slice(0, 255) : null,
    })
    // Targetless: the uniqueness is a PARTIAL index (WHERE released_at IS NULL),
    // which a named ON CONFLICT target cannot reference.
    .onConflict()
    .ignore()
    .returning('id')
  return inserted.length > 0
}
