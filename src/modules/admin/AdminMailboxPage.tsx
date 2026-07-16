import { useTranslation } from 'react-i18next'
import { useReportPageLoading } from '../../hooks/usePageReady'
import { useMailbox } from '../gameScheduling/hooks/useMailbox'
import MailboxPanel from '../gameScheduling/components/MailboxPanel'

/**
 * Club-admin mailbox (admin@wiedisync.kscw.ch) for the main app — the board's
 * general inbox, served from the pinned /kscw/admin/mailbox route family.
 *
 * Deliberately NOT the Spielplanung mailbox: that gate grants `is_spielplaner`,
 * which must never imply access to the club's general mail. Access here is
 * Directus admin / app admin / superuser / vorstand (see VorstandRoute, which
 * mirrors the server's authForAccount('admin')).
 *
 * Opponent classification (chips, assign, per-opponent thread) is
 * volleyball-scheduling-only, so it is passed inert: an empty `opponentContacts`
 * makes MailboxPanel resolve no chip, render no team filter and drop the assign
 * control entirely — the same way the basketball account uses it.
 */
export default function AdminMailboxPage() {
  const { t } = useTranslation('gameScheduling')
  const mailbox = useMailbox(true, 'admin')

  // First-paint gate: wait for the mailbox list's first response.
  useReportPageLoading(mailbox.configured === null)

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-gray-900 sm:text-2xl dark:text-gray-100">
        {t('mailboxAdminPageTitle')}
      </h1>

      <MailboxPanel
        mailbox={mailbox}
        sport="admin"
        opponentContacts={[]}
        focusOpponent={null}
        onClearFocus={() => {}}
      />
    </div>
  )
}
