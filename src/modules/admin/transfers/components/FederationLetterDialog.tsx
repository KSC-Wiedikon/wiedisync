import { useTranslation } from 'react-i18next'
import { Mail } from 'lucide-react'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '../../../../components/ui/dialog'
import { VIS_REQUEST_SUBJECT } from '../constants'
import { buildRequestMailto, visRequestText } from '../utils/federationText'
import { CopyButton } from './CopyButton'
import type { TransferGroup } from '../types'

/**
 * The ONE consolidated letter for a federation: the text an admin copies into
 * their own mail client to ask that federation to enter the players of theirs
 * we cannot open a transfer for yet.
 *
 * ⚠⚠ NOTHING IS EVER SENT FROM THIS PAGE. The dialog offers exactly two things:
 * the text on the clipboard, and a pre-addressed compose window in the admin's
 * own client. There is no send path and there must never be one — the club signs
 * these letters, not the app.
 *
 * ⚠ ONE letter per federation, not one per player: a federation that has to
 * answer 24 near-identical emails about the same club answers none of them.
 *
 * ⚠ ALWAYS ENGLISH — `visRequestText` takes no `t` and must never be given one.
 * The recipient is a foreign national federation and the language the KSCW admin
 * happens to read the app in says nothing about what that federation reads;
 * English is the FIVB working language. The full reasoning, and the reason the
 * wording ASKS rather than accuses, is on `visRequestText` in
 * `../utils/federationText`.
 *
 * Promoted here from a `text-xs <summary>` (original 1913-1941) because it was
 * the page's only outbound action and read like a footnote. The body, the
 * recipient rule and the `MAILTO_MAX` fallback are unchanged.
 */
export function FederationLetterDialog({ group, federationName, emails, open, onOpenChange }: {
  group: TransferGroup
  federationName: string
  emails: string[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation('admin')

  // Everyone we cannot request a transfer for yet: not found AND never checked.
  // ⚠ `!== true`, deliberately — both need exactly the same thing from the
  // federation, and splitting them into two letters would ask the same people
  // the same question twice.
  const pending = group.rows.filter((m) => m.in_vis !== true)
  const body = visRequestText(pending, federationName)
  // ⚠ The FIRST address only. VIS lists several for many federations and which
  // one is right for a transfer request is the club's call, so the rest are
  // offered as a copy (in the group header) but never pre-picked as the
  // addressee.
  const mailto = buildRequestMailto(emails[0], VIS_REQUEST_SUBJECT, body)
  // Three states, three different sentences — and they are genuinely different
  // things to tell an admin. `noAddress` used to be reported as "too long to
  // prefill an email", ~40px below the line that already said VIS lists no
  // address for this federation, so the footer contradicted itself.
  const footerKey = mailto.state === 'bodyIncluded'
    ? 'trRequestHint'
    : mailto.state === 'tooLong'
      ? 'trBulkTooLong'
      : 'trRequestNoAddress'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('trRequestDialogTitle')}</DialogTitle>
          <DialogDescription>{t('trRequestDialogDescription')}</DialogDescription>
        </DialogHeader>

        {/* ⚠ `break-words` is not cosmetic: a member line carries a 45-character
            email address as ONE unbreakable token, and this box used to sit
            inside an `overflow-hidden` card with no scrollbar — so the very text
            the admin is told to copy was silently CLIPPED. */}
        <p className="max-h-[50vh] overflow-y-auto rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs break-words whitespace-pre-line text-gray-600 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-300">
          {body}
        </p>

        <div className="flex flex-wrap items-center gap-1.5">
          <CopyButton value={body} title={t('trRequestCopy')} label={t('trRequestCopy')} />
          {mailto.href && (
            <a
              href={mailto.href}
              className="inline-flex min-h-[44px] items-center gap-1 rounded-md border border-brand-300 px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50 sm:min-h-0 dark:border-brand-700 dark:text-brand-200 dark:hover:bg-brand-900/30"
            >
              <Mail className="h-3.5 w-3.5" aria-hidden="true" />
              {t('trBulkCompose')}
            </a>
          )}
        </div>

        <p className="text-xs text-gray-400 dark:text-gray-500">{t(footerKey)}</p>
      </DialogContent>
    </Dialog>
  )
}
