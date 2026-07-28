-- 267: allow the 'vis_transfers' account in scheduling_emails
--
-- The VIS transfer-letters mailbox (vis_transfers@mail.kscw.ch) was added to
-- ACCOUNTS in scheduling-mailbox.js, but the account CHECK (last widened by
-- migration 222) still allowed only volleyball|basketball|admin — so the sync
-- cron re-failed the same IMAP uids on EVERY tick, forever: ~4.4k
-- "violates check constraint scheduling_emails_account_check" inserts per day
-- on prod AND dev (counted 2026-07-28). Besides the log spam, those tight
-- failure loops stall the event loop enough to trip Directus's pressure
-- limiter ("Under pressure" 503s observed on dev the same day).
--
-- Schema-only + idempotent, same shape as 222. Item permissions: none —
-- scheduling_emails has no policy rows; the endpoint IS the gate
-- (authForAccount in scheduling-mailbox.js, vis_transfers is admin-gated).

BEGIN;

DO $$ BEGIN
  ALTER TABLE public.scheduling_emails DROP CONSTRAINT IF EXISTS scheduling_emails_account_check;
  ALTER TABLE public.scheduling_emails
    ADD CONSTRAINT scheduling_emails_account_check
    CHECK (account IN ('volleyball', 'basketball', 'admin', 'vis_transfers'));
END $$;

COMMENT ON COLUMN public.scheduling_emails.account IS
  'Mailbox partition (migrations 144/222/267): volleyball|basketball = the Spielplanung mailboxes at *@spielplanung.kscw.ch; admin = the club-admin mailbox at admin@wiedisync.kscw.ch; vis_transfers = the VIS transfer-letters mailbox at vis_transfers@mail.kscw.ch. Deduped per-account by UNIQUE (account, message_id). NB this is an account key, not a sport — the name predates the admin mailbox.';

COMMIT;
